"""No proprietary file is required to test the IPS format and fail-closed rules."""

import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

from audit_hoop3_practice_path import EvidenceMismatch
from build_stage68_global_probe import (
    BRANCH_SITE, BRANCH_TARGET, ORIGINAL_WORD, PROBE_WORD,
    create_ips, emit_kit, encode_unconditional_branch,
)


class Stage68GlobalProbeTests(unittest.TestCase):
    @staticmethod
    def original():
        fake_image = bytearray(BRANCH_SITE + 4)
        struct.pack_into("<I", fake_image, BRANCH_SITE, ORIGINAL_WORD)
        return fake_image

    def test_expected_native_branch(self):
        self.assertEqual(PROBE_WORD, 0x14000045)
        self.assertEqual(encode_unconditional_branch(BRANCH_SITE, BRANCH_TARGET), PROBE_WORD)

    def test_ips_exactly_one_instruction(self):
        ips = create_ips(self.original())
        self.assertEqual(ips, b"PATCH" + BRANCH_SITE.to_bytes(3, "big") +
                         b"\0\x04" + struct.pack("<I", PROBE_WORD) + b"EOF")
        self.assertEqual(len(ips), 17)

    def test_original_not_modified(self):
        original = self.original()
        before = bytes(original)
        create_ips(original)
        self.assertEqual(bytes(original), before)

    def test_rejects_different_instruction(self):
        changed = self.original()
        struct.pack_into("<I", changed, BRANCH_SITE, PROBE_WORD)
        with self.assertRaises(EvidenceMismatch):
            create_ips(changed)

    def test_rejects_truncated_mapping(self):
        with self.assertRaises(EvidenceMismatch):
            create_ips(b"\0" * 8)

    def test_rejects_invalid_arm_branch(self):
        for start, end in ((BRANCH_SITE, BRANCH_TARGET + 1),
                           (BRANCH_SITE, BRANCH_SITE + (1 << 27)),
                           (BRANCH_SITE, BRANCH_SITE - (1 << 27) - 4)):
            with self.assertRaises(EvidenceMismatch):
                encode_unconditional_branch(start, end)

    def test_reversible_bundle_and_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "probe"
            ips = create_ips(self.original())
            archive = emit_kit(output, ips, {"test": True})
            self.assertTrue(archive.is_file())
            with zipfile.ZipFile(archive) as bundle:
                files = bundle.namelist()
                self.assertEqual(len(files), 3)
                manifest = json.loads(bundle.read("manifest.json"))
                self.assertTrue(manifest["changes_original_hoop2"])
                self.assertFalse(manifest["independent_hoop3_level"])
                self.assertFalse(manifest["switch_hardware_tested"])
                self.assertIn("Stage68GlobalProbe", manifest["ips_relative_path"])
                self.assertEqual(bundle.read(manifest["ips_relative_path"]), ips)
                self.assertIn("NO INSTALES", bundle.read("LEEME.txt").decode())
            with self.assertRaises(FileExistsError):
                emit_kit(output, ips, {})


if __name__ == "__main__":
    unittest.main()
