#pragma once

// Source-only shared callback policy, not an installed ARM64 interposer.
// If a future verified DATA-pointer hook routes Stage68 callbacks here,
// unrelated instances retain the exact ORIGINAL game function. A tracked
// Hoop3 instance NEVER silently falls back to Hoop2 after a fault, duplicate
// worker entry, or missing native callback. Native thread serialization and
// scene destruction must be proven before a real integration.

#include <cstdint>

#include "groove_hoop3_session_owner.hpp"

namespace groove_hoop3 {

using OriginalSequence = void (*)(void* stage68, void* original_worker);

enum class SequenceDispatch : std::uint8_t {
    original_worker,
    replaced_worker,
    blocked_owned_stage,
    invalid_original_callback,
    invalid_callback_arguments,
};

struct SequenceOutcome {
    SequenceDispatch dispatch;
    groove_hoop_native::Report report;
};

inline SequenceOutcome route_stage68_sequence(SessionOwner& session,
                                              OriginalSequence original,
                                              void* stage68,
                                              void* original_worker,
                                              groove_hoop_native::WorkerCalls calls) {
    using groove_hoop_native::Result;
    const auto empty = groove_hoop_native::Report{Result::invalid, 0, 0};
    if (!stage68 || !original_worker)
        return {SequenceDispatch::invalid_callback_arguments, empty};
    if (!original)
        return {SequenceDispatch::invalid_original_callback, empty};

    // Do not rely only on selection, native index 41 or even a pending
    // launch: only the FIRST verified factory instance may be replaced.
    if (!session.tracks_stage(reinterpret_cast<std::uintptr_t>(stage68))) {
        // For unmodified Hoop2, ignore ALL optional Groove worker bindings.
        // Requiring a working Groove adapter here would break the base game.
        original(stage68, original_worker);
        return {SequenceDispatch::original_worker, empty};
    }

    if (calls.worker != original_worker) {
        // Mark the owned session faulted: a later callback must not be able to
        // replay it after an unexpected SeqThread identity was observed.
        (void)session.on_stage68_worker(
            reinterpret_cast<std::uintptr_t>(stage68), {});
        return {SequenceDispatch::blocked_owned_stage, empty};
    }
    const auto result = session.on_stage68_worker(
        reinterpret_cast<std::uintptr_t>(stage68), calls);
    if (result.action == WorkerAction::custom_worker_finished)
        return {result.report.result == Result::completed ?
                    SequenceDispatch::replaced_worker :
                    SequenceDispatch::blocked_owned_stage, result.report};
    // In particular, NEVER invoke original(stage68,worker) here. A rejected
    // pack or unexpected callback order must not play Hoop2 under Hoop3 ID.
    return {SequenceDispatch::blocked_owned_stage, result.report};
}

} // namespace groove_hoop3
