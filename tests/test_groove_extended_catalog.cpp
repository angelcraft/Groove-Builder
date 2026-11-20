#include "groove_extended_catalog.hpp"

#include <cassert>
#include <cstring>

using namespace groove_extended;

static_assert(kEntryCount == 1, "Only Hoop3 is a verified extended cell");
static_assert(kPlannedKind1Capacity == 256, "Planned 176 extra IDs; no native patch yet");
static_assert(!native_index_safe(1, 80), "Virtual indices must not enter native lookup");
static_assert(native_index_safe(1, 41), "Original Hoop2 must remain available");
static_assert(native_index_safe(1, 79), "Original Remix20 must remain available");
static_assert(!native_index_safe(2, 0), "Other native families are not audited");
static_assert(matches_hoop3(1, 9, 0, 1, 41), "Hoop3 cell must be discoverable");
static_assert(!matches_hoop3(1, 8, 0, 1, 41), "Original Hoop2 is distinct");
static_assert(!matches_hoop3(1, 9, 0, 1, 80), "Never pass 80 to original game");

int main() {
    const Entry* hoop3 = find_virtual(80);
    assert(hoop3 != nullptr);
    assert(hoop3 == find_slot(1, 9, 0));
    assert(find_virtual(41) == nullptr);
    assert(find_virtual(81) == nullptr);
    assert(hoop3->native_stage_factory_id == 68);
    assert(hoop3->target_ring_count == 54);
    assert(hoop3->skip_practice_requested);
    assert(!hoop3->virtual_launch_installed);
    assert(!hoop3->messages_installed);
    assert(!hoop3->independent_records_installed);
    assert(std::strcmp(hoop3->replacement_label, "I_RING_02") == 0);
    assert(std::strcmp(hoop3->progress_namespace, "groove.hoop_trundling_3") == 0);

    int visited = 0;
    for (int world = 0; world < 3; ++world)
        for (int col = 0; col < 12; ++col)
            for (int row = 0; row < 5; ++row) {
                const Entry* entry = find_slot(world, col, row);
                const bool expected = world == 1 && col == 9 && row == 0;
                assert((entry != nullptr) == expected);
                if (entry) {
                    ++visited;
                    assert(entry->virtual_index == 80);
                }
            }
    assert(visited == 1);
    return 0;
}
