#pragma once

// Actual nn::fs type boundary for a FUTURE read-only Hoop3 file probe.
// Intentionally not linked into any Switch module or invoked by hkMain.
// The game itself owns the original MountRom("data", ...). This adapter
// NEVER mounts, unmounts, writes, commits or changes permissions.
// It requires the original filesystem to have finished initializing and
// requires a separately proven, serialized game lifecycle callback.

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <type_traits>

#include <nn/fs.h>

#include "groove_hoop3_package_file.hpp"

namespace groove_hoop3_nnfs {

static_assert(sizeof(nn::fs::FileHandle) == sizeof(std::uintptr_t),
              "Unexpected NNSDK FileHandle ABI; do not deploy native reader");
static_assert(std::is_trivially_copyable<nn::fs::FileHandle>::value,
              "NNSDK FileHandle cannot be safely transferred as a token");
static_assert(sizeof(nn::Result) == sizeof(std::uint32_t),
              "Unexpected NNSDK Result ABI; do not deploy native reader");
static_assert(std::is_trivially_copyable<nn::Result>::value,
              "NNSDK Result ABI needs a separately audited extractor");

class BorrowedRomFs {
public:
    using GameMountReady = bool (*)(void*);

    // `ready` MUST come from a game-thread point established after the
    // original MountRom("data", ...) succeeded; never assume hkMain is late
    // enough. This object must outlive the whole synchronous file lease.
    BorrowedRomFs(GameMountReady ready, void* ready_context)
        : ready_(ready), ready_context_(ready_context) {}

    groove_hoop3_file::NativeFileApi api() {
        return {nullptr, open, get_size, read, close, nullptr, this, game_ready};
    }

private:
    static std::uint32_t raw_result(nn::Result result) {
        std::uint32_t value = 0;
        std::memcpy(&value, &result, sizeof(value));
        return value;
    }

    static nn::fs::FileHandle from_token(std::uintptr_t token) {
        nn::fs::FileHandle handle{};
        std::memcpy(&handle, &token, sizeof(handle));
        return handle;
    }

    static std::uintptr_t to_token(nn::fs::FileHandle handle) {
        std::uintptr_t token = 0;
        std::memcpy(&token, &handle, sizeof(token));
        return token;
    }

    static bool game_ready(void* context, const char* name) {
        auto* self = static_cast<BorrowedRomFs*>(context);
        return self && self->ready_ && name &&
               std::strcmp(name, groove_hoop3_file::kGameMountName) == 0 &&
               self->ready_(self->ready_context_);
    }

    static std::uint32_t open(void* context, const char* path,
                              std::uintptr_t* token) {
        if (!context || !path || !token) return kInvalidArguments;
        nn::fs::FileHandle handle{};
        const auto result = raw_result(
            nn::fs::OpenFile(&handle, path, nn::fs::OpenMode_Read));
        *token = result ? 0 : to_token(handle);
        return result;
    }

    static std::uint32_t get_size(void*, std::uintptr_t token,
                                  std::int64_t* size) {
        if (!token || !size) return kInvalidArguments;
        return raw_result(nn::fs::GetFileSize(size, from_token(token)));
    }

    static std::uint32_t read(void*, std::uintptr_t token, std::uint64_t offset,
                              void* destination, std::size_t requested,
                              std::size_t* received) {
        if (!token || !destination || !received ||
            offset > static_cast<std::uint64_t>(
                std::numeric_limits<std::int64_t>::max()))
            return kInvalidArguments;
        *received = 0;
        return raw_result(nn::fs::ReadFile(
            received, from_token(token), static_cast<std::int64_t>(offset),
            destination, requested));
    }

    static void close(void*, std::uintptr_t token) {
        if (token) nn::fs::CloseFile(from_token(token));
    }

    // Deliberately outside the Nintendo result-code namespace. This marker
    // is used only for local argument rejection, never represented as an
    // error issued by nn::fs itself.
    static constexpr std::uint32_t kInvalidArguments = 0xFFFFFFFFu;

    GameMountReady ready_ = nullptr;
    void* ready_context_ = nullptr;
};

} // namespace groove_hoop3_nnfs
