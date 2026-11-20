"""Synthetic tests; never load or ship a Nintendo executable."""

import struct
import unittest

from audit_hoop3_practice_path import EvidenceMismatch
from audit_hoop3_native_selection_record import WORDS, audit_image, direct_calls


class NativeMenuRecordTests(unittest.TestCase):
    @staticmethod
    def pinned_synthetic():
        image = bytearray(0x1D4000)
        for address, word in WORDS.items():
            struct.pack_into("<I", image, address, word)
        return image

    def test_exact_original_callers(self):
        report = audit_image(self.pinned_synthetic())
        self.assertFalse(report["safe_to_install_scoped_practice_skip"])
        self.assertEqual(report["world_address"], "manager+0xb98+mode")
        self.assertEqual(report["selected_index"], "manager+0xba0+2*mode (set at 0x1d344c)")
        self.assertEqual(report["other_coordinate_writers"], ["0x1cf294", "0x1d1614"])

    def test_detects_unexpected_branch_to_setter(self):
        image = self.pinned_synthetic()
        source = 0x1000
        target = 0x4890
        instruction = 0x94000000 | (((target - source) // 4) & 0x3FFFFFF)
        struct.pack_into("<I", image, source, instruction)
        self.assertIn(source, direct_calls(image, target))
        with self.assertRaises(EvidenceMismatch):
            audit_image(image)

    def test_rejects_corrupted_scene_coordinate(self):
        image = self.pinned_synthetic()
        struct.pack_into("<I", image, 0x1D2EC0, 0xD503201F)
        with self.assertRaises(EvidenceMismatch):
            audit_image(image)

    def test_rejects_corrupted_index_setter(self):
        image = self.pinned_synthetic()
        struct.pack_into("<I", image, 0x48B8, 0xD503201F)
        with self.assertRaises(EvidenceMismatch):
            audit_image(image)

    def test_rejects_missing_setter_call(self):
        image = self.pinned_synthetic()
        struct.pack_into("<I", image, 0x1CF294, 0xD503201F)
        with self.assertRaises(EvidenceMismatch):
            audit_image(image)


if __name__ == "__main__":
    unittest.main()
