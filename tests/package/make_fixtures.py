#!/usr/bin/env python3
"""Deterministically (re)build the GE-155 .groove fixture corpus from fixtures/src/.

  python tests/package/make_fixtures.py          # write fixtures/valid, fixtures/invalid, corpus.json
  python tests/package/make_fixtures.py --check  # verify committed bytes are reproducible

Everything here is original synthetic data: two timing-only levels and
hand-made malformed archives. No game assets, audio, text or binaries.
"""
import hashlib
import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
from groove_package.zipreader import write_canonical  # noqa: E402
from groove_package.vendor import gtf  # noqa: E402

SRC = os.path.join(HERE, "fixtures", "src")
ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
ID_B = "org.groovebuilder.2247d7d8-7f17-4a5f-8a47-be342e2f3844"


def manifest(pid, version, title, fmt="gtf", **over):
    m = {"format": "groove-package/1", "profile": "runtime", "id": pid, "version": version,
         "title": title, "engine_min": "0.6.0", "engine_contract": 1, "adapter": "multi",
         "timeline": {"format": fmt, "path": f"timeline.{fmt}"},
         "required_capabilities": [f"timeline.{fmt}"], "results": "custom"}
    for k, v in over.items():
        if v is DELETE:
            m.pop(k)
        else:
            m[k] = v
    return m


DELETE = object()


def mjson(m):
    return (json.dumps(m, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def read(name):
    with open(os.path.join(SRC, name), "rb") as f:
        return f.read()


def gtl_b():
    tl = gtf.compile_gtf(read("synthetic-b.gtf").decode(), "synthetic-b.gtf")
    lines = [ln for ln in gtf.emit_gtl(tl, "synthetic-b.gtf").split("\n")
             if not ln.startswith("match ") and not ln.startswith("# Generado")]
    lines.insert(1, "# GE-155 synthetic fixture B (original timing data only). Registry assigns the slot: no match line.")
    return "\n".join(lines).encode()


TL_A = read("synthetic-a.gtf")
TL_B = gtl_b()
TL_A11 = TL_A.replace(b"rest 4\nswitch KAERU\nloop 2", b"rest 2\nswitch KAERU\nloop 2")


def pkg(m, tl, fmt="gtf", deflate=True, extra=()):
    return write_canonical([("manifest.json", mjson(m) if isinstance(m, dict) else m),
                            (f"timeline.{fmt}", tl), *extra], deflate=deflate)


def valid():
    return {
        "synthetic-a-1.0.0.groove": pkg(manifest(ID_A, "1.0.0", "Synthetic Pulse A"), TL_A),
        "synthetic-a-1.1.0.groove": pkg(manifest(ID_A, "1.1.0", "Synthetic Pulse A"), TL_A11),
        "synthetic-b-1.0.0.groove": pkg(manifest(ID_B, "1.0.0", "Synthetic Pulse B", "gtl"), TL_B, "gtl", deflate=False),
    }


# --- raw ZIP surgery helpers -------------------------------------------------
def patch_central(z, idx, **fields):
    """Patch fields of the idx-th central header (and optionally local)."""
    z = bytearray(z)
    eocd = len(z) - 22
    off = struct.unpack_from("<I", z, eocd + 16)[0]
    for _ in range(idx):
        nlen, elen, clen = struct.unpack_from("<HHH", z, off + 28)
        off += 46 + nlen + elen + clen
    pos = {"made_by": (4, "H"), "flags": (8, "H"), "method": (10, "H"), "crc": (16, "I"),
           "csize": (20, "I"), "usize": (24, "I"), "external": (38, "I"), "need": (6, "H")}
    for k, v in fields.items():
        o, t = pos[k]
        struct.pack_into("<" + t, z, off + o, v)
    return bytes(z)


def patch_local(z, idx, **fields):
    z = bytearray(z)
    off = 0
    for _ in range(idx):
        nlen, elen = struct.unpack_from("<HH", z, off + 26)
        csize = struct.unpack_from("<I", z, off + 18)[0]
        off += 30 + nlen + elen + csize
    pos = {"flags": (6, "H"), "method": (8, "H"), "crc": (14, "I"), "csize": (18, "I"), "usize": (22, "I")}
    for k, v in fields.items():
        o, t = pos[k]
        struct.pack_into("<" + t, z, off + o, v)
    return bytes(z)


def _rename_local(z, idx, new):
    off = 0
    for _ in range(idx):
        nlen, elen = struct.unpack_from("<HH", z, off + 26)
        off += 30 + nlen + elen + struct.unpack_from("<I", z, off + 18)[0]
    nlen = struct.unpack_from("<H", z, off + 26)[0]
    assert len(new) == nlen
    return z[:off + 30] + new + z[off + 30 + nlen:]


def both(z, idx, **f):
    return patch_local(patch_central(z, idx, **f), idx, **f)


def raw_zip(entries):
    """entries: list of (name_bytes, body, dict(method, flags, crc, usize, external, made_by, extra))."""
    out, cen = bytearray(), bytearray()
    for name, body, o in entries:
        method = o.get("method", 0)
        comp = o.get("comp", body)
        crc = o.get("crc", zlib.crc32(body) & 0xFFFFFFFF)
        usize = o.get("usize", len(body))
        flags = o.get("flags", 0)
        extra = o.get("extra", b"")
        off = len(out)
        out += struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flags, method, 0, 0x21, crc, len(comp), usize,
                           len(name), len(extra)) + name + extra + comp
        cen += struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, o.get("made_by", (3 << 8) | 20), 20, flags, method,
                           0, 0x21, crc, len(comp), usize, len(name), len(extra), 0, 0, 0,
                           o.get("external", 0o100644 << 16), off) + name + extra
    cd = len(out)
    out += cen + struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(entries), len(entries), len(cen), cd, 0)
    return bytes(out)


def deflate(b):
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(b) + c.flush()


def invalid():
    mA = manifest(ID_A, "1.0.0", "Synthetic Pulse A")
    good = pkg(mA, TL_A)
    stored = pkg(mA, TL_A, deflate=False)
    M = mjson(mA)
    cases = {}

    def add(name, code, data):
        cases[name] = (code, data)

    # --- archive structure
    add("truncated", "ZIP_TRUNCATED", good[:40])
    add("not-a-zip", "ZIP_TRUNCATED", b"GTLM 1\n" * 10)
    add("prepended-data", "ZIP_LAYOUT", b"MZ" + b"\0" * 62 + good)  # offsets no longer match
    add("trailing-data", "ZIP_TRAILING_DATA", good + b"junk")
    add("archive-comment", "ZIP_TRAILING_DATA", good[:-2] + struct.pack("<H", 4) + b"hey!")
    add("empty-archive", "ZIP_EMPTY", struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 0, 0, 0, 0, 0))
    add("multidisk", "ZIP_MULTIDISK", good[:-22 + 4] + struct.pack("<H", 1) + good[-22 + 6:])
    add("traversal", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"../timeline.gtf", TL_A, {})]))
    add("traversal-nested", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"a/../../evil.gtf", TL_A, {})]))
    add("absolute-path", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"/groove/levels/x.gtf", TL_A, {})]))
    add("backslash", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"..\\timeline.gtf", TL_A, {})]))
    add("drive-letter", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"C:timeline.gtf", TL_A, {})]))
    add("dos-device", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"aux.gtf", TL_A, {})]))
    add("trailing-dot", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"timeline.gtf.", TL_A, {})]))
    add("control-char-name", "ZIP_UNSAFE_PATH", raw_zip([(b"manifest.json", M, {}), (b"time\x01line.gtf", TL_A, {})]))
    add("non-utf8-name", "ZIP_BAD_NAME", raw_zip([(b"manifest.json", M, {}), (b"timeline\xff.gtf", TL_A, {})]))
    add("directory-entry", "ZIP_UNSAFE_PATH", raw_zip([(b"levels/", b"", {}), (b"manifest.json", M, {})]))
    add("duplicate-member", "ZIP_DUPLICATE", raw_zip([(b"manifest.json", M, {}), (b"manifest.json", M, {}),
                                                     (b"timeline.gtf", TL_A, {})]))
    add("case-collision", "ZIP_CASE_COLLISION", raw_zip([(b"manifest.json", M, {}), (b"Manifest.json", M, {}),
                                                         (b"timeline.gtf", TL_A, {})]))
    add("symlink", "ZIP_SYMLINK", raw_zip([(b"manifest.json", M, {}),
                                           (b"timeline.gtf", b"/etc/passwd", {"external": 0o120777 << 16})]))
    add("dos-directory-attr", "ZIP_NOT_FILE", raw_zip([(b"manifest.json", M, {}),
                                                      (b"timeline.gtf", TL_A, {"made_by": 20, "external": 0x10})]))
    add("encrypted", "ZIP_ENCRYPTED", both(stored, 1, flags=1))
    add("bad-method", "ZIP_BAD_METHOD", both(stored, 1, method=12))
    add("bad-flags", "ZIP_BAD_FLAGS", both(stored, 1, flags=0x0020))
    add("zip64-extra", "ZIP_ZIP64", raw_zip([(b"manifest.json", M, {}),
                                             (b"timeline.gtf", TL_A, {"extra": struct.pack("<HH", 1, 0)})]))
    add("unknown-extra", "ZIP_BAD_EXTRA", raw_zip([(b"manifest.json", M, {}),
                                                   (b"timeline.gtf", TL_A, {"extra": struct.pack("<HH4s", 0x9901, 4, b"AExx")})]))
    add("local-central-crc-mismatch", "ZIP_HEADER_MISMATCH", patch_local(stored, 1, crc=0x1234))
    add("local-central-name-mismatch", "ZIP_HEADER_MISMATCH",
        _rename_local(stored, 1, b"timeline.gtx"))
    add("crc-mismatch", "ZIP_CRC", both(stored, 1, crc=0xDEADBEEF))
    add("stored-size-mismatch", "ZIP_LENGTH", patch_central(stored, 1, usize=len(TL_A) + 1))
    big = b"#" * 200 + b"\n"
    add("bomb-lying-size", "ZIP_BOMB", raw_zip([(b"manifest.json", M, {}),
                                                (b"timeline.gtf", big * 5000, {"method": 8, "comp": deflate(big * 5000),
                                                                               "usize": 4000})]))
    add("bomb-declared-huge", "ZIP_MEMBER_TOO_LARGE", raw_zip([(b"manifest.json", M, {}),
                                                               (b"timeline.gtf", big * 5000,
                                                                {"method": 8, "comp": deflate(big * 5000)})]))
    add("bomb-total-declared", "ZIP_BOMB", raw_zip([(b"manifest.json", M, {})] +
                                                   [(f"x{i}.gtf".encode(), b"", {"method": 8, "comp": deflate(b""), "usize": 0x7FFFFFFF})
                                                    for i in range(2)]))
    add("corrupt-deflate", "ZIP_CORRUPT", raw_zip([(b"manifest.json", M, {}),
                                                   (b"timeline.gtf", TL_A, {"method": 8, "comp": b"\xff" * 40})]))
    add("deflate-trailing-bytes", "ZIP_CORRUPT", raw_zip([(b"manifest.json", M, {}),
                                                          (b"timeline.gtf", TL_A, {"method": 8, "comp": deflate(TL_A) + b"xx"})]))
    add("too-many-members", "ZIP_TOO_MANY", raw_zip([(f"f{i}.txt".encode(), b"", {}) for i in range(257)]))
    # --- content policy / member set
    add("extra-member", "UNEXPECTED_MEMBER", pkg(mA, TL_A, extra=[("icon.txt", b"synthetic")]))
    add("second-timeline", "UNEXPECTED_MEMBER", pkg(mA, TL_A, extra=[("timeline.gtl", TL_B)]))
    add("missing-manifest", "MANIFEST_MISSING", write_canonical([("timeline.gtf", TL_A)]))
    add("missing-timeline", "TIMELINE_MISSING", write_canonical([("manifest.json", M)]))
    add("audio-asset", "FORBIDDEN_CONTENT", pkg(mA, TL_A, extra=[("song.bwav", b"synthetic")]))
    add("game-text", "FORBIDDEN_CONTENT", pkg(mA, TL_A, extra=[("x.msbt", b"synthetic")]))
    add("romfs-path", "FORBIDDEN_CONTENT", pkg(mA, TL_A, extra=[("romfs/readme.txt", b"synthetic")]))
    add("exefs-main", "FORBIDDEN_CONTENT", pkg(mA, TL_A, extra=[("main", b"synthetic")]))
    add("native-patch", "FORBIDDEN_CONTENT", pkg(mA, TL_A, extra=[("x.ips", b"PATCHEOF")]))
    add("nested-archive", "FORBIDDEN_CONTENT", pkg(mA, TL_A, extra=[("inner.zip", good)]))
    add("rhref", "FORBIDDEN_CONTENT", pkg(mA, TL_A, extra=[("ref.rhref", b"synthetic")]))
    # --- manifest
    def mcase(name, code, raw_or_dict, tl=TL_A, fmt="gtf"):
        add(name, code, pkg(raw_or_dict, tl, fmt))
    mcase("editor-profile", "NOT_RUNTIME_PROFILE", manifest(ID_A, "1.0.0", "A", profile="editor"))
    mcase("bad-format", "MANIFEST_FORMAT", manifest(ID_A, "1.0.0", "A", format="groove-package/2"))
    mcase("missing-key", "MANIFEST_MISSING_KEY", manifest(ID_A, "1.0.0", "A", results=DELETE))
    mcase("unknown-key", "MANIFEST_UNKNOWN_KEY", manifest(ID_A, "1.0.0", "A", match=[0, 9, 0]))
    mcase("duplicate-key", "MANIFEST_DUPLICATE_KEY", M.replace(b'"title"', b'"title": "x",\n  "title"', 1))
    mcase("bom", "MANIFEST_UTF8", b"\xef\xbb\xbf" + M)
    mcase("invalid-utf8", "MANIFEST_UTF8", M.replace(b"Synthetic", b"Synth\xc3\x28tic"))
    mcase("lone-surrogate", "MANIFEST_UTF8", M.replace(b"Synthetic", b"Synth\\ud800etic"))
    mcase("nan", "MANIFEST_JSON", M.replace(b'"engine_contract": 1', b'"engine_contract": NaN'))
    mcase("not-json", "MANIFEST_JSON", b"{format: groove}")
    mcase("too-deep", "MANIFEST_DEPTH", b"[" * 40 + b"]" * 40)
    mcase("manifest-too-large", "ZIP_MEMBER_TOO_LARGE", M[:-2] + b"," + b" " * 17000 + b"}\n")
    mcase("id-uppercase", "MANIFEST_BAD_ID", manifest("Org.Example.Demo", "1.0.0", "A"))
    mcase("id-traversal", "MANIFEST_BAD_ID", manifest("../../atmosphere", "1.0.0", "A"))
    mcase("id-no-dot", "MANIFEST_BAD_ID", manifest("demo", "1.0.0", "A"))
    mcase("id-dos-device", "MANIFEST_BAD_ID", manifest("con.example", "1.0.0", "A"))
    mcase("id-too-long", "MANIFEST_BAD_ID", manifest("a." + "b" * 95, "1.0.0", "A"))
    mcase("id-not-string", "MANIFEST_BAD_ID", manifest(123, "1.0.0", "A"))
    mcase("version-leading-zero", "MANIFEST_BAD_VERSION", manifest(ID_A, "01.0.0", "A"))
    mcase("version-two-parts", "MANIFEST_BAD_VERSION", manifest(ID_A, "1.0", "A"))
    mcase("version-prerelease", "MANIFEST_BAD_VERSION", manifest(ID_A, "1.0.0-beta", "A"))
    mcase("engine-min-bad", "MANIFEST_BAD_VERSION", manifest(ID_A, "1.0.0", "A", engine_min="v0.6"))
    mcase("title-too-long", "MANIFEST_BAD_TITLE", manifest(ID_A, "1.0.0", "é" * 48))
    mcase("title-control", "MANIFEST_BAD_TITLE", manifest(ID_A, "1.0.0", "A\nB"))
    mcase("title-blank", "MANIFEST_BAD_TITLE", manifest(ID_A, "1.0.0", "   "))
    mcase("title-empty", "MANIFEST_BAD_TITLE", manifest(ID_A, "1.0.0", ""))
    mcase("contract-2", "ENGINE_CONTRACT_UNSUPPORTED", manifest(ID_A, "1.0.0", "A", engine_contract=2))
    mcase("contract-bool", "MANIFEST_SCHEMA", manifest(ID_A, "1.0.0", "A", engine_contract=True))
    mcase("adapter-hoop", "UNSUPPORTED_ADAPTER", manifest(ID_A, "1.0.0", "A", adapter="hoop"))
    mcase("timeline-path-mismatch", "TIMELINE_PATH_MISMATCH",
          manifest(ID_A, "1.0.0", "A", timeline={"format": "gtf", "path": "timeline.gtl"}))
    mcase("timeline-path-traversal", "TIMELINE_PATH_MISMATCH",
          manifest(ID_A, "1.0.0", "A", timeline={"format": "gtf", "path": "../timeline.gtf"}))
    mcase("timeline-format-gtl1", "UNSUPPORTED_TIMELINE",
          manifest(ID_A, "1.0.0", "A", timeline={"format": "gtl1", "path": "timeline.gtl"}))
    mcase("timeline-extra-key", "MANIFEST_SCHEMA",
          manifest(ID_A, "1.0.0", "A", timeline={"format": "gtf", "path": "timeline.gtf", "x": 1}))
    mcase("capability-mismatch", "CAPABILITY_MISMATCH", manifest(ID_A, "1.0.0", "A", required_capabilities=["timeline.gtl"]))
    mcase("capability-extra", "CAPABILITY_MISMATCH",
          manifest(ID_A, "1.0.0", "A", required_capabilities=["timeline.gtf", "audio.custom"]))
    mcase("results-native", "NATIVE_RESULTS", manifest(ID_A, "1.0.0", "A", results="native"))
    # --- timeline
    def tcase(name, code, tl, fmt="gtf"):
        add(name, code, pkg(manifest(ID_A, "1.0.0", "Synthetic Pulse A", fmt), tl, fmt))
    tcase("tl-explicit-match", "TIMELINE_MATCH", TL_A.replace(b"start 0\n", b"start 0\nmatch -1 9 4\n"))
    tcase("tl-no-start", "TIMELINE_NO_START", TL_A.replace(b"start 0\n", b""))
    tcase("tl-no-results", "TIMELINE_NO_RESULTS", TL_A.replace(b"results exit\n", b""))
    tcase("tl-results-native", "NATIVE_RESULTS", TL_A.replace(b"results exit", b"results native"))
    tcase("tl-syntax", "TIMELINE_INVALID", TL_A + b"\nnotacue basic\n")
    tcase("tl-unverified-args", "TIMELINE_INVALID", TL_A.replace(b"frog5 basic", b"KAERU.0x1B8DB0 9 9 9 9"))
    tcase("tl-raw-address", "TIMELINE_INVALID", TL_A.replace(b"frog5 basic", b"KAERU.0xDEAD00 0 0 0 0"))
    tcase("tl-empty", "TIMELINE_SIZE", b"")
    tcase("tl-oversize", "ZIP_MEMBER_TOO_LARGE", TL_A + b"#" * (61440 - len(TL_A) + 1))
    tcase("tl-bom", "TIMELINE_UTF8", b"\xef\xbb\xbf" + TL_A)
    tcase("tl-invalid-utf8", "TIMELINE_UTF8", TL_A.replace(b"Synthetic", b"Synth\xff", 1))
    tcase("tl-long-line", "TIMELINE_INVALID", TL_A + b"# " + b"x" * 300 + b"\n")
    tcase("tl-too-many-lines", "TIMELINE_INVALID", TL_A + b"\n" * 4100)
    tcase("tl-expansion", "TIMELINE_INVALID", TL_A.replace(b"loop 2", b"loop 40000"))
    tcase("gtl-legacy-gtl1", "UNSUPPORTED_TIMELINE", b"GTL1\nstart 0\nresults exit\n", "gtl")
    tcase("gtl-no-header", "TIMELINE_INVALID", TL_B.replace(b"GTLM 1\n", b""), "gtl")
    tcase("gtl-match", "TIMELINE_MATCH", TL_B.replace(b"start 0\n", b"start 0\nmatch -1 9 4\n"), "gtl")
    tcase("gtl-no-start", "TIMELINE_NO_START", TL_B.replace(b"start 0\n", b""), "gtl")
    tcase("gtl-as-gtf", "TIMELINE_INVALID", TL_B)
    return cases


def build():
    out = {"valid": {}, "invalid": {}}
    for n, b in valid().items():
        out["valid"][n] = b
    for n, (code, b) in invalid().items():
        out["invalid"][n + ".groove"] = (code, b)
    return out


def main(argv):
    check = "--check" in argv
    root = os.path.join(HERE, "fixtures")
    data = build()
    corpus = {"note": "GE-155 synthetic corpus (DRAFT 0.2). Expected codes are installer codes; other "
                      "implementations should at least reject every invalid entry.",
              "ids": {"A": ID_A, "B": ID_B}, "valid": {}, "invalid": {}}
    files = {}
    for n, b in data["valid"].items():
        files[os.path.join("valid", n)] = b
        corpus["valid"][n] = hashlib.sha256(b).hexdigest()
    for n, (code, b) in sorted(data["invalid"].items()):
        files[os.path.join("invalid", n)] = b
        corpus["invalid"][n] = {"expect": code, "sha256": hashlib.sha256(b).hexdigest()}
    files["src/synthetic-b.gtl"] = TL_B
    files["corpus.json"] = (json.dumps(corpus, indent=2, sort_keys=True) + "\n").encode()
    bad = 0
    for rel, b in sorted(files.items()):
        p = os.path.join(root, rel)
        if check:
            try:
                with open(p, "rb") as f:
                    same = f.read() == b
            except FileNotFoundError:
                same = False
            if not same:
                print("MISMATCH", rel)
                bad += 1
        else:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as f:
                f.write(b)
    if check:
        expected = set(files)
        for sub in ("valid", "invalid"):
            for n in os.listdir(os.path.join(root, sub)):
                if os.path.join(sub, n) not in expected:
                    print("STALE", sub, n)
                    bad += 1
        print(f"{len(files)} fixture files checked, {bad} mismatches")
        return 1 if bad else 0
    print(f"wrote {len(files)} files ({len(data['valid'])} valid, {len(data['invalid'])} invalid)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
