"""Compatibility: our manifest checks agree with the GE-154 draft JSON Schema (structure) and add the semantic rules."""
import copy
import json
import os
import unittest

from _util import REPO, valid, A10
from groove_package.errors import PackageError
from groove_package.manifest import validate_manifest, load_json_strict
from groove_package.validator import validate_package

SCHEMA = os.path.join(REPO, "tools", "groove_package", "vendor", "groove-runtime-manifest.draft.schema.json")
try:
    import jsonschema
except ImportError:  # optional dev dependency; the installer itself is stdlib-only
    jsonschema = None

BASE = validate_package(valid(A10)).manifest

MUTATIONS = {
    "ok": lambda m: m,
    "gtl": lambda m: m.update(timeline={"format": "gtl", "path": "timeline.gtl"}, required_capabilities=["timeline.gtl"]),
    "no-format": lambda m: m.pop("format"),
    "format-2": lambda m: m.update(format="groove-package/2"),
    "profile-editor": lambda m: m.update(profile="editor"),
    "extra-key": lambda m: m.update(icon="icon.png"),
    "id-upper": lambda m: m.update(id="Org.X.Y"),
    "id-short": lambda m: m.update(id="a."),
    "id-nodot": lambda m: m.update(id="abc"),
    "id-dash-end": lambda m: m.update(id="org.x-"),
    "id-long": lambda m: m.update(id="a." + "b" * 95),
    "version-lead0": lambda m: m.update(version="1.02.0"),
    "version-10digits": lambda m: m.update(version="1234567890.0.0"),
    "version-int": lambda m: m.update(version=1),
    "title-empty": lambda m: m.update(title=""),
    "title-ctrl": lambda m: m.update(title="a\tb"),
    "title-long-chars": lambda m: m.update(title="x" * 96),
    "contract-2": lambda m: m.update(engine_contract=2),
    "contract-str": lambda m: m.update(engine_contract="1"),
    "adapter-hoop": lambda m: m.update(adapter="hoop"),
    "tl-gtf-at-gtl": lambda m: m.update(timeline={"format": "gtf", "path": "timeline.gtl"}),
    "tl-extra": lambda m: m.update(timeline={"format": "gtf", "path": "timeline.gtf", "sha": "x"}),
    "caps-mismatch": lambda m: m.update(required_capabilities=["timeline.gtl"]),
    "caps-two": lambda m: m.update(required_capabilities=["timeline.gtf", "timeline.gtf"]),
    "results-native": lambda m: m.update(results="native"),
}


def ours(m):
    try:
        validate_manifest(m)
        return True
    except PackageError:
        return False


class SchemaParity(unittest.TestCase):
    @unittest.skipIf(jsonschema is None, "jsonschema not installed (pip install jsonschema)")
    def test_structural_parity(self):
        with open(SCHEMA) as f:
            schema = json.load(f)
        v = jsonschema.Draft202012Validator(schema)
        for name, mut in MUTATIONS.items():
            m = copy.deepcopy(BASE)
            mut(m)
            with self.subTest(name):
                self.assertEqual(ours(m), v.is_valid(m), f"{name}: ours={ours(m)} schema={v.is_valid(m)}")

    def test_semantic_rules_beyond_schema(self):
        for title in ("   ", "é" * 48, "a\u0085b"):  # blank, 96 UTF-8 bytes, C1 control
            m = dict(BASE, title=title)
            self.assertFalse(ours(m), title)
        self.assertFalse(ours(dict(BASE, id="con.example")))
        self.assertFalse(ours(dict(BASE, id="lpt1.x")))

    def test_uuid_warning(self):
        _, w = validate_manifest(dict(BASE, id="org.example.demo"))
        self.assertTrue(any("UUID" in x for x in w))

    def test_strict_json(self):
        raw = json.dumps(BASE).encode()
        self.assertEqual(load_json_strict(raw), BASE)
        for bad, code in ((raw.replace(b'"title"', b'"title": "x", "title"', 1), "MANIFEST_DUPLICATE_KEY"),
                          (b"\xef\xbb\xbf" + raw, "MANIFEST_UTF8"),
                          (raw.replace(b"1.0.0", b"1.0.0\xff", 1), "MANIFEST_UTF8"),
                          (b'{"a": Infinity}', "MANIFEST_JSON"),
                          (b'{"a":' * 20 + b"1" + b"}" * 20, "MANIFEST_DEPTH"),
                          (b" " * 16385, "MANIFEST_TOO_LARGE")):
            with self.subTest(code):
                with self.assertRaises(PackageError) as cm:
                    load_json_strict(bad)
                self.assertEqual(cm.exception.code, code)


if __name__ == "__main__":
    unittest.main()
