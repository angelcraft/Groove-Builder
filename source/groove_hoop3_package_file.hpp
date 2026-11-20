#pragma once

// Read-only file lease for a future *native game-process* nn::fs adapter.
// Preferred route: borrow the game's already-mounted "data:" RomFS; NEVER
// mount/unmount it ourselves. A separate dedicated "groove0:" mount remains
// an explicitly opted-in fallback research probe. Neither route assumes
// direct SD privileges. No path comes from a .groove ZIP.

#include <cstddef>
#include <cstdint>

#include "groove_zip_archive.hpp"

namespace groove_hoop3_file {

constexpr const char* kMountName = "groove0";
constexpr const char* kNativeReadPath = "groove0:/GrooveEngine/HoopTrundling3.groove";
constexpr const char* kGameMountName = "data";
constexpr const char* kGameReadPath = "data:/GrooveEngine/HoopTrundling3.groove";
constexpr const char* kLayeredFsSdPath =
    "atmosphere/contents/0100D9F01D474000/romfs/GrooveEngine/HoopTrundling3.groove";
constexpr std::uint64_t kMaxInitialPackBytes = 8ull * 1024ull * 1024ull;

// Zero indicates nn::Result success. The binding owns the actual native
// FileHandle type; this portable layer carries an opaque nonzero token.
struct NativeFileApi {
    std::uint32_t (*mount_romfs)(void*, const char* mount_name) = nullptr;
    std::uint32_t (*open_read_only)(void*, const char* path,
                                    std::uintptr_t* handle) = nullptr;
    std::uint32_t (*get_size)(void*, std::uintptr_t handle,
                              std::int64_t* size) = nullptr;
    std::uint32_t (*read)(void*, std::uintptr_t handle,
                          std::uint64_t offset, void* destination,
                          std::size_t requested, std::size_t* received) = nullptr;
    void (*close)(void*, std::uintptr_t handle) = nullptr;
    void (*unmount_romfs)(void*, const char* mount_name) = nullptr;
    void* context = nullptr;
    // Must only return true after the game's own MountRom("data", ...) has
    // completed successfully. It MUST NOT itself mount/unmount game RomFS.
    bool (*existing_mount_ready)(void*, const char* mount_name) = nullptr;
};

enum class MountPolicy : std::uint8_t {
    borrow_game_romfs,    // Default: no native mount/unmount side effects.
    separate_probe_mount, // Explicit experimental mount + cache contract.
};

enum class Status : std::uint8_t {
    closed,
    ready,
    unavailable_api,
    mount_failed,
    game_mount_unavailable,
    open_failed,
    size_failed,
    wrong_size,
    read_failed,
};

class FileLease {
public:
    FileLease() = default;
    FileLease(const FileLease&) = delete;
    FileLease& operator=(const FileLease&) = delete;

    ~FileLease() { close(); }

    Status open(NativeFileApi api,
                MountPolicy policy = MountPolicy::borrow_game_romfs) {
        close();
        status_ = Status::unavailable_api;
        last_native_result_ = 0;
        if (!api.open_read_only || !api.get_size || !api.read || !api.close)
            return status_;
        if (policy == MountPolicy::borrow_game_romfs && !api.existing_mount_ready)
            return status_;
        if (policy == MountPolicy::separate_probe_mount &&
            (!api.mount_romfs || !api.unmount_romfs)) return status_;
        api_ = api;
        const char* path = kGameReadPath;
        if (policy == MountPolicy::borrow_game_romfs) {
            if (!api_.existing_mount_ready(api_.context, kGameMountName)) {
                status_ = Status::game_mount_unavailable;
                return status_;
            }
        } else {
            last_native_result_ = api_.mount_romfs(api_.context, kMountName);
            if (last_native_result_) {
                status_ = Status::mount_failed;
                return status_;
            }
            mounted_ = true;
            path = kNativeReadPath;
        }
        std::uintptr_t opened = 0;
        last_native_result_ = api_.open_read_only(
            api_.context, path, &opened);
        if (last_native_result_ || !opened) {
            status_ = Status::open_failed;
            cleanup_handle();
            return status_;
        }
        handle_ = opened;
        std::int64_t length = -1;
        last_native_result_ = api_.get_size(api_.context, handle_, &length);
        if (last_native_result_) {
            status_ = Status::size_failed;
            cleanup_handle();
            return status_;
        }
        if (length <= 0 || static_cast<std::uint64_t>(length) > kMaxInitialPackBytes) {
            status_ = Status::wrong_size;
            cleanup_handle();
            return status_;
        }
        length_ = static_cast<std::uint64_t>(length);
        status_ = Status::ready;
        return status_;
    }

    groove_zip::Reader reader() {
        return status_ == Status::ready ?
            groove_zip::Reader{read_at_bridge, this, length_} : groove_zip::Reader{};
    }

    void close() {
        cleanup_handle();
        status_ = Status::closed;
        last_native_result_ = 0;
        api_ = {};
    }

    Status status() const { return status_; }
    std::uint32_t last_native_result() const { return last_native_result_; }

private:
    static bool read_at_bridge(void* self, std::uint64_t offset,
                               void* destination, std::size_t length) {
        if (!self) return false;
        return static_cast<FileLease*>(self)->read_at(offset, destination, length);
    }

    bool read_at(std::uint64_t offset, void* destination, std::size_t length) {
        if (status_ != Status::ready || !handle_ || !destination ||
            offset > length_ || length > length_ - offset) return false;
        if (length == 0) return true;
        std::size_t received = 0;
        last_native_result_ = api_.read(api_.context, handle_, offset,
                                         destination, length, &received);
        if (last_native_result_ || received != length) {
            status_ = Status::read_failed;
            return false;
        }
        return true;
    }

    void cleanup_handle() {
        if (handle_) api_.close(api_.context, handle_);
        handle_ = 0;
        length_ = 0;
        if (mounted_) api_.unmount_romfs(api_.context, kMountName);
        mounted_ = false;
    }

    NativeFileApi api_{};
    std::uintptr_t handle_ = 0;
    std::uint64_t length_ = 0;
    std::uint32_t last_native_result_ = 0;
    Status status_ = Status::closed;
    bool mounted_ = false;
};

} // namespace groove_hoop3_file
