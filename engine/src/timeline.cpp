// Groove Engine HT3 - .gtl parser. Own code.
#include "timeline.hpp"
#include "numparse.hpp"
#include "parser_support.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace groove {

namespace {
// Static string interning: the game may keep pointers to comment tags, so
// every string we hand to it lives for the whole process.
PersistentStrings<4096> sStrings;
const char* intern(const char* s, int len) { return sStrings.intern(s, len); }

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r'; }

// splits a line into up to 4 tokens
int tokenize(char* line, char* tok[4]) {
    int n = 0;
    char* p = line;
    while (*p && n < 4) {
        while (isSpace(*p)) p++;
        if (!*p) break;
        tok[n++] = p;
        while (*p && !isSpace(*p)) p++;
        if (*p) *p++ = 0;
    }
    while (isSpace(*p)) ++p;
    return *p ? -1 : n;
}

bool parseInt(const char* s, int& out) { return parseIntStrict(s, out); }
} // namespace

bool parseTimeline(Timeline& tl, const char* text, long size) {
    ParseGuard guard;
    if (!guard.held) return false;
    StringTransaction<4096> strings(sStrings);
    tl.valid = false;
    tl.ticksPerBeat = 480;
    tl.cueCount = tl.bgCount = tl.hoops = tl.comments = 0;
    tl.error[0] = 0;
    tl.title[0] = 0;
    tl.partCount = 1;
    tl.bgm = 0x40;
    tl.endTick = tl.finishTick = -1;
    tl.endFade = 480;
    tl.resultsMode = 0;
    tl.matchWorld = -1; tl.matchCol = 9; tl.matchRow = 0;
    for (Part& p : tl.parts) p = Part{};
    bool explicitParts = false;
    int cur = 0;  // current part index
    if (!validSource(text, size, tl.error, sizeof(tl.error))) return false;
    static char line[256];
    long pos = 0;
    int lineNo = 0;
    bool header = false;
    int lastCue = -1, lastBg = -1;
    while (pos < size) {
        int len = 0;
        while (pos < size && text[pos] != '\n') {
            if (len < (int)sizeof(line) - 1) line[len++] = text[pos];
            pos++;
        }
        pos++;
        line[len] = 0;
        lineNo++;
        char* hash = strchr(line, '#');
        if (hash) *hash = 0;
        char* start = line;
        while (isSpace(*start)) start++;
        // `title` takes the rest of the line (spaces allowed). Must run before tokenize.
        if (header && !strncmp(start, "title", 5) && (start[5] == 0 || isSpace(start[5]))) {
            char* p = start + 5;
            while (isSpace(*p)) p++;
            char* e = p + strlen(p);
            while (e > p && isSpace(e[-1])) --e;
            *e = 0;
            tl.title[0] = 0;
            if (*p) {
                size_t ntitle = strlen(p);
                if (ntitle >= sizeof(tl.title)) { snprintf(tl.error,sizeof(tl.error),"title too long"); return false; }
                memcpy(tl.title, p, ntitle);
                tl.title[ntitle] = 0;
            }
            continue;
        }
        char* tok[4] = {};
        int n = tokenize(line, tok);
        if (n < 0) { snprintf(tl.error, sizeof(tl.error), "line %d: too many tokens", lineNo); return false; }
        if (n == 0) continue;
        if (!header) {
            if (strcmp(tok[0], "GTL1") != 0 || n != 1) {
                snprintf(tl.error, sizeof(tl.error), "line %d: missing GTL1 header", lineNo);
                return false;
            }
            header = true;
            continue;
        }
        int expected=0;
        if (!strcmp(tok[0],"part")) { if (n<2 || n>4) expected=-1; }
        else if (!strcmp(tok[0],"match")) expected=4;
        else if (!strcmp(tok[0],"end") || !strcmp(tok[0],"H") || !strcmp(tok[0],"C") || !strcmp(tok[0],"A")) expected=3;
        else expected=2;
        if (expected<0 || (expected && expected!=n)) { snprintf(tl.error,sizeof(tl.error),"wrong argument count"); return false; }
        int a = 0, b = 0;
        const char* k = tok[0];
        if (!strcmp(k, "ticks_per_beat") && n >= 2 && parseInt(tok[1], a)) tl.ticksPerBeat = a;
        else if (!strcmp(k, "bgm") && n >= 2 && parseInt(tok[1], a)) { tl.bgm = a; if (!explicitParts) tl.parts[0].bgm = a; }
        else if (!strcmp(k, "part") && n >= 2 && parseInt(tok[1], a)) {
            // part <bgm> [next preload]  (next/preload only for non-last parts)
            if (explicitParts) {
                if (tl.partCount >= kMaxParts) { snprintf(tl.error, sizeof(tl.error), "line %d: too many parts", lineNo); return false; }
                cur = tl.partCount++;
            } else if (tl.cueCount || tl.bgCount) {
                snprintf(tl.error, sizeof(tl.error), "line %d: events before first part", lineNo); return false;
            }
            explicitParts = true;
            Part& p = tl.parts[cur];
            p = Part{};
            p.bgm = a;
            p.cueFirst = tl.cueCount; p.bgFirst = tl.bgCount;
            if (n >= 3 && !parseInt(tok[2], p.next)) { snprintf(tl.error, sizeof(tl.error), "line %d: bad next", lineNo); return false; }
            if (n >= 4 && !parseInt(tok[3], p.preload)) { snprintf(tl.error, sizeof(tl.error), "line %d: bad preload", lineNo); return false; }
            if (cur == 0) tl.bgm = a;
            lastCue = lastBg = -1;
        }
        else if (!strcmp(k, "results") && n == 2) {
            if (!strcmp(tok[1], "native")) tl.resultsMode = 1;
            else if (!strcmp(tok[1], "exit") || !strcmp(tok[1], "custom")) tl.resultsMode = 0;
            else { snprintf(tl.error, sizeof(tl.error), "bad results mode"); return false; }
        }
        else if (!strcmp(k, "match") && n >= 4 && parseInt(tok[1], tl.matchWorld) && parseInt(tok[2], tl.matchCol) && parseInt(tok[3], tl.matchRow)) {}
        else if (!strcmp(k, "end") && n >= 3 && parseInt(tok[1], a) && parseInt(tok[2], b)) { tl.endTick = a; tl.endFade = b; }
        else if (!strcmp(k, "finish") && n >= 2 && parseInt(tok[1], a)) tl.finishTick = a;
        else if ((!strcmp(k, "H") || !strcmp(k, "C")) && n >= 3 && parseInt(tok[1], a)) {
            if (tl.cueCount >= kMaxCue || a < lastCue) {
                snprintf(tl.error, sizeof(tl.error), "line %d: cue overflow/unsorted", lineNo);
                return false;
            }
            Event& e = tl.cue[tl.cueCount];
            if (a < 0) { snprintf(tl.error, sizeof(tl.error), "negative tick"); return false; }
            e.tick = a; e.part = (uint8_t)cur;
            tl.parts[cur].cueCount++;
            if (k[0] == 'H') {
                if (!parseInt(tok[2], b) || b < -1 || b > 15) {
                    snprintf(tl.error, sizeof(tl.error), "line %d: bad mask", lineNo);
                    return false;
                }
                e.op = Op::Hoop; e.mask = b; e.str = nullptr; tl.hoops++; tl.parts[cur].hoops++;
            } else {
                e.op = Op::Comment; e.mask = 0;
                e.str = intern(tok[2], (int)strlen(tok[2]));
                if (!e.str) { snprintf(tl.error, sizeof(tl.error), "string pool full"); return false; }
                tl.comments++;
            }
            lastCue = a;
            tl.cueCount++;
        } else if ((!strcmp(k, "A") && n >= 3) || (!strcmp(k, "S") && n >= 2)) {
            if (!parseInt(tok[1], a) || tl.bgCount >= kMaxBg || a < lastBg) {
                snprintf(tl.error, sizeof(tl.error), "line %d: bad bg event", lineNo);
                return false;
            }
            Event& e = tl.bg[tl.bgCount];
            if (a < 0) { snprintf(tl.error, sizeof(tl.error), "negative tick"); return false; }
            e.tick = a; e.mask = 0; e.part = (uint8_t)cur;
            tl.parts[cur].bgCount++;
            if (k[0] == 'A') {
                e.op = Op::LayoutAnim;
                e.str = intern(tok[2], (int)strlen(tok[2]));
                if (!e.str) { snprintf(tl.error, sizeof(tl.error), "string pool full"); return false; }
            } else { e.op = Op::Stars; e.str = nullptr; }
            lastBg = a;
            tl.bgCount++;
        } else {
            snprintf(tl.error, sizeof(tl.error), "line %d: unknown '%s'", lineNo, k);
            return false;
        }
    }
    if (tl.ticksPerBeat != 480 || tl.bgm < 0 || tl.bgm > 65535 || tl.endFade < 0 || !validMatch(tl.matchWorld, tl.matchCol, tl.matchRow)) { snprintf(tl.error, sizeof(tl.error), "invalid metadata"); return false; }
    for (int i=0; i<tl.partCount; ++i) if (tl.parts[i].bgm<0 || tl.parts[i].bgm>65535) { snprintf(tl.error,sizeof(tl.error),"bad part bgm"); return false; }
    const Part& lastPart=tl.parts[tl.partCount-1];
    if (lastPart.bgCount && tl.bg[lastPart.bgFirst+lastPart.bgCount-1].tick>tl.endTick) { snprintf(tl.error,sizeof(tl.error),"bg after end"); return false; }
    if (!header) { snprintf(tl.error, sizeof(tl.error), "empty file"); return false; }
    if (tl.endTick <= 0 || tl.finishTick < tl.endTick) { snprintf(tl.error, sizeof(tl.error), "end/finish missing or invalid"); return false; }
    if (lastPart.cueCount && tl.cue[lastPart.cueFirst+lastPart.cueCount-1].tick > tl.endTick) { snprintf(tl.error, sizeof(tl.error), "cue after end"); return false; }
    for (int i = 0; i + 1 < tl.partCount; i++) {
        Part& p = tl.parts[i];
        if (p.next <= 0) { snprintf(tl.error, sizeof(tl.error), "part %d: missing next", i); return false; }
        if (p.preload < 0 || p.preload > p.next) p.preload = p.next > 960 ? p.next - 960 : 0;
        if (p.cueCount && tl.cue[p.cueFirst + p.cueCount - 1].tick > p.preload) { snprintf(tl.error, sizeof(tl.error), "part %d: cue after preload", i); return false; }
        if (p.bgCount && tl.bg[p.bgFirst + p.bgCount - 1].tick > p.next) { snprintf(tl.error, sizeof(tl.error), "part %d: bg after next", i); return false; }
    }
    if (tl.partCount == 1 && !explicitParts) { tl.parts[0].cueCount = tl.cueCount; tl.parts[0].bgCount = tl.bgCount; tl.parts[0].hoops = tl.hoops; }
    if (tl.hoops == 0) { snprintf(tl.error, sizeof(tl.error), "no hoops"); return false; }
    strings.commit = true;
    tl.valid = true;
    return true;
}

} // namespace groove
