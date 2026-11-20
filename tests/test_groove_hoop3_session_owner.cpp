#include "groove_hoop3_session_owner.hpp"

#include <cassert>
#include <cstdint>
#include <vector>

using namespace groove_hoop3;
using namespace groove_runtime;
using groove_hoop_native::Result;
using hoop3_launch::FactoryResult;
using hoop3_launch::NativeMenuRecord;
using hoop3_launch::Selection;

struct Trace {
    std::vector<std::int32_t> rings;
    std::vector<std::int32_t> waits;
    std::vector<std::int32_t> scene_actions;
    std::int32_t dynamic_mask = 1;
    bool fail_wait = false;
};

static bool ring(void* context, std::int32_t mask) {
    static_cast<Trace*>(context)->rings.push_back(mask);
    return true;
}

static bool mask(void* context, std::int32_t* output) {
    if (!output) return false;
    *output = static_cast<Trace*>(context)->dynamic_mask;
    return true;
}

static bool scene(void* context, std::int32_t action_id) {
    static_cast<Trace*>(context)->scene_actions.push_back(action_id);
    return true;
}

static bool stopped(void*) { return false; }

static bool wait_ticks(void* context, std::int32_t ticks) {
    auto& trace = *static_cast<Trace*>(context);
    if (trace.fail_wait) return false;
    trace.waits.push_back(ticks);
    return true;
}

static void append_le32(std::vector<std::uint8_t>& buffer, std::uint32_t word) {
    for (unsigned shift = 0; shift < 32; shift += 8)
        buffer.push_back(static_cast<std::uint8_t>(word >> shift));
}

static void append_le64(std::vector<std::uint8_t>& buffer, std::uint64_t word) {
    append_le32(buffer, static_cast<std::uint32_t>(word));
    append_le32(buffer, static_cast<std::uint32_t>(word >> 32));
}

static std::vector<std::uint8_t> cache(const std::vector<Event>& events) {
    std::vector<std::uint8_t> result{'G', 'R', 'T', '1'};
    append_le32(result, static_cast<std::uint32_t>(events.size()));
    for (const auto& event : events) {
        append_le64(result, static_cast<std::uint64_t>(event.beat_micro));
        const auto command = event.command == Command::ring_spawn ? 1u :
                             event.command == Command::bubble_state ? 2u :
                             event.command == Command::stage68_mask ? 3u : 4u;
        append_le32(result, command);
        append_le32(result, static_cast<std::uint32_t>(event.argument));
    }
    return result;
}

int main() {
    static SessionOwner owner; // Not on the original worker's stack.
    constexpr std::uintptr_t base = 0x7100000000ULL;
    constexpr std::uintptr_t stage = 0x7200003000ULL;
    const FactoryResult stage68{stage, base + hoop3_launch::kStage68VtableOffset, base};
    const Selection hoop3{1, 9, 0, 1, 41, 101};
    const Selection hoop2{1, 8, 0, 1, 41, 102};
    const NativeMenuRecord saved_hoop3{1, 1, 9, 0, 41};
    const NativeMenuRecord saved_hoop2{1, 1, 8, 0, 41};
    const std::vector<Event> events = {
        {0, Command::bubble_state, -1},
        {0, Command::scene_action, 0}, // Original stage's "basic" init.
        {4000000, Command::ring_spawn, 0},
        {6000000, Command::scene_action, 1}, // Original "change" action.
        {6000000, Command::stage68_mask, 0},
        {6000000, Command::ring_spawn, 0},
        {6000000, Command::bubble_state, -1},
        {6500000, Command::ring_spawn, 0},
    };
    const auto binary = cache(events);

    // The virtual cell must be LOCKED before a pack is prevalidated.
    assert(!owner.hoop3_slot_unlocked());
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::locked_hoop3_slot);
    assert(owner.on_confirmed_menu_launch(hoop2) == MenuAction::original_game);
    assert(owner.load_prevalidated_timeline(binary.data(), binary.size()));
    assert(owner.hoop3_slot_unlocked() && owner.ring_count() == 3);

    // An ordinary Hoop2 launch retains the whole original Stage68 path.
    assert(owner.on_confirmed_menu_launch(hoop2) == MenuAction::original_game);
    assert(owner.on_stage68_practice_branch(stage, saved_hoop2, {}) ==
           StageAction::original_route);
    Trace trace;
    assert(owner.on_stage68_worker(stage, {stopped, wait_ticks, &trace}).action ==
           WorkerAction::original_worker);
    assert(trace.rings.empty() && !owner.suppress_original_events_for(stage));

    // The NEXT correlated Hoop3 origin prepares a full replacement. A
    // wrong saved manager record is not permission to play Hoop2 as Hoop3.
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    assert(!owner.on_first_factory_return(stage68, saved_hoop2));
    assert(owner.phase() == Phase::fault && owner.suppress_original_events_for(stage));
    assert(!owner.suppress_original_events_for(stage + 0x1000));
    assert(!owner.clear_rejected_transition_after_quiescence(false));
    assert(!owner.clear_rejected_transition_after_quiescence(true));
    assert(owner.on_scene_destroyed_after_join(stage, true));
    assert(owner.hoop3_slot_unlocked());

    // If the first factory returns NO object at all, the owner cannot
    // invent a Stage68 address or release without external quiescence proof.
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    assert(!owner.on_first_factory_return(
        {0, stage68.stage_vtable, base}, saved_hoop3));
    assert(owner.phase() == Phase::fault);
    assert(!owner.suppress_original_events_for(stage));
    assert(!owner.clear_rejected_transition_after_quiescence(false));
    assert(owner.clear_rejected_transition_after_quiescence(true));

    // A menu cancellation before any stage is allocated invalidates the
    // ticket without poisoning a later correct launch.
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    owner.on_cancel_before_worker();
    assert(owner.hoop3_slot_unlocked());
    assert(!owner.on_first_factory_return(stage68, saved_hoop3));

    // A manager overwritten AFTER the matching StageFactory is returned
    // must block the borrowed stage, not silently play the base Hoop2 cues.
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(stage68, saved_hoop3));
    assert(owner.on_stage68_practice_branch(stage, saved_hoop2, {}) ==
           StageAction::block_stage);
    assert(owner.suppress_original_events_for(stage));
    assert(owner.on_scene_destroyed_after_join(stage, true));

    // A missing ring bridge also blocks the stage once the origin was
    // confirmed. The owner cannot fall back to original Hoop2 gameplay.
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(stage68, saved_hoop3));
    assert(owner.on_stage68_practice_branch(stage, saved_hoop3, {}) ==
           StageAction::block_stage);
    assert(owner.on_scene_destroyed_after_join(stage, true));

    // Having RingSpawn/Stage68-mask alone is still insufficient: removing
    // original scene-state calls would change the mechanics/presentation.
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(stage68, saved_hoop3));
    assert(owner.on_stage68_practice_branch(stage, saved_hoop3,
                                            {ring, &trace, mask}) ==
           StageAction::block_stage);
    assert(owner.on_scene_destroyed_after_join(stage, true));

    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(stage68, saved_hoop3));
    assert(owner.on_stage68_practice_branch(
        stage, saved_hoop3, {ring, &trace, mask, scene}) ==
        StageAction::skip_practice_and_replace);
    assert(owner.phase() == Phase::active);
    assert(owner.suppress_original_events_for(stage));
    assert(!owner.suppress_original_events_for(stage + 0x1000));
    assert(owner.on_confirmed_menu_launch(hoop2) == MenuAction::block_until_teardown);
    assert(!owner.unload());
    assert(owner.on_stage68_worker(stage + 0x1000, {stopped, wait_ticks, &trace}).action ==
           WorkerAction::original_worker);

    const auto played = owner.on_stage68_worker(stage, {stopped, wait_ticks, &trace});
    assert(played.action == WorkerAction::custom_worker_finished);
    assert(played.report.result == Result::completed);
    assert(played.report.rings_emitted == 3 && played.report.events_processed == 8);
    assert((trace.rings == std::vector<std::int32_t>{-1, 1, -1}));
    assert((trace.scene_actions == std::vector<std::int32_t>{0, 1}));
    assert((trace.waits == std::vector<std::int32_t>{1920, 960, 240}));
    assert(owner.phase() == Phase::completed && owner.suppress_original_events_for(stage));
    assert(owner.on_stage68_worker(stage, {stopped, wait_ticks, &trace}).action ==
           WorkerAction::block_worker);  // No original fallback or second replay.
    assert(!owner.on_scene_destroyed_after_join(stage, false));
    assert(!owner.on_scene_destroyed_after_join(stage + 4, true));
    assert(owner.on_scene_destroyed_after_join(stage, true));
    assert(owner.hoop3_slot_unlocked() && !owner.suppress_original_events_for(stage));

    // Native wait faults remain owned until scene destruction, never fall
    // through into original Hoop2 worker calls.
    trace = {};
    trace.fail_wait = true;
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(stage68, saved_hoop3));
    assert(owner.on_stage68_practice_branch(stage, saved_hoop3, {ring, &trace, mask, scene}) ==
           StageAction::skip_practice_and_replace);
    const auto failed = owner.on_stage68_worker(stage, {stopped, wait_ticks, &trace});
    assert(failed.report.result == Result::wait_failed);
    assert(owner.phase() == Phase::fault && owner.suppress_original_events_for(stage));
    assert(owner.on_stage68_worker(stage, {stopped, wait_ticks, &trace}).action ==
           WorkerAction::block_worker);
    assert(owner.on_scene_destroyed_after_join(stage, true));

    // Corrupt/off-grid caches must NOT unlock a slot or start practice skip.
    auto off_grid = cache({{1, Command::ring_spawn, 0}});
    assert(!owner.load_prevalidated_timeline(off_grid.data(), off_grid.size()));
    assert(!owner.hoop3_slot_unlocked());
    assert(owner.on_confirmed_menu_launch(hoop3) == MenuAction::locked_hoop3_slot);
    assert(owner.on_stage68_practice_branch(stage, saved_hoop3, {}) ==
           StageAction::original_route);
}
