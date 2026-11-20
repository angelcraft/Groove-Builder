#include "hoop3_launch_origin_gate.hpp"

#include <cassert>
#include <cstdint>

using hoop3_launch::OneShotOriginGate;
using hoop3_launch::Selection;

int main() {
    OneShotOriginGate gate;
    const Selection hoop3{1, 9, 0, 1, 41, 0x1234};

    assert(!gate.pending());
    assert(gate.confirm(hoop3));
    assert(gate.pending());
    assert(gate.consume_on_stage_entry(1, 41, 0x1234));
    assert(!gate.pending());
    assert(!gate.consume_on_stage_entry(1, 41, 0x1234));

    // Original Hoop 2 has the same native descriptor, NOT the same origin.
    assert(gate.confirm(hoop3));
    assert(!gate.consume_on_stage_entry(1, 41, 0x9876));
    assert(!gate.pending());

    assert(gate.confirm(hoop3));
    assert(!gate.consume_on_stage_entry(1, 40, 0x1234));
    assert(!gate.pending());

    // Exhaust all 180 menu cells: only world1/column9/row0 can arm.
    for (int world = 0; world != 3; ++world)
        for (int column = 0; column != 12; ++column)
            for (int row = 0; row != 5; ++row) {
                const Selection candidate{world, column, row, 1, 41, 0x1234};
                assert(gate.confirm(candidate) ==
                       (world == 1 && column == 9 && row == 0));
                gate.clear();
            }

    Selection invalid = hoop3;
    invalid.launch_ticket = 0;
    assert(!gate.confirm(invalid));
    assert(!gate.pending());

    assert(gate.confirm(hoop3));
    // A second menu confirmation invalidates the first origin.
    assert(!gate.confirm({1, 8, 0, 1, 41, 0x5678}));
    assert(!gate.consume_on_stage_entry(1, 41, 0x1234));

    for (int lifecycle = 0; lifecycle != 4; ++lifecycle) {
        assert(gate.confirm(hoop3));
        // Cancel, menu reopen, scene destruction, return all clear the gate.
        gate.clear();
        assert(!gate.consume_on_stage_entry(1, 41, 0x1234));
    }
    return 0;
}
