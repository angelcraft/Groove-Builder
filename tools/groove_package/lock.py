"""Installer lock = persistent OS MUTEX file + removable SENTINEL file (GE-154 review 7240284577).

  mutex     groove/.installer.mutex   never deleted by the installer; holds an OS lock for the whole
                                      operation (fcntl.flock on POSIX/Android, msvcrt.locking on Windows).
                                      A crashed process loses it automatically (the OS drops the handle).
  sentinel  groove/.installer/lock    the half of the runtime gate that means "an installer is running or
                                      crashed" (the other half is .installer/journal.json). Created, written,
                                      and removed ONLY while holding the mutex, so no two installers can ever
                                      interleave on it: no re-acquire/abandon race, no unlink of a sentinel
                                      that another operation deliberately kept (journal pending).

Why two files: on Windows an open file cannot be deleted and `release()` had to close the handle before
removing it, leaving a window in which another process could acquire, finish (and keep the sentinel because
a journal was left) before our unlink. With a permanent mutex the sentinel is never the thing being locked.

  acquire:  open/create mutex -> OS lock (LOCKED if held) -> create sentinel with O_EXCL (so `preexisting`
            proves whether THIS call created it; an existing/stale one is reused) -> write {pid,time,token}
            completely -> fsync -> close the sentinel handle. Any failure: remove the sentinel only if this
            call created it, unlock the mutex, close the handle, raise LOCK_IO_ERROR.
  release:  [remove the sentinel unless a journal/crash keeps the gate closed] -> unlock -> close.

Gate ordering for GE-151 (unchanged): sentinel (fsync) -> journal (fsync dir) -> ... -> journal removed (fsync)
-> sentinel removed. At every instant of a mutation at least one of {sentinel, journal} exists. The mutex file is
NOT part of the gate: the runtime must ignore it. The lock is advisory between installers using this code; it
is not protection against other programs (see README: offline, trusted file system, no TOCTOU promise).
"""
import json
import os
import secrets
import time

from .errors import InstallError

WINDOWS = os.name == "nt"
MAX_LOCK_BYTES = 256

if WINDOWS:  # pragma: no cover - exercised on Windows only (CI windows-latest)
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

BIN = getattr(os, "O_BINARY", 0)
NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


def _write_all(fd, data: bytes):
    """os.write may write less than asked (FAT/USB stacks do); loop until complete."""
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
    """Token stored in the sentinel at `path`, or None (absent, unreadable, junk)."""
    try:
        fd = os.open(path, os.O_RDONLY | BIN | NOFOLLOW)
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


class InstallerLock:
    def __init__(self, path, mutex_path=None):
        self.path = path                                  # sentinel (runtime gate)
        self.mutex_path = mutex_path or (path + ".mutex")
        self.fd = None                                    # handle on the mutex while held
        self.token = None
        self.preexisting = False                          # sentinel existed (stale/kept) when we acquired
        self.created = False                              # THIS acquire created the sentinel (O_EXCL)

    def _open_sentinel(self):
        """Create with O_EXCL (proves ownership of creation) or reuse an existing one. Mutex is held."""
        flags = os.O_RDWR | BIN | NOFOLLOW
        try:
            return os.open(self.path, flags | os.O_CREAT | os.O_EXCL, 0o644), True
        except FileExistsError:
            return os.open(self.path, flags, 0o644), False

    def _rm_sentinel(self):
        try:
            os.remove(self.path)
        except FileNotFoundError:
            pass

    def acquire(self):
        try:
            mfd = os.open(self.mutex_path, os.O_RDWR | os.O_CREAT | BIN | NOFOLLOW, 0o644)
        except OSError as e:
            raise InstallError("LOCK_IO_ERROR", f"cannot open {self.mutex_path}: {e}") from None
        try:
            locked = _try_lock(mfd)
        except BaseException:
            _close(mfd)
            raise
        if not locked:
            _close(mfd)
            raise InstallError("LOCKED", "another installer or recovery is running on this SD")
        created = False
        sfd = None
        try:
            sfd, created = self._open_sentinel()
            token = secrets.token_hex(16)
            payload = json.dumps({"pid": os.getpid(), "time": int(time.time()), "token": token}).encode("ascii")
            os.ftruncate(sfd, 0)
            os.lseek(sfd, 0, os.SEEK_SET)
            _write_all(sfd, payload)
            os.fsync(sfd)
            _close(sfd)
            sfd = None
        except BaseException as e:
            if sfd is not None:
                _close(sfd)  # Windows: must be closed before the unlink below
            try:
                if created:
                    self._rm_sentinel()
            except OSError:
                pass
            _unlock(mfd)
            _close(mfd)
            if isinstance(e, OSError):
                raise InstallError("LOCK_IO_ERROR", f"cannot write {self.path}: {e}") from None
            raise
        self.fd, self.token, self.created, self.preexisting = mfd, token, created, not created
        return self

    def release(self, remove=True):
        """Remove the sentinel (unless the gate must stay closed), then drop the mutex. Never touches
        the sentinel without holding the mutex; never deletes the mutex file."""
        if self.fd is None:
            return
        fd = self.fd
        self.fd = self.token = None
        try:
            if remove:
                try:
                    self._rm_sentinel()
                except OSError:
                    pass  # e.g. a reader has it open on Windows: it stays, which is the safe (closed) side
        finally:
            _unlock(fd)
            _close(fd)

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()
        return False
