#include "groove_hoop3_package_file.hpp"

#include <cassert>
#include <cstdint>
#include <cstring>
#include <vector>

using namespace groove_hoop3_file;

struct FakeFs {
    std::vector<std::uint8_t> bytes{1,2,3,4,5,6,7,8};
    unsigned mounts = 0, opens = 0, reads = 0, closes = 0, unmounts = 0;
    bool mounted = false;
    bool game_mounted = false;
    std::uint32_t fail_mount = 0;
    std::uint32_t fail_open = 0;
    bool short_read = false;
    bool oversized = false;
};

static std::uint32_t mount(void* context, const char* mount_name) {
    auto& fs = *static_cast<FakeFs*>(context);
    assert(std::strcmp(mount_name, kMountName) == 0);
    ++fs.mounts;
    if (fs.fail_mount) return fs.fail_mount;
    assert(!fs.mounted);
    fs.mounted = true;
    return 0;
}

static std::uint32_t open(void* context, const char* path,
                          std::uintptr_t* handle) {
    auto& fs = *static_cast<FakeFs*>(context);
    ++fs.opens;
    assert((fs.mounted && std::strcmp(path, kNativeReadPath) == 0) ||
           (fs.game_mounted && std::strcmp(path, kGameReadPath) == 0));
    if (fs.fail_open) return fs.fail_open;
    *handle = reinterpret_cast<std::uintptr_t>(context);
    return 0;
}

static std::uint32_t size(void* context, std::uintptr_t handle,
                          std::int64_t* output) {
    auto& fs = *static_cast<FakeFs*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    *output = fs.oversized ? static_cast<std::int64_t>(kMaxInitialPackBytes + 1) :
                             static_cast<std::int64_t>(fs.bytes.size());
    return 0;
}

static std::uint32_t read(void* context, std::uintptr_t handle,
                          std::uint64_t offset, void* output,
                          std::size_t length, std::size_t* received) {
    auto& fs = *static_cast<FakeFs*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    ++fs.reads;
    if (offset > fs.bytes.size() || length > fs.bytes.size() - offset) return 0xE001;
    const auto amount = length - (fs.short_read && length > 0 ? 1 : 0);
    std::memcpy(output, fs.bytes.data() + offset, amount);
    *received = amount;
    return 0;
}

static void close(void* context, std::uintptr_t handle) {
    auto& fs = *static_cast<FakeFs*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    ++fs.closes;
}

static void unmount(void* context, const char* mount_name) {
    auto& fs = *static_cast<FakeFs*>(context);
    assert(fs.mounted && std::strcmp(mount_name, kMountName) == 0);
    ++fs.unmounts;
    fs.mounted = false;
}

static bool game_mount_ready(void* context, const char* mount_name) {
    auto& fs = *static_cast<FakeFs*>(context);
    assert(std::strcmp(mount_name, kGameMountName) == 0);
    return fs.game_mounted;
}

static NativeFileApi api(FakeFs& fs) {
    return {mount, open, size, read, close, unmount, &fs, game_mount_ready};
}

int main() {
    FakeFs fs;
    FileLease lease;
    assert(lease.open({}) == Status::unavailable_api);
    assert(!lease.reader().read_at);
    assert(lease.open(api(fs), MountPolicy::separate_probe_mount) == Status::ready);
    assert(fs.mounts == 1 && fs.opens == 1);
    const auto reader = lease.reader();
    std::uint8_t bytes[3]{};
    assert(groove_zip::read_exact(reader, 2, bytes, sizeof(bytes)));
    assert((bytes[0] == 3 && bytes[1] == 4 && bytes[2] == 5));
    assert(fs.reads == 1);
    assert(!groove_zip::read_exact(reader, 7, bytes, sizeof(bytes)));
    assert(!groove_zip::read_exact(reader, 9, bytes, 1));
    assert(fs.reads == 1); // Bounds checked before any native read.
    lease.close();
    assert(fs.closes == 1 && fs.unmounts == 1 && !fs.mounted);
    assert(!lease.reader().read_at);

    fs.fail_mount = 0x1234;
    assert(lease.open(api(fs), MountPolicy::separate_probe_mount) == Status::mount_failed);
    assert(lease.last_native_result() == 0x1234);
    assert(fs.opens == 1 && fs.unmounts == 1);
    fs.fail_mount = 0;
    fs.fail_open = 0x2222;
    assert(lease.open(api(fs), MountPolicy::separate_probe_mount) == Status::open_failed);
    assert(fs.unmounts == 2 && fs.closes == 1);
    fs.fail_open = 0;
    fs.oversized = true;
    assert(lease.open(api(fs), MountPolicy::separate_probe_mount) == Status::wrong_size);
    assert(fs.closes == 2 && fs.unmounts == 3);
    fs.oversized = false;
    fs.short_read = true;
    assert(lease.open(api(fs), MountPolicy::separate_probe_mount) == Status::ready);
    assert(!groove_zip::read_exact(lease.reader(), 0, bytes, sizeof(bytes)));
    assert(lease.status() == Status::read_failed);
    lease.close();
    assert(fs.closes == 3 && fs.unmounts == 4);

    // Preferred route: use original game-owned data:/ mount. We only check
    // readiness and open the overlay file; NEVER mount/unmount the game RomFS.
    assert(lease.open(api(fs)) == Status::game_mount_unavailable);
    assert(fs.mounts == 5 && fs.unmounts == 4);
    fs.game_mounted = true;
    fs.short_read = false;
    assert(lease.open(api(fs)) == Status::ready);
    assert(fs.mounts == 5 && fs.opens == 5);
    assert(groove_zip::read_exact(lease.reader(), 1, bytes, sizeof(bytes)));
    lease.close();
    assert(fs.closes == 4 && fs.unmounts == 4 && fs.game_mounted);
}
