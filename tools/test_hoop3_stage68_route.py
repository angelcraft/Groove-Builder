"""No original game bytes required: synthetic Stage67/Stage68 regression."""

import importlib.util
from pathlib import Path
import struct
import unittest


spec = importlib.util.spec_from_file_location(
    "hoop3_stage68_route_audit", Path(__file__).with_name("audit_hoop3_stage68_route.py")
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture():
    image = bytearray(audit.STAGE68_WORKER_GOT + 8)
    for pc, opcode in audit.WORDS.items():
        struct.pack_into("<I", image, pc, opcode)
    for offset, target in (
        (audit.STAGE68_VTABLE_GOT, audit.STAGE68_VTABLE_BASE),
        (audit.STAGE68_WORKER_GOT, audit.STAGE68_WORKER),
        (audit.STAGE67_WORKER_GOT, audit.STAGE67_WORKER),
    ):
        struct.pack_into("<Q", image, offset, target)
    return image


class Stage68RouteTests(unittest.TestCase):
    def test_stage67_not_confused_with_stage68(self):
        result = audit.audit_image(fixture())
        self.assertEqual(result["stage_factory_id"], 68)
        self.assertEqual(result["stage_constructor"], "0x42bea0")
        self.assertIn("0x428ef0", result["stage_worker"])
        self.assertIn("0x42ed80", result["preliminary_worker"])
        self.assertIn("0x42c660", result["ordinary_worker"])
        self.assertEqual(len(result["later_flag_reads"]), 2)
        self.assertFalse(result["safe_to_install"])

    def test_constructor_mismatch_rejected(self):
        image = fixture()
        image[0x488DE8] ^= 1
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_factory_return_mismatch_rejected(self):
        image = fixture()
        image[0x48A568] ^= 1
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_stage68_vtable_mismatch_rejected(self):
        image = fixture()
        struct.pack_into("<Q", image, audit.STAGE68_VTABLE_GOT, 0)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_stage68_worker_mismatch_rejected(self):
        image = fixture()
        struct.pack_into("<Q", image, audit.STAGE68_WORKER_GOT, audit.STAGE67_WORKER)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_stage67_worker_mismatch_rejected(self):
        image = fixture()
        struct.pack_into("<Q", image, audit.STAGE67_WORKER_GOT, audit.STAGE68_WORKER)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_branch_mismatch_rejected(self):
        image = fixture()
        image[0x42C198] ^= 1
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_late_flag_use_mismatch_rejected(self):
        image = fixture()
        image[0x42E4A4] ^= 1
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_truncated_rejected(self):
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(b"\x00" * 128)


if __name__ == "__main__":
    unittest.main()
