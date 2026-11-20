#pragma once

// READ-ONLY candidate for interposing Stage68's original sequence callback.
// The original normal worker reads main DATA+0xD9C7A0 and installs the result
// as a game-owned worker callback. This can potentially avoid modifying
// executable instructions. This plan DOES NOT write to that pointer, stop
// native threads, prove DATA permissions, or authorize installation.

#include <cstddef>
#include <cstdint>

#include "switch_startup_plan.hpp"

namespace hoop3_sequence_pointer {

constexpr std::uintptr_t kPointerRva = 0xD9C7A0;
constexpr std::uintptr_t kOriginalWorkerRva = 0x42CA40;
constexpr std::uintptr_t kNativeDataStartRva = 0xCD9000;
constexpr std::size_t kMinimumDataSize = 0x3CE310;
constexpr std::uintptr_t kOtherCallbacks[2] = {0x42E010, 0x42DF60};

struct Instruction {
    std::uintptr_t rva;
    std::uint32_t original;
};
constexpr Instruction kRegistration[4] = {
    {0x42C7A4, 0x90004B88}, // ADRP x8, main callback DATA page
    {0x42C7B4, 0xF943D108}, // LDR x8, [x8,#0x7A0]
    {0x42C7C0, 0xF90146C8}, // STR x8, [x22,#0x288]
    {0x42C7C4, 0x9403A2F7}, // BL original game worker setup
};

enum class Status : std::uint8_t {
    candidate_only,
    identity_mismatch,
    invalid_layout,
    other_mod_owns_slot,
    callback_drift,
    invalid_interposer,
};

struct Facts {
    std::uintptr_t main_base{};
    std::uintptr_t data_start{};
    std::size_t data_size{};
    std::uintptr_t carrier_text_start{};
    std::size_t carrier_text_size{};
    std::uintptr_t interposer{};
    const std::uint8_t* game_build_id{};
    const std::uint8_t* sdk_build_id{};
    std::uintptr_t observed_callback{};
    std::uintptr_t observed_other_callbacks[2]{};
    std::uint32_t observed_registration[4]{};
};

struct Plan {
    Status status = Status::invalid_layout;
    std::uintptr_t pointer_address{};
    std::uintptr_t original_callback{};
    std::uintptr_t candidate_interposer{};
    bool writable_verified_on_switch = false;
    bool lifecycle_verified_on_switch = false;
    bool install_authorized = false;
};

inline Plan preflight(const Facts& facts) {
    Plan plan{};
    if (!menu_column_switch::matches(facts.game_build_id,
                                     menu_column_switch::kGameBuildId) ||
        !menu_column_switch::matches(facts.sdk_build_id,
                                     menu_column_switch::kSdkBuildId)) {
        plan.status = Status::identity_mismatch;
        return plan;
    }
    if (!facts.main_base || facts.main_base % 4 != 0 ||
        facts.main_base > UINTPTR_MAX - kPointerRva - 24 ||
        facts.data_start != facts.main_base + kNativeDataStartRva ||
        facts.data_size < kMinimumDataSize ||
        !menu_column_switch::in_span(facts.main_base + kPointerRva, 24,
                                     facts.data_start, facts.data_size)) {
        plan.status = Status::invalid_layout;
        return plan;
    }
    if (!menu_column_switch::in_span(facts.interposer, 4,
                                     facts.carrier_text_start,
                                     facts.carrier_text_size) ||
        (facts.interposer & 3u) != 0 ||
        facts.interposer == facts.main_base + kOriginalWorkerRva) {
        plan.status = Status::invalid_interposer;
        return plan;
    }
    for (std::size_t i = 0; i < 4; ++i) {
        if (facts.observed_registration[i] != kRegistration[i].original) {
            plan.status = Status::callback_drift;
            return plan;
        }
    }
    if (facts.observed_callback != facts.main_base + kOriginalWorkerRva ||
        facts.observed_other_callbacks[0] != facts.main_base + kOtherCallbacks[0] ||
        facts.observed_other_callbacks[1] != facts.main_base + kOtherCallbacks[1]) {
        plan.status = Status::other_mod_owns_slot;
        return plan;
    }
    plan.pointer_address = facts.main_base + kPointerRva;
    plan.original_callback = facts.observed_callback;
    plan.candidate_interposer = facts.interposer;
    plan.status = Status::candidate_only;
    return plan;
}

} // namespace hoop3_sequence_pointer
