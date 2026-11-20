#pragma once

// Host-testable Stage68 worker policy, NOT an installed native thread hook.
// Proven for the hash-pinned original main (research source only):
// - Stage68 worker entry main+0x42c0c0; ring call site main+0x42ca40
// - native SceneRing_Hoop emitter main+0x217960
// - wait main+0x514d70; stopped main+0x514dd0; 480 ticks/beat
// - the emitter receives scene, worker and signed bubbleState in x0/x1/w2.
// Linking and calling these addresses in a real game STILL requires verified
// Build ID, ABI, live Stage+0x2ca0 scene, thread ownership and teardown.

#include <cstddef>
#include <cstdint>
#include <limits>

#include "groove_replace_session.hpp"

namespace groove_hoop_native {

constexpr std::uint32_t kNativeTicksPerBeat = 480;
constexpr std::uintptr_t kStage68WorkerEntryRva = 0x42c0c0;
constexpr std::uintptr_t kStage68RingCallsiteRva = 0x42ca40;
constexpr std::uintptr_t kNativeRingEmitterRva = 0x217960;
constexpr std::uintptr_t kNativeWaitRva = 0x514d70;
constexpr std::uintptr_t kNativeStoppedRva = 0x514dd0;
constexpr std::size_t kStage68SceneOffset = 0x2ca0;

struct WorkerCalls {
    bool (*stopped)(void* worker) = nullptr;
    bool (*wait_ticks)(void* worker, std::int32_t ticks) = nullptr;
    void* worker = nullptr;
};

enum class Result : std::uint8_t {
    completed,
    cancelled,
    invalid,
    wait_failed,
    ring_failed,
};

struct Report {
    Result result;
    std::size_t events_processed;
    std::size_t rings_emitted;
};

// Microbeats from JSON must convert EXACTLY to original native ticks. This
// avoids changing timing through float rounding or a synthetic timer.
inline bool to_native_ticks(std::int64_t beat_micro, std::uint32_t* out) {
    if (!out || beat_micro < 0) return false;
    const auto whole = static_cast<std::uint64_t>(beat_micro) /
                       static_cast<std::uint64_t>(groove_runtime::kMicrobeatsPerBeat);
    const auto remainder = static_cast<std::uint64_t>(beat_micro) %
                           static_cast<std::uint64_t>(groove_runtime::kMicrobeatsPerBeat);
    constexpr auto limit = static_cast<std::uint64_t>(std::numeric_limits<std::int32_t>::max());
    if (whole > limit / kNativeTicksPerBeat) return false;
    const std::uint64_t fractional = remainder * kNativeTicksPerBeat;
    if (fractional % groove_runtime::kMicrobeatsPerBeat != 0) return false;
    const std::uint64_t ticks = whole * kNativeTicksPerBeat +
                                fractional / groove_runtime::kMicrobeatsPerBeat;
    if (ticks > limit) return false;
    *out = static_cast<std::uint32_t>(ticks);
    return true;
}

// Called by a previously correlated, game-owned Stage68 worker. Preflight
// every event BEFORE the first native wait or ring emission; no per-frame SD
// work or independent wall-clock worker is created here. The caller must
// arrange that the ORIGINAL Stage68 event stream cannot also run, and that
// Scene/worker lifetime outlives all native emitter-owned children.
inline Report run_replacement(groove_runtime::ReplaceSession& session,
                              const groove_runtime::Event* events,
                              std::size_t count, WorkerCalls calls) {
    if (!session.owns_events(events, count) || !calls.worker ||
        !calls.stopped || !calls.wait_ticks) {
        session.abort_from_worker(groove_runtime::Error::invalid_sequence);
        return {Result::invalid, 0, 0};
    }
    std::uint32_t previous = 0;
    for (std::size_t i = 0; i < count; ++i) {
        std::uint32_t tick = 0;
        if (!to_native_ticks(events[i].beat_micro, &tick) || tick < previous) {
            session.abort_from_worker(groove_runtime::Error::invalid_sequence);
            return {Result::invalid, 0, 0};
        }
        previous = tick;
    }

    previous = 0;
    std::size_t processed = 0;
    std::size_t emitted = 0;
    while (processed < count) {
        std::uint32_t tick = 0;
        // Already validated above; duplicate beats are processed together.
        (void)to_native_ticks(events[processed].beat_micro, &tick);
        if (calls.stopped(calls.worker)) {
            session.abort_from_worker(groove_runtime::Error::cancelled);
            return {Result::cancelled, processed, emitted};
        }
        if (tick > previous &&
            !calls.wait_ticks(calls.worker, static_cast<std::int32_t>(tick - previous))) {
            session.abort_from_worker(groove_runtime::Error::native_wait_failed);
            return {Result::wait_failed, processed, emitted};
        }
        if (calls.stopped(calls.worker)) {
            session.abort_from_worker(groove_runtime::Error::cancelled);
            return {Result::cancelled, processed, emitted};
        }
        const std::size_t now = session.advance(events[processed].beat_micro);
        for (std::size_t i = processed; i < processed + now; ++i)
            if (events[i].command == groove_runtime::Command::ring_spawn) ++emitted;
        processed += now;
        if (session.status() == groove_runtime::Status::fault || now == 0)
            return {Result::ring_failed, processed, emitted};
        previous = tick;
    }
    return {Result::completed, processed, emitted};
}

} // namespace groove_hoop_native
