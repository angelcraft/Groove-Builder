#pragma once

// Whole-package, allocation-free initial Hoop3 load gate. The caller must
// instantiate ArchiveLoader and SessionOwner in static/BSS memory and invoke
// this BEFORE the original native game worker can run. The caller owns an
// already-open, stable file handle and provides read_at + raw-DEFLATE.
//
// No Switch FS mount, native menu call or ARM64 hook is implemented here.
// Loading is intentionally synchronous, never from a gameplay/tick callback.
// All decoded events are COPIED into SessionOwner before Reader may close.

#include <array>
#include <cstddef>
#include <cstdint>

#include "groove_hoop3_json_preflight.hpp"
#include "groove_hoop3_session_owner.hpp"
#include "groove_zip_archive.hpp"

namespace groove_hoop3 {

enum class ArchiveLoadStatus : std::uint8_t {
    loaded,
    session_busy,
    zip_invalid,
    wrong_members,
    metadata_invalid,
    json_cache_mismatch,
    session_rejected,
};

struct ArchiveLoadReport {
    ArchiveLoadStatus status;
    std::size_t events;
};

class ArchiveLoader {
public:
    ArchiveLoadReport load(SessionOwner& owner, groove_zip::Reader file,
                           groove_zip::InflateRaw inflater,
                           void* inflate_context) {
        // Reopening an invalid or missing archive must LOCK an old ready
        // cell. But never mutate an active/quarantined native stage.
        if (!owner.unload()) return {ArchiveLoadStatus::session_busy, 0};
        background_size_ = 0;
        if (!index_.scan(file)) return {ArchiveLoadStatus::zip_invalid, 0};
        // Three metadata members, plus the optional Hoop 3 background PNG.
        // Music, effects, intro and any other sprite stay inherited. This
        // does not replace graph/scene/ring/type_01/bg.spr.
        if (index_.size() != 3 && index_.size() != 4)
            return {ArchiveLoadStatus::wrong_members, 0};

        std::size_t lengths[3]{};
        const char* names[3] = {"manifest.json", "timeline.json", "timeline.bin"};
        std::uint8_t* outputs[3] = {
            manifest_.data(), timeline_.data(), cache_.data()};
        const std::size_t capacities[3] = {
            manifest_.size(), timeline_.size(), cache_.size()};
        for (std::size_t i = 0; i < 3; ++i) {
            const auto* entry = index_.find(names[i]);
            if (!entry || entry->uncompressed_size > capacities[i] ||
                !index_.extract(*entry, outputs[i], capacities[i],
                                compressed_.data(), compressed_.size(),
                                inflater, inflate_context))
                return {ArchiveLoadStatus::metadata_invalid, 0};
            lengths[i] = entry->uncompressed_size;
        }

        std::size_t events = 0;
        bool own_background = false;
        if (!groove_hoop3_json::preflight(
                manifest_.data(), lengths[0], timeline_.data(), lengths[1],
                cache_.data(), lengths[2], ids_, &events, &own_background))
            return {ArchiveLoadStatus::json_cache_mismatch, 0};

        const auto* background = index_.find(groove_hoop3_json::kHoop3BackgroundPath);
        std::size_t carried = 0;
        if (own_background) {
            if (index_.size() != 4 || !background ||
                background->uncompressed_size < 8 ||
                background->uncompressed_size > background_.size() ||
                !index_.extract(*background, background_.data(), background_.size(),
                                compressed_.data(), compressed_.size(),
                                inflater, inflate_context) ||
                !png_signature(background_.data(), background->uncompressed_size))
                return {ArchiveLoadStatus::metadata_invalid, 0};
            carried = background->uncompressed_size;
        } else if (index_.size() != 3 || background) {
            return {ArchiveLoadStatus::wrong_members, 0};
        }

        if (!owner.load_prevalidated_timeline(cache_.data(), lengths[2]) ||
            !owner.hoop3_slot_unlocked() || owner.ring_count() == 0)
            return {ArchiveLoadStatus::session_rejected, 0};

        // The PNG bytes are copied here. No Switch texture bind is performed,
        // and ring/type_01/bg.spr is never opened.
        background_size_ = carried;
        return {ArchiveLoadStatus::loaded, events};
    }

    // Bytes of sprites/background.png after a successful load, or 0 when the
    // pack still inherits the original background. Not a Switch binding.
    std::size_t background_size() const { return background_size_; }
    const std::uint8_t* background_bytes() const { return background_.data(); }

private:
    static bool png_signature(const std::uint8_t* bytes, std::size_t size) {
        static constexpr std::uint8_t kPng[8] = {
            0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
        if (!bytes || size < sizeof(kPng)) return false;
        for (std::size_t i = 0; i < sizeof(kPng); ++i)
            if (bytes[i] != kPng[i]) return false;
        return true;
    }

    groove_zip::Index index_{};
    std::array<std::uint8_t, 8192> manifest_{};
    std::array<std::uint8_t, groove_hoop3_json::kMaxJsonBytes> timeline_{};
    std::array<std::uint8_t, 8 + groove_runtime::kMaxEvents * 16> cache_{};
    std::array<std::uint8_t, groove_hoop3_json::kMaxJsonBytes> compressed_{};
    std::array<std::uint8_t, 4096> background_{};
    std::size_t background_size_ = 0;
    groove_hoop3_json::IdSet ids_{};
};

} // namespace groove_hoop3
