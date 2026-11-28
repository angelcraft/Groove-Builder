"""Exclusive installer lock using an OS file lock (fcntl.flock on POSIX/Android, msvcrt on Windows).

The lock is held by an open handle for the whole operation, so a crashed process never leaves a
*held* lock (the OS drops it with the handle). The lock FILE doubles as half of the runtime gate:

    groove/.installer/lock  OR  groove/.installer/journal.json present  =>  no custom launches

Gate/lock/journal ordering (GE-154 review 7239548049):
  * acquire: open/create -> OS lock -> write {pid,time,token} completely -> fsync; any failure in
    between unlocks, closes the handle and removes the file only if THIS call created it.
  * the installer writes journal.json (same directory, dir fsync) only after acquire, and removes it
    (dir fsync) before release, so at every instant of a mutation at least one gate file exists.
  * a journal left behind (crash, cleanup error, tampering) keeps the lock file too (release(remove=False)).
  * release never unlinks a lock file that belongs to another process:
      POSIX:   unlink only while still holding the OS lock AND the path is still our inode.
      Windows: unlock + close, then remove only if the file still carries OUR token. Python opens files
               without FILE_SHARE_DELETE, so a process that already re-opened the file makes the remove
               fail (ignored) and the token check covers a completed re-acquire.
The lock is advisory between installers on this host; it is not a protection against other agents
(see README: offline, trusted file system, no TOCTOU guarantees against external writers).
"""
import json
import os
import secrets
import time

from .errors import InstallError

WINDOWS = os.name == "nt"
MAX_LOCK_BYTES = 256

if WINDOWS:  # pragma: no cover - exercised on Windows only
    import msvcrt

    def _try_lock(fd):
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False

    def _unlock(fd):
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
else:
    import fcntl

    def _try_lock(fd):
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def _unlock(fd):
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass


def _write_all(fd, data: bytes):
    """os.write may write less than asked (and FAT/USB stacks do); loop until complete."""
    view = memoryview(data)
    while view:
        n = os.write(fd, view)
        if not n or n < 0:
            raise OSError(5, "lock file write made no progress")
        view = view[n:]


def _close(fd):
    try:
        os.close(fd)
    except OSError:
        pass


def read_token(path):
    """Token of the lock file at `path`, or None (absent, unreadable, locked by another process, junk)."""
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    try:
        raw = os.read(fd, MAX_LOCK_BYTES + 1)
    except OSError:
        return None
    finally:
        _close(fd)
    try:
        obj = json.loads(raw.decode("ascii"))
        tok = obj.get("token") if isinstance(obj, dict) else None
        return tok if isinstance(tok, str) else None
    except (ValueError, UnicodeDecodeError):
        return None


def _same_file(fd, path):
    try:
        return os.path.samestat(os.fstat(fd), os.lstat(path))
    except OSError:
        return False


class InstallerLock:
    def __init__(self, path):
        self.path = path
        self.fd = None
        self.token = None
        self.preexisting = False
        self.windows = WINDOWS  # tests flip this to exercise the Windows release order on any host

    # ------------------------------------------------------------------ acquire
    def _abandon(self, fd, created):
        """Failure after the OS lock was taken: never leave a held lock, a leaked fd or our own new file."""
        if created and self.windows:
            try:
                os.ftruncate(fd, 0)  # so the size check below recognises our own partial file
            except OSError:
                pass
        try:
            if created and not self.windows and _same_file(fd, self.path):
                try:
                    os.remove(self.path)  # still holding the lock: nobody else can own this inode
                except OSError:
                    pass
        finally:
            _unlock(fd)
            _close(fd)
        if created and self.windows:
            try:
                if os.path.getsize(self.path) == 0:  # nothing written by anyone else
                    os.remove(self.path)
            except OSError:
                pass  # another process opened it meanwhile; it owns it now

    def acquire(self):
        for _ in range(3):
            preexisting = os.path.lexists(self.path)
            try:
                fd = os.open(self.path, os.O_RDWR | os.O_CREAT | getattr(os, "O_BINARY", 0)
                             | getattr(os, "O_NOFOLLOW", 0), 0o644)
            except OSError as e:
                raise InstallError("LOCK_IO_ERROR", f"cannot open {self.path}: {e}") from None
            try:
                locked = _try_lock(fd)
            except BaseException:
                _close(fd)
                raise
            if not locked:
                _close(fd)
                raise InstallError("LOCKED", "another installer or recovery is running on this SD")
            if not self.windows and not _same_file(fd, self.path):
                # The previous holder unlinked the file between our open and our lock: retry on the new path.
                _unlock(fd)
                _close(fd)
                continue
            token = secrets.token_hex(16)
            payload = json.dumps({"pid": os.getpid(), "time": int(time.time()), "token": token}).encode("ascii")
            try:
                os.ftruncate(fd, 0)
                os.lseek(fd, 0, os.SEEK_SET)
                _write_all(fd, payload)
                os.fsync(fd)
            except BaseException as e:
                self._abandon(fd, created=not preexisting)
                if isinstance(e, OSError):
                    raise InstallError("LOCK_IO_ERROR", f"cannot write {self.path}: {e}") from None
                raise
            self.fd, self.token, self.preexisting = fd, token, preexisting
            return self
        raise InstallError("LOCKED", "lock file is being replaced concurrently; retry")

    # ------------------------------------------------------------------ release
    def release(self, remove=True):
        if self.fd is None:
            return
        fd, token = self.fd, self.token
        self.fd = self.token = None
        if self.windows:  # an open file cannot be deleted on Windows: unlock, close, then remove if still ours
            _unlock(fd)
            _close(fd)
            if remove and read_token(self.path) == token:
                try:
                    os.remove(self.path)
                except OSError:
                    pass  # another process opened it in between; it owns it now
            return
        try:
            if remove and _same_file(fd, self.path):
                try:
                    os.remove(self.path)
                except FileNotFoundError:
                    pass
        finally:
            _unlock(fd)
            _close(fd)

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()
        return False
