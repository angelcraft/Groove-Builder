"""Tests which need no Switch binaries, Nintendo SDK, or proprietary data."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("builder_prepare", Path(__file__).with_name("prepare.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuilderTests(unittest.TestCase):
    def test_public_sources_complete(self):
        for name in builder.SOURCES:
            self.assertTrue((builder.ROOT / "source" / name).is_file(), name)
        for name in builder.READER_AUDIT_HEADERS:
            self.assertTrue((builder.ROOT / "source" / name).is_file(), name)
        self.assertTrue((builder.ROOT / "tests" / builder.READER_AUDIT_SOURCE).is_file())

    def test_native_probe_is_compile_only(self):
        cmake = (builder.ROOT / "templates/CMakeLists.txt").read_text()
        self.assertIn("add_library(Hoop3ReadOnlyAbiAudit OBJECT ", cmake)
        self.assertNotIn("target_link_libraries(MenuColumn PRIVATE Hoop3ReadOnlyAbiAudit", cmake)

    def test_synthetic_preparation_copies_inert_reader_probe(self):
        # No actual loader, Switch binary or external stdlib is needed to
        # exercise the prepare.py file contract and CMake isolation.
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            loader = base / "public-loader"
            for subdir in ("sys", "syms", "lib/nnsdk", "config"):
                (loader / subdir).mkdir(parents=True)
            standard = base / "public-stdlib"
            standard.mkdir()
            (standard / "libc.a").touch()
            output = base / "prepared"
            with patch.object(builder, "validate_loader"), \
                 patch.object(builder, "prepare_loader_sources"):
                builder.prepare(loader, standard, output, False)

            for name in builder.READER_AUDIT_HEADERS:
                self.assertEqual((output / name).read_bytes(),
                                 (builder.ROOT / "source" / name).read_bytes())
            self.assertEqual(
                (output / builder.READER_AUDIT_SOURCE).read_bytes(),
                (builder.ROOT / "tests" / builder.READER_AUDIT_SOURCE).read_bytes(),
            )
            cmake = (output / "CMakeLists.txt").read_text()
            self.assertIn("add_library(Hoop3ReadOnlyAbiAudit OBJECT ", cmake)
            executable = cmake.split("add_executable(MenuColumn", 1)[1].split(")", 1)[0]
            self.assertNotIn(builder.READER_AUDIT_SOURCE, executable)

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
