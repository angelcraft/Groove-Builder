#pragma once

// INACTIVE HOST POLICY. No memory write or branch patch is performed here.
//
// Native candidate:
//   menu confirmation at main+0x1d2eac sets the origin;
//   first StageFactory completion at main+0x48a568 attaches it to Stage68;
//   Stage68's worker main+0x42c198 bypasses the preliminary route only
//   for the matching live Stage68 instance, leaving its 0x2c94 byte intact.
//
// Installation still requires ALL cancellation/reentry/scene callbacks to be
// identified and a validated safe executable patch mechanism. This header
// models ordering, not a demonstrated correlation through the game lifecycle.

#include <cstdint>
#include <limits>

#include "hoop3_launch_origin_gate.hpp"

namespace hoop3_launch {

constexpr std::uintptr_t kStage68VtableOffset = 0xD4D4B0;

struct FactoryResult {
    std::uintptr_t stage_address;
    std::uintptr_t stage_vtable;
    std::uintptr_t main_base;
};

class Stage68RouteGate {
public:
    // Caller must invoke this for EVERY confirmed launch, including Hoop 2.
    // Cursor changes, title queries and mere prologue previews do not count.
    bool on_confirmed_launch(const Selection& selected) {
        clear();
        pending_ = is_hoop3(selected);
        return pending_;
    }

    // Caller must invoke this for EVERY StageFactory return; the FIRST stage
    // consumes the origin. A different stage fails closed, never letting a
    // delayed Stage68 creation accidentally inherit the old menu origin.
    bool on_factory_return(const FactoryResult& created) {
        const bool match = pending_ && created.stage_address != 0 &&
                           created.main_base != 0 &&
                           created.main_base <=
                               std::numeric_limits<std::uintptr_t>::max() -
                                   kStage68VtableOffset &&
                           created.stage_vtable ==
                               created.main_base + kStage68VtableOffset;
        clear();
        if (match)
            tracked_stage_ = created.stage_address;
        return match;
    }

    // At main+0x42c198, only a matching Stage68 worker is eligible for a
    // branch directly to main+0x42c2ac. Mismatch also clears the ticket.
    // NEVER write Stage68+0x2c94: this flag has other later gameplay uses.
    bool consume_on_stage68_branch(std::uintptr_t stage_address) {
        const bool match = stage_address != 0 &&
                           stage_address == tracked_stage_;
        clear();
        return match;
    }

    // Required on cancel/back, menu reopen, Scene destruction, and game exit.
    void clear() {
        pending_ = false;
        tracked_stage_ = 0;
    }

    bool pending() const { return pending_; }
    bool stage_tracked() const { return tracked_stage_ != 0; }

private:
    bool pending_ = false;
    std::uintptr_t tracked_stage_ = 0;
};

}  // namespace hoop3_launch
