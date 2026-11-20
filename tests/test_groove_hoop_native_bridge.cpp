#include "groove_hoop_native_bridge.hpp"

#include <cassert>
#include <cstdint>

using namespace groove_runtime;
using namespace groove_hoop_native;

static void* captured_scene = nullptr;
static void* captured_worker = nullptr;
static std::int32_t captured_mask = 99;
static std::size_t native_calls = 0;
static std::uint8_t current_stage_flag = 0;
static std::int32_t captured_wait = -1;
static std::int32_t stopped_result = 0;
static const char* captured_action = nullptr;

static void mock_native_ring(void* scene, void* worker, std::int32_t mask) {
    captured_scene = scene;
    captured_worker = worker;
    captured_mask = mask;
    ++native_calls;
}

static bool mock_stage_flag(void* stage, std::uint8_t* out) {
    if (!stage || !out) return false;
    *out = current_stage_flag;
    return true;
}

static void mock_native_wait(void* worker, std::int32_t ticks) {
    assert(worker == captured_worker);
    captured_wait = ticks;
}

static std::int32_t mock_native_stopped(void* worker) {
    assert(worker == captured_worker);
    return stopped_result;
}

static void mock_native_scene_action(void* stage, const char* label) {
    assert(stage == reinterpret_cast<void*>(0x7200003000ULL));
    captured_action = label;
}

int main() {
    constexpr std::uintptr_t kStage = 0x7200003000ULL;
    constexpr std::uintptr_t kWorker = 0x7200009000ULL;
    RingBinding binding{reinterpret_cast<void*>(kStage),
                        reinterpret_cast<void*>(kWorker), mock_native_ring,
                        mock_stage_flag, mock_native_wait,
                        mock_native_stopped};
    binding.native_scene_action = mock_native_scene_action;
    binding.native_scene_labels[0] = "basic";
    binding.native_scene_labels[1] = "change";
    binding.native_scene_labels[2] = "hide";

    assert(emit_ring(&binding, -1));
    assert(captured_scene == reinterpret_cast<void*>(kStage + kStage68SceneOffset));
    assert(captured_worker == reinterpret_cast<void*>(kWorker));
    assert(captured_mask == -1);
    assert(native_calls == 1);
    assert(emit_ring(&binding, 1) && captured_mask == 1);
    assert(native_calls == 2);
    assert(emit_scene_action(&binding, 1));
    assert(captured_action == binding.native_scene_labels[1]);
    assert(!emit_scene_action(&binding, 3));
    auto worker_calls = bound_original_worker_calls(binding);
    assert(!worker_calls.stopped(worker_calls.worker));
    assert(worker_calls.wait_ticks(worker_calls.worker, 480));
    assert(captured_wait == 480);
    stopped_result = 1;
    assert(worker_calls.stopped(worker_calls.worker));
    stopped_result = 0;

    // A declarative mask event changes w2 of the NEXT native ring call.
    constexpr Event events[] = {
        {0, Command::bubble_state, 3},
        {0, Command::ring_spawn, 0},
        {1000000, Command::bubble_state, -1},
        {1000000, Command::ring_spawn, 0},
    };
    ReplaceSession session;
    assert(session.prepare(events, 4, {emit_ring, &binding}));
    assert(session.begin_after_verified_launch(true));
    assert(session.advance(0) == 2 && captured_mask == 3);
    assert(session.advance(1000000) == 2 && captured_mask == -1);
    assert(native_calls == 4 && session.finished_events());
    session.reset();

    // Special original ring number 33: native Stage68 flag 1 -> mask 1,
    // other flag values -> -1. No extra ring worker gets constructed.
    constexpr Event special[] = {
        {0, Command::stage68_mask, 0},
        {0, Command::ring_spawn, 0},
        {0, Command::bubble_state, -1},
        {1000000, Command::ring_spawn, 0},
    };
    current_stage_flag = 1;
    assert(session.prepare(special, 4, {emit_ring, &binding, resolve_stage68_mask}));
    assert(session.begin_after_verified_launch(true));
    assert(session.advance(0) == 3 && captured_mask == 1);
    assert(session.advance(1000000) == 1 && captured_mask == -1);
    session.reset();
    current_stage_flag = 0;
    assert(session.prepare(special, 4, {emit_ring, &binding, resolve_stage68_mask}));
    assert(session.begin_after_verified_launch(true));
    assert(session.advance(0) == 3 && captured_mask == -1);
    session.reset();
    assert(!session.prepare(special, 4, {emit_ring, &binding}));
    assert(session.error() == Error::missing_adapter);

    assert(!emit_ring(nullptr, -1));
    assert(!emit_ring(&binding, 16));
    assert(!emit_ring(&binding, -2));
    const auto previous_calls = native_calls;
    binding.original_worker = nullptr;
    assert(!emit_ring(&binding, 0));
    binding.original_worker = reinterpret_cast<void*>(kWorker);
    binding.emitter = nullptr;
    assert(!emit_ring(&binding, 0));
    assert(native_calls == previous_calls);
    binding.read_stage_flag = nullptr;
    std::int32_t special_mask = 99;
    assert(!resolve_stage68_mask(&binding, &special_mask));
    binding.native_wait = nullptr;
    assert(!wait_on_original_worker(&binding, 480));
    binding.native_stopped = nullptr;
    assert(original_worker_stopped(&binding));
    binding.native_scene_action = nullptr;
    assert(!emit_scene_action(&binding, 0));
}
