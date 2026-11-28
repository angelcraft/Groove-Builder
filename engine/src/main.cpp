// Groove Engine - HT3 (Hoop Trundling 3) subsdk4 module.
// Own code. Uses the native HT2 stage object (scene, prologue/epilogue/results
// resources) but replaces its whole sequencing (entry/control/cue/background/
// latency threads) with a timeline read from sd:/groove/stages/ht3/ht3.gtl.
// No game bytes are contained in this module.
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include <hk/hook/Trampoline.h>
#include <hk/hook/Replace.h>
#include <hk/ro/RoUtil.h>

#include <nn/fs/fs_Directories.h>
#include <nn/fs/fs_Files.h>
#include <nn/fs/fs_Mount.h>
#include <nn/fs/fs_Types.h>

#include "sigs.hpp"
#include "timeline.hpp"
#include "multi.hpp"
#include "gtf.hpp"
#include "cuefns.hpp"
#include "numparse.hpp"
#include "save_replace.hpp"
#include "metadata.hpp"
#include "v0_loader.hpp"
#include "v0_native.hpp"

#define GROOVE_HT3_VERSION "0.5.1"

namespace {

// ---------------------------------------------------------------- addresses
// Offsets in main 1.0.x (build id 03FF4A3B EC96BDE3 A2E37CE3 AA4CAA0C ...).
constexpr uint8_t kBuildId[16] = {0x03, 0xFF, 0x4A, 0x3B, 0xEC, 0x96, 0xBD, 0xE3,
                                  0xA2, 0xE3, 0x7C, 0xE3, 0xAA, 0x4C, 0xAA, 0x0C};
constexpr uintptr_t oHt2Ctor = 0x428D70, oWorker = 0x428EF0, oDtor = 0x4290F0;
constexpr uintptr_t oInitSm = 0x138B10, oFadeScreen = 0x1366E0, oWaitReady = 0x1398B0,
    oSceneSetup = 0x136600, oPlayAnim = 0x4F8260, oPrepareSm = 0x139070, oWait = 0x514D70,
    oStop = 0x514DD0, oPush = 0x514FB0, oPop = 0x514FD0, oInitGameplay = 0x137050,
    oEnablePause = 0x138F80, oSetInput = 0x12A980, oWaitAudio = 0x139250,
    oStartGameplay = 0x138CE0, oUnk138D20 = 0x138D20, oPlayBgm = 0x139140, oNew = 0x4E02F0,
    oThreadCtor = 0x514A90, oAppend = 0x5153A0, oPmfTramp = 0x429290, oEndGameplay = 0x138CD0,
    oDisablePause = 0x138FC0, oFinish = 0x137140, oToResults = 0x138D40, oExitToMenu = 0x130500,
    oHoop = 0x217960, oSetComment = 0x1390E0, oStars = 0x42B2E0, oLatency = 0x137990,
    oSetNextScene = 0x509570;
// SceneRing path table (0x216530). Starts with ADRP — hook with HkReplace
// (a direct `b`), not a Hakkun trampoline. Do not hook 0x216550 (sound/cues).
constexpr uintptr_t oRingTypeEntry = 0x216530;
constexpr uintptr_t kRingPathTable = 0xDACF80;  // stride 0x18; type 2 = type_01/bg
constexpr int kRingType01 = 2;
// Intro / results title (game_name.msbt). Both have trampoline-safe prologues.
// Do not trampoline 0x1CBCD0 (starts with ADRP) or mid-function 0x1D6A80.
constexpr uintptr_t oGetMessage = 0x4EFE80;
constexpr uintptr_t oCachedName = 0x2BD0;
constexpr uintptr_t oStashName  = 0x206D00;  // launch: cachedName then **(0xD99D60)=name
constexpr uintptr_t oStashSlot  = 0xD99D60;
constexpr uintptr_t oPrologueCtor = 0x206DE0; // common prologue ctor; copies stash into the intro card
constexpr uintptr_t oLoadComplete = 0x504720; // (loader, dest): dest+8 = *(loader+0x28) which is the LAYOUT, not the SPR
constexpr uintptr_t oLayoutBake  = 0x4F40A0; // trampoline-safe; layout+8 already = relocated SPR
// GRO-7 v0.4.0: layout colour resolver (layout, colourIdx, alphaByte) -> vec4 at x8.
// Replaced (HkReplace + asm shim that moves x8) with an exact re-implementation
// that also knows kSkyMulIdx. The v0.3.x 0x4F12C0/0x4F12F0 remaps are retired.
constexpr uintptr_t oMulColor    = 0x4F3480;
constexpr uintptr_t oByteToFloat = 0xD9D708;  // GOT: float[256] LUT used by 0x4E0B90 / 0x4F3480
// GRO-12: 0x206D00 also stores the prologue SPR path and the jingle id.
constexpr uintptr_t oStashPath   = 0xD99D68;  // **: const char* prologue path (desc+0x20)
constexpr uintptr_t oStashJingle = 0xD99D70;  // *:  int jingle id (desc+0x28), read at 0x2073E0
constexpr uintptr_t kDescKind1 = 0xD19108, kDescKind2 = 0xD1A008;  // stride 0x30, +0x20 path
constexpr int kDescKind1Count = 80, kDescKind2Count = 30;
// GRO-11 overworld map info panel. 0x1D0130(panel, bool anim) refreshes the
// visible name/description/rank panes for the map cursor cell. panel+8 = map
// scene; map+0x5274/0x5298/0x529C = world/col/row; map+0x29E8 = deferred pane
// text queue (0x504490, copies text when arg3=0); panel+0x30 = name pane.
// The name comes from cachedName(kind,index) (0x1D0204), so HT3, Double Hell
// and native HT2 (all (1,41)) can only be told apart by the cell coordinates.
// 0x1D6A60 (+0x2A18, via 0x139AD0) is the screen-reader narration, not text.
constexpr uintptr_t oMapInfo = 0x1D0130;      // stp x29,x30,[sp,#-0x50]!; stp x26,x25 — trampoline-safe
constexpr uintptr_t oTextQueueSet = 0x504490; // (queue, pane, text, keepPtr)
constexpr uintptr_t oMapCellLock = 0x1CF490;  // (map, dCol, dRow) -> lock state; >1 = unlocked (name shown)
constexpr int kKind1Ring01 = 41;  // kind=1 index of I_RING_01 (HT2 / HT3 / DH)
constexpr int kKind1Multi  = 67;  // kind=1 index on the IPS Multi tile (world 1, col 9, row 4)
constexpr uintptr_t kMainLayoutInScene = 0x38A8;  // SceneRing: type_00/main layout
constexpr uintptr_t oManager = 0x10A75F0;     // selection/save manager object (.bss)
constexpr uintptr_t oThreadVtbl = 0xD4D450;   // HT2 member-thread vtable

// HT2 stage layout (object size 0x7AD0)
constexpr uintptr_t sSub = 0x2C78, sRunner = 0x2C80, sThreadIdx = 0x2C90, sScene = 0x2C98,
    sCtx = 0x29D8, sLayout = 0x67F8, sFloat2B1C = 0x2B1C, sFloat5BE8 = 0x5BE8;

uintptr_t gBase = 0;
bool gActive = false;   // build id + signatures OK and hooks installed
bool gFsOk = false;
bool gLogOnly = false;  // build id OK but signatures off: ctor hook only writes the log
bool gNoNativeResults = false;  // NO_NATIVE_RESULTS file present

template <typename F>
F fn(uintptr_t off) { return reinterpret_cast<F>(gBase + off); }
template <typename T>
T& at(void* p, uintptr_t off) { return *reinterpret_cast<T*>(reinterpret_cast<uintptr_t>(p) + off); }

// ---------------------------------------------------------------- paths
constexpr const char* kMount = "ht3sd";
const char* kLogPath = "ht3sd:/groove/log/ht3.log";  // may switch to a fallback
// v0.2: several custom stages can live on HT2 tiles; the first whose .gtl
// "match" rule fits the selected menu tile (or that has a FORCE file) runs.
struct StageDef {
    const char* name;      // save/log name
    const char* gtl;       // timeline
    const char* force;     // FORCE file
    const char* disable;   // DISABLE file
    const char* noNative;  // NO_NATIVE_RESULTS file
};
constexpr StageDef kStages[] = {
    {"ht3", "ht3sd:/groove/stages/ht3/ht3.gtl", "ht3sd:/groove/stages/ht3/FORCE", "ht3sd:/groove/stages/ht3/DISABLE",
     "ht3sd:/groove/stages/ht3/NO_NATIVE_RESULTS"},
    {"doublehell", "ht3sd:/groove/stages/doublehell/doublehell.gtl", "ht3sd:/groove/stages/doublehell/FORCE",
     "ht3sd:/groove/stages/doublehell/DISABLE", "ht3sd:/groove/stages/doublehell/NO_NATIVE_RESULTS"},
};
constexpr int kStageCount = sizeof(kStages) / sizeof(kStages[0]);
const StageDef* gStage = &kStages[0];   // stage chosen for the current HT2 object
// save file name pattern (%s = stage name); may switch to a fallback location
const char* kSaveFmt = "ht3sd:/groove/save/%s.json";
char gSavePath[96], gSaveTmpPath[100];

// ---------------------------------------------------------------- logging
// Lines are appended to a RAM buffer (safe inside game coroutines) and only
// written to the SD from normal contexts (boot, stage creation, stage dtor).
char gLogBuf[16384];
int gLogLen = 0;
unsigned gLogSeq = 0;
unsigned char gLogBusy=0;
unsigned char gInputBusy=0;

void logf(const char* fmt, ...) {
    groove::TryLease lease(gLogBusy);
    if (!lease.held) return;
    char gLine[512];
    va_list ap;
    va_start(ap, fmt);
    int n = snprintf(gLine, sizeof(gLine), "[%04u] ", (unsigned)gLogSeq++);
    if (n < 0 || n >= (int)sizeof(gLine)-2) { va_end(ap); return; }
    int written=vsnprintf(gLine+n,sizeof(gLine)-n-2,fmt,ap);
    va_end(ap);
    if (written<0) return;
    int available=sizeof(gLine)-n-2;
    n += written < available ? written : available-1;
    gLine[n++] = '\n';
    if (gLogLen + n > (int)sizeof(gLogBuf)) gLogLen = 0;  // drop on overflow
    memcpy(gLogBuf + gLogLen, gLine, n);
    gLogLen += n;
}

// ---------------------------------------------------------------- SD access
// v0.1.1: NO nn::fs imports at all (nothing for sail/rtld to resolve -> nothing
// that can abort at boot) and NO file system use at module entry. The nn::fs
// functions are looked up by name the first time a stage is created, i.e. long
// after nninitStartup, when the game itself already uses the file system.
// If any lookup or the mount fails, the module simply stays log-less/inactive.
struct FsApi {
    nn::Result (*MountSdCard)(const char*);
    nn::Result (*CreateDirectory)(const char*);
    nn::Result (*CreateFile)(const char*, long);
    nn::Result (*DeleteFile)(const char*);
    nn::Result (*RenameFile)(const char*, const char*);
    nn::Result (*OpenFile)(nn::fs::FileHandle*, const char*, int);
    nn::Result (*ReadFile)(nn::fs::FileHandle, long, void*, unsigned long);
    nn::Result (*WriteFile)(nn::fs::FileHandle, long, const void*, unsigned long, const nn::fs::WriteOption&);
    nn::Result (*GetFileSize)(long*, nn::fs::FileHandle);
    void (*CloseFile)(nn::fs::FileHandle);
};
FsApi gFs{};
int gFsState = 0;  // 0 = not tried yet, 1 = ok, -1 = unavailable (never retried)

const char* const kFsNames[] = {
    "_ZN2nn2fs11MountSdCardEPKc",
    "_ZN2nn2fs15CreateDirectoryEPKc",
    "_ZN2nn2fs10CreateFileEPKcl",
    "_ZN2nn2fs10DeleteFileEPKc",
    "_ZN2nn2fs10RenameFileEPKcS2_",
    "_ZN2nn2fs8OpenFileEPNS0_10FileHandleEPKci",
    "_ZN2nn2fs8ReadFileENS0_10FileHandleElPvm",
    "_ZN2nn2fs9WriteFileENS0_10FileHandleElPKvmRKNS0_11WriteOptionE",
    "_ZN2nn2fs11GetFileSizeEPlNS0_10FileHandleE",
    "_ZN2nn2fs9CloseFileENS0_10FileHandleE",
};
static_assert(sizeof(FsApi) == sizeof(kFsNames), "FsApi/kFsNames mismatch");

void logf(const char* fmt, ...);

bool writeAppend(const char* path, const char* data, long len);
int gMountTries = 0;
bool gLogWritable = false;

// Called only from normal game contexts (stage ctor/dtor), never at boot.
bool ensureFs() {
    if (gFsState == 1) return true;
    if (gFsState == -1) return false;           // symbols missing: never retry
    if (gMountTries >= 3) return false;         // mount failed 3 times: give up
    uintptr_t* slots = reinterpret_cast<uintptr_t*>(&gFs);
    for (size_t i = 0; i < sizeof(kFsNames) / sizeof(kFsNames[0]); i++) {
        slots[i] = hk::ro::lookupSymbol(kFsNames[i]);
        if (slots[i] == 0) {
            logf("fs: symbol not found: %s -> SD disabled (HT3 stays off, HT2 untouched)", kFsNames[i]);
            gFsState = -1;
            return false;
        }
    }
    gMountTries++;
    nn::Result rc = gFs.MountSdCard(kMount);
    if (rc.IsFailure()) {
        logf("fs: MountSdCard(\"%s\") try %d failed rc=0x%x", kMount, gMountTries, (unsigned)rc.GetInnerValueForDebug());
        return false;
    }
    gFsState = 1;
    gFsOk = true;
    logf("fs: SD mounted as \"%s\" (deferred mount, try %d)", kMount, gMountTries);
    const char* dirs[] = {"ht3sd:/groove", "ht3sd:/groove/log", "ht3sd:/groove/save"};
    for (const char* d : dirs) {
        nn::Result r = gFs.CreateDirectory(d);
        logf("fs: CreateDirectory(%s) rc=0x%x%s", d, (unsigned)r.GetInnerValueForDebug(),
             r.IsSuccess() ? " (created)" : " (0x402 = already exists)");
    }
    // Pick the first log location that is actually writable.
    static const char* const kLogCands[][2] = {
        {"ht3sd:/groove/log/ht3.log", "ht3sd:/groove/save/%s.json"},
        {"ht3sd:/groove/stages/ht3/ht3.log", "ht3sd:/groove/stages/ht3/%s_save.json"},
        {"ht3sd:/ht3.log", "ht3sd:/%s_save.json"},
    };
    for (auto& c : kLogCands) {
        static const char kProbe[] = "";
        if (writeAppend(c[0], kProbe, 0)) {
            kLogPath = c[0]; kSaveFmt = c[1];
            gLogWritable = true;
            logf("fs: log file = %s, save files = %s", kLogPath, kSaveFmt);
            break;
        }
        logf("fs: cannot write %s", c[0]);
    }
    if (!gLogWritable) logf("fs: NO writable location on SD (reads still work)");
    return true;
}

int gWriteErrLogged = 0;
bool writeAppend(const char* path, const char* data, long len) {
    if (!gFsOk) return false;
    nn::fs::FileHandle h{};
    nn::Result r = gFs.OpenFile(&h, path, nn::fs::OpenMode_Write | nn::fs::OpenMode_Append);
    if (r.IsFailure()) {
        nn::Result rc = gFs.CreateFile(path, 0);
        r = gFs.OpenFile(&h, path, nn::fs::OpenMode_Write | nn::fs::OpenMode_Append);
        if (r.IsFailure()) {
            if (gWriteErrLogged++ < 8)
                logf("fs: write %s failed: CreateFile rc=0x%x OpenFile rc=0x%x", path,
                     (unsigned)rc.GetInnerValueForDebug(), (unsigned)r.GetInnerValueForDebug());
            return false;
        }
    }
    long size = 0;
    if (gFs.GetFileSize(&size,h).IsFailure() || size<0 || len<0 || len>0x7fffffff-size) { gFs.CloseFile(h); return false; }
    bool ok = len == 0 || gFs.WriteFile(h, size, data, len,
                                        nn::fs::WriteOption::CreateOption(nn::fs::WriteOptionFlag_Flush)).IsSuccess();
    gFs.CloseFile(h);
    return ok;
}

void flushLog() {
    groove::TryLease lease(gLogBusy);
    if (!lease.held) return;
    if (!gFsOk || !gLogWritable || gLogLen == 0) return;
    // keep the log bounded (rotate at 1 MiB)
    nn::fs::FileHandle h{};
    if (gFs.OpenFile(&h, kLogPath, nn::fs::OpenMode_Read).IsSuccess()) {
        long size = 0;
        gFs.GetFileSize(&size, h);
        gFs.CloseFile(h);
        if (size > (1 << 20)) {
            static char old[96];
            snprintf(old, sizeof(old), "%s.old", kLogPath);
            gFs.DeleteFile(old);
            gFs.RenameFile(kLogPath, old);
        }
    }
    writeAppend(kLogPath, gLogBuf, gLogLen);
    gLogLen = 0;
}

bool fileExists(const char* path) {
    if (!gFsOk) return false;
    nn::fs::FileHandle h{};
    if (gFs.OpenFile(&h, path, nn::fs::OpenMode_Read).IsFailure()) return false;
    gFs.CloseFile(h);
    return true;
}

// Static buffer (no heap use from the module). Valid until the next call.
char gFileBuf[64 * 1024];
char* readFile(const char* path, long* outSize, long maxSize) {
    if (!gFsOk) return nullptr;
    nn::fs::FileHandle h{};
    if (gFs.OpenFile(&h, path, nn::fs::OpenMode_Read).IsFailure()) return nullptr;
    long size = 0;
    if (maxSize > (long)sizeof(gFileBuf) - 1) maxSize = sizeof(gFileBuf) - 1;
    if (gFs.GetFileSize(&size, h).IsFailure() || size <= 0 || size > maxSize) {
        gFs.CloseFile(h);
        return nullptr;
    }
    if (gFs.ReadFile(h, 0, gFileBuf, size).IsFailure()) {
        gFs.CloseFile(h);
        return nullptr;
    }
    gFileBuf[size] = 0;
    gFs.CloseFile(h);
    *outSize = size;
    return gFileBuf;
}

// V0 SD reader: dormant, never invoked by hkMain or an installed hook.
// Uses the already mounted game-context FsApi, with independent stat/error gates.
using V0Stat = nn::Result (*)(nn::fs::DirectoryEntryType*, const char*);
groove::v0::Loader gV0Packages;
V0Stat gV0Stat=nullptr;
// Horizon FS module 2, description 1 = PathNotFound (0x202). Every other
// failure stays unknown/blocked; OpenFile failure is NEVER treated as absence.
int v0Path(const char* relative,char (&path)[192],bool file) {
    if(!gFsOk || !gV0Stat || !relative || !*relative || *relative=='/' || strstr(relative,"..") || strstr(relative,"//"))return -1;
    for(const char* c=relative;*c;++c)if(!((*c>='a'&&*c<='z')||(*c>='0'&&*c<='9')||*c=='.'||*c=='-'||*c=='/'))return -1;
    int n=snprintf(path,sizeof(path),"ht3sd:/groove/%s",relative);if(n<=0 || n>=int(sizeof(path)))return -1;
    // Stat every traversed component, requiring directories before the leaf.
    for(char* c=path+7;;++c)if(*c=='/' || !*c){
        char saved=*c;*c=0;nn::fs::DirectoryEntryType type{};auto rc=gV0Stat(&type,path);*c=saved;
        if(rc.IsFailure())return rc.GetInnerValueForDebug()==0x202 ? 0 : -1;
        bool leaf=saved==0;
        if(!leaf && type!=nn::fs::DirectoryEntryType_Directory)return -1;
        if(leaf)return !file || type==nn::fs::DirectoryEntryType_File ? 1 : -1;
    }
}
bool v0Read(void*,const char* relative,char* out,unsigned cap,unsigned* got){
    char path[192];if(!out||!got||v0Path(relative,path,true)!=1)return false;
    nn::fs::FileHandle h{};if(gFs.OpenFile(&h,path,nn::fs::OpenMode_Read).IsFailure())return false;
    long size=0,after=0;bool ok=!gFs.GetFileSize(&size,h).IsFailure()&&size>0&&size<=long(cap);
    if(ok)ok=!gFs.ReadFile(h,0,out,size).IsFailure()&&!gFs.GetFileSize(&after,h).IsFailure()&&after==size;
    gFs.CloseFile(h);if(ok)*got=unsigned(size);return ok;
}
int v0Probe(void*,const char* relative){char path[192];return v0Path(relative,path,false);}
// Explicit integration entry, still disconnected from menu/constructor hooks.
// It neither mounts SD, creates directories, writes an engine marker nor enables slots.
bool v0MultiBusy();
extern void* gHt3Stage;
extern "C" __attribute__((used,retain,visibility("default"))) bool groove_v0_load_sd_levels(){
    groove::TryLease lease(gInputBusy);if(!lease.held||!gFsOk||gHt3Stage||v0MultiBusy()||groove::v0::groove_v0_session_active())return false;
    if(!gV0Stat)gV0Stat=reinterpret_cast<V0Stat>(hk::ro::lookupSymbol("_ZN2nn2fs12GetEntryTypeEPNS0_18DirectoryEntryTypeEPKc"));
    if(!gV0Stat)return false;
    return gV0Packages.load({nullptr,v0Read,v0Probe},false);
}

// Multi timeline resolution (v0.5.0): .gtf first, then .gtl.
// Short path sd:/groove/multi.* is tried before the historic
// sd:/groove/stages/multi/multi.* location (backward compatible).
const char* kMultiCand[] = {
    "ht3sd:/groove/multi.gtf",
    "ht3sd:/groove/stages/multi/multi.gtf",
    "ht3sd:/groove/multi.gtl",
    "ht3sd:/groove/stages/multi/multi.gtl",
};
constexpr int kMultiCandN = 4;
const char* gMultiUsedPath = nullptr;

char* readMultiFile(long* outSize) {
    gMultiUsedPath = nullptr;
    for (int i = 0; i < kMultiCandN; i++) {
        if (!fileExists(kMultiCand[i])) continue;
        char* t = readFile(kMultiCand[i], outSize, 60 * 1024);
        if (t) {
            gMultiUsedPath = kMultiCand[i];
            return t;
        }
    }
    return nullptr;
}

// reads a non-negative decimal (save counters); no libc (errno) involved
int jsonInt(const char* p) {
    while (*p == ' ') p++;
    int v = 0;
    for (; *p >= '0' && *p <= '9' && v < 100000000; p++) v = v * 10 + (*p - '0');
    return v;
}

// ---------------------------------------------------------------- selection
struct Selection {
    bool ok = false;
    int mode = -9, world = -99, col = -99, row = -99, curIdx = -99;
    unsigned flags = 0xFFFFFFFF;
};

Selection gLastMapSel;

Selection readSelection() {
    Selection s;
    uint8_t* mgr = reinterpret_cast<uint8_t*>(gBase + oManager);
    s.mode = at<int32_t>(mgr, 0x2904);
    void* flagsPtr = at<void*>(mgr, 0x3AA0);
    if (flagsPtr) s.flags = *reinterpret_cast<uint16_t*>(flagsPtr);
    if (s.mode < 0 || s.mode > 1) return s;
    s.world = at<int8_t>(mgr, 0xB98 + s.mode);
    s.col = at<int8_t>(mgr, 0xB9A + s.mode);
    s.row = at<int8_t>(mgr, 0xB9C + s.mode);
    s.curIdx = at<int16_t>(mgr, 0xBA0 + 2 * s.mode);
    s.ok = true;
    gLastMapSel = s;
    return s;
}

// Last mode-0/1 map cursor. stashName / the prologue ctor run before the HT2
// ctor; if mode is briefly out of 0..1 at that moment, fall back to this.
Selection effectiveSel() {
    Selection s = readSelection();
    if (s.ok) return s;
    return gLastMapSel;
}

// ---------------------------------------------------------------- state
groove::Timeline gTl;
void* gHt3Stage = nullptr;     // HT2 stage object that runs HT3 this time
struct RunStats {
    int started = 0, gameplayStarted = 0, reachedEnd = 0, finished = 0, stopped = 0;
    int hoopsSent = 0, commentsSent = 0, bgSent = 0, resultsMode = 0, saved = 0;
    int partsStarted = 0, partReached[groove::kMaxParts] = {}, partHoops[groove::kMaxParts] = {};
} gRun;


// ---------------------------------------------------------------- game calls
using VoidStage = void (*)(void*);
inline void tWait(void* th, int ticks) { fn<void (*)(void*, int)>(oWait)(th, ticks); }
inline bool tStop(void* th) { return fn<bool (*)(void*)>(oStop)(th); }
inline int tPush(void* th) { return fn<int (*)(void*)>(oPush)(th); }
inline void tPop(void* th) { fn<int (*)(void*)>(oPop)(th); }
inline void fadeScreen(void* st, int ticks, float a) { fn<void (*)(void*, int, float)>(oFadeScreen)(st, ticks, a); }
inline void initSm(void* st, unsigned id, unsigned mode) { fn<void (*)(void*, unsigned, unsigned)>(oInitSm)(st, id, mode); }
inline void playAnim(void* layout, const char* name) { fn<void (*)(void*, const char*)>(oPlayAnim)(layout, name); }

// Waits `ticks` in chunks of at most one bar, checking the stop flag like the
// native threads do. Returns false when the stage asked us to stop.
bool waitTicks(void* th, int ticks) {
    while (ticks > 0) {
        int step = ticks > 1920 ? 1920 : ticks;
        tWait(th, step);
        if (tStop(th)) return false;
        ticks -= step;
    }
    return !tStop(th);
}

// Spawns a game thread running `body(stage, thread)` exactly like the native
// HT2 code spawns its member threads (same allocator, ctor, vtable, trampoline).
void spawn(void* stage, void* parent, void (*body)(void*, void*)) {
    uint8_t* th = fn<uint8_t* (*)(unsigned long)>(oNew)(0x298);
    if (!th) { logf("spawn: native allocation failed"); return; }
    void* runner = at<void*>(stage, sRunner);
    int idx = at<int32_t>(stage, sThreadIdx);
    uintptr_t vt = gBase + oThreadVtbl;
    at<uintptr_t>(th, 0) = vt + 0x10;
    at<uintptr_t>(th, 0x18) = vt + 0x40;
    fn<void (*)(void*, void*, int, uintptr_t, void*, void*)>(oThreadCtor)(th, runner, idx, gBase + oPmfTramp,
                                                                          th + 0x280, parent);
    at<uintptr_t>(th, 0) = vt + 0x10;
    at<uintptr_t>(th, 0x18) = vt + 0x40;
    at<uintptr_t>(th, 0x280) = reinterpret_cast<uintptr_t>(stage) + sSub;  // *(this+0x10) == stage
    at<uintptr_t>(th, 0x288) = reinterpret_cast<uintptr_t>(body);
    at<uintptr_t>(th, 0x290) = 0;
    fn<void (*)(void*, void*)>(oAppend)(runner, th);
}

// ---------------------------------------------------------------- threads
// One instantiation per part, so a thread never depends on when it is first
// scheduled (the part index is baked into its body function).
template <int pi>
void cueThread(void* stage, void* th) {
    void* scene = reinterpret_cast<uint8_t*>(stage) + sScene;
    const groove::Part& part = gTl.parts[pi];
    int cur = 0;
    for (int i = part.cueFirst; i < part.cueFirst + part.cueCount; i++) {
        const groove::Event& e = gTl.cue[i];
        if (e.tick > cur) {
            if (!waitTicks(th, e.tick - cur)) { gRun.stopped = 1; tPop(th); return; }
            cur = e.tick;
        }
        if (e.op == groove::Op::Hoop) {
            fn<void (*)(void*, void*, int)>(oHoop)(scene, th, e.mask);
            gRun.hoopsSent++;
            gRun.partHoops[pi]++;
            if (tStop(th)) { gRun.stopped = 1; tPop(th); return; }
        } else if (e.op == groove::Op::Comment) {
            fn<void (*)(void*, const char*)>(oSetComment)(stage, e.str);
            gRun.commentsSent++;
        }
    }
    waitTicks(th, gTl.ticksPerBeat);  // native cue thread ends one beat after its last hoop
    tPop(th);
}

template <int pi>
void bgThread(void* stage, void* th) {
    const groove::Part& part = gTl.parts[pi];
    int cur = 0;
    for (int i = part.bgFirst; i < part.bgFirst + part.bgCount; i++) {
        const groove::Event& e = gTl.bg[i];
        if (e.tick > cur) {
            if (!waitTicks(th, e.tick - cur)) { tPop(th); return; }
            cur = e.tick;
        }
        if (e.op == groove::Op::LayoutAnim) {
            void* layout = at<void*>(stage, sLayout);
            if (layout) playAnim(layout, e.str);
        } else if (e.op == groove::Op::Stars) {
            fn<void (*)(void*)>(oStars)(stage);
        }
        gRun.bgSent++;
    }
    waitTicks(th, gTl.ticksPerBeat);
    tPop(th);
}

void latencyThread(void* stage, void* th) {
    // Same as native 0x42B2B0: shift this thread's clock by the stage latency.
    int lat = fn<int (*)(void*)>(oLatency)(stage);
    at<int32_t>(th, 0x10) -= lat;
    tPop(th);
}

// Equivalent of native control 0x429330 (caller pushed; we pop at the end).
void control(void* stage, void* th) {
    void* scene = reinterpret_cast<uint8_t*>(stage) + sScene;
    fn<void (*)(void*, int)>(oInitGameplay)(stage, 0);
    fn<VoidStage>(oEnablePause)(stage);
    fn<void (*)(void*, int)>(oSetInput)(scene, 1);
    tPush(th);
    fn<int (*)(void*, void*, int, int)>(oWaitAudio)(stage, th, -1, 0);
    if (tStop(th)) { gRun.stopped = 1; tPop(th); return; }
    fn<VoidStage>(oStartGameplay)(stage);
    fn<VoidStage>(oUnk138D20)(stage);
    at<float>(stage, sFloat5BE8) = 1.0f;
    // v0.2: one gameplay session, N songs back to back. Each part starts its
    // BGM exactly like the native control does (initSm + playBgm with the
    // 0x3C0 lead-in; playBgm itself waits until the stream is loaded) and gets
    // fresh cue/bg/latency threads whose clock starts right after playBgm.
    // No endGameplay / results / scene change between parts.
    for (int p = 0; p < gTl.partCount; p++) {
        const groove::Part& part = gTl.parts[p];
        initSm(stage, part.bgm, 1);
        tPush(th);
        fn<void (*)(void*, void*, unsigned, int, int, float, float)>(oPlayBgm)(stage, th, part.bgm, 0x3C0, 0, 1.0f, 1.0f);
        if (tStop(th)) { gRun.stopped = 1; tPop(th); return; }
        gRun.gameplayStarted = 1;
        gRun.partsStarted = p + 1;
        logf("control: part %d bgm=%d started (hoops=%d)", p, part.bgm, part.hoops);
        using Body = void (*)(void*, void*);
        static const Body kCue[groove::kMaxParts] = {cueThread<0>, cueThread<1>, cueThread<2>, cueThread<3>};
        static const Body kBg[groove::kMaxParts] = {bgThread<0>, bgThread<1>, bgThread<2>, bgThread<3>};
        spawn(stage, th, kCue[p]);
        spawn(stage, th, kBg[p]);
        spawn(stage, th, latencyThread);
        if (p + 1 < gTl.partCount) {
            const groove::Part& nx = gTl.parts[p + 1];
            if (!waitTicks(th, part.preload)) { gRun.stopped = 1; tPop(th); return; }
            // same order as the native worker: initSm(id,1) ... prepareSm(id)
            initSm(stage, nx.bgm, 1);
            if (!waitTicks(th, 10)) { gRun.stopped = 1; tPop(th); return; }
            fn<void (*)(void*, unsigned)>(oPrepareSm)(stage, nx.bgm);
            int rest = part.next - part.preload - 10;
            if (rest > 0 && !waitTicks(th, rest)) { gRun.stopped = 1; tPop(th); return; }
            gRun.partReached[p] = 1;
        }
    }
    if (!waitTicks(th, gTl.endTick)) { gRun.stopped = 1; tPop(th); return; }
    gRun.partReached[gTl.partCount - 1] = 1;
    gRun.reachedEnd = 1;
    fn<VoidStage>(oEndGameplay)(stage);
    fn<void (*)(void*, int)>(oSetInput)(scene, 0);
    fn<VoidStage>(oDisablePause)(stage);
    fadeScreen(stage, gTl.endFade, 0.0f);
    if (!waitTicks(th, gTl.finishTick - gTl.endTick)) { gRun.stopped = 1; tPop(th); return; }
    fn<VoidStage>(oFinish)(stage);
    gRun.finished = 1;
    tPop(th);
}

bool writeSave();
bool patchHt3Sky(void* stage, const char* when);

// Equivalent of the native worker 0x428EF0, always on the non-practice path.
void ht3Worker(void* stage, void* th) {
    gRun.started = 1;
    logf("worker: %s start stage=%p thread=%p parts=%d", gStage->name, stage, th, gTl.partCount);
    flushLog();  // v0.1.2: a hang later still leaves this on the SD
    initSm(stage, gTl.bgm, 1);
    fadeScreen(stage, 0, 0.0f);
    tPush(th);
    fn<void (*)(void*, void*, int, int)>(oWaitReady)(stage, th, 0, -1);
    if (tStop(th)) { gRun.stopped = 1; tPop(th); return; }
    // type_00/main SPR is valid only after waitReady. ht3Worker also runs
    // Double Hell, so gate on the ht3 stage only.
    if (gStage && gStage->name && !strcmp(gStage->name, "ht3")) {
        if (!patchHt3Sky(stage, "after waitReady"))
            logf("ht3 sky: still no SPR after waitReady");
        flushLog();
    }
    static const char kSelfish[] = "selfish";
    static const char kBgTutorial[] = "BgTutorial";
    fn<void (*)(void*, void*, int, const char*)>(oSceneSetup)(stage, reinterpret_cast<uint8_t*>(stage) + sScene, 0,
                                                              kSelfish);
    at<float>(stage, sFloat2B1C) = 0.75f;
    if (void* layout = at<void*>(stage, sLayout)) playAnim(layout, kBgTutorial);
    fn<void (*)(void*, unsigned)>(oPrepareSm)(stage, gTl.bgm);
    fadeScreen(stage, 0xF0, 1.0f);
    tWait(th, 0x3C0);
    if (tStop(th)) { gRun.stopped = 1; tPop(th); return; }
    tPush(th);
    control(stage, th);
    if (tStop(th)) { gRun.stopped = 1; tPop(th); return; }
    gRun.resultsMode = gTl.resultsMode && !gNoNativeResults;
    logf("worker: %s end parts=%d/%d reached=%d finished=%d hoops=%d comments=%d bg=%d stage_mode=%d -> %s", gStage->name,
         gRun.partsStarted, gTl.partCount, gRun.reachedEnd,
         gRun.finished, gRun.hoopsSent, gRun.commentsSent, gRun.bgSent, at<int>(stage, 0x29E4),
         gRun.resultsMode ? "native toResults (as HT2)" : "return to previous scene");
    gRun.saved = writeSave() ? 1 : 0; // Retry from the stage dtor only if this attempt failed.
    flushLog();
    if (gRun.resultsMode) {
        // Exactly what the native HT2 worker does after its control thread
        // (0x429028: bl toResults). Shows the native results screen.
        fn<VoidStage>(oToResults)(stage);
    } else {
        // Clean return like the game's own "back" path (0x133024): set the
        // "returning" flag, schedule the previous scene (ctx+8) and request
        // the scene change. (v0.1.0/0.1.1 called 0x130500(ctx,0) WITHOUT a
        // next scene -> black screen.)
        void* ctx = at<void*>(stage, sCtx);
        uint32_t* flags = *reinterpret_cast<uint32_t**>(gBase + oManager + 0x3AA0);
        if (flags) *flags |= 1;
        fn<void (*)(void*, int, void*)>(oSetNextScene)(ctx, at<int>(ctx, 8), nullptr);
        fn<void (*)(void*, int)>(oExitToMenu)(ctx, 1);
    }
    tPop(th);
}

struct CustomSaveFs {
    bool exists(const char* p) { return fileExists(p); }
    bool rename(const char* a,const char* b) { return gFs.RenameFile(a,b).IsSuccess(); }
};
bool persistCustomSave(const char* path,const char* data,int size,int capacity) {
    if (size<0 || size>=capacity) { logf("save: formatted data exceeds buffer"); return false; }
    char tmp[160],backup[160];
    for (unsigned i=0;i<64;++i) {
        int a=snprintf(tmp,sizeof(tmp),"%s.tmp.%u",path,i);
        int b=snprintf(backup,sizeof(backup),"%s.bak.%u",path,i);
        if (a<0 || b<0 || a>=(int)sizeof(tmp) || b>=(int)sizeof(backup)) return false;
        if (fileExists(tmp) || fileExists(backup)) continue;
        if (gFs.CreateFile(tmp,0).IsFailure() || !writeAppend(tmp,data,size)) {
            logf("save: temporary write failed; previous save retained"); return false;
        }
        CustomSaveFs fs;
        auto result=groove::replaceCustomSave(fs,path,tmp,backup);
        logf("save: replacement status=%d backup=%s",(int)result,backup);
        return result==groove::SaveReplace::Committed;
    }
    logf("save: backup slots full; no files removed"); return false;
}

// ---------------------------------------------------------------- save
bool writeSave() {
    groove::TryLease lease(gInputBusy);
    if (!lease.held) { logf("save: input busy; not saved, destructor may retry"); return false; }
    if (!gFsOk || !gLogWritable) { logf("save: SD unavailable; not saved"); return false; }
    snprintf(gSavePath, sizeof(gSavePath), kSaveFmt, gStage->name);
    snprintf(gSaveTmpPath, sizeof(gSaveTmpPath), "%s.tmp", gSavePath);
    const char* kSavePath = gSavePath;
    const char* kSaveTmpPath = gSaveTmpPath;
    int plays = 0, completions = 0, aborted = 0;
    long size = 0;
    if (char* old = readFile(kSavePath, &size, 4096)) {
        const char* p;
        if ((p = strstr(old, "\"plays\":"))) plays = jsonInt(p + 8);
        if ((p = strstr(old, "\"completions\":"))) completions = jsonInt(p + 14);
        if ((p = strstr(old, "\"aborted\":"))) aborted = jsonInt(p + 10);
    }
    plays++;
    if (gRun.finished) completions++; else aborted++;
    char buf[1024];
    int n = snprintf(buf, sizeof(buf),
                     "{\n  \"format\": \"groove-save/1\",\n  \"stage\": \"%s\",\n  \"module\": \"" GROOVE_HT3_VERSION "\",\n"
                     "  \"plays\": %d,\n  \"completions\": %d,\n  \"aborted\": %d,\n"
                     "  \"last\": {\"gameplay_started\": %d, \"parts_started\": %d, \"parts_total\": %d, \"part_hoops\": [%d, %d, %d, %d],"
                     " \"reached_end\": %d, \"finished\": %d, \"hoops_sent\": %d,"
                     " \"comments_sent\": %d, \"bg_events\": %d, \"results\": \"%s\"},\n"
                     "  \"medal\": null,\n  \"note\": \"medal/score not tracked here yet; with native results the game shows it (stored in HT2 record)\"\n}\n",
                     gStage->name, plays, completions, aborted, gRun.gameplayStarted, gRun.partsStarted, gTl.partCount,
                     gRun.partHoops[0], gRun.partHoops[1], gRun.partHoops[2], gRun.partHoops[3], gRun.reachedEnd, gRun.finished,
                     gRun.hoopsSent, gRun.commentsSent, gRun.bgSent, gRun.resultsMode ? "native" : "exit");
    bool committed=persistCustomSave(kSavePath,buf,n,sizeof(buf));
    if (committed)
        logf("save: plays=%d completions=%d aborted=%d",plays,completions,aborted);
    return committed;
}

// ---------------------------------------------------------------- HT3 custom background (LayeredFS type_01)
// The native loader reads romfs:graph/scene/ring/type_01/bg.{spr,tex};
// Atmosphere substitutes those files if they exist on the SD. We cannot tell
// a LayeredFS file from the original through the romfs mount, so we look at
// the SD path with the same fileExists() used for DISABLE/FORCE.
constexpr const char* kCustomType01Spr =
    "ht3sd:/atmosphere/contents/0100D9F01D474000/romfs/graph/scene/ring/type_01/bg.spr";
constexpr const char* kCustomType01Tex =
    "ht3sd:/atmosphere/contents/0100D9F01D474000/romfs/graph/scene/ring/type_01/bg.tex";

// Set true only for the HT3 object, and only while orig() of the HT2 ctor
// runs (SceneRing is constructed inside orig()). Always cleared afterwards.
// Native HT2 / HT1 / Double Hell never set this flag.
bool gForceRingType01Bg = false;

bool hasCustomType01Bg() {
    // Require both files so the game never opens type=2 with a missing .spr or .tex.
    return fileExists(kCustomType01Spr) && fileExists(kCustomType01Tex);
}

// ---------------------------------------------------------------- HT3 sky recolor (GRO-7, v0.4.0)
// v0.3.9 hardware: the 5 palette indices were patched and the sky stayed
// blue/white. The HT2/HT3 sky is *painted pixels* in type_00/main.tex,
// atlas rect [57] (15,15,1364,783), drawn by 9 keyframe records of SPR
// section 1 (60 bytes each; count at spr+0x08, pointer at spr+0x40 after
// relocation). Keyframe layout (read at 0x4FEE90):
//   +0x00 atlas rect, +0x18 multiply colour idx (-1 = white), +0x1C add
//   colour idx, +0x20 alpha byte. 0x4F9D00 -> 0x4F3480(layout, idx, alpha)
//   returns the multiply colour in x8 (pal at spr+0x70, count spr+0x20).
// The [57] keyframes all use idx -1, which is why no pal entry could ever
// tint them. v0.4.0 (HT3 only, gSkyRemap):
//   1. on the loaded type_00/main SPR, set +0x18 of every atlas-[57]
//      keyframe from -1 to kSkyMulIdx (0x200: >= pal count, <= 0x3FF so 0x4F9D00
//      still routes it to 0x4F3480; native code returns white for it);
//   2. 0x4F3480 is replaced by an exact copy that returns the crimson
//      multiply for kSkyMulIdx while gSkyRemap is set, white otherwise.
// Actors, rings, stars ([49]/[50]/[51]/[58] etc.) and atlas [54] (a separate
// 736x735 plate, 1 keyframe; not confirmed to be sky) are not touched.
constexpr int kSkyAtlas = 57;
constexpr int kSkyMulIdx = 0x200;  // mid-range: a 0x4F9D00 remap shift stays inside 0..0x3FF
constexpr float kSkyMulR = 1.00f, kSkyMulG = 0.16f, kSkyMulB = 0.16f;
bool gSkyPatched = false;
bool gSkyRemap = false;
int gSkyTinted = 0;
volatile int gSkyMulHits = 0;  // colour lookups answered with the crimson multiply (no logging in the draw path)

uint8_t* sprSection(uint8_t* spr, int k) {
    uint64_t raw = *reinterpret_cast<uint64_t*>(spr + 0x38 + 8 * k);
    if (raw >= 0x10000ull) return reinterpret_cast<uint8_t*>(raw);
    if (raw >= 0x80 && raw < 0x400000ull) return spr + static_cast<size_t>(raw);
    return nullptr;
}

bool patchSprSky(uint8_t* spr, const char* when) {
    if (gSkyPatched) return true;
    if (!spr || reinterpret_cast<uintptr_t>(spr) < 0x10000) return false;
    uint32_t nRect = *reinterpret_cast<uint32_t*>(spr + 0x04);
    uint32_t nKey = *reinterpret_cast<uint32_t*>(spr + 0x08);
    uint32_t nPal = *reinterpret_cast<uint32_t*>(spr + 0x20);
    if (nRect <= (uint32_t)kSkyAtlas || nRect > 4096 || nKey == 0 || nKey > 8192 || nPal >= (uint32_t)kSkyMulIdx)
        return false;
    int32_t* rects = reinterpret_cast<int32_t*>(sprSection(spr, 0));
    uint8_t* keys = sprSection(spr, 1);
    if (!rects || !keys) return false;
    const int32_t* r = rects + kSkyAtlas * 4;
    if (r[0] != 15 || r[1] != 15 || r[2] != 1364 || r[3] != 783) return false;  // not type_00/main
    int tinted = 0, already = 0, other = 0, plate54 = 0;
    for (uint32_t i = 0; i < nKey; i++) {
        uint8_t* k = keys + (size_t)i * 60;
        int32_t atlas = *reinterpret_cast<int32_t*>(k);
        if (atlas == 54) plate54++;
        if (atlas != kSkyAtlas) continue;
        int32_t* mul = reinterpret_cast<int32_t*>(k + 0x18);
        if (*mul == kSkyMulIdx) already++;
        else if (*mul == -1) { *mul = kSkyMulIdx; tinted++; }
        else other++;
    }
    gSkyTinted = tinted + already;
    gSkyPatched = gSkyTinted > 0;
    logf("ht3 sky: %s: type_00/main atlas[57] keyframes tinted=%d already=%d other=%d (atlas[54] keyframes=%d untouched) "
         "mul=(%d,%d,%d)/100 idx=0x%X keys=%u pal=%u spr=%p",
         when, tinted, already, other, plate54, (int)(kSkyMulR * 100), (int)(kSkyMulG * 100), (int)(kSkyMulB * 100),
         kSkyMulIdx, nKey, nPal, spr);
    return gSkyPatched;
}

// Exact copy of 0x4F3480 + the HT3 sky index. out = x8 of the original.
void mulColorImpl(void* layout, int idx, int alpha, float* out) {
    const float* lut = *reinterpret_cast<const float* const*>(gBase + oByteToFloat);
    int a = alpha < 0 ? 0 : alpha;
    if (a >= 0xFF) a = 0xFF;
    out[0] = 1.f; out[1] = 1.f; out[2] = 1.f; out[3] = lut[a];
    if (idx < 0 || !layout) return;
    uint8_t* spr = at<uint8_t*>(layout, 8);
    if (!spr) return;
    int32_t n = *reinterpret_cast<int32_t*>(spr + 0x20);
    if (n > idx) {
        const uint8_t* c = *reinterpret_cast<uint8_t* const*>(spr + 0x70) + (size_t)idx * 4;
        out[0] = lut[c[0]];
        out[1] = lut[c[1]];
        out[2] = lut[c[2]];
        return;
    }
    if (idx == kSkyMulIdx && gSkyRemap) {
        out[0] = kSkyMulR; out[1] = kSkyMulG; out[2] = kSkyMulB;
        gSkyMulHits = gSkyMulHits + 1;
    }
}

}  // namespace
extern "C" __attribute__((used, visibility("hidden"))) void grooveMulColorImpl(void* l, int i, int a, float* out) {
    mulColorImpl(l, i, a, out);
}
extern "C" void grooveMulColorShim(void*, int, int);
asm(".text\n"
    ".balign 4\n"
    ".global grooveMulColorShim\n"
    ".hidden grooveMulColorShim\n"
    ".type grooveMulColorShim, %function\n"
    "grooveMulColorShim:\n"
    "    mov x3, x8\n"
    "    b grooveMulColorImpl\n"
    ".size grooveMulColorShim, .-grooveMulColorShim\n");
namespace {
HkReplace<void, void*, int, int> mulColorHook{ grooveMulColorShim };

bool patchHt3Sky(void* stage, const char* when) {
    if (gSkyPatched) return true;
    if (!stage) return false;
    uint8_t* scene = reinterpret_cast<uint8_t*>(stage) + sScene;
    uint8_t* layout = scene + kMainLayoutInScene;
    uint8_t* spr = at<uint8_t*>(layout, 8);
    if (!spr || reinterpret_cast<uintptr_t>(spr) < 0x10000) {
        logf("ht3 sky: %s: SPR not yet loaded (layout=%p spr=%p)", when, layout, spr);
        return false;
    }
    if (!patchSprSky(spr, when)) {
        logf("ht3 sky: %s: type_00/main atlas[57] keyframes not found spr=%p", when, spr);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------- intro title (GRO-9)
// 0 = off (native text). 1 = HT3 (gtl title, else trailing "2" -> "3" on I_RING_01).
// 2 = Double Hell with a `title` line. 3 = Multi with a `title` line.
// Set from the ctor once the tile has matched, cleared in the matching dtor.
// v0.3.6: the intro card calls 0x206D00 (which calls cachedName and stashes
// the pointer at **(0xD99D60)) BEFORE the HT2 ctor, while gTitleMode is still
// 0, so the hook never rewrote the title. The overworld map painter at
// 0x1D6AF4 also calls cachedName(1,41) for BOTH the HT3 and native HT2 tiles
// (they share I_RING_01), so we must not retitle based on the cursor alone.
// We hook 0x206D00 (launch/intro/results stash) and use mgr col/row there:
//   col=9,row=0 = HT3 -> retitle; col=1 (native HT2) is left alone.
int gTitleMode = 0;
bool gTitleLogged = false;
bool gInTitleStash = false;  // only set around 0x206D00
char gTitleBuf[96];
// GRO-11: native cache pointers (orig 0x2BD0 results), used to restore the
// prologue stash when it still holds one of our strings from a previous stage.
const char* gNative41 = nullptr;
const char* gNative67 = nullptr;
int gStashKind = -1, gStashIndex = -1;
bool gTTLoaded = false;  // GRO-11 tile titles cached from the .gtl headers
constexpr const char* kRemix21Title = "Remix 21";  // GRO-12 default Multi title
// GRO-12 prologue art / jingle override state (functions further below)
char gProloguePath[128];
const char* gNativePath = nullptr;
int gNativeJingle = -1;
bool gJingleOverridden = false;
int gOurJingle = -1;
char** stashPathSlot();
int* stashJingleSlot();

void clearTitleMode() { gTitleMode = 0; gTitleLogged = false; gInTitleStash = false; }

bool isHt3Sel(const Selection& s) { return s.ok && s.col == 9 && s.row == 0; }
bool isDhSel(const Selection& s) { return s.ok && s.col == 9 && s.row == 1; }
bool isMultiSel(const Selection& s) { return s.ok && s.col == 9 && s.row == 4; }

const char* copyTitle(const char* s) {
    if (!s) return s;
    size_t n = 0;
    while (s[n] && n + 1 < sizeof(gTitleBuf)) ++n;
    memcpy(gTitleBuf, s, n);
    gTitleBuf[n] = 0;
    return gTitleBuf;
}

const char* retitleIRing01(const char* origMsg) {
    // Only use gTl.title when the ctor has already selected this stage
    // (gTitleMode 1/2). Before ctor, gTl may still hold a previous stage's
    // title (e.g. Double Hell), so the intro stash uses the 2->3 fallback.
    if (gTl.title[0] && (gTitleMode == 1 || gTitleMode == 2)) return copyTitle(gTl.title);
    bool ht3 = gTitleMode == 1 || (gInTitleStash && isHt3Sel(effectiveSel()));
    if (!ht3 || !origMsg) return origMsg;
    size_t n = 0;
    while (origMsg[n] && n + 1 < sizeof(gTitleBuf)) ++n;
    if (n == 0 || origMsg[n - 1] != '2') return origMsg;
    memcpy(gTitleBuf, origMsg, n);
    gTitleBuf[n - 1] = '3';
    gTitleBuf[n] = 0;
    return gTitleBuf;
}

void logTitleOnce(const char* kind, const char* was, const char* now) {
    if (gTitleLogged) return;
    gTitleLogged = true;
    logf("ht3 title: '%s' (%s, was '%s')", now ? now : "", kind, was ? was : "");
}

// The visible intro card is the common prologue (0x206DE0), which copies
// **(0xD99D60) through 0x4F07B0 into the card. That ctor runs as its own
// stage, BEFORE the HT2 ctor, so gTitleMode is still 0. v0.3.7 hooked
// 0x206D00 but only rewrote/logged when isHt3Sel(readSelection()) at that
// instant; on hardware there were zero "ht3 title:" lines, so that body
// never ran (wrong/unreadable mgr state, unexpected kind/index, or this
// path did not go through the hook). We rewrite the stash here, just
// before the prologue copies it, and log the mgr state either way.
char** stashSlot() {
    if (!gBase) return nullptr;
    char*** p = reinterpret_cast<char***>(gBase + oStashSlot);
    return p ? *p : nullptr;
}

void rewriteStashIfHt3(const char* why) {
    char** slot = stashSlot();
    const char* was = (slot && *slot) ? *slot : nullptr;
    Selection s = effectiveSel();
    bool want = isHt3Sel(s) || gTitleMode == 1;
    gInTitleStash = want;
    const char* now = (want && was) ? retitleIRing01(was) : was;
    if (want && slot && now) *slot = const_cast<char*>(now);
    logf("ht3 title: %s mode=%d col=%d row=%d want=%d slot=%p was='%.48s' now='%.48s'",
         why, s.mode, s.col, s.row, (int)want, slot, was ? was : "", now ? now : "");
    if (want && now && now != was) logTitleOnce(why, was, now);
    gInTitleStash = false;
    if (ensureFs()) flushLog();
}

// Replacement for 0x216530. Signature: void* ringTypeEntry(int type);
void* ringTypeEntry(int type) {
    if (gForceRingType01Bg) type = kRingType01;
    return reinterpret_cast<void*>(gBase + kRingPathTable + static_cast<uintptr_t>(type) * 0x18);
}

HkReplace<void*, int> ringTypeHook{ ringTypeEntry };

// ---------------------------------------------------------------- hooks
// HT2 constructor (only reached through CSTAGE_StageCreator case 67). We hook
// the ctor instead of CSTAGE_StageCreator because the user's Orochi logger
// (subsdk1) already references/hooks the creator.
HkTrampoline ht2CtorHook = [](TrampolineStatic(), void* self, void* seq, int b, int c, int d, int e,
                              int f) -> void* {
    // SceneRing is constructed inside orig(), so the type_01/bg decision and
    // the timeline match must run *before* orig(). The flag is always cleared
    // afterwards so a later native HT2/Double Hell ctor cannot leak it.
    if (!gActive) {
        void* r = orig(self, seq, b, c, d, e, f);
        if (gLogOnly && ensureFs()) flushLog();
        return r;
    }
    void* stage = self;
    // Do not replace a timeline while its owner (and native children) is live.
    if (gHt3Stage) return orig(self, seq, b, c, d, e, f);
    groove::TryLease sourceLease(gInputBusy);
    if (!sourceLease.held) return orig(self, seq, b, c, d, e, f);
    gHt3Stage = nullptr;
    gForceRingType01Bg = false;
    gSkyPatched = false;
    gSkyRemap = false;
    gSkyMulHits = 0;
    clearTitleMode();
    gTTLoaded = false;  // GRO-11: re-read tile titles on the next map refresh
    if (!ensureFs()) return orig(self, seq, b, c, d, e, f);  // no SD -> native HT2, type_00
    Selection s = readSelection();
    logf("HT2 ctor stage=%p seq=%p args=(%d,%d,%d,%d,%d) | mgr mode=%d world=%d col=%d row=%d cur=%d flags=0x%x",
         stage, seq, b, c, d, e, f, s.mode, s.world, s.col, s.row, s.curIdx, s.flags);
    bool willRun = false;
    bool willBeHt3 = false;
    for (int si = 0; si < kStageCount && !willRun; si++) {
        const StageDef& sd = kStages[si];
        bool disabled = fileExists(sd.disable);
        bool forced = fileExists(sd.force);
        long size = 0;
        char* text = disabled ? nullptr : readFile(sd.gtl, &size, 60 * 1024);
        if (!text && !disabled) { logf("stage %s: no timeline", sd.name); continue; }
        bool ok = text && groove::parseTimeline(gTl, text, size);
        bool match = ok && s.ok && s.col == gTl.matchCol && s.row == gTl.matchRow &&
                     (gTl.matchWorld < 0 || s.world == gTl.matchWorld);
        logf("stage %s: timeline %s (%s) parts=%d hoops=%d comments=%d bg=%d end=%d finish=%d match_rule=(%d,%d,%d) disabled=%d forced=%d match=%d",
             sd.name, ok ? "ok" : "INVALID", ok ? "-" : (text ? gTl.error : "missing"), gTl.partCount, gTl.hoops,
             gTl.comments, gTl.bgCount, gTl.endTick, gTl.finishTick, gTl.matchWorld, gTl.matchCol, gTl.matchRow,
             disabled, forced, match);
        if (!disabled && ok && (match || forced)) {
            gStage = &sd;
            gNoNativeResults = fileExists(sd.noNative);
            willRun = true;
            willBeHt3 = (&sd == &kStages[0]);  // "ht3" only; not Double Hell
            gRun = RunStats{};
            gTitleMode = willBeHt3 ? 1 : (gTl.title[0] ? 2 : 0);
            gTitleLogged = false;
            logf("=> %s will run on this stage (%s)%s", sd.name, match ? "tile match" : "FORCE file",
                 gTitleMode == 1 ? (gTl.title[0] ? " title=custom" : " title=2->3")
                                 : (gTitleMode == 2 ? " title=custom" : ""));
        }
    }
    if (!willRun) logf("=> native HT2");
    if (willBeHt3) {
        // v0.3.4–v0.3.7 auto-forced leftover SD type_01/bg over type_00.
        // Official type_01 is a large painted image with no palette; the
        // earlier "custom" files were official copies (the format-15 patch
        // was a misread of atlas x,y). That overlay hid the type_00/main
        // palette sky, so a later pal patch could not change what was shown.
        // Do not load type_01 unless the user drops an ENABLE_TYPE01_BG
        // marker next to the pair (escape hatch; still unofficial pixels).
        bool leftover = hasCustomType01Bg();
        bool enable = leftover && fileExists("ht3sd:/atmosphere/contents/0100D9F01D474000/romfs/graph/scene/ring/type_01/ENABLE_TYPE01_BG");
        gForceRingType01Bg = enable;
        gSkyRemap = true;
        if (enable)
            logf("ht3 bg: type_01 forced (ENABLE_TYPE01_BG present)");
        else if (leftover)
            logf("ht3 bg: leftover type_01 on SD ignored (painted official/custom image would hide the type_00/main sky; delete bg.spr/bg.tex under romfs/graph/scene/ring/type_01, or add ENABLE_TYPE01_BG to force)");
        else
            logf("ht3 bg: original type_00 (no custom type_01/bg on SD)");
    }
    // Flush now: logf only appends to RAM. A crash in orig() or the sky patch
    // would otherwise leave no HT2-ctor lines on the SD (that is what v0.3.5 did).
    flushLog();
    void* r = orig(self, seq, b, c, d, e, f);
    gForceRingType01Bg = false;
    gHt3Stage = willRun ? stage : nullptr;
    if (willBeHt3) {
        if (!patchHt3Sky(stage, "after ctor"))
            logf("ht3 sky: after ctor: deferred until waitReady");
        flushLog();
    }
    if (!willRun) clearTitleMode();
    flushLog();
    return r;
};

HkTrampoline workerHook = [](TrampolineStatic(), void* stage, void* th) -> void {
    if (gHt3Stage && stage == gHt3Stage) {
        ht3Worker(stage, th);
        return;
    }
    orig(stage, th);
};

HkTrampoline dtorHook = [](TrampolineStatic(), void* stage) -> void* {
    if (gHt3Stage && stage == gHt3Stage) {
        logf("%s stage destroyed: started=%d gameplay=%d end=%d finished=%d stopped=%d hoops=%d", gStage->name, gRun.started,
             gRun.gameplayStarted, gRun.reachedEnd, gRun.finished, gRun.stopped, gRun.hoopsSent);
        if (gRun.started && !gRun.saved) writeSave();
        void* result=orig(stage); // Stage teardown only: GE-152 finds later Runner reaping, not a join barrier.
        gHt3Stage = nullptr;
        logf("ht3 sky: stage done: tinted keyframes=%d crimson lookups=%d", gSkyTinted, (int)gSkyMulHits);
        gSkyRemap = false;
        clearTitleMode();
        flushLog();
        return result;
    }
    return orig(stage);
};

// ================================================================ v0.3: multi-game stage on REMIX_21
// The native REMIX_21 stage object (24 scene slots: PUMPUP .. BRUSH) is kept
// with all its scenes/resources; only its worker (the sequencing) is replaced
// by ours, driven by a Groove Tickflow (.gtf) or GTLM (.gtl) timeline
// (sd:/groove/multi.gtf, then sd:/groove/stages/multi/multi.gtf, then the .gtl fallbacks).
constexpr uintptr_t oR21Ctor = 0x4202C0, oR21Worker = 0x420720, oR21Dtor = 0x4207F0;
constexpr uintptr_t oSwitchCut = 0x4D7B40, oSwitchK0 = 0x3B86F0, oSwitchK1 = 0x3B8770, oSwitchK2 = 0x3BE7D0,
    oQueuePreload = 0x4D9DC0, oWaitSlotLoaded = 0x4D9EC0, oGetScene = 0x4DAA70, oGetScenePtr = 0x4D9EA0,
    oSetTransLen = 0x4D9E10, oSetFlag3535 = 0x4DAE70, oSetRingMask = 0x4DAE80, oSetSwing = 0x137B50,
    oSetSwing2 = 0x137B60, oRestore = 0x514FF0, oR21Tramp = 0x4212A0;
constexpr uintptr_t oR21ThreadVtbl = 0xD4D030;
// REMIX_21 stage layout (object size 0xE550)
constexpr uintptr_t rSub = 0x3548, rRunner = 0x3550, rThreadIdx = 0x3560, rSceneCtrl = 0x6E00;
// v0.3.2 fix: offsets from the object's vptr (= vtable symbol + 0x10). v0.3.1 used +0x108/+0x110,
// which in REMIX_21's vtable are two empty "ret" stubs (0x3AD290/0x3AD2A0) -> count = garbage, no names.
constexpr uintptr_t rVtSceneCount = 0xF8, rVtSceneName = 0x100;
constexpr uintptr_t oR21SceneCount = 0x421270, oR21SceneName = 0x421280;  // "mov w0,#0x18; ret" / names[i]
constexpr uintptr_t oR21SceneNames = 0xD4CF70;  // const char* names[24] ("SCENE_PUMPUP"...), = 0xD4CE20 + 0x150
constexpr int kR21Scenes = 24;
constexpr int kMaxSlots = 32;

const StageDef kMultiStage = {"multi", "ht3sd:/groove/stages/multi/multi.gtl", "ht3sd:/groove/stages/multi/FORCE",
                              "ht3sd:/groove/stages/multi/DISABLE", "ht3sd:/groove/stages/multi/NO_NATIVE_RESULTS"};
bool gMultiActive = false;
bool gMultiNoNative = false;
bool gCueFnOk[groove::kCueFnCount];
groove::MultiTimeline gMt;
void* gMultiStage = nullptr;
bool v0MultiBusy(){return gMultiStage!=nullptr;}
int gSlotOf[groove::kGameNames];  // kGameName index -> REMIX_21 slot (-1 = not hosted)
constexpr int kCueThreads = 8;
int gThreadOf[groove::kGameNames];  // kGameName index -> cue thread
struct MultiStats {
    int started = 0, gameplayStarted = 0, reachedEnd = 0, finished = 0, stopped = 0, saved = 0, resultsMode = 0;
    int calls = 0, callsSkipped = 0, switches = 0, fades = 0, anims = 0, late = 0;
} gMRun;

inline void tRestore(void* th, int p) { fn<void (*)(void*, int)>(oRestore)(th, p); }

// Thread clock = total ticks this thread has scheduled (native wait adds to
// th+0x278). Waiting "until T" this way stays exact even after cue functions
// that wait internally.
inline int thClock(void* th) { return at<int32_t>(th, 0x278); }
bool waitUntil(void* th, int base, int tick) {
    int64_t distance=(int64_t)tick-((int64_t)thClock(th)-base);
    if (distance>0x7fffffff || (int64_t)base+tick>0x7fffffff) { gMRun.stopped=1; return false; }
    int d=distance<0 ? -1 : (int)distance;
    if (d < 0) { gMRun.late++; return !tStop(th); }
    return waitTicks(th, d);
}

// Same spawn as the native REMIX_21 code (its thread vtable + PMF trampoline).
void spawnR21(void* stage, void* parent, void (*body)(void*, void*)) {
    uint8_t* th = fn<uint8_t* (*)(unsigned long)>(oNew)(0x298);
    if (!th) { logf("spawnR21: native allocation failed"); return; }
    void* runner = at<void*>(stage, rRunner);
    int idx = at<int32_t>(stage, rThreadIdx);
    uintptr_t vt = gBase + oR21ThreadVtbl;
    at<uintptr_t>(th, 0) = vt + 0x10;
    at<uintptr_t>(th, 0x18) = vt + 0x40;
    fn<void (*)(void*, void*, int, uintptr_t, void*, void*)>(oThreadCtor)(th, runner, idx, gBase + oR21Tramp, th + 0x280, parent);
    at<uintptr_t>(th, 0) = vt + 0x10;
    at<uintptr_t>(th, 0x18) = vt + 0x40;
    at<uintptr_t>(th, 0x280) = reinterpret_cast<uintptr_t>(stage) + rSub;  // *(sub+0x10) == stage
    at<uintptr_t>(th, 0x288) = reinterpret_cast<uintptr_t>(body);
    at<uintptr_t>(th, 0x290) = 0;
    fn<void (*)(void*, void*)>(oAppend)(runner, th);
}

// Maps game names to the stage's own slots ("SCENE_RING" ...), so nothing depends on slot order.
// 1) the stage's virtual sceneCount/sceneName, only if the vtable entries really are REMIX_21's;
// 2) otherwise REMIX_21's static name table (same data the vfunc returns; verified against the binary).
// Every name read is logged.
static void slotsFromName(int i, const char* nm, char* line, int& len, int cap) {
    if (len < cap - 24) len += snprintf(line + len, cap - len, " %d=%s", i, nm ? (strncmp(nm, "SCENE_", 6) ? nm : nm + 6) : "(null)");
    if (!nm || strncmp(nm, "SCENE_", 6) != 0) return;
    int g = groove::gameIndex(nm + 6);
    if (g >= 0 && gSlotOf[g] < 0) gSlotOf[g] = i;
}
static bool inMain(uintptr_t p) { return p >= gBase && p < gBase + 0x1300000; }
int resolveSlots(void* stage) {
    for (int g = 0; g < groove::kGameNames; g++) gSlotOf[g] = -1;
    uintptr_t vt = at<uintptr_t>(stage, 0);
    uintptr_t fc = inMain(vt) ? *reinterpret_cast<uintptr_t*>(vt + rVtSceneCount) : 0;
    uintptr_t fn_ = inMain(vt) ? *reinterpret_cast<uintptr_t*>(vt + rVtSceneName) : 0;
    logf("multi: stage vptr=main+0x%lX count_fn=main+0x%lX name_fn=main+0x%lX", (unsigned long)(vt - gBase),
         (unsigned long)(fc - gBase), (unsigned long)(fn_ - gBase));
    static char line[640];
    int len = 0, cnt = 0, found = 0;
    const char* how = "none";
    if (fc == gBase + oR21SceneCount && fn_ == gBase + oR21SceneName) {
        cnt = reinterpret_cast<int (*)(void*)>(fc)(stage);
        if (cnt > kMaxSlots) cnt = kMaxSlots;
        for (int i = 0; i < cnt; i++) slotsFromName(i, reinterpret_cast<const char* (*)(void*, int)>(fn_)(stage, i), line, len, sizeof(line));
        for (int g = 0; g < groove::kGameNames; g++) found += gSlotOf[g] >= 0;
        how = "vfunc";
    }
    if (found == 0) {
        for (int g = 0; g < groove::kGameNames; g++) gSlotOf[g] = -1;
        len = 0; cnt = kR21Scenes;
        const uintptr_t* tab = reinterpret_cast<const uintptr_t*>(gBase + oR21SceneNames);
        for (int i = 0; i < cnt; i++) slotsFromName(i, inMain(tab[i]) ? reinterpret_cast<const char*>(tab[i]) : nullptr, line, len, sizeof(line));
        for (int g = 0; g < groove::kGameNames; g++) found += gSlotOf[g] >= 0;
        how = "static table";
    }
    line[len < (int)sizeof(line) ? len : (int)sizeof(line) - 1] = 0;
    logf("multi: slots via %s: count=%d found=%d |%s", how, cnt, found, line);
    return found > 0 ? cnt : 0;
}

using CueCall = void (*)(void*, void*, int, int, int, int);

// One cue thread per game used (k = index in gMt.games), like the native
// per-game remix threads: getScene before each cue, then the scene's own cue.
template <int k>
void mCueThread(void* stage, void* th) {
    // Thread k runs the calls of every game whose first-use index % kCueThreads == k (games
    // follow each other, so neighbours never share a thread; same thread count as before).
    const int base = thClock(th);
    for (int i = 0; i < gMt.count; i++) {
        const groove::MEvent& e = gMt.ev[i];
        if (e.op != groove::MOp::Call || gThreadOf[e.game] != k) continue;
        const int slot = gSlotOf[e.game];
        if (!waitUntil(th, base, e.tick)) { gMRun.stopped = 1; tPop(th); return; }
        int p = tPush(th);
        fn<void (*)(void*, void*, int)>(oGetScene)(stage, th, slot);
        tRestore(th, p);
        if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
        void* scene = fn<void* (*)(void*, int)>(oGetScenePtr)(stage, slot);
        if (!scene || !gCueFnOk[e.fn]) { gMRun.callsSkipped++; continue; }
        if (e.str) fn<void (*)(void*, const char*)>(oSetComment)(stage, e.str);
        if (groove::kCueFns[e.fn].kind == 1)
            fn<void (*)(void*, void*, const char*, void*, void*, float)>(groove::kCueFns[e.fn].off)(scene, th, e.word, nullptr, nullptr, 1.0f);
        else
            fn<CueCall>(groove::kCueFns[e.fn].off)(scene, th, e.a[0], e.a[1], e.a[2], e.a[3]);
        gMRun.calls++;
    }
    waitTicks(th, gMt.ticksPerBeat * 2);
    tPop(th);
}

// Scene changes, in order (a switch blocks while the previous transition runs,
// exactly like the native director, so they live in their own thread).
void mSwitchThread(void* stage, void* th) {
    const int base = thClock(th);
    void* ctrl = reinterpret_cast<uint8_t*>(stage) + rSceneCtrl;
    for (int i = 0; i < gMt.count; i++) {
        const groove::MEvent& e = gMt.ev[i];
        if (e.op != groove::MOp::Switch) continue;
        if (!waitUntil(th, base, e.tick)) { gMRun.stopped = 1; tPop(th); return; }
        int slot = gSlotOf[e.game];
        int p = tPush(th);
        switch (e.style) {
        case 0: fn<void (*)(void*, void*, int, int)>(oSwitchK0)(ctrl, th, slot, e.sub); break;
        case 1: fn<void (*)(void*, void*, int, int)>(oSwitchK1)(ctrl, th, slot, e.sub); break;
        case 2: fn<void (*)(void*, void*, int, int)>(oSwitchK2)(ctrl, th, slot, e.sub); break;
        default: fn<void (*)(void*, void*, int)>(oSwitchCut)(ctrl, th, slot); break;
        }
        tRestore(th, p);
        if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
        gMRun.switches++;
    }
    tPop(th);
}

// Preloads + screen effects (fade, per-scene layout animations).
void mDirectorThread(void* stage, void* th) {
    const int base = thClock(th);
    for (int k = 0; k < gMt.gameCount; k++) {
        int slot = gSlotOf[gMt.games[k]];
        if (gMt.games[k] != gMt.firstGame) fn<void (*)(void*, int, int, int)>(oQueuePreload)(stage, slot, -1, 0);
    }
    fn<void (*)(void*, int)>(oSetTransLen)(stage, gMt.transLen);
    for (int i = 0; i < gMt.count; i++) {
        const groove::MEvent& e = gMt.ev[i];
        if (e.op != groove::MOp::Fade && e.op != groove::MOp::Anim) continue;
        if (!waitUntil(th, base, e.tick)) { gMRun.stopped = 1; tPop(th); return; }
        if (e.op == groove::MOp::Fade) {
            fadeScreen(stage, e.len, e.alpha);
            gMRun.fades++;
        } else {
            void* scene = fn<void* (*)(void*, int)>(oGetScenePtr)(stage, gSlotOf[e.game]);
            void* layout = scene ? at<void*>(scene, e.len) : nullptr;
            // sanity: a layout object starts with a vtable inside main
            uintptr_t vt = layout ? *reinterpret_cast<uintptr_t*>(layout) : 0;
            if (layout && vt > gBase && vt < gBase + 0x1300000) {
                playAnim(layout, e.str);
                gMRun.anims++;
            } else {
                logf("multi: anim %s skipped (no layout at scene+0x%X)", e.str, e.len);
            }
        }
    }
    tPop(th);
}

void mLatencyThread(void* stage, void* th) {
    int lat = fn<int (*)(void*)>(oLatency)(stage);
    at<int32_t>(th, 0x10) -= lat;
    tPop(th);
}

// Mirrors native REMIX_21 control 0x421340 (caller pushed; we pop at the end).
void mControl(void* stage, void* th) {
    const int first = gSlotOf[gMt.firstGame];
    fn<void (*)(void*, int)>(oInitGameplay)(stage, 0);
    fn<void (*)(void*, int)>(oSetFlag3535)(stage, 1);
    fn<void (*)(void*, int)>(oSetRingMask)(stage, 15);
    fn<void (*)(void*, int, int, int)>(oQueuePreload)(stage, first, -1, 1);
    int p = tPush(th);
    fn<void (*)(void*, void*, int, int)>(oWaitSlotLoaded)(stage, th, first, 0);
    tRestore(th, p);
    if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
    p = tPush(th);
    fn<void (*)(void*, void*, int)>(oSwitchCut)(reinterpret_cast<uint8_t*>(stage) + rSceneCtrl, th, first);
    tRestore(th, p);
    if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
    fadeScreen(stage, 0x1E0, 1.0f);
    p = tPush(th);
    fn<int (*)(void*, void*, int, int)>(oWaitAudio)(stage, th, -1, 0);
    tRestore(th, p);
    if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
    fn<VoidStage>(oEnablePause)(stage);
    fn<void (*)(void*, int)>(oSetSwing)(stage, gMt.swing);
    fn<void (*)(void*, int)>(oSetSwing2)(stage, 0);
    p = tPush(th);
    fn<void (*)(void*, void*, unsigned, int, int, float, float)>(oPlayBgm)(stage, th, gMt.bgm, 0x3C0, 0, 1.0f, 1.0f);
    tRestore(th, p);
    if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
    using Body = void (*)(void*, void*);
    static const Body kCue[kCueThreads] = {mCueThread<0>, mCueThread<1>, mCueThread<2>, mCueThread<3>,
                                           mCueThread<4>, mCueThread<5>, mCueThread<6>, mCueThread<7>};
    for (int g = 0; g < groove::kGameNames; g++) gThreadOf[g] = -1;
    for (int k = 0; k < gMt.gameCount; k++) gThreadOf[gMt.games[k]] = k % kCueThreads;
    spawnR21(stage, th, mDirectorThread);
    spawnR21(stage, th, mSwitchThread);
    for (int k = 0; k < gMt.gameCount && k < kCueThreads; k++) spawnR21(stage, th, kCue[k]);
    spawnR21(stage, th, mLatencyThread);
    fn<VoidStage>(oUnk138D20)(stage);
    const int base = thClock(th);
    if (!waitUntil(th, base, gMt.startTick)) { gMRun.stopped = 1; tPop(th); return; }
    fn<VoidStage>(oStartGameplay)(stage);
    gMRun.gameplayStarted = 1;
    if (!waitUntil(th, base, gMt.endTick)) { gMRun.stopped = 1; tPop(th); return; }
    gMRun.reachedEnd = 1;
    fn<VoidStage>(oEndGameplay)(stage);
    fadeScreen(stage, gMt.endFade, 0.0f);
    fn<VoidStage>(oDisablePause)(stage);
    if (!waitUntil(th, base, gMt.finishTick)) { gMRun.stopped = 1; tPop(th); return; }
    fn<VoidStage>(oFinish)(stage);
    gMRun.finished = 1;
    tPop(th);
}

bool writeMultiSave();

// Mirrors native REMIX_21 worker 0x420720.
void multiWorker(void* stage, void* th) {
    gMRun.started = 1;
    logf("multi worker: start stage=%p thread=%p games=%d calls=%d switches=%d", stage, th, gMt.gameCount, gMt.calls,
         gMt.switches);
    flushLog();
    fadeScreen(stage, 0, 0.0f);
    initSm(stage, gMt.bgm, 1);
    int p = tPush(th);
    fn<void (*)(void*, void*, int, int)>(oWaitReady)(stage, th, 0, -1);
    tRestore(th, p);
    if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
    fn<void (*)(void*, unsigned)>(oPrepareSm)(stage, gMt.bgm);
    p = tPush(th);
    mControl(stage, th);
    tRestore(th, p);
    if (tStop(th)) { gMRun.stopped = 1; tPop(th); return; }
    gMRun.resultsMode = 0; // v0.5.1: REMIX_21 save isolation is not verified.
    if (gMt.resultsMode) logf("multi: native results requested but blocked; using custom exit");
    logf("multi worker: end reached=%d finished=%d calls=%d skipped=%d switches=%d fades=%d anims=%d late=%d -> %s",
         gMRun.reachedEnd, gMRun.finished, gMRun.calls, gMRun.callsSkipped, gMRun.switches, gMRun.fades, gMRun.anims,
         gMRun.late, gMRun.resultsMode ? "native toResults (REMIX_21 record)" : "return to previous scene");
    gMRun.saved = writeMultiSave() ? 1 : 0;
    flushLog();
    if (gMRun.resultsMode) {
        fn<VoidStage>(oToResults)(stage);
    } else {
        void* ctx = at<void*>(stage, sCtx);
        uint32_t* flags = *reinterpret_cast<uint32_t**>(gBase + oManager + 0x3AA0);
        if (flags) *flags |= 1;
        fn<void (*)(void*, int, void*)>(oSetNextScene)(ctx, at<int>(ctx, 8), nullptr);
        fn<void (*)(void*, int)>(oExitToMenu)(ctx, 1);
    }
    tPop(th);
}

bool writeMultiSave() {
    groove::TryLease lease(gInputBusy);
    if (!lease.held) { logf("save multi: input busy; not saved, destructor may retry"); return false; }
    if (!gFsOk || !gLogWritable) { logf("save multi: SD unavailable; not saved"); return false; }
    snprintf(gSavePath, sizeof(gSavePath), kSaveFmt, kMultiStage.name);
    snprintf(gSaveTmpPath, sizeof(gSaveTmpPath), "%s.tmp", gSavePath);
    int plays = 0, completions = 0, aborted = 0;
    long size = 0;
    if (char* old = readFile(gSavePath, &size, 4096)) {
        const char* q;
        if ((q = strstr(old, "\"plays\":"))) plays = jsonInt(q + 8);
        if ((q = strstr(old, "\"completions\":"))) completions = jsonInt(q + 14);
        if ((q = strstr(old, "\"aborted\":"))) aborted = jsonInt(q + 10);
    }
    plays++;
    if (gMRun.finished) completions++; else aborted++;
    char buf[1024];
    int n = snprintf(buf, sizeof(buf),
                     "{\n  \"format\": \"groove-save/1\",\n  \"stage\": \"multi\",\n  \"module\": \"" GROOVE_HT3_VERSION "\",\n"
                     "  \"plays\": %d,\n  \"completions\": %d,\n  \"aborted\": %d,\n"
                     "  \"last\": {\"gameplay_started\": %d, \"reached_end\": %d, \"finished\": %d, \"games\": %d,"
                     " \"calls\": %d, \"calls_skipped\": %d, \"switches\": %d, \"fades\": %d, \"anims\": %d, \"late\": %d,"
                     " \"results\": \"%s\"}\n}\n",
                     plays, completions, aborted, gMRun.gameplayStarted, gMRun.reachedEnd, gMRun.finished, gMt.gameCount,
                     gMRun.calls, gMRun.callsSkipped, gMRun.switches, gMRun.fades, gMRun.anims, gMRun.late,
                     gMRun.resultsMode ? "native" : "exit");
    bool committed=persistCustomSave(gSavePath,buf,n,sizeof(buf));
    if (committed)
        logf("save multi: plays=%d completions=%d aborted=%d",plays,completions,aborted);
    return committed;
}

HkTrampoline r21CtorHook = [](TrampolineStatic(), void* self, void* seq, int b, int c, int d, int e, int f) -> void* {
    void* r = orig(self, seq, b, c, d, e, f);
    if (gMultiStage) return r;
    groove::TryLease sourceLease(gInputBusy);
    if (!sourceLease.held) return r;
    gMultiStage = nullptr;
    gTTLoaded = false;  // GRO-11
    if (!gMultiActive || !ensureFs()) return r;
    Selection s = readSelection();
    logf("REMIX_21 ctor stage=%p | mgr mode=%d world=%d col=%d row=%d cur=%d", self, s.mode, s.world, s.col, s.row,
         s.curIdx);
    const StageDef& sd = kMultiStage;
    bool disabled = fileExists(sd.disable);
    bool forced = fileExists(sd.force);
    long size = 0;
    char* text = disabled ? nullptr : readMultiFile(&size);
    bool ok = text && groove::parseTimeline(gMt, text, size);
    bool match = ok && s.ok && s.col == gMt.matchCol && s.row == gMt.matchRow &&
                 (gMt.matchWorld < 0 || s.world == gMt.matchWorld);
    logf("stage multi: file %s", gMultiUsedPath ? gMultiUsedPath : "missing");
    logf("stage multi: timeline %s (%s) games=%d calls=%d switches=%d fades=%d anims=%d start=%d end=%d finish=%d "
         "match_rule=(%d,%d,%d) disabled=%d forced=%d match=%d",
         ok ? "ok" : "INVALID", ok ? "-" : (text ? gMt.error : "missing"), gMt.gameCount, gMt.calls, gMt.switches,
         gMt.fades, gMt.anims, gMt.startTick, gMt.endTick, gMt.finishTick, gMt.matchWorld, gMt.matchCol, gMt.matchRow,
         disabled, forced, match);
    if (!disabled && ok && (match || forced)) {
        int cnt = resolveSlots(self);
        bool all = true;
        for (int k = 0; k < gMt.gameCount; k++) {
            int g = gMt.games[k];
            logf("multi: game %s -> slot %d", groove::kGameName[g], gSlotOf[g]);
            if (gSlotOf[g] < 0) all = false;
        }
        if (cnt <= 0 || !all) {
            logf("=> native REMIX_21 (a game of the timeline has no slot in this stage)");
        } else {
            gMultiNoNative = fileExists(sd.noNative);
            gMRun = MultiStats{};
            gMultiStage = self;
            gTitleMode = 3;  // v0.4.0: always (default title "Remix 21")
            gTitleLogged = false;
            logf("=> multi will run on this REMIX_21 stage (%s)%s", match ? "tile match" : "FORCE file",
                 gMt.title[0] ? " title=custom" : " title=Remix 21 (default)");
        }
    } else {
        logf("=> native REMIX_21");
    }
    flushLog();
    return r;
};

HkTrampoline r21WorkerHook = [](TrampolineStatic(), void* stage, void* th) -> void {
    if (gMultiStage && stage == gMultiStage) {
        multiWorker(stage, th);
        return;
    }
    orig(stage, th);
};

HkTrampoline r21DtorHook = [](TrampolineStatic(), void* stage) -> void* {
    if (gMultiStage && stage == gMultiStage) {
        logf("multi stage destroyed: started=%d gameplay=%d end=%d finished=%d stopped=%d calls=%d switches=%d",
             gMRun.started, gMRun.gameplayStarted, gMRun.reachedEnd, gMRun.finished, gMRun.stopped, gMRun.calls,
             gMRun.switches);
        if (gMRun.started && !gMRun.saved) writeMultiSave();
        void* result=orig(stage); // Stage teardown only: GE-152 finds later Runner reaping, not a join barrier.
        gMultiStage = nullptr;
        if (gTitleMode == 3) clearTitleMode();
        flushLog();
        return result;
    }
    return orig(stage);
};

// 0x4EFE80: const char* GetMessage(void* archive, const char* label, int* opt);
HkTrampoline getMessageHook = [](TrampolineStatic(), void* archive, const char* label, int* opt) -> void* {
    void* r = orig(archive, label, opt);
    if (!gActive || !label || (gTitleMode == 0 && !gInTitleStash)) return r;
    if (gTitleMode == 3) return r;  // Multi title is served via cachedName (kind=1, index=67)
    if (strcmp(label, "I_RING_01") != 0) return r;
    const char* was = static_cast<const char*>(r);
    const char* now = retitleIRing01(was);
    if (now != was) logTitleOnce("I_RING_01", was, now);
    return const_cast<char*>(now);
};

// 0x2BD0: const char* cachedName(int kind, int index);
// Intro / prologue / results stash this pointer at stage entry (0x206D00).
HkTrampoline cachedNameHook = [](TrampolineStatic(), int kind, int index) -> void* {
    void* r = orig(kind, index);
    if (kind == 1 && index == kKind1Ring01 && r) gNative41 = static_cast<const char*>(r);
    if (kind == 1 && index == kKind1Multi && r) gNative67 = static_cast<const char*>(r);
    if (!gActive || (gTitleMode == 0 && !gInTitleStash)) return r;
    if (gTitleMode == 3) {
        if (kind == 1 && index == kKind1Multi) {
            const char* t = gMt.title[0] ? gMt.title : kRemix21Title;
            logTitleOnce("cachedName(1,67)", static_cast<const char*>(r), t);
            return const_cast<char*>(t);
        }
        return r;
    }
    if (kind == 1 && index == kKind1Ring01) {
        const char* was = static_cast<const char*>(r);
        const char* now = retitleIRing01(was);
        if (now != was) logTitleOnce("cachedName(1,41)", was, now);
        return const_cast<char*>(now);
    }
    return r;
};

// 0x206D00: void stashName(int kind, int index);
// Called from the launch/intro path (0x1D3514 / 0x1D3384) with the *tile's*
// (kind,index), after mgr col/row already hold the selected tile, and BEFORE
// the HT2 ctor. Native HT2 and HT3 both pass (1,41); we distinguish by
// readSelection(). The map painter does not use this function.
HkTrampoline stashNameHook = [](TrampolineStatic(), int kind, int index) -> void {
    Selection s = readSelection();
    Selection e = s;  // v0.3.10: no stale gLastMapSel fallback (leaked HT3 title into Double Hell)
    gStashKind = kind;
    gStashIndex = index;
    bool ring01 = (kind == 1 && index == kKind1Ring01);
    bool multi = (kind == 1 && index == kKind1Multi);
    if (ring01 && isHt3Sel(e)) gInTitleStash = true;
    orig(kind, index);
    char** slot = stashSlot();
    if (ring01) {
        const char* was = (slot && *slot) ? *slot : "";
        logf("ht3 title: stashName(1,41) mode=%d col=%d row=%d ok=%d last=(%d,%d) in=%d slot=%p was='%.48s'",
             s.mode, s.col, s.row, (int)s.ok, gLastMapSel.col, gLastMapSel.row,
             (int)gInTitleStash, slot, was);
        if (gInTitleStash && slot) {
            const char* now = retitleIRing01(*slot);
            *slot = const_cast<char*>(now);
            logTitleOnce("stashName(1,41)", was, now);
        }
        if (ensureFs()) flushLog();
    }
    (void)multi;  // v0.4.0: Multi title / prologue / jingle are set in prologueCtor (fixStashForTile)
    {
        char** ps = stashPathSlot();
        int* js = stashJingleSlot();
        if (ps && *ps != gProloguePath) gNativePath = *ps;
        if (js) { gNativeJingle = *js; gJingleOverridden = false; }
    }
    gInTitleStash = false;
};

// 0x504720: void loadComplete(loader, dest). loader+0x28 is the LAYOUT
// given to 0x4F3C20, not the SPR. After orig, SPR is at *(loader+0x28)+8
// (already baked). We still try to patch pal here as a fallback and log
// the pointers so a hardware log can confirm the layout-vs-SPR split.
HkTrampoline loadCompleteHook = [](TrampolineStatic(), void* loader, void* dest) -> void {
    orig(loader, dest);
    if (!gSkyRemap) return;
    if (gSkyPatched) {
        if (ensureFs()) flushLog();
        return;
    }
    uint8_t* inner = loader ? at<uint8_t*>(loader, 0x28) : nullptr;
    uint8_t* cands[3] = {
        (inner && reinterpret_cast<uintptr_t>(inner) >= 0x10000) ? at<uint8_t*>(inner, 8) : nullptr,
        dest ? at<uint8_t*>(dest, 8) : nullptr,
        inner,
    };
    if (inner && reinterpret_cast<uintptr_t>(inner) >= 0x10000) {
        uint32_t n20 = *reinterpret_cast<uint32_t*>(inner + 0x20);
        logf("ht3 sky: loadComplete dest=%p inner=%p inner+8=%p dest+8=%p inner+0x20=%u",
             dest, inner, cands[0], cands[1], n20);
    }
    for (uint8_t* p : cands) {
        if (p && reinterpret_cast<uintptr_t>(p) >= 0x10000 &&
            patchSprSky(p, "after load-complete"))
            break;
    }
    if (gSkyPatched && ensureFs()) flushLog();
};



// ---------------------------------------------------------------- per-tile titles (GRO-11)
// Titles per custom tile, read once from the .gtl headers (`match`, `title`)
// so the overworld map and the intro can be retitled before any stage ctor.
struct TileTitle {
    bool on = false;        // .gtl present and not DISABLEd
    bool fallback23 = false; // HT3: no `title` line -> trailing "2" -> "3"
    const char* defTitle = nullptr;  // Multi: "Remix 21" when no `title` line
    int world = -1, col = -99, row = -99;
    char title[96] = {};
    char prologue[96] = {};  // GRO-12 (Multi): `prologue type_XX` or full path
    int jingle = -1;         // GRO-12 (Multi): `jingle 0x158..0x16C`
};
TileTitle gTT[3];  // 0 = ht3, 1 = doublehell, 2 = multi
char gMapTitleBuf[96];
Selection gMapCur;  // last cell the map info panel showed
int gMapLogW = -99, gMapLogC = -99, gMapLogR = -99;

// Separate scratch timeline: map refresh must never overwrite an active worker's data.
void scanTileTitle(TileTitle& t, const char* gtl, const char* disable, int defCol, int defRow, bool fallback,
                   const char* defTitle = nullptr) {
    t = TileTitle{}; t.defTitle=defTitle; t.col=defCol; t.row=defRow;
    if (fileExists(disable)) return;
    long size=0; char* text=readFile(gtl,&size,60*1024);
    if (!text) return;
    bool multi=defTitle != nullptr;
    groove::TimelineMetadata v;
    if (!groove::parseMetadata(v,multi,text,size)) { logf("metadata: invalid timeline %s; overrides disabled",gtl); return; }
    t.on=true; t.fallback23=fallback;
    t.world=v.world; t.col=v.col; t.row=v.row;
    memcpy(t.title,v.title,sizeof(t.title));memcpy(t.prologue,v.prologue,sizeof(t.prologue));t.jingle=v.jingle;

}

void loadTileTitles() {
    groove::TryLease sourceLease(gInputBusy);
    if (!sourceLease.held || gTTLoaded || !ensureFs()) return;
    gTTLoaded = true;
    scanTileTitle(gTT[0], kStages[0].gtl, kStages[0].disable, 9, 0, true);
    scanTileTitle(gTT[1], kStages[1].gtl, kStages[1].disable, 9, 1, false);
    // Multi: same .gtf-first / .gtl-fallback resolution as the stage ctor
    if (fileExists(kMultiStage.disable)) {
        gTT[2] = TileTitle{};
        gTT[2].defTitle = kRemix21Title;
        gTT[2].col = 9;
        gTT[2].row = 4;
    } else {
        long msz = 0;
        char* mt = readMultiFile(&msz);
        if (mt) {
            // Reuse scanTileTitle by writing a temp path-less scan: feed via a dummy
            // that already has the text in gFileBuf (readMultiFile used readFile).
            // scanTileTitle would re-read; call it on the path that was selected.
            if (gMultiUsedPath)
                scanTileTitle(gTT[2], gMultiUsedPath, kMultiStage.disable, 9, 4, false, kRemix21Title);
        } else {
            gTT[2] = TileTitle{};
            gTT[2].defTitle = kRemix21Title;
            gTT[2].col = 9;
            gTT[2].row = 4;
        }
    }
    for (int i = 0; i < 3; i++)
        logf("tile title %d: on=%d match=(%d,%d,%d) title='%s'%s%s prologue='%s' jingle=%d", i, (int)gTT[i].on,
             gTT[i].world, gTT[i].col, gTT[i].row, gTT[i].title,
             gTT[i].fallback23 && !gTT[i].title[0] ? " (2->3)" : "",
             gTT[i].defTitle && !gTT[i].title[0] ? " (default)" : "", gTT[i].prologue, gTT[i].jingle);
}

bool ttMatch(const TileTitle& t, int w, int c, int r) {
    return t.on && c == t.col && r == t.row && (t.world < 0 || w == t.world);
}

// Custom title for a map cell, or nullptr = keep the native text.
// `native` = the native string for that cell (for the HT3 2->3 fallback).
const char* tileTitle(int w, int c, int r, const char* native, char* buf, size_t cap) {
    loadTileTitles();
    for (int i = 0; i < 3; i++) {
        const TileTitle& t = gTT[i];
        if (!ttMatch(t, w, c, r)) continue;
        if (t.title[0]) return t.title;
        if (t.defTitle) return t.defTitle;
        if (!t.fallback23 || !native) return nullptr;
        size_t n = 0;
        while (native[n] && n + 1 < cap) ++n;
        if (n == 0 || native[n - 1] != '2') return nullptr;
        memcpy(buf, native, n);
        buf[n - 1] = '3';
        buf[n] = 0;
        return buf;
    }
    return nullptr;
}


// ---------------------------------------------------------------- Remix 21 prologue art / jingle (GRO-12)
// 0x206D00 writes **(0xD99D68) = desc+0x20 (prologue SPR path) and
// **(0xD99D70) = desc+0x28 (jingle id, 0x158..0x16C; table 0xD20410).
// The prologue ctor (0x206DE0) loads that path; 0x2073E0 reads the jingle.
// For the Multi tile only, `prologue` / `jingle` in multi.gtl override them.
// A path is accepted only if a native kind-1/kind-2 descriptor uses it, or
// if <path>.spr and <path>.tex both exist in the SD LayeredFS romfs.

char** stashPathSlot() { return gBase ? *reinterpret_cast<char***>(gBase + oStashPath) : nullptr; }
int* stashJingleSlot() { return gBase ? *reinterpret_cast<int**>(gBase + oStashJingle) : nullptr; }

bool nativeProloguePath(const char* p) {
    const uintptr_t tabs[2] = {kDescKind1, kDescKind2};
    const int cnt[2] = {kDescKind1Count, kDescKind2Count};
    for (int t = 0; t < 2; t++)
        for (int i = 0; i < cnt[t]; i++) {
            const char* q = *reinterpret_cast<const char* const*>(gBase + tabs[t] + (uintptr_t)i * 0x30 + 0x20);
            if (q && reinterpret_cast<uintptr_t>(q) >= 0x10000 && !strcmp(q, p)) return true;
        }
    return false;
}

// Builds gProloguePath from a `prologue` value; returns it if usable, else nullptr.
const char* resolvePrologue(const char* v) {
    if (!v || !v[0]) return nullptr;
    if (strchr(v, '/')) snprintf(gProloguePath, sizeof(gProloguePath), "%s", v);
    else snprintf(gProloguePath, sizeof(gProloguePath), "graph/prologue/remix/%s/prologue", v);
    if (nativeProloguePath(gProloguePath)) return gProloguePath;
    char a[200], b[200];
    snprintf(a, sizeof(a), "ht3sd:/atmosphere/contents/0100D9F01D474000/romfs/%s.spr", gProloguePath);
    snprintf(b, sizeof(b), "ht3sd:/atmosphere/contents/0100D9F01D474000/romfs/%s.tex", gProloguePath);
    if (fileExists(a) && fileExists(b)) return gProloguePath;
    logf("multi prologue: '%s' -> '%s' is not a game prologue and not on the SD -> native kept", v, gProloguePath);
    return nullptr;
}

void fixPrologueForTile(const Selection& s) {
    char** ps = stashPathSlot();
    int* js = stashJingleSlot();
    bool multi = s.ok && ttMatch(gTT[2], s.world, s.col, s.row);
    if (ps) {
        const char* was = *ps;
        const char* now = was;
        if (multi && gTT[2].prologue[0]) {
            const char* p = resolvePrologue(gTT[2].prologue);
            if (p) now = p;
        } else if (was == gProloguePath && gNativePath) {
            now = gNativePath;  // a previous Multi run left our path in the stash
        }
        if (now != was) *ps = const_cast<char*>(now);
        if (multi || now != was)
            logf("multi prologue: path '%s' (was '%s')", now ? now : "", was ? was : "");
    }
    if (js) {
        int was = *js;
        int now = was;
        if (multi && gTT[2].jingle >= 0) {
            if (gTT[2].jingle >= 0x158 && gTT[2].jingle <= 0x16C) {
                now = gTT[2].jingle;
                gJingleOverridden = true;
                gOurJingle = now;
            } else {
                logf("multi prologue: jingle 0x%X outside 0x158..0x16C -> native kept", gTT[2].jingle);
            }
        } else if (gJingleOverridden && was == gOurJingle && gNativeJingle >= 0) {
            now = gNativeJingle;
            gJingleOverridden = false;
        }
        if (now != was) *js = now;
        if (multi || now != was) logf("multi prologue: jingle 0x%X (was 0x%X)", now, was);
    }
}

bool isOurTitle(const char* p) {
    if (!p) return false;
    if (p == gTitleBuf || p == gMapTitleBuf || p == gTl.title || p == gMt.title || p == kRemix21Title) return true;
    for (const TileTitle& t : gTT)
        if (p == t.title) return true;
    return false;
}

// Prologue ctor (intro card): set the stash from the *current* tile, and
// restore the native name if a previous HT3/DH/Multi run left ours there.
void fixStashForTile(const char* why) {
    char** slot = stashSlot();
    const char* was = (slot && *slot) ? *slot : nullptr;
    Selection s = readSelection();
    if (!s.ok && gMapCur.ok) s = gMapCur;  // mgr mode out of 0..1: last map cursor cell (from 0x1D0130)
    const char* native = (gStashKind == 1 && gStashIndex == kKind1Multi) ? gNative67 : gNative41;
    if (!isOurTitle(was) && was) native = was;  // stash holds a native string: trust it
    const char* now = was;
    if (s.ok) {
        const char* t = tileTitle(s.world, s.col, s.row, native, gTitleBuf, sizeof(gTitleBuf));
        if (t) now = t;
        else if (isOurTitle(was) && native) now = native;
    } else if (isOurTitle(was) && native) {
        now = native;
    }
    if (slot && now && now != was) *slot = const_cast<char*>(now);
    logf("ht3 title: %s mode=%d world=%d col=%d row=%d stash=(%d,%d) slot=%p was='%.48s' now='%.48s'", why, s.mode,
         s.world, s.col, s.row, gStashKind, gStashIndex, slot, was ? was : "", now ? now : "");
    fixPrologueForTile(s);
    if (ensureFs()) flushLog();
}

// 0x1D0130: map info panel refresh (cursor move / world change / map init).
HkTrampoline mapInfoHook = [](TrampolineStatic(), void* panel, int anim) -> void {
    orig(panel, anim);
    if (!gActive || !panel) return;
    uint8_t* map = at<uint8_t*>(panel, 8);
    if (!map) return;
    int w = at<int32_t>(map, 0x5274), c = at<int32_t>(map, 0x5298), r = at<int32_t>(map, 0x529C);
    gMapCur = Selection{};
    gMapCur.ok = true; gMapCur.mode = 0; gMapCur.world = w; gMapCur.col = c; gMapCur.row = r;
    loadTileTitles();
    bool any = false;
    for (const TileTitle& t : gTT) any = any || ttMatch(t, w, c, r);
    if (!any) return;
    int lock = fn<int (*)(void*, int, int)>(oMapCellLock)(map, 0, 0);
    if (lock <= 1) return;  // locked cell: native shows I_LOCKED text, keep it
    const char* t = tileTitle(w, c, r, gNative41, gMapTitleBuf, sizeof(gMapTitleBuf));
    // Multi tile is (1,67): its 2->3 fallback never applies; tileTitle uses the gtl title only.
    if (!t) return;
    fn<void (*)(void*, void*, const char*, int)>(oTextQueueSet)(map + 0x29E8, at<void*>(panel, 0x30), t, 0);
    if (w != gMapLogW || c != gMapLogC || r != gMapLogR) {
        gMapLogW = w; gMapLogC = c; gMapLogR = r;
        logf("map title: (%d,%d,%d) lock=%d -> '%s'", w, c, r, lock, t);
    }
};

// 0x206DE0: common prologue ctor (graph/prologue/common/base + stashed
// per-game path). Copies **(0xD99D60) into the intro card via 0x4F07B0.
// Trampoline-safe (stp x29,x30). Signature: (prologueObj, stage).
HkTrampoline prologueCtorHook = [](TrampolineStatic(), void* self, void* stage) -> void* {
    fixStashForTile("prologueCtor");
    return orig(self, stage);
};


// 0x4F40A0: the real pre-bake hook. At entry, layout+8 is the relocated SPR
// (0x500760 has already run). Retag the atlas[57] sky keyframes (GRO-7)
// before any anim instance evaluates them.
HkTrampoline layoutBakeHook = [](TrampolineStatic(), void* layout) -> void {
    if (gSkyRemap && layout) {
        uint8_t* spr = at<uint8_t*>(layout, 8);
        if (spr && reinterpret_cast<uintptr_t>(spr) >= 0x10000)
            patchSprSky(spr, "before layout bake");
    }
    orig(layout);
    if (gSkyRemap && gSkyPatched && ensureFs()) flushLog();
};


bool looksHooked(uint32_t w) {
    return (w & 0xFC000000) == 0x14000000 ||  // B imm26 (another module's hook)
           (w & 0xFF000000) == 0x58000000;    // LDR Xn, literal (far-branch hook)
}

bool checkSigList(const Sig* list, int n) {
    bool ok = true;
    for (int i = 0; i < n; i++) {
        const Sig& s = list[i];
        const uint32_t* p = reinterpret_cast<const uint32_t*>(gBase + s.off);
        if (p[0] == s.w0 && p[1] == s.w1) continue;
        if (!s.hookSite && looksHooked(p[0])) {
            logf("note: %s @0x%X already hooked by another module (%08X) - calling it is fine", s.name, s.off, p[0]);
            continue;
        }
        logf("signature MISMATCH %s @0x%X: %08X %08X (expected %08X %08X)%s", s.name, s.off, p[0], p[1], s.w0, s.w1,
             s.hookSite ? " [our hook site]" : "");
        ok = false;
    }
    return ok;
}
bool checkSignatures() { return checkSigList(kSigs, (int)(sizeof(kSigs) / sizeof(kSigs[0]))); }

void installMulti(const hk::ro::RoModule* main) {
    if (!checkSigList(kSigsMulti, (int)(sizeof(kSigsMulti) / sizeof(kSigsMulti[0])))) {
        logf("multi (REMIX_21 host): signature check failed -> multi disabled, REMIX_21 untouched");
        return;
    }
    int okFns = 0;
    for (int i = 0; i < groove::kCueFnCount; i++) {
        const groove::CueFn& c = groove::kCueFns[i];
        const uint32_t* p = reinterpret_cast<const uint32_t*>(gBase + c.off);
        gCueFnOk[i] = (p[0] == c.w0 && p[1] == c.w1) || looksHooked(p[0]);
        if (gCueFnOk[i]) okFns++;
        else logf("cue fn %s 0x%X MISMATCH (%08X %08X) -> its calls are skipped", groove::kGameName[c.game], c.off, p[0], p[1]);
    }
    bool h3 = r21DtorHook.installAtOffset(main, oR21Dtor).succeeded();
    bool h2 = h3 && r21WorkerHook.installAtOffset(main, oR21Worker).succeeded();
    bool h1 = h2 && r21CtorHook.installAtOffset(main, oR21Ctor).succeeded();
    gMultiActive = h1 && h2 && h3;
    logf("multi hooks: R21ctor=%d R21worker=%d R21dtor=%d cue fns ok %d/%d -> %s", h1, h2, h3, okFns, groove::kCueFnCount,
         gMultiActive ? "ACTIVE" : "PARTIAL/FAILED (REMIX_21 untouched)");
}

} // namespace

extern "C" void hkMain() {
    // Runs inside rtld module initialisation, BEFORE nninitStartup/nnMain:
    // only memory reads and hook installation here. No nn::fs, no heap, no
    // abort paths. Log lines stay in RAM until the first stage creation.
    logf("==== Groove Engine HT3 subsdk4 v" GROOVE_HT3_VERSION " boot (SD access deferred) ====");

    const hk::ro::RoModule* main = hk::ro::getMainModule();
    if (!main) { logf("no main module -> disabled"); return; }
    gBase = main->range().start();
    const uint8_t* bid = main->getBuildId();
    if (!bid || memcmp(bid, kBuildId, sizeof(kBuildId)) != 0) {
        if (bid)
            logf("main build id %02X%02X%02X%02X%02X%02X%02X%02X... != 03FF4A3B -> module does NOTHING", bid[0], bid[1],
                 bid[2], bid[3], bid[4], bid[5], bid[6], bid[7]);
        else
            logf("main build id not found -> module does NOTHING");
       
        return;
    }
    logf("main base=0x%lx build id 03FF4A3B OK", (unsigned long)gBase);
    if (!checkSignatures()) {
        logf("signature check failed -> HT3 disabled, HT2 untouched");
        // Log-only mode: if the ctor site itself is exactly as expected, hook it
        // just to get this log onto the SD after boot. It never diverts a stage.
        const uint32_t* c = reinterpret_cast<const uint32_t*>(gBase + oHt2Ctor);
        if (c[0] == 0xA9BC7BFD && c[1] == 0xF9000BF7)
            gLogOnly = ht2CtorHook.installAtOffset(main, oHt2Ctor).succeeded();
        logf("log-only ctor hook: %d", gLogOnly);
        return;
    }
    logf("signatures OK (%d functions)", (int)(sizeof(kSigs) / sizeof(kSigs[0])));

    {
        const int32_t* cell = reinterpret_cast<const int32_t*>(gBase + 0xAE0B00);
        logf("tile table world1 col9 rows0-4: (%d,%d) (%d,%d) (%d,%d) (%d,%d) (%d,%d)  [v0.3 IPS expected (1,41) (1,41) (1,77) (1,78) (1,67): row0=HT3 row1=Double Hell row4=Multi on REMIX_21]",
             cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8], cell[9]);
    }
    // Install the passive hooks first and the trigger (ctor) last; the ctor hook
    // only diverts a stage when all three are in place (gActive).
    bool h3 = dtorHook.installAtOffset(main, oDtor).succeeded();
    bool h2 = h3 && workerHook.installAtOffset(main, oWorker).succeeded();
    bool h1 = h2 && ht2CtorHook.installAtOffset(main, oHt2Ctor).succeeded();
    gActive = h1 && h2 && h3;
    logf("hooks: HT2ctor=%d HT2worker=%d HT2dtor=%d -> %s", h1, h2, h3, gActive ? "ACTIVE" : "PARTIAL/FAILED (HT2 untouched)");
    // Custom HT3 bg hook is optional: a failure here must not disable HT3 / Double Hell.
    {
        const uint32_t* rt = reinterpret_cast<const uint32_t*>(gBase + oRingTypeEntry);
        bool hRing = false;
        if (rt[0] == 0xF0005C08 && rt[1] == 0x52800309)
            hRing = ringTypeHook.installAtOffset(main, oRingTypeEntry).succeeded();
        else if (looksHooked(rt[0]))
            logf("ring type @0x216530 already hooked by another module (%08X) -> custom HT3 bg disabled", rt[0]);
        else
            logf("ring type @0x216530 signature mismatch (%08X %08X) -> custom HT3 bg disabled", rt[0], rt[1]);
        logf("ring type hook @0x216530: %d (direct b; type_01/bg only when HT3 + both SD files)", hRing);
    }
    // Title hooks are optional: a failure here must not disable HT3 / Double Hell / Multi.
    {
        const uint32_t* gm = reinterpret_cast<const uint32_t*>(gBase + oGetMessage);
        const uint32_t* cn = reinterpret_cast<const uint32_t*>(gBase + oCachedName);
        bool hMsg = false, hName = false;
        if (gm[0] == 0xA9BD7BFD && gm[1] == 0xF9000BF5)
            hMsg = getMessageHook.installAtOffset(main, oGetMessage).succeeded();
        else if (looksHooked(gm[0]))
            logf("GetMessage @0x4EFE80 already hooked by another module (%08X) -> title hook skipped", gm[0]);
        else
            logf("GetMessage @0x4EFE80 signature mismatch (%08X %08X) -> title hook skipped", gm[0], gm[1]);
        if (cn[0] == 0x7100081F && cn[1] == 0x54000220)
            hName = cachedNameHook.installAtOffset(main, oCachedName).succeeded();
        else if (looksHooked(cn[0]))
            logf("cachedName @0x2BD0 already hooked by another module (%08X) -> title hook skipped", cn[0]);
        else
            logf("cachedName @0x2BD0 signature mismatch (%08X %08X) -> title hook skipped", cn[0], cn[1]);
        bool hStash = false, hPro = false, hLoad = false;
        const uint32_t* sn = reinterpret_cast<const uint32_t*>(gBase + oStashName);
        if (sn[0] == 0xA9BE7BFD && sn[1] == 0xA9014FF4)
            hStash = stashNameHook.installAtOffset(main, oStashName).succeeded();
        else if (looksHooked(sn[0]))
            logf("stashName @0x206D00 already hooked by another module (%08X) -> stash hook skipped", sn[0]);
        else
            logf("stashName @0x206D00 signature mismatch (%08X %08X) -> stash hook skipped", sn[0], sn[1]);
        const uint32_t* pr = reinterpret_cast<const uint32_t*>(gBase + oPrologueCtor);
        if (pr[0] == 0xA9BC7BFD && pr[1] == 0xA9015FF8)
            hPro = prologueCtorHook.installAtOffset(main, oPrologueCtor).succeeded();
        else if (looksHooked(pr[0]))
            logf("prologueCtor @0x206DE0 already hooked by another module (%08X) -> skipped", pr[0]);
        else
            logf("prologueCtor @0x206DE0 signature mismatch (%08X %08X) -> skipped", pr[0], pr[1]);
        const uint32_t* mi = reinterpret_cast<const uint32_t*>(gBase + oMapInfo);
        bool hMap = false;
        if (mi[0] == 0xA9BB7BFD && mi[1] == 0xA90167FA)
            hMap = mapInfoHook.installAtOffset(main, oMapInfo).succeeded();
        else if (looksHooked(mi[0]))
            logf("mapInfo @0x1D0130 already hooked by another module (%08X) -> map title skipped", mi[0]);
        else
            logf("mapInfo @0x1D0130 signature mismatch (%08X %08X) -> map title skipped", mi[0], mi[1]);
        logf("map title hook: mapInfo=%d", hMap);
        const uint32_t* lc = reinterpret_cast<const uint32_t*>(gBase + oLoadComplete);
        if (lc[0] == 0xA9BE7BFD && lc[1] == 0xA9014FF4)
            hLoad = loadCompleteHook.installAtOffset(main, oLoadComplete).succeeded();
        else if (looksHooked(lc[0]))
            logf("loadComplete @0x504720 already hooked by another module (%08X) -> sky-at-load skipped", lc[0]);
        else
            logf("loadComplete @0x504720 signature mismatch (%08X %08X) -> sky-at-load skipped", lc[0], lc[1]);
        bool hBake = false, hMul = false;
        const uint32_t* bk = reinterpret_cast<const uint32_t*>(gBase + oLayoutBake);
        if (bk[0] == 0xA9BB7BFD && bk[1] == 0xF9000BF9)
            hBake = layoutBakeHook.installAtOffset(main, oLayoutBake).succeeded();
        else if (looksHooked(bk[0]))
            logf("layoutBake @0x4F40A0 already hooked by another module (%08X) -> skipped", bk[0]);
        else
            logf("layoutBake @0x4F40A0 signature mismatch (%08X %08X) -> skipped", bk[0], bk[1]);
        const uint32_t* mc = reinterpret_cast<const uint32_t*>(gBase + oMulColor);
        if (mc[0] == 0xA9BD7BFD && mc[1] == 0xF9000BF5)
            hMul = mulColorHook.installAtOffset(main, oMulColor).succeeded();
        else if (looksHooked(mc[0]))
            logf("mulColor @0x4F3480 already hooked by another module (%08X) -> HT3 sky stays native", mc[0]);
        else
            logf("mulColor @0x4F3480 signature mismatch (%08X %08X) -> HT3 sky stays native", mc[0], mc[1]);
        logf("title hook: GetMessage=%d cachedName=%d stashName=%d prologueCtor=%d loadComplete=%d",
             hMsg, hName, hStash, hPro, hLoad);
        logf("sky hook: layoutBake=%d mulColor=%d (atlas[57] multiply, HT3 only)", hBake, hMul);
    }
    installMulti(main);
   
}
