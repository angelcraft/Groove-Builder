#pragma once

// Inactive prologue-title bridge policy for the exact original callsite
// main+0x1D3384. Its caller still holds the menu Scene in x19; x0/x1 are the
// selected kind/index. No runtime callsite patch or global writes are enabled.

#include "hoop3_title_dispatch.hpp"
#include <cstdint>

namespace hoop3_intro {

using OriginalPrologue = void (*)(int, int);

struct Api {
    OriginalPrologue original = nullptr;
    hoop3_title::NativeMessageLookup lookup = nullptr;
    void* const* message_owner = nullptr;
    void** prologue_name_destination = nullptr;
    bool enabled = false;
};

inline bool should_override(const void* scene, int kind, int index) {
    // A short-circuit on native identity prevents dereferencing unrelated
    // Scene pointers, which have only been verified at this exact callsite.
    if (kind != 1 || index != 41 || !scene) return false;
    hoop3_title::Cell cell{
        hoop3_title::load<std::int32_t>(scene, hoop3_title::kSceneWorld),
        hoop3_title::load<std::int32_t>(scene, hoop3_title::kSceneColumn),
        hoop3_title::load<std::int32_t>(scene, hoop3_title::kSceneRow),
    };
    return hoop3_title::same_cell(cell, {1, 9, 0});
}

inline void dispatch(const Api& api, const void* scene, int kind, int index) {
    if (!api.original) return;
    // Preserve the entire native resource selection, including type_01 art,
    // stage-side effects and the original title on failures.
    api.original(kind, index);
    if (!__atomic_load_n(&api.enabled, __ATOMIC_ACQUIRE) ||
        !api.lookup || !api.message_owner || !api.prologue_name_destination ||
        !should_override(scene, kind, index)) return;
    void* owner = *api.message_owner;
    if (!owner || !*api.prologue_name_destination) return;
    auto* bank = static_cast<std::uint8_t*>(owner) + hoop3_title::kMessageNames;
    void* replacement = api.lookup(bank, hoop3_title::kHoop3Label, nullptr);
    if (replacement) *api.prologue_name_destination = replacement;
}

}  // namespace hoop3_intro
