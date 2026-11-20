"""Synthetic sequence callback registration checks; no commercial game bytes."""

import struct
import unittest

from audit_hoop3_sequence_pointer import (
    CALLBACK_SETUP, DATA_END_RVA, POINTER_RVA, SETUP_NATIVE_CALL_RVA,
    adrp_page, audit_callback_registration, ldr64_unsigned, str64_unsigned,
)


def encode_adrp(pc: int, target_page: int, reg: int) -> int:
    delta = (target_page - (pc & ~0xFFF)) >> 12
    immediate = delta & 0x1FFFFF
    return 0x90000000 | ((immediate & 3) << 29) | ((immediate >> 2) << 5) | reg


def encode_ldr(base: int, dest: int, offset: int) -> int:
    return 0xF9400000 | ((offset // 8) << 10) | (base << 5) | dest


def encode_str(base: int, source: int, offset: int) -> int:
    return 0xF9000000 | ((offset // 8) << 10) | (base << 5) | source


def synthetic_original() -> bytearray:
    image = bytearray(DATA_END_RVA)
    for adrp, load, store, call, pointer, entry in CALLBACK_SETUP:
        struct.pack_into("<Q", image, pointer, entry)
        struct.pack_into("<I", image, adrp, encode_adrp(adrp, pointer & ~0xFFF, 8))
        struct.pack_into("<I", image, load, encode_ldr(8, 8, pointer & 0xFFF))
        struct.pack_into("<I", image, store, encode_str(22, 8, 0x288))
        struct.pack_into("<I", image, call,
                         0x94000000 | (((SETUP_NATIVE_CALL_RVA - call) // 4) & 0x3FFFFFF))
    return image


class Stage68SequencePointerTests(unittest.TestCase):
    def test_independent_arm64_operand_decoders(self):
        self.assertEqual(adrp_page(0x42C7A4, encode_adrp(0x42C7A4, 0xD9C000, 8), 8),
                         0xD9C000)
        self.assertEqual(ldr64_unsigned(encode_ldr(8, 8, 0x7A0)), (8, 8, 0x7A0))
        self.assertEqual(str64_unsigned(encode_str(22, 8, 0x288)), (22, 8, 0x288))
        with self.assertRaises(ValueError):
            adrp_page(0x42C7A4, 0x90000009, 8)
        with self.assertRaises(ValueError):
            ldr64_unsigned(0xF9000000)

    def test_original_sequence_is_read_from_data_and_registered(self):
        result = audit_callback_registration(bytes(synthetic_original()))
        self.assertEqual(result["callback_pointer_rva"], hex(POINTER_RVA))
        self.assertEqual(len(result["native_worker_registrations"]), 3)
        self.assertFalse(result["hook_installed"])

    def test_other_callback_and_rerouted_source_are_rejected(self):
        altered = synthetic_original()
        struct.pack_into("<Q", altered, POINTER_RVA, 0x42CA44)
        with self.assertRaisesRegex(ValueError, "table"):
            audit_callback_registration(altered)
        altered = synthetic_original()
        struct.pack_into("<I", altered, CALLBACK_SETUP[0][1], encode_ldr(8, 8, 0x7A8))
        with self.assertRaisesRegex(ValueError, "loads"):
            audit_callback_registration(altered)

    def test_unexpected_registration_storage_is_rejected(self):
        altered = synthetic_original()
        struct.pack_into("<I", altered, CALLBACK_SETUP[0][2], encode_str(22, 8, 0x280))
        with self.assertRaisesRegex(ValueError, "storage"):
            audit_callback_registration(altered)


if __name__ == "__main__":
    unittest.main()
