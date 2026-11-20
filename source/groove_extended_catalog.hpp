#pragma once

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
    {"groove.hoop_trundling_3", 80, 1, 9, 0, 1, 41, 68, "Pasar por el anillo 3", "I_RING_01", "I_RING_02", "groove.hoop_trundling_3", 54, true, false, false, false},
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
