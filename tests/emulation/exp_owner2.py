"""GE-152 / Stage owner, step 2: REAL owner teardown with REAL host Stage constructed by its REAL ctor.
Seq (owner) -> SceneMgr destroyPending 0x5096F0 -> Seq deleting -> Seq dtor -> Stage deleting -> ... -> Runner clear.
Cooperative scheduler (sched.py) models nn::os threads/events ONLY; it is NOT Horizon. Local image by argument,
never published; output = addresses, offsets, counters and labels only. Exit != 0 on any failed assertion."""
import sys, json, collections, struct
from common import *; from sched import Sched
IMG = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else None
LOW = 0x1000000
REAL = (0x515000, 0x515190, 0x515040, 0x515290, 0x5151D0, 0x515450, 0x5153A0, 0x514760, 0x5147A0, 0x5148F0, 0x514A90,
        0x515130, 0x514BC0, 0x4292C0, 0x4212D0, 0x514E00, 0x514EE0, 0x515150, 0x514D60, 0x514D70, 0x514DD0, 0x514FB0,
        0x514FD0, 0x514FF0, 0x4DFB60, 0x4DF9A0, 0x4DFC20, 0x4DFC70, 0x4DFC80, 0x4DFC90, 0x4DFA20, 0x4DFB20, 0x514A40, 0x429290, 0x4212A0,
        # owner chain
        0x5096F0, 0x2AB5F0, 0x2AB4D0, 0x2ABA50, 0x2AB930, 0x2ABEB0, 0x2ABD90, 0x2AC310, 0x2AC1F0, 0x2AC750, 0x2AC630,
        0x130080, 0x1283A0,
        # host stage: ctors, workers, dtors and the base-dtor callees being classified
        0x428D70, 0x4D8C10, 0x136180, 0x5059C0, 0x5055C0, 0x505620, 0x4EE260, 0x4EE330, 0x4EE490, 0x5043E0, 0x504440, 0x4DF800, 0x4DF820,
        0x4291A0, 0x4290F0, 0x4D8D40, 0x1363D0, 0x505AB0, 0x428EF0, 0x139020, 0x1306F0,
        0x4202C0, 0x4D94F0, 0x420C40, 0x4207F0, 0x4D9A10, 0x420720, 0x421340)
NESTED = {"HT2": (0x1398B0, 0x429330, 0x42B740, 0x1367F0), "R21": (0x1398B0,)}
SEQ_CLASSES = {0: (0x2AB5F0, 0x2AB4D0), 1: (0x2ABA50, 0x2AB930), 2: (0x2ABEB0, 0x2ABD90), 3: (0x2AC310, 0x2AC1F0), 4: (0x2AC750, 0x2AC630)}
GLOBAL_MGR_VAR = 0x10BD820          # *(GOT 0xD9D8C0): default manager used by 0x4EE260 when its owner arg is null
def seq_vptr(h, dtor):
    """vptr the class dtor stores first (adrp+add at dtor entry)."""
    import capstone
    md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM); page = None
    for i in md.disasm(h.img[dtor:dtor + 0x40], dtor):
        if i.mnemonic == "adrp" and page is None: page = int(i.op_str.split("#")[1], 16)
        elif i.mnemonic == "ldr" and page is not None and "x8, [x8" in i.op_str:   # GOT form
            return h.rq(G + page + int(i.op_str.split("#")[1].rstrip("]"), 16)) + 0x10
        elif i.mnemonic == "add" and page is not None and i.op_str.startswith("x8, x8, #"):
            return G + page + int(i.op_str.split("#")[1], 16) + 0x10
    raise RuntimeError("vptr")
def list_nodes(h, head, limit=64):
    out, p = [], h.rq(head)
    while p and p != head and len(out) < limit: out.append(h.rq(p + 0x10)); p = h.rq(p)
    return out
def mk(kind):
    h = setup(IMG)
    h.mu.mem_map(0, LOW); h.low = []
    h.mu.hook_add(UC_HOOK_MEM_READ, lambda uc, ac, a, s, v, u: h.low.append((h.phase, "R", hex(uc.reg_read(UC_ARM64_REG_PC) - G), hex(a))), begin=0, end=LOW - 1)
    h.mu.hook_add(UC_HOOK_MEM_WRITE, lambda uc, ac, a, s, v, u: h.low.append((h.phase, "W", hex(uc.reg_read(UC_ARM64_REG_PC) - G), hex(a))), begin=0, end=LOW - 1)
    h.unmapped = []
    def unm(uc, access, addr, size, value, ud):
        h.unmapped.append((h.phase, hex(uc.reg_read(UC_ARM64_REG_PC) - G), hex(addr))); return False
    h.mu.hook_add(UC_HOOK_MEM_READ_UNMAPPED | UC_HOOK_MEM_WRITE_UNMAPPED, unm)
    for f in REAL: h.add_real(f)
    h.entries = collections.Counter()
    for f in NESTED[kind]:
        h.add_real(f); h.pre[f] = (lambda f: (lambda h, a: (h.entries.update([hex(f)]), None)[1]))(f)
    for o in (0x514D70, 0x514FD0): h.stubs.pop(o, None)
    h.freed = {}; h.allocs = {}
    fvt = h.fvt = h.alloc(0x400)
    for k in range(0x80): h.wq(fvt + 8 * k, h.make_fake("alloc.vt+%#x" % (8 * k)))
    def alloc(h):                                     # fresh objects carry a harness vtable (all slots -> logged fake returning 0)
        p = h.alloc(max(h.x(0), 16)); h.allocs[p] = h.x(0); h.wq(p, fvt); return p
    h.stubs[0x4E02F0] = alloc
    def free(h):
        p, n = h.x(0), h.x(1); h.freed[p] = n; h.order.append(("free", h.lbl(p), n))
        if n: h.poison.append((p, p + n, "freed:" + h.lbl(p)))
        return 0
    h.stubs[0x4E04E0] = free
    h.stubs[0x4E04A0] = lambda h: (h.order.append(("free-unsized", h.lbl(h.x(0)))), 0)[1]
    h.stubs[0x50A6B0] = lambda h: h.alloc(0x1000); h.stubs[0x50A710] = lambda h: 0
    h.stubs[0x4FDBE0] = lambda h: (lambda p: (h.wq(p, fvt), p)[1])(h.alloc(0x100))       # layer/handle getter used by 0x4D8C10 (object, not a bool)
    h.order = []; h.labels = {}
    def lbl(p):
        if p in h.labels: return h.labels[p]
        for base, name, n in getattr(h, "ranges", ()):
            if base <= p < base + n: return "%s+%#x" % (name, p - base)
        return "heap" if p >= HEAP else hex(p)
    h.lbl = lbl
    return h
def build(h, S, kind, cls):
    seq = h.alloc(0xA080 + 0x100); h.labels[seq] = "seq"
    vp = seq_vptr(h, SEQ_CLASSES[cls][1]); h.wq(seq, vp)
    assert h.rq(vp + 8) - G == SEQ_CLASSES[cls][0], "deleting slot of Seq class %d" % cls
    runner = seq + 0x58; S.call(0x515000, runner); h.labels[runner] = "runner"
    parent = seq + 0x30; head = parent + 8; h.wq(head, head); h.wq(head + 8, head)   # empty child list of the scene node
    h.wq(parent + 0x20, h.alloc(0x200))                                            # resource-id owner passed to stubs
    var = G + GLOBAL_MGR_VAR; gm = h.alloc(0x200); h.wq(var, gm); h.wq(gm + 8, gm + 8); h.wq(gm + 0x10, gm + 8)
    h.gm = gm
    for o in (0x94E0, 0x9610): S.call(0x4EE260, seq + o, 0)
    S.call(0x514760, seq + 0xEB0, runner, seq)                 # Seq's own thread group (unregistered at 0x1302E0)   # as the real Seq base ctor does (0x12FEBC / 0x12FED0)
    size = 0x7AD0 if kind == "HT2" else 0xE550
    stage = h.alloc(size + 0x100); h.labels[stage] = "stage"; h.allocs[stage] = size
    h.ranges = [(stage, "stage", size), (seq, "seq", 0xA080)]
    h.phase = "ctor"
    S.call(0x428D70 if kind == "HT2" else 0x4202C0, stage, seq, 0, 0, 1, 0x780, 0x438)
    h.wq(seq + 0xA078, stage)
    if kind == "HT2" and h.rq(stage + 0x6348) == 0:            # as exp_b2: object passed to 0x1367F0 comes from a stubbed loader
        o = h.alloc(0x100); h.wq(o, h.fvt); h.wq(stage + 0x6348, o)
    gid = h.ri(stage + 0x2988)
    mgr = h.alloc(0x60); h.wq(mgr + 0x10, seq); h.wi(mgr + 0x18, 5); h.labels[mgr] = "mgr"
    return dict(seq=seq, runner=runner, parent_head=head, stage=stage, gid=gid, mgr=mgr, size=size)
def group_threads(h, runner, gid):
    out, p = [], h.rq(runner + 8)
    while p:
        if h.ri(p + 0x254) == gid: out.append(p)
        p = h.rq(p + 8)
    return out
def all_threads(h, runner):
    out, p = [], h.rq(runner + 8)
    while p: out.append(p); p = h.rq(p + 8)
    return out
def barrier(h, S, runner, gid, force_fail=None):
    """rev2 barrier, run on main BEFORE the owner transition (pre of 0x5096F0)."""
    if force_fail == "self-join" or S.cur != "main": return {"quiescent": False, "why": "self-join"}
    rounds, seen = 0, set()
    while True:
        rounds += 1
        kids = [t for t in group_threads(h, runner, gid) if t not in seen]
        if not kids: break
        for t in kids:
            if h.ri(t + 0x250) in (0, 1): h.wi(t + 0x250, 2)
        for t in kids: S.call(0x4DFC70, t + 0x220)
        for t in kids:
            if S.call(0x4DFB60, t + 0x28) is None: return {"quiescent": False, "why": "join deadlock", "rounds": rounds}
            seen.add(t)
        if rounds > 8: return {"quiescent": False, "why": "no fixed point", "rounds": rounds}
    if force_fail == "no-fixed-point": return {"quiescent": False, "why": "forced: no fixed point", "rounds": rounds}
    return {"quiescent": True, "rounds": rounds, "children": len(seen)}
def snapshot(h, b):
    st = b["stage"]
    return {"global_list_has_stage": any(st <= n < st + b["size"] for n in list_nodes(h, h.gm + 8)),
            "parent_list_has_stage": st in list_nodes(h, b["parent_head"]),
            "group_registered": any(h.ri(e) == b["gid"] for e in range(h.rq(b["runner"] + 0x50), h.rq(b["runner"] + 0x58), 0x18)) if h.rq(b["runner"] + 0x50) else False,
            "threads_in_runner": len(all_threads(h, b["runner"]))}
def scenario(kind, mode, cls=0, ticks=3):
    h = mk(kind); S = Sched(h); h.phase = "build"
    b = build(h, S, kind, cls); st = {"kind": kind, "mode": mode, "seq_class": cls}
    st["after_ctor"] = snapshot(h, b)
    h.phase = "tick"
    for _ in range(ticks):
        for th in all_threads(h, b["runner"]): S.call(0x514E00, th)
    st["children"] = len(group_threads(h, b["runner"], b["gid"])); st["after_ticks"] = snapshot(h, b)
    kids = all_threads(h, b["runner"]); [h.labels.__setitem__(t, "thread") for t in kids]
    h.order.clear(); h.late.clear()
    h.dtor_calls = collections.Counter()
    for f in (0x4291A0, 0x420C40, 0x4290F0, 0x4207F0, 0x1363D0, 0x505AB0, 0x4EE330, 0x505620, 0x5148F0, 0x515290, 0x514BC0):
        h.pre[f] = (lambda f: (lambda h, a: (h.dtor_calls.update([hex(f)]), h.order.append(("call", hex(f), h.lbl(a[0]))), None)[2]))(f)
    if mode == "B1-quarantine":                       # NEGATIVE CONTROL: skip the stage deleting dtor, let the owner continue
        for f in (0x4291A0, 0x420C40):
            h.pre[f] = (lambda f: (lambda h, a: (h.dtor_calls.update(["skip " + hex(f)]), h.order.append(("skip", hex(f), h.lbl(a[0]))), 0)[2]))(f)
    if mode == "control-resume-after-stage-free":     # POSITIVE CONTROL of the poison detector (as exp_b2 resume-after-free)
        h.phase = "control"; live = [t for t in kids if h.ri(t + 0x250) == 1]
        S.call(0x4291A0 if kind == "HT2" else 0x420C40, b["stage"])   # stage deleting with the owner still alive
        for _ in range(15):
            for t in live: S.call(0x4DFC70, t + 0x220); S.call(0x4DFC80, t + 0x208)
        st["resumed"] = len(live)
        return finish(h, S, st, b, kids)
    if mode.startswith("B2"):
        h.phase = "barrier"
        force = {"B2-fail-selfjoin": "self-join", "B2-fail-fixedpoint": "no-fixed-point"}.get(mode)
        st["barrier"] = barrier(h, S, b["runner"], b["gid"], force)
        st["after_barrier"] = snapshot(h, b)
        if not st["barrier"]["quiescent"]:
            st["policy"] = "safe-stop: 0x5096F0 not entered, nothing destroyed or freed"
            return finish(h, S, st, b, kids)
    h.phase = "teardown"; n0 = len(S.log)
    r = S.call(0x5096F0, b["mgr"])
    st["child_events_during_teardown"] = sum(1 for e in S.log[n0:] if e[0] != "main"); st["destroyPending_ret"] = r
    st["deadlock"] = r is None
    return finish(h, S, st, b, kids)
def finish(h, S, st, b, kids):
    seq_freed = b["seq"] in h.freed; stage_freed = b["stage"] in h.freed
    st["seq_freed"] = seq_freed; st["stage_freed"] = stage_freed; st["threads_freed"] = sum(1 for t in kids if t in h.freed)
    st["final"] = snapshot(h, b) if not seq_freed else {"global_list_has_stage": any(b["stage"] <= n < b["stage"] + b["size"] for n in list_nodes(h, h.gm + 8))}
    st["late_access"] = collections.Counter(l for p, rw, pc, o, l in h.late)
    st["late_samples"] = [(p, rw, hex(pc), hex(o), l) for p, rw, pc, o, l in h.late[:5]]
    st["unmapped"] = h.unmapped[:5]; st["null_page"] = len(h.low); st["null_samples"] = h.low[:4]
    st["nested_entries"] = dict(h.entries); st["dtor_calls"] = dict(h.dtor_calls); st["order"] = h.order[:40]
    st["os_final"] = collections.Counter(v[0] for v in S.status().values())
    return st
def check(c, m): (None if c else F.append(m))
R, F = [], []
def main():
    for kind in ("HT2", "R21"):
        for mode in ("native", "B2-success", "B2-fail-selfjoin", "B2-fail-fixedpoint", "B1-quarantine", "control-resume-after-stage-free"):
            try: r = scenario(kind, mode)
            except Exception as e: r = {"kind": kind, "mode": mode, "error": repr(e)[:200], "unmapped": None}
            R.append(r); tag = kind + "/" + mode
            if "error" in r: F.append(tag + ": " + r["error"]); continue
            check(r["after_ctor"]["global_list_has_stage"] and r["after_ctor"]["parent_list_has_stage"] and r["after_ctor"]["group_registered"], tag + ": ctor registrations not observed")
            check(not r["unmapped"] and r["null_page"] == 0, tag + ": unmapped/null-page access")
            if mode == "B2-success":
                check(r["after_barrier"]["group_registered"] and r["after_barrier"]["parent_list_has_stage"], tag + ": barrier must not tear down dependencies")
                check(r["stage_freed"] and r["seq_freed"] and not r["deadlock"], tag + ": native teardown after barrier incomplete")
                check(sum(r["late_access"].values()) == 0, tag + ": late access to freed memory")
                check(not r["final"]["global_list_has_stage"], tag + ": global registration left")
                check(r["threads_freed"] == r["after_ticks"]["threads_in_runner"], tag + ": threads not freed")
                check(r["child_events_during_teardown"] == 0, tag + ": a child ran during owner teardown after the barrier")
            if mode.startswith("B2-fail"):
                check(not r["stage_freed"] and not r["seq_freed"] and not r["dtor_calls"], tag + ": safe-stop destroyed something")
                check(r["final"]["global_list_has_stage"] and r["final"]["parent_list_has_stage"] and r["final"]["group_registered"], tag + ": graph not intact")
            if mode == "control-resume-after-stage-free" and kind == "HT2":   # R21: informational (worker stop path)
                check(r["stage_freed"] and sum(r["late_access"].values()) > 0, tag + ": poison detector did not fire (control)")
            if mode in ("native", "B2-success"):
                check(r["children"] >= 1 and r["threads_freed"] == r["after_ticks"]["threads_in_runner"], tag + ": threads")
            if mode == "native":
                check(r["stage_freed"] and r["seq_freed"], tag + ": native teardown incomplete")
            if mode == "B1-quarantine":                    # the control must SHOW the hazard GE-154 described
                check(not r["stage_freed"] and r["seq_freed"], tag + ": control did not quarantine")
                check(r["final"]["global_list_has_stage"], tag + ": control did not expose dangling global registration")
    # Seq classes 1-4 with the B2-success path (HT2 host)
    for cls in (1, 2, 3, 4):
        try: r = scenario("HT2", "B2-success", cls=cls)
        except Exception as e: r = {"kind": "HT2", "mode": "B2-success", "seq_class": cls, "error": repr(e)[:200]}
        R.append(r); tag = "HT2/B2-success/class%d" % cls
        if "error" in r: F.append(tag + ": " + r["error"]); continue
        check(r["stage_freed"] and r["seq_freed"] and sum(r["late_access"].values()) == 0 and not r["final"]["global_list_has_stage"], tag + ": failed")
    out = {"results": R, "FAILURES": F}
    for r in R:
        print(r.get("kind"), r.get("mode"), "cls", r.get("seq_class"), "| children", r.get("children"), "barrier", (r.get("barrier") or {}).get("why", (r.get("barrier") or {}).get("quiescent")),
              "| stage_freed", r.get("stage_freed"), "seq_freed", r.get("seq_freed"), "threads_freed", r.get("threads_freed"), "late", dict(r.get("late_access") or {}),
              "| final", r.get("final"), "| err", r.get("error"), "unm", r.get("unmapped"), "null", r.get("null_page"))
    print("FAILURES:", len(F)); [print(" -", f) for f in F]
    if OUT: json.dump(out, open(OUT, "w"), indent=1, default=str)
    sys.exit(1 if F else 0)
if __name__ == "__main__": main()
