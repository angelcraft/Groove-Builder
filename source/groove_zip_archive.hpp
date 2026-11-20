#pragma once

// Portable, allocation-free ZIP32 container reader for .groove metadata.
// NOT a Switch SD filesystem adapter and NOT a manifest/JSON validator.
// Caller must allocate Index in static/heap storage (it is ~120 KiB), bind
// a trusted read_at callback, and use a separately trusted raw-DEFLATE
// implementation BEFORE passing verified metadata to SessionOwner.
//
// For v1 we deliberately reject ZIP64, file comments, ZIP comments,
// data descriptors, encrypted entries, directories, symlinks and non-ASCII
// filenames. The deterministic Python groove_pack builder emits none of them.

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace groove_zip {

constexpr std::size_t kMaxMembers = 512;
constexpr std::size_t kMaxNameBytes = 200;
constexpr std::uint32_t kMaxMemberBytes = 64u * 1024u * 1024u;
constexpr std::uint64_t kMaxTotalBytes = 256ull * 1024ull * 1024ull;

struct Reader {
    bool (*read_at)(void* context, std::uint64_t offset, void* dst,
                    std::size_t bytes) = nullptr;
    void* context = nullptr;
    std::uint64_t size = 0;
};

// Implementations must consume ALL compressed input, produce EXACTLY the
// expected output size, and reject malformed or trailing compressed streams.
using InflateRaw = bool (*)(void* context, const std::uint8_t* compressed,
                            std::size_t compressed_size,
                            std::uint8_t* output, std::size_t expected_size);

struct Entry {
    char name[kMaxNameBytes + 1]{};
    std::uint32_t name_size = 0;
    std::uint32_t compressed_size = 0;
    std::uint32_t uncompressed_size = 0;
    std::uint32_t crc32 = 0;
    std::uint32_t local_header_offset = 0;
    std::uint32_t data_offset = 0;
    std::uint32_t end_offset = 0;
    std::uint16_t method = 0;
};

inline std::uint16_t le16(const std::uint8_t* ptr) {
    return std::uint16_t(ptr[0]) | (std::uint16_t(ptr[1]) << 8);
}
inline std::uint32_t le32(const std::uint8_t* ptr) {
    return std::uint32_t(le16(ptr)) | (std::uint32_t(le16(ptr + 2)) << 16);
}

inline std::uint32_t crc32(const std::uint8_t* bytes, std::size_t length) {
    std::uint32_t sum = ~std::uint32_t(0);
    for (std::size_t i = 0; i < length; ++i) {
        sum ^= bytes[i];
        for (unsigned bit = 0; bit < 8; ++bit)
            sum = (sum >> 1) ^ ((sum & 1u) ? 0xEDB88320u : 0u);
    }
    return ~sum;
}

inline bool safe_name(const char* name, std::size_t length) {
    if (!name || length == 0 || length > kMaxNameBytes ||
        name[0] == '/' || name[length - 1] == '/') return false;
    for (std::size_t i = 0; i < length; ++i) {
        const unsigned char ch = static_cast<unsigned char>(name[i]);
        if (ch < 33 || ch > 126 || ch == '\\' || ch == ':') return false;
    }
    const char* component = name;
    for (std::size_t i = 0; i <= length; ++i) {
        if (i != length && name[i] != '/') continue;
        const std::size_t n = static_cast<std::size_t>(name + i - component);
        if (n == 0 || (n == 1 && component[0] == '.') ||
            (n == 2 && component[0] == '.' && component[1] == '.')) return false;
        component = name + i + 1;
    }
    return true;
}

inline bool read_exact(const Reader& source, std::uint64_t offset,
                       void* destination, std::size_t length) {
    return source.read_at && destination && offset <= source.size &&
           length <= source.size - offset &&
           source.read_at(source.context, offset, destination, length);
}

class Index {
public:
    bool scan(const Reader& source) {
        count_ = 0;
        reader_ = {};
        if (source.size < 22 || source.size > 0xFFFFFFFFull || !source.read_at)
            return false;
        std::uint8_t eocd[22]{};
        if (!read_exact(source, source.size - sizeof(eocd), eocd, sizeof(eocd)) ||
            le32(eocd) != 0x06054B50u || le16(eocd + 4) != 0 ||
            le16(eocd + 6) != 0 || le16(eocd + 20) != 0 ||
            le16(eocd + 8) != le16(eocd + 10)) return false;
        const std::size_t members = le16(eocd + 10);
        if (members == 0 || members > kMaxMembers) return false;
        const std::uint64_t central_offset = le32(eocd + 16);
        const std::uint64_t central_size = le32(eocd + 12);
        if (central_offset + central_size != source.size - sizeof(eocd))
            return false;

        std::uint64_t offset = central_offset;
        std::uint64_t total_expanded = 0;
        for (std::size_t i = 0; i < members; ++i) {
            std::uint8_t central[46]{};
            if (offset > central_offset + central_size ||
                sizeof(central) > central_offset + central_size - offset ||
                !read_exact(source, offset, central, sizeof(central)) ||
                le32(central) != 0x02014B50u) return false;
            const std::uint16_t flags = le16(central + 8);
            const std::uint16_t method = le16(central + 10);
            const std::uint32_t compressed = le32(central + 20);
            const std::uint32_t expanded = le32(central + 24);
            const std::size_t name_length = le16(central + 28);
            const std::size_t extras = le16(central + 30);
            const std::size_t comment = le16(central + 32);
            const std::uint32_t local_offset = le32(central + 42);
            const std::uint32_t unix_mode = le32(central + 38) >> 16;
            if ((flags & ~0x0800u) != 0 || (method != 0 && method != 8) ||
                (method == 0 && compressed != expanded) ||
                compressed > kMaxMemberBytes || expanded > kMaxMemberBytes ||
                name_length == 0 || name_length > kMaxNameBytes ||
                extras || comment || le16(central + 34) != 0 ||
                (unix_mode & 0170000u) == 0120000u ||
                (unix_mode & 0170000u) == 0040000u ||
                offset + sizeof(central) + name_length >
                    central_offset + central_size) return false;

            Entry& entry = entries_[i];
            if (!read_exact(source, offset + sizeof(central), entry.name,
                            name_length)) return false;
            entry.name[name_length] = '\0';
            if (!safe_name(entry.name, name_length)) return false;
            for (std::size_t prior = 0; prior < i; ++prior)
                if (std::strcmp(entries_[prior].name, entry.name) == 0)
                    return false;

            std::uint8_t local[30]{};
            if (!read_exact(source, local_offset, local, sizeof(local)) ||
                le32(local) != 0x04034B50u || le16(local + 6) != flags ||
                le16(local + 8) != method || le32(local + 14) != le32(central + 16) ||
                le32(local + 18) != compressed || le32(local + 22) != expanded ||
                le16(local + 26) != name_length || le16(local + 28) != 0)
                return false;
            char local_name[kMaxNameBytes]{};
            if (!read_exact(source, std::uint64_t(local_offset) + sizeof(local),
                            local_name, name_length) ||
                std::memcmp(local_name, entry.name, name_length) != 0) return false;
            const std::uint64_t start = std::uint64_t(local_offset) +
                                        sizeof(local) + name_length;
            const std::uint64_t end = start + compressed;
            if (end > central_offset || start > 0xFFFFFFFFull ||
                end > 0xFFFFFFFFull) return false;
            // Reject overlapping local member spans, including duplicated
            // shared compressed data with different central directory names.
            for (std::size_t prior = 0; prior < i; ++prior)
                if (std::uint64_t(local_offset) < entries_[prior].end_offset &&
                    entries_[prior].local_header_offset < end) return false;
            total_expanded += expanded;
            if (total_expanded > kMaxTotalBytes) return false;
            entry.name_size = static_cast<std::uint32_t>(name_length);
            entry.compressed_size = compressed;
            entry.uncompressed_size = expanded;
            entry.crc32 = le32(central + 16);
            entry.local_header_offset = local_offset;
            entry.data_offset = static_cast<std::uint32_t>(start);
            entry.end_offset = static_cast<std::uint32_t>(end);
            entry.method = method;
            offset += sizeof(central) + name_length;
        }
        if (offset != central_offset + central_size) return false;
        reader_ = source;
        count_ = members;
        return true;
    }

    const Entry* find(const char* name) const {
        if (!name) return nullptr;
        for (std::size_t i = 0; i < count_; ++i)
            if (std::strcmp(entries_[i].name, name) == 0)
                return &entries_[i];
        return nullptr;
    }

    // The archive does NOT own destination or compressed scratch. No output
    // may be used if extraction returns false. Caller must validate JSON
    // semantics AND binary cache consistency separately before enabling slot.
    bool extract(const Entry& entry, std::uint8_t* destination,
                 std::size_t destination_capacity,
                 std::uint8_t* compressed_scratch,
                 std::size_t scratch_capacity, InflateRaw inflate,
                 void* inflate_context) const {
        bool belongs_to_index = false;
        for (std::size_t i = 0; i < count_; ++i)
            if (&entries_[i] == &entry) belongs_to_index = true;
        if (!belongs_to_index || !destination ||
            entry.uncompressed_size > destination_capacity) return false;
        bool success = false;
        if (entry.method == 0) {
            success = read_exact(reader_, entry.data_offset, destination,
                                 entry.uncompressed_size);
        } else if (entry.method == 8 && compressed_scratch && inflate &&
                   entry.compressed_size <= scratch_capacity &&
                   // Use integer address ranges, avoiding relational pointer
                   // comparisons between unrelated output/scratch arrays.
                   reinterpret_cast<std::uintptr_t>(destination) <=
                       UINTPTR_MAX - destination_capacity &&
                   reinterpret_cast<std::uintptr_t>(compressed_scratch) <=
                       UINTPTR_MAX - scratch_capacity &&
                   (reinterpret_cast<std::uintptr_t>(destination) +
                        destination_capacity <=
                        reinterpret_cast<std::uintptr_t>(compressed_scratch) ||
                    reinterpret_cast<std::uintptr_t>(compressed_scratch) +
                        scratch_capacity <=
                        reinterpret_cast<std::uintptr_t>(destination))) {
            success = read_exact(reader_, entry.data_offset, compressed_scratch,
                                 entry.compressed_size) &&
                      inflate(inflate_context, compressed_scratch,
                              entry.compressed_size, destination,
                              entry.uncompressed_size);
        }
        return success && crc32(destination, entry.uncompressed_size) == entry.crc32;
    }

    std::size_t size() const { return count_; }

private:
    Reader reader_{};
    std::size_t count_ = 0;
    Entry entries_[kMaxMembers]{};
};

} // namespace groove_zip
