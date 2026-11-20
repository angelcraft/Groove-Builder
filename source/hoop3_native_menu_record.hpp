#pragma once

// INACTIVE POLICY. The original menu copies its coordinates into the global
// manager after confirmation. A caller may *sample* these five fields as a
// second, independent check before binding a borrowed Stage68 object.
//
// Native offsets are validated in tools/audit_hoop3_native_selection_record.py.
// This file NEVER dereferences game pointers: doing so safely requires a live
// manager lease, a stable mode, and verified scene-transition ordering.

#include <cstddef>
#include <cstdint>

#include "groove_extended_catalog.hpp"

namespace hoop3_launch {

struct NativeMenuRecord {
    std::int32_t active_mode;
    std::int32_t world;
    std::int32_t column;
    std::int32_t row;
    std::int32_t native_index;
};

constexpr std::size_t kManagerCurrentMode = 0x2904;
constexpr std::size_t kManagerSavedWorld = 0xB98;
constexpr std::size_t kManagerSavedColumn = 0xB9A;
constexpr std::size_t kManagerSavedRow = 0xB9C;
constexpr std::size_t kManagerSavedIndex = 0xBA0;

constexpr bool matches_hoop3_native_record(const NativeMenuRecord& record) {
    return (record.active_mode == 0 || record.active_mode == 1) &&
           record.world == groove_extended::kEntries[0].world &&
           record.column == groove_extended::kEntries[0].column &&
           record.row == groove_extended::kEntries[0].row &&
           record.native_index == groove_extended::kEntries[0].native_index;
}

} // namespace hoop3_launch
