"""Link-safe, bounded filesystem reads and checks (no symlinks, junctions or reparse points).

Pure stdlib; `stat.FILE_ATTRIBUTE_REPARSE_POINT` is only consulted where the
platform reports it (Windows), so the module works unchanged on Android/Linux.
"""
import os
import stat

from .errors import InstallError

_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def is_link_like(st) -> bool:
    if stat.S_ISLNK(st.st_mode):
        return True
    return bool(getattr(st, "st_file_attributes", 0) & _REPARSE)


def lstat_or_none(path):
    try:
        return os.lstat(path)
    except FileNotFoundError:
        return None


def check_chain(root, path):
    """Refuse if root or any existing component between root and path is a link/junction."""
    root = os.path.abspath(root)
    path = os.path.abspath(path)
    rel = os.path.relpath(path, root)
    if rel == os.curdir:
        parts = []
    else:
        parts = rel.split(os.sep)
        if parts[0] == os.pardir or os.path.isabs(rel):
            raise InstallError("PATH_ESCAPE", f"{path} is outside {root}")
    cur = root
    for comp in [None] + parts:
        if comp is not None:
            cur = os.path.join(cur, comp)
        st = lstat_or_none(cur)
        if st is None:
            return
        if is_link_like(st):
            raise InstallError("SYMLINK_REFUSED", f"{cur} is a symlink/junction/reparse point")


def check_tree(path):
    """Refuse if anything inside an existing directory tree is a link/junction or not a file/dir."""
    st = lstat_or_none(path)
    if st is None:
        return
    if is_link_like(st):
        raise InstallError("SYMLINK_REFUSED", f"{path} is a symlink/junction/reparse point")
    if not stat.S_ISDIR(st.st_mode):
        if not stat.S_ISREG(st.st_mode):
            raise InstallError("NOT_REGULAR", f"{path} is not a regular file")
        return
    for d, dirs, files in os.walk(path, followlinks=False):
        for n in dirs + files:
            p = os.path.join(d, n)
            s = os.lstat(p)
            if is_link_like(s):
                raise InstallError("SYMLINK_REFUSED", f"{p} is a symlink/junction/reparse point")
            if not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)):
                raise InstallError("NOT_REGULAR", f"{p} is not a regular file or directory")


def read_bounded(path, cap, code="FILE_TOO_LARGE"):
    """Read a regular, non-link file of at most `cap` bytes."""
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    st = lstat_or_none(path)
    if st is None:
        raise FileNotFoundError(path)
    if is_link_like(st):
        raise InstallError("SYMLINK_REFUSED", f"{path} is a symlink/junction/reparse point")
    fd = os.open(path, flags)
    try:
        fst = os.fstat(fd)
        if not stat.S_ISREG(fst.st_mode):
            raise InstallError("NOT_REGULAR", f"{path} is not a regular file")
        if fst.st_size > cap:
            raise InstallError(code, f"{path} is {fst.st_size} bytes (> {cap})")
        chunks, total = [], 0
        while True:
            b = os.read(fd, min(65536, cap + 1 - total))
            if not b:
                break
            chunks.append(b)
            total += len(b)
            if total > cap:
                raise InstallError(code, f"{path} grew beyond {cap} bytes")
        return b"".join(chunks)
    finally:
        os.close(fd)
