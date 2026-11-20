"""Synthetic-only tests of strict NUL-delimited Switch FS symbol matching."""

import unittest

from audit_hoop3_nnfs_imports import REQUIRED_SYMBOLS, audit_imports


def fake_dynamic_symbols() -> bytes:
    return b"\0" + b"\0".join(s.encode("ascii") for s in REQUIRED_SYMBOLS.values()) + b"\0"


class NativeFsImportsTests(unittest.TestCase):
    def test_all_required_symbols_exact_and_no_runtime_claims(self):
        report = audit_imports(fake_dynamic_symbols())
        self.assertTrue(report["mount_rom_requires_cache"])
        self.assertFalse(report["native_calls_bound"])
        self.assertFalse(report["layeredfs_file_visible_on_switch"])

    def test_missing_mount_cache_query_blocks(self):
        data = fake_dynamic_symbols().replace(
            REQUIRED_SYMBOLS["QueryMountRomCacheSize"].encode("ascii"), b"changed")
        with self.assertRaisesRegex(ValueError, "QueryMountRomCacheSize"):
            audit_imports(data)

    def test_prefix_substring_not_accepted_as_import(self):
        mount = REQUIRED_SYMBOLS["MountRom"].encode("ascii")
        data = fake_dynamic_symbols().replace(b"\0" + mount + b"\0",
                                              b"\0" + mount + b"Extra\0")
        with self.assertRaisesRegex(ValueError, "MountRom"):
            audit_imports(data)


if __name__ == "__main__":
    unittest.main()
