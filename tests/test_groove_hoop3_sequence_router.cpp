#include "groove_hoop3_sequence_router.hpp"

#include <cassert>
#include <cstdint>
#include <vector>

using namespace groove_hoop3;
using namespace groove_runtime;
using hoop3_launch::FactoryResult;
using hoop3_launch::NativeMenuRecord;
using hoop3_launch::Selection;

struct Counts {
    unsigned native_calls = 0;
    unsigned custom_calls = 0;
};

static Counts* g_original_calls = nullptr;

static void original_hoop2(void*, void*) { ++g_original_calls->native_calls; }
static bool ring(void* context, std::int32_t) {
    ++static_cast<Counts*>(context)->custom_calls;
    return true;
}
static bool stopped(void*) { return false; }

static std::vector<std::uint8_t> ring_cache() {
    // GRT1, one ring at beat 1, in exact native ticks.
    return {'G','R','T','1',1,0,0,0,0x40,0x42,0x0F,0,0,0,0,0,
            1,0,0,0,0,0,0,0};
}

int main() {
    static SessionOwner owner; // Full 10k-event allocation only in BSS.
    constexpr std::uintptr_t base = 0x7100000000ULL;
    constexpr std::uintptr_t stage = 0x7200003000ULL;
    constexpr std::uintptr_t other_stage = stage + 0x1000;
    void* const worker = reinterpret_cast<void*>(0x7300000080ULL);
    auto* const instance = reinterpret_cast<void*>(stage);
    auto* const unrelated = reinterpret_cast<void*>(other_stage);
    Counts counts;
    g_original_calls = &counts;
    // A valid original callback needs to see the native worker pointer;
    // keep it the SAME pointer as the bridge's WorkerCalls.worker.
    auto worker_calls = groove_hoop_native::WorkerCalls{
        stopped, [](void*, std::int32_t) { return true; }, worker};
    auto failed_calls = groove_hoop_native::WorkerCalls{
        stopped, [](void*, std::int32_t) { return false; }, worker};

    const auto binary = ring_cache();
    assert(owner.load_prevalidated_timeline(binary.data(), binary.size()));
    const Selection selection{1, 9, 0, 1, 41, 789};
    const NativeMenuRecord saved{1, 1, 9, 0, 41};
    const FactoryResult factory{stage, base + hoop3_launch::kStage68VtableOffset, base};

    // The original Hoop2 stays original before a virtual Hoop3 launch.
    auto result = route_stage68_sequence(owner, original_hoop2,
                                         instance, worker, worker_calls);
    assert(result.dispatch == SequenceDispatch::original_worker && counts.native_calls == 1);
    assert(owner.on_confirmed_menu_launch(selection) == MenuAction::hoop3_launch);
    // Pending launch is not a Stage68-owned instance. An unrelated instance
    // may still execute its original worker, even before Factory returns.
    result = route_stage68_sequence(owner, original_hoop2,
                                    unrelated, worker, worker_calls);
    assert(result.dispatch == SequenceDispatch::original_worker && counts.native_calls == 2);

    assert(owner.on_first_factory_return(factory, saved));
    // The trusted instance is tracked but not yet authorized by the original
    // practice branch. It must NEVER run Hoop2 events under a Hoop3 label.
    result = route_stage68_sequence(owner, original_hoop2,
                                    instance, worker, worker_calls);
    assert(result.dispatch == SequenceDispatch::blocked_owned_stage);
    assert(counts.native_calls == 2 && counts.custom_calls == 0);
    assert(owner.on_scene_destroyed_after_join(stage, true));

    // Normal replacement: the shared callback runs the new 1-ring script
    // ONLY for the owned instance, while others remain untouched.
    assert(owner.on_confirmed_menu_launch(selection) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(factory, saved));
    assert(owner.on_stage68_practice_branch(stage, saved, {ring, &counts}) ==
           StageAction::skip_practice_and_replace);
    result = route_stage68_sequence(owner, original_hoop2,
                                    unrelated, worker, worker_calls);
    assert(result.dispatch == SequenceDispatch::original_worker && counts.native_calls == 3);
    result = route_stage68_sequence(owner, original_hoop2,
                                    instance, worker, worker_calls);
    assert(result.dispatch == SequenceDispatch::replaced_worker);
    assert(result.report.rings_emitted == 1 && counts.custom_calls == 1);
    assert(counts.native_calls == 3);
    // Duplicate native callback must NOT replay custom or original events.
    result = route_stage68_sequence(owner, original_hoop2,
                                    instance, worker, worker_calls);
    assert(result.dispatch == SequenceDispatch::blocked_owned_stage);
    assert(counts.native_calls == 3 && counts.custom_calls == 1);
    assert(owner.on_scene_destroyed_after_join(stage, true));

    // Native wait failure: stay blocked until owner-confirmed teardown.
    assert(owner.on_confirmed_menu_launch(selection) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(factory, saved));
    assert(owner.on_stage68_practice_branch(stage, saved, {ring, &counts}) ==
           StageAction::skip_practice_and_replace);
    result = route_stage68_sequence(owner, original_hoop2,
                                    instance, worker, failed_calls);
    assert(result.dispatch == SequenceDispatch::blocked_owned_stage);
    assert(result.report.result == groove_hoop_native::Result::wait_failed);
    assert(counts.native_calls == 3 && counts.custom_calls == 1);
    assert(owner.on_scene_destroyed_after_join(stage, true));

    // A missing original callback is a HARD failure for normal Hoop2.
    result = route_stage68_sequence(owner, nullptr, unrelated, worker, worker_calls);
    assert(result.dispatch == SequenceDispatch::invalid_original_callback);
    result = route_stage68_sequence(owner, original_hoop2,
                                    unrelated, nullptr, worker_calls);
    assert(result.dispatch == SequenceDispatch::invalid_callback_arguments);
    result = route_stage68_sequence(owner, original_hoop2,
                                    unrelated, worker, {});
    assert(result.dispatch == SequenceDispatch::original_worker);
    assert(counts.native_calls == 4);

    // Incorrect worker context for a tracked stage must fault-lock Hoop3.
    assert(owner.on_confirmed_menu_launch(selection) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(factory, saved));
    assert(owner.on_stage68_practice_branch(stage, saved, {ring, &counts}) ==
           StageAction::skip_practice_and_replace);
    result = route_stage68_sequence(owner, original_hoop2, instance, worker, {});
    assert(result.dispatch == SequenceDispatch::blocked_owned_stage);
    assert(owner.phase() == Phase::fault);
    assert(counts.native_calls == 4 && counts.custom_calls == 1);
    assert(owner.on_scene_destroyed_after_join(stage, true));
}
