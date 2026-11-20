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

// One module can serve several *independently verified* menu cells. Keep this
// list compile-time and fail closed: future rows must not become active just
// because another icon has been added to the SPR. The other slots below are
// deliberately absent until their native selection identity is established.
struct Cell {
    std::int32_t world;
    std::int32_t column;
    std::int32_t row;
};

struct TextOverride {
    Cell cell;
    int native_kind;
    int native_index;
    const char* borrowed_label;
    const char* replacement_label;
};

constexpr TextOverride kTextOverrides[] = {
    {{1, 9, 0}, 1, 41, kHoop2Label, kHoop3Label},
};

template <std::size_t N>
constexpr bool valid_catalog(const TextOverride (&catalog)[N]) {
    for (std::size_t i = 0; i < N; ++i) {
        const auto& a = catalog[i];
        if (a.cell.world < 0 || a.cell.world > 2 ||
            a.cell.column < 0 || a.cell.column > 11 ||
            a.cell.row < 0 || a.cell.row > 4 ||
            a.native_kind < 0 || a.native_index < 0 ||
            !a.borrowed_label || !a.borrowed_label[0] ||
            !a.replacement_label || !a.replacement_label[0]) return false;
        for (std::size_t j = 0; j < i; ++j) {
            const auto& b = catalog[j];
            if (a.cell.world == b.cell.world &&
                a.cell.column == b.cell.column &&
                a.cell.row == b.cell.row) return false;
        }
    }
    return true;
}
static_assert(valid_catalog(kTextOverrides), "Invalid or duplicate menu cell");

template <typename T>
inline T load(const void* source, std::size_t offset) {
    T value{};
    std::memcpy(&value, static_cast<const std::uint8_t*>(source) + offset, sizeof(value));
    return value;
}

inline bool read_cell(const void* panel, Cell* result) {
    if (!panel || !result) return false;
    const auto scene = load<const void*>(panel, kPanelScene);
    if (!scene) return false;
    // This routine is ONLY valid at the pinned native menu callsite, where
    // both panel and Scene are already known alive. It is not a safe general
    // pointer validator or an installer.
    result->world = load<std::int32_t>(scene, kSceneWorld);
    result->column = load<std::int32_t>(scene, kSceneColumn);
    result->row = load<std::int32_t>(scene, kSceneRow);
    return true;
}

inline bool same_cell(const Cell& a, const Cell& b) {
    return a.world == b.world && a.column == b.column && a.row == b.row;
}

inline const TextOverride* find_title_override(const void* panel,
                                               int kind, int index,
                                               const TextOverride* entries,
                                               std::size_t count) {
    if (!entries) return nullptr;
    // Preserve the original short circuit: for unrelated native calls do not
    // dereference x19/panel at all, even when a caller provides a stale value.
    bool native_match = false;
    for (std::size_t i = 0; i < count; ++i)
        native_match |= kind == entries[i].native_kind &&
                        index == entries[i].native_index;
    if (!native_match) return nullptr;
    Cell cell{};
    if (!read_cell(panel, &cell)) return nullptr;
    for (std::size_t i = 0; i < count; ++i) {
        if (same_cell(cell, entries[i].cell) &&
            kind == entries[i].native_kind &&
            index == entries[i].native_index) return &entries[i];
    }
    return nullptr;
}

inline const TextOverride* find_instruction_override(const void* panel,
                                                     const char* original_label,
                                                     const TextOverride* entries,
                                                     std::size_t count) {
    if (!entries || !original_label) return nullptr;
    bool label_match = false;
    for (std::size_t i = 0; i < count; ++i)
        if (entries[i].borrowed_label &&
            std::strcmp(original_label, entries[i].borrowed_label) == 0)
            label_match = true;
    if (!label_match) return nullptr;
    Cell cell{};
    if (!read_cell(panel, &cell)) return nullptr;
    for (std::size_t i = 0; i < count; ++i) {
        if (same_cell(cell, entries[i].cell) && entries[i].borrowed_label &&
            std::strcmp(original_label, entries[i].borrowed_label) == 0)
            return &entries[i];
    }
    return nullptr;
}

inline bool is_experimental_selection(const void* panel, int kind, int index) {
    return find_title_override(panel, kind, index, kTextOverrides,
                               sizeof(kTextOverrides) / sizeof(kTextOverrides[0])) != nullptr;
}

inline void* dispatch_with_catalog(const Api& api, const void* panel,
                                   int kind, int index,
                                   const TextOverride* entries, std::size_t count) {
    if (!api.original) return nullptr;  // Never install a bridge unbound.
    if (__atomic_load_n(&api.enabled, __ATOMIC_ACQUIRE) &&
        api.lookup && api.message_owner) {
        if (const auto* override = find_title_override(panel, kind, index,
                                                       entries, count)) {
            void* owner = *api.message_owner;
            if (owner) {
                auto* bank = static_cast<std::uint8_t*>(owner) + kMessageNames;
                // The original main uses exactly these 3 arguments at +0x26ec.
                void* title = api.lookup(bank, override->replacement_label, nullptr);
                if (title) return title;
            }
        }
    }
    return api.original(kind, index);
}

inline void* dispatch(const Api& api, const void* panel, int kind, int index) {
    return dispatch_with_catalog(api, panel, kind, index, kTextOverrides,
                                 sizeof(kTextOverrides) / sizeof(kTextOverrides[0]));
}

// Native menu+0x1D0240 is the separate *instruction* message call, with
// x0=scene instruction bank, x1=resource label, x2=null and x19=panel.
// Routing at this point leaves both the normal Hoop 2 label and its cached
// game title intact. A missing custom message falls back to the native label.
inline void* dispatch_instruction_with_catalog(const Api& api, const void* panel,
                                               void* instruction_bank, const char* label,
                                               void* context,
                                               const TextOverride* entries,
                                               std::size_t count) {
    if (!api.lookup || !label) return nullptr;  // Never install an unbound bridge.
    if (__atomic_load_n(&api.enabled, __ATOMIC_ACQUIRE)) {
        if (const auto* override = find_instruction_override(panel, label,
                                                             entries, count)) {
            if (void* message = api.lookup(instruction_bank,
                                           override->replacement_label, context))
                return message;
        }
    }
    return api.lookup(instruction_bank, label, context);
}

inline void* dispatch_instruction(const Api& api, const void* panel,
                                  void* instruction_bank, const char* label,
                                  void* context) {
    return dispatch_instruction_with_catalog(api, panel, instruction_bank,
                                             label, context, kTextOverrides,
                                             sizeof(kTextOverrides) / sizeof(kTextOverrides[0]));
}

}  // namespace hoop3_title
