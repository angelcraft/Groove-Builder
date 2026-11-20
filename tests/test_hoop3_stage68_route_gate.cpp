#include "hoop3_stage68_route_gate.hpp"

#include <cassert>
#include <cstdint>
#include <initializer_list>
#include <limits>

using hoop3_launch::FactoryResult;
using hoop3_launch::NativeMenuRecord;
using hoop3_launch::Selection;
using hoop3_launch::Stage68RouteGate;

int main() {
    constexpr std::uintptr_t base = 0x7100000000ULL;
    constexpr std::uintptr_t stage = 0x7200003000ULL;
    const FactoryResult stage68{stage, base + 0xD4D4B0, base};
    const FactoryResult stage67{stage, base + 0xD4D258, base};
    const Selection hoop3{1, 9, 0, 1, 41, 0};
    constexpr NativeMenuRecord saved_hoop3{1, 1, 9, 0, 41};
    static_assert(hoop3_launch::matches_hoop3_native_record(saved_hoop3),
                  "Pinned native snapshot must match");

    Stage68RouteGate gate;
    assert(gate.on_confirmed_launch(hoop3));
    assert(gate.pending());
    assert(gate.on_factory_return(stage68, saved_hoop3));
    assert(!gate.pending());
    assert(gate.stage_tracked());
    assert(gate.consume_on_stage68_branch(stage, saved_hoop3));
    assert(!gate.stage_tracked());
    assert(!gate.consume_on_stage68_branch(stage, saved_hoop3)); // One shot

    // A stale origin cannot survive another factory return, including
    // another Stage68, even when the memory allocator reuses the address.
    assert(gate.on_confirmed_launch(hoop3));
    assert(!gate.on_factory_return(stage67, saved_hoop3));
    assert(!gate.on_factory_return(stage68, saved_hoop3));
    assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));

    // A stage worker from any other object consumes and rejects the tag.
    assert(gate.on_confirmed_launch(hoop3));
    assert(gate.on_factory_return(stage68, saved_hoop3));
    assert(!gate.consume_on_stage68_branch(stage + 0x1000, saved_hoop3));
    assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));

    // Guard against invalid pointers, a mismatched main image and overflow.
    for (const FactoryResult invalid : {
             FactoryResult{0, stage68.stage_vtable, base},
             FactoryResult{stage, 0, base},
             FactoryResult{stage, stage68.stage_vtable, 0},
             FactoryResult{stage, stage68.stage_vtable, base + 0x1000},
             FactoryResult{stage, stage68.stage_vtable,
                           std::numeric_limits<std::uintptr_t>::max()},
         }) {
        assert(gate.on_confirmed_launch(hoop3));
        assert(!gate.on_factory_return(invalid, saved_hoop3));
        assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));
    }

    // Same borrowed native identity does not bypass the origin check.
    for (int world = 0; world != 3; ++world)
        for (int column = 0; column != 12; ++column)
            for (int row = 0; row != 5; ++row) {
                const Selection candidate{world, column, row, 1, 41, 0};
                const bool expected = world == 1 && column == 9 && row == 0;
                assert(gate.on_confirmed_launch(candidate) == expected);
                const NativeMenuRecord snapshot{1, world, column, row, 41};
                assert(gate.on_factory_return(stage68, snapshot) == expected);
                assert(gate.consume_on_stage68_branch(stage, snapshot) == expected);
            }

    // The source coordinate ticket alone is insufficient. Reject a menu
    // manager record overwritten during a cancellation, mode switch or an
    // unrelated confirmation before the StageFactory result arrives.
    for (const NativeMenuRecord different : {
             NativeMenuRecord{-1, 1, 9, 0, 41},
             NativeMenuRecord{2, 1, 9, 0, 41},
             NativeMenuRecord{1, 0, 9, 0, 41},
             NativeMenuRecord{1, 2, 9, 0, 41},
             NativeMenuRecord{1, 1, 8, 0, 41},
             NativeMenuRecord{1, 1, 9, 1, 41},
             NativeMenuRecord{1, 1, 9, 0, 40},
             NativeMenuRecord{1, 1, 9, 0, 80},
         }) {
        assert(gate.on_confirmed_launch(hoop3));
        assert(!gate.on_factory_return(stage68, different));
        assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));
    }
    const NativeMenuRecord mode_zero{0, 1, 9, 0, 41};
    assert(gate.on_confirmed_launch(hoop3));
    assert(gate.on_factory_return(stage68, mode_zero));
    assert(gate.consume_on_stage68_branch(stage, mode_zero));

    // A manager record that changed AFTER factory creation is not enough to
    // authorize the branch. Consume and clear even when the object matches.
    assert(gate.on_confirmed_launch(hoop3));
    assert(gate.on_factory_return(stage68, saved_hoop3));
    assert(!gate.consume_on_stage68_branch(stage, {1, 1, 8, 0, 41}));
    assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));

    for (int lifecycle = 0; lifecycle != 4; ++lifecycle) {
        assert(gate.on_confirmed_launch(hoop3));
        gate.clear(); // cancel / menu reopen / destroy / exit
        assert(!gate.on_factory_return(stage68, saved_hoop3));
        assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));

        assert(gate.on_confirmed_launch(hoop3));
        assert(gate.on_factory_return(stage68, saved_hoop3));
        gate.clear(); // cancel after stage creation
        assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));
    }

    // A second confirmation invalidates an earlier Hoop3 and its object.
    assert(gate.on_confirmed_launch(hoop3));
    assert(gate.on_factory_return(stage68, saved_hoop3));
    assert(!gate.on_confirmed_launch({1, 8, 0, 1, 41, 0}));
    assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));
    return 0;
}
