#pragma once

// Tiny first-hardware-test probe: verifies the original game-owned data:
// mount can expose a .groove ZIP file without touching any stage, menu, save,
// hook, callback pointer, native worker, or game-owned mount lifetime.
// This is a callable SOURCE-ONLY function, not yet bound to actual hardware.

#include <cstddef>
#include <cstdint>

#include "groove_hoop3_package_file.hpp"

namespace groove_hoop3_probe {

enum class Verdict : std::uint8_t {
    mount_not_ready,
    open_or_size_failed,
    read_failed,
    not_zip,
    zip_header_seen,
};

struct Report {
    Verdict verdict;
    groove_hoop3_file::Status file_status;
    std::uint64_t package_bytes;
    std::uint32_t native_result;
};

inline Report inspect_header(groove_hoop3_file::NativeFileApi native) {
    groove_hoop3_file::FileLease lease;
    const auto status = lease.open(native); // Always borrows original data:.
    if (status != groove_hoop3_file::Status::ready) {
        const auto verdict = status == groove_hoop3_file::Status::game_mount_unavailable ?
            Verdict::mount_not_ready : Verdict::open_or_size_failed;
        return {verdict, status, 0, lease.last_native_result()};
    }

    const auto source = lease.reader();
    std::uint8_t magic[4]{};
    if (!groove_zip::read_exact(source, 0, magic, sizeof(magic)))
        return {Verdict::read_failed, lease.status(), source.size,
                lease.last_native_result()};

    const bool local_zip_header = magic[0] == 0x50 && magic[1] == 0x4B &&
                                  magic[2] == 0x03 && magic[3] == 0x04;
    return {local_zip_header ? Verdict::zip_header_seen : Verdict::not_zip,
            lease.status(), source.size, lease.last_native_result()};
    // FileLease destructor CLOSES the file. It NEVER unmounts game data:.
}

} // namespace groove_hoop3_probe
