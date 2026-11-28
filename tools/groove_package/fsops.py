"""Filesystem primitives with durability (fsync) and fault injection for tests.

Every mutating primitive counts as one step. Tests set `crash_at=N` to raise
SimulatedCrash (a BaseException, so no in-process rollback runs, like a power
cut or a pulled SD card) or `fail_at=N` to raise OSError (disk full, I/O
error: the installer must roll back in-process).
"""
import os
import shutil


class SimulatedCrash(BaseException):
    pass


class FS:
    def __init__(self, crash_at=None, fail_at=None):
        self.crash_at = crash_at
        self.fail_at = fail_at
        self.steps = 0
        self.log = []

    def _step(self, what):
        self.steps += 1
        self.log.append(what)
        if self.crash_at is not None and self.steps == self.crash_at:
            raise SimulatedCrash(what)
        if self.fail_at is not None and self.steps == self.fail_at:
            raise OSError(5, f"injected I/O error at step {self.steps}: {what}")

    # -- durability helpers -------------------------------------------------
    @staticmethod
    def fsync_dir(path):
        if os.name == "nt":  # directories cannot be opened for fsync on Windows
            return
        try:
            fd = os.open(path, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(fd)
        except OSError:
            pass  # some FUSE/SAF-backed mounts reject directory fsync
        finally:
            os.close(fd)

    # -- mutating primitives --------------------------------------------------
    def mkdir(self, path):
        if os.path.isdir(path):
            return
        self._step(f"mkdir {path}")
        os.mkdir(path)
        self.fsync_dir(os.path.dirname(path))

    def write_file(self, path, data: bytes):
        """Write a NEW file durably (path must not exist)."""
        self._step(f"write {path}")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o644)
        try:
            view = memoryview(data)
            while view:
                n = os.write(fd, view)
                view = view[n:]
            os.fsync(fd)
        finally:
            os.close(fd)
        self.fsync_dir(os.path.dirname(path))

    def copy_file(self, src, dst):
        with open(src, "rb") as f:
            data = f.read()
        self.write_file(dst, data)

    def replace(self, src, dst):
        """Atomic rename on the same volume (os.replace; directories only onto a free name)."""
        self._step(f"replace {src} -> {dst}")
        os.replace(src, dst)
        self.fsync_dir(os.path.dirname(dst))
        if os.path.dirname(src) != os.path.dirname(dst):
            self.fsync_dir(os.path.dirname(src))

    def remove(self, path):
        if not os.path.lexists(path):
            return
        self._step(f"remove {path}")
        os.remove(path)
        self.fsync_dir(os.path.dirname(path))

    def rmtree(self, path):
        if not os.path.lexists(path):
            return
        self._step(f"rmtree {path}")
        if os.path.islink(path) or not os.path.isdir(path):
            os.remove(path)
        else:
            shutil.rmtree(path)
        self.fsync_dir(os.path.dirname(path))
