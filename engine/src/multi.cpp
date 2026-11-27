// Groove Engine v0.3 - GTLM parser. Own code.
#include "multi.hpp"
#include "cuefns.hpp"
#include "numparse.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace groove {

namespace {
constexpr int kPoolSize = 8192;
char sPool[kPoolSize];
int sPoolUsed = 0;

const char* intern(const char* s) {
    int len = (int)strlen(s);
    for (int i = 0; i < sPoolUsed;) {
        int l = (int)strlen(sPool + i);
        if (l == len && memcmp(sPool + i, s, len) == 0) return sPool + i;
        i += l + 1;
    }
    if (sPoolUsed + len + 1 > kPoolSize) return nullptr;
    char* d = sPool + sPoolUsed;
    memcpy(d, s, len + 1);
    sPoolUsed += len + 1;
    return d;
}

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r'; }

constexpr int kMaxTok = 10;
int tokenize(char* line, char* tok[kMaxTok]) {
    int n = 0;
    char* p = line;
    while (*p && n < kMaxTok) {
        while (isSpace(*p)) p++;
        if (!*p) break;
        tok[n++] = p;
        while (*p && !isSpace(*p)) p++;
        if (*p) *p++ = 0;
    }
    return n;
}

bool parseInt(const char* s, int& out) { return parseIntStrict(s, out); }
bool parseFloat(const char* s, float& out) { return parseFloatStrict(s, out); }

bool validName(const char* s) {
    int n = 0;
    for (; *s; s++, n++) {
        char c = *s;
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return false;
    }
    return n > 0 && n < 48;
}
} // namespace

int gameIndex(const char* name) {
    for (int i = 0; i < kGameNames; i++)
        if (strcmp(kGameName[i], name) == 0) return i;
    return -1;
}

static int useGame(MultiTimeline& tl, int g) {
    for (int i = 0; i < tl.gameCount; i++)
        if (tl.games[i] == g) return i;
    if (tl.gameCount >= kMaxMGames) return -1;
    tl.games[tl.gameCount] = (uint8_t)g;
    return tl.gameCount++;
}

#define FAIL(...) do { snprintf(tl.error, sizeof(tl.error), __VA_ARGS__); return false; } while (0)

bool parseMulti(MultiTimeline& tl, const char* text, long size) {
    tl.valid = false;
    tl.ticksPerBeat = 480; tl.bgm = 0x8B; tl.startTick = 2880; tl.transLen = 960; tl.swing = 120;
    tl.endTick = tl.finishTick = -1; tl.endFade = 960; tl.resultsMode = 1;
    tl.matchWorld = -1; tl.matchCol = 9; tl.matchRow = 4;
    tl.gameCount = 0; tl.firstGame = -1;
    tl.count = tl.calls = tl.switches = tl.fades = tl.anims = 0;
    tl.error[0] = 0;
    tl.title[0] = 0;
    tl.prologue[0] = 0;
    tl.jingle = -1;
    static char line[256];
    long pos = 0;
    int lineNo = 0;
    bool header = false;
    int last = 0;
    while (pos < size) {
        int len = 0;
        while (pos < size && text[pos] != '\n') {
            if (len < (int)sizeof(line) - 1) line[len++] = text[pos];
            pos++;
        }
        pos++;
        line[len] = 0;
        lineNo++;
        for (int i = 0; i < len; i++)
            if (line[i] == '#') { line[i] = 0; break; }
        char* start = line;
        while (isSpace(*start)) start++;
        if (header && !strncmp(start, "title", 5) && (start[5] == 0 || isSpace(start[5]))) {
            char* p = start + 5;
            while (isSpace(*p)) p++;
            char* e = p + strlen(p);
            while (e > p && isSpace(e[-1])) --e;
            *e = 0;
            tl.title[0] = 0;
            if (*p) {
                size_t ntitle = strlen(p);
                if (ntitle >= sizeof(tl.title)) ntitle = sizeof(tl.title) - 1;
                memcpy(tl.title, p, ntitle);
                tl.title[ntitle] = 0;
            }
            continue;
        }
        char* tok[kMaxTok];
        int n = tokenize(line, tok);
        if (n == 0) continue;
        if (!header) {
            if (strcmp(tok[0], "GTLM") != 0 || n < 2 || strcmp(tok[1], "1") != 0) FAIL("line %d: header GTLM 1 missing", lineNo);
            header = true;
            continue;
        }
        const char* k = tok[0];
        int v = 0;
        if (!strcmp(k, "ticks_per_beat")) {
            if (n < 2 || !parseInt(tok[1], v) || v != 480) FAIL("line %d: ticks_per_beat must be 480", lineNo);
        } else if (!strcmp(k, "bgm")) {
            if (n < 2 || !parseInt(tok[1], tl.bgm) || tl.bgm < 0 || tl.bgm > 0xFFFF) FAIL("line %d: bad bgm", lineNo);
        } else if (!strcmp(k, "start")) {
            if (n < 2 || !parseInt(tok[1], tl.startTick) || tl.startTick < 0) FAIL("line %d: bad start", lineNo);
        } else if (!strcmp(k, "translen")) {
            if (n < 2 || !parseInt(tok[1], tl.transLen) || tl.transLen < 0 || tl.transLen > 7680) FAIL("line %d: bad translen", lineNo);
        } else if (!strcmp(k, "swing")) {
            if (n < 2 || !parseInt(tok[1], tl.swing)) FAIL("line %d: bad swing", lineNo);
        } else if (!strcmp(k, "results")) {
            if (n < 2) FAIL("line %d: results native|exit", lineNo);
            if (!strcmp(tok[1], "native")) tl.resultsMode = 1;
            else if (!strcmp(tok[1], "exit")) tl.resultsMode = 0;
            else FAIL("line %d: results native|exit", lineNo);
        } else if (!strcmp(k, "prologue")) {
            if (n < 2 || strlen(tok[1]) >= sizeof(tl.prologue)) FAIL("line %d: prologue type_XX|path", lineNo);
            memcpy(tl.prologue, tok[1], strlen(tok[1]) + 1);
        } else if (!strcmp(k, "jingle")) {
            // Out-of-range ids are ignored here (native jingle kept; the stash hook logs it).
            if (n < 2 || !parseInt(tok[1], tl.jingle) || tl.jingle < 0x158 || tl.jingle > 0x16C) tl.jingle = -1;
        } else if (!strcmp(k, "match")) {
            if (n < 4 || !parseInt(tok[1], tl.matchWorld) || !parseInt(tok[2], tl.matchCol) || !parseInt(tok[3], tl.matchRow))
                FAIL("line %d: match WORLD COL ROW", lineNo);
        } else if (!strcmp(k, "end")) {
            if (n < 2 || !parseInt(tok[1], tl.endTick) || (n > 2 && !parseInt(tok[2], tl.endFade))) FAIL("line %d: bad end", lineNo);
        } else if (!strcmp(k, "finish")) {
            if (n < 2 || !parseInt(tok[1], tl.finishTick)) FAIL("line %d: bad finish", lineNo);
        } else if (!strcmp(k, "first")) {
            int g = n > 1 ? gameIndex(tok[1]) : -1;
            if (g < 0) FAIL("line %d: unknown game", lineNo);
            if (useGame(tl, g) < 0) FAIL("line %d: more than %d games", lineNo, kMaxMGames);
            tl.firstGame = g;
        } else if (!strcmp(k, "X") || !strcmp(k, "W") || !strcmp(k, "F") || !strcmp(k, "A")) {
            if (tl.count >= kMaxMEvents) FAIL("line %d: too many events", lineNo);
            MEvent& e = tl.ev[tl.count];
            memset(&e, 0, sizeof(e));
            e.style = -1;
            if (n < 2 || !parseInt(tok[1], e.tick) || e.tick < 0) FAIL("line %d: bad tick", lineNo);
            if (e.tick < last) FAIL("line %d: events must be sorted by tick", lineNo);
            if (k[0] == 'F') {
                if (n < 4 || !parseInt(tok[2], e.len) || e.len < 0 || !parseFloat(tok[3], e.alpha) || e.alpha < 0.f || e.alpha > 1.f)
                    FAIL("line %d: F TICK TICKS ALPHA(0..1)", lineNo);
                e.op = MOp::Fade;
                tl.fades++;
            } else {
                int g = n > 2 ? gameIndex(tok[2]) : -1;
                if (g < 0) FAIL("line %d: unknown game %s", lineNo, n > 2 ? tok[2] : "?");
                if (useGame(tl, g) < 0) FAIL("line %d: more than %d games", lineNo, kMaxMGames);
                e.game = (uint8_t)g;
                if (k[0] == 'X') {
                    int off = 0;
                    if (n < 4 || !parseInt(tok[3], off)) FAIL("line %d: X TICK GAME FN [a b c d] [tag]", lineNo);
                    e.fn = -1;
                    for (int i = 0; i < kCueFnCount; i++)
                        if (kCueFns[i].off == (uint32_t)off && kCueFns[i].game == g) { e.fn = (int16_t)i; break; }
                    if (e.fn < 0) FAIL("line %d: function 0x%X is not an allowed %s cue", lineNo, off, tok[2]);
                    int ai = 0, ti = 4;
                    if (kCueFns[e.fn].kind == 1) {
                        if (n < 5) FAIL("line %d: %s needs a word (TEA|SODA|COCOA|AAA)", lineNo, tok[2]);
                        for (int w = 0; w < kTheAWordCount; w++)
                            if (!strcmp(tok[4], kTheAWords[w])) e.word = kTheAWords[w];
                        if (!e.word) FAIL("line %d: word must be TEA|SODA|COCOA|AAA", lineNo);
                        ti = 5; ai = 4;
                    }
                    for (; ti < n && ai < 4; ti++, ai++)
                        if (!parseInt(tok[ti], e.a[ai])) break;
                    if (ti < n) {
                        if (ti != n - 1 || !validName(tok[ti])) FAIL("line %d: bad argument/tag", lineNo);
                        if (strcmp(tok[ti], "-") != 0) {
                            e.str = intern(tok[ti]);
                            if (!e.str) FAIL("line %d: string pool full", lineNo);
                        }
                    }
                    e.op = MOp::Call;
                    tl.calls++;
                } else if (k[0] == 'W') {
                    e.op = MOp::Switch;
                    e.sub = 2;
                    if (n > 3) {
                        int st = 0;
                        if (!strcmp(tok[3], "cut")) st = -1;
                        else if (!parseInt(tok[3], st) || st < 0 || st > 2) FAIL("line %d: style cut|0|1|2", lineNo);
                        e.style = (int8_t)st;
                    } else {
                        e.style = 0;
                    }
                    if (n > 4) {
                        int sb = 0;
                        if (!parseInt(tok[4], sb) || sb < 1 || sb > 2) FAIL("line %d: sub 1|2", lineNo);
                        e.sub = (int8_t)sb;
                    }
                    tl.switches++;
                } else {  // A
                    if (n < 5 || !parseInt(tok[3], e.len) || e.len < 0x100 || e.len > 0x10000 || (e.len & 7) || !validName(tok[4]))
                        FAIL("line %d: A TICK GAME LAYOUT_OFF NAME", lineNo);
                    e.str = intern(tok[4]);
                    if (!e.str) FAIL("line %d: string pool full", lineNo);
                    e.op = MOp::Anim;
                    tl.anims++;
                }
            }
            last = e.tick;
            tl.count++;
        } else {
            FAIL("line %d: unknown key '%s'", lineNo, k);
        }
    }
    if (!header) FAIL("empty file");
    if (tl.gameCount == 0) FAIL("no games used");
    if (tl.calls == 0) FAIL("no cue calls");
    if (tl.firstGame < 0) tl.firstGame = tl.games[0];
    if (tl.endTick <= 0) FAIL("end missing");
    if (tl.finishTick < tl.endTick) FAIL("finish missing or before end");
    if (tl.startTick > tl.endTick) FAIL("start after end");
    if (last > tl.endTick) FAIL("events after end (%d > %d)", last, tl.endTick);
    tl.valid = true;
    return true;
}

} // namespace groove
