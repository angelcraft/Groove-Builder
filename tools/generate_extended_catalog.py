"""Validate the shared Android/Switch catalog and generate a C++17 header.

The JSON manifest is source of truth. Virtual indices are mod-owned IDs,
NEVER native kind=1 array indices. No private game files are read or shipped.
The generated header is inert source; it does not install any Switch hook.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "catalog/groove_extended_catalog.v1.json"
DEFAULT_HEADER = ROOT / "source/groove_extended_catalog.hpp"

ID_RE = re.compile(r"^[a-z][a-z0-9_.-]{2,79}$")
LABEL_RE = re.compile(r"^I_[A-Z0-9_]{1,40}$")
NATIVE_KIND1_COUNT = 80


class CatalogError(ValueError):
    """Invalid data must fail closed, never alias an original minigame."""


def exact(obj, required: set[str], label: str) -> None:
    if not isinstance(obj, dict) or set(obj) != required:
        raise CatalogError(f"{label}: invalid/missing/unrecognized fields")


def integer(value, low: int, high: int, label: str) -> int:
    if type(value) is not int or not low <= value <= high:
        raise CatalogError(f"{label}: expected integer {low}..{high}")
    return value


def boolean(value, label: str) -> bool:
    if type(value) is not bool:
        raise CatalogError(f"{label}: expected bool")
    return value


def named(value, label: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise CatalogError(f"{label}: invalid stable ID")
    return value


def safe_asset(value, label: str) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not value.startswith("romfs/"):
        raise CatalogError(f"{label}: asset must be a romfs/ relative reference")
    parts = value.split("/")
    if len(parts) < 3 or any(part in ("", ".", "..") for part in parts):
        raise CatalogError(f"{label}: unsafe asset path")
    if "\\" in value or "\x00" in value or len(value) > 200:
        raise CatalogError(f"{label}: invalid asset path")


def validate_manifest(document: dict) -> list[dict]:
    exact(document, {"schema_version", "catalog_id", "original_kind1_count", "entries"}, "root")
    integer(document["schema_version"], 1, 1, "schema_version")
    if document["catalog_id"] != "groove.extended":
        raise CatalogError("Unexpected catalog ID")
    integer(document["original_kind1_count"], NATIVE_KIND1_COUNT,
            NATIVE_KIND1_COUNT, "original_kind1_count")

    entries = document["entries"]
    if not isinstance(entries, list) or not 1 <= len(entries) <= 64:
        raise CatalogError("Expected 1..64 extended entries")

    used_indices: set[int] = set()
    used_slots: set[tuple[int, int, int]] = set()
    used_ids: set[str] = set()
    used_progress: set[str] = set()
    for index, item in enumerate(entries):
        label = f"entry[{index}]"
        exact(item, {"id", "virtual_index", "slot", "native_fallback", "text",
                     "resources", "gameplay", "progress", "integration"}, label)
        unique_id = named(item["id"], f"{label}.id")
        virtual_index = integer(item["virtual_index"], NATIVE_KIND1_COUNT, 65535,
                                f"{label}.virtual_index")

        slot = item["slot"]
        exact(slot, {"world", "column", "row"}, f"{label}.slot")
        world = integer(slot["world"], 0, 2, f"{label}.world")
        column = integer(slot["column"], 0, 11, f"{label}.column")
        row = integer(slot["row"], 0, 4, f"{label}.row")

        native = item["native_fallback"]
        exact(native, {"kind", "index", "stage_factory_id"}, f"{label}.native_fallback")
        # v1 only supports the audited native kind1 family. Expansion to other
        # families needs an independently verified descriptor table boundary.
        integer(native["kind"], 1, 1, f"{label}.native.kind")
        integer(native["index"], 0, NATIVE_KIND1_COUNT - 1, f"{label}.native.index")
        integer(native["stage_factory_id"], 0, 161, f"{label}.native.stage")

        msg = item["text"]
        exact(msg, {"display_name_es", "original_instruction_label",
                    "new_instruction_label", "messages_installed"}, f"{label}.text")
        if not isinstance(msg["display_name_es"], str) or not 1 <= len(msg["display_name_es"]) <= 96:
            raise CatalogError(f"{label}: missing Spanish display name")
        original_label = msg["original_instruction_label"]
        new_label = msg["new_instruction_label"]
        if not isinstance(original_label, str) or not LABEL_RE.fullmatch(original_label):
            raise CatalogError(f"{label}: invalid original label")
        if not isinstance(new_label, str) or not LABEL_RE.fullmatch(new_label) or new_label == original_label:
            raise CatalogError(f"{label}: invalid replacement label")
        boolean(msg["messages_installed"], f"{label}.messages_installed")

        assets = item["resources"]
        exact(assets, {"original_prologue", "new_icon", "new_intro", "music", "cue_bank"},
              f"{label}.resources")
        if not isinstance(assets["original_prologue"], str) or not re.fullmatch(
            r"graph/prologue/[a-z0-9_]+/type_[0-9]{2}/prologue", assets["original_prologue"]
        ):
            raise CatalogError(f"{label}: invalid original prologue reference")
        for resource_field in ("new_icon", "new_intro", "music", "cue_bank"):
            safe_asset(assets[resource_field], f"{label}.{resource_field}")

        game = item["gameplay"]
        exact(game, {"target_ring_count", "sequence_asset", "skip_practice_requested",
                     "skip_practice_installed"}, f"{label}.gameplay")
        integer(game["target_ring_count"], 0, 9999, f"{label}.target_ring_count")
        safe_asset(game["sequence_asset"], f"{label}.sequence_asset")
        boolean(game["skip_practice_requested"], f"{label}.skip_practice_requested")
        boolean(game["skip_practice_installed"], f"{label}.skip_practice_installed")

        progress = item["progress"]
        exact(progress, {"namespace", "independent_records_installed"}, f"{label}.progress")
        progress_name = named(progress["namespace"], f"{label}.progress.namespace")
        boolean(progress["independent_records_installed"], f"{label}.records_installed")

        integration = item["integration"]
        exact(integration, {"menu_cell_seen_on_switch", "virtual_launch_installed",
                            "gameplay_tested_on_switch"}, f"{label}.integration")
        for field in integration:
            boolean(integration[field], f"{label}.{field}")

        # Do not let a manifest declare unverified independent playability.
        if integration["virtual_launch_installed"] and not integration["menu_cell_seen_on_switch"]:
            raise CatalogError(f"{label}: virtual launch without a real menu cell")
        if integration["gameplay_tested_on_switch"] and not (
            integration["virtual_launch_installed"] and game["sequence_asset"]
        ):
            raise CatalogError(f"{label}: tested gameplay without a playable sequence")
        if game["skip_practice_installed"] and not integration["virtual_launch_installed"]:
            raise CatalogError(f"{label}: practice-skip cannot precede virtual launch")
        if progress["independent_records_installed"] and not integration["virtual_launch_installed"]:
            raise CatalogError(f"{label}: independent records require virtual launch")

        if unique_id in used_ids or virtual_index in used_indices or (world, column, row) in used_slots:
            raise CatalogError(f"{label}: duplicate ID/index/slot")
        if progress_name in used_progress:
            raise CatalogError(f"{label}: duplicate progress namespace")
        used_ids.add(unique_id)
        used_indices.add(virtual_index)
        used_slots.add((world, column, row))
        used_progress.add(progress_name)

    # Keep the first compiled entry pinned to the *proven* Hoop3 prototype.
    first = entries[0]
    if (first["id"], first["virtual_index"], first["slot"], first["native_fallback"]) != (
        "groove.hoop_trundling_3", 80,
        {"world": 1, "column": 9, "row": 0},
        {"kind": 1, "index": 41, "stage_factory_id": 68},
    ):
        raise CatalogError("Entry 80 must preserve verified Hoop3 origin and Stage68 fallback")
    return entries


def generate_header(document: dict) -> str:
    entries = validate_manifest(document)

    def quote(value: str) -> str:
        return json.dumps(value, ensure_ascii=False)

    records = []
    for item in entries:
        slot, native, msg = item["slot"], item["native_fallback"], item["text"]
        game, prog, integration = item["gameplay"], item["progress"], item["integration"]
        records.append("    {" + ", ".join((
            quote(item["id"]), str(item["virtual_index"]),
            str(slot["world"]), str(slot["column"]), str(slot["row"]),
            str(native["kind"]), str(native["index"]), str(native["stage_factory_id"]),
            quote(msg["display_name_es"]), quote(msg["original_instruction_label"]),
            quote(msg["new_instruction_label"]), quote(prog["namespace"]),
            str(game["target_ring_count"]),
            "true" if game["skip_practice_requested"] else "false",
            "true" if msg["messages_installed"] else "false",
            "true" if integration["virtual_launch_installed"] else "false",
            "true" if prog["independent_records_installed"] else "false",
        )) + "},")

    return """#pragma once

// GENERATED. Source: catalog/groove_extended_catalog.v1.json
// Regenerate/check with tools/generate_extended_catalog.py.
// Inert lookup metadata: virtual indices NEVER go into original native arrays.
#include <cstddef>
#include <cstdint>

namespace groove_extended {

struct Entry {
    const char* id;
    std::uint32_t virtual_index;
    int world;
    int column;
    int row;
    int native_kind;
    int native_index;
    int native_stage_factory_id;
    const char* display_name_es;
    const char* borrowed_label;
    const char* replacement_label;
    const char* progress_namespace;
    std::uint32_t target_ring_count;
    bool skip_practice_requested;
    bool messages_installed;
    bool virtual_launch_installed;
    bool independent_records_installed;
};

constexpr std::uint32_t kSchemaVersion = 1;
constexpr std::uint32_t kOriginalKind1Count = 80;
constexpr std::uint32_t kHoop3VirtualIndex = 80;
constexpr Entry kEntries[] = {
""" + "\n".join(records) + """
};

constexpr std::size_t kEntryCount = sizeof(kEntries) / sizeof(kEntries[0]);
constexpr bool native_index_safe(int kind, int index) {
    return kind == 1 && index >= 0 && index < static_cast<int>(kOriginalKind1Count);
}
constexpr const Entry* find_slot(int world, int column, int row) {
    for (const auto& entry : kEntries)
        if (entry.world == world && entry.column == column && entry.row == row)
            return &entry;
    return nullptr;
}
constexpr const Entry* find_virtual(std::uint32_t virtual_index) {
    for (const auto& entry : kEntries)
        if (entry.virtual_index == virtual_index) return &entry;
    return nullptr;
}
constexpr bool matches_hoop3(int world, int column, int row, int kind, int index) {
    const auto* entry = find_slot(world, column, row);
    return entry && entry->virtual_index == kHoop3VirtualIndex &&
           entry->native_kind == kind && entry->native_index == index;
}
constexpr bool valid_entries() {
    for (std::size_t i = 0; i < kEntryCount; ++i) {
        const auto& a = kEntries[i];
        if (a.virtual_index < kOriginalKind1Count ||
            !native_index_safe(a.native_kind, a.native_index) ||
            a.world < 0 || a.world > 2 || a.column < 0 || a.column > 11 ||
            a.row < 0 || a.row > 4 || !a.id || !a.id[0] ||
            !a.progress_namespace || !a.progress_namespace[0]) return false;
        for (std::size_t j = 0; j < i; ++j) {
            const auto& b = kEntries[j];
            if (a.virtual_index == b.virtual_index ||
                (a.world == b.world && a.column == b.column && a.row == b.row))
                return false;
        }
    }
    return true;
}
static_assert(valid_entries(), "Invalid extended catalog");
static_assert(kEntries[0].virtual_index == kHoop3VirtualIndex &&
              kEntries[0].native_kind == 1 && kEntries[0].native_index == 41 &&
              kEntries[0].native_stage_factory_id == 68,
              "Hoop3 must keep the pinned Stage68 fallback");

}  // namespace groove_extended
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--header", type=Path, default=DEFAULT_HEADER)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="Fail if checked-in header differs")
    group.add_argument("--write", action="store_true", help="Regenerate checked-in header")
    args = parser.parse_args()
    try:
        document = json.loads(args.manifest.read_text(encoding="utf-8"))
        content = generate_header(document)
        if args.check:
            if not args.header.is_file() or args.header.read_text(encoding="utf-8") != content:
                raise CatalogError("Generated C++ header is missing or stale")
            print(f"Extended catalog verified: {len(document['entries'])} mod entry")
        else:
            args.header.write_text(content, encoding="utf-8")
            print(f"Regenerated {args.header}")
    except (CatalogError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
