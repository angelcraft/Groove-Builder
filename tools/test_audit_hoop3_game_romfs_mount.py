"""Synthetic regression checks for strict read-only original RomFS audit."""

import struct
import unittest

import audit_hoop3_game_romfs_mount as audit
import audit_hoop3_fs_init_chain as chain


def arm64_bl(site: int, target: int) -> int:
    delta = target - site
    if delta & 3:
        raise ValueError("Unaligned fake branch")
    return 0x94000000 | ((delta >> 2) & 0x03FFFFFF)


def fake_original() -> bytearray:
    # Deliberately synthetic sparse image; no user's binary is embedded.
    image = bytearray(0xAC7610)
    for site, target in ((audit.QUERY_CACHE_CALL, audit.QUERY_CACHE_PLT),
                         (audit.MOUNT_ROM_CALL, audit.MOUNT_ROM_PLT)):
        struct.pack_into("<I", image, site, arm64_bl(site, target))
    # Synthetic ADRP X0 / ADD X0 target points to a synthetic string.
    # The actual owner's verified main is separately checked by the CLI.
    struct.pack_into("<II", image, audit.MOUNT_NAME_PAGE,
                     0x90002DE0, 0x91180400)
    image[0xAC7601:0xAC7606] = b"data\0"
    return image


class OriginalRomfsMountTests(unittest.TestCase):
    def test_query_and_mount_existing_data(self):
        result = audit.audit_original_mount(fake_original())
        self.assertEqual(result["original_mount_name"], "data")
        self.assertFalse(result["requires_new_mount"])
        self.assertFalse(result["mount_survives_until_hoop3_load_proven"])

    def test_changed_mount_branch_rejected(self):
        image = fake_original()
        struct.pack_into("<I", image, audit.MOUNT_ROM_CALL, 0xD503201F)
        with self.assertRaisesRegex(ValueError, "call site drifted"):
            audit.audit_original_mount(image)

    def test_changed_mount_name_rejected(self):
        image = fake_original()
        image[0xAC7601:0xAC7605] = b"save"
        with self.assertRaisesRegex(ValueError, "mount name"):
            audit.audit_original_mount(image)

    def test_original_startup_to_game_init_to_mount_chain(self):
        image = fake_original()
        for site, target in ((chain.GAME_STARTUP_CALL, chain.GAME_INIT_FUNCTION),
                             (chain.INIT_MOUNT_CALL, chain.ORIGINAL_MOUNT_FUNCTION)):
            struct.pack_into("<I", image, site, arm64_bl(site, target))
        report = chain.audit_init_chain(image)
        self.assertEqual(report["original_romfs_mount_name"], "data")
        self.assertFalse(report["hook_point_safe_to_use"])
        struct.pack_into("<I", image, chain.INIT_MOUNT_CALL, 0xD503201F)
        with self.assertRaisesRegex(ValueError, "initialization branch drifted"):
            chain.audit_init_chain(image)


if __name__ == "__main__":
    unittest.main()
