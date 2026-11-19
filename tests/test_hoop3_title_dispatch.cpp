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
    hoop3_title_api.lookup = nullptr;
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 hoop3_title::kHoop2Label, nullptr, panel.bytes.data()) == nullptr);
    hoop3_title_api.lookup = lookup;
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 nullptr, nullptr, panel.bytes.data()) == nullptr);
    assert(menu_hoop3_instruction_dispatch_entry(instruction_bank.data(),
                 hoop3_title::kHoop2Label, nullptr, nullptr) ==
           reinterpret_cast<void*>(0x420000));
    return 0;
}
