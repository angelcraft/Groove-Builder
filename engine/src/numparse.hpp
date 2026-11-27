// Groove Engine - number parsing without libc strtol/strtof.
// v0.3: the module's libc writes errno through the thread pointer on bad input
// (EINVAL/ERANGE); inside the game that is not our TLS, so never call it.
#pragma once
#include <cstdint>

namespace groove {

// [-+]? (0x hex | decimal) ; whole string must be consumed ; |v| < 2^31
inline bool parseIntStrict(const char* s, int& out) {
    if (!s || !*s) return false;
    bool neg = false;
    if (*s == '-' || *s == '+') { neg = *s == '-'; s++; }
    int64_t v = 0;
    int digits = 0;
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
        s += 2;
        for (; *s; s++, digits++) {
            char c = *s; int d;
            if (c >= '0' && c <= '9') d = c - '0';
            else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
            else return false;
            v = v * 16 + d;
            if (v > 0xFFFFFFFFll) return false;
        }
    } else {
        for (; *s; s++, digits++) {
            if (*s < '0' || *s > '9') return false;
            v = v * 10 + (*s - '0');
            if (v > 0x7FFFFFFFll + 1) return false;
        }
    }
    if (digits == 0) return false;
    if (neg) v = -v;
    if (v > 0xFFFFFFFFll || v < -0x80000000ll) return false;
    out = (int)(int32_t)(uint32_t)(v & 0xFFFFFFFF);
    return true;
}

// [-+]? digits [. digits] ; enough for alpha values like 0.6
inline bool parseFloatStrict(const char* s, float& out) {
    if (!s || !*s) return false;
    bool neg = false;
    if (*s == '-' || *s == '+') { neg = *s == '-'; s++; }
    double v = 0, scale = 1;
    int digits = 0;
    bool dot = false;
    for (; *s; s++) {
        if (*s == '.' && !dot) { dot = true; continue; }
        if (*s < '0' || *s > '9') return false;
        if (digits++ > 12) return false;
        if (dot) { scale /= 10; v += (*s - '0') * scale; }
        else v = v * 10 + (*s - '0');
    }
    if (digits == 0) return false;
    out = (float)(neg ? -v : v);
    return true;
}

} // namespace groove
