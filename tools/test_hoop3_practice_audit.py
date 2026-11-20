"""Synthetic tests; no Nintendo binary or proprietary data needed."""

import importlib.util
from pathlib import Path
import struct
import unittest


spec = importlib.util.spec_from_file_location(
    "hoop3_practice_audit", Path(__file__).with_name("audit_hoop3_practice_path.py")
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture():
    image = bytearray(audit.SHOWTIME_SLOT + 8)
    for pc, word in audit.WORDS.items():
        struct.pack_into("<I", image, pc, word)
    struct.pack_into("<Q", image, audit.SHOWTIME_SLOT, audit.SHOWTIME_THREAD)
    return image


class PracticeAuditTests(unittest.TestCase):
    def test_two_native_routes_are_distinct(self):
        result = audit.audit_image(fixture())
        self.assertEqual(result["branch"], "0x428fc0")
        self.assertEqual(result["predicate_mask"], "0x101")
        self.assertIn("0x1d2eac", result["menu_launch_forward"])
        self.assertFalse(result["hook_installed"])
        self.assertFalse(result["scoped_launch_origin_proven"])

    def test_tutorial_word_conflict_rejected(self):
        image = fixture()
        image[0x4290CC] ^= 1
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_predicate_branch_conflict_rejected(self):
        image = fixture()
        image[0x428FC0] ^= 1
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_registered_worker_conflict_rejected(self):
        image = fixture()
        struct.pack_into("<Q", image, audit.SHOWTIME_SLOT, 0)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_truncated_image_rejected(self):
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(b"\x00" * 128)


if __name__ == "__main__":
    unittest.main()
