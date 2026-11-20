#include "groove_hoop3_romfs_bridge.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <cstring>

using namespace groove_hoop3_romfs;

struct FakeNnFs {
    std::array<std::uint8_t, 8> file{1, 2, 3, 4, 5, 6, 7, 8};
    unsigned queries = 0, mounts = 0, opens = 0, reads = 0;
    unsigned closes = 0, unmounts = 0;
    std::size_t required_cache = 32;
    std::uint32_t query_error = 0;
    std::uint32_t mount_error = 0;
    std::uint32_t open_error = 0;
    void* expected_cache = nullptr;
    bool filesystem_ready = true;
    bool mounted = false;
};

static bool fs_ready(void* context) {
    return static_cast<FakeNnFs*>(context)->filesystem_ready;
}

static std::uint32_t query_cache(void* context, std::size_t* bytes) {
    auto& fs = *static_cast<FakeNnFs*>(context);
    ++fs.queries;
    if (fs.query_error) return fs.query_error;
    *bytes = fs.required_cache;
    return 0;
}

static std::uint32_t mount_cached(void* context, const char* name,
                                  void* cache, std::size_t bytes) {
    auto& fs = *static_cast<FakeNnFs*>(context);
    assert(std::strcmp(name, groove_hoop3_file::kMountName) == 0);
    assert(cache == fs.expected_cache && bytes == fs.required_cache);
    assert(!fs.mounted);
    ++fs.mounts;
    if (fs.mount_error) return fs.mount_error;
    fs.mounted = true;
    return 0;
}

static void unmount_cached(void* context, const char* name) {
    auto& fs = *static_cast<FakeNnFs*>(context);
    assert(std::strcmp(name, groove_hoop3_file::kMountName) == 0);
    assert(fs.mounted);
    ++fs.unmounts;
    fs.mounted = false;
}

static std::uint32_t open_file(void* context, const char* path,
                               std::uintptr_t* handle) {
    auto& fs = *static_cast<FakeNnFs*>(context);
    assert(fs.mounted);
    assert(std::strcmp(path, groove_hoop3_file::kNativeReadPath) == 0);
    ++fs.opens;
    if (fs.open_error) return fs.open_error;
    *handle = reinterpret_cast<std::uintptr_t>(context);
    return 0;
}

static std::uint32_t get_size(void* context, std::uintptr_t handle,
                              std::int64_t* output) {
    auto& fs = *static_cast<FakeNnFs*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    *output = fs.file.size();
    return 0;
}

static std::uint32_t read_file(void* context, std::uintptr_t handle,
                               std::uint64_t offset, void* output,
                               std::size_t count, std::size_t* received) {
    auto& fs = *static_cast<FakeNnFs*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    assert(offset <= fs.file.size() && count <= fs.file.size() - offset);
    ++fs.reads;
    std::memcpy(output, fs.file.data() + offset, count);
    *received = count;
    return 0;
}

static void close_file(void* context, std::uintptr_t handle) {
    auto& fs = *static_cast<FakeNnFs*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    assert(fs.mounted);
    ++fs.closes;
}

static MountCalls mount_calls(FakeNnFs& fs) {
    return {fs_ready, query_cache, mount_cached, unmount_cached, &fs};
}

static groove_hoop3_file::NativeFileApi io_calls(FakeNnFs& fs) {
    return {nullptr, open_file, get_size, read_file, close_file,
            nullptr, &fs, nullptr};
}

int main() {
    FakeNnFs fs;
    alignas(16) std::array<std::uint8_t, 64> cache{};
    fs.expected_cache = cache.data();
    ReadOnlyBridge bridge;
    assert(bridge.configure(mount_calls(fs), io_calls(fs), cache.data(), cache.size()));

    groove_hoop3_file::FileLease first;
    fs.filesystem_ready = false;
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(bridge.phase() == MountPhase::filesystem_not_ready);
    assert(fs.queries == 0 && fs.mounts == 0 && fs.opens == 0);
    fs.filesystem_ready = true;
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::ready);
    assert(bridge.phase() == MountPhase::mounted && bridge.is_mounted());
    assert(bridge.last_requested_cache_bytes() == 32);
    assert(fs.queries == 1 && fs.mounts == 1 && fs.opens == 1);
    std::uint8_t bytes[3]{};
    assert(groove_zip::read_exact(first.reader(), 3, bytes, sizeof(bytes)));
    assert(bytes[0] == 4 && bytes[1] == 5 && bytes[2] == 6);
    assert(fs.reads == 1);

    // No reconfiguration or second mount while a lease owns the RomFS cache.
    assert(!bridge.configure(mount_calls(fs), io_calls(fs), cache.data(), cache.size()));
    groove_hoop3_file::FileLease second;
    assert(second.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(second.last_native_result() == kLocalPreconditionFailure);
    assert(bridge.is_mounted() && bridge.phase() == MountPhase::mounted);
    assert(fs.queries == 1 && fs.mounts == 1 && fs.unmounts == 0);
    first.close();
    assert(fs.closes == 1 && fs.unmounts == 1 && !fs.mounted);
    assert(!bridge.is_mounted() && bridge.phase() == MountPhase::idle);

    fs.query_error = 0x4321;
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(first.last_native_result() == 0x4321);
    assert(bridge.phase() == MountPhase::query_failed && fs.mounts == 1);
    fs.query_error = 0;

    fs.required_cache = 128;
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(first.last_native_result() == kLocalPreconditionFailure);
    assert(bridge.phase() == MountPhase::cache_rejected);
    assert(bridge.last_requested_cache_bytes() == 128 && fs.mounts == 1);

    fs.required_cache = 0;
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(bridge.phase() == MountPhase::cache_rejected && fs.mounts == 1);
    fs.required_cache = 32;

    fs.mount_error = 0x7654;
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(first.last_native_result() == 0x7654);
    assert(bridge.phase() == MountPhase::mount_failed);
    assert(fs.mounts == 2 && fs.unmounts == 1);
    fs.mount_error = 0;

    fs.open_error = 0x1002;
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::open_failed);
    assert(first.last_native_result() == 0x1002);
    assert(fs.mounts == 3 && fs.closes == 1 && fs.unmounts == 2);
    assert(bridge.phase() == MountPhase::idle && !bridge.is_mounted());
    fs.open_error = 0;

    assert(bridge.configure(mount_calls(fs), io_calls(fs), nullptr, 64));
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(bridge.phase() == MountPhase::bad_configuration);
    assert(fs.mounts == 3);

    assert(bridge.configure(mount_calls(fs), io_calls(fs), cache.data(), cache.size()));
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::ready);
    first.close();
    assert(fs.mounts == 4 && fs.closes == 2 && fs.unmounts == 3);

    auto missing_ready_signal = mount_calls(fs);
    missing_ready_signal.filesystem_ready = nullptr;
    assert(bridge.configure(missing_ready_signal, io_calls(fs),
                            cache.data(), cache.size()));
    assert(first.open(bridge.file_api(), groove_hoop3_file::MountPolicy::separate_probe_mount) == groove_hoop3_file::Status::mount_failed);
    assert(bridge.phase() == MountPhase::bad_configuration);
    assert(fs.mounts == 4 && !bridge.is_mounted());
}
