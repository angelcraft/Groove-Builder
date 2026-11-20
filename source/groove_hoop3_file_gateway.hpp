#pragma once

// Read-only candidate RomFS file -> ZIP -> Hoop3 preflight -> SessionOwner.
// This is portable host-tested code: an audited NNSDK nn::fs adapter,
// appropriate native filesystem initialization, decompression backend, and
// serialized game-menu lifecycle are STILL REQUIRED on actual hardware.

#include <cstdint>

#include "groove_hoop3_archive_loader.hpp"
#include "groove_hoop3_package_file.hpp"

namespace groove_hoop3_file {

struct GatewayReport {
    Status file_status;
    groove_hoop3::ArchiveLoadReport archive;
    std::uint32_t last_native_result;
};

class Gateway {
public:
    // Caller must instantiate Gateway and SessionOwner in static/BSS storage,
    // and serialize reload with menu launch, worker entry, and scene teardown.
    // Never call from the original game worker or a frame/tick callback.
    GatewayReport reload(groove_hoop3::SessionOwner& owner,
                         NativeFileApi fs,
                         groove_zip::InflateRaw inflater,
                         void* inflate_context,
                         MountPolicy policy = MountPolicy::borrow_game_romfs) {
        if (owner.phase() != groove_hoop3::Phase::empty &&
            owner.phase() != groove_hoop3::Phase::ready)
            return {Status::closed,
                    {groove_hoop3::ArchiveLoadStatus::session_busy, 0}, 0};

        FileLease file;
        const auto open_status = file.open(fs, policy);
        if (open_status != Status::ready) {
            const auto native_result = file.last_native_result();
            // A stale successful pack MUST NOT unlock the slot when the
            // new file is absent, oversized or inaccessible.
            const auto result = loader_.load(owner, {}, nullptr, nullptr);
            return {open_status, result, native_result};
        }

        const auto result = loader_.load(owner, file.reader(),
                                          inflater, inflate_context);
        // ArchiveLoader COPIES the checked events into SessionOwner. Its
        // worker never borrows a FileLease or an intermediate ZIP buffer.
        return {file.status(), result, file.last_native_result()};
    }

private:
    groove_hoop3::ArchiveLoader loader_{};
};

} // namespace groove_hoop3_file
