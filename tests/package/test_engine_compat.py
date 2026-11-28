"""Compatibility: engine version / contract / build gates and target resolution (fail closed)."""
import json
import os
import tempfile
import unittest

from _util import valid, A10
from groove_package.engine import resolve_target, check_compat, EngineTarget
from groove_package.errors import InstallError
from groove_package.validator import validate_package

PKG = validate_package(valid(A10))


def tgt(v="0.6.0", c=1, b="03FF4A3B"):
    return EngineTarget(v, c, b, "test")


class Compat(unittest.TestCase):
    def test_matrix(self):
        cases = [
            (tgt(), None),
            (tgt("0.6.1"), None),
            (tgt("1.0.0"), None),
            (tgt("0.10.0"), None),            # numeric, not lexicographic
            (tgt("0.5.0"), "ENGINE_NO_PACKAGE_LOADER"),
            (tgt("0.5.9"), "ENGINE_NO_PACKAGE_LOADER"),
            (tgt(c=2), "ENGINE_CONTRACT_UNSUPPORTED"),
            (tgt(b="0100ABCD"), "ENGINE_UNKNOWN_BUILD"),
        ]
        for t, code in cases:
            with self.subTest(t):
                if code is None:
                    check_compat(PKG, t)
                else:
                    with self.assertRaises(InstallError) as cm:
                        check_compat(PKG, t)
                    self.assertEqual(cm.exception.code, code)

    def test_engine_min_numeric(self):
        import copy
        p = copy.copy(PKG)
        p.manifest = dict(PKG.manifest, engine_min="0.10.0")
        check_compat(p, tgt("0.10.0"))
        with self.assertRaises(InstallError) as cm:
            check_compat(p, tgt("0.9.9"))
        self.assertEqual(cm.exception.code, "ENGINE_TOO_OLD")

    def test_resolution(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(InstallError) as cm:
                resolve_target(d)
            self.assertEqual(cm.exception.code, "ENGINE_UNKNOWN")
            t = resolve_target(d, engine_version="0.6.0", engine_contract=1, build_id="03ff4a3b")
            self.assertEqual(t.build_id, "03FF4A3B")
            with open(os.path.join(d, "engine.json"), "w") as f:
                json.dump({"format": "groove-engine/1", "engine_version": "0.6.2", "engine_contract": 1,
                           "build_id": "03FF4A3B"}, f)
            self.assertEqual(resolve_target(d).engine_version, "0.6.2")
            self.assertEqual(resolve_target(d, engine_version="0.7.0").engine_version, "0.7.0")
            with open(os.path.join(d, "engine.json"), "w") as f:
                json.dump({"format": "groove-engine/1", "engine_version": "0.6.2"}, f)
            with self.assertRaises(InstallError) as cm:
                resolve_target(d)
            self.assertEqual(cm.exception.code, "ENGINE_JSON_INVALID")
            for bad in (dict(build_id="XYZ"), dict(engine_version="0.6")):
                kw = dict(engine_version="0.6.0", engine_contract=1, build_id="03FF4A3B")
                kw.update(bad)
                os.remove(os.path.join(d, "engine.json"))
                with self.assertRaises(InstallError):
                    resolve_target(d, **kw)
                with open(os.path.join(d, "engine.json"), "w") as f:
                    f.write("{}")


if __name__ == "__main__":
    unittest.main()
