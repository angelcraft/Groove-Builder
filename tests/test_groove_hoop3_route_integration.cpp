#include "groove_replace_session.hpp"
#include "hoop3_stage68_route_gate.hpp"

#include <cassert>
#include <cstdint>

using namespace groove_runtime;
using namespace hoop3_launch;

static bool noop_native(void*, std::int32_t) { return true; }

int main() {
    constexpr std::uintptr_t base = 0x7100000000ULL;
    constexpr std::uintptr_t stage = 0x7200003000ULL;
    const FactoryResult stage68{stage, base + kStage68VtableOffset, base};
    const Selection hoop3{1, 9, 0, 1, 41, 1234};
    const Selection original_hoop2{1, 8, 0, 1, 41, 1235};
    constexpr NativeMenuRecord saved_hoop3{1, 1, 9, 0, 41};
    constexpr NativeMenuRecord saved_hoop2{1, 1, 8, 0, 41};
    constexpr Event events[] = {
        {0, Command::bubble_state, -1},
        {4000000, Command::ring_spawn, 0},
    };
    NativeAdapter adapter{noop_native, nullptr};
    Stage68RouteGate gate;
    ReplaceSession session;

    // A normal Hoop2 launch borrows the same kind/index/StageFactory, but
    // must never take ownership of its original timeline or skip practice.
    assert(session.prepare(events, 2, adapter));
    assert(!gate.on_confirmed_launch(original_hoop2));
    assert(!gate.on_factory_return(stage68, saved_hoop2));
    assert(!session.begin_after_verified_launch(
        gate.consume_on_stage68_branch(stage, saved_hoop2)));
    assert(!session.suppress_original_events());
    assert(!session.skip_practice());

    // A real Hoop3 origin is allowed once and only once when the native
    // menu manager and Stage68 object still match the original launch.
    assert(session.prepare(events, 2, adapter));
    assert(gate.on_confirmed_launch(hoop3));
    assert(gate.on_factory_return(stage68, saved_hoop3));
    assert(session.begin_after_verified_launch(
        gate.consume_on_stage68_branch(stage, saved_hoop3)));
    assert(session.skip_practice());
    assert(session.suppress_original_events());
    assert(session.advance(4000000) == 2);
    assert(session.finished_events());
    session.reset(); // Menu return / scene destruction.

    // A stale manager record, cancel or second consume never authorizes
    // reusing the previous Hoop3 identity.
    assert(session.prepare(events, 2, adapter));
    assert(gate.on_confirmed_launch(hoop3));
    assert(gate.on_factory_return(stage68, saved_hoop3));
    assert(!session.begin_after_verified_launch(
        gate.consume_on_stage68_branch(stage, saved_hoop2)));
    assert(!session.suppress_original_events());
    assert(!gate.consume_on_stage68_branch(stage, saved_hoop3));

    assert(session.prepare(events, 2, adapter));
    assert(gate.on_confirmed_launch(hoop3));
    gate.clear(); // Back/cancel before StageFactory.
    assert(!gate.on_factory_return(stage68, saved_hoop3));
    assert(!session.begin_after_verified_launch(
        gate.consume_on_stage68_branch(stage, saved_hoop3)));
    assert(!session.suppress_original_events());
}
