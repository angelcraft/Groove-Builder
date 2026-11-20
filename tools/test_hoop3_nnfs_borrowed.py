"""Host-only typed nn::fs file gateway regressions, with synthetic .groove."""

from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile

import groove_pack


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples/hoop_trundling_3"


class NnFsBorrowedGatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("g++"):
            raise unittest.SkipTest("g++ missing for host-only fake SDK tests")
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temp.name)
        flags = ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                 "-fsanitize=undefined", "-I", str(ROOT / "tests/fake_nnsdk"),
                 "-I", str(ROOT / "source")]
        cls.verifier = cls.folder / "borrowed-groove"
        for source, output, libs in (
            (ROOT / "tests/test_groove_hoop3_nnfs_borrowed.cpp",
             cls.folder / "fake-nnfs-api-test", []),
            (ROOT / "tools/verify_hoop3_nnfs_borrowed.cpp",
             cls.verifier, ["-lz"]),
        ):
            result = subprocess.run(flags + [str(source), *libs, "-o", str(output)],
                                    capture_output=True, text=True, check=False)
            if result.returncode:
                raise AssertionError(f"Fake NNSDK compile failed: {result.stderr}")
            if output != cls.verifier:
                run = subprocess.run([str(output)], capture_output=True, text=True,
                                     check=False)
                if run.returncode:
                    raise AssertionError(f"Fake NNSDK unit test failed: {run.stderr}")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_verifier(self, archive: Path, expected_success: bool) -> str:
        result = subprocess.run([str(self.verifier), str(archive)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode == 0, expected_success, result.stderr)
        return result.stdout + result.stderr

    def test_four_event_archive_through_typed_nnfs_gateway(self):
        archive = self.folder / "example.groove"
        groove_pack.build_archive(EXAMPLE, archive)
        output = self.run_verifier(archive, expected_success=True)
        self.assertIn("ZIP header probe -> typed nn::fs -> ZIP/JSON/GRT1 -> 4 owned events PASSED", output)
        self.assertIn("Host only", output)

    def test_missing_archive_rejected_without_fake_hardware_success(self):
        output = self.run_verifier(self.folder / "missing.groove",
                                   expected_success=False)
        self.assertIn("ingress rejected", output)

    def test_stale_json_cache_rejected_after_valid_zip_crc(self):
        base = self.folder / "base.groove"
        groove_pack.build_archive(EXAMPLE, base)
        with zipfile.ZipFile(base) as source:
            files = {name: source.read(name) for name in source.namelist()}
        timeline = json.loads(files["timeline.json"])
        timeline["events"][1]["beat"] = "5"
        files["timeline.json"] = json.dumps(timeline).encode("utf-8")
        stale = self.folder / "stale.groove"
        with zipfile.ZipFile(stale, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for name, data in sorted(files.items()):
                target.writestr(name, data)
        self.run_verifier(stale, expected_success=False)


if __name__ == "__main__":
    unittest.main()
