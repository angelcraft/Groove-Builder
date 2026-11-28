#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
namespace groove {
constexpr long kMaxTimelineBytes = 60 * 1024;
constexpr int kMaxSourceLines = 4096, kMaxLineBytes = 255, kMaxTokens = 12;
constexpr int kMaxExpansionWork = 32768;
constexpr int kMaxTick = 0x7fffffff;
inline bool checkedTickAdd(int a, int b, int& out) {
    if (a < 0 || b < 0 || a > kMaxTick - b) return false;
    out = a + b; return true;
}
inline bool validSource(const char* text, long size, char* error, size_t cap) {
    if (!text || size <= 0 || size > kMaxTimelineBytes) {
        snprintf(error, cap, "invalid source size (1..61440 bytes)"); return false;
    }
    // Reject malformed UTF-8 before any game text renderer receives a title.
    for (long i=0;i<size;) {
        unsigned char c=static_cast<unsigned char>(text[i++]);
        if (c<0x80) continue;
        int n=c>=0xc2 && c<=0xdf ? 1 : c>=0xe0 && c<=0xef ? 2 : c>=0xf0 && c<=0xf4 ? 3 : -1;
        uint32_t cp=n==1 ? c&31 : n==2 ? c&15 : c&7;
        if (n<0 || i+n>size) { snprintf(error,cap,"invalid UTF-8");return false; }
        for (int j=0;j<n;++j) {
            unsigned char d=static_cast<unsigned char>(text[i++]);
            if ((d&0xc0)!=0x80) { snprintf(error,cap,"invalid UTF-8");return false; }
            cp=(cp<<6)|(d&63);
        }
        if ((n==2 && cp<0x800) || (n==3 && cp<0x10000) || cp>0x10ffff || (cp>=0xd800 && cp<=0xdfff)) { snprintf(error,cap,"invalid UTF-8");return false; }
    }
    int lines = 1, len = 0;
    for (long i = 0; i < size; ++i) {
        unsigned char c = static_cast<unsigned char>(text[i]);
        if (c == '\n') { len = 0; if (i + 1 < size) ++lines; }
        else if (++len > kMaxLineBytes || c == 0 || (c < 32 && c != '\t' && c != '\r') || c == 127) {
            snprintf(error, cap, "line %d: invalid byte or line exceeds 255 bytes", lines); return false;
        }
        if (lines > kMaxSourceLines) { snprintf(error, cap, "too many source lines"); return false; }
    }
    return true;
}
inline bool numericLiteral(const char* s) {
    if (!s || !*s) return false;
    if (*s=='+' || *s=='-') ++s;
    bool hex=s[0]=='0' && (s[1]=='x' || s[1]=='X');
    if (hex) s+=2;
    if (!*s) return false;
    for (;*s;++s) if (!((*s>='0' && *s<='9') || (hex && ((*s>='a' && *s<='f') || (*s>='A' && *s<='F'))))) return false;
    return true;
}
inline bool validMatch(int w, int c, int r) { return w >= -1 && w <= 2 && c >= 0 && c < 12 && r >= 0 && r < 5; }
inline bool validPrologue(const char* s) {
    if (!s || !*s || *s=='/' || strstr(s,"..")) return false;
    for (;*s;++s) if (!((*s>='a' && *s<='z') || (*s>='A' && *s<='Z') || (*s>='0' && *s<='9') || *s=='_' || *s=='-' || *s=='/')) return false;
    return true;
}
// Nonblocking global scratch exclusion. No kernel services or waits inside a parser.
inline unsigned char parserBusy = 0;
struct TryLease {
    unsigned char& busy;
    bool held;
    explicit TryLease(unsigned char& flag): busy(flag),held(!__atomic_test_and_set(&flag,__ATOMIC_ACQUIRE)) {}
    TryLease(const TryLease&)=delete;
    TryLease& operator=(const TryLease&)=delete;
    ~TryLease() { if (held) __atomic_clear(&busy,__ATOMIC_RELEASE); }
};
struct ParseGuard: TryLease { ParseGuard():TryLease(parserBusy){} };
// Addresses already published to native game objects never move or get overwritten.
// Failed parses roll back only newly allocated entries; repeated loads deduplicate.
template<int N> struct PersistentStrings {
    char data[N]{}; int used = 0;
    const char* intern(const char* s, int n) {
        if (!s || n < 0 || n >= N) return nullptr;
        for (int i = 0; i < used;) {
            int len = static_cast<int>(strlen(data+i));
            if (len == n && !memcmp(data+i, s, n)) return data+i;
            i += len+1;
        }
        if (n+1 > N-used) return nullptr;
        char* p = data+used; memcpy(p,s,n); p[n]=0; used += n+1; return p;
    }
};
template<int N> struct StringTransaction {
    PersistentStrings<N>& pool; int mark; bool commit = false;
    explicit StringTransaction(PersistentStrings<N>& p): pool(p), mark(p.used) {}
    ~StringTransaction() { if (!commit) pool.used = mark; }
};
}
