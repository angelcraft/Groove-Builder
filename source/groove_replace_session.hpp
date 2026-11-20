#pragma once

// Portable, host-tested policy for a future resident Groove Engine.
// This is NOT an NSO hook, a ZIP/JSON parser or a verified native adapter.
// The Switch integration must validate the .groove pack, correlate the
// virtual launch with the real Stage68 instance, then bind known-safe native
// calls before starting this session. No original game address is used here.

#include <cstddef>
#include <cstdint>

namespace groove_runtime {

constexpr std::int64_t kMicrobeatsPerBeat = 1000000;
constexpr std::size_t kMaxEvents = 10000;

enum class Command : std::uint8_t {
    ring_spawn,
    bubble_state,
    stage68_mask,
    scene_action,
};

// "ring_spawn" currently supports only variant 0 (normal). BubbleState is
// not a second native function: it is the signed w2 argument passed to the
// original SceneRing_Hoop emitter for EACH ring. -1 is a special sentinel,
// distinct from positive mask 15; bits 0..3 are audited, player bit 4 is not.
struct Event {
    std::int64_t beat_micro;
    Command command;
    std::int32_t argument;
};

struct NativeAdapter {
    // Must call the original game's SceneRing_Hoop(scene, worker, bubbleState)
    // through a separately ABI/lifetime-verified bridge. NEVER pass the
    // ring_spawn command's variant (0) as the native bubbleState argument.
    using Callback = bool (*)(void* context, std::int32_t bubble_state);
    using MaskResolver = bool (*)(void* context, std::int32_t* output_mask);
    using SceneCallback = bool (*)(void* context, std::int32_t action_id);
    Callback ring_spawn = nullptr;
    void* context = nullptr;
    MaskResolver stage68_mask = nullptr;
    SceneCallback scene_action = nullptr;
};

enum class Status : std::uint8_t {
    idle,
    prepared,
    playing,
    fault,
};

enum class Error : std::uint8_t {
    none,
    invalid_sequence,
    missing_adapter,
    untrusted_launch,
    clock_reversed,
    native_call_failed,
    native_wait_failed,
    cancelled,
};

class ReplaceSession {
public:
    // Events are already parsed from a checked .groove archive. The caller
    // retains their storage, which MUST outlive this session. In particular,
    // never keep pointers into a temporary decompression buffer.
    bool prepare(const Event* events, std::size_t count, NativeAdapter adapter) {
        reset();
        if (!events || count == 0 || count > kMaxEvents) {
            error_ = Error::invalid_sequence;
            return false;
        }
        if (!adapter.ring_spawn) {
            error_ = Error::missing_adapter;
            return false;
        }
        std::int64_t previous = -1;
        for (std::size_t i = 0; i < count; ++i) {
            const Event& event = events[i];
            if (event.beat_micro < 0 || event.beat_micro < previous ||
                !valid_command(event)) {
                error_ = Error::invalid_sequence;
                return false;
            }
            if (event.command == Command::stage68_mask && !adapter.stage68_mask) {
                error_ = Error::missing_adapter;
                return false;
            }
            if (event.command == Command::scene_action && !adapter.scene_action) {
                error_ = Error::missing_adapter;
                return false;
            }
            previous = event.beat_micro;
        }
        events_ = events;
        count_ = count;
        adapter_ = adapter;
        status_ = Status::prepared;
        return true;
    }

    // ONLY pass true after a one-shot virtual-menu/Stage68 correlation is
    // consumed. A text lookup, selected cell or borrowed kind=1,index=41
    // alone is NOT proof that this is a Hoop3 launch.
    bool begin_after_verified_launch(bool verified) {
        if (status_ != Status::prepared) return false;
        if (!verified) {
            error_ = Error::untrusted_launch;
            reset_runtime();
            return false;
        }
        status_ = Status::playing;
        return true;
    }

    // No original Hoop2 sequence may run once custom playback begins, even
    // after a callback failure. The native integration must return safely to
    // the menu on fault, NOT fall through to Hoop2 events mid-stage.
    bool suppress_original_events() const {
        return status_ == Status::playing || status_ == Status::fault;
    }

    bool skip_practice() const { return status_ == Status::playing; }

    // Called from the ORIGINAL game's beat clock, not wall time. The tick
    // performs no allocation, SD access, JSON parsing or decompression.
    // A callback failure locks the session until the owner resets it.
    std::size_t advance(std::int64_t beat_micro) {
        if (status_ != Status::playing) return 0;
        if (beat_micro < 0 || beat_micro < last_beat_) {
            fail(Error::clock_reversed);
            return 0;
        }
        last_beat_ = beat_micro;
        std::size_t dispatched = 0;
        while (next_ < count_ && events_[next_].beat_micro <= beat_micro) {
            const Event& event = events_[next_];
            if (event.command == Command::bubble_state) {
                // Declarative parameter update; no new native actor/worker.
                bubble_state_ = event.argument;
            } else if (event.command == Command::stage68_mask) {
                // Original special Stage68 ring: flag Stage+0x2c94 == 1
                // selects mask 1, all other cases use -1. The adapter must
                // read ONLY an externally verified live Stage68 instance.
                std::int32_t mask = -1;
                if (!adapter_.stage68_mask(adapter_.context, &mask) ||
                    (mask != -1 && mask != 1)) {
                    fail(Error::native_call_failed);
                    return dispatched;
                }
                bubble_state_ = mask;
            } else if (event.command == Command::scene_action) {
                // Explicitly whitelisted original Stage68 scene-state helper
                // (0=basic,1=change,2=hide); no arbitrary function addresses.
                if (!adapter_.scene_action(adapter_.context, event.argument)) {
                    fail(Error::native_call_failed);
                    return dispatched;
                }
            } else {
                if (!adapter_.ring_spawn(adapter_.context, bubble_state_)) {
                    fail(Error::native_call_failed);
                    return dispatched;
                }
            }
            ++next_;
            ++dispatched;
        }
        return dispatched;
    }

    bool finished_events() const {
        return status_ == Status::playing && next_ == count_;
    }

    std::size_t remaining_events() const { return count_ - next_; }
    bool owns_events(const Event* events, std::size_t count) const {
        return status_ == Status::playing && events_ == events && count_ == count;
    }
    std::int32_t current_bubble_state() const { return bubble_state_; }
    Status status() const { return status_; }
    Error error() const { return error_; }

    // The native wait/stop adapter calls this if its original worker is
    // cancelled or faults. Keep suppressing base events until scene teardown.
    void abort_from_worker(Error error) {
        if (status_ == Status::playing && error != Error::none)
            fail(error);
    }

    // Required on scene destruction, cancel, return to menu or new launch.
    void reset() {
        reset_runtime();
        error_ = Error::none;
    }

private:
    static bool valid_command(const Event& event) {
        switch (event.command) {
            case Command::ring_spawn:
                return event.argument == 0;
            case Command::bubble_state:
                return event.argument >= -1 && event.argument <= 15;
            case Command::stage68_mask:
                return event.argument == 0;
            case Command::scene_action:
                return event.argument >= 0 && event.argument <= 2;
        }
        return false;
    }

    void fail(Error error) {
        error_ = error;
        status_ = Status::fault;
    }

    void reset_runtime() {
        events_ = nullptr;
        count_ = 0;
        next_ = 0;
        last_beat_ = -1;
        bubble_state_ = -1;
        adapter_ = {};
        status_ = Status::idle;
    }

    const Event* events_ = nullptr;
    std::size_t count_ = 0;
    std::size_t next_ = 0;
    std::int64_t last_beat_ = -1;
    std::int32_t bubble_state_ = -1;
    NativeAdapter adapter_{};
    Status status_ = Status::idle;
    Error error_ = Error::none;
};

} // namespace groove_runtime
