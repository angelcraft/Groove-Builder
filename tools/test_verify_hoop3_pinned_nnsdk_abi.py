"""Pure host regressions for the pinned NNSDK symbol audit."""

import unittest

from verify_hoop3_pinned_nnsdk_abi import (
    expected_native_reader_symbols,
    parse_unresolved_nnsdk_symbols,
    validate_aarch64_relocatable_elf,
    validate_reader_symbols,
)


class PinnedNnsdkAbiTests(unittest.TestCase):
    def test_accepts_exact_four_original_main_reader_imports(self):
        expected = expected_native_reader_symbols()
        fixture = "\n".join(f"                 U {name}" for name in sorted(expected))
        self.assertEqual(parse_unresolved_nnsdk_symbols(fixture), expected)
        validate_reader_symbols(parse_unresolved_nnsdk_symbols(fixture))

    def test_rejects_missing_readfile_import(self):
        parsed = expected_native_reader_symbols()
        parsed.remove(next(item for item in parsed if "8ReadFileE" in item))
        with self.assertRaisesRegex(ValueError, "missing="):
            validate_reader_symbols(parsed)

    def test_rejects_wrong_readfile_overload(self):
        parsed = expected_native_reader_symbols()
        parsed.remove(next(item for item in parsed if "8ReadFileE" in item))
        parsed.add("_ZN2nn2fs8ReadFileENS0_10FileHandleElPvm")
        with self.assertRaisesRegex(ValueError, "extra="):
            validate_reader_symbols(parsed)

    def test_ignores_unrelated_symbols_and_non_undefined_lines(self):
        output = """\
                 U _ZN2nn2fs8OpenFileEPNS0_10FileHandleEPKci
                 U _ZNSt8ios_base4InitC1Ev
0000000000000000 T _ZN2nn2fs8ReadFileEPmNS0_10FileHandleElPvm
                 U _ZN2nn2os10OtherCallEv
"""
        self.assertEqual(
            parse_unresolved_nnsdk_symbols(output),
            {"_ZN2nn2fs8OpenFileEPNS0_10FileHandleEPKci"},
        )

    def test_accepts_only_aarch64_rel_objects(self):
        valid = "Class:                             ELF64\n" \
                "Type:                              REL (Relocatable file)\n" \
                "Machine:                           AArch64\n"
        validate_aarch64_relocatable_elf(valid)
        with self.assertRaisesRegex(ValueError, "not AArch64"):
            validate_aarch64_relocatable_elf(valid.replace("AArch64", "Advanced Micro Devices X86-64"))
        with self.assertRaisesRegex(ValueError, "not a relocatable"):
            validate_aarch64_relocatable_elf(valid.replace("REL", "EXEC"))
        with self.assertRaisesRegex(ValueError, "not ELF64"):
            validate_aarch64_relocatable_elf(valid.replace("ELF64", "ELF32"))


if __name__ == "__main__":
    unittest.main()
