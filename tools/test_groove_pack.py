"""Private-resource-free .groove package and event safety tests."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


spec = importlib.util.spec_from_file_location(
    "groove_pack", Path(__file__).with_name("groove_pack.py"))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
EXAMPLE = Path(__file__).resolve().parents[1] / "examples/hoop_trundling_3"


def example_files():
    return {path.name: path.read_bytes() for path in EXAMPLE.iterdir() if path.is_file()}


def mutate(files, name, change):
    result = files.copy()
    obj = json.loads(result[name])
    change(obj)
    result[name] = json.dumps(obj).encode("utf-8")
    return result


class GroovePackTests(unittest.TestCase):
    def test_example_has_independent_identity_and_inherited_assets(self):
        report = pack.validate_package(example_files())
        self.assertEqual(report["id"], "groove.hoop_trundling_3")
        self.assertEqual(report["slot"], {"world": 1, "column": 9, "row": 0})
        self.assertEqual(report["base"]["index"], 41)
        self.assertEqual(report["mode"], "replace")
        self.assertEqual(report["event_count"], 4)
        self.assertEqual(report["resource_overrides"], [])
        self.assertFalse(report["switch_playable"])

    def test_zip_build_is_deterministic_and_roundtrips(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp) / "a.groove"
            b = Path(tmp) / "b.groove"
            self.assertEqual(pack.build_archive(EXAMPLE, a), pack.build_archive(EXAMPLE, b))
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(pack.read_archive(a), example_files())

    def test_inherit_mode_needs_no_timeline(self):
        files = mutate(example_files(), "manifest.json", lambda m: m.update(
            {"sequence": {"mode": "inherit", "file": None}}))
        files.pop("timeline.json")
        self.assertEqual(pack.validate_package(files)["event_count"], 0)

    def test_patch_mode_is_reserved_until_original_event_ids_are_known(self):
        files = mutate(example_files(), "manifest.json", lambda m: m["sequence"].update(
            {"mode": "patch"}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_duplicate_json_keys_fail(self):
        files = example_files()
        files["manifest.json"] = files["manifest.json"].replace(
            b'"format": "groove.level",',
            b'"format": "groove.level", "format": "groove.level",')
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_new_identity_does_not_grant_native_index_80(self):
        files = mutate(example_files(), "manifest.json", lambda m: m["base"].update(
            {"index": 80}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_v1_cannot_claim_ready_to_play(self):
        files = mutate(example_files(), "manifest.json", lambda m: m.update(
            {"state": "ready"}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_missing_resource_rejected_but_optional_resource_accepted(self):
        files = mutate(example_files(), "manifest.json", lambda m: m["resources"].update(
            {"sprites": "sprites/character.png"}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)
        files["sprites/character.png"] = b"synthetic fake pixel data"
        self.assertEqual(pack.validate_package(files)["resource_overrides"], ["sprites"])

    def test_traversal_and_absolute_paths_fail(self):
        for name in ("../secret", "/secret", "sprites/../secret.png", "C:/secret",
                     "sprites\\x.png", "sprites//x.png"):
            with self.subTest(name=name), self.assertRaises(pack.GrooveFormatError):
                pack.validate_package({**example_files(), name: b"fake"})

    def test_zip_duplicate_entries_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "duplicate.groove"
            with zipfile.ZipFile(target, "w") as archive:
                archive.writestr("manifest.json", example_files()["manifest.json"])
                archive.writestr("manifest.json", example_files()["manifest.json"])
            with self.assertRaises(pack.GrooveFormatError):
                pack.read_archive(target)

    def test_duplicate_event_id_and_unsorted_beat_fail(self):
        for key, val in (("id", "ring_first"), ("beat", "0")):
            files = mutate(example_files(), "timeline.json", lambda t: t["events"][2].update(
                {key: val}))
            with self.subTest(key=key), self.assertRaises(pack.GrooveFormatError):
                pack.validate_package(files)

    def test_unregistered_command_and_unverified_ring_variant_fail(self):
        for key, val in (("command", "native.call_anything"),
                         ("args", {"variant": "unknown"})):
            files = mutate(example_files(), "timeline.json", lambda t: t["events"][1].update(
                {key: val}))
            with self.subTest(key=key), self.assertRaises(pack.GrooveFormatError):
                pack.validate_package(files)

    def test_bubble_state_rejects_invalid_mask(self):
        for mask in (True, -2, 16, "-1"):
            files = mutate(example_files(), "timeline.json", lambda t: t["events"][0][
                "args"].update({"mask": mask}))
            with self.subTest(mask=mask), self.assertRaises(pack.GrooveFormatError):
                pack.validate_package(files)

    def test_suspicious_beat_coordinates_fail(self):
        for beat in (-1, 1.5, "NaN", "1e6", "1.1234567", "-3"):
            files = mutate(example_files(), "timeline.json", lambda t: t["events"][1].update(
                {"beat": beat}))
            with self.subTest(beat=beat), self.assertRaises(pack.GrooveFormatError):
                pack.validate_package(files)

    def test_unexpected_members_and_unknown_manifest_fields_fail(self):
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package({**example_files(), "secrets.txt": b"oops"})
        files = mutate(example_files(), "manifest.json", lambda m: m.update(
            {"unverified_native_hook": True}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)


if __name__ == "__main__":
    unittest.main()
