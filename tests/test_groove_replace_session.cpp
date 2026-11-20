#include "groove_replace_session.hpp"

#include <cassert>
#include <cstdint>
#include <vector>

using namespace groove_runtime;

struct Trace {
    std::vector<std::int32_t> commands;
    bool fail_ring = false;
};

static bool ring(void* ctx, std::int32_t variant) {
    auto& trace = *static_cast<Trace*>(ctx);
    if (trace.fail_ring) return false;
    trace.commands.push_back(100 + variant);
    return true;
}

static bool bubble(void* ctx, std::int32_t mask) {
    static_cast<Trace*>(ctx)->commands.push_back(mask);
    return true;
}

int main() {
    constexpr Event events[] = {
        {0, Command::bubble_state, -1},
        {4000000, Command::ring_spawn, 0},
        {6500000, Command::ring_spawn, 0},
        {8000000, Command::bubble_state, 1},
    };
    Trace trace;
    NativeAdapter adapter{ring, bubble, &trace};
    ReplaceSession session;
    assert(!session.suppress_original_events());
    assert(!session.skip_practice());
    assert(session.prepare(events, 4, adapter));
    assert(!session.suppress_original_events());
    assert(!session.begin_after_verified_launch(false));
    assert(session.error() == Error::untrusted_launch);
    assert(!session.suppress_original_events());

    assert(session.prepare(events, 4, adapter));
    assert(session.begin_after_verified_launch(true));
    assert(session.suppress_original_events());
    assert(session.skip_practice());
    assert(session.advance(0) == 1);
    assert(session.advance(3999999) == 0);
    assert(session.advance(4000000) == 1);
    assert(session.advance(6500000) == 1);
    assert(session.advance(8000000) == 1);
    assert(session.advance(8000000) == 0);  // No duplicate events.
    assert(session.finished_events());
    assert((trace.commands == std::vector<std::int32_t>{-1, 100, 100, 1}));
    assert(session.suppress_original_events());
    session.reset();
    assert(!session.suppress_original_events());

    // No partial activation with missing adapters or invalid commands.
    assert(!session.prepare(events, 4, {ring, nullptr, &trace}));
    assert(session.error() == Error::missing_adapter);
    constexpr Event unsorted[] = {
        {2, Command::ring_spawn, 0}, {1, Command::bubble_state, 1}
    };
    assert(!session.prepare(unsorted, 2, adapter));
    constexpr Event bad_mask[] = {{0, Command::bubble_state, 16}};
    assert(!session.prepare(bad_mask, 1, adapter));
    constexpr Event unknown[] = {{0, static_cast<Command>(99), 0}};
    assert(!session.prepare(unknown, 1, adapter));

    // A native callback failure must NEVER resume borrowed Hoop2 events.
    trace.fail_ring = true;
    assert(session.prepare(events, 4, adapter));
    assert(session.begin_after_verified_launch(true));
    assert(session.advance(6000000) == 1);
    assert(session.status() == Status::fault);
    assert(session.error() == Error::native_call_failed);
    assert(session.suppress_original_events());
    assert(session.advance(8000000) == 0);
    session.reset();

    // A backwards beat clock is an error, not permission to replay cues.
    trace.fail_ring = false;
    assert(session.prepare(events, 4, adapter));
    assert(session.begin_after_verified_launch(true));
    assert(session.advance(4000000) == 2);
    assert(session.advance(3999999) == 0);
    assert(session.error() == Error::clock_reversed);
    assert(session.suppress_original_events());
    session.reset();
    assert(session.status() == Status::idle);
    assert(session.remaining_events() == 0);
}
