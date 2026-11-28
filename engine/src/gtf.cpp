// Groove Tickflow (.gtf) parser for Groove Engine. Own code, no STL.
#include "gtf.hpp"
#include "gtf_cues.hpp"
#include "numparse.hpp"
#include "parser_support.hpp"
#include "cue_validation.hpp"
#include <cstdio>
#include <cstring>
#include <cstdint>

namespace groove {
namespace gtfpriv {

constexpr int kTPB = 480;
constexpr int kMaxLines = 4096;
constexpr int kPoolSize = 65536;
constexpr int kMaxDefs = 32;
constexpr int kMaxTok = 12;
constexpr int kMaxCall = 8;
constexpr int kMaxLoop = 8;
constexpr int kJingleMin = 0x158, kJingleMax = 0x16C;

char sPool[kPoolSize];
int sPoolUsed = 0;
PersistentStrings<65536> sStrings;
const char* internEvent(const char* s, int n) { return sStrings.intern(s, n); }

struct Line { int no; char* s; };
Line sLines[kMaxLines];
int sLineN = 0;

struct Def { char name[48]; int start, end; };
Def sDefs[kMaxDefs];
int sDefN = 0;

int sBodyIdx[kMaxLines];
int sBodyN = 0;

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r'; }
char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }

bool ieq(const char* a, const char* b) {
    if (!a || !b) return false;
    for (; *a || *b; a++, b++)
        if (lower(*a) != lower(*b)) return false;
    return true;
}

bool validName(const char* s, int maxLen = 47) {
    int n = 0;
    if (!s) return false;
    for (; *s; s++, n++) {
        char c = *s;
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'))
            return false;
    }
    return n > 0 && n <= maxLen;
}

char* intern(const char* s, int len) {
    if (sPoolUsed + len + 1 > kPoolSize) return nullptr;
    char* d = sPool + sPoolUsed;
    memcpy(d, s, len);
    d[len] = 0;
    sPoolUsed += len + 1;
    return d;
}

bool stripComment(const char* src, int srcLen, char* dst, int cap, int& outLen) {
    int o = 0;
    bool inStr = false;
    for (int i = 0; i < srcLen; i++) {
        char c = src[i];
        if (inStr) {
            if (o + 1 >= cap) break;
            dst[o++] = c;
            if (c == '\\' && i + 1 < srcLen) {
                if (o + 1 >= cap) break;
                dst[o++] = src[++i];
                continue;
            }
            if (c == '"') inStr = false;
            continue;
        }
        if (c == '"') {
            inStr = true;
            if (o + 1 >= cap) break;
            dst[o++] = c;
            continue;
        }
        if (c == '#' || (c == '/' && i + 1 < srcLen && src[i + 1] == '/')) break;
        if (o + 1 >= cap) break;
        dst[o++] = c;
    }
    while (o > 0 && isSpace(dst[o - 1])) o--;
    dst[o] = 0;
    outLen = o;
    return !inStr;
}

int tokenize(char* line, char* tok[kMaxTok]) {
    int n = 0;
    char* p = line;
    while (*p && n < kMaxTok) {
        while (isSpace(*p)) p++;
        if (!*p) break;
        if (*p == '"') {
            tok[n++] = p;
            p++;
            while (*p && *p != '"') {
                if (*p == '\\' && p[1]) p += 2;
                else p++;
            }
            if (*p == '"') p++;
            if (*p && !isSpace(*p)) return -1;
            if (*p) *p++ = 0;
        } else {
            tok[n++] = p;
            while (*p && !isSpace(*p)) p++;
            if (*p) *p++ = 0;
        }
    }
    while (isSpace(*p)) ++p;
    return *p ? -1 : n;
}

void unquote(char* s) {
    if (!s || s[0] != '"') return;
    int n = (int)strlen(s);
    if (n >= 2 && s[n - 1] == '"') {
        memmove(s, s + 1, n - 2);
        s[n - 2] = 0;
        char* d = s;
        for (char* p = s; *p; p++) {
            if (*p == '\\' && p[1]) *d++ = *++p;
            else *d++ = *p;
        }
        *d = 0;
    }
}

bool isIntTok(const char* s) {
    int v = 0;
    return parseIntStrict(s, v);
}

bool parseDuration(const char* s, int& ticks) {
    if (!s || !*s) return false;
    int n = (int)strlen(s);
    if (n > 1 && (s[n - 1] == 't' || s[n - 1] == 'T')) {
        char tmp[48];
        if (n - 1 >= (int)sizeof(tmp)) return false;
        memcpy(tmp, s, n - 1);
        tmp[n - 1] = 0;
        int v = 0;
        if (!parseIntStrict(tmp, v) || v < 0) return false;
        ticks = v;
        return true;
    }
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) return false;
    if (s[0] == '+' && s[1] == '0' && (s[2] == 'x' || s[2] == 'X')) return false;

    const char* sl = strchr(s, '/');
    if (sl) {
        char a[32], b[32];
        int al = (int)(sl - s), bl = (int)strlen(sl + 1);
        if (al <= 0 || al >= 32 || bl <= 0 || bl >= 32) return false;
        memcpy(a, s, al); a[al] = 0;
        memcpy(b, sl + 1, bl); b[bl] = 0;
        int na = 0, nb = 0;
        if (parseIntStrict(a, na) && parseIntStrict(b, nb) && nb > 0) {
            int64_t num = (int64_t)na * kTPB;
            if (num % nb != 0 || num / nb < 0 || num / nb > 0x7FFFFFFF) return false;
            ticks = (int)(num / nb);
            return true;
        }
        return false;
    }
    const char* dot = strchr(s, '.');
    if (!dot) {
        int beats = 0;
        if (!parseIntStrict(s, beats) || beats < 0) return false;
        if ((int64_t)beats * kTPB > 0x7FFFFFFF) return false;
        ticks = beats * kTPB;
        return true;
    }
    if (*s == '-') return false;
    char ip[32];
    int il = (int)(dot-s), fl = (int)strlen(dot+1);
    if (il >= 32 || fl <= 0) return false;
    if (il == 0) { ip[0]='0'; ip[1]=0; }
    else { memcpy(ip,s,il); ip[il]=0; }
    for (int i=0;i<fl;++i) if (dot[1+i]<'0' || dot[1+i]>'9') return false;
    while (fl>0 && dot[fl]=='0') --fl;
    if (fl>9) return false;
    int whole=0;
    if (!parseIntStrict(ip,whole) || whole<0 || whole>kMaxTick/kTPB) return false;
    int64_t frac=0,scale=1;
    for (int i=0;i<fl;++i) { frac=frac*10+(dot[1+i]-'0'); scale*=10; }
    int64_t num=(int64_t)whole*kTPB*scale+frac*kTPB;
    if (num%scale || num/scale>kMaxTick) return false;
    ticks=(int)(num/scale);
    return true;
}

int gameIx(const char* name) {
    if (!name || !*name) return -1;
    int g = gameIndex(name);
    if (g >= 0) return g;
    for (int i = 0; i < kGameNames; i++)
        if (ieq(kGameName[i], name)) return i;
    for (int i = 0; i < gtfcat::kGameAliasCount; i++)
        if (ieq(gtfcat::kGameAliases[i].name, name)) return gtfcat::kGameAliases[i].game;
    return -1;
}

const gtfcat::Cue* findCue(const char* name, int game, int& nMatch) {
    nMatch = 0;
    const gtfcat::Cue* first = nullptr;
    const gtfcat::Cue* scoped = nullptr;
    int seenG[24];
    int seenN = 0;
    for (int i = 0; i < gtfcat::kCueCount; i++) {
        if (!ieq(gtfcat::kCues[i].name, name)) continue;
        if (game >= 0 && gtfcat::kCues[i].game == (uint8_t)game && !scoped)
            scoped = &gtfcat::kCues[i];
        if (!first) first = &gtfcat::kCues[i];
        bool seen = false;
        for (int k = 0; k < seenN; k++)
            if (seenG[k] == gtfcat::kCues[i].game) seen = true;
        if (!seen && seenN < 24) seenG[seenN++] = gtfcat::kCues[i].game;
    }
    nMatch = seenN;
    if (game >= 0) return scoped;
    return (nMatch == 1) ? first : nullptr;
}

bool reserved(const char* s) {
    static const char* kW[] = {
        "title", "prologue", "jingle", "start", "match", "end", "finish", "results",
        "rest", "at", "switch", "loop", "def", "call", "fade", "anim", "first",
        "bgm", "translen", "swing", "ticks_per_beat", "cue", "hard", "cut",
        "tempo", "gtlm", nullptr
    };
    for (int i = 0; kW[i]; i++)
        if (ieq(s, kW[i])) return true;
    return false;
}

int useGame(MultiTimeline& tl, int g) {
    for (int i = 0; i < tl.gameCount; i++)
        if (tl.games[i] == g) return i;
    if (tl.gameCount >= kMaxMGames) return -1;
    tl.games[tl.gameCount] = (uint8_t)g;
    return tl.gameCount++;
}

void pad4(int* a) {
    // a[0..3] already zeroed by caller if short
    (void)a;
}

#define FAIL(...) do { snprintf(tl.error, sizeof(tl.error), __VA_ARGS__); return false; } while (0)

bool loadLines(const char* text, long size, MultiTimeline& tl) {
    sPoolUsed = 0;
    sLineN = 0;
    sDefN = 0;
    sBodyN = 0;
    long pos = 0;
    int lineNo = 0;
    static char raw[256], body[256];
    while (pos < size) {
        int len = 0;
        while (pos < size && text[pos] != '\n') {
            if (len < (int)sizeof(raw) - 1) raw[len++] = text[pos];
            pos++;
        }
        pos++;
        raw[len] = 0;
        lineNo++;
        int bl = 0;
        if (!stripComment(raw, len, body, sizeof(body), bl))
            FAIL("line %d: unclosed quote", lineNo);
        char* st = body;
        while (isSpace(*st)) st++;
        if (!*st) continue;
        if (sLineN >= kMaxLines) FAIL("too many lines");
        char* interned = intern(st, (int)strlen(st));
        if (!interned) FAIL("line %d: text pool full", lineNo);
        sLines[sLineN].no = lineNo;
        sLines[sLineN].s = interned;
        sLineN++;
    }
    return true;
}

bool collectBlock(int start, int openNo, const char* kind, int& endIdx, MultiTimeline& tl) {
    int depth = 1;
    int i = start;
    while (i < sLineN) {
        char buf[256];
        strncpy(buf, sLines[i].s, sizeof(buf) - 1);
        buf[sizeof(buf) - 1] = 0;
        char* tok[kMaxTok];
        int n = tokenize(buf, tok);
        if (n < 0) FAIL("line %d: invalid/too many tokens", sLines[i].no);
        if (n > 0) {
            if (ieq(tok[0], "loop") || ieq(tok[0], "def")) depth++;
            else if (ieq(tok[0], "end") && n == 1) {
                depth--;
                if (depth == 0) { endIdx = i; return true; }
            }
        }
        i++;
    }
    FAIL("line %d: missing 'end' for %s", openNo, kind);
}

bool extractDefs(MultiTimeline& tl) {
    sDefN = 0;
    sBodyN = 0;
    int i = 0;
    while (i < sLineN) {
        char buf[256];
        strncpy(buf, sLines[i].s, sizeof(buf) - 1);
        buf[sizeof(buf) - 1] = 0;
        char* tok[kMaxTok];
        int n = tokenize(buf, tok);
        if (n < 0) FAIL("line %d: invalid/too many tokens", sLines[i].no);
        if (n > 0 && ieq(tok[0], "def")) {
            if (n != 2 || !validName(tok[1])) FAIL("line %d: def needs a name", sLines[i].no);
            if (reserved(tok[1]) || gameIx(tok[1]) >= 0)
                FAIL("line %d: '%s' is reserved", sLines[i].no, tok[1]);
            for (int d = 0; d < sDefN; d++)
                if (ieq(sDefs[d].name, tok[1]))
                    FAIL("line %d: def '%s' already defined", sLines[i].no, tok[1]);
            if (sDefN >= kMaxDefs) FAIL("line %d: too many defs", sLines[i].no);
            int endIdx = -1;
            if (!collectBlock(i + 1, sLines[i].no, "def", endIdx, tl)) return false;
            for (int j = i + 1; j < endIdx; j++) {
                char b2[256];
                strncpy(b2, sLines[j].s, sizeof(b2) - 1);
                b2[sizeof(b2) - 1] = 0;
                char* t2[kMaxTok];
                int n2 = tokenize(b2, t2);
                if (n2 > 0 && ieq(t2[0], "def")) FAIL("line %d: nested def", sLines[j].no);
            }
            Def& d = sDefs[sDefN++];
            memset(&d, 0, sizeof(d));
            strncpy(d.name, tok[1], sizeof(d.name) - 1);
            d.start = i + 1;
            d.end = endIdx;
            i = endIdx + 1;
            continue;
        }
        sBodyIdx[sBodyN++] = i;
        i++;
    }
    return true;
}

// execution state
int sWork = 0;
int sClock = 0;
int sGame = -1;
int sCallDepth = 0;
int sLoopDepth = 0;
char sCallStack[kMaxCall][48];
bool sEndSet = false, sFinishSet = false;

bool addEvent(MultiTimeline& tl, MEvent& e, int lineNo) {
    if (e.tick < 0) FAIL("line %d: negative tick", lineNo);
    if (tl.count > 0 && e.tick < tl.ev[tl.count - 1].tick)
        FAIL("line %d: events must be sorted by tick", lineNo);
    if (tl.count >= kMaxMEvents) FAIL("line %d: too many events", lineNo);
    tl.ev[tl.count++] = e;
    return true;
}

bool applyHeader(MultiTimeline& tl, char* tok[], int n, int lineNo, bool& handled);

bool emitRange(MultiTimeline& tl, int lo, int hi, bool topLevel);


bool parseCue(MultiTimeline& tl, char* toks[], int nTok, int lineNo) {
    if (nTok < 1) FAIL("line %d: missing cue name", lineNo);
    const char* raw = toks[0];
    int game = -1;
    const char* name = raw;
    const char* dot = nullptr;
    for (const char* p = raw; *p; p++)
        if (*p == '.') { dot = p; break; }
    char left[48], right[80];
    if (dot) {
        int ll = (int)(dot - raw);
        if (ll <= 0 || ll >= 48) FAIL("line %d: bad cue name", lineNo);
        memcpy(left, raw, ll); left[ll] = 0;
        strncpy(right, dot + 1, sizeof(right) - 1);
        right[sizeof(right) - 1] = 0;
        game = gameIx(left);
        if (game < 0) FAIL("line %d: unknown game '%s'", lineNo, left);
        name = right;
    }
    int fnDirect = -1;
    if (name[0] == '0' && (name[1] == 'x' || name[1] == 'X') && isIntTok(name)) {
        if (!parseIntStrict(name, fnDirect)) FAIL("line %d: bad function", lineNo);
    }

    int last = nTok - 1;
    const char* tag = nullptr;
    int argEnd = nTok;
    if (last>=1 && numericLiteral(toks[last]) && !isIntTok(toks[last])) FAIL("line %d: integer out of range",lineNo);
    if (last >= 1 && !isIntTok(toks[last]) && (validName(toks[last]) || !strcmp(toks[last],"-"))) {
        tag = toks[last];
        argEnd = last;
    }
    int intArgs[4] = {0, 0, 0, 0};
    int nInt = 0;
    const char* wordTok = nullptr;
    for (int i = 1; i < argEnd; i++) {
        bool isWord = false;
        for (int w = 0; w < kTheAWordCount; w++)
            if (ieq(toks[i], kTheAWords[w])) isWord = true;
        if (isWord && !wordTok && !isIntTok(toks[i])) { wordTok = toks[i]; continue; }
        if (isIntTok(toks[i])) {
            if (nInt >= 4) FAIL("line %d: too many arguments", lineNo);
            parseIntStrict(toks[i], intArgs[nInt++]);
        } else {
            FAIL("line %d: bad argument '%s'", lineNo, toks[i]);
        }
    }

    int gUse = -1;
    uint32_t fn = 0;
    uint8_t kind = 0;
    const char* word = nullptr;
    int args[4] = {0, 0, 0, 0};

    if (fnDirect >= 0) {
        gUse = game >= 0 ? game : sGame;
        if (gUse < 0) FAIL("line %d: qualify the function (GAME.0x%X) or switch first", lineNo, fnDirect);
        bool found = false;
        for (int i = 0; i < kCueFnCount; i++)
            if (kCueFns[i].off == (uint32_t)fnDirect && kCueFns[i].game == gUse) {
                found = true; kind = kCueFns[i].kind; break;
            }
        if (!found) FAIL("line %d: function 0x%X is not an allowed %s cue", lineNo, fnDirect, kGameName[gUse]);
        fn = (uint32_t)fnDirect;
        memcpy(args, intArgs, sizeof(args));
        word = wordTok;
        if (kind == 1) {
            if (!word && tag) {
                for (int w = 0; w < kTheAWordCount; w++)
                    if (ieq(tag, kTheAWords[w])) { word = tag; tag = nullptr; break; }
            }
            if (!word) FAIL("line %d: %s needs a word (TEA|SODA|COCOA|AAA)", lineNo, kGameName[gUse]);
        }
    } else {
        int nMatch = 0;
        int ctx = game >= 0 ? game : sGame;
        const gtfcat::Cue* cue = findCue(name, ctx, nMatch);
        if (!cue) {
            int any = 0;
            findCue(name, -1, any);
            if (ctx >= 0 && any > 0)
                FAIL("line %d: '%s' is not a %s cue (qualify as GAME.%s)", lineNo, name, kGameName[ctx], name);
            if (any > 1)
                FAIL("line %d: '%s' is ambiguous; write GAME.%s or switch first", lineNo, name, name);
            FAIL("line %d: unknown cue '%s'", lineNo, name);
        }
        gUse = cue->game;
        fn = cue->fn;
        kind = cue->kind;
        if (kind == 1) {
            word = wordTok ? wordTok : cue->word;
            if (nInt) memcpy(args, intArgs, sizeof(args));
        } else {
            if (wordTok) FAIL("line %d: this cue does not take a word", lineNo);
            if (nInt) memcpy(args, intArgs, sizeof(args));
            else for (int i = 0; i < 4; i++) args[i] = cue->args[i];
        }
    }

    if (useGame(tl, gUse) < 0) FAIL("line %d: more than %d games", lineNo, kMaxMGames);
    MEvent e;
    memset(&e, 0, sizeof(e));
    e.tick = sClock;
    e.op = MOp::Call;
    e.game = (uint8_t)gUse;
    e.style = -1;
    e.fn = -1;
    for (int i = 0; i < kCueFnCount; i++)
        if (kCueFns[i].off == fn && kCueFns[i].game == gUse) { e.fn = (int16_t)i; break; }
    if (e.fn < 0) FAIL("line %d: function 0x%X is not an allowed %s cue", lineNo, fn, kGameName[gUse]);
    if (kind==1 && nInt) FAIL("line %d: word cue has no integer arguments",lineNo);
    if (!validCueArgs(gUse, fn, args)) FAIL("line %d: cue arguments not in verified domain", lineNo);
    if (kind==0 && wordTok) FAIL("line %d: unexpected word",lineNo);
    memcpy(e.a, args, sizeof(e.a));
    e.word = nullptr;
    if (word) {
        for (int w = 0; w < kTheAWordCount; w++)
            if (ieq(word, kTheAWords[w])) e.word = kTheAWords[w];
        if (!e.word) FAIL("line %d: word must be TEA|SODA|COCOA|AAA", lineNo);
    }
    if (tag && strcmp(tag, "-") != 0) {
        e.str = internEvent(tag, (int)strlen(tag));
        if (!e.str) FAIL("line %d: string pool full", lineNo);
    }
    tl.calls++;
    return addEvent(tl, e, lineNo);
}

bool applyHeader(MultiTimeline& tl, char* tok[], int n, int lineNo, bool& handled) {
    handled = true;
    const char* k = tok[0];
    if (ieq(k, "title")) {
        tl.title[0] = 0;
        if (n >= 2) {
            char buf[96];
            int bp = 0;
            buf[0] = 0;
            for (int i = 1; i < n; i++) {
                char t[96];
                if (strlen(tok[i]) >= sizeof(t)+2) FAIL("line %d: title too long",lineNo);
                unquote(tok[i]);
                if (strlen(tok[i]) >= sizeof(t)) FAIL("line %d: title too long",lineNo);
                strncpy(t, tok[i], sizeof(t) - 1);
                t[sizeof(t) - 1] = 0;
                int textLen = (int)strlen(t);
                if (i>1) { if (bp>=95) FAIL("line %d: title too long",lineNo); buf[bp++]=' '; }
                if (bp + textLen > 95) FAIL("line %d: title too long",lineNo);
                if (textLen > 0) { memcpy(buf + bp, t, textLen); bp += textLen; }
                buf[bp] = 0;
            }
            size_t L = strlen(buf);
            if (L >= sizeof(tl.title)) L = sizeof(tl.title) - 1;
            memcpy(tl.title, buf, L);
            tl.title[L] = 0;
        }
        return true;
    }
    if (ieq(k, "prologue")) {
        if (n < 2) FAIL("line %d: prologue type_XX|path", lineNo);
        char* t=tok[1];
        unquote(t);
        if (strlen(t) >= sizeof(tl.prologue) || !validPrologue(t)) FAIL("line %d: prologue too long", lineNo);
        memcpy(tl.prologue, t, strlen(t) + 1);
        return true;
    }
    if (ieq(k, "jingle")) {
        if (n < 2) FAIL("line %d: jingle 0x158..0x16C", lineNo);
        int j = 0;
        if (!parseIntStrict(tok[1], j)) FAIL("line %d: bad jingle", lineNo);
        if (j < kJingleMin || j > kJingleMax)
            FAIL("line %d: jingle out of range (0x158..0x16C)", lineNo);
        tl.jingle = j;
        return true;
    }
    if (ieq(k, "start")) {
        if (n < 2 || !parseDuration(tok[1], tl.startTick) || tl.startTick < 0)
            FAIL("line %d: bad start", lineNo);
        return true;
    }
    if (ieq(k, "translen")) {
        if (n < 2 || !parseDuration(tok[1], tl.transLen) || tl.transLen < 0 || tl.transLen > 7680)
            FAIL("line %d: bad translen", lineNo);
        return true;
    }
    if (ieq(k, "swing")) {
        if (n < 2 || !parseIntStrict(tok[1], tl.swing)) FAIL("line %d: bad swing", lineNo);
        return true;
    }
    if (ieq(k, "ticks_per_beat")) {
        int v = 0;
        if (n < 2 || !parseIntStrict(tok[1], v) || v != kTPB)
            FAIL("line %d: ticks_per_beat must be 480", lineNo);
        return true;
    }
    if (ieq(k, "bgm")) {
        if (n < 2 || !parseIntStrict(tok[1], tl.bgm) || tl.bgm < 0 || tl.bgm > 0xFFFF)
            FAIL("line %d: bad bgm", lineNo);
        return true;
    }
    if (ieq(k, "results")) {
        if (n < 2) FAIL("line %d: results native|exit|custom", lineNo);
        if (ieq(tok[1], "native")) tl.resultsMode = 1;
        else if (ieq(tok[1], "exit") || ieq(tok[1], "custom")) tl.resultsMode = 0;
        else FAIL("line %d: results native|exit|custom", lineNo);
        return true;
    }
    if (ieq(k, "match")) {
        if (n < 4 || !parseIntStrict(tok[1], tl.matchWorld) || !parseIntStrict(tok[2], tl.matchCol) ||
            !parseIntStrict(tok[3], tl.matchRow))
            FAIL("line %d: match WORLD COL ROW", lineNo);
        return true;
    }
    if (ieq(k, "first")) {
        if (n < 2) FAIL("line %d: first GAME", lineNo);
        int g = gameIx(tok[1]);
        if (g < 0) FAIL("line %d: unknown game '%s'", lineNo, tok[1]);
        if (useGame(tl, g) < 0) FAIL("line %d: more than %d games", lineNo, kMaxMGames);
        tl.firstGame = g;
        if (sGame < 0) sGame = g;
        return true;
    }
    if (ieq(k, "end") && n >= 2) {
        if (!parseDuration(tok[1], tl.endTick)) FAIL("line %d: bad end", lineNo);
        if (n > 2 && !parseDuration(tok[2], tl.endFade)) FAIL("line %d: bad end fade", lineNo);
        sEndSet = true;
        return true;
    }
    if (ieq(k, "finish") && n >= 2) {
        if (!parseDuration(tok[1], tl.finishTick)) FAIL("line %d: bad finish", lineNo);
        sFinishSet = true;
        return true;
    }
    if (ieq(k, "tempo"))
        FAIL("line %d: tempo is not applied (the game uses its own BGM tempo)", lineNo);
    handled = false;
    return true;
}

bool emitRange(MultiTimeline& tl, int lo, int hi, bool topLevel) {
    int i = lo;
    while (i < hi) {
        if (++sWork > kMaxExpansionWork) FAIL("expansion work limit exceeded");
        int lineNo = sLines[i].no;
        char buf[256];
        strncpy(buf, sLines[i].s, sizeof(buf) - 1);
        buf[sizeof(buf) - 1] = 0;
        char* tok[kMaxTok];
        int n = tokenize(buf, tok);
        if (n < 0) FAIL("line %d: invalid/too many tokens", lineNo);
        if (n == 0) { i++; continue; }
        const char* op=tok[0];
        int min=0,max=0;
        const char* two[]={"prologue","jingle","start","translen","swing","ticks_per_beat","bgm","results","first","rest","at","loop","def","call"};
        for (auto key:two) if (ieq(op,key)) min=max=2;
        if (ieq(op,"match")) min=max=4;
        if (ieq(op,"fade")) min=max=3;
        if (ieq(op,"switch")) { min=2;max=4; }
        if (ieq(op,"anim")) { min=2;max=4; }
        if (ieq(op,"end")) { min=1;max=3; }
        if (ieq(op,"finish")) { min=1;max=2; }
        if (max && (n<min || n>max)) FAIL("line %d: wrong argument count",lineNo);
        bool handled = false;
        if (!applyHeader(tl, tok, n, lineNo, handled)) return false;
        if (handled) { i++; continue; }
        const char* k = tok[0];
        if (ieq(k, "rest")) {
            int dt = 0;
            if (n < 2 || !parseDuration(tok[1], dt))
                FAIL("line %d: rest <beats> (e.g. 1, 0.5, 1/3, 240t)", lineNo);
            if (!checkedTickAdd(sClock, dt, sClock)) FAIL("line %d: clock overflow", lineNo);
            i++;
            continue;
        }
        if (ieq(k, "at")) {
            int t = 0;
            if (n < 2 || !parseDuration(tok[1], t)) FAIL("line %d: at <absolute beat>", lineNo);
            if (t < sClock) FAIL("line %d: at goes backwards (clock is tick %d)", lineNo, sClock);
            sClock = t;
            i++;
            continue;
        }
        if (ieq(k, "switch")) {
            if (n < 2) FAIL("line %d: switch GAME [cut|hard|0|1|2] [1|2]", lineNo);
            int g = gameIx(tok[1]);
            if (g < 0) FAIL("line %d: unknown game '%s'", lineNo, tok[1]);
            if (useGame(tl, g) < 0) FAIL("line %d: more than %d games", lineNo, kMaxMGames);
            int style = 0, sub = 2;
            if (n > 2) {
                if (ieq(tok[2], "cut") || ieq(tok[2], "hard")) style = -1;
                else {
                    if (!parseIntStrict(tok[2], style) || style < 0 || style > 2)
                        FAIL("line %d: style cut|hard|0|1|2", lineNo);
                }
            }
            if (n > 3) {
                if (!parseIntStrict(tok[3], sub) || sub < 1 || sub > 2)
                    FAIL("line %d: sub 1|2", lineNo);
            }
            MEvent e;
            memset(&e, 0, sizeof(e));
            e.tick = sClock;
            e.op = MOp::Switch;
            e.game = (uint8_t)g;
            e.style = (int8_t)style;
            e.sub = (int8_t)sub;
            tl.switches++;
            if (!addEvent(tl, e, lineNo)) return false;
            sGame = g;
            i++;
            continue;
        }
        if (ieq(k, "loop")) {
            int count = 0;
            if (n < 2 || !parseIntStrict(tok[1], count) || count < 1 || count > kMaxExpansionWork)
                FAIL("line %d: loop needs an integer >= 1", lineNo);
            if (sLoopDepth >= kMaxLoop) FAIL("line %d: loop nesting too deep", lineNo);
            int endIdx = -1;
            if (!collectBlock(i + 1, lineNo, "loop", endIdx, tl)) return false;
            sLoopDepth++;
            for (int c = 0; c < count; c++) {
                if (++sWork > kMaxExpansionWork) { sLoopDepth--; FAIL("expansion work limit exceeded"); }
                if (!emitRange(tl, i + 1, endIdx, false)) { sLoopDepth--; return false; }
            }
            sLoopDepth--;
            i = endIdx + 1;
            continue;
        }
        if (ieq(k, "call")) {
            if (n < 2) FAIL("line %d: call <name>", lineNo);
            int di = -1;
            for (int d = 0; d < sDefN; d++)
                if (ieq(sDefs[d].name, tok[1])) di = d;
            if (di < 0) FAIL("line %d: no def '%s'", lineNo, tok[1]);
            if (sCallDepth >= kMaxCall) FAIL("line %d: call depth exceeded", lineNo);
            for (int c = 0; c < sCallDepth; c++)
                if (ieq(sCallStack[c], tok[1]))
                    FAIL("line %d: recursive call to '%s'", lineNo, tok[1]);
            strncpy(sCallStack[sCallDepth], tok[1], 47);
            sCallStack[sCallDepth][47] = 0;
            sCallDepth++;
            bool ok = emitRange(tl, sDefs[di].start, sDefs[di].end, false);
            sCallDepth--;
            if (!ok) return false;
            i++;
            continue;
        }
        if (ieq(k, "def")) {
            if (!topLevel) FAIL("line %d: nested def is not allowed", lineNo);
            int endIdx = -1;
            if (!collectBlock(i + 1, lineNo, "def", endIdx, tl)) return false;
            i = endIdx + 1;
            continue;
        }
        if (ieq(k, "end") && n == 1) {
            tl.endTick = sClock;
            sEndSet = true;
            i++;
            continue;
        }
        if (ieq(k, "finish") && n == 1) {
            tl.finishTick = sClock;
            sFinishSet = true;
            i++;
            continue;
        }
        if (ieq(k, "fade")) {
            int dur = 0;
            float alpha = 0;
            if (n < 3 || !parseDuration(tok[1], dur) || !parseFloatStrict(tok[2], alpha) ||
                dur < 0 || alpha < 0.f || alpha > 1.f)
                FAIL("line %d: fade <beats> <alpha 0..1>", lineNo);
            MEvent e;
            memset(&e, 0, sizeof(e));
            e.tick = sClock;
            e.op = MOp::Fade;
            e.style = -1;
            e.len = dur;
            e.alpha = alpha;
            tl.fades++;
            if (!addEvent(tl, e, lineNo)) return false;
            i++;
            continue;
        }
        if (ieq(k, "anim")) {
            if (n < 2) FAIL("line %d: anim [GAME] NAME [layout]", lineNo);
            int ti = 1;
            int g = gameIx(tok[1]);
            if (g >= 0) ti = 2;
            else g = sGame;
            if (ti >= n) FAIL("line %d: anim [GAME] NAME [layout]", lineNo);
            const char* aname = tok[ti];
            if (!validName(aname)) FAIL("line %d: bad animation name", lineNo);
            int layout = -1;
            if (ti + 1 < n) {
                if (!parseIntStrict(tok[ti + 1], layout)) FAIL("line %d: bad layout", lineNo);
            } else {
                layout = gtfcat::layoutOff(g);
            }
            if (g < 0) FAIL("line %d: anim needs a game (switch first or anim GAME NAME)", lineNo);
            if (!validLayout(g,layout))
                FAIL("line %d: layout out of range or not 8-aligned", lineNo);
            if (useGame(tl, g) < 0) FAIL("line %d: more than %d games", lineNo, kMaxMGames);
            MEvent e;
            memset(&e, 0, sizeof(e));
            e.tick = sClock;
            e.op = MOp::Anim;
            e.game = (uint8_t)g;
            e.style = -1;
            e.len = layout;
            e.str = internEvent(aname, (int)strlen(aname));
            if (!e.str) FAIL("line %d: string pool full", lineNo);
            tl.anims++;
            if (!addEvent(tl, e, lineNo)) return false;
            i++;
            continue;
        }
        char** cueToks = tok;
        int cueN = n;
        if (ieq(k, "cue")) {
            if (n < 2) FAIL("line %d: cue <name> [args] [tag]", lineNo);
            cueToks = tok + 1;
            cueN = n - 1;
        }
        if (!parseCue(tl, cueToks, cueN, lineNo)) return false;
        i++;
    }
    return true;
}


bool parseGtfImpl(MultiTimeline& tl, const char* text, long size) {
    tl.valid = false;
    tl.ticksPerBeat = kTPB;
    tl.bgm = 0x8B;
    tl.startTick = 0;
    tl.transLen = 960;
    tl.swing = 120;
    tl.endTick = tl.finishTick = -1;
    tl.endFade = 960;
    tl.resultsMode = 0;
    tl.matchWorld = -1;
    tl.matchCol = 9;
    tl.matchRow = 4;
    tl.gameCount = 0;
    tl.firstGame = -1;
    tl.count = tl.calls = tl.switches = tl.fades = tl.anims = 0;
    tl.error[0] = 0;
    tl.title[0] = 0;
    tl.prologue[0] = 0;
    tl.jingle = -1;
    if (!validSource(text, size, tl.error, sizeof(tl.error))) return false;
    if (!loadLines(text, size, tl)) return false;
    if (!extractDefs(tl)) return false;
    sWork = 0;
    sClock = 0;
    sGame = -1;
    sCallDepth = 0;
    sLoopDepth = 0;
    sEndSet = false;
    sFinishSet = false;
    if (!emitRange(tl, 0, sLineN, true)) return false;
    if (tl.calls == 0) FAIL("no cue calls");
    if (tl.gameCount == 0) FAIL("no games used");
    if (tl.firstGame < 0) {
        for (int i = 0; i < tl.count; i++) {
            if (tl.ev[i].op == MOp::Switch || tl.ev[i].op == MOp::Call || tl.ev[i].op == MOp::Anim) {
                tl.firstGame = tl.ev[i].game;
                break;
            }
        }
        if (tl.firstGame < 0) FAIL("no games used");
        if (useGame(tl, tl.firstGame) < 0) FAIL("more than %d games", kMaxMGames);
        // first should already be in games[] from the event; useGame is a no-op then
    }
    int last = tl.count ? tl.ev[tl.count - 1].tick : 0;
    if (!sEndSet && !checkedTickAdd(last,4*kTPB,tl.endTick)) FAIL("automatic end overflow");
    if (!sFinishSet && !checkedTickAdd(tl.endTick,4*kTPB,tl.finishTick)) FAIL("automatic finish overflow");
    if (!validMatch(tl.matchWorld,tl.matchCol,tl.matchRow)) FAIL("invalid match");
    if (tl.endTick <= 0) FAIL("end missing");
    if (tl.finishTick < tl.endTick) FAIL("finish missing or before end");
    if (tl.startTick > tl.endTick) FAIL("start after end");
    if (last > tl.endTick) FAIL("events after end (%d > %d)", last, tl.endTick);
    tl.valid = true;
    return true;
}

} // namespace gtfpriv

void fillTimelineView(const MultiTimeline& tl, TimelineView& v) {
    memset(&v, 0, sizeof(v));
    v.valid = tl.valid ? 1 : 0;
    v.start = tl.startTick;
    v.transLen = tl.transLen;
    v.end = tl.endTick;
    v.endFade = tl.endFade;
    v.finish = tl.finishTick;
    v.results = tl.resultsMode;
    v.first = tl.firstGame;
    v.matchW = tl.matchWorld;
    v.matchC = tl.matchCol;
    v.matchR = tl.matchRow;
    v.bgm = tl.bgm;
    v.jingle = tl.jingle;
    v.swing = tl.swing;
    v.count = tl.count;
    v.calls = tl.calls;
    v.switches = tl.switches;
    v.fades = tl.fades;
    v.anims = tl.anims;
    v.gameCount = tl.gameCount;
    memcpy(v.title, tl.title, sizeof(v.title));
    memcpy(v.prologue, tl.prologue, sizeof(v.prologue));
    memcpy(v.games, tl.games, sizeof(v.games));
    int n = tl.count < kTlViewEv ? tl.count : kTlViewEv;
    for (int i = 0; i < n; i++) {
        const MEvent& e = tl.ev[i];
        v.evTick[i] = e.tick;
        v.evOp[i] = (uint8_t)e.op;
        v.evGame[i] = e.game;
        v.evStyle[i] = e.style;
        v.evSub[i] = e.sub;
        v.evFn[i] = e.fn;
        for (int k = 0; k < 4; k++) v.evA[i][k] = e.a[k];
        v.evLen[i] = e.len;
        v.evAlpha[i] = e.alpha;
        if (e.str && e.op == MOp::Call) {
            size_t L = strlen(e.str);
            if (L > 47) L = 47;
            memcpy(v.evTag[i], e.str, L);
        }
        if (e.word) {
            size_t L = strlen(e.word);
            if (L > 7) L = 7;
            memcpy(v.evWord[i], e.word, L);
        }
        if (e.str && e.op == MOp::Anim) {
            size_t L = strlen(e.str);
            if (L > 47) L = 47;
            memcpy(v.evAnim[i], e.str, L);
        }
    }
}

bool parseGtf(MultiTimeline& tl, const char* text, long size) {
    ParseGuard guard;
    if (!guard.held) return false;
    StringTransaction<65536> strings(gtfpriv::sStrings);
    bool ok = gtfpriv::parseGtfImpl(tl, text, size);
    strings.commit = ok;
    return ok;
}

static bool sniffGtlm(const char* text, long size) {
    long pos = 0;
    char line[256];
    while (pos < size) {
        int len = 0;
        while (pos < size && text[pos] != '\n') {
            if (len < 255) line[len++] = text[pos];
            pos++;
        }
        pos++;
        line[len] = 0;
        char* h = strchr(line, '#');
        if (h) *h = 0;
        // also strip //
        for (int i = 0; i < len - 1; i++)
            if (line[i] == '/' && line[i + 1] == '/' && (i == 0 || line[i - 1] != ':')) {
                // crude: treat // as comment unless we are mid-token; good enough for sniff
                line[i] = 0;
                break;
            }
        char* p = line;
        while (*p == ' ' || *p == '\t' || *p == '\r') p++;
        if (!*p) continue;
        return !strncmp(p,"GTLM",4);
    }
    return false;
}

bool parseTimeline(MultiTimeline& tl, const char* text, long size) {
    if (!validSource(text,size,tl.error,sizeof(tl.error))) { tl.valid=false; return false; }
    if (sniffGtlm(text, size)) return parseMulti(tl, text, size);
    return parseGtf(tl, text, size);
}

} // namespace groove
