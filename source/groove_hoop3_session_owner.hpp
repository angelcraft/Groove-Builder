#pragma once

// Host-tested coordinator for ONE staged Hoop3 replacement. NOT a Switch hook,
// SD ZIP parser, safe native instance owner or installable subsdk. The game's
// real menu/Stage68/worker callbacks and concurrency/lifetime guarantees MUST
// be verified and connected separately. Instantiate in static/BSS storage:
// the preallocated 10k-event arena must never occupy the native worker stack.

#include <array>
#include <cstddef>
#include <cstdint>

#include "groove_binary_timeline.hpp"
#include "groove_hoop_native_schedule.hpp"
#include "hoop3_stage68_route_gate.hpp"

namespace groove_hoop3 {

enum class Phase : std::uint8_t {
    empty,
    ready,
    awaiting_factory,
    awaiting_stage_branch,
    active,
    running,
    completed,
    fault,
};

enum class MenuAction : std::uint8_t {
    original_game,
    hoop3_launch,
    locked_hoop3_slot,
    block_until_teardown,
};

enum class StageAction : std::uint8_t {
    original_route,
    skip_practice_and_replace,
    block_stage,
};

enum class WorkerAction : std::uint8_t {
    original_worker,
    custom_worker_finished,
    block_worker,
};

struct WorkerOutcome {
    WorkerAction action;
    groove_hoop_native::Report report;
};

class SessionOwner {
public:
    // Only after the WHOLE ZIP + manifest + editable JSON/cache relationship
    // is validated by the eventual trusted archive loader. This function
    // checks the binary independently, owns its data and preflights every
    // original-clock tick before an extra menu cell can be made available.
    // It does NOT itself authenticate a ZIP or confer a Switch file lease.
    bool load_prevalidated_timeline(const std::uint8_t* data, std::size_t size) {
        if (phase_ != Phase::empty && phase_ != Phase::ready) return false;
        unload();
        std::size_t count = 0;
        if (!groove_runtime::decode_binary_timeline(
                data, size, events_.data(), events_.size(), &count)) return false;
        std::uint32_t previous = 0;
        std::size_t ring_count = 0;
        for (std::size_t i = 0; i < count; ++i) {
            std::uint32_t tick = 0;
            if (!groove_hoop_native::to_native_ticks(events_[i].beat_micro, &tick) ||
                tick < previous) return false;
            previous = tick;
            ring_count += events_[i].command == groove_runtime::Command::ring_spawn;
        }
        if (ring_count == 0) return false;
        count_ = count;
        ring_count_ = ring_count;
        phase_ = Phase::ready;
        return true;
    }

    // Never unload/change a pack while it may be referenced by the original
    // game worker, including a completed or faulted session pending teardown.
    bool unload() {
        if (phase_ != Phase::empty && phase_ != Phase::ready) return false;
        gate_.clear();
        session_.reset();
        count_ = 0;
        ring_count_ = 0;
        tracked_stage_ = 0;
        phase_ = Phase::empty;
        return true;
    }

    MenuAction on_confirmed_menu_launch(const hoop3_launch::Selection& selected) {
        if (phase_ != Phase::empty && phase_ != Phase::ready)
            return MenuAction::block_until_teardown;
        gate_.clear();
        if (!hoop3_launch::is_hoop3(selected))
            return MenuAction::original_game;
        if (phase_ != Phase::ready || selected.launch_ticket == 0)
            return MenuAction::locked_hoop3_slot;
        if (!gate_.on_confirmed_launch(selected))
            return MenuAction::locked_hoop3_slot;
        phase_ = Phase::awaiting_factory;
        return MenuAction::hoop3_launch;
    }

    bool on_first_factory_return(const hoop3_launch::FactoryResult& stage,
                                 const hoop3_launch::NativeMenuRecord& record) {
        if (phase_ != Phase::awaiting_factory) return false;
        if (!gate_.on_factory_return(stage, record)) {
            // Preserve the first allocated object's address for quarantine
            // and eventual join/destruction, even if its identity was wrong.
            tracked_stage_ = stage.stage_address;
            phase_ = Phase::fault;
            return false;
        }
        tracked_stage_ = stage.stage_address;
        phase_ = Phase::awaiting_stage_branch;
        return true;
    }

    StageAction on_stage68_practice_branch(
        std::uintptr_t stage, const hoop3_launch::NativeMenuRecord& record,
        groove_runtime::NativeAdapter adapter) {
        if (phase_ == Phase::ready || phase_ == Phase::empty)
            return StageAction::original_route;
        if (tracked_stage_ != 0 && stage != tracked_stage_)
            return StageAction::original_route; // A distinct original stage.
        if (phase_ != Phase::awaiting_stage_branch || stage != tracked_stage_ ||
            !gate_.consume_on_stage68_branch(stage, record) ||
            !session_.prepare(events_.data(), count_, adapter) ||
            !session_.begin_after_verified_launch(true)) {
            phase_ = Phase::fault;
            return StageAction::block_stage;
        }
        phase_ = Phase::active;
        return StageAction::skip_practice_and_replace;
    }

    // Must be invoked INSTEAD OF (never alongside) the original Stage68
    // sequence body for the same verified instance. No new worker is started.
    // The caller must bind the exact original SeqThread and live scene and
    // must serialize this call with scene teardown/cancellation callbacks.
    WorkerOutcome on_stage68_worker(std::uintptr_t stage,
                                    groove_hoop_native::WorkerCalls calls) {
        using groove_hoop_native::Result;
        if ((phase_ == Phase::ready || phase_ == Phase::empty) ||
            (tracked_stage_ != 0 && stage != tracked_stage_))
            return {WorkerAction::original_worker, {Result::invalid, 0, 0}};
        if (phase_ != Phase::active || stage != tracked_stage_) {
            phase_ = Phase::fault;
            return {WorkerAction::block_worker, {Result::invalid, 0, 0}};
        }
        phase_ = Phase::running;
        const auto report = groove_hoop_native::run_replacement(
            session_, events_.data(), count_, calls);
        phase_ = report.result == Result::completed ? Phase::completed : Phase::fault;
        // Even on success the original sequence must remain suppressed until
        // the real native worker/ring children have completed teardown.
        return {WorkerAction::custom_worker_finished, report};
    }

    // A cancellation BEFORE native worker entry invalidates the origin but
    // cannot release its allocated stage until owner-confirmed destruction.
    void on_cancel_before_worker() {
        if (phase_ == Phase::awaiting_factory) {
            // This callback may only be sent while the game guarantees no
            // StageFactory result was committed or native worker started.
            gate_.clear();
            phase_ = Phase::ready;
        } else if (phase_ == Phase::awaiting_stage_branch ||
                   phase_ == Phase::active) {
            gate_.clear();
            session_.abort_from_worker(groove_runtime::Error::cancelled);
            phase_ = Phase::fault;
        }
    }

    // For a rejected first Factory callback that never yielded a trusted
    // Stage68 instance. The native caller must independently prove the
    // aborted transition has no outstanding scene/worker ownership.
    bool clear_rejected_transition_after_quiescence(bool no_owned_stage_alive) {
        if (!no_owned_stage_alive || phase_ != Phase::fault || tracked_stage_ != 0)
            return false;
        gate_.clear();
        session_.reset();
        phase_ = count_ ? Phase::ready : Phase::empty;
        return true;
    }

    bool on_scene_destroyed_after_join(std::uintptr_t stage, bool worker_joined) {
        if (!worker_joined || tracked_stage_ == 0 || stage != tracked_stage_ ||
            phase_ == Phase::running) return false;
        gate_.clear();
        session_.reset();
        tracked_stage_ = 0;
        phase_ = count_ != 0 ? Phase::ready : Phase::empty;
        return true;
    }

    Phase phase() const { return phase_; }
    std::size_t ring_count() const { return ring_count_; }
    bool hoop3_slot_unlocked() const { return phase_ == Phase::ready; }
    bool tracks_stage(std::uintptr_t stage) const {
        return stage != 0 && tracked_stage_ != 0 && tracked_stage_ == stage;
    }
    bool suppress_original_events_for(std::uintptr_t stage) const {
        // Never suppress an unrelated original Hoop2 Stage68 instance.
        return tracked_stage_ != 0 && stage == tracked_stage_ &&
               (session_.suppress_original_events() ||
               phase_ == Phase::running || phase_ == Phase::completed ||
               phase_ == Phase::fault);
    }

private:
    // Fixed storage is mandatory: no pointers into a short-lived ZIP inflate
    // buffer can outlive the installer/loader operation.
    std::array<groove_runtime::Event, groove_runtime::kMaxEvents> events_{};
    std::size_t count_ = 0;
    std::size_t ring_count_ = 0;
    std::uintptr_t tracked_stage_ = 0;
    hoop3_launch::Stage68RouteGate gate_{};
    groove_runtime::ReplaceSession session_{};
    Phase phase_ = Phase::empty;
};

} // namespace groove_hoop3
