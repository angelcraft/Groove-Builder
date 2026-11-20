"""Synthetic tests only; no Nintendo data goes into GitHub."""

from pathlib import Path
import struct
import tempfile
import unittest
from zipfile import ZipFile

from audit_hoop3_prologue_route import (
    ASSET_TYPES, EvidenceMismatch, WORDS, audit_image, inspect_archive,
)


def native_fixture():
    image = bytearray(0xAD0C5C + 0x100)
    for pc, word in WORDS.items():
        struct.pack_into("<I", image, pc, word)
    for variant, pc in (("type_00", 0xA9744A),
                        ("type_01", 0xAD0C5C),
                        ("type_02", 0xA818E9)):
        label = f"graph/prologue/ring/{variant}/prologue\0".encode()
        image[pc:pc + len(label)] = label
    return image


def make_archive(path: Path, *, root="prologue/ring/", missing=None):
    header = bytearray(0x110)
    struct.pack_into("<I", header, 0x1C, 13)
    with ZipFile(path, "w") as archive:
        for variant in ASSET_TYPES:
            for ext in ("spr", "tex"):
                filename = f"{root}{variant}/prologue.{ext}"
                if filename != missing:
                    archive.writestr(filename, header if ext == "spr" else b"zstd-fixture")


class PrologueAuditTests(unittest.TestCase):
    def test_native_original_control_path(self):
        result = audit_image(native_fixture())
        self.assertFalse(result["custom_intro_hook_installed"])
        self.assertIn("kind0/index8", result["type02_direct_case"])

    def test_native_mutation_rejected(self):
        image = native_fixture()
        image[0x206D60] ^= 4
        with self.assertRaises(EvidenceMismatch):
            audit_image(image)

    def test_native_missing_type02_reference_rejected(self):
        image = native_fixture()
        image[0xA818E9] ^= 1
        with self.assertRaises(EvidenceMismatch):
            audit_image(image)

    def test_complete_private_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "prologue.zip"
            make_archive(path)
            report = inspect_archive(path)
            self.assertEqual(set(report), set(ASSET_TYPES))
            self.assertEqual(report["type_01"]["spr"]["parts"], 13)

    def test_missing_asset_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "prologue.zip"
            make_archive(path, missing="prologue/ring/type_02/prologue.tex")
            with self.assertRaises(EvidenceMismatch):
                inspect_archive(path)


if __name__ == "__main__":
    unittest.main()
