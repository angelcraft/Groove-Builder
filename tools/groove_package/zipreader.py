"""Strict, bounded ZIP reader for .groove containers (GE-154 Draft 0.2, archive checks).

Inspects the original central directory AND every local header before any
data is used; never trusts declared sizes; streams deflate with a hard output
cap; verifies CRC-32 and actual length. Python's zipfile is deliberately not
used because it tolerates duplicates, prepended data, gaps and mismatched
local/central headers.
"""
import stat
import struct
import zlib

from . import limits
from .errors import PackageError
from .safepath import member_name_problem, fold

SIG_LOCAL = 0x04034B50
SIG_CENTRAL = 0x02014B50
SIG_EOCD = 0x06054B50
SIG_ZIP64_EOCD = 0x06064B50
SIG_ZIP64_LOC = 0x07064B50
SIG_DD = 0x08074B50

FLAG_ENCRYPTED = 0x0001
FLAG_DATA_DESCRIPTOR = 0x0008
FLAG_UTF8 = 0x0800
# bit 1/2 are deflate speed hints (harmless); everything else (encryption,
# patched data, strong encryption, masked headers, reserved) is refused.
ALLOWED_FLAGS = FLAG_DATA_DESCRIPTOR | FLAG_UTF8 | 0x0002 | 0x0004
ALLOWED_METHODS = (0, 8)
# Extra fields that carry only timestamps/ownership. ZIP64 (0x0001) and
# anything unknown is rejected.
ALLOWED_EXTRA = {0x5455, 0x7875, 0x000A, 0x5855}

_EOCD = struct.Struct("<IHHHHIIH")
_CEN = struct.Struct("<IHHHHHHIIIHHHHHII")
_LOC = struct.Struct("<IHHHHHIIIHH")


class Member:
    __slots__ = ("name", "method", "flags", "crc", "csize", "usize",
                 "offset", "data_start", "end", "external", "made_by")

    def __repr__(self):
        return f"Member({self.name!r}, method={self.method}, usize={self.usize})"


def _parse_extra(buf: bytes, name: str):
    i = 0
    while i < len(buf):
        if i + 4 > len(buf):
            raise PackageError("ZIP_BAD_EXTRA", "truncated extra field", name)
        hid, ln = struct.unpack_from("<HH", buf, i)
        if hid == 0x0001:
            raise PackageError("ZIP_ZIP64", "ZIP64 is not supported", name)
        if hid not in ALLOWED_EXTRA:
            raise PackageError("ZIP_BAD_EXTRA", f"unsupported extra field 0x{hid:04X}", name)
        i += 4 + ln
        if i > len(buf):
            raise PackageError("ZIP_BAD_EXTRA", "truncated extra field", name)


def _decode_name(raw: bytes, flags: int) -> str:
    try:
        if flags & FLAG_UTF8:
            return raw.decode("utf-8")
        name = raw.decode("ascii")  # CP437 vs UTF-8 is ambiguous: require ASCII or the UTF-8 flag
        return name
    except UnicodeDecodeError:
        raise PackageError("ZIP_BAD_NAME", "member name is not valid UTF-8/ASCII") from None


def read_members(data: bytes, max_entries: int = limits.MAX_ENTRIES_AUTHORING):
    """Parse and cross-check the archive structure. Returns [Member] in archive order."""
    n = len(data)
    if n > limits.MAX_ARCHIVE_BYTES:
        raise PackageError("ZIP_TOO_LARGE", f"archive is {n} bytes (> {limits.MAX_ARCHIVE_BYTES})")
    if n < _EOCD.size:
        raise PackageError("ZIP_TRUNCATED", "too small to be a ZIP archive")
    # EOCD must be the last 22 bytes (canonical: no archive comment).
    eocd_at = n - _EOCD.size
    sig, disk, cd_disk, n_disk, n_total, cd_size, cd_off, clen = _EOCD.unpack_from(data, eocd_at)
    if sig != SIG_EOCD or clen != 0:
        if data.rfind(struct.pack("<I", SIG_EOCD)) < 0:
            raise PackageError("ZIP_TRUNCATED", "end of central directory not found")
        raise PackageError("ZIP_TRAILING_DATA", "archive comment or trailing data after the central directory")
    if disk != 0 or cd_disk != 0 or n_disk != n_total:
        raise PackageError("ZIP_MULTIDISK", "multi-disk archives are not supported")
    if 0xFFFF in (n_disk, n_total) or 0xFFFFFFFF in (cd_size, cd_off):
        raise PackageError("ZIP_ZIP64", "ZIP64 is not supported")
    if eocd_at >= 20 and struct.unpack_from("<I", data, eocd_at - 20)[0] == SIG_ZIP64_LOC:
        raise PackageError("ZIP_ZIP64", "ZIP64 locator present")
    if n_total == 0:
        raise PackageError("ZIP_EMPTY", "archive has no members")
    if n_total > max_entries:
        raise PackageError("ZIP_TOO_MANY", f"{n_total} members (> {max_entries})")
    if cd_off + cd_size != eocd_at:
        raise PackageError("ZIP_LAYOUT", "central directory does not end at EOCD (gap, overlap or truncation)")

    members, names, folded = [], set(), set()
    p = cd_off
    total_declared = 0
    for idx in range(n_total):
        if p + _CEN.size > eocd_at:
            raise PackageError("ZIP_TRUNCATED", "central directory truncated")
        (sig, made_by, need, flags, method, mtime, mdate, crc, csize, usize,
         nlen, elen, clen2, dstart, iattr, eattr, loff) = _CEN.unpack_from(data, p)
        if sig != SIG_CENTRAL:
            raise PackageError("ZIP_LAYOUT", "bad central directory signature")
        p += _CEN.size
        if p + nlen + elen + clen2 > eocd_at:
            raise PackageError("ZIP_TRUNCATED", "central directory entry truncated")
        raw_name = data[p:p + nlen]
        extra = data[p + nlen:p + nlen + elen]
        p += nlen + elen + clen2
        if nlen == 0 or nlen > limits.MAX_NAME_BYTES:
            raise PackageError("ZIP_BAD_NAME", "member name length out of range")
        name = _decode_name(raw_name, flags)
        why = member_name_problem(name)
        if why:
            raise PackageError("ZIP_UNSAFE_PATH", why, name)
        if name in names:
            raise PackageError("ZIP_DUPLICATE", "duplicate member", name)
        if fold(name) in folded:
            raise PackageError("ZIP_CASE_COLLISION", "member collides by case/normalization", name)
        names.add(name)
        folded.add(fold(name))
        if flags & FLAG_ENCRYPTED or flags & 0x0040 or flags & 0x2000:
            raise PackageError("ZIP_ENCRYPTED", "encrypted members are not allowed", name)
        if flags & ~ALLOWED_FLAGS:
            raise PackageError("ZIP_BAD_FLAGS", f"unsupported general purpose flags 0x{flags:04X}", name)
        if method not in ALLOWED_METHODS:
            raise PackageError("ZIP_BAD_METHOD", f"compression method {method} not allowed", name)
        if need > 20:
            raise PackageError("ZIP_BAD_VERSION", f"needs ZIP version {need / 10}", name)
        if dstart != 0:
            raise PackageError("ZIP_MULTIDISK", "member on another disk", name)
        if 0xFFFFFFFF in (csize, usize, loff):
            raise PackageError("ZIP_ZIP64", "ZIP64 sizes", name)
        _parse_extra(extra, name)
        host = made_by >> 8
        if host == 3:  # Unix: reject symlinks, devices, FIFOs, directories
            mode = eattr >> 16
            if mode and not stat.S_ISREG(mode):
                kind = "symlink" if stat.S_ISLNK(mode) else "non-regular file"
                raise PackageError("ZIP_SYMLINK" if stat.S_ISLNK(mode) else "ZIP_NOT_FILE", kind, name)
        if eattr & 0x10:
            raise PackageError("ZIP_NOT_FILE", "directory attribute", name)
        if method == 0 and csize != usize:
            raise PackageError("ZIP_LENGTH", "stored member with csize != usize", name)
        total_declared += usize
        if total_declared > limits.MAX_TOTAL_EXPANDED:
            raise PackageError("ZIP_BOMB", "declared expanded size exceeds limit", name)
        m = Member()
        m.name, m.method, m.flags, m.crc, m.csize, m.usize = name, method, flags, crc, csize, usize
        m.offset, m.external, m.made_by = loff, eattr, made_by
        members.append(m)
    if p != eocd_at:
        raise PackageError("ZIP_LAYOUT", "central directory size mismatch")

    # Local headers: must match the central directory exactly and tile the
    # data area [0, cd_off) without gaps, overlaps or prepended bytes.
    expect = 0
    for m in sorted(members, key=lambda x: x.offset):
        if m.offset != expect:
            raise PackageError("ZIP_LAYOUT", "gap, overlap or prepended data before member", m.name)
        if m.offset + _LOC.size > cd_off:
            raise PackageError("ZIP_TRUNCATED", "local header truncated", m.name)
        (sig, need, flags, method, mtime, mdate, crc, csize, usize, nlen, elen) = _LOC.unpack_from(data, m.offset)
        if sig != SIG_LOCAL:
            raise PackageError("ZIP_LAYOUT", "bad local header signature", m.name)
        ls = m.offset + _LOC.size
        if ls + nlen + elen > cd_off:
            raise PackageError("ZIP_TRUNCATED", "local header truncated", m.name)
        if data[ls:ls + nlen] != m.name.encode("utf-8" if m.flags & FLAG_UTF8 else "ascii"):
            raise PackageError("ZIP_HEADER_MISMATCH", "local name differs from central directory", m.name)
        if flags != m.flags or method != m.method:
            raise PackageError("ZIP_HEADER_MISMATCH", "local flags/method differ from central directory", m.name)
        _parse_extra(data[ls + nlen:ls + nlen + elen], m.name)
        if flags & FLAG_DATA_DESCRIPTOR:
            if (crc, csize, usize) not in ((0, 0, 0), (m.crc, m.csize, m.usize)):
                raise PackageError("ZIP_HEADER_MISMATCH", "local sizes/CRC differ from central directory", m.name)
        elif (crc, csize, usize) != (m.crc, m.csize, m.usize):
            raise PackageError("ZIP_HEADER_MISMATCH", "local sizes/CRC differ from central directory", m.name)
        m.data_start = ls + nlen + elen
        end = m.data_start + m.csize
        if end > cd_off:
            raise PackageError("ZIP_TRUNCATED", "member data truncated", m.name)
        if flags & FLAG_DATA_DESCRIPTOR:
            if end + 4 <= cd_off and struct.unpack_from("<I", data, end)[0] == SIG_DD:
                end += 4
            if end + 12 > cd_off:
                raise PackageError("ZIP_TRUNCATED", "data descriptor truncated", m.name)
            if struct.unpack_from("<III", data, end) != (m.crc, m.csize, m.usize):
                raise PackageError("ZIP_HEADER_MISMATCH", "data descriptor differs from central directory", m.name)
            end += 12
        m.end = end
        expect = end
    if expect != cd_off:
        raise PackageError("ZIP_LAYOUT", "unreferenced data before the central directory")
    return members


def extract(data: bytes, m: Member, cap: int) -> bytes:
    """Decompress one member with a hard output cap; verify actual length and CRC."""
    if m.usize > cap:
        raise PackageError("ZIP_MEMBER_TOO_LARGE", f"declared {m.usize} bytes (> {cap})", m.name)
    comp = data[m.data_start:m.data_start + m.csize]
    if m.method == 0:
        out = comp
    else:
        d = zlib.decompressobj(-15)
        chunks, total = [], 0
        view = memoryview(comp)
        step = 64 * 1024
        try:
            for i in range(0, len(view), step):
                buf = view[i:i + step]
                while True:
                    piece = d.decompress(buf, cap + 1 - total)
                    total += len(piece)
                    chunks.append(piece)
                    if total > cap or total > m.usize:
                        raise PackageError("ZIP_BOMB", "actual expansion exceeds declared size or limit", m.name)
                    buf = d.unconsumed_tail
                    if not buf:
                        break
            tail = d.flush(cap + 1 - total)
        except zlib.error as e:
            raise PackageError("ZIP_CORRUPT", f"deflate error: {e}", m.name) from None
        total += len(tail)
        chunks.append(tail)
        if total > cap or total > m.usize:
            raise PackageError("ZIP_BOMB", "actual expansion exceeds declared size or limit", m.name)
        if not d.eof or d.unused_data:
            raise PackageError("ZIP_CORRUPT", "deflate stream incomplete or followed by extra bytes", m.name)
        out = b"".join(chunks)
    if len(out) != m.usize:
        raise PackageError("ZIP_LENGTH", f"actual length {len(out)} != declared {m.usize}", m.name)
    if zlib.crc32(out) & 0xFFFFFFFF != m.crc:
        raise PackageError("ZIP_CRC", "CRC-32 mismatch", m.name)
    return out


def write_canonical(files, deflate: bool = True) -> bytes:
    """Deterministic writer used for fixtures: fixed order, 1980-01-01 timestamps,
    UTF-8 flag only when needed, no extra fields, no comments."""
    out = bytearray()
    cen = bytearray()
    for name, body in files:
        raw = name.encode("utf-8")
        flags = 0 if raw.isascii() else FLAG_UTF8
        crc = zlib.crc32(body) & 0xFFFFFFFF
        if deflate:
            c = zlib.compressobj(9, zlib.DEFLATED, -15)
            comp = c.compress(body) + c.flush()
            method = 8
        else:
            comp, method = body, 0
        off = len(out)
        out += _LOC.pack(SIG_LOCAL, 20, flags, method, 0, 0x21, crc, len(comp), len(body), len(raw), 0) + raw + comp
        cen += _CEN.pack(SIG_CENTRAL, (3 << 8) | 20, 20, flags, method, 0, 0x21, crc, len(comp), len(body),
                         len(raw), 0, 0, 0, 0, (0o100644 << 16), off) + raw
    cd_off = len(out)
    out += cen
    out += _EOCD.pack(SIG_EOCD, 0, 0, len(files), len(files), len(cen), cd_off, 0)
    return bytes(out)
