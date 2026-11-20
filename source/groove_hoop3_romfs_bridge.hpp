#pragma once

// Allocation-free, read-only planned NNSDK RomFS mount wrapper.
// A native binding must supply the actual nn::fs entry points with their
// original ABI, a game-safe persistent cache buffer, and a stable context.
// This portable bridge links the verified QueryMountRomCacheSize -> MountRom
// cache contract to the already-tested NativeFileApi; no Switch calls yet.

#include <cstddef>
#include <cstdint>

#include "groove_hoop3_package_file.hpp"

namespace groove_hoop3_romfs {

// Explicit local failure marker: NOT an nn::Result from Horizon.
constexpr std::uint32_t kLocalPreconditionFailure = 0xFFFFFFFFu;

struct MountCalls {
    // Must be backed by an independently verified game FS-init signal.
    // A missing/false callback prevents ALL actual native filesystem calls.
    bool (*filesystem_ready)(void*) = nullptr;
    std::uint32_t (*query_cache_size)(void*, std::size_t*) = nullptr;
    std::uint32_t (*mount_with_cache)(void*, const char*, void*, std::size_t) = nullptr;
    void (*unmount)(void*, const char*) = nullptr;
    void* context = nullptr;
};

enum class MountPhase : std::uint8_t {
    idle,
    bad_configuration,
    filesystem_not_ready,
    query_failed,
    cache_rejected,
    mount_failed,
    mounted,
};

class ReadOnlyBridge {
public:
    ReadOnlyBridge() = default;
    ReadOnlyBridge(const ReadOnlyBridge&) = delete;
    ReadOnlyBridge& operator=(const ReadOnlyBridge&) = delete;

    // `cache` is owned by the caller, must outlive every mounted lease and
    // must be allocated from an independently verified game-safe arena.
    // No buffer size is assumed; the actual native query decides the size.
    bool configure(MountCalls mount, groove_hoop3_file::NativeFileApi io,
                   void* cache, std::size_t cache_capacity) {
        if (mounted_) return false;
        mount_ = mount;
        io_ = io;
        cache_ = cache;
        capacity_ = cache_capacity;
        last_requested_ = 0;
        phase_ = MountPhase::idle;
        return true;
    }

    groove_hoop3_file::NativeFileApi file_api() {
        return {do_mount, do_open, do_size, do_read, do_close, do_unmount,
                this, nullptr};
    }

    MountPhase phase() const { return phase_; }
    std::size_t last_requested_cache_bytes() const { return last_requested_; }
    bool is_mounted() const { return mounted_; }

private:
    static ReadOnlyBridge& from(void* context) {
        return *static_cast<ReadOnlyBridge*>(context);
    }

    static std::uint32_t do_mount(void* context, const char* name) {
        auto& self = from(context);
        if (self.mounted_) return kLocalPreconditionFailure;
        self.last_requested_ = 0;
        if (!name || !self.cache_ || !self.capacity_ ||
            !self.mount_.filesystem_ready || !self.mount_.query_cache_size ||
            !self.mount_.mount_with_cache ||
            !self.mount_.unmount || !self.io_.open_read_only ||
            !self.io_.get_size || !self.io_.read || !self.io_.close) {
            self.phase_ = MountPhase::bad_configuration;
            return kLocalPreconditionFailure;
        }
        if (!self.mount_.filesystem_ready(self.mount_.context)) {
            self.phase_ = MountPhase::filesystem_not_ready;
            return kLocalPreconditionFailure;
        }
        std::size_t requested = 0;
        const auto query_result = self.mount_.query_cache_size(
            self.mount_.context, &requested);
        if (query_result) {
            self.phase_ = MountPhase::query_failed;
            return query_result;
        }
        self.last_requested_ = requested;
        if (requested == 0 || requested > self.capacity_) {
            self.phase_ = MountPhase::cache_rejected;
            return kLocalPreconditionFailure;
        }
        const auto mount_result = self.mount_.mount_with_cache(
            self.mount_.context, name, self.cache_, requested);
        if (mount_result) {
            self.phase_ = MountPhase::mount_failed;
            return mount_result;
        }
        self.mounted_ = true;
        self.phase_ = MountPhase::mounted;
        return 0;
    }

    static std::uint32_t do_open(void* context, const char* path,
                                 std::uintptr_t* handle) {
        auto& self = from(context);
        if (!self.mounted_) return kLocalPreconditionFailure;
        return self.io_.open_read_only(self.io_.context, path, handle);
    }

    static std::uint32_t do_size(void* context, std::uintptr_t handle,
                                 std::int64_t* length) {
        auto& self = from(context);
        if (!self.mounted_) return kLocalPreconditionFailure;
        return self.io_.get_size(self.io_.context, handle, length);
    }

    static std::uint32_t do_read(void* context, std::uintptr_t handle,
                                 std::uint64_t offset, void* destination,
                                 std::size_t bytes, std::size_t* received) {
        auto& self = from(context);
        if (!self.mounted_) return kLocalPreconditionFailure;
        return self.io_.read(self.io_.context, handle, offset, destination,
                             bytes, received);
    }

    static void do_close(void* context, std::uintptr_t handle) {
        auto& self = from(context);
        if (self.mounted_) self.io_.close(self.io_.context, handle);
    }

    static void do_unmount(void* context, const char* name) {
        auto& self = from(context);
        if (!self.mounted_) return;
        self.mount_.unmount(self.mount_.context, name);
        self.mounted_ = false;
        self.phase_ = MountPhase::idle;
    }

    MountCalls mount_{};
    groove_hoop3_file::NativeFileApi io_{};
    void* cache_ = nullptr;
    std::size_t capacity_ = 0;
    std::size_t last_requested_ = 0;
    MountPhase phase_ = MountPhase::idle;
    bool mounted_ = false;
};

} // namespace groove_hoop3_romfs
