#pragma once
// GE-151 (interim, Grok) — H-B2: Stage-owner boundary before SceneMgr::destroyPending (0x5096F0).
// Implements reports/GE-152/CODEX_HANDOFF_rev3.md §3.1 (decision table), §4 (barrier) and §4.1 (implementation
// requirements: bounds before every write, bounded list walks with cycle/bad-pointer detection, state/handle
// consistency, identity + thread checks BEFORE touching the list, game-native signal/join only).
// Pure logic, templated on an environment so the SAME code runs in the module (direct memory, native calls)
// and in host tests (ASan/UBSan, synthetic graphs). No allocation, no locks, no I/O.
#include <cstddef>
#include <cstdint>

namespace groove::b2 {

constexpr unsigned kMaxThreads = 64;  // R21: 11 native + ~12 engine threads measured; overflow -> safe stop
constexpr unsigned kCap = 8;          // fixed-point rounds; round cap+1 never starts

// main 03FF4A3B offsets (rev3 §2/§3, verified [S]/[U]).
constexpr uintptr_t oDestroyPending = 0x5096F0, kDestroyPendingLr = 0x50A060, oSceneMgrDtor = 0x509640;
constexpr uintptr_t oSignal = 0x4DFC70, oJoin = 0x4DFB60;
constexpr uintptr_t mgrCur = 0x10, mgrNext = 0x18;
constexpr uintptr_t seqStage = 0xA078, seqRunner = 0x58, seqNode = 0x30;
constexpr uintptr_t stSeq = 0x29D8, stNode = 0x8, stRunner = 0x2980, stRunnerHt2 = 0x2C80, stRunnerR21 = 0x3550;
constexpr uintptr_t runHead = 0x8, thNext = 0x8, thState = 0x250, thResume = 0x220, thWrap = 0x28,
                    thHandle = 0x28 + 0x1C8, thOs = 0x30;
constexpr uintptr_t kSeqVptr[5] = {0xD2B730, 0xD2B988, 0xD2BBE0, 0xD2BE38, 0xD2C090};  // *(seq) - base
constexpr uintptr_t kSeqDeleting[5] = {0x2AB5F0, 0x2ABA50, 0x2ABEB0, 0x2AC310, 0x2AC750};
constexpr uintptr_t kSeqTick = 0x132300;

enum class Kind : uint8_t { None = 0, Ht2 = 1, R21 = 2 };

struct Session {
    bool active = false, passed = false;
    Kind kind = Kind::None;
    uint64_t gen = 0;
    uintptr_t seq = 0, stage = 0, mainThread = 0;
};

enum class Decision : uint8_t { NoSession, Foreign, NoNext, Barrier, SafeStop };

struct Report {
    bool ok = false;
    const char* why = nullptr;
    unsigned rounds = 0, listed = 0;
    unsigned perRound[kCap] = {};
    unsigned before[4] = {}, after[4] = {};  // threads per state 0..3
};

inline bool seqVptrOk(uintptr_t base, uintptr_t vptr) {
    for (uintptr_t v : kSeqVptr)
        if (vptr == base + v) return true;
    return false;
}

// Env contract (all reads of game memory go through it):
//   uintptr_t base() const;
//   bool plausible(uintptr_t p) const;         // non-null, 8-aligned, inside writable data/heap, not main .text
//   bool rd64(uintptr_t a, uint64_t& v); bool rd32(uintptr_t a, uint32_t& v); bool wr32(uintptr_t a, uint32_t v);
//   void fence();                              // std::atomic_thread_fence(seq_cst)
//   void signal(uintptr_t event);              // game 0x4DFC70
//   void join(uintptr_t wrapper);              // game 0x4DFB60 (WaitThread + DestroyThread; handle := 0)
//   uintptr_t currentThread();                 // nn::os::GetCurrentThread(); 0 if unknown
template <class Env>
inline bool onMainThread(Env& env, const Session& s, uintptr_t runner, const char** why) {
    uintptr_t cur = env.currentThread();
    if (!cur || !s.mainThread || cur != s.mainThread) { *why = "self-join: not the captured main thread"; return false; }
    uint64_t t = 0;
    if (!env.rd64(runner + runHead, t)) { *why = "list: unreadable head"; return false; }
    for (unsigned steps = 0; t; ++steps) {
        if (steps >= kMaxThreads || !env.plausible(uintptr_t(t))) { *why = "list: cycle/overlong/bad pointer"; return false; }
        if (cur == uintptr_t(t) + thOs) { *why = "self-join: caller is a Runner thread"; return false; }
        if (!env.rd64(uintptr_t(t) + thNext, t)) { *why = "list: unreadable next"; return false; }
    }
    return true;
}

// §3.1. Identity/LR/vptr/thread checks happen BEFORE the barrier reads the thread list (§4.1.4).
template <class Env>
inline Decision decide(Env& env, const Session& s, uintptr_t mgr, uintptr_t lr, const char** why) {
    *why = nullptr;
    uint64_t cur = 0; uint32_t next = 0;
    if (!s.active) return Decision::NoSession;
    if (!env.rd64(mgr + mgrCur, cur) || !env.rd32(mgr + mgrNext, next)) { *why = "H-B2: mgr unreadable"; return Decision::SafeStop; }
    if (uintptr_t(cur) != s.seq) return Decision::Foreign;
    // From here on `cur` IS our Seq: any incoherence is a non-returning safe stop, never orig.
    if (lr != env.base() + kDestroyPendingLr) { *why = "H-B2: LR"; return Decision::SafeStop; }
    uint64_t vptr = 0, owner = 0, back = 0, runner = 0, runner2 = 0;
    if (!env.plausible(s.seq) || !env.plausible(s.stage) || !env.rd64(s.seq, vptr) || !seqVptrOk(env.base(), uintptr_t(vptr))) {
        *why = "H-B2: vptr Seq"; return Decision::SafeStop;
    }
    uintptr_t kindRunner = s.kind == Kind::Ht2 ? stRunnerHt2 : s.kind == Kind::R21 ? stRunnerR21 : 0;
    if (!kindRunner || !env.rd64(s.seq + seqStage, owner) || !env.rd64(s.stage + stSeq, back) ||
        !env.rd64(s.stage + stRunner, runner) || !env.rd64(s.stage + kindRunner, runner2) || uintptr_t(owner) != s.stage ||
        uintptr_t(back) != s.seq || uintptr_t(runner) != s.seq + seqRunner || uintptr_t(runner2) != s.seq + seqRunner) {
        *why = "H-B2: identity"; return Decision::SafeStop;
    }
    if (!onMainThread(env, s, s.seq + seqRunner, why)) return Decision::SafeStop;
    if (int32_t(next) < 0) return Decision::NoNext;  // 0x5096F0 destroys nothing in this case [S]
    return Decision::Barrier;
}

template <class Env>
inline bool walk(Env& env, uintptr_t runner, uintptr_t (&out)[kMaxThreads], unsigned& n, const char** why) {
    n = 0; uint64_t t = 0;
    if (!env.rd64(runner + runHead, t)) { *why = "list: unreadable head"; return false; }
    while (t) {
        if (n >= kMaxThreads) { *why = "barrier: MAX (cycle or overlong list)"; return false; }  // bound BEFORE write
        if (!env.plausible(uintptr_t(t))) { *why = "list: bad pointer"; return false; }
        for (unsigned i = 0; i < n; ++i)
            if (out[i] == uintptr_t(t)) { *why = "list: cycle"; return false; }
        out[n++] = uintptr_t(t);
        if (!env.rd64(uintptr_t(t) + thNext, t)) { *why = "list: unreadable next"; return false; }
    }
    return true;
}

// §4 + §4.1. Whole Runner (all groups), native state semantics (0x514BC0): state 3 = already finished; a thread
// without OS handle (never created) is cancelled but neither signalled nor joined. Never times out.
template <class Env>
inline Report barrier(Env& env, const Session& s, uintptr_t runner) {
    Report r; const char* why = nullptr;
    uintptr_t seen[kMaxThreads]; unsigned nseen = 0;
    uintptr_t list[kMaxThreads]; unsigned nlist = 0;
    if (!walk(env, runner, list, nlist, &why)) { r.why = why; return r; }
    r.listed = nlist;
    for (unsigned i = 0; i < nlist; ++i) { uint32_t st = 0; if (env.rd32(list[i] + thState, st) && st < 4) r.before[st]++; }
    for (;;) {
        uintptr_t kids[kMaxThreads]; uint32_t state[kMaxThreads]; uint64_t handle[kMaxThreads]; unsigned n = 0;
        if (!walk(env, runner, list, nlist, &why)) { r.why = why; return r; }
        for (unsigned i = 0; i < nlist; ++i) {
            uintptr_t t = list[i]; bool known = false;
            for (unsigned k = 0; k < nseen; ++k) known |= seen[k] == t;
            uint32_t st = 0; uint64_t h = 0;
            if (!env.rd32(t + thState, st) || !env.rd64(t + thHandle, h)) { r.why = "thread: unreadable"; return r; }
            if (st > 3) { r.why = "thread: state out of range"; return r; }
            if (known || st == 3) continue;
            if (n >= kMaxThreads) { r.why = "barrier: MAX"; return r; }
            kids[n] = t; state[n] = st; handle[n] = h; n++;
        }
        if (n == 0) break;                                                      // fixed point
        if (r.rounds == kCap) { r.why = "barrier: no fixed point after cap rounds"; return r; }  // never start cap+1
        r.perRound[r.rounds++] = n;
        for (unsigned i = 0; i < n; ++i)                                        // incoherent with 0x514E00
            if ((state[i] == 0 && handle[i]) || (state[i] == 1 && !handle[i])) { r.why = "thread: state/handle incoherent"; return r; }
        for (unsigned i = 0; i < n; ++i)                                        // 1) publish cancellation
            if ((state[i] == 0 || state[i] == 1) && !env.wr32(kids[i] + thState, 2)) { r.why = "thread: state write"; return r; }
        env.fence();                                                            // state=2 visible before any signal
        for (unsigned i = 0; i < n; ++i)                                        // 2) wake every OS thread first
            if (handle[i]) env.signal(kids[i] + thResume);
        for (unsigned i = 0; i < n; ++i) {                                      // 3) join (native wait+destroy)
            if (!onMainThread(env, s, runner, &why)) { r.why = why; return r; }
            if (handle[i]) env.join(kids[i] + thWrap);
            if (nseen >= kMaxThreads) { r.why = "barrier: MAX (seen)"; return r; }
            seen[nseen++] = kids[i];
        }
    }
    // Postcondition, evaluated only after every join: no thread can still run.
    if (!walk(env, runner, list, nlist, &why)) { r.why = why; return r; }
    for (unsigned i = 0; i < nlist; ++i) {
        uint32_t st = 0; uint64_t h = 0;
        if (!env.rd32(list[i] + thState, st) || !env.rd64(list[i] + thHandle, h)) { r.why = "post: unreadable"; return r; }
        if (st != 2 && st != 3) { r.why = "post: state"; return r; }
        if (h) { r.why = "post: handle"; return r; }
        r.after[st]++;
    }
    r.ok = true; return r;
}

}  // namespace groove::b2
