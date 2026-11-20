#include "groove_hoop3_readonly_probe.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <cstring>

using namespace groove_hoop3_probe;

struct FakeGameFile {
    bool game_mount_ready = false;
    bool file_missing = false;
    bool bad_magic = false;
    bool short_read = false;
    bool oversize = false;
    std::uint32_t read_error = 0;
    unsigned opens = 0, reads = 0, closes = 0;
    std::array<std::uint8_t, 8> bytes{0x50, 0x4B, 0x03, 0x04, 7, 8, 9, 10};
};

static bool ready(void* context, const char* name) {
    auto& fs = *static_cast<FakeGameFile*>(context);
    assert(std::strcmp(name, groove_hoop3_file::kGameMountName) == 0);
    return fs.game_mount_ready;
}

static std::uint32_t open_file(void* context, const char* path,
                               std::uintptr_t* handle) {
    auto& fs = *static_cast<FakeGameFile*>(context);
    assert(fs.game_mount_ready);
    assert(std::strcmp(path, groove_hoop3_file::kGameReadPath) == 0);
    ++fs.opens;
    if (fs.file_missing) return 0x404;
    *handle = reinterpret_cast<std::uintptr_t>(context);
    return 0;
}

static std::uint32_t size(void* context, std::uintptr_t handle,
                          std::int64_t* length) {
    auto& fs = *static_cast<FakeGameFile*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    *length = fs.oversize ? static_cast<std::int64_t>(
        groove_hoop3_file::kMaxInitialPackBytes + 1) : fs.bytes.size();
    return 0;
}

static std::uint32_t read(void* context, std::uintptr_t handle,
                          std::uint64_t offset, void* destination,
                          std::size_t requested, std::size_t* received) {
    auto& fs = *static_cast<FakeGameFile*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    assert(offset + requested <= fs.bytes.size());
    ++fs.reads;
    if (fs.read_error) return fs.read_error;
    const auto length = requested - (fs.short_read ? 1 : 0);
    std::memcpy(destination, fs.bytes.data() + offset, length);
    if (fs.bad_magic) static_cast<std::uint8_t*>(destination)[0] = 0;
    *received = length;
    return 0;
}

static void close_file(void* context, std::uintptr_t handle) {
    auto& fs = *static_cast<FakeGameFile*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    ++fs.closes;
}

static groove_hoop3_file::NativeFileApi api(FakeGameFile& fs) {
    return {nullptr, open_file, size, read, close_file, nullptr, &fs, ready};
}

int main() {
    FakeGameFile fs;
    auto report = inspect_header(api(fs));
    assert(report.verdict == Verdict::mount_not_ready);
    assert(fs.opens == 0 && fs.reads == 0 && fs.closes == 0);

    fs.game_mount_ready = true;
    report = inspect_header(api(fs));
    assert(report.verdict == Verdict::zip_header_seen);
    assert(report.package_bytes == 8 && report.native_result == 0);
    assert(fs.opens == 1 && fs.reads == 1 && fs.closes == 1);

    fs.bad_magic = true;
    report = inspect_header(api(fs));
    assert(report.verdict == Verdict::not_zip && fs.closes == 2);
    fs.bad_magic = false;

    fs.short_read = true;
    report = inspect_header(api(fs));
    assert(report.verdict == Verdict::read_failed);
    assert(report.file_status == groove_hoop3_file::Status::read_failed);
    assert(fs.closes == 3);
    fs.short_read = false;

    fs.read_error = 0x9988;
    report = inspect_header(api(fs));
    assert(report.verdict == Verdict::read_failed);
    assert(report.native_result == 0x9988 && fs.closes == 4);
    fs.read_error = 0;

    fs.oversize = true;
    const auto read_count = fs.reads;
    report = inspect_header(api(fs));
    assert(report.verdict == Verdict::open_or_size_failed);
    assert(report.file_status == groove_hoop3_file::Status::wrong_size);
    assert(fs.reads == read_count && fs.closes == 5);
    fs.oversize = false;

    fs.file_missing = true;
    report = inspect_header(api(fs));
    assert(report.verdict == Verdict::open_or_size_failed);
    assert(report.file_status == groove_hoop3_file::Status::open_failed);
    assert(report.native_result == 0x404);
    assert(fs.closes == 5);
}
