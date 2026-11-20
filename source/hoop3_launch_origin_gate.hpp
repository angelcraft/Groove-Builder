#pragma once

// RESEARCH ONLY. A fail-closed *policy* for identifying one Hoop 3 launch.
// This does not install a hook or infer a launch ticket from the native game.
// Runtime integration must first prove a ticket that survives the asynchronous
// menu -> stage transition and cannot be reused for original Hoop 2.

#include <cstdint>

#include "groove_extended_catalog.hpp"

namespace hoop3_launch {

struct Selection {
    int world;
    int column;
    int row;
    int kind;
    int index;
    std::uint64_t launch_ticket;
};

constexpr bool is_hoop3(const Selection& s) {
    return groove_extended::matches_hoop3(s.world, s.column, s.row,
                                          s.kind, s.index);
}

class OneShotOriginGate {
public:
    // Invoke on every *confirmed* menu launch, not cursor movement or title
    // lookup. A different launch immediately invalidates a previous ticket.
    bool confirm(const Selection& selection) {
        clear();
        if (!is_hoop3(selection) || selection.launch_ticket == 0)
            return false;
        ticket_ = selection.launch_ticket;
        armed_ = true;
        return true;
    }

    // This may only be invoked with a trusted, correlated stage-entry ticket;
    // type/index alone cannot distinguish borrowed Hoop 2 from Hoop 3.
    // Every attempt consumes the pending ticket, including a mismatch.
    bool consume_on_stage_entry(int kind, int index,
                                std::uint64_t trusted_ticket) {
        const bool allow = armed_ && trusted_ticket != 0 &&
                           trusted_ticket == ticket_ &&
                           kind == 1 && index == 41;
        clear();
        return allow;
    }

    // Cancellation, menu reopening, scene destruction and return from gameplay
    // must all call this once wired to pinned native lifecycle callbacks.
    void clear() {
        ticket_ = 0;
        armed_ = false;
    }

    bool pending() const { return armed_; }

private:
    std::uint64_t ticket_ = 0;
    bool armed_ = false;
};

}  // namespace hoop3_launch
