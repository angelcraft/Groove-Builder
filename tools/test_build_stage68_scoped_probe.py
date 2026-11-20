"""Synthetic ARM64/IPS tests; the user's commercial NSO is never required."""

import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from audit_hoop3_practice_path import EvidenceMismatch
from build_stage68_scoped_probe import (
    BRANCH_SITE, ORIGINAL_WORD, RODATA_START, STUB_START, TEXT_END,
    adrp, build_stub, cmp_w_imm, create_ips, emit_kit,
)


class Stage68ScopedProbeTests(unittest.TestCase):
    @staticmethod
    def fake_unpacked_image():
        data = bytearray(RODATA_START)
        struct.pack_into("<I", data, BRANCH_SITE, ORIGINAL_WORD)
        return data

    def checked_build(self, image):
        with (patch("build_stage68_scoped_probe.audit_stage"),
              patch("build_stage68_scoped_probe.audit_manager")):
            return create_ips(image)

    def test_stub_fits_only_the_executable_padding(self):
        stub = build_stub()
        self.assertEqual(len(stub), 140)
        self.assertLessEqual(TEXT_END + len(stub), RODATA_START)
        self.assertEqual(STUB_START % 4, 0)

    def test_ips_has_exactly_branch_and_stub_records(self):
        ips, stub = self.checked_build(self.fake_unpacked_image())
        self.assertTrue(ips.startswith(b"PATCH"))
        self.assertTrue(ips.endswith(b"EOF"))
        cursor = 5
        records = []
        while cursor < len(ips) - 3:
            offset = int.from_bytes(ips[cursor:cursor+3], "big")
            length = int.from_bytes(ips[cursor+3:cursor+5], "big")
            content = ips[cursor+5:cursor+5+length]
            self.assertEqual(len(content), length)
            records.append((offset, content))
            cursor += 5 + length
        self.assertEqual(cursor, len(ips)-3)
        self.assertEqual([r[0] for r in records], [BRANCH_SITE, STUB_START])
        self.assertEqual(len(records[0][1]), 4)
        self.assertEqual(records[1][1], stub)

    def test_original_image_is_never_modified(self):
        original = self.fake_unpacked_image()
        before = bytes(original)
        self.checked_build(original)
        self.assertEqual(bytes(original), before)

    def test_rejects_patch_conflict_at_original_branch(self):
        image = self.fake_unpacked_image()
        struct.pack_into("<I", image, BRANCH_SITE, 0xD503201F)
        with self.assertRaises(EvidenceMismatch):
            self.checked_build(image)

    def test_rejects_cave_with_unexpected_data(self):
        image = self.fake_unpacked_image()
        image[STUB_START+4] = 1
        with self.assertRaises(EvidenceMismatch):
            self.checked_build(image)

    def test_adpr_and_cmp_guard_inputs(self):
        with self.assertRaises(EvidenceMismatch):
            adrp(16, 0, 0x1000000000)
        with self.assertRaises(EvidenceMismatch):
            cmp_w_imm(17, 4096)

    def test_kit_says_not_a_standalone_game(self):
        ips, _ = self.checked_build(self.fake_unpacked_image())
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder) / "scoped-probe"
            archive = emit_kit(directory, ips, {"test_mode": True})
            with zipfile.ZipFile(archive) as z:
                data = json.loads(z.read("manifest.json"))
                self.assertEqual(len(z.namelist()), 3)
                self.assertFalse(data["physical_switch_verified"])
                self.assertFalse(data["independent_gameplay"])
                self.assertFalse(data["independent_progress"])
                self.assertTrue(data["atmosphere_loader_text_page_and_patch_order_audited"])
                self.assertEqual(z.read(data["ips_relative_path"]), ips)
            with self.assertRaises(FileExistsError):
                emit_kit(directory, ips, {})


if __name__ == "__main__":
    unittest.main()
