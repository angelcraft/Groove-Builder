"""Synthetic ARM64 operands only; no private original Switch executable."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import struct
import unittest
import sys


sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location(
    "audit_hoop3_worker_contract",
    Path(__file__).with_name("audit_hoop3_worker_contract.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class Stage68WorkerContractTests(unittest.TestCase):
    def test_adrp_and_add_decode_exact_original_argument_pointer(self):
        # Synthetic ADRP x1, aligned page + ADD x1,x1,#0x80.
        self.assertEqual(audit.decode_adrp_target(0x1004, 0x90000001, 1), 0x1000)
        self.assertEqual(audit.decode_add_literal(0x91020021, 1), 0x80)
        with self.assertRaises(ValueError):
            audit.decode_adrp_target(0x1004, 0x90000002, 1)
        with self.assertRaises(ValueError):
            audit.decode_add_literal(0x91020022, 1)

    def test_whitelisted_stage_action_string_is_read_from_verified_memory(self):
        image = bytearray(0x2000)
        pc = 0x1010
        struct.pack_into("<I", image, pc - 12, 0x90000001)
        struct.pack_into("<I", image, pc - 8, 0x91020021)
        struct.pack_into("<I", image, pc - 4, audit.STAGE_TO_HELPER)
        image[0x1080:0x1087] = b"change\x00"
        assert audit.stage_helper_argument(bytes(image), pc) == ("change", 0x1080)
        image[0x1080:0x1087] = b"\xff\x00\x00\x00\x00\x00\x00"
        with self.assertRaisesRegex(ValueError, "ASCII"):
            audit.stage_helper_argument(bytes(image), pc)


if __name__ == "__main__":
    unittest.main()
