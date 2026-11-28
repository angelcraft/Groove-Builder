"""Exclusive installer lock using an OS file lock (fcntl.flock on POSIX/Android, msvcrt on Windows).

The lock is held by an open handle for the whole operation, so a crashed
process never leaves a *held* lock. The lock FILE is removed on release so the
runtime gate (lock/journal present => block custom launches) only sees it
while an operation runs or after a crash; `recover` takes the same lock, it
never unlinks a lock that another process holds.
"""
import json
import os
import time

from .errors import InstallError

if os.name == "nt":  # pragma: no cover - exercised on Windows only
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
        fcntl.flock(fd, fcntl.LOCK_UN)


class InstallerLock:
    def __init__(self, path):
        self.path = path
        self.fd = None
        self.preexisting = False

    def acquire(self):
        for _ in range(3):
            self.preexisting = os.path.lexists(self.path)
            fd = os.open(self.path, os.O_RDWR | os.O_CREAT | getattr(os, "O_BINARY", 0)
                         | getattr(os, "O_NOFOLLOW", 0), 0o644)
            if not _try_lock(fd):
                os.close(fd)
                raise InstallError("LOCKED", "another installer or recovery is running on this SD")
            if os.name != "nt":
                # The file may have been unlinked by the previous holder between open and lock.
                try:
                    same = os.path.samestat(os.fstat(fd), os.stat(self.path))
                except FileNotFoundError:
                    same = False
                if not same:
                    _unlock(fd)
                    os.close(fd)
                    continue
            os.ftruncate(fd, 0)
            os.write(fd, json.dumps({"pid": os.getpid(), "time": int(time.time())}).encode())
            os.fsync(fd)
            self.fd = fd
            return self
        raise InstallError("LOCKED", "lock file is being replaced concurrently; retry")

    def release(self, remove=True):
        if self.fd is None:
            return
        fd, self.fd = self.fd, None
        if os.name == "nt":  # an open file cannot be deleted on Windows: unlock, close, then remove
            _unlock(fd)
            os.close(fd)
            if remove:
                try:
                    os.remove(self.path)
                except OSError:
                    pass  # another process already opened it; it owns it now
        else:
            if remove:
                try:
                    os.remove(self.path)
                except FileNotFoundError:
                    pass
            _unlock(fd)
            os.close(fd)

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()
        return False
