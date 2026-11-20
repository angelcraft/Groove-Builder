"""Synthetic-only tests of descriptor capacity and original ownership."""

import importlib.util
from pathlib import Path
import struct
import unittest


spec = importlib.util.spec_from_file_location(
    "hoop3_catalog_ownership", Path(__file__).with_name("audit_hoop3_catalog_ownership.py")
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture():
    image = bytearray(audit.KIND2_BASE_GOT + 8)
    for offset, opcode in audit.WORDS.items():
        struct.pack_into("<I", image, offset, opcode)
    for offset, ptr in (
        (audit.KIND1_BASE_GOT, audit.KIND1_BASE),
        (audit.KIND2_BASE_GOT, audit.KIND2_BASE),
    ):
        struct.pack_into("<Q", image, offset, ptr)
    for idx in range(audit.KIND1_COUNT):
        item = audit.KIND1_BASE + idx * audit.STRIDE
        path = audit.EXPECTED_OWNERS.get(
            idx, f"graph/prologue/synthetic/type_{idx:02d}/prologue"
        )
        string_address = 0x900000 + idx * 0x90
        struct.pack_into("<II", image, item, 1, idx)
        struct.pack_into("<Q", image, item + 0x20, string_address)
        image[string_address:string_address + len(path) + 1] = path.encode() + b"\x00"
    return image


class CatalogOwnershipTests(unittest.TestCase):
    def test_all_80_original_slots_are_occupied(self):
        result = audit.audit_image(fixture())
        self.assertEqual(result["kind1_descriptor_count"], 80)
        self.assertEqual(result["kind1_valid_unique_resource_paths"], 80)
        self.assertEqual(result["new_cell_current_alias"], [1, 41])
        self.assertIn("remix/type_15", result["known_original_owners"]["75"])
        self.assertEqual(result["unallocated_native_kind1_slots_proven"], 0)
        self.assertFalse(result["new_unique_game_identity_created"])

    def test_missing_entry_rejected(self):
        image = fixture()
        struct.pack_into("<I", image, audit.KIND1_BASE + 73 * audit.STRIDE + 4, 0)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_remix16_must_not_be_renamed_hoop3(self):
        image = fixture()
        struct.pack_into("<Q", image, audit.KIND1_BASE + 75 * audit.STRIDE + 0x20,
                         0x900000 + 41 * 0x90)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_duplicate_path_rejected(self):
        image = fixture()
        source_ptr = struct.unpack_from(
            "<Q", image, audit.KIND1_BASE + 61 * audit.STRIDE + 0x20
        )[0]
        struct.pack_into("<Q", image, audit.KIND1_BASE + 62 * audit.STRIDE + 0x20, source_ptr)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_next_catalog_pointer_must_match_capacity(self):
        image = fixture()
        struct.pack_into("<Q", image, audit.KIND2_BASE_GOT, audit.KIND2_BASE + 0x30)
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_invalid_accessor_rejected(self):
        image = fixture()
        image[0x1CBC64] ^= 1
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(image)

    def test_truncated_rejected(self):
        with self.assertRaises(audit.EvidenceMismatch):
            audit.audit_image(b"\x00" * 128)


if __name__ == "__main__":
    unittest.main()
