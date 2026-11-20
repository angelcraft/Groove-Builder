#include "hoop3_title_dispatch.hpp"
#include <array>
#include <cassert>
#include <cstdint>
#include <cstring>

extern "C" hoop3_title::Api hoop3_title_api;
extern "C" void* menu_hoop3_title_dispatch_entry(int, int, const void*);
extern "C" void* menu_hoop3_instruction_dispatch_entry(void*, const char*, void*, const void*);

namespace {
std::uint32_t calls_orig = 0;
std::uint32_t calls_new = 0;
bool allow_new = true;
bool allow_future = true;
void* last_bank = nullptr;

void* original(int kind, int index) {
    ++calls_orig;
    return reinterpret_cast<void*>(static_cast<std::uintptr_t>(0x100000u + kind * 0x100u + index));
}
void* lookup(void* bank, const char* label, void* aux) {
    ++calls_new;
    assert(aux == nullptr);
    last_bank = bank;
    if (std::strcmp(label, "I_RING_02") == 0)
        return allow_new ? reinterpret_cast<void*>(0x530000) : nullptr;
    if (std::strcmp(label, "I_RING_03") == 0)
        return allow_future ? reinterpret_cast<void*>(0x540000) : nullptr;
    if (std::strcmp(label, "I_RING_00") == 0)
        return reinterpret_cast<void*>(0x410000);
    assert(std::strcmp(label, "I_RING_01") == 0);
    return reinterpret_cast<void*>(0x420000);
}

struct Scene {
    std::array<std::uint8_t, 0x5300> bytes{};
    void set(std::uint32_t world, std::uint32_t column, std::uint32_t row) {
        std::memcpy(bytes.data() + hoop3_title::kSceneWorld, &world, 4);
        std::memcpy(bytes.data() + hoop3_title::kSceneColumn, &column, 4);
        std::memcpy(bytes.data() + hoop3_title::kSceneRow, &row, 4);
    }
};

struct Panel {
    std::array<std::uint8_t, 32> bytes{};
    explicit Panel(const Scene& scene) {
        const void* ptr = scene.bytes.data();
        std::memcpy(bytes.data() + hoop3_title::kPanelScene, &ptr, sizeof(ptr));
    }
};
}

int main() {
    // Simulate two entries in the *same* module without shipping the second.
    // A future slot must be explicitly catalogued, never inferred from SPR.
    constexpr hoop3_title::TextOverride two_cells[] = {
        {{1, 9, 0}, 1, 41, "I_RING_01", "I_RING_02"},
        {{1, 9, 4}, 1, 41, "I_RING_01", "I_RING_03"},
    };
    constexpr hoop3_title::TextOverride duplicate_cells[] = {
        {{1, 9, 0}, 1, 41, "I_RING_01", "I_RING_02"},
        {{1, 9, 0}, 1, 42, "I_RING_01", "I_RING_03"},
    };
    constexpr hoop3_title::TextOverride out_of_bounds[] = {
        {{1, 12, 0}, 1, 41, "I_RING_01", "I_RING_03"},
    };
    static_assert(hoop3_title::valid_catalog(two_cells), "Expected valid test catalog");
    static_assert(!hoop3_title::valid_catalog(duplicate_cells), "Duplicate cell accepted");
    static_assert(!hoop3_title::valid_catalog(out_of_bounds), "Invalid column accepted");

    Scene scene{};
    Panel panel(scene);
    std::array<std::uint8_t, 0x80> owner{};
    void* owner_ptr = owner.data();
    hoop3_title::Api api{original, lookup, &owner_ptr, true};

    for (int world = 0; world < 3; ++world) {
        for (int column = 0; column < 12; ++column) {
            for (int row = 0; row < 5; ++row) {
                scene.set(world, column, row);
                const void* result = hoop3_title::dispatch(api, panel.bytes.data(), 1, 41);
                const bool special = world == 1 && column == 9 && row == 0;
                assert(result == (special ? reinterpret_cast<void*>(0x530000)
                                          : reinterpret_cast<void*>(0x100129)));
            }
        }
    }
    assert(calls_new == 1);
    assert(calls_orig == 179);
    assert(last_bank == owner.data() + hoop3_title::kMessageNames);

    scene.set(1, 9, 0);
    // Borrowed stage identity MUST match Hoop 2 for the temporary route.
    assert(hoop3_title::dispatch(api, panel.bytes.data(), 1, 40) == reinterpret_cast<void*>(0x100128));
    assert(hoop3_title::dispatch(api, panel.bytes.data(), 2, 41) == reinterpret_cast<void*>(0x100229));
    // Unrelated calls must not read the panel/Scene at all.
    const auto* stale_panel = reinterpret_cast<const void*>(0x1);
    assert(hoop3_title::dispatch(api, stale_panel, 2, 41) ==
           reinterpret_cast<void*>(0x100229));
    assert(calls_new == 1);

    allow_new = false;
    assert(hoop3_title::dispatch(api, panel.bytes.data(), 1, 41) == reinterpret_cast<void*>(0x100129));
    assert(calls_new == 2);  // Failed message lookup falls back to Hoop 2.
    allow_new = true;
    owner_ptr = nullptr;
    assert(hoop3_title::dispatch(api, panel.bytes.data(), 1, 41) == reinterpret_cast<void*>(0x100129));
    owner_ptr = owner.data();
    api.enabled = false;
    assert(hoop3_title::dispatch(api, panel.bytes.data(), 1, 41) == reinterpret_cast<void*>(0x100129));
    api.enabled = true;
    api.lookup = nullptr;
    assert(hoop3_title::dispatch(api, panel.bytes.data(), 1, 41) == reinterpret_cast<void*>(0x100129));
    api.lookup = lookup;
    api.original = nullptr;
    assert(hoop3_title::dispatch(api, panel.bytes.data(), 1, 41) == nullptr);
    assert(hoop3_title::dispatch(api, nullptr, 1, 41) == nullptr);

    hoop3_title_api = hoop3_title::Api{original, lookup, &owner_ptr, true};
    assert(menu_hoop3_title_dispatch_entry(1, 41, panel.bytes.data()) ==
           reinterpret_cast<void*>(0x530000));
    hoop3_title_api.enabled = false;
    assert(menu_hoop3_title_dispatch_entry(1, 41, panel.bytes.data()) ==
           reinterpret_cast<void*>(0x100129));

    // A second BL at 0x1D0240 resolves instructions. Preserve the original
    // call exactly for all 179 other cells and on a missing custom message.
    hoop3_title_api.enabled = true;
    std::array<std::uint8_t, 0x100> instruction_bank{};
    calls_new = 0;
    for (int world = 0; world < 3; ++world) {
        for (int column = 0; column < 12; ++column) {
            for (int row = 0; row < 5; ++row) {
                scene.set(world, column, row);
                const bool special = world == 1 && column == 9 && row == 0;
                const void* result = menu_hoop3_instruction_dispatch_entry(
                    instruction_bank.data(), hoop3_title::kHoop2Label, nullptr,
                    panel.bytes.data());
                assert(result == reinterpret_cast<void*>(special ? 0x530000 : 0x420000));
            }
        }
    }
    assert(calls_new == 180);
    assert(last_bank == instruction_bank.data());
    scene.set(1, 9, 0);
    allow_new = false;
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 hoop3_title::kHoop2Label, nullptr, panel.bytes.data()) ==
           reinterpret_cast<void*>(0x420000));
    assert(calls_new == 182);  // Missing I_RING_02 then original I_RING_01.
    allow_new = true;
    hoop3_title_api.enabled = false;
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 hoop3_title::kHoop2Label, nullptr, panel.bytes.data()) ==
           reinterpret_cast<void*>(0x420000));
    hoop3_title_api.enabled = true;
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 "I_RING_00", nullptr, panel.bytes.data()) ==
           reinterpret_cast<void*>(0x410000));
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 "I_RING_00", nullptr, stale_panel) ==
           reinterpret_cast<void*>(0x410000));
    hoop3_title_api.lookup = nullptr;
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 hoop3_title::kHoop2Label, nullptr, panel.bytes.data()) == nullptr);
    hoop3_title_api.lookup = lookup;
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 nullptr, nullptr, panel.bytes.data()) == nullptr);
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 hoop3_title::kHoop2Label, nullptr, nullptr) ==
           reinterpret_cast<void*>(0x420000));

    // Production catalog is still ONE cell; prove that a second independent
    // cell can be routed with a test-only catalog, without enabling world0/2.
    hoop3_title_api.enabled = true;
    scene.set(1, 9, 4);
    assert(menu_hoop3_title_dispatch_entry(1, 41, panel.bytes.data()) ==
           reinterpret_cast<void*>(0x100129));
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 hoop3_title::kHoop2Label, nullptr, panel.bytes.data()) ==
           reinterpret_cast<void*>(0x420000));

    calls_orig = calls_new = 0;
    for (int world = 0; world < 3; ++world) {
        for (int column = 0; column < 12; ++column) {
            for (int row = 0; row < 5; ++row) {
                scene.set(world, column, row);
                const bool first = world == 1 && column == 9 && row == 0;
                const bool second = world == 1 && column == 9 && row == 4;
                const void* title = hoop3_title::dispatch_with_catalog(
                    hoop3_title_api, panel.bytes.data(), 1, 41, two_cells, 2);
                assert(title == reinterpret_cast<void*>(first ? 0x530000 :
                        second ? 0x540000 : 0x100129));
                const void* instruction = hoop3_title::dispatch_instruction_with_catalog(
                    hoop3_title_api, panel.bytes.data(), instruction_bank.data(),
                    "I_RING_01", nullptr, two_cells, 2);
                assert(instruction == reinterpret_cast<void*>(first ? 0x530000 :
                        second ? 0x540000 : 0x420000));
            }
        }
    }
    assert(calls_orig == 178);
    assert(calls_new == 182);  // 2 custom titles + 180 instruction lookups.

    scene.set(1, 9, 4);
    assert(hoop3_title::dispatch_with_catalog(hoop3_title_api,
           panel.bytes.data(), 2, 41, two_cells, 2) ==
           reinterpret_cast<void*>(0x100229));
    assert(hoop3_title::dispatch_instruction_with_catalog(hoop3_title_api,
           panel.bytes.data(), instruction_bank.data(), "I_RING_00",
           nullptr, two_cells, 2) == reinterpret_cast<void*>(0x410000));
    allow_future = false;
    assert(hoop3_title::dispatch_with_catalog(hoop3_title_api,
           panel.bytes.data(), 1, 41, two_cells, 2) ==
           reinterpret_cast<void*>(0x100129));
    assert(hoop3_title::dispatch_instruction_with_catalog(hoop3_title_api,
           panel.bytes.data(), instruction_bank.data(), "I_RING_01",
           nullptr, two_cells, 2) == reinterpret_cast<void*>(0x420000));
    allow_future = true;
    return 0;
}
