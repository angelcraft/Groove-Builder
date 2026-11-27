// Groove Engine v0.3 - multi-game timeline (.gtl "GTLM 1") hosted on REMIX_21.
// Own code; timing/event data only.
#pragma once
#include <cstdint>

namespace groove {

enum class MOp : uint8_t { Call = 1, Switch = 2, Fade = 3, Anim = 4 };

struct MEvent {
    int32_t tick;
    MOp op;
    uint8_t game;      // index into kGameName (Call/Switch/Anim)
    int8_t style;      // Switch: -1 = cut (0x4D7B40), 0..2 = styled transition kinds
    int8_t sub;        // Switch: styled sub argument (1 or 2)
    int16_t fn;        // Call: index into kCueFns
    int32_t a[4];      // Call: x2..x5
    int32_t len;       // Fade: ticks ; Anim: layout pointer offset inside the scene
    float alpha;       // Fade
    const char* str;   // Call: rating tag (nullptr = none) ; Anim: animation name
    const char* word;  // Call kind 1: word argument (static kTheAWords entry)
};

constexpr int kMaxMGames = 24;    // distinct games per timeline (all REMIX_21 scenes; 8 cue threads round-robin)
constexpr int kMaxMEvents = 2048;

struct MultiTimeline {
    bool valid = false;
    int ticksPerBeat = 480;
    int bgm = 0x8B;               // REMIX_21's own song by default
    int startTick = 2880;         // startGameplay (native REMIX_21: 0x3C0 + one bar)
    int transLen = 960;           // setTransLen
    int swing = 120;
    int endTick = -1, endFade = 960, finishTick = -1;
    int resultsMode = 0;          // 1 = native toResults (REMIX_21 record), 0 = exit to menu
    int matchWorld = -1, matchCol = 9, matchRow = 4;
    int gameCount = 0;
    uint8_t games[kMaxMGames];    // kGameName indices in order of first use
    int firstGame = -1;           // kGameName index shown at start
    int count = 0, calls = 0, switches = 0, fades = 0, anims = 0;
    MEvent ev[kMaxMEvents];
    char title[96];  // optional `title <text>` (rest of line)
    char prologue[96];  // optional `prologue type_XX|path` (applied by the stash hook)
    int jingle;         // optional `jingle ID` (-1 = native)
    char error[128];
};

int gameIndex(const char* name);   // kGameName index or -1
bool parseMulti(MultiTimeline& tl, const char* text, long size);

} // namespace groove
