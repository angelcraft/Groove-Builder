// Groove Engine v0.3 - GTLM parser. Own code.
#include "multi.hpp"
#include "cuefns.hpp"
#include "numparse.hpp"
#include "parser_support.hpp"
#include "cue_validation.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace groove {

namespace {
PersistentStrings<8192> sStrings;
const char* intern(const char* s) { return sStrings.intern(s, static_cast<int>(strlen(s))); }

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r'; }

constexpr int kMaxTok = kMaxTokens;
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
    while (isSpace(*p)) ++p;
    return *p ? -1 : n;
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
    if (!name) return -1;
    char key[80]; size_t n=strlen(name);
    if (n>=sizeof(key)) return -1;
    for (size_t i=0;i<=n;++i) key[i]=(name[i]>='A' && name[i]<='Z') ? name[i]+32 : name[i];
    for (int i=0;i<kGameNames;++i) {
        bool same=true;
        for (size_t j=0;j<=n;++j) { char c=kGameName[i][j]; if (c>='A' && c<='Z') c+=32; if (c!=key[j]) { same=false;break; } if (!c) break; }
        if (same) return i;
    }
    for (const auto& alias:gtfcat::kGameAliases) if (!strcmp(alias.name,key)) return alias.game;
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
    ParseGuard guard;
    if (!guard.held) return false;
    StringTransaction<8192> strings(sStrings);
    tl.valid = false;
    tl.ticksPerBeat = 480; tl.bgm = 0x8B; tl.startTick = 2880; tl.transLen = 960; tl.swing = 120;
    tl.endTick = tl.finishTick = -1; tl.endFade = 960; tl.resultsMode = 0;
    tl.matchWorld = -1; tl.matchCol = 9; tl.matchRow = 4;
    tl.gameCount = 0; tl.firstGame = -1;
    tl.count = tl.calls = tl.switches = tl.fades = tl.anims = 0;
    tl.error[0] = 0;
    tl.title[0] = 0;
    tl.prologue[0] = 0;
    tl.jingle = -1;
    if (!validSource(text, size, tl.error, sizeof(tl.error))) return false;
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
                if (ntitle >= sizeof(tl.title)) FAIL("line %d: title too long",lineNo);
                memcpy(tl.title, p, ntitle);
                tl.title[ntitle] = 0;
            }
            continue;
        }
        char* tok[kMaxTok];
        int n = tokenize(line, tok);
        if (n < 0) { snprintf(tl.error, sizeof(tl.error), "line %d: too many tokens", lineNo); return false; }
        if (n == 0) continue;
        if (!header) {
            if (strcmp(tok[0], "GTLM") != 0 || n != 2 || strcmp(tok[1], "1") != 0) FAIL("line %d: header GTLM 1 missing", lineNo);
            header = true;
            continue;
        }
        const char* k = tok[0];
        int max=2,min=2;
        if (!strcmp(k,"match")) min=max=4;
        else if (!strcmp(k,"end")) max=3;
        else if (!strcmp(k,"X")) { min=4;max=9; }
        else if (!strcmp(k,"W")) { min=3;max=5; }
        else if (!strcmp(k,"F")) min=max=4;
        else if (!strcmp(k,"A")) min=max=5;
        if (n<min || n>max) FAIL("line %d: wrong argument count",lineNo);
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
            else if (!strcmp(tok[1], "exit") || !strcmp(tok[1], "custom")) tl.resultsMode = 0;
            else FAIL("line %d: results native|exit", lineNo);
        } else if (!strcmp(k, "prologue")) {
            if (n < 2 || strlen(tok[1]) >= sizeof(tl.prologue) || !validPrologue(tok[1])) FAIL("line %d: prologue type_XX|path", lineNo);
            memcpy(tl.prologue, tok[1], strlen(tok[1]) + 1);
        } else if (!strcmp(k, "jingle")) {
            // Invalid metadata must not be applied independently of the timeline.
            if (n < 2 || !parseInt(tok[1], tl.jingle) || tl.jingle < 0x158 || tl.jingle > 0x16C) FAIL("line %d: bad jingle", lineNo);
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
                    if (kCueFns[e.fn].kind==1 && ti<n && numericLiteral(tok[ti])) FAIL("line %d: word cue has no integer arguments",lineNo);
                    for (; ti < n && ai < 4; ti++, ai++)
                        if (!parseInt(tok[ti], e.a[ai])) break;
                    if (ti < n) {
                        if (numericLiteral(tok[ti]) || ti != n - 1 || (strcmp(tok[ti],"-") && !validName(tok[ti]))) FAIL("line %d: bad argument/tag", lineNo);
                        if (strcmp(tok[ti], "-") != 0) {
                            e.str = intern(tok[ti]);
                            if (!e.str) FAIL("line %d: string pool full", lineNo);
                        }
                    }
                    if (!validCueArgs(g,kCueFns[e.fn].off,e.a)) FAIL("line %d: cue arguments not in verified domain",lineNo);
                    e.op = MOp::Call;
                    tl.calls++;
                } else if (k[0] == 'W') {
                    e.op = MOp::Switch;
                    e.sub = 2;
                    if (n > 3) {
                        int st = 0;
                        if (!strcmp(tok[3], "cut") || !strcmp(tok[3], "hard")) st = -1;
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
                    if (n != 5 || !parseInt(tok[3], e.len) || !validLayout(g,e.len) || !validName(tok[4]))
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
    if (!validMatch(tl.matchWorld, tl.matchCol, tl.matchRow) || tl.endFade < 0) FAIL("invalid match or end fade");
    if (tl.endTick <= 0) FAIL("end missing");
    if (tl.finishTick < tl.endTick) FAIL("finish missing or before end");
    if (tl.startTick > tl.endTick) FAIL("start after end");
    if (last > tl.endTick) FAIL("events after end (%d > %d)", last, tl.endTick);
    strings.commit = true;
    tl.valid = true;
    return true;
}

} // namespace groove
