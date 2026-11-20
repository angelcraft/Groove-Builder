#include "groove_hoop3_nnfs_borrowed.hpp"

#include <cassert>
#include <cstdint>
#include <cstring>

using namespace groove_hoop3_file;

struct FakeGameFs {
    bool original_mount_ready = false;
    unsigned opens = 0, sizes = 0, reads = 0, closes = 0;
    int last_open_mode = 0;
    std::uint32_t open_error = 0, size_error = 0, read_error = 0;
    bool short_read = false;
    bool oversized = false;
    const std::uint8_t bytes[8]{10,20,30,40,50,60,70,80};
};

static FakeGameFs game;
static constexpr std::uint64_t kHandle = 0x8000000123456780ULL;

namespace nn::fs {

Result OpenFile(FileHandle* output, const char* path, int mode) {
    assert(game.original_mount_ready);
    assert(std::strcmp(path, kGameReadPath) == 0);
    ++game.opens;
    game.last_open_mode = mode;
    if (game.open_error) return {game.open_error};
    output->_internal = kHandle;
    return {0};
}

Result GetFileSize(std::int64_t* size, FileHandle handle) {
    assert(handle._internal == kHandle);
    ++game.sizes;
    if (game.size_error) return {game.size_error};
    *size = game.oversized ? static_cast<std::int64_t>(kMaxInitialPackBytes + 1) :
                             static_cast<std::int64_t>(sizeof(game.bytes));
    return {0};
}

Result ReadFile(std::size_t* received, FileHandle handle, std::int64_t offset,
                void* destination, std::size_t count) {
    assert(handle._internal == kHandle);
    assert(offset >= 0 && static_cast<std::uint64_t>(offset) <= sizeof(game.bytes));
    assert(count <= sizeof(game.bytes) - static_cast<std::size_t>(offset));
    ++game.reads;
    if (game.read_error) return {game.read_error};
    *received = count - (game.short_read && count ? 1 : 0);
    std::memcpy(destination, game.bytes + offset, *received);
    return {0};
}

void CloseFile(FileHandle handle) {
    assert(handle._internal == kHandle);
    ++game.closes;
}

} // namespace nn::fs

static bool verified_game_mount(void* context) {
    return static_cast<FakeGameFs*>(context)->original_mount_ready;
}

int main() {
    groove_hoop3_nnfs::BorrowedRomFs backend{verified_game_mount, &game};
    FileLease lease;

    // No nn::fs call at all until separately confirmed original data: mount.
    assert(lease.open(backend.api()) == Status::game_mount_unavailable);
    assert(game.opens == 0 && game.sizes == 0);

    game.original_mount_ready = true;
    assert(lease.open(backend.api()) == Status::ready);
    assert(game.last_open_mode == nn::fs::OpenMode_Read);
    assert(game.opens == 1 && game.sizes == 1);
    std::uint8_t actual[3]{};
    assert(groove_zip::read_exact(lease.reader(), 2, actual, sizeof(actual)));
    assert(actual[0] == 30 && actual[1] == 40 && actual[2] == 50);
    lease.close();
    assert(game.closes == 1 && game.original_mount_ready);

    game.open_error = 0x1234;
    assert(lease.open(backend.api()) == Status::open_failed);
    assert(lease.last_native_result() == 0x1234);
    assert(game.closes == 1);
    game.open_error = 0;

    game.size_error = 0x8080;
    assert(lease.open(backend.api()) == Status::size_failed);
    assert(lease.last_native_result() == 0x8080);
    assert(game.closes == 2);
    game.size_error = 0;

    game.oversized = true;
    assert(lease.open(backend.api()) == Status::wrong_size);
    assert(game.closes == 3);
    game.oversized = false;

    game.short_read = true;
    assert(lease.open(backend.api()) == Status::ready);
    assert(!groove_zip::read_exact(lease.reader(), 0, actual, sizeof(actual)));
    assert(lease.status() == Status::read_failed);
    assert(game.reads == 2);
    lease.close();
    assert(game.closes == 4 && game.original_mount_ready);

    game.short_read = false;
    game.read_error = 0x42;
    assert(lease.open(backend.api()) == Status::ready);
    assert(!groove_zip::read_exact(lease.reader(), 0, actual, sizeof(actual)));
    assert(lease.last_native_result() == 0x42);
    lease.close();
    assert(game.closes == 5);

    // Null readiness cannot enable file access either.
    groove_hoop3_nnfs::BorrowedRomFs no_gate{nullptr, &game};
    assert(lease.open(no_gate.api()) == Status::game_mount_unavailable);
    assert(game.opens == 6);
}
