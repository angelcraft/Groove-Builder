// HOST-ONLY end-to-end test: fake nn::fs -> typed read-only borrowed adapter
// -> Gateway ZIP / JSON / GRT1 preflight -> owned native event timeline.
// Uses ONLY the user's own input .groove; never writes or changes it.
// Fake nn::fs headers are in tests/fake_nnsdk. This is not a Switch build.

#include "groove_hoop3_file_gateway.hpp"
#include "groove_hoop3_nnfs_borrowed.hpp"
#include "groove_hoop3_readonly_probe.hpp"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>

#include <zlib.h>

struct HostGameFs {
    const char* source_path = nullptr;
    bool original_data_mount_ready = false;
    std::ifstream file;
    unsigned opens = 0, closes = 0;
};

static HostGameFs host_fs;
static constexpr std::uint64_t kHandle = 0x7100000051234000ULL;

namespace nn::fs {

Result OpenFile(FileHandle* out, const char* native_path, int open_mode) {
    if (!host_fs.original_data_mount_ready || !out || !native_path ||
        std::strcmp(native_path, groove_hoop3_file::kGameReadPath) != 0 ||
        open_mode != OpenMode_Read || host_fs.file.is_open()) return {0xBAD};
    host_fs.file.open(host_fs.source_path, std::ios::binary | std::ios::ate);
    if (!host_fs.file) return {0x404};
    out->_internal = kHandle;
    ++host_fs.opens;
    return {0};
}

Result GetFileSize(std::int64_t* size, FileHandle handle) {
    if (!size || handle._internal != kHandle || !host_fs.file.is_open())
        return {0xBAD};
    const auto end = host_fs.file.tellg();
    if (end < 0) return {0xBAD};
    *size = static_cast<std::int64_t>(end);
    return {0};
}

Result ReadFile(std::size_t* received, FileHandle handle, std::int64_t offset,
                void* dst, std::size_t requested) {
    if (!received || !dst || handle._internal != kHandle ||
        !host_fs.file.is_open() || offset < 0 ||
        requested > static_cast<std::size_t>(
            std::numeric_limits<std::streamsize>::max())) return {0xBAD};
    host_fs.file.clear();
    host_fs.file.seekg(static_cast<std::streamoff>(offset), std::ios::beg);
    if (!host_fs.file) return {0xBAD};
    host_fs.file.read(static_cast<char*>(dst), static_cast<std::streamsize>(requested));
    *received = static_cast<std::size_t>(host_fs.file.gcount());
    return host_fs.file.bad() ? Result{0xBAD} : Result{0};
}

void CloseFile(FileHandle handle) {
    if (handle._internal == kHandle && host_fs.file.is_open()) {
        host_fs.file.close();
        ++host_fs.closes;
    }
}

} // namespace nn::fs

static bool existing_game_romfs(void* context) {
    return static_cast<HostGameFs*>(context)->original_data_mount_ready;
}

static bool inflate_raw(void*, const std::uint8_t* compressed,
                        std::size_t compressed_size, std::uint8_t* output,
                        std::size_t expected_size) {
    if (compressed_size > std::numeric_limits<uInt>::max() ||
        expected_size > std::numeric_limits<uInt>::max()) return false;
    z_stream z{};
    z.next_in = const_cast<Bytef*>(compressed);
    z.avail_in = static_cast<uInt>(compressed_size);
    z.next_out = output;
    z.avail_out = static_cast<uInt>(expected_size);
    if (::inflateInit2(&z, -MAX_WBITS) != Z_OK) return false;
    const auto result = ::inflate(&z, Z_FINISH);
    const bool ok = result == Z_STREAM_END &&
                    z.total_in == compressed_size &&
                    z.total_out == expected_size;
    ::inflateEnd(&z);
    return ok;
}

int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "Usage: verify_hoop3_nnfs_borrowed FILE.groove\n";
        return 2;
    }
    host_fs.source_path = argv[1];
    static groove_hoop3::SessionOwner owner;
    static groove_hoop3_file::Gateway gateway;
    groove_hoop3_nnfs::BorrowedRomFs native{existing_game_romfs, &host_fs};

    const auto early = gateway.reload(owner, native.api(), inflate_raw, nullptr);
    if (early.file_status != groove_hoop3_file::Status::game_mount_unavailable ||
        owner.hoop3_slot_unlocked() || host_fs.opens != 0) {
        std::cerr << "Unsafe early read before simulated game RomFS init\n";
        return 1;
    }

    host_fs.original_data_mount_ready = true; // HOST FAKE ONLY. No Switch hook.
    const auto probe = groove_hoop3_probe::inspect_header(native.api());
    if (probe.verdict != groove_hoop3_probe::Verdict::zip_header_seen ||
        host_fs.opens != 1 || host_fs.closes != 1 || host_fs.file.is_open()) {
        std::cerr << "Hoop3 fake nn::fs ingress rejected (header probe "
                  << static_cast<unsigned>(probe.verdict) << ")\n";
        return 1;
    }
    const auto report = gateway.reload(owner, native.api(), inflate_raw, nullptr);
    if (report.file_status != groove_hoop3_file::Status::ready ||
        report.archive.status != groove_hoop3::ArchiveLoadStatus::loaded ||
        !owner.hoop3_slot_unlocked() || host_fs.opens != 2 ||
        host_fs.closes != 2 || host_fs.file.is_open()) {
        std::cerr << "Hoop3 fake nn::fs ingress rejected (file "
                  << static_cast<unsigned>(report.file_status) << ", archive "
                  << static_cast<unsigned>(report.archive.status) << ")\n";
        return 1;
    }

    std::cout << "Simulated data:/ ZIP header probe -> typed nn::fs -> ZIP/JSON/GRT1 -> "
              << report.archive.events << " owned events PASSED. Host only: "
              << "no Switch fs mount, subsdk, ARM64 hook or unlocked menu.\n";
}
