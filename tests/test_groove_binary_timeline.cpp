#include "groove_binary_timeline.hpp"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <vector>

using namespace groove_runtime;

int main() {
    // Exact GRT1 representation produced by tools/groove_pack.py for two
    // events: BubbleState(-1) at beat 0 and RingSpawn(normal) at beat 1.
    const std::vector<std::uint8_t> valid = {
        'G', 'R', 'T', '1', 2, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        2, 0, 0, 0, 255, 255, 255, 255,
        0x40, 0x42, 0x0F, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
    };
    Event events[2]{};
    std::size_t count = 123;
    assert(decode_binary_timeline(valid.data(), valid.size(), events, 2, &count));
    assert(count == 2);
    assert(events[0].beat_micro == 0);
    assert(events[0].command == Command::bubble_state);
    assert(events[0].argument == -1);
    assert(events[1].beat_micro == 1000000);
    assert(events[1].command == Command::ring_spawn);
    assert(events[1].argument == 0);

    assert(!decode_binary_timeline(valid.data(), valid.size(), events, 1, &count));
    assert(count == 0);
    assert(!decode_binary_timeline(valid.data(), valid.size() - 1, events, 2, &count));
    assert(!decode_binary_timeline(valid.data(), valid.size(), events, 2, nullptr));

    auto bad = valid;
    bad[0] = 'X';
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    bad = valid;
    bad[4] = 3; // Declared count cannot exceed the available payload.
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    bad = valid;
    bad[8] = 0x80; // First beat 2,000,000; second remains 1,000,000.
    bad[9] = 0x84;
    bad[10] = 0x1E;
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    bad = valid;
    bad[36] = 3; // Nonzero normal ring variant.
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    bad = valid;
    bad[16] = 9; // Unknown command.
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    bad = valid;
    bad[20] = 16; // BubbleState mask out of range.
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    bad = valid;
    bad[16] = 3; // Explicit Stage68-native BubbleState resolver.
    bad[20] = 0;
    bad[21] = 0;
    bad[22] = 0;
    bad[23] = 0;
    assert(decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    assert(events[0].command == Command::stage68_mask);
    bad[20] = 1; // Stage68 resolver takes no immediate argument.
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    bad = valid;
    bad[16] = 4; // Whitelisted original Stage68 scene action.
    bad[20] = 2; // hide
    bad[21] = 0;
    bad[22] = 0;
    bad[23] = 0;
    assert(decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
    assert(events[0].command == Command::scene_action && events[0].argument == 2);
    bad[20] = 3; // Unknown scene action.
    assert(!decode_binary_timeline(bad.data(), bad.size(), events, 2, &count));
}
