#pragma once

// Exact SceneRing_Hoop argument-mapping policy. This is deliberately NOT a
// hook installer or an RVA resolver: an owner must verify the original main,
// Stage68 instance, original worker, emitter ABI and object lifetime BEFORE
// providing these pointers. Never bind an arbitrary address from a .groove.

#include <cstdint>
#include <limits>

#include "groove_hoop_native_schedule.hpp"

namespace groove_hoop_native {

// Original Stage68 dispatch: x0 = Stage68 + 0x2ca0 (scene receiver),
// x1 = the ORIGINAL SeqThread worker, w2 = signed BubbleState mask.
// We do not infer whether this native function has a useful return value.
using RingEmitter = void (*)(void* scene_receiver, void* original_worker,
                             std::int32_t bubble_state);
using NativeWait = void (*)(void* original_worker, std::int32_t ticks);
using NativeStopped = std::int32_t (*)(void* original_worker);
using NativeSceneAction = void (*)(void* stage68, const char* action_name);

struct RingBinding {
    void* verified_stage68 = nullptr;
    void* original_worker = nullptr;
    RingEmitter emitter = nullptr;
    // Host/owner-supplied guarded read of Stage68+0x2c94, not a raw hook.
    bool (*read_stage_flag)(void* verified_stage68, std::uint8_t* output) = nullptr;
    NativeWait native_wait = nullptr;
    NativeStopped native_stopped = nullptr;
    NativeSceneAction native_scene_action = nullptr;
    // Pointers to original, verified main RO strings, NOT pack-controlled
    // pointers. 0=basic; 1=change; 2=hide.
    const char* native_scene_labels[3]{};
};

// Stage68's original sequence invokes main+0x1390e0 with (Stage68*, label)
// 11 times: basic/change/hide. Replaying only SceneRing_Hoop would lose these
// original stage transitions. This call is an explicit whitelist, not an
// unrestricted native-call opcode for arbitrary user-provided addresses.
inline bool emit_scene_action(void* binding_ptr, std::int32_t action_id) {
    if (!binding_ptr || action_id < 0 || action_id > 2) return false;
    const auto& binding = *static_cast<const RingBinding*>(binding_ptr);
    if (!binding.verified_stage68 || !binding.native_scene_action ||
        !binding.native_scene_labels[action_id]) return false;
    binding.native_scene_action(binding.verified_stage68,
                                binding.native_scene_labels[action_id]);
    return true;
}

// The original wait routine returns no success status. A false result here
// only means the bridge could NOT safely invoke it; after a native wait the
// scheduler rechecks the original stopped predicate before the next event.
inline bool wait_on_original_worker(void* binding_ptr, std::int32_t ticks) {
    if (!binding_ptr || ticks < 0) return false;
    const auto& binding = *static_cast<const RingBinding*>(binding_ptr);
    if (!binding.original_worker || !binding.native_wait) return false;
    binding.native_wait(binding.original_worker, ticks);
    return true;
}

inline bool original_worker_stopped(void* binding_ptr) {
    if (!binding_ptr) return true; // Missing bridge cancels; never run cues.
    const auto& binding = *static_cast<const RingBinding*>(binding_ptr);
    if (!binding.original_worker || !binding.native_stopped) return true;
    return binding.native_stopped(binding.original_worker) != 0;
}

inline WorkerCalls bound_original_worker_calls(RingBinding& binding) {
    return {original_worker_stopped, wait_on_original_worker, &binding};
}

// Ring 33 of the original Hoop2 uses mask 1 only when Stage+0x2c94 == 1;
// otherwise it passes -1. The owner controls when this guarded read is safe.
inline bool resolve_stage68_mask(void* binding_ptr, std::int32_t* output_mask) {
    if (!binding_ptr || !output_mask) return false;
    const auto& binding = *static_cast<const RingBinding*>(binding_ptr);
    if (!binding.verified_stage68 || !binding.read_stage_flag) return false;
    std::uint8_t flag = 0;
    if (!binding.read_stage_flag(binding.verified_stage68, &flag)) return false;
    *output_mask = flag == 1 ? 1 : -1;
    return true;
}

// Only a bridge for ReplaceSession::NativeAdapter::ring_spawn. In particular,
// this function does not spawn its own scene, timer or child actor. The native
// emitter itself owns the game's original ring children and input behavior.
inline bool emit_ring(void* binding_ptr, std::int32_t bubble_state) {
    if (!binding_ptr || bubble_state < -1 || bubble_state > 15) return false;
    const auto& binding = *static_cast<const RingBinding*>(binding_ptr);
    if (!binding.verified_stage68 || !binding.original_worker || !binding.emitter)
        return false;
    const auto stage = reinterpret_cast<std::uintptr_t>(binding.verified_stage68);
    if (stage > std::numeric_limits<std::uintptr_t>::max() - kStage68SceneOffset)
        return false;
    void* scene_receiver = reinterpret_cast<void*>(stage + kStage68SceneOffset);
    binding.emitter(scene_receiver, binding.original_worker, bubble_state);
    return true;
}

} // namespace groove_hoop_native
