"""Compatibility: engine marker groove-engine/1 (Draft 0.3 decision B) and package/engine gates."""
import os
import tempfile
import unittest

from _util import valid, marker, BUILD_ID, CAPS, A10, B10
from groove_package.engine import resolve_marker, check_compat, make_target, parse_marker
from groove_package.errors import InstallError
from groove_package.validator import validate_package

PKG = validate_package(valid(A10))
PKG_B = validate_package(valid(B10))


def tgt(v="0.6.0", c=1, b=BUILD_ID, caps=CAPS):
    return make_target(v, c, b, list(caps), "test")


class Compat(unittest.TestCase):
    def test_matrix(self):
        no_gtl = [c for c in CAPS if c != "timeline.gtl"]
        cases = [
            (PKG, tgt(), None),
            (PKG, tgt("0.6.1"), None),
            (PKG, tgt("0.10.0"), None),           # numeric, not lexicographic
            (PKG, tgt("1.0.0"), None),
            (PKG, tgt("0.5.0"), "ENGINE_NO_PACKAGE_LOADER"),
            (PKG, tgt("0.5.9"), "ENGINE_NO_PACKAGE_LOADER"),
            (PKG, tgt(c=2), "ENGINE_CONTRACT_UNSUPPORTED"),
            (PKG, tgt(b="A" * 40), "ENGINE_UNKNOWN_BUILD"),
            (PKG, tgt(caps=no_gtl), None),         # GTF package does not need timeline.gtl
            (PKG_B, tgt(caps=no_gtl), "ENGINE_MISSING_CAPABILITY"),
            (PKG, tgt(caps=[c for c in CAPS if c != "registry.slots/1"]), "ENGINE_MISSING_CAPABILITY"),
            (PKG, tgt(caps=[c for c in CAPS if c != "package.runtime/1"]), "ENGINE_MISSING_CAPABILITY"),
            (PKG, tgt(caps=[c for c in CAPS if c != "adapter.multi"]), "ENGINE_MISSING_CAPABILITY"),
        ]
        for pkg, t, code in cases:
            with self.subTest((pkg.id[-4:], t.engine_version, t.build_id[:8], t.capabilities, code)):
                if code is None:
                    check_compat(pkg, t)
                else:
                    with self.assertRaises(InstallError) as cm:
                        check_compat(pkg, t)
                    self.assertEqual(cm.exception.code, code)

    def test_engine_min_numeric(self):
        import copy
        p = copy.copy(PKG)
        p.manifest = dict(PKG.manifest, engine_min="0.10.0")
        check_compat(p, tgt("0.10.0"))
        with self.assertRaises(InstallError) as cm:
            check_compat(p, tgt("0.9.9"))
        self.assertEqual(cm.exception.code, "ENGINE_TOO_OLD")

    def test_marker_parsing(self):
        self.assertEqual(parse_marker(marker()).build_id, BUILD_ID)
        bad = [
            marker(build_id="03FF4A3B"),                          # short id no longer accepted
            marker(build_id=BUILD_ID.lower()),                    # uppercase only
            marker(capabilities=["timeline.gtf", "timeline.gtf"]),
            marker(capabilities="timeline.gtf"),
            marker(capabilities=["Timeline.GTF"]),
            marker(engine_version="0.6"),
            marker(engine_contract=True),
            marker(format="groove-engine/2"),
            marker(extra=1),
            b'{"format": "groove-engine/1", "format": "groove-engine/1", "engine_version": "0.6.0", '
            b'"engine_contract": 1, "build_id": "' + BUILD_ID.encode() + b'", "capabilities": []}',
            b"\xef\xbb\xbf" + marker(),
            marker()[:-2] + b" " * 5000 + b"}",                  # > 4 KiB
            b"[" * 10 + b"]" * 10,
        ]
        for b in bad:
            with self.subTest(b[:60]):
                with self.assertRaises(InstallError):
                    parse_marker(b)

    def test_resolution_requires_marker(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(InstallError) as cm:
                resolve_marker(d)
            self.assertEqual(cm.exception.code, "ENGINE_UNKNOWN")
            with open(os.path.join(d, "engine.json"), "wb") as f:
                f.write(marker(engine_version="0.6.2"))
            self.assertEqual(resolve_marker(d).engine_version, "0.6.2")

    @unittest.skipIf(os.name == "nt", "symlinks need privileges on Windows")
    def test_marker_symlink_refused(self):
        with tempfile.TemporaryDirectory() as d:
            real = os.path.join(d, "real.json")
            with open(real, "wb") as f:
                f.write(marker())
            os.symlink(real, os.path.join(d, "engine.json"))
            with self.assertRaises(InstallError) as cm:
                resolve_marker(d)
            self.assertEqual(cm.exception.code, "SYMLINK_REFUSED")


if __name__ == "__main__":
    unittest.main()
