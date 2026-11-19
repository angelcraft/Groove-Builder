#pragma once

// A two-callsite plan for the Switch *text-only* Hoop 3 experiment.
// No writes, permissions, thread stopping, or deployment authority here.
#include "switch_startup_plan.hpp"
#include <cstddef>
#include <cstdint>

namespace hoop3_text_patch {

constexpr std::size_t kCount = 2;
struct Site { std::uintptr_t offset; std::uint32_t original; };
constexpr Site kSites[kCount] = {
    {0x1D0204u, 0x97F8CA73u}, // BL main+0x2BD0 (normal title)
    {0x1D0240u, 0x940C7F10u}, // BL main+0x4EFE80 (instruction text)
};

enum class Status : std::uint32_t {
    candidate_only = 0,
    identity_mismatch = 1,
    invalid_module_layout = 2,
    source_conflict = 3,
    branch_unreachable = 4,
};

struct Facts {
    std::uintptr_t main_start{};
    std::size_t main_text_size{};
    std::uintptr_t carrier_start{};
    std::size_t carrier_text_size{};
    const std::uint8_t* game_build_id{};  // Canonical 32-byte GNU ID.
    const std::uint8_t* sdk_build_id{};   // Canonical 32-byte GNU ID.
    std::uint32_t source_words[kCount]{};
    std::uintptr_t handlers[kCount]{};
};

struct Plan {
    Status status{Status::invalid_module_layout};
    std::uint32_t calls[kCount]{};
    // A static plan never asserts code-cache, exclusivity or GPU correctness.
    bool runtime_verified{false};
};

constexpr std::uint8_t kFullSdkBuildId[32] = {
    0xcf, 0xf2, 0x68, 0x0f, 0xe7, 0x4c, 0xb7, 0xd8,
    0xd1, 0x3b, 0x52, 0x57, 0x30, 0xd1, 0xa7, 0xfd,
    0x9a, 0x3f, 0x36, 0xf0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
};

inline Plan prepare(const Facts& facts) {
    Plan plan{};
    if (!menu_column_switch::matches(facts.game_build_id,
                                     menu_column_switch::kGameBuildId) ||
        !menu_column_switch::matches(facts.sdk_build_id, kFullSdkBuildId)) {
        plan.status=Status::identity_mismatch;
        return plan;
    }
    if (!menu_column_switch::in_span(facts.main_start, 4, facts.main_start,
                                    facts.main_text_size) ||
        !menu_column_switch::in_span(facts.carrier_start, 4,
                                    facts.carrier_start, facts.carrier_text_size) ||
        menu_column_switch::overlaps(facts.main_start, facts.main_text_size,
                                     facts.carrier_start, facts.carrier_text_size)) {
        plan.status=Status::invalid_module_layout;
        return plan;
    }
    for (std::size_t i=0; i<kCount; ++i) {
        if (!menu_column_switch::in_span(facts.main_start+kSites[i].offset,4,
                                         facts.main_start,facts.main_text_size) ||
            !menu_column_switch::in_span(facts.handlers[i],4,
                                         facts.carrier_start,facts.carrier_text_size)) {
            plan.status=Status::invalid_module_layout;
            return plan;
        }
        if (facts.source_words[i]!=kSites[i].original) {
            plan.status=Status::source_conflict;
            return plan;
        }
        std::uint32_t bits{};
        if (!menu_column_switch::b_instruction(
                facts.main_start+kSites[i].offset,facts.handlers[i],&bits)) {
            plan.status=Status::branch_unreachable;
            return plan;
        }
        plan.calls[i]=(bits&0x03ffffffu)|0x94000000u; // BL, not B.
    }
    plan.status=Status::candidate_only;
    return plan;
}

} // namespace hoop3_text_patch
