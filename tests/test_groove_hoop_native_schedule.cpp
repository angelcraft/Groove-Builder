#include "groove_hoop_native_schedule.hpp"

#include <cassert>
#include <cstdint>
#include <limits>
#include <vector>

using namespace groove_runtime;
using namespace groove_hoop_native;

struct Trace {
    std::vector<std::int32_t> waits;
    std::vector<std::int32_t> rings;
    std::size_t stop_checks = 0;
    std::size_t stop_on_check = 0;
    bool fail_wait = false;
    bool fail_ring = false;
};

static bool stopped(void* context) {
    auto& trace = *static_cast<Trace*>(context);
    ++trace.stop_checks;
    return trace.stop_on_check != 0 && trace.stop_checks == trace.stop_on_check;
}

static bool wait_ticks(void* context, std::int32_t ticks) {
    auto& trace = *static_cast<Trace*>(context);
    if (trace.fail_wait) return false;
    trace.waits.push_back(ticks);
    return true;
}

static bool ring(void* context, std::int32_t bubble_state) {
    auto& trace = *static_cast<Trace*>(context);
    if (trace.fail_ring) return false;
    trace.rings.push_back(bubble_state);
    return true;
}

static WorkerCalls calls(Trace& trace) { return {stopped, wait_ticks, &trace}; }

static constexpr Event kExample[] = {
    {0, Command::bubble_state, -1},
    {4000000, Command::ring_spawn, 0},
    {6000000, Command::bubble_state, 1},
    {6500000, Command::ring_spawn, 0},
};

static void begin(ReplaceSession& session, const Event* events,
                  std::size_t count, Trace& trace) {
    assert(session.prepare(events, count, {ring, &trace}));
    assert(session.begin_after_verified_launch(true));
}

int main() {
    std::uint32_t ticks = 0;
    assert(to_native_ticks(0, &ticks) && ticks == 0);
    assert(to_native_ticks(1000000, &ticks) && ticks == 480);
    assert(to_native_ticks(125000, &ticks) && ticks == 60);
    assert(!to_native_ticks(1, &ticks));
    assert(!to_native_ticks(-1, &ticks));
    assert(!to_native_ticks(0, nullptr));
    assert(!to_native_ticks(std::numeric_limits<std::int64_t>::max(), &ticks));

    Trace trace;
    ReplaceSession session;
    begin(session, kExample, 4, trace);
    const Report normal = run_replacement(session, kExample, 4, calls(trace));
    assert(normal.result == Result::completed);
    assert(normal.events_processed == 4 && normal.rings_emitted == 2);
    assert((trace.waits == std::vector<std::int32_t>{1920, 960, 240}));
    assert((trace.rings == std::vector<std::int32_t>{-1, 1}));
    assert(session.finished_events());
    assert(session.suppress_original_events());
    session.reset();

    // A later mask update at the same tick is applied before its ring;
    // neither command creates a second timer or worker.
    constexpr Event together[] = {
        {0, Command::bubble_state, 3},
        {0, Command::ring_spawn, 0},
        {0, Command::bubble_state, 5},
        {0, Command::ring_spawn, 0},
    };
    trace = {};
    begin(session, together, 4, trace);
    const Report same_tick = run_replacement(session, together, 4, calls(trace));
    assert(same_tick.result == Result::completed && same_tick.rings_emitted == 2);
    assert(trace.waits.empty());
    assert((trace.rings == std::vector<std::int32_t>{3, 5}));
    session.reset();

    // Exact tick preflight happens before calling wait/stopped or emitting;
    // a malformed timeline must not create partial rings.
    constexpr Event off_grid[] = {
        {0, Command::bubble_state, -1},
        {1234567, Command::ring_spawn, 0},
    };
    trace = {};
    begin(session, off_grid, 2, trace);
    const Report invalid = run_replacement(session, off_grid, 2, calls(trace));
    assert(invalid.result == Result::invalid);
    assert(trace.waits.empty() && trace.rings.empty() && trace.stop_checks == 0);
    assert(session.error() == Error::invalid_sequence && session.suppress_original_events());
    session.reset();

    // The original worker can cancel at either guard. Do not fall through
    // to base Hoop2 events after cancellation.
    trace = {};
    trace.stop_on_check = 4;
    begin(session, kExample, 4, trace);
    const Report cancelled = run_replacement(session, kExample, 4, calls(trace));
    assert(cancelled.result == Result::cancelled);
    assert(trace.rings.empty());
    assert(session.error() == Error::cancelled && session.suppress_original_events());
    session.reset();

    trace = {};
    trace.fail_wait = true;
    begin(session, kExample, 4, trace);
    const Report wait_failed = run_replacement(session, kExample, 4, calls(trace));
    assert(wait_failed.result == Result::wait_failed && wait_failed.events_processed == 1);
    assert(trace.rings.empty());
    assert(session.error() == Error::native_wait_failed && session.suppress_original_events());
    session.reset();

    trace = {};
    trace.fail_ring = true;
    begin(session, kExample, 4, trace);
    const Report ring_failed = run_replacement(session, kExample, 4, calls(trace));
    assert(ring_failed.result == Result::ring_failed && ring_failed.rings_emitted == 0);
    assert(session.error() == Error::native_call_failed && session.suppress_original_events());
    session.reset();

    // A prepared but UNVERIFIED launch must not take over the Stage68 worker.
    trace = {};
    assert(session.prepare(kExample, 4, {ring, &trace}));
    const Report not_ours = run_replacement(session, kExample, 4, calls(trace));
    assert(not_ours.result == Result::invalid);
    assert(trace.stop_checks == 0 && trace.rings.empty());
    assert(!session.suppress_original_events());
}
