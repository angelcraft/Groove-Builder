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

enum class Command : std::uint8_t { ring_spawn, bubble_state };

// "ring_spawn" currently supports only variant 0 (normal). The BubbleState
// argument is an *uninterpreted* mask; the meaning of each bit is not proven.
struct Event {
    std::int64_t beat_micro;
    Command command;
    std::int32_t argument;
};

struct NativeAdapter {
    using Callback = bool (*)(void* context, std::int32_t argument);
    Callback ring_spawn = nullptr;
    Callback bubble_state = nullptr;
    void* context = nullptr;
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
        if (!adapter.ring_spawn || !adapter.bubble_state) {
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
            NativeAdapter::Callback callback = event.command == Command::ring_spawn
                ? adapter_.ring_spawn : adapter_.bubble_state;
            if (!callback(adapter_.context, event.argument)) {
                fail(Error::native_call_failed);
                return dispatched;
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
    Status status() const { return status_; }
    Error error() const { return error_; }

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
        adapter_ = {};
        status_ = Status::idle;
    }

    const Event* events_ = nullptr;
    std::size_t count_ = 0;
    std::size_t next_ = 0;
    std::int64_t last_beat_ = -1;
    NativeAdapter adapter_{};
    Status status_ = Status::idle;
    Error error_ = Error::none;
};

} // namespace groove_runtime
