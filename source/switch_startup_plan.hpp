// Read-only preflight for a possible Switch boot-time menu-column hook.
// No Horizon calls, memory mappings, writes, or install decision live here.
// Four original ARM64 entry instructions are pinned to the user's main build.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace menu_column_switch {

constexpr size_t kHookCount = 4;
constexpr size_t kGameBuildIdBytes = 32;
constexpr size_t kSdkBuildIdBytes = 16;
constexpr uint8_t kGameBuildId[kGameBuildIdBytes] = {
    0x03, 0xff, 0x4a, 0x3b, 0xec, 0x96, 0xbd, 0xe3,
    0xa2, 0xe3, 0x7c, 0xe3, 0xaa, 0x4c, 0xaa, 0x0c,
    0xae, 0x89, 0x35, 0xa8, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0
};
constexpr uint8_t kSdkBuildId[kSdkBuildIdBytes] = {
    0xcf, 0xf2, 0x68, 0x0f, 0xe7, 0x4c, 0xb7, 0xd8,
    0xd1, 0x3b, 0x52, 0x57, 0x30, 0xd1, 0xa7, 0xfd
};

struct HookSite {
    uintptr_t rva;
    uint32_t original_word;
};
// Source pinned to main SHA-256 494c35e74dae893615980134f8be7673779f8d4b9eb9601e0f1b130d5ee1870e.
constexpr HookSite kHookSites[kHookCount] = {
    {0x1d2800u, 0xd10203ffu}, // navigate: sub sp,sp,#0x80
    {0x1cc420u, 0xa9bf7bfdu}, // gate: stp x29,x30,[sp,#-16]!
    {0x1cc190u, 0xd101c3ffu}, // refresh: sub sp,sp,#0x70
    {0x4890u,   0x8b21c008u}  // save cursor: add x8,x0,w1,sxtw
};
constexpr uint32_t kNop = 0xd503201fu;

enum class Status : uint8_t {
    candidate_only = 0,     // No install or runtime/cache certification implied.
    identity_mismatch,
    invalid_text_range,
    unexpected_original_word,
    own_reservation_occupied,
    hook_address_outside_carrier,
    trampolines_overlap,
    branch_unreachable,
};

struct Facts {
    uintptr_t main_text_start;
    size_t main_text_size;
    uintptr_t carrier_text_start;
    size_t carrier_text_size;
    const uint8_t* game_build_id;
    const uint8_t* sdk_build_id;
    uint32_t observed_original_words[kHookCount];
    uint32_t observed_trampoline_words[kHookCount][2];
    uintptr_t hook_entries[kHookCount];
    uintptr_t trampoline_entries[kHookCount];
};

struct Patch {
    uintptr_t site;
    uintptr_t hook_entry;
    uintptr_t trampoline;
    uint32_t original_word;
    uint32_t site_branch;
    uint32_t trampoline_branch_back;
};

struct Plan {
    Status status = Status::invalid_text_range;
    Patch patches[kHookCount]{};
    // These remain false even when static instruction and identity checks pass.
    bool runtime_cache_verified = false;
    bool scene_lifetime_verified = false;
    bool install_authorized = false;
};

template<size_t N>
inline bool matches(const uint8_t* actual, const uint8_t (&expected)[N]) {
    if (!actual) return false;
    for (size_t i = 0; i < N; ++i)
        if (actual[i] != expected[i]) return false;
    return true;
}

inline bool overlaps(uintptr_t a, size_t a_bytes, uintptr_t b, size_t b_bytes) {
    return a >= b ? a - b < b_bytes : b - a < a_bytes;
}

inline bool in_span(uintptr_t address, size_t bytes, uintptr_t start, size_t size) {
    if (!start || !size || bytes > size || start > UINTPTR_MAX - size) return false;
    return address >= start && address - start <= size - bytes;
}

// Hakkun returns the GNU note descriptor, not the padded 32-byte NSO header.
// The pinned main/SDK descriptors are 20 bytes. Validate the note within RO
// before canonicalizing it; do not read 12 unrelated bytes beyond the descriptor.
inline bool canonical_gnu_build_id(const uint8_t* descriptor, uintptr_t ro_start,
                                   size_t ro_size, uint8_t (&out)[32]) {
    const uintptr_t address = reinterpret_cast<uintptr_t>(descriptor);
    if (!descriptor || address < 16 || !in_span(address-16,16,ro_start,ro_size)) return false;
    uint32_t header[4]{};
    __builtin_memcpy(header, reinterpret_cast<const void*>(address-16), sizeof(header));
    if (header[0]!=4 || (header[1]!=20 && header[1]!=32) ||
        header[2]!=3 || header[3]!=0x00554e47 ||
        !in_span(address,header[1],ro_start,ro_size)) return false;
    for (size_t i=0;i<32;++i) out[i]=i<header[1] ? descriptor[i] : 0;
    return true;
}

inline bool b_instruction(uintptr_t source, uintptr_t target, uint32_t* out) {
    if (!out || ((source | target) & 3u)) return false;
    const bool forward = target >= source;
    const uintptr_t magnitude = forward ? target - source : source - target;
    if (magnitude > (forward ? uintptr_t(0x7fffffcu) : uintptr_t(0x8000000u)))
        return false;
    const int64_t delta = forward ? static_cast<int64_t>(magnitude)
                                  : -static_cast<int64_t>(magnitude);
    *out = 0x14000000u | (static_cast<uint32_t>(delta >> 2) & 0x03ffffffu);
    return true;
}

inline Plan preflight(const Facts& f) {
    Plan p{};
    if (!matches(f.game_build_id, kGameBuildId) ||
        !matches(f.sdk_build_id, kSdkBuildId)) {
        p.status = Status::identity_mismatch;
        return p;
    }
    if (!in_span(f.main_text_start, 4, f.main_text_start, f.main_text_size) ||
        !in_span(f.carrier_text_start, 8, f.carrier_text_start, f.carrier_text_size) ||
        (f.main_text_start & 3u) || (f.carrier_text_start & 3u)) {
        p.status = Status::invalid_text_range;
        return p;
    }
    if (overlaps(f.main_text_start, f.main_text_size,
                 f.carrier_text_start, f.carrier_text_size)) {
        p.status = Status::invalid_text_range;
        return p;
    }
    for (size_t i = 0; i < kHookCount; ++i) {
        const auto site_rva = kHookSites[i].rva;
        if (site_rva > f.main_text_size || f.main_text_size - site_rva < 4) {
            p.status = Status::invalid_text_range;
            return p;
        }
        if (f.observed_original_words[i] != kHookSites[i].original_word) {
            p.status = Status::unexpected_original_word;
            return p;
        }
        if (f.observed_trampoline_words[i][0] != kNop ||
            f.observed_trampoline_words[i][1] != kNop) {
            p.status = Status::own_reservation_occupied;
            return p;
        }
        if (!in_span(f.hook_entries[i], 4, f.carrier_text_start, f.carrier_text_size) ||
            !in_span(f.trampoline_entries[i], 8, f.carrier_text_start, f.carrier_text_size)) {
            p.status = Status::hook_address_outside_carrier;
            return p;
        }
        if (overlaps(f.hook_entries[i], 4, f.trampoline_entries[i], 8)) {
            p.status = Status::trampolines_overlap;
            return p;
        }
        for (size_t j = 0; j < i; ++j) {
            // Neither an entry nor a trampoline may alias any other reservation.
            if (overlaps(f.trampoline_entries[i], 8, f.trampoline_entries[j], 8) ||
                overlaps(f.trampoline_entries[i], 8, f.hook_entries[j], 4) ||
                overlaps(f.hook_entries[i], 4, f.trampoline_entries[j], 8) ||
                overlaps(f.hook_entries[i], 4, f.hook_entries[j], 4)) {
                p.status = Status::trampolines_overlap;
                return p;
            }
        }
        const uintptr_t site = f.main_text_start + site_rva;
        const uintptr_t trampoline = f.trampoline_entries[i];
        uint32_t to_hook = 0, back = 0;
        if (!b_instruction(site, f.hook_entries[i], &to_hook) ||
            !b_instruction(trampoline + 4, site + 4, &back)) {
            p.status = Status::branch_unreachable;
            return p;
        }
        p.patches[i] = {site, f.hook_entries[i], trampoline,
                        kHookSites[i].original_word, to_hook, back};
    }
    p.status = Status::candidate_only;
    return p;
}

} // namespace menu_column_switch
