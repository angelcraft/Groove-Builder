"""Synthetic NPDM bounds and FS permission audit tests."""

import hashlib
import struct
import unittest

import audit_hoop3_npdm_sd as audit


def fake_npdm(fs_permissions: int) -> bytes:
    data = bytearray(0x700)
    data[:4] = b"META"
    struct.pack_into("<IIII", data, 0x70, 0x450, 0x200, 0x80, 0x3D0)
    data[0x450:0x454] = b"ACI0"
    struct.pack_into("<Q", data, 0x460, audit.ORIGINAL_PROGRAM_ID)
    struct.pack_into("<II", data, 0x470, 0x40, 0x20)
    data[0x280:0x284] = b"ACID"
    struct.pack_into("<II", data, 0x2A0, 0x240, 0x20)
    struct.pack_into("<IQ", data, 0x490, 1, fs_permissions)
    struct.pack_into("<IQ", data, 0x2C0, 1, fs_permissions)
    return bytes(data)


class NpdmSdRightsTests(unittest.TestCase):
    def test_sd_bit_absent_even_when_debug_flag_set(self):
        raw = fake_npdm(audit.DEBUG_ONLY_FLAG)
        report = audit.analyze_npdm(raw, hashlib.sha256(raw).hexdigest())
        self.assertFalse(report["sd_fs_access_bit_present"])
        self.assertTrue(report["debug_only_flag_present"])
        self.assertFalse(report["direct_sd_open_proven"])

    def test_explicit_permission_does_not_prove_live_mount(self):
        raw = fake_npdm(audit.DEBUG_ONLY_FLAG | audit.SD_FS_ACCESS)
        report = audit.analyze_npdm(raw, hashlib.sha256(raw).hexdigest())
        self.assertTrue(report["sd_fs_access_bit_present"])
        self.assertFalse(report["direct_sd_open_proven"])

    def test_bad_checksum_and_malformed_bounds_fail(self):
        raw = fake_npdm(0)
        with self.assertRaisesRegex(ValueError, "SHA"):
            audit.analyze_npdm(raw, "0" * 64)
        altered = bytearray(raw)
        struct.pack_into("<I", altered, 0x70, 0x6F0)
        with self.assertRaisesRegex(ValueError, "section"):
            audit.analyze_npdm(bytes(altered), hashlib.sha256(altered).hexdigest())


if __name__ == "__main__":
    unittest.main()
