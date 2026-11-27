"""(B2) Runner teardown with a COOPERATIVE join model (sched.py; NOT Horizon's scheduler) over real game code:
Runner, threads, HT2/R21 native workers and nested coroutines. Acceptance runs forbid automap and null-page access.
Exit status != 0 if any assertion fails."""
import sys, json, collections; from common import *; from sched import Sched
IMG = sys.argv[1]
REAL = (0x515000, 0x515190, 0x515040, 0x515290, 0x5151D0, 0x515450, 0x5153A0, 0x514760, 0x5147A0, 0x5148F0, 0x514A90,
        0x515130, 0x514BC0, 0x4292C0, 0x4212D0, 0x514E00, 0x514EE0, 0x515150, 0x4290F0, 0x4D8D40, 0x1363D0, 0x4207F0, 0x4D9A10,
        0x428EF0, 0x420720, 0x514D60, 0x514D70, 0x514DD0, 0x514FB0, 0x514FD0, 0x514FF0, 0x4DFB60, 0x4DF9A0, 0x4DFC20, 0x4DFC70,
        0x4DFC80, 0x4DFC90, 0x4DFA20, 0x4DFB20, 0x514A40, 0x429290)
NESTED = {"HT2": (0x1398B0, 0x429330, 0x42B740, 0x1367F0), "R21": (0x1398B0, 0x421340)}
TRIP = {0x2064A0: "X ctor", 0x2068D0: "X::0x2068D0", 0x2CC0: "0x2CC0", 0x2E90: "0x2E90", 0x488940: "factory", 0x398C80: "stage16"}
LOW = 0x1000000
MUT = set()   # self-test mutations: "no-runner", "no-vptr"
def mk(nested, allow_automap=False):
    h = setup(IMG)
    h.mu.mem_map(0, LOW)                                 # mapped ONLY to detect null-page accesses; any access fails acceptance
    h.low = []
    h.mu.hook_add(UC_HOOK_MEM_READ, lambda uc, ac, a, s, v, u: h.low.append((h.phase, "R", hex(uc.reg_read(UC_ARM64_REG_PC) - G), hex(a))), begin=0, end=LOW - 1)
    h.mu.hook_add(UC_HOOK_MEM_WRITE, lambda uc, ac, a, s, v, u: h.low.append((h.phase, "W", hex(uc.reg_read(UC_ARM64_REG_PC) - G), hex(a))), begin=0, end=LOW - 1)
    h.automap = []
    def unm(uc, access, addr, size, value, ud):
        h.automap.append((h.phase, hex(uc.reg_read(UC_ARM64_REG_PC) - G), hex(addr)))
        if not allow_automap: return False                # acceptance: unmapped access aborts the scenario
        try: uc.mem_map(addr & ~0xFFFF, 0x10000); return True
        except Exception: return False
    h.mu.hook_add(UC_HOOK_MEM_READ_UNMAPPED | UC_HOOK_MEM_WRITE_UNMAPPED, unm)
    for f in REAL: h.add_real(f)
    for o in (0x514D70, 0x514FD0): h.stubs.pop(o, None)
    h.entries = collections.Counter()
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
def fake_vptr(h):
    """object whose vtable has offset-to-top 0 and every virtual slot -> harness fake returning 0"""
    vt = h.alloc(0x400)
    for k in range(0x40): h.wq(vt + 0x20 + 8 * k, h.make_fake("subobj.vt+%#x" % (8 * k)))
    return vt + 0x20
def build(h, S, kind, nthreads=2):
    runner = h.alloc(0x70); S.call(0x515000, runner)
    stage = h.alloc(0xF000); S.call(0x514760, stage + 0x2978, runner, stage); gid = h.ri(stage + 0x2988)
    # PMF holder as the native ctors build it: HT2 holder stage+0x2C78 (+8 runner, +0x10 stage, +0x18 gid);
    # R21 ctor 0x4202C0: holder stage+0x3548 (+0x3550 runner, +0x3558 stage, +0x3560 gid = *(stage+0x2988))
    hold = 0x2C78 if kind == "HT2" else 0x3548
    h.wq(stage + hold + 0x10, stage); h.wi(stage + hold + 0x18, gid)
    if "no-runner" not in MUT: h.wq(stage + hold + 8, runner)               # runner pointer used by nested spawns (HT2 +0x2C80, R21 +0x3550)
    if kind == "HT2" and "no-vptr" not in MUT: h.wq(stage + 0x6348, fake_vptr(h)) # sub-object passed to 0x1367F0 (vptr read at 0x136870)
    vt = 0xD4D450 if kind == "HT2" else 0xD4D030; body = 0x428EF0 if kind == "HT2" else 0x420720
    ths = []
    for _ in range(nthreads):
        th = h.alloc(0x298)
        S.call(0x514A90, th, runner, gid, G + 0x429290, th + 0x280, stage)
        h.wq(th, G + vt + 0x10); h.wq(th + 0x18, G + vt + 0x40)
        h.wq(th + 0x280, stage + hold); h.wq(th + 0x288, G + body); h.wq(th + 0x290, 0)
        S.call(0x5153A0, runner, th); ths.append(th)
    return runner, stage, gid, ths
def group_threads(h, runner, gid):
    out, p = [], h.rq(runner + 8)
    while p: 
        if h.ri(p + 0x254) == gid: out.append(p)
        p = h.rq(p + 8)
    return out
def barrier(h, S, runner, gid):
    """cancel all -> signal all -> join all; repeat until no new child of the group appears (fixed point)."""
    rounds, seen = 0, set()
    if S.cur != "main": return {"quiescent": False, "rounds": 0, "why": "self-join: barrier called from a child"}
    while True:
        rounds += 1
        kids = [t for t in group_threads(h, runner, gid) if t not in seen]
        if not kids: break
        for t in kids:                                   # 1) publish cancel (state 2) for every child first, incl. never-started (0)
            if h.ri(t + 0x250) in (0, 1): h.wi(t + 0x250, 2)
        for t in kids: S.call(0x4DFC70, t + 0x220)       # 2) signal all
        for t in kids:                                   # 3) wait for each (join); a deadlock = no quiescence
            if S.call(0x4DFB60, t + 0x28) is None: return {"quiescent": False, "rounds": rounds}
            seen.add(t)
        if rounds > 8: return {"quiescent": False, "rounds": rounds}
    st = [os_state(S, t) for t in seen]
    return {"quiescent": bool(seen) and all(x in ("done", "never-started/cancelled") for x in st), "rounds": rounds, "children": len(seen), "states": st}
def os_state(S, th):
    t = S.th.get(th + 0x30)                              # nn::os thread object = th+0x28+8 (0x4DFB60 -> A65FE0(x0+8))
    if t: return t["state"]
    return "never-started/cancelled" if S.h.ri(th + 0x250) == 2 else "never-started"
def scenario(kind, teardown, ticks, resumes=15):
    h = mk(NESTED[kind]); S = Sched(h)
    h.phase = "build"; runner, stage, gid, ths = build(h, S, kind)
    h.phase = "tick"
    for t in range(ticks):
        for th in group_threads(h, runner, gid): S.call(0x514E00, th)
    kids = group_threads(h, runner, gid)
    allk = []; p = h.rq(runner + 8)
    while p: allk.append(p); p = h.rq(p + 8)
    st = {"kind": kind, "teardown": teardown, "ticks": ticks, "children": len(kids), "runner_list_len": len(allk), "os_after_ticks": S.status()}
    h.kids = kids
    if teardown == "barrier":
        h.phase = "barrier"; st["barrier"] = barrier(h, S, runner, gid)
        ds = [os_state(S, t) for t in kids]; st["states_before_dtor"] = ds
        st["done_before_dtor"] = len(ds) == len(kids) > 0 and all(x in ("done", "never-started/cancelled") for x in ds)
        st["states_count"] = dict(collections.Counter(ds))
        if not st["barrier"]["quiescent"]:
            st["dtor"] = "NOT CALLED (no quiescence: stage kept alive)"; return finish(h, S, st, runner, gid)
    if teardown == "tstop-only":
        h.phase = "tstop"
        for th in kids: h.wi(th + 0x250, 2)
        st["tStop_true"] = [S.call(0x514DD0, th) & 1 for th in kids]
        st["alive_after_tStop"] = [os_state(S, th) for th in kids if (th + 0x30) in S.th]
        st["started_children"] = len(st["alive_after_tStop"])
    h.phase = "stage-dtor"; S.call(0x4290F0 if kind == "HT2" else 0x4207F0, stage)
    h.poison.append((stage, stage + 0xF000, "freed-stage")); st["dtor"] = "called"
    st["os_after_dtor"] = S.status()
    h.phase = "teardown"
    if teardown == "clear": S.call(0x515290, runner)
    elif teardown == "step":
        for th in group_threads(h, runner, gid): S.call(0x514E00, th)
        S.call(0x515450, runner)
    elif teardown == "resume-after-free":             # POSITIVE CONTROL: wake children (state 1) after the stage was freed
        live = [th for th in kids if os_state(S, th) == "blocked"]
        for k in range(resumes):
            for th in live:
                S.call(0x4DFC70, th + 0x220); S.call(0x4DFC80, th + 0x208)
        S.call(0x515290, runner)
    else: S.call(0x515450, runner)
    return finish(h, S, st, runner, gid)
def finish(h, S, st, runner, gid):
    late = [(p, rw, hex(pc), hex(o)) for p, rw, pc, o, l in h.late]
    st["late_stage_access"] = len(late); st["late_samples"] = late[:6]
    st["remaining_group_threads"] = len(group_threads(h, runner, gid))
    st["os_final"] = S.status(); st["frees_total"] = len(h.freed); st["threads_freed"] = sum(1 for t in h.kids if t in h.freed)
    st["automap"] = h.automap; st["null_page_access"] = h.low[:10]; st["null_page_count"] = len(h.low)
    st["deadlock"] = [e for e in S.log if e[1] == "DEADLOCK"]
    st["tripwires"] = dict(h.trip); st["nested_entries"] = dict(h.entries)
    st["waits_per_thread"] = dict(collections.Counter(e[0] for e in S.log if e[1] == "wait" and e[0] != "main"))
    st["join_sequence"] = [e for e in S.log if e[1] in ("join", "exit")][-8:]
    return st
out, fails = [], []
def check(cond, msg):
    if not cond: fails.append(msg)
for kind in ("HT2", "R21"):
    for td in ("reap", "clear", "step", "barrier", "tstop-only", "resume-after-free"):
        for ticks in (1, 3, 6):
            tag = "%s/%s/%d" % (kind, td, ticks)
            try: r = scenario(kind, td, ticks)
            except Exception as e: out.append({"kind": kind, "teardown": td, "ticks": ticks, "error": repr(e)}); fails.append(tag + ": exception " + repr(e)); continue
            out.append(r)
            check(not r["automap"], tag + ": automap " + str(r["automap"]))
            check(r["null_page_count"] == 0, tag + ": null-page access " + str(r["null_page_access"][:3]))
            check(not r["deadlock"], tag + ": deadlock")
            check(r["children"] >= 2, tag + ": vacuous (children=%d)" % r["children"])
            check(len(r["os_final"]) >= 2 and all(v[0] == "done" for v in r["os_final"].values()), tag + ": thread not done at end " + str(r["os_final"]))
            check(r["remaining_group_threads"] == 0 and r["threads_freed"] == r["children"] == r["runner_list_len"], tag + ": not freed (%d left, %d freed)" % (r["remaining_group_threads"], r["threads_freed"]))
            check(not r["tripwires"], tag + ": tripwire " + str(r["tripwires"]))
            if td == "resume-after-free":
                if kind == "HT2": check(r["late_stage_access"] > 0, tag + ": positive control did not trigger")
                r["control"] = "TRIGGERED" if r["late_stage_access"] else "INCONCLUSIVE"
            else:
                check(r["late_stage_access"] == 0, tag + ": late access after free " + str(r["late_samples"][:2]))
            if td == "barrier":
                check(r["barrier"]["quiescent"] and r["done_before_dtor"], tag + ": barrier without quiescence before dtor")
            if td == "tstop-only":
                check(len(r["tStop_true"]) == r["children"] and all(r["tStop_true"]) and sum(s == "blocked" for s in r["alive_after_tStop"]) >= 2 and all(s in ("blocked", "done") for s in r["alive_after_tStop"]), tag + ": tStop/alive expectation")
            check(sum(r["waits_per_thread"].values()) >= ticks, tag + ": children did not run")
# self-test: the acceptance checks must reject the two defects the review found (HT2 automap, R21 null page)
selftest = {}
for mut, kind in (("no-vptr", "HT2"), ("no-runner", "R21")):
    MUT.clear(); MUT.add(mut)
    try: r = scenario(kind, "barrier", 3); det = {"automap": r["automap"][:2], "null": r["null_page_access"][:3]}; caught = bool(r["automap"] or r["null_page_count"])
    except Exception as e: det = {"exception": repr(e)[:160]}; caught = True
    selftest[mut] = {"kind": kind, "caught": caught, "detail": det}
    check(caught, "selftest %s not detected" % mut)
MUT.clear()
print("SELFTEST", json.dumps(selftest, default=str))
json.dump({"scenarios": out, "selftest": selftest, "failures": fails}, open(sys.argv[2], "w"), indent=1, default=str)
for r in out:
    if "error" in r: print("ERROR", r); continue
    print(r["kind"], r["teardown"], r["ticks"], "children", r["children"], "late", r["late_stage_access"], "threads_freed", r["threads_freed"], "list", r["runner_list_len"], "automap", len(r["automap"]), "null", r["null_page_count"], r.get("control", ""), r.get("barrier", ""))
print("FAILURES:", len(fails)); [print(" -", f) for f in fails]
sys.exit(1 if fails else 0)
