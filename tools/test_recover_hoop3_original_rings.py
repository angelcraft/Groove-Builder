"""Synthetic tests only; never require or distribute an original Switch NSO."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "recover_hoop3_original_rings",
    Path(__file__).with_name("recover_hoop3_original_rings.py"))
recover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recover)


class RecoverOriginalRingsTests(unittest.TestCase):
    def test_arm64_bl_target_decodes_forward_and_backward(self):
        self.assertEqual(recover.branch_target(0x1000, 0x94000010), 0x1040)
        self.assertEqual(recover.branch_target(0x1000, 0x97FFFFFC), 0x0FF0)
        self.assertIsNone(recover.branch_target(0x1000, 0x14000010))
        self.assertIsNone(recover.branch_target(0x1000, 0x52800002))

    def test_unknown_original_rejected_before_nso_decompression(self):
        with tempfile.TemporaryDirectory() as temporary:
            wrong = Path(temporary) / "main"
            wrong.write_bytes(b"NSO0" + b"\x00" * 512)
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                recover.load_original_image(wrong)

    def test_incomplete_original_worker_window_rejected(self):
        fake = struct.pack("<I", 0xA9BD7BFD)
        with self.assertRaisesRegex(ValueError, "lacks expected"):
            recover.original_ring_schedule(fake)


if __name__ == "__main__":
    unittest.main()
