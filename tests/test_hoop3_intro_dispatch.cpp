#include "hoop3_intro_dispatch.hpp"

#include <cassert>
#include <cstdint>
#include <cstring>

namespace {

alignas(8) std::uint8_t scene[0x52A8]{};
std::uint8_t owner[0x100]{};
void* message_owner = owner;
int native_calls = 0;
int lookup_calls = 0;
void* display_title = nullptr;
int original_label = 1;
int replacement_label = 2;

void native_prologue(int kind, int index) {
    assert(kind == 1 && index == 41);
    ++native_calls;
    display_title = &original_label;
}

void* message_lookup(void* bank, const char* label, void* context) {
    assert(bank == owner + hoop3_title::kMessageNames);
    assert(context == nullptr);
    assert(std::strcmp(label, "I_RING_02") == 0);
    ++lookup_calls;
    return &replacement_label;
}

void set_cell(int world, int column, int row) {
    std::memcpy(scene + hoop3_title::kSceneWorld, &world, sizeof(world));
    std::memcpy(scene + hoop3_title::kSceneColumn, &column, sizeof(column));
    std::memcpy(scene + hoop3_title::kSceneRow, &row, sizeof(row));
}
}

int main() {
    hoop3_intro::Api api{native_prologue, message_lookup,
                         &message_owner, &display_title, true};
    set_cell(1, 9, 0);
    hoop3_intro::dispatch(api, scene, 1, 41);
    assert(native_calls == 1 && lookup_calls == 1);
    assert(display_title == &replacement_label);

    // Every other position retains Hoop 2's original prologue title.
    for (int w = 0; w < 3; ++w)
        for (int c = 0; c < 12; ++c)
            for (int r = 0; r < 5; ++r) {
                if (w == 1 && c == 9 && r == 0) continue;
                set_cell(w, c, r);
                const int before = lookup_calls;
                hoop3_intro::dispatch(api, scene, 1, 41);
                assert(display_title == &original_label);
                assert(lookup_calls == before);
            }

    // Disabled route and invalid owner must leave native title intact.
    set_cell(1, 9, 0);
    api.enabled = false;
    hoop3_intro::dispatch(api, scene, 1, 41);
    assert(display_title == &original_label);
    api.enabled = true;
    message_owner = nullptr;
    hoop3_intro::dispatch(api, scene, 1, 41);
    assert(display_title == &original_label);
    message_owner = owner;

    // Unrelated native selections must NOT read a possibly stale Scene.
    assert(!hoop3_intro::should_override(nullptr, 1, 41));
    assert(!hoop3_intro::should_override(reinterpret_cast<void*>(1), 1, 40));
    assert(!hoop3_intro::should_override(reinterpret_cast<void*>(1), 2, 41));
    return 0;
}
