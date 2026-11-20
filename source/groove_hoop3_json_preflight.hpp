#pragma once

// Bounded, allocation-free Hoop3 v1 semantic preflight. This intentionally
// accepts ONLY the one verified Hoop3 identity/Stage68 adapter and no custom
// assets; the generic Python packer still validates other future adapters.
// All JSON is parsed BEFORE a native game worker may enter. An edited
// timeline.json must compile byte-for-byte into the GRT1 event cache.
//
// No native Hook/SD routines are installed here. Instantiate IdSet in BSS;
// never put its 160 KiB hash table on the original game worker's stack.

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

#include "groove_binary_timeline.hpp"
#include "groove_hoop_native_schedule.hpp"

namespace groove_hoop3_json {

constexpr std::size_t kMaxJsonBytes = 1024 * 1024;
constexpr std::size_t kIdSlots = 20011; // >2x maximum event count.

inline bool take(std::uint32_t& mask, unsigned bit) {
    const auto value = std::uint32_t(1) << bit;
    if (mask & value) return false;
    mask |= value;
    return true;
}

inline bool equals(const char* a, const char* b) {
    return std::strcmp(a, b) == 0;
}

class Json {
public:
    Json(const std::uint8_t* input, std::size_t length)
        : bytes_(input), size_(length) {}

    bool valid() const { return bytes_ && size_ > 0 && size_ <= kMaxJsonBytes; }
    bool finished() { white(); return valid() && pos_ == size_; }

    bool symbol(char expected) {
        white();
        if (!valid() || pos_ >= size_ || bytes_[pos_] != expected) return false;
        ++pos_;
        return true;
    }

    template<class Callback>
    bool object(Callback visit) {
        if (!symbol('{')) return false;
        white();
        if (peek('}')) { ++pos_; return true; }
        do {
            char key[65]{};
            if (!string(key, sizeof(key)) || !symbol(':') || !visit(key))
                return false;
            white();
            if (peek('}')) { ++pos_; return true; }
        } while (symbol(','));
        return false;
    }

    template<class Callback>
    bool array(Callback visit, std::size_t* count) {
        if (!count || !symbol('[')) return false;
        *count = 0;
        white();
        if (peek(']')) { ++pos_; return true; }
        do {
            if (*count >= groove_runtime::kMaxEvents || !visit(*count))
                return false;
            ++*count;
            white();
            if (peek(']')) { ++pos_; return true; }
        } while (symbol(','));
        return false;
    }

    bool literal(const char* expected) {
        white();
        if (!valid() || !expected) return false;
        for (std::size_t i = 0; expected[i]; ++i)
            if (pos_ + i >= size_ || bytes_[pos_ + i] !=
                    static_cast<std::uint8_t>(expected[i])) return false;
        pos_ += std::strlen(expected);
        return true;
    }

    bool integer(std::int64_t* output) {
        white();
        if (!valid() || !output || pos_ >= size_) return false;
        bool negative = false;
        if (bytes_[pos_] == '-') { negative = true; ++pos_; }
        if (pos_ >= size_ || bytes_[pos_] < '0' || bytes_[pos_] > '9')
            return false;
        const bool zero = bytes_[pos_] == '0';
        std::uint64_t value = 0;
        unsigned digit_count = 0;
        do {
            const auto digit = static_cast<unsigned>(bytes_[pos_] - '0');
            if (zero && digit_count != 0) return false;
            if (value > (std::uint64_t(INT64_MAX) + (negative ? 1u : 0u) - digit) / 10)
                return false;
            value = value * 10 + digit;
            ++pos_;
            ++digit_count;
        } while (pos_ < size_ && bytes_[pos_] >= '0' && bytes_[pos_] <= '9');
        if (negative && value == (std::uint64_t(INT64_MAX) + 1u))
            *output = INT64_MIN;
        else
            *output = negative ? -static_cast<std::int64_t>(value) :
                                 static_cast<std::int64_t>(value);
        return true;
    }

    // Decode ASCII escapes and Unicode scalar escapes into UTF-8. Reject
    // malformed UTF-8, unpaired surrogates, embedded NUL and control chars.
    // The byte budget includes decoded UTF-8, not the source's backslashes.
    bool string(char* output, std::size_t capacity,
                std::size_t* codepoints = nullptr) {
        if (!output || capacity == 0 || !symbol('"')) return false;
        std::size_t used = 0, points = 0;
        while (pos_ < size_) {
            std::uint32_t scalar = 0;
            const auto ch = bytes_[pos_++];
            if (ch == '"') {
                output[used] = '\0';
                if (codepoints) *codepoints = points;
                return true;
            }
            if (ch == '\\') {
                if (pos_ == size_) return false;
                const auto escape = bytes_[pos_++];
                switch (escape) {
                    case '"': scalar = '"'; break;
                    case '\\': scalar = '\\'; break;
                    case '/': scalar = '/'; break;
                    case 'b': scalar = 8; break;
                    case 'f': scalar = 12; break;
                    case 'n': scalar = 10; break;
                    case 'r': scalar = 13; break;
                    case 't': scalar = 9; break;
                    case 'u': {
                        if (!hex4(&scalar)) return false;
                        if (scalar >= 0xD800 && scalar <= 0xDBFF) {
                            if (pos_ + 6 > size_ || bytes_[pos_++] != '\\' ||
                                bytes_[pos_++] != 'u') return false;
                            std::uint32_t low = 0;
                            if (!hex4(&low) || low < 0xDC00 || low > 0xDFFF)
                                return false;
                            scalar = 0x10000u + ((scalar - 0xD800u) << 10) +
                                     low - 0xDC00u;
                        } else if (scalar >= 0xDC00 && scalar <= 0xDFFF) {
                            return false;
                        }
                        break;
                    }
                    default: return false;
                }
            } else if (ch < 0x80) {
                scalar = ch;
            } else {
                if (ch < 0xC2 || ch > 0xF4) return false;
                const unsigned count = ch < 0xE0 ? 2u : ch < 0xF0 ? 3u : 4u;
                if (pos_ + count - 1 > size_) return false;
                scalar = ch & (count == 2 ? 0x1Fu : count == 3 ? 0x0Fu : 0x07u);
                for (unsigned i = 1; i < count; ++i) {
                    const auto next = bytes_[pos_++];
                    if ((next & 0xC0u) != 0x80u) return false;
                    scalar = (scalar << 6) | (next & 0x3Fu);
                }
                if (scalar < (count == 2 ? 0x80u : count == 3 ? 0x800u : 0x10000u))
                    return false;
            }
            if (scalar < 0x20 || scalar > 0x10FFFF ||
                (scalar >= 0xD800 && scalar <= 0xDFFF)) return false;
            std::uint8_t encoded[4]{};
            const unsigned n = scalar < 0x80 ? 1u : scalar < 0x800 ? 2u :
                               scalar < 0x10000 ? 3u : 4u;
            if (used + n >= capacity) return false;
            if (n == 1) encoded[0] = static_cast<std::uint8_t>(scalar);
            else {
                for (unsigned i = n - 1; i > 0; --i) {
                    encoded[i] = static_cast<std::uint8_t>(0x80u | (scalar & 0x3Fu));
                    scalar >>= 6;
                }
                encoded[0] = static_cast<std::uint8_t>((n == 2 ? 0xC0u :
                              n == 3 ? 0xE0u : 0xF0u) | scalar);
            }
            for (unsigned i = 0; i < n; ++i)
                output[used++] = static_cast<char>(encoded[i]);
            ++points;
        }
        return false;
    }

private:
    void white() {
        while (bytes_ && pos_ < size_ && (bytes_[pos_] == ' ' ||
               bytes_[pos_] == '\t' || bytes_[pos_] == '\n' ||
               bytes_[pos_] == '\r')) ++pos_;
    }
    bool peek(char c) const { return pos_ < size_ && bytes_[pos_] == c; }

    bool hex4(std::uint32_t* result) {
        if (!result || pos_ + 4 > size_) return false;
        std::uint32_t value = 0;
        for (unsigned i = 0; i < 4; ++i) {
            const auto ch = bytes_[pos_++];
            const int digit = ch >= '0' && ch <= '9' ? ch - '0' :
                              ch >= 'a' && ch <= 'f' ? ch - 'a' + 10 :
                              ch >= 'A' && ch <= 'F' ? ch - 'A' + 10 : -1;
            if (digit < 0) return false;
            value = (value << 4) | static_cast<unsigned>(digit);
        }
        *result = value;
        return true;
    }
    const std::uint8_t* bytes_ = nullptr;
    std::size_t size_ = 0;
    std::size_t pos_ = 0;
};

inline bool exact_string(Json& json, const char* expected) {
    char value[129]{};
    return json.string(value, sizeof(value)) && equals(value, expected);
}
inline bool exact_integer(Json& json, std::int64_t expected) {
    std::int64_t value = 0;
    return json.integer(&value) && value == expected;
}
inline bool stable_id(const char* text) {
    if (!text || text[0] < 'a' || text[0] > 'z') return false;
    std::size_t size = 0;
    while (text[size]) {
        const char c = text[size++];
        if (size > 80 || !((c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_'))
            return false;
    }
    return size >= 3;
}

inline bool read_slot(Json& json) {
    std::uint32_t mask = 0;
    return json.object([&](const char* key) {
        return equals(key, "world") ? take(mask, 0) && exact_integer(json, 1) :
               equals(key, "column") ? take(mask, 1) && exact_integer(json, 9) :
               equals(key, "row") ? take(mask, 2) && exact_integer(json, 0) : false;
    }) && mask == 7;
}
inline bool read_base(Json& json) {
    std::uint32_t mask = 0;
    return json.object([&](const char* key) {
        return equals(key, "game") ? take(mask, 0) && exact_string(json, "rhythm_paradise_switch") :
               equals(key, "kind") ? take(mask, 1) && exact_integer(json, 1) :
               equals(key, "index") ? take(mask, 2) && exact_integer(json, 41) :
               equals(key, "adapter") ? take(mask, 3) && exact_string(json, "hoop_trundling") :
               false;
    }) && mask == 15;
}
inline bool read_launch(Json& json) {
    std::uint32_t mask = 0;
    return json.object([&](const char* key) {
        return equals(key, "practice") && take(mask, 0) && exact_string(json, "skip");
    }) && mask == 1;
}
inline bool read_sequence(Json& json) {
    std::uint32_t mask = 0;
    return json.object([&](const char* key) {
        return equals(key, "mode") ? take(mask, 0) && exact_string(json, "replace") :
               equals(key, "file") ? take(mask, 1) && exact_string(json, "timeline.json") : false;
    }) && mask == 3;
}
inline bool read_resources(Json& json) {
    // No resource overrides until the native Stage68 visual/audio adapters
    // and asset lifetime are verified; null means inherit the original.
    std::uint32_t mask = 0;
    return json.object([&](const char* key) {
        return equals(key, "sprites") ? take(mask, 0) && json.literal("null") :
               equals(key, "music") ? take(mask, 1) && json.literal("null") :
               equals(key, "sound_effects") ? take(mask, 2) && json.literal("null") :
               equals(key, "intro") ? take(mask, 3) && json.literal("null") : false;
    }) && mask == 15;
}

inline bool manifest_matches_hoop3(const std::uint8_t* bytes, std::size_t length) {
    Json json(bytes, length);
    std::uint32_t mask = 0;
    const bool parsed = json.object([&](const char* key) {
        if (equals(key, "format"))
            return take(mask, 0) && exact_string(json, "groove.level");
        if (equals(key, "version"))
            return take(mask, 1) && exact_integer(json, 1);
        if (equals(key, "id"))
            return take(mask, 2) && exact_string(json, "groove.hoop_trundling_3");
        if (equals(key, "title")) {
            char title[385]{};
            std::size_t codepoints = 0;
            return take(mask, 3) && json.string(title, sizeof(title), &codepoints) &&
                   codepoints >= 1 && codepoints <= 96;
        }
        if (equals(key, "slot"))
            return take(mask, 4) && read_slot(json);
        if (equals(key, "base"))
            return take(mask, 5) && read_base(json);
        if (equals(key, "sequence"))
            return take(mask, 6) && read_sequence(json);
        if (equals(key, "launch"))
            return take(mask, 7) && read_launch(json);
        if (equals(key, "resources"))
            return take(mask, 8) && read_resources(json);
        if (equals(key, "progress_namespace"))
            return take(mask, 9) && exact_string(json, "groove.hoop_trundling_3");
        if (equals(key, "state"))
            return take(mask, 10) && exact_string(json, "draft");
        return false;
    });
    return parsed && mask == 0x7FFu && json.finished();
}

// Reject duplicate stable event IDs. Hash collisions also fail closed. A
// fixed table avoids a large per-event string allocation, and can be reused
// when the user returns from the stage to the menu.
struct IdSet {
    std::uint64_t hashes[kIdSlots]{};

    void clear() { std::memset(hashes, 0, sizeof(hashes)); }
    bool add(const char* id) {
        if (!stable_id(id)) return false;
        std::uint64_t hash = 14695981039346656037ull;
        for (std::size_t i = 0; id[i]; ++i) {
            hash ^= static_cast<std::uint8_t>(id[i]);
            hash *= 1099511628211ull;
        }
        if (!hash) hash = 1;
        std::size_t index = static_cast<std::size_t>(hash % kIdSlots);
        for (std::size_t attempt = 0; attempt < kIdSlots; ++attempt) {
            if (hashes[index] == hash) return false;
            if (!hashes[index]) { hashes[index] = hash; return true; }
            index = (index + 1) % kIdSlots;
        }
        return false;
    }
};

inline bool microbeat(const char* text, std::uint64_t* result) {
    if (!text || !result) return false;
    std::uint64_t whole = 0, fraction = 0;
    unsigned digits = 0, fractional_digits = 0;
    while (text[digits] >= '0' && text[digits] <= '9') {
        if (digits >= 7) return false;
        whole = whole * 10 + static_cast<unsigned>(text[digits] - '0');
        ++digits;
    }
    if (!digits) return false;
    if (text[digits] == '.') {
        ++digits;
        while (text[digits] >= '0' && text[digits] <= '9') {
            if (fractional_digits >= 6) return false;
            fraction = fraction * 10 + static_cast<unsigned>(text[digits] - '0');
            ++fractional_digits;
            ++digits;
        }
        if (!fractional_digits) return false;
    }
    if (text[digits]) return false;
    while (fractional_digits++ < 6) fraction *= 10;
    *result = whole * 1000000ull + fraction;
    return true;
}

struct Arguments {
    std::uint32_t mask = 0;
    std::int32_t value = 0;
};

inline bool read_arguments(Json& json, Arguments* args) {
    if (!args) return false;
    return json.object([&](const char* key) {
        if (equals(key, "variant"))
            return take(args->mask, 0) && exact_string(json, "normal");
        if (equals(key, "mask")) {
            std::int64_t value = 0;
            if (!take(args->mask, 1) || !json.integer(&value) ||
                value < -1 || value > 15) return false;
            args->value = static_cast<std::int32_t>(value);
            return true;
        }
        if (equals(key, "action")) {
            char action[32]{};
            if (!take(args->mask, 2) || !json.string(action, sizeof(action)))
                return false;
            args->value = equals(action, "basic") ? 0 :
                          equals(action, "change") ? 1 :
                          equals(action, "hide") ? 2 : -1;
            return args->value >= 0;
        }
        return false;
    });
}

inline bool event_matches_cache(Json& json, const std::uint8_t* cache,
                                std::size_t index, IdSet& ids,
                                std::uint64_t* previous_beat,
                                std::size_t* rings) {
    char id[81]{}, beat_text[16]{}, command[40]{};
    Arguments args{};
    std::uint32_t mask = 0;
    const bool parsed = json.object([&](const char* key) {
        if (equals(key, "id"))
            return take(mask, 0) && json.string(id, sizeof(id));
        if (equals(key, "beat"))
            return take(mask, 1) && json.string(beat_text, sizeof(beat_text));
        if (equals(key, "command"))
            return take(mask, 2) && json.string(command, sizeof(command));
        if (equals(key, "args"))
            return take(mask, 3) && read_arguments(json, &args);
        return false;
    });
    if (!parsed || mask != 15 || !ids.add(id)) return false;

    std::uint64_t beat = 0;
    if (!previous_beat || !rings || !microbeat(beat_text, &beat) ||
        beat > INT64_MAX || (index != 0 && beat < *previous_beat)) return false;
    std::uint32_t native_tick = 0;
    if (!groove_hoop_native::to_native_ticks(static_cast<std::int64_t>(beat),
                                             &native_tick)) return false;
    (void)native_tick;
    std::uint32_t opcode = 0;
    std::int32_t argument = 0;
    if (equals(command, "hoop.ring_spawn") && args.mask == 1)
        opcode = 1;
    else if (equals(command, "hoop.bubble_state") && args.mask == 2) {
        opcode = 2;
        argument = args.value;
    } else if (equals(command, "hoop.stage68_mask") && args.mask == 0)
        opcode = 3;
    else if (equals(command, "hoop.scene_action") && args.mask == 4) {
        opcode = 4;
        argument = args.value;
    } else return false;

    const std::uint8_t* actual = cache + 8 + index * 16;
    const bool equal = groove_runtime::read_le64(actual) == beat &&
                       groove_runtime::read_le32(actual + 8) == opcode &&
                       static_cast<std::int32_t>(groove_runtime::read_le32(actual + 12)) == argument;
    if (equal) {
        *previous_beat = beat;
        if (opcode == 1) ++*rings;
    }
    return equal;
}

inline bool timeline_matches_cache(const std::uint8_t* json_data,
                                   std::size_t json_length,
                                   const std::uint8_t* binary,
                                   std::size_t binary_length,
                                   IdSet& ids, std::size_t* event_count) {
    if (event_count) *event_count = 0;
    if (!json_data || !binary || !event_count || binary_length < 24 ||
        std::memcmp(binary, "GRT1", 4) != 0) return false;
    const std::size_t count = groove_runtime::read_le32(binary + 4);
    if (count == 0 || count > groove_runtime::kMaxEvents ||
        binary_length != 8 + count * 16) return false;

    ids.clear();
    Json json(json_data, json_length);
    std::uint32_t mask = 0;
    std::size_t parsed_count = 0;
    std::size_t ring_count = 0;
    std::uint64_t previous_beat = 0;
    const bool parsed = json.object([&](const char* key) {
        if (equals(key, "version"))
            return take(mask, 0) && exact_integer(json, 1);
        if (equals(key, "timebase"))
            return take(mask, 1) && exact_string(json, "beats");
        if (equals(key, "events"))
            return take(mask, 2) && json.array([&](std::size_t index) {
                return index < count && event_matches_cache(
                    json, binary, index, ids, &previous_beat, &ring_count);
            }, &parsed_count);
        return false;
    });
    if (!parsed || mask != 7 || parsed_count != count || ring_count == 0 ||
        !json.finished())
        return false;
    *event_count = count;
    return true;
}

inline bool preflight(const std::uint8_t* manifest, std::size_t manifest_size,
                      const std::uint8_t* timeline, std::size_t timeline_size,
                      const std::uint8_t* cache, std::size_t cache_size,
                      IdSet& ids, std::size_t* event_count) {
    if (!event_count) return false;
    *event_count = 0;
    return manifest_matches_hoop3(manifest, manifest_size) &&
           timeline_matches_cache(timeline, timeline_size, cache, cache_size,
                                  ids, event_count);
}

} // namespace groove_hoop3_json
