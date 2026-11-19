"""Tests which need no Switch binaries, Nintendo SDK, or proprietary data."""
import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("builder_prepare", Path(__file__).with_name("prepare.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuilderTests(unittest.TestCase):
    def test_public_sources_complete(self):
        for name in builder.SOURCES:
            self.assertTrue((builder.ROOT / "source" / name).is_file(), name)

    def test_required_status_guards(self):
        text = (builder.ROOT / "tools/prepare.py").read_text()
        self.assertIn('"package_allowed": False', text)
        self.assertIn('"installable": False', text)
        self.assertIn('"physical_switch_test_passed": False', text)

    def test_output_guard_rejects_existing_path(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "libc.a").touch()
            with self.assertRaises(ValueError):
                builder.prepare(Path(directory), Path(directory), Path(directory), False)

    def test_pin_is_full_commit_hash(self):
        self.assertEqual(len(builder.PIN["commit"]), 40)
        self.assertTrue(builder.PIN["files"])
        self.assertTrue(builder.PIN["submodules"])


if __name__ == "__main__":
    unittest.main()
