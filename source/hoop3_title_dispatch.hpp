#pragma once

// RESEARCH ONLY: callable bridge policy, no active Switch hook installer.
// Entry ABI would be original x0=kind,x1=index plus panel=x19 (via assembly).
// All pointers must be bound only after main/Scene lifetime and ABI preflight.
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace hoop3_title {

using NativeTitle = void* (*)(int, int);
using NativeMessageLookup = void* (*)(void*, const char*, void*);

struct Api {
    NativeTitle original = nullptr;
    NativeMessageLookup lookup = nullptr;
    void* const* message_owner = nullptr;  // *(main+0x10A73F0)
    bool enabled = false;
};

constexpr std::size_t kPanelScene = 0x8;
constexpr std::size_t kSceneWorld = 0x5274;
constexpr std::size_t kSceneColumn = 0x5298;
constexpr std::size_t kSceneRow = 0x529c;
constexpr std::size_t kMessageNames = 0x38;
constexpr char kHoop3Label[] = "I_RING_02";
constexpr char kHoop2Label[] = "I_RING_01";

template <typename T>
inline T load(const void* source, std::size_t offset) {
    T value{};
    std::memcpy(&value, static_cast<const std::uint8_t*>(source) + offset, sizeof(value));
    return value;
}

inline bool is_experimental_selection(const void* panel, int kind, int index) {
    if (kind != 1 || index != 41 || !panel) return false;
    const auto scene = load<const void*>(panel, kPanelScene);
    if (!scene) return false;
    // This routine is ONLY valid at the pinned native menu callsite, where
    // both panel and Scene are already known alive. It is not a safe general
    // pointer validator or an installer.
    return load<std::int32_t>(scene, kSceneWorld) == 1 &&
           load<std::int32_t>(scene, kSceneColumn) == 9 &&
           load<std::int32_t>(scene, kSceneRow) == 0;
}

inline void* dispatch(const Api& api, const void* panel, int kind, int index) {
    if (!api.original) return nullptr;  // Never install a bridge unbound.
    if (__atomic_load_n(&api.enabled, __ATOMIC_ACQUIRE) &&
        api.lookup && api.message_owner &&
        is_experimental_selection(panel, kind, index)) {
        void* owner = *api.message_owner;
        if (owner) {
            auto* bank = static_cast<std::uint8_t*>(owner) + kMessageNames;
            // The original main uses exactly these 3 arguments at +0x26ec.
            void* title = api.lookup(bank, kHoop3Label, nullptr);
            if (title) return title;
        }
    }
    return api.original(kind, index);
}

// Native menu+0x1D0240 is the separate *instruction* message call, with
// x0=scene instruction bank, x1=resource label, x2=null and x19=panel.
// Routing at this point leaves both the normal Hoop 2 label and its cached
// game title intact. A missing custom message falls back to the native label.
inline void* dispatch_instruction(const Api& api, const void* panel,
                                  void* instruction_bank, const char* label,
                                  void* context) {
    if (!api.lookup || !label) return nullptr;  // Never install an unbound bridge.
    if (__atomic_load_n(&api.enabled, __ATOMIC_ACQUIRE) && label &&
        std::strcmp(label, kHoop2Label) == 0 &&
        is_experimental_selection(panel, 1, 41)) {
        if (void* message = api.lookup(instruction_bank, kHoop3Label, context))
            return message;
    }
    return api.lookup(instruction_bank, label, context);
}

}  // namespace hoop3_title
