// GE-151 interim (Grok): host tests (ASan/UBSan) for engine/src/b2_owner.hpp — the SAME decision table and barrier
// compiled into the module. Synthetic Seq/Stage/Runner/Thread objects; no game code.
#include "b2_owner.hpp"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
#include <memory>
using namespace groove::b2;
struct Obj { alignas(16) uint8_t b[0xC000]; };
struct World {
    std::vector<std::unique_ptr<Obj>> objs;
    uintptr_t base = 0x10000000;
    uintptr_t seq = 0, stage = 0, mgr = 0;
    Kind kind = Kind::R21;
    uintptr_t current = 0x7000;  // main ThreadType*
    unsigned signals = 0, joins = 0;
    int appendOnJoin = 0;        // >0: N joins append a new running sibling; -1: forever
    bool joinClearsHandle = true;
    uintptr_t* tail() { uintptr_t* p = reinterpret_cast<uintptr_t*>(seq + seqRunner + runHead);
        while (*p) p = reinterpret_cast<uintptr_t*>(*p + thNext); return p; }
    uintptr_t alloc() { objs.emplace_back(new Obj{}); return reinterpret_cast<uintptr_t>(objs.back()->b); }
    uintptr_t thread(uint32_t state, bool handle) {
        uintptr_t t = alloc(); *reinterpret_cast<uint32_t*>(t + thState) = state;
        *reinterpret_cast<uint64_t*>(t + thHandle) = handle ? 0x1234 : 0; *tail() = t; return t;
    }
    World(Kind k = Kind::R21) : kind(k) {
        seq = alloc(); stage = alloc(); mgr = alloc();
        *reinterpret_cast<uint64_t*>(seq) = base + kSeqVptr[2];
        *reinterpret_cast<uint64_t*>(seq + seqStage) = stage;
        *reinterpret_cast<uint64_t*>(stage + stSeq) = seq;
        *reinterpret_cast<uint64_t*>(stage + stRunner) = seq + seqRunner;
        *reinterpret_cast<uint64_t*>(stage + (k == Kind::Ht2 ? stRunnerHt2 : stRunnerR21)) = seq + seqRunner;
        *reinterpret_cast<uint64_t*>(mgr + mgrCur) = seq; *reinterpret_cast<int32_t*>(mgr + mgrNext) = 5;
    }
    Session session() { Session s; s.active = true; s.kind = kind; s.gen = 1; s.seq = seq; s.stage = stage; s.mainThread = 0x7000; return s; }
};
struct TestEnv {
    World& w;
    uintptr_t base() const { return w.base; }
    bool plausible(uintptr_t p) const { return p && !(p & 7) && !(p >= w.base && p < w.base + 0xD98000); }
    bool rd64(uintptr_t a, uint64_t& v) { std::memcpy(&v, reinterpret_cast<void*>(a), 8); return true; }
    bool rd32(uintptr_t a, uint32_t& v) { std::memcpy(&v, reinterpret_cast<void*>(a), 4); return true; }
    bool wr32(uintptr_t a, uint32_t v) { std::memcpy(reinterpret_cast<void*>(a), &v, 4); return true; }
    void fence() {}
    void signal(uintptr_t) { w.signals++; }
    void join(uintptr_t wrap) {
        w.joins++; uintptr_t t = wrap - thWrap;
        if (w.joinClearsHandle) *reinterpret_cast<uint64_t*>(t + thHandle) = 0;
        if (w.appendOnJoin) { if (w.appendOnJoin > 0) w.appendOnJoin--; w.thread(1, true); }
    }
    uintptr_t currentThread() { return w.current; }
};
static Decision dec(World& w, Session s, uintptr_t lr) { TestEnv e{w}; const char* why = nullptr; return decide(e, s, w.mgr, lr, &why); }
static Report bar(World& w) { TestEnv e{w}; return barrier(e, w.session(), w.seq + seqRunner); }
int main() {
    const uintptr_t LR = 0x10000000 + kDestroyPendingLr;
    for (Kind k : {Kind::Ht2, Kind::R21}) {
        World w(k); w.thread(0, false); w.thread(1, true); w.thread(2, true);
        Session s = w.session();
        Session off = s; off.active = false; assert(dec(w, off, LR) == Decision::NoSession);
        World other(k); *reinterpret_cast<uint64_t*>(w.mgr + mgrCur) = other.seq; assert(dec(w, s, LR) == Decision::Foreign);
        *reinterpret_cast<uint64_t*>(w.mgr + mgrCur) = w.seq;
        assert(dec(w, s, LR + 4) == Decision::SafeStop);                                   // LR
        *reinterpret_cast<int32_t*>(w.mgr + mgrNext) = -1; assert(dec(w, s, LR) == Decision::NoNext);
        *reinterpret_cast<int32_t*>(w.mgr + mgrNext) = 5; assert(dec(w, s, LR) == Decision::Barrier);
        w.current = 0x7008; assert(dec(w, s, LR) == Decision::SafeStop); w.current = 0x7000;  // not captured main
        Session child = s; uintptr_t t0 = *reinterpret_cast<uint64_t*>(w.seq + seqRunner + runHead);
        w.current = t0 + thOs; child.mainThread = t0 + thOs; assert(dec(w, child, LR) == Decision::SafeStop); w.current = 0x7000;
        uint64_t v = *reinterpret_cast<uint64_t*>(w.seq); *reinterpret_cast<uint64_t*>(w.seq) = v + 0x10;
        assert(dec(w, s, LR) == Decision::SafeStop); *reinterpret_cast<uint64_t*>(w.seq) = v;            // vptr
        *reinterpret_cast<uint64_t*>(w.stage + stSeq) = w.seq + 8; assert(dec(w, s, LR) == Decision::SafeStop);
        *reinterpret_cast<uint64_t*>(w.stage + stSeq) = w.seq;
        uintptr_t kr = k == Kind::Ht2 ? stRunnerHt2 : stRunnerR21;
        *reinterpret_cast<uint64_t*>(w.stage + kr) = 0; assert(dec(w, s, LR) == Decision::SafeStop);
        *reinterpret_cast<uint64_t*>(w.stage + kr) = w.seq + seqRunner;
        Session nokind = s; nokind.kind = Kind::None; assert(dec(w, nokind, LR) == Decision::SafeStop);
        Report r = bar(w);
        assert(r.ok && r.rounds == 1 && r.listed == 3 && w.signals == 2 && w.joins == 2 && r.after[2] == 3);
    }
    { World w; w.thread(1, true); w.appendOnJoin = 2; Report r = bar(w); assert(r.ok && r.rounds == 3 && r.listed == 1); }
    { World w; w.thread(1, true); w.appendOnJoin = -1; Report r = bar(w);
      assert(!r.ok && r.rounds == kCap && !std::strcmp(r.why, "barrier: no fixed point after cap rounds") && w.joins == kCap); }
    { World w; uintptr_t a = w.thread(1, true); w.thread(1, true); *reinterpret_cast<uint64_t*>(*reinterpret_cast<uint64_t*>(a + thNext) + thNext) = a;
      Report r = bar(w); assert(!r.ok && w.joins == 0); }
    { World w; for (unsigned i = 0; i < kMaxThreads + 1; i++) w.thread(1, true); Report r = bar(w); assert(!r.ok && w.joins == 0); }
    { World w; for (unsigned i = 0; i < kMaxThreads; i++) w.thread(1, true); Report r = bar(w); assert(r.ok && w.joins == kMaxThreads); }
    { World w; w.thread(7, true); Report r = bar(w); assert(!r.ok && w.signals == 0); }
    { World w; w.thread(0, true); Report r = bar(w); assert(!r.ok && !std::strcmp(r.why, "thread: state/handle incoherent") && w.signals == 0); }
    { World w; w.thread(1, false); Report r = bar(w); assert(!r.ok && w.signals == 0); }
    { World w; w.thread(1, true); w.joinClearsHandle = false; Report r = bar(w); assert(!r.ok && !std::strcmp(r.why, "post: handle")); }
    { World w; w.thread(3, true); Report r = bar(w); assert(!r.ok && w.joins == 0); }              // finished but OS thread alive
    { World w; w.thread(3, false); w.thread(2, false); Report r = bar(w); assert(r.ok && r.rounds == 1 && w.joins == 0); }
    { World w; uintptr_t t = w.thread(1, true); *reinterpret_cast<uint64_t*>(t + thNext) = 0x10000008;  // pointer into main
      Report r = bar(w); assert(!r.ok); }
    std::puts("b2_owner: all tests passed");
    return 0;
}
