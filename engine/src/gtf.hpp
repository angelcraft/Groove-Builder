// Groove Tickflow (.gtf) parser. Compiles to the same MultiTimeline as GTLM 1.
// Freestanding / no STL. Own code; timing and cue names only.
#pragma once
#include "multi.hpp"

namespace groove {

bool parseGtf(MultiTimeline& tl, const char* text, long size);

// Sniff the buffer: "GTLM 1" -> parseMulti, otherwise parseGtf.
bool parseTimeline(MultiTimeline& tl, const char* text, long size);

// Compact snapshot for tests (avoids depending on MultiTimeline padding).
constexpr int kTlViewEv = 64;
struct TimelineView {
    int valid, start, transLen, end, endFade, finish, results, first;
    int matchW, matchC, matchR, bgm, jingle, swing;
    int count, calls, switches, fades, anims, gameCount;
    char title[96];
    char prologue[96];
    uint8_t games[kMaxMGames];
    int evTick[kTlViewEv];
    uint8_t evOp[kTlViewEv];
    uint8_t evGame[kTlViewEv];
    int8_t evStyle[kTlViewEv];
    int8_t evSub[kTlViewEv];
    int evFn[kTlViewEv];
    int evA[kTlViewEv][4];
    char evTag[kTlViewEv][48];
    char evWord[kTlViewEv][8];
    int evLen[kTlViewEv];
    float evAlpha[kTlViewEv];
    char evAnim[kTlViewEv][48];
};

void fillTimelineView(const MultiTimeline& tl, TimelineView& v);

} // namespace groove
