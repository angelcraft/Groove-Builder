"""Safe shared-manifest validation; no game resources or Switch required."""

import copy
import importlib.util
import json
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "extended_catalog_generator", Path(__file__).with_name("generate_extended_catalog.py")
)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


def manifest():
    return json.loads(catalog.DEFAULT_MANIFEST.read_text(encoding="utf-8"))


class ExtendedCatalogTests(unittest.TestCase):
    def test_first_entry_is_exactly_hoop3(self):
        data = manifest()
        entries = catalog.validate_manifest(data)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["virtual_index"], 80)
        self.assertEqual(entries[0]["slot"], {"world": 1, "column": 9, "row": 0})
        self.assertEqual(entries[0]["native_fallback"],
                         {"kind": 1, "index": 41, "stage_factory_id": 68})
        self.assertFalse(entries[0]["integration"]["virtual_launch_installed"])
        self.assertIsNone(entries[0]["gameplay"]["sequence_asset"])

    def test_generated_header_matches_manifest(self):
        self.assertEqual(catalog.generate_header(manifest()),
                         catalog.DEFAULT_HEADER.read_text(encoding="utf-8"))

    def test_original_index_79_allowed_but_80_not(self):
        data = manifest()
        data["entries"][0]["native_fallback"]["index"] = 80
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_virtual_id_must_not_overlap_native_entries(self):
        data = manifest()
        data["entries"][0]["virtual_index"] = 79
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_planned_capacity_is_larger_than_eighty_not_native_enabled(self):
        data = manifest()
        self.assertEqual(data["original_kind1_count"], 80)
        self.assertEqual(data["planned_kind1_capacity"], 256)
        data["entries"][0]["virtual_index"] = 256
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_borrowed_stage_must_match_verified_hoop2(self):
        data = manifest()
        data["entries"][0]["native_fallback"]["stage_factory_id"] = 67
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_future_entries_can_be_added_without_doubling_existing_ids(self):
        data = manifest()
        next_entry = copy.deepcopy(data["entries"][0])
        next_entry["id"] = "groove.future_01"
        next_entry["virtual_index"] = 81
        next_entry["slot"] = {"world": 1, "column": 9, "row": 1}
        next_entry["progress"]["namespace"] = "groove.future_01"
        data["entries"].append(next_entry)
        self.assertEqual(len(catalog.validate_manifest(data)), 2)
        data["entries"][1]["virtual_index"] = 80
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_duplicate_slot_rejected(self):
        data = manifest()
        duplicate = copy.deepcopy(data["entries"][0])
        duplicate["id"] = "groove.future_02"
        duplicate["virtual_index"] = 81
        duplicate["progress"]["namespace"] = "groove.future_02"
        data["entries"].append(duplicate)
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_duplicate_progress_namespace_rejected(self):
        data = manifest()
        duplicate = copy.deepcopy(data["entries"][0])
        duplicate["id"] = "groove.future_03"
        duplicate["virtual_index"] = 81
        duplicate["slot"] = {"world": 1, "column": 9, "row": 1}
        data["entries"].append(duplicate)
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_future_resource_paths_must_be_safe(self):
        data = manifest()
        for path in ("/sdmc/private.bin", "romfs/../../private.bin", "romfs//file.bin",
                     "romfs/../foo.bin", "romfs\\other\\file"):
            with self.subTest(path=path):
                data["entries"][0]["resources"]["music"] = path
                with self.assertRaises(catalog.CatalogError):
                    catalog.validate_manifest(data)

    def test_reject_unverified_gameplay_claims(self):
        data = manifest()
        data["entries"][0]["integration"]["gameplay_tested_on_switch"] = True
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_reject_experimental_skip_without_launch(self):
        data = manifest()
        data["entries"][0]["gameplay"]["skip_practice_installed"] = True
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)

    def test_reject_unknown_field_and_boolean_integer(self):
        data = manifest()
        data["surprise"] = "oops"
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)
        data = manifest()
        data["entries"][0]["virtual_index"] = True
        with self.assertRaises(catalog.CatalogError):
            catalog.validate_manifest(data)


if __name__ == "__main__":
    unittest.main()
