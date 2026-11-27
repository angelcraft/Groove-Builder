"""(B2) Runner teardown with REAL join semantics (cooperative scheduler in sched.py) and real native workers incl.
nested coroutines. Compares reap / clear / step teardown with a lifetime barrier (cancel + join before the stage dtor)."""
import sys, json, collections; from common import *; from sched import Sched
IMG = sys.argv[1]
REAL = (0x515000, 0x515190, 0x515040, 0x515290, 0x5151D0, 0x515450, 0x5153A0, 0x514760, 0x5147A0, 0x5148F0, 0x514A90,
        0x515130, 0x514BC0, 0x4292C0, 0x4212D0, 0x514E00, 0x514EE0, 0x515150, 0x4290F0, 0x4D8D40, 0x1363D0, 0x4207F0, 0x4D9A10,
        0x428EF0, 0x420720, 0x514D60, 0x514D70, 0x514DD0, 0x514FB0, 0x514FD0, 0x514FF0, 0x4DFB60, 0x4DF9A0, 0x4DFC20, 0x4DFC70,
        0x4DFC80, 0x4DFC90, 0x4DFA20, 0x4DFB20, 0x514A40, 0x429290)
NESTED = {"HT2": (0x1398B0, 0x429330, 0x42B740, 0x1367F0), "R21": (0x1398B0, 0x421340)}
TRIP = {0x2064A0: "X ctor", 0x2068D0: "X::0x2068D0", 0x2CC0: "0x2CC0", 0x2E90: "0x2E90", 0x488940: "factory", 0x398C80: "stage16"}
def mk(nested):
    h = setup(IMG)
    h.mu.mem_map(0, 0x1000000)                           # harness artifact: zero page so null sub-objects of the synthetic stage read as 0
    h.watch.append((0, 0x1000000, "null-page"))
    h.automap = []
    def unm(uc, access, addr, size, value, ud):
        base = addr & ~0xFFFF
        try: uc.mem_map(base, 0x10000); h.automap.append(hex(addr)); return True
        except Exception: return False
    h.mu.hook_add(UC_HOOK_MEM_READ_UNMAPPED | UC_HOOK_MEM_WRITE_UNMAPPED, unm)
    for f in REAL: h.add_real(f)
    for o in (0x514D70, 0x514FD0): h.stubs.pop(o, None)
    h.entries = collections.Counter()
    if nested:
        for f in nested:
            h.add_real(f); h.pre[f] = (lambda f: (lambda h, a: (h.entries.update([hex(f)]), None)[1]))(f)
    h.freed = {}
    h.stubs[0x4E02F0] = lambda h: h.alloc(max(h.x(0), 16))
    def free(h): h.freed[h.x(0)] = h.x(1); return 0
    h.stubs[0x4E04E0] = free
    h.stubs[0x50A6B0] = lambda h: h.alloc(0x1000); h.stubs[0x50A710] = lambda h: 0
    h.trip = collections.Counter()
    for o, n in TRIP.items(): h.pre[o] = (lambda n: (lambda h, a: (h.trip.update([n]), None)[1]))(n)
    return h
def build(h, S, kind, nthreads=2):
    runner = h.alloc(0x70); S.call(0x515000, runner)
    stage = h.alloc(0xF000); S.call(0x514760, stage + 0x2978, runner, stage); gid = h.ri(stage + 0x2988)
    h.wq(stage + 0x2C88, stage)                         # PMF holder: [stage+0x2C78 + 0x10] = stage (as the native ctors do)
    vt = 0xD4D450 if kind == "HT2" else 0xD4D030; body = 0x428EF0 if kind == "HT2" else 0x420720
    ths = []
    for _ in range(nthreads):
        th = h.alloc(0x298)
        S.call(0x514A90, th, runner, gid, G + 0x429290, th + 0x280, stage)
        h.wq(th, G + vt + 0x10); h.wq(th + 0x18, G + vt + 0x40)
        h.wq(th + 0x280, stage + 0x2C78); h.wq(th + 0x288, G + body); h.wq(th + 0x290, 0)
        S.call(0x5153A0, runner, th); ths.append(th)
    return runner, stage, ths
LAST = {}
def scenario(kind, teardown, ticks, nested=True):
    h = mk(NESTED[kind] if nested else None); S = Sched(h); LAST["h"] = h; LAST["S"] = S
    h.phase = "build"; runner, stage, ths = build(h, S, kind)
    h.phase = "tick"
    for t in range(ticks):
        for th in ths: S.call(0x514E00, th)
    st = {"kind": kind, "teardown": teardown, "ticks": ticks, "nested_real": nested}
    st["after_ticks"] = {"states": [h.ri(th + 0x250) for th in ths], "os": S.status()}
    if teardown == "barrier":
        h.phase = "barrier"
        for th in ths:                                   # cancel: request stop + wake, then quiescence: join
            if h.ri(th + 0x250) == 1: h.wi(th + 0x250, 2)
            S.call(0x4DFC70, th + 0x220); S.call(0x4DFB60, th + 0x28)
        st["after_barrier"] = {"states": [h.ri(th + 0x250) for th in ths], "os": S.status()}
    if teardown == "tstop-only":
        h.phase = "tstop"
        for th in ths: h.wi(th + 0x250, 2)
        st["tStop_true"] = [S.call(0x514DD0, th) & 1 for th in ths]
        st["after_tstop"] = {"os": S.status()}
    h.phase = "stage-dtor"; S.call(0x4290F0 if kind == "HT2" else 0x4207F0, stage)
    h.poison.append((stage, stage + 0xF000, "freed-stage"))
    st["after_stage_dtor"] = {"states": [h.ri(th + 0x250) for th in ths], "os": S.status(), "groups": (h.rq(runner + 0x58) - h.rq(runner + 0x50)) // 0x18}
    h.phase = "teardown"
    if teardown in ("reap", "barrier", "tstop-only"): S.call(0x515450, runner)
    elif teardown == "clear": S.call(0x515290, runner)
    elif teardown == "resume-after-free":                # POSITIVE CONTROL: wake children (state 1) after the stage was freed
        for k in range(15):
            for th in ths:
                S.call(0x4DFC70, th + 0x220); S.call(0x4DFC80, th + 0x208)
        S.call(0x515290, runner)
    elif teardown == "step":
        for th in ths: S.call(0x514E00, th)
        S.call(0x515450, runner)
    st["final"] = {"os": S.status(), "threads_freed": sum(1 for th in ths if th in h.freed)}
    late = [(p, rw, hex(pc), hex(o)) for p, rw, pc, o, l in h.late]
    st["late_stage_access"] = len(late); st["late_by_phase"] = dict(collections.Counter(p for p, *_ in late)); st["late_samples"] = late[:6]
    st["os_events_teardown"] = [e for e in S.log if e[1] in ("join", "exit", "DEADLOCK")][-8:]
    st["child_exit_before_stage_dtor"] = None
    st["tripwires"] = dict(h.trip)
    st["nested_entries"] = dict(h.entries); st["automapped_pages"] = len(h.automap)
    st["waits_per_thread"] = dict(collections.Counter(e[0] for e in S.log if e[1] == "wait" and e[0] != "main"))
    st["null_page_writes"] = sum(1 for w in h.writes if w[5] == "null-page")
    st["unlisted_in_children"] = sorted(set(hex(c[2]) for c in h.calls if c[1] == "unlisted" and ":" in c[0]))[:40]
    return st
out = []
for kind in ("HT2", "R21"):
    for td in ("reap", "clear", "step", "barrier", "tstop-only", "resume-after-free"):
        for ticks in (1, 3, 6):
            try: out.append(scenario(kind, td, ticks))
            except Exception as e:
                hh = LAST["h"]; out.append({"kind": kind, "teardown": td, "ticks": ticks, "error": repr(e) + str(e), "phase": hh.phase,
                    "pc": hex(hh.mu.reg_read(UC_ARM64_REG_PC) - G), "lr": hex(hh.mu.reg_read(UC_ARM64_REG_LR) - G), "log": LAST["S"].log[-6:]})
json.dump(out, open(sys.argv[2], "w"), indent=1, default=str)
for r in out:
    if "error" in r: print(r["kind"], r["teardown"], r["ticks"], "ERROR", r["error"], r["phase"], r["pc"], r["lr"], r["log"]); continue
    print(r["kind"], r["teardown"], r["ticks"], "| ticks:", r["after_ticks"]["os"], "| dtor:", r["after_stage_dtor"]["os"], "| final:", r["final"], "| late:", r["late_stage_access"], r["late_by_phase"], "| trip:", r["tripwires"], "| nested:", r["nested_entries"], "waits:", r["waits_per_thread"], "automap:", r["automapped_pages"], "nullW:", r["null_page_writes"])
