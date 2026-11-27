// Groove Engine HT3 - compact timeline (.gtl) model. Own code; no game data.
#pragma once
#include <cstdint>

namespace groove {

enum class Op : uint8_t { Hoop = 1, Comment = 2, LayoutAnim = 3, Stars = 4 };

struct Event {
    int32_t tick;
    Op op;
    int32_t mask;     // Hoop: bits b0..b3, or -1 (native special value, used by HT2 itself)
    const char* str;  // Comment tag / LayoutAnim name (points into static pools)
    uint8_t part;     // v0.2: song part this event belongs to (ticks are relative to that part)
};

// v0.2 (Double Hell): a timeline may chain several songs ("parts") inside ONE
// gameplay session. Each part starts its own BGM with the native playBgm path
// and has its own cue clock (tick 0 = right after its playBgm returns).
constexpr int kMaxParts = 4;
struct Part {
    int bgm = 0x40;
    int next = -1;      // non-last parts: tick (this part's clock) at which the next part's BGM is started
    int preload = -1;   // non-last parts: tick at which the next BGM is loaded (initSm + prepareSm)
    int cueFirst = 0, cueCount = 0, bgFirst = 0, bgCount = 0, hoops = 0;
};

constexpr int kMaxCue = 1024;
constexpr int kMaxBg = 256;

struct Timeline {
    bool valid = false;
    int ticksPerBeat = 480;
    int endTick = -1;       // endGameplay
    int endFade = 480;      // fadeScreen ticks at end
    int finishTick = -1;    // finishGameplaySession
    int resultsMode = 0;    // 0 = exit to menu (no native save), 1 = native toResults
    int matchWorld = -1, matchCol = 9, matchRow = 0;
    int bgm = 0x40;
    int cueCount = 0, bgCount = 0;
    int partCount = 1;  // 1 = classic single-song timeline
    Part parts[kMaxParts];
    int hoops = 0, comments = 0;
    Event cue[kMaxCue];
    Event bg[kMaxBg];
    char title[96];  // optional `title <text>` (rest of line); empty = default
    char error[128];
};

// Parses text in-place-free (copies strings to static pools). Returns valid.
bool parseTimeline(Timeline& tl, const char* text, long size);

} // namespace groove
