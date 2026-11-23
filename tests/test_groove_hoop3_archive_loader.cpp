#include "groove_hoop3_archive_loader.hpp"
#include "groove_hoop3_file_gateway.hpp"

#include <cassert>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <utility>
#include <vector>

using namespace groove_hoop3;

static const char kManifest[] = R"({
  "format":"groove.level", "version":1, "id":"groove.hoop_trundling_3",
  "title":"Hoop Trundling 3", "slot":{"world":1,"column":9,"row":0},
  "base":{"game":"rhythm_paradise_switch","kind":1,"index":41,
          "adapter":"hoop_trundling"},
  "sequence":{"mode":"replace","file":"timeline.json"},
  "launch":{"practice":"skip"},
  "resources":{"sprites":null,"music":null,"sound_effects":null,"intro":null},
  "progress_namespace":"groove.hoop_trundling_3", "state":"draft"
})";

static const char kTimeline[] = R"({
  "version":1, "timebase":"beats", "events":[
    {"id":"ring_first","beat":"1","command":"hoop.ring_spawn",
     "args":{"variant":"normal"}}]
})";

static void u16(std::vector<std::uint8_t>& out, std::uint16_t value) {
    out.push_back(static_cast<std::uint8_t>(value));
    out.push_back(static_cast<std::uint8_t>(value >> 8));
}

static void u32(std::vector<std::uint8_t>& out, std::uint32_t value) {
    u16(out, static_cast<std::uint16_t>(value));
    u16(out, static_cast<std::uint16_t>(value >> 16));
}

static std::vector<std::uint8_t> read_pack_background() {
    std::string path = __FILE__;
    const auto slash = path.find_last_of("/\\");
    path = (slash == std::string::npos ? std::string(".") : path.substr(0, slash)) +
           "/../examples/hoop_trundling_3/sprites/background.png";
    std::ifstream in(path, std::ios::binary);
    assert(in);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

static std::vector<std::uint8_t> pack(
    const char* timeline, const char* manifest = kManifest,
    std::vector<std::pair<std::string, std::vector<std::uint8_t>>> extra = {}) {
    const std::vector<std::uint8_t> binary = {
        'G','R','T','1', 1,0,0,0, 0x40,0x42,0x0F,0,0,0,0,0,
        1,0,0,0, 0,0,0,0,
    };
    struct Member {
        std::string name;
        std::vector<std::uint8_t> data;
        std::uint32_t offset;
    };
    std::vector<Member> members = {
        {"manifest.json", std::vector<std::uint8_t>(manifest,
         manifest + std::strlen(manifest)), 0},
        {"timeline.json", std::vector<std::uint8_t>(timeline,
         timeline + std::strlen(timeline)), 0},
        {"timeline.bin", binary, 0},
    };
    for (auto& item : extra)
        members.push_back({std::move(item.first), std::move(item.second), 0});
    std::vector<std::uint8_t> bytes;
    for (auto& member : members) {
        member.offset = static_cast<std::uint32_t>(bytes.size());
        u32(bytes, 0x04034B50);
        for (unsigned i = 0; i < 5; ++i) u16(bytes, i == 0 ? 20 : 0);
        const auto crc = groove_zip::crc32(member.data.data(), member.data.size());
        u32(bytes, crc);
        u32(bytes, static_cast<std::uint32_t>(member.data.size()));
        u32(bytes, static_cast<std::uint32_t>(member.data.size()));
        u16(bytes, static_cast<std::uint16_t>(member.name.size()));
        u16(bytes, 0);
        bytes.insert(bytes.end(), member.name.begin(), member.name.end());
        bytes.insert(bytes.end(), member.data.begin(), member.data.end());
    }
    const auto central_start = static_cast<std::uint32_t>(bytes.size());
    for (const auto& member : members) {
        u32(bytes, 0x02014B50);
        u16(bytes, 0x0314); // Unix, PKZIP v2.0
        u16(bytes, 20);
        for (unsigned i = 0; i < 4; ++i) u16(bytes, 0);
        u32(bytes, groove_zip::crc32(member.data.data(), member.data.size()));
        u32(bytes, static_cast<std::uint32_t>(member.data.size()));
        u32(bytes, static_cast<std::uint32_t>(member.data.size()));
        u16(bytes, static_cast<std::uint16_t>(member.name.size()));
        for (unsigned i = 0; i < 4; ++i) u16(bytes, 0);
        u32(bytes, 0x81A40000u); // regular file 0644
        u32(bytes, member.offset);
        bytes.insert(bytes.end(), member.name.begin(), member.name.end());
    }
    const auto central_size = static_cast<std::uint32_t>(bytes.size()) - central_start;
    u32(bytes, 0x06054B50);
    u16(bytes, 0);
    u16(bytes, 0);
    u16(bytes, static_cast<std::uint16_t>(members.size()));
    u16(bytes, static_cast<std::uint16_t>(members.size()));
    u32(bytes, central_size);
    u32(bytes, central_start);
    u16(bytes, 0);
    return bytes;
}

static bool memory_read(void* context, std::uint64_t offset,
                        void* output, std::size_t length) {
    auto& bytes = *static_cast<std::vector<std::uint8_t>*>(context);
    if (offset > bytes.size() || length > bytes.size() - offset) return false;
    std::memcpy(output, bytes.data() + offset, length);
    return true;
}

static groove_zip::Reader input(std::vector<std::uint8_t>& data) {
    return {memory_read, &data, data.size()};
}

struct Trace { unsigned rings = 0; unsigned waits = 0; };
static bool ring(void* context, std::int32_t) {
    ++static_cast<Trace*>(context)->rings;
    return true;
}
static bool wait(void* context, std::int32_t ticks) {
    ++static_cast<Trace*>(context)->waits;
    return ticks == 480;
}
static bool stopped(void*) { return false; }

struct NativeFsFixture {
    std::vector<std::uint8_t> archive;
    unsigned mounts = 0, opens = 0, reads = 0, closes = 0, unmounts = 0;
    bool mounted = false;
    bool game_mounted = true;
    bool file_missing = false;
    bool short_read = false;
};

static std::uint32_t fs_mount(void* context, const char* name) {
    auto& fs = *static_cast<NativeFsFixture*>(context);
    assert(std::strcmp(name, groove_hoop3_file::kMountName) == 0);
    assert(!fs.mounted);
    fs.mounted = true;
    ++fs.mounts;
    return 0;
}

static std::uint32_t fs_open(void* context, const char* path,
                             std::uintptr_t* handle) {
    auto& fs = *static_cast<NativeFsFixture*>(context);
    assert(std::strcmp(path, groove_hoop3_file::kGameReadPath) == 0);
    assert(fs.game_mounted);
    ++fs.opens;
    if (fs.file_missing) return 0x404;
    *handle = reinterpret_cast<std::uintptr_t>(context);
    return 0;
}

static std::uint32_t fs_size(void* context, std::uintptr_t handle,
                             std::int64_t* size) {
    auto& fs = *static_cast<NativeFsFixture*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    *size = static_cast<std::int64_t>(fs.archive.size());
    return 0;
}

static std::uint32_t fs_read(void* context, std::uintptr_t handle,
                             std::uint64_t offset, void* dst,
                             std::size_t count, std::size_t* received) {
    auto& fs = *static_cast<NativeFsFixture*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    ++fs.reads;
    if (offset > fs.archive.size() || count > fs.archive.size() - offset)
        return 0x405;
    const auto n = count - (fs.short_read && count ? 1 : 0);
    std::memcpy(dst, fs.archive.data() + offset, n);
    *received = n;
    return 0;
}

static void fs_close(void* context, std::uintptr_t handle) {
    auto& fs = *static_cast<NativeFsFixture*>(context);
    assert(handle == reinterpret_cast<std::uintptr_t>(context));
    ++fs.closes;
}

static void fs_unmount(void* context, const char* name) {
    auto& fs = *static_cast<NativeFsFixture*>(context);
    assert(std::strcmp(name, groove_hoop3_file::kMountName) == 0);
    assert(fs.mounted);
    fs.mounted = false;
    ++fs.unmounts;
}

static bool fs_game_mount_ready(void* context, const char* name) {
    auto& fs = *static_cast<NativeFsFixture*>(context);
    assert(std::strcmp(name, groove_hoop3_file::kGameMountName) == 0);
    return fs.game_mounted;
}

static groove_hoop3_file::NativeFileApi fs_api(NativeFsFixture& fs) {
    return {fs_mount, fs_open, fs_size, fs_read, fs_close,
            fs_unmount, &fs, fs_game_mount_ready};
}

int main() {
    static ArchiveLoader loader;
    static SessionOwner owner;
    auto good = pack(kTimeline);
    const auto good_file = input(good);
    auto report = loader.load(owner, good_file, nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::loaded && report.events == 1);
    assert(owner.hoop3_slot_unlocked() && owner.ring_count() == 1);
    assert(loader.background_size() == 0);

    // Missing/replaced file LOCKS a previously valid virtual slot.
    assert(loader.load(owner, {}, nullptr, nullptr).status ==
           ArchiveLoadStatus::zip_invalid);
    assert(!owner.hoop3_slot_unlocked() && owner.phase() == Phase::empty);

    const char altered[] = R"({"version":1,"timebase":"beats","events":[
      {"id":"ring_first","beat":"2","command":"hoop.ring_spawn",
       "args":{"variant":"normal"}}]})";
    auto stale = pack(altered); // Internal ZIP CRC is correct; GRT1 is stale.
    report = loader.load(owner, input(stale), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::json_cache_mismatch);
    assert(!owner.hoop3_slot_unlocked());

    report = loader.load(owner, input(good), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::loaded);
    // After the data is copied, the backing archive can disappear and the
    // session is still safe. No worker retains a pointer to ZIP storage.
    good.clear();
    good.shrink_to_fit();

    constexpr std::uintptr_t base = 0x7100000000ULL;
    constexpr std::uintptr_t stage = 0x7200003000ULL;
    const hoop3_launch::Selection selected{1, 9, 0, 1, 41, 777};
    const hoop3_launch::NativeMenuRecord saved{1, 1, 9, 0, 41};
    const hoop3_launch::FactoryResult created{
        stage, base + hoop3_launch::kStage68VtableOffset, base};
    Trace trace;
    assert(owner.on_confirmed_menu_launch(selected) == MenuAction::hoop3_launch);
    assert(owner.on_first_factory_return(created, saved));
    assert(owner.on_stage68_practice_branch(stage, saved, {ring, &trace}) ==
           StageAction::skip_practice_and_replace);
    report = loader.load(owner, input(stale), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::session_busy);
    assert(owner.phase() == Phase::active);
    const auto played = owner.on_stage68_worker(stage, {stopped, wait, &trace});
    assert(played.action == WorkerAction::custom_worker_finished);
    assert(played.report.result == groove_hoop_native::Result::completed);
    assert(trace.rings == 1 && trace.waits == 1);
    assert(!owner.on_scene_destroyed_after_join(stage, false));
    assert(owner.on_scene_destroyed_after_join(stage, true));
    assert(owner.hoop3_slot_unlocked());
    // Now it is safe to lock the slot by reloading a corrupt package.
    report = loader.load(owner, input(stale), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::json_cache_mismatch);
    assert(owner.phase() == Phase::empty && !owner.hoop3_slot_unlocked());

    // Complete candidate native-FS file lease -> ZIP -> JSON/cache -> owner.
    // All callbacks are HOST FAKES, not proof of a Switch RomFS mount.
    static groove_hoop3_file::Gateway gateway;
    static SessionOwner fs_owner;
    NativeFsFixture fs{pack(kTimeline)};
    auto loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.file_status == groove_hoop3_file::Status::ready);
    assert(loaded.archive.status == ArchiveLoadStatus::loaded);
    assert(loaded.archive.events == 1 && fs_owner.hoop3_slot_unlocked());
    assert(fs.mounts == 0 && fs.opens == 1 && fs.reads > 0);
    assert(fs.closes == 1 && fs.unmounts == 0 && !fs.mounted);

    // Early call before the game owns a ready data: mount locks Hoop3,
    // without reading and crucially without mounting/unmounting game data.
    fs.game_mounted = false;
    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.file_status ==
           groove_hoop3_file::Status::game_mount_unavailable);
    assert(!fs_owner.hoop3_slot_unlocked());
    assert(fs.opens == 1 && fs.mounts == 0 && fs.unmounts == 0);
    fs.game_mounted = true;
    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.archive.status == ArchiveLoadStatus::loaded);

    fs.file_missing = true;
    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.file_status == groove_hoop3_file::Status::open_failed);
    assert(loaded.last_native_result == 0x404);
    assert(!fs_owner.hoop3_slot_unlocked());
    assert(fs.closes == 2 && fs.unmounts == 0);

    fs.file_missing = false;
    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.archive.status == ArchiveLoadStatus::loaded);
    assert(fs_owner.hoop3_slot_unlocked());
    fs.short_read = true;
    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.file_status == groove_hoop3_file::Status::read_failed);
    assert(loaded.archive.status == ArchiveLoadStatus::zip_invalid);
    assert(!fs_owner.hoop3_slot_unlocked());
    fs.short_read = false;

    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.archive.status == ArchiveLoadStatus::loaded);
    assert(fs_owner.on_confirmed_menu_launch(selected) == MenuAction::hoop3_launch);
    const auto old_mounts = fs.mounts;
    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.archive.status == ArchiveLoadStatus::session_busy);
    assert(fs.mounts == old_mounts); // No file I/O during an active transition.
    assert(fs_owner.hoop3_slot_unlocked() == false);
    fs_owner.on_cancel_before_worker();
    assert(fs_owner.hoop3_slot_unlocked());
    fs.file_missing = true;
    loaded = gateway.reload(fs_owner, fs_api(fs), nullptr, nullptr);
    assert(loaded.archive.status == ArchiveLoadStatus::zip_invalid);
    assert(!fs_owner.hoop3_slot_unlocked());

    // Hoop 3 carries sprites/background.png. Hoop 2's type_01/bg.spr is not
    // a member. The PNG is copied on the host and is not a Switch bind.
    const char kBackgroundManifest[] = R"({
      "format":"groove.level", "version":1, "id":"groove.hoop_trundling_3",
      "title":"Hoop Trundling 3", "slot":{"world":1,"column":9,"row":0},
      "base":{"game":"rhythm_paradise_switch","kind":1,"index":41,
              "adapter":"hoop_trundling"},
      "sequence":{"mode":"replace","file":"timeline.json"},
      "launch":{"practice":"skip"},
      "resources":{"sprites":"sprites/background.png","music":null,
                   "sound_effects":null,"intro":null},
      "progress_namespace":"groove.hoop_trundling_3", "state":"draft"
    })";
    const auto png = read_pack_background();
    assert(png.size() >= 8 && png[0] == 0x89 && png[1] == 'P');
    std::vector<std::pair<std::string, std::vector<std::uint8_t>>> bg_member;
    bg_member.push_back({"sprites/background.png", png});
    auto with_bg = pack(kTimeline, kBackgroundManifest, bg_member);
    report = loader.load(owner, input(with_bg), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::loaded && report.events == 1);
    assert(loader.background_size() == png.size());
    assert(std::memcmp(loader.background_bytes(), png.data(), png.size()) == 0);

    auto missing = pack(kTimeline, kBackgroundManifest);
    report = loader.load(owner, input(missing), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::metadata_invalid);
    assert(loader.background_size() == 0);
    assert(!owner.hoop3_slot_unlocked());

    std::vector<std::pair<std::string, std::vector<std::uint8_t>>> stray;
    stray.push_back({"sprites/background.png", png});
    auto other = pack(kTimeline, kManifest, std::move(stray));
    report = loader.load(owner, input(other), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::wrong_members);
    assert(loader.background_size() == 0);

    std::vector<std::uint8_t> not_png(png.size(), 0);
    std::vector<std::pair<std::string, std::vector<std::uint8_t>>> fake_member;
    fake_member.push_back({"sprites/background.png", not_png});
    auto fake = pack(kTimeline, kBackgroundManifest, std::move(fake_member));
    report = loader.load(owner, input(fake), nullptr, nullptr);
    assert(report.status == ArchiveLoadStatus::metadata_invalid);
    assert(loader.background_size() == 0);
}
