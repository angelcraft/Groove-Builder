"""Private-resource-free .groove package and event safety tests."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile
import zlib


spec = importlib.util.spec_from_file_location(
    "groove_pack", Path(__file__).with_name("groove_pack.py"))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
EXAMPLE = Path(__file__).resolve().parents[1] / "examples/hoop_trundling_3"


def red_png(blob: bytes) -> bool:
    """True when every pixel is a red tone. Host check only."""
    if not blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    pos = 8
    width = height = None
    raw = b""
    while pos + 8 <= len(blob):
        length = struct.unpack_from(">I", blob, pos)[0]
        tag = blob[pos + 4:pos + 8]
        data = blob[pos + 8:pos + 8 + length]
        if len(data) != length:
            return False
        pos += 12 + length
        if tag == b"IHDR":
            width, height, depth, color = struct.unpack_from(">IIBB", data)
            if depth != 8 or color != 2 or width < 1 or height < 1:
                return False
        elif tag == b"IDAT":
            raw += data
        elif tag == b"IEND":
            break
    if width is None or not raw:
        return False
    rows = zlib.decompress(raw)
    stride = 1 + width * 3
    if len(rows) != stride * height:
        return False
    for y in range(height):
        row = rows[y * stride:(y + 1) * stride]
        if row[0] != 0:
            return False
        for x in range(width):
            red, green, blue = row[1 + x * 3:4 + x * 3]
            if red < 140 or red < green + 40 or red < blue + 40:
                return False
    return True


def example_files():
    return {path.relative_to(EXAMPLE).as_posix(): path.read_bytes()
            for path in EXAMPLE.rglob("*") if path.is_file()}


def mutate(files, name, change):
    result = files.copy()
    obj = json.loads(result[name])
    change(obj)
    result[name] = json.dumps(obj).encode("utf-8")
    return result


class GroovePackTests(unittest.TestCase):
    def test_example_has_independent_identity_and_own_background(self):
        files = example_files()
        report = pack.validate_package(files)
        self.assertEqual(report["id"], "groove.hoop_trundling_3")
        self.assertEqual(report["slot"], {"world": 1, "column": 9, "row": 0})
        self.assertEqual(report["base"]["index"], 41)
        self.assertEqual(report["mode"], "replace")
        self.assertEqual(report["practice"], "skip")
        self.assertEqual(report["event_count"], 4)
        self.assertEqual(report["resource_overrides"], ["sprites"])
        self.assertFalse(report["switch_playable"])
        resources = json.loads(files["manifest.json"])["resources"]
        self.assertEqual(resources["sprites"], "sprites/background.png")
        self.assertIsNone(resources["music"])
        self.assertIsNone(resources["sound_effects"])
        self.assertIsNone(resources["intro"])
        self.assertNotIn("ring/type_01/bg.spr", files)
        self.assertNotIn("graph/scene/ring/type_01/bg.spr", files)
        png = files["sprites/background.png"]
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertTrue(red_png(png))

    def test_zip_build_is_deterministic_and_roundtrips(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp) / "a.groove"
            b = Path(tmp) / "b.groove"
            self.assertEqual(pack.build_archive(EXAMPLE, a), pack.build_archive(EXAMPLE, b))
            self.assertEqual(a.read_bytes(), b.read_bytes())
            archive_files = pack.read_archive(a)
            self.assertEqual({k: v for k, v in archive_files.items() if k != "timeline.bin"},
                             example_files())
            timeline = json.loads(example_files()["timeline.json"])
            self.assertEqual(archive_files["timeline.bin"],
                             pack.compile_timeline(timeline["events"]))
            binary = archive_files["timeline.bin"]
            self.assertEqual(struct.unpack_from("<4sI", binary), (b"GRT1", 4))
            self.assertEqual([struct.unpack_from("<QIi", binary, 8 + i * 16)
                              for i in range(4)],
                             [(0, 2, -1), (4000000, 1, 0),
                              (6000000, 2, 1), (6500000, 1, 0)])

    def test_binary_cache_must_match_json_after_any_edit(self):
        files = example_files()
        files["timeline.bin"] = pack.compile_timeline(
            json.loads(files["timeline.json"])["events"])
        self.assertEqual(pack.validate_package(files)["event_count"], 4)
        changed = mutate(files, "timeline.json", lambda t: t["events"][1].update(
            {"beat": "5"}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(changed)
        files["timeline.bin"] += b"unexpected"
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_inherit_mode_needs_no_timeline(self):
        files = mutate(example_files(), "manifest.json", lambda m: m.update(
            {"sequence": {"mode": "inherit", "file": None},
             "launch": {"practice": "native"}}))
        files.pop("timeline.json")
        self.assertEqual(pack.validate_package(files)["event_count"], 0)

    def test_inherit_mode_does_not_ship_unused_events(self):
        files = mutate(example_files(), "manifest.json", lambda m: m.update(
            {"sequence": {"mode": "inherit", "file": None},
             "launch": {"practice": "native"}}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_empty_replacement_rejected_by_runtime_contract(self):
        files = mutate(example_files(), "timeline.json", lambda t: t.update({"events": []}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_skip_practice_requires_a_replacement_timeline(self):
        files = mutate(example_files(), "manifest.json", lambda m: m.update(
            {"sequence": {"mode": "inherit", "file": None}}))
        files.pop("timeline.json")
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

    def test_unknown_practice_mode_rejected(self):
        files = mutate(example_files(), "manifest.json", lambda m: m["launch"].update(
            {"practice": "maybe"}))
        with self.assertRaises(pack.GrooveFormatError):
            pack.validate_package(files)

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

    def test_stage68_original_conditional_mask_has_its_own_command(self):
        files = mutate(example_files(), "timeline.json", lambda t: t["events"][2].update(
            {"command": "hoop.stage68_mask", "args": {}}))
        self.assertEqual(pack.validate_package(files)["event_count"], 4)
        timeline = json.loads(files["timeline.json"])
        self.assertEqual(struct.unpack_from("<QIi", pack.compile_timeline(
            timeline["events"]), 8 + 2 * 16), (6000000, 3, 0))
        files = mutate(files, "manifest.json", lambda m: m["base"].update({"index": 40}))
        with self.assertRaisesRegex(pack.GrooveFormatError, "Stage68 mask"):
            pack.validate_package(files)

    def test_original_scene_state_actions_have_explicit_whitelist(self):
        files = mutate(example_files(), "timeline.json", lambda t: t["events"][2].update(
            {"command": "hoop.scene_action", "args": {"action": "change"}}))
        self.assertEqual(pack.validate_package(files)["event_count"], 4)
        timeline = json.loads(files["timeline.json"])
        self.assertEqual(struct.unpack_from("<QIi", pack.compile_timeline(
            timeline["events"]), 8 + 2 * 16), (6000000, 4, 1))
        invalid = mutate(files, "timeline.json", lambda t: t["events"][2][
            "args"].update({"action": "call_arbitrary"}))
        with self.assertRaisesRegex(pack.GrooveFormatError, "Unsupported original"):
            pack.validate_package(invalid)
        wrong_game = mutate(files, "manifest.json", lambda m: m["base"].update(
            {"index": 40}))
        with self.assertRaisesRegex(pack.GrooveFormatError, "Scene action only"):
            pack.validate_package(wrong_game)

    def test_suspicious_beat_coordinates_fail(self):
        for beat in (-1, 1.5, "NaN", "1e6", "1.1234567", "-3"):
            files = mutate(example_files(), "timeline.json", lambda t: t["events"][1].update(
                {"beat": beat}))
            with self.subTest(beat=beat), self.assertRaises(pack.GrooveFormatError):
                pack.validate_package(files)

    def test_hoop_replacement_uses_exact_native_480_tick_grid(self):
        files = mutate(example_files(), "timeline.json", lambda t: t["events"][3].update(
            {"beat": "6.123456"}))
        with self.assertRaisesRegex(pack.GrooveFormatError, "480-tick grid"):
            pack.validate_package(files)
        files = mutate(example_files(), "timeline.json", lambda t: t["events"][3].update(
            {"beat": "6.125"}))
        self.assertEqual(pack.validate_package(files)["event_count"], 4)
        files = mutate(example_files(), "timeline.json", lambda t: t["events"][3].update(
            {"beat": "5000000"}))
        with self.assertRaisesRegex(pack.GrooveFormatError, "480-tick grid"):
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
