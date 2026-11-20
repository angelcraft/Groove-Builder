#pragma once

// Pure C++17, allocation-free reader for a precompiled timeline.bin inside a
// validated .groove ZIP. The ZIP/container/JSON validation remains required.
// No native Switch file services or unsafe process memory access occur here.

#include <cstddef>
#include <cstdint>
#include <limits>

#include "groove_replace_session.hpp"

namespace groove_runtime {

inline std::uint32_t read_le32(const std::uint8_t* ptr) {
    return std::uint32_t(ptr[0]) | (std::uint32_t(ptr[1]) << 8) |
           (std::uint32_t(ptr[2]) << 16) | (std::uint32_t(ptr[3]) << 24);
}

inline std::uint64_t read_le64(const std::uint8_t* ptr) {
    return std::uint64_t(read_le32(ptr)) |
           (std::uint64_t(read_le32(ptr + 4)) << 32);
}

// On false, the output buffer may contain partial data and MUST be discarded.
// The caller owns output for the full lifetime of ReplaceSession.
inline bool decode_binary_timeline(const std::uint8_t* data, std::size_t length,
                                   Event* output, std::size_t capacity,
                                   std::size_t* decoded_count) {
    if (decoded_count) *decoded_count = 0;
    if (!data || !output || !decoded_count || length < 8 ||
        data[0] != 'G' || data[1] != 'R' || data[2] != 'T' || data[3] != '1')
        return false;
    const std::size_t count = read_le32(data + 4);
    if (count == 0 || count > kMaxEvents || count > capacity ||
        length != 8 + count * 16) return false;

    std::int64_t previous = -1;
    for (std::size_t i = 0; i < count; ++i) {
        const std::uint8_t* bytes = data + 8 + i * 16;
        const std::uint64_t beat = read_le64(bytes);
        const std::uint32_t command = read_le32(bytes + 8);
        const std::int32_t argument = static_cast<std::int32_t>(read_le32(bytes + 12));
        if (beat > std::uint64_t(std::numeric_limits<std::int64_t>::max()) ||
            static_cast<std::int64_t>(beat) < previous) return false;
        Command kind;
        if (command == 1 && argument == 0)
            kind = Command::ring_spawn;
        else if (command == 2 && argument >= -1 && argument <= 15)
            kind = Command::bubble_state;
        else if (command == 3 && argument == 0)
            kind = Command::stage68_mask;
        else if (command == 4 && argument >= 0 && argument <= 2)
            kind = Command::scene_action;
        else
            return false;
        output[i] = {static_cast<std::int64_t>(beat), kind, argument};
        previous = static_cast<std::int64_t>(beat);
    }
    *decoded_count = count;
    return true;
}

} // namespace groove_runtime
