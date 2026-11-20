"""Host ZIP + initial Hoop3 manifest and GRT1 equivalence tests."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
import zipfile

import groove_pack


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples/hoop_trundling_3"


def source_files() -> dict[str, bytes]:
    files = {p.name: p.read_bytes() for p in EXAMPLE.iterdir() if p.is_file()}
    timeline = json.loads(files["timeline.json"])
    files["timeline.bin"] = groove_pack.compile_timeline(timeline["events"])
    return files


def create_archive(destination: Path, files: dict[str, bytes], *,
                   extra: list[tuple[object, bytes]] | None = None,
                   method: int = zipfile.ZIP_DEFLATED) -> None:
    with zipfile.ZipFile(destination, "w", compression=method) as z:
        for name, content in sorted(files.items()):
            z.writestr(name, content)
        for name, content in extra or []:
            z.writestr(name, content)


def json_mutate(files: dict[str, bytes], member: str, update) -> dict[str, bytes]:
    altered = files.copy()
    decoded = json.loads(altered[member])
    update(decoded)
    altered[member] = json.dumps(decoded, ensure_ascii=False).encode("utf-8")
    return altered


class GrooveZipContainerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("g++"):
            raise unittest.SkipTest("g++ missing for C++ ZIP container integration")
        cls.temporary = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temporary.name)
        cls.binary = cls.folder / "verify-groove-zip"
        command = ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                   "-fsanitize=undefined", "-I", str(ROOT / "source"),
                   str(ROOT / "tools" / "verify_hoop3_zip_container.cpp"),
                   "-lz", "-o", str(cls.binary)]
        try:
            subprocess.run(command, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as exc:
            raise AssertionError(f"Cannot compile C++ ZIP verifier: {exc.stderr}") from exc

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def verify(self, path: Path, *, success: bool) -> str:
        execution = subprocess.run([str(self.binary), str(path)],
                                   capture_output=True, text=True, check=False)
        self.assertEqual(execution.returncode == 0, success, execution.stderr)
        return execution.stdout + execution.stderr

    def test_actual_builder_archive_has_valid_crc_and_four_native_events(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "base.groove"
            report = groove_pack.build_archive(EXAMPLE, archive)
            self.assertEqual(report["event_count"], 4)
            output = self.verify(archive, success=True)
            self.assertIn("full JSON/cache match and 4 native events", output)
            self.assertIn("Host SessionOwner ready", output)
            self.assertIn("Switch menu/SD/ARM64 NOT connected", output)

    def test_uncompressed_members_need_no_raw_deflate(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "stored.groove"
            create_archive(archive, source_files(), method=zipfile.ZIP_STORED)
            output = self.verify(archive, success=True)
            self.assertIn("4 native events", output)

    def test_duplicate_member_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "duplicate.groove"
            create_archive(archive, source_files(), extra=[("timeline.bin", b"fake")])
            self.verify(archive, success=False)

    def test_traversal_and_symlink_members_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ("../other.bin", "sprites/../fake.png", "/absolute.png"):
                archive = Path(folder) / "traversal.groove"
                create_archive(archive, source_files(), extra=[(name, b"fake")])
                self.verify(archive, success=False)
            archive = Path(folder) / "symlink.groove"
            link = zipfile.ZipInfo("sprites/link.png")
            link.create_system = 3
            link.external_attr = 0o120777 << 16
            create_archive(archive, source_files(), extra=[(link, b"elsewhere")])
            self.verify(archive, success=False)

    def test_corrupt_raw_deflate_data_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "corrupt.groove"
            create_archive(archive, source_files())
            data = bytearray(archive.read_bytes())
            with zipfile.ZipFile(archive) as z:
                info = z.getinfo("timeline.bin")
                raw_offset = (info.header_offset + 30 + len(info.filename))
                self.assertGreater(info.compress_size, 2)
                data[raw_offset + info.compress_size // 2] ^= 0x40
            archive.write_bytes(data)
            self.verify(archive, success=False)

    def test_unknown_compression_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "unsupported.groove"
            create_archive(archive, source_files(), method=zipfile.ZIP_BZIP2)
            self.verify(archive, success=False)

    def test_native_time_grid_enforced_after_correct_zip_crc(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "bad-time.groove"
            files = source_files()
            binary = bytearray(files["timeline.bin"])
            # Change first ring at beat 4 to an off-grid microbeat.
            struct.pack_into("<Q", binary, 8 + 16, 4_000_001)
            files["timeline.bin"] = bytes(binary)
            create_archive(archive, files)
            output = self.verify(archive, success=False)
            self.assertIn("JSON differs from GRT1 cache", output)

    def test_json_cache_mismatch_needs_separate_semantic_validator(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "stale-cache.groove"
            files = source_files()
            timeline = json.loads(files["timeline.json"])
            timeline["events"][1]["beat"] = "5"
            files["timeline.json"] = json.dumps(timeline).encode()
            create_archive(archive, files)
            # ZIP integrity is intact; the new C++ JSON pass MUST reject it.
            output = self.verify(archive, success=False)
            self.assertIn("JSON differs from GRT1 cache", output)
            with self.assertRaisesRegex(groove_pack.GrooveFormatError, "not the exact"):
                groove_pack.validate_package(files)

    def test_wrong_manifest_identity_and_unverified_assets_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            changes = (
                lambda m: m["slot"].update({"column": 8}),
                lambda m: m["base"].update({"index": 80}),
                lambda m: m["launch"].update({"practice": "native"}),
                lambda m: m["resources"].update({"sprites": "sprites/new.png"}),
                lambda m: m.update({"state": "ready"}),
                lambda m: m.update({"arbitrary_native_address": "0x1234"}),
            )
            for case, change in enumerate(changes):
                with self.subTest(case=case):
                    files = json_mutate(source_files(), "manifest.json", change)
                    archive = Path(folder) / f"manifest-{case}.groove"
                    create_archive(archive, files)
                    self.assertIn("Hoop3 manifest", self.verify(archive, success=False))

    def test_editor_event_drift_and_invalid_commands_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            changes = (
                lambda t: t["events"][2].update({"id": t["events"][1]["id"]}),
                lambda t: t["events"][1].update({"command": "native.call_anything"}),
                lambda t: t["events"][1].update({"args": {"variant": "huge"}}),
                lambda t: t["events"][2].update({"beat": "6.123456"}),
                lambda t: t["events"][2].update({"extra_native_arg": 123}),
                lambda t: t["events"].append(t["events"][-1].copy()),
            )
            for case, change in enumerate(changes):
                with self.subTest(case=case):
                    files = json_mutate(source_files(), "timeline.json", change)
                    archive = Path(folder) / f"timeline-{case}.groove"
                    create_archive(archive, files)
                    self.assertIn("JSON differs", self.verify(archive, success=False))

    def test_rebuilt_cache_cannot_bypass_native_order_and_ring_presence(self):
        with tempfile.TemporaryDirectory() as folder:
            for case, change in enumerate((
                lambda t: t["events"][1].update({"beat": "7"}),
                lambda t: t.update({"events": [
                    {"id": "only_bubble", "beat": "0", "command": "hoop.bubble_state",
                     "args": {"mask": -1}}]}),
            )):
                with self.subTest(case=case):
                    files = json_mutate(source_files(), "timeline.json", change)
                    timeline = json.loads(files["timeline.json"])
                    files["timeline.bin"] = groove_pack.compile_timeline(timeline["events"])
                    archive = Path(folder) / f"rebuilt-{case}.groove"
                    create_archive(archive, files)
                    self.verify(archive, success=False)

    def test_duplicate_json_keys_and_invalid_json_number_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            base = source_files()
            variants = [
                base["manifest.json"].replace(
                    b'"format": "groove.level",',
                    b'"format": "groove.level", "format": "groove.level",'),
                base["manifest.json"].replace(b'"version": 1', b'"version": 01'),
                base["manifest.json"].replace(b'"version": 1', b'"version": 1.0'),
            ]
            for case, altered in enumerate(variants):
                with self.subTest(case=case):
                    files = {**base, "manifest.json": altered}
                    archive = Path(folder) / f"json-{case}.groove"
                    create_archive(archive, files)
                    self.verify(archive, success=False)

    def test_unicode_title_supported_but_unpaired_escape_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            files = json_mutate(source_files(), "manifest.json", lambda m: m.update(
                {"title": "Pasar por el anillo 🥁"}))
            archive = Path(folder) / "unicode.groove"
            create_archive(archive, files)
            self.verify(archive, success=True)
            files = source_files()
            files["manifest.json"] = files["manifest.json"].replace(
                b'"title": "', b'"title": "\\ud800')
            archive = Path(folder) / "surrogate.groove"
            create_archive(archive, files)
            self.verify(archive, success=False)


if __name__ == "__main__":
    unittest.main()
