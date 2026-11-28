"""(B) Runner child teardown vs stage destruction. Real game code: Runner ctor/reap/clear, ThreadGroup ctor/unregister,
Thread ctor/step/shouldStop/dtor, HT2/R21 stage dtor chains, native worker coroutines. Harness stubs: nn::os
(PLT imports), allocator (0x4E02F0 new / 0x4E04E0 free), unrelated sub-destructors."""
import sys, json; from common import *
IMG = sys.argv[1]
def mk():
    h = setup(IMG)
    for f in (0x515000, 0x515190, 0x515040, 0x515290, 0x5151D0, 0x515450, 0x5153A0, 0x514760, 0x5147A0, 0x5148F0, 0x514A90,
              0x515130, 0x514BC0, 0x4292C0, 0x4212D0, 0x514E00, 0x514EE0, 0x515150, 0x4290F0, 0x4D8D40, 0x1363D0, 0x4207F0,
              0x428EF0, 0x420720, 0x4D9A10, 0x4DFB60, 0x4DF9A0, 0x4DFC20, 0x4DFC70, 0x4DFA20, 0x4DFC80, 0x514D60, 0x514DD0, 0x514FB0, 0x514FD0, 0x514FF0):
        h.add_real(f)
    for o in (0x514D70, 0x514FD0): h.stubs.pop(o, None)
    h.add_real(0x514D70); h.add_real(0x514FD0)
    h.events = []; h.freed = {}
    def new(h):
        n = h.x(0); p = h.alloc(max(n, 16)); h.events.append(("new", n, hex(p))); return p
    def free(h):
        p, n = h.x(0), h.x(1); h.events.append(("free", hex(p), n)); h.freed[p] = n; return 0
    h.stubs[0x4E02F0] = new; h.stubs[0x4E04E0] = free
    h.stubs[0x50A6B0] = lambda h: (lambda p: (h.events.append(("stack-alloc", hex(p))), p)[1])(h.alloc(0x1000))
    h.stubs[0x50A710] = lambda h: (h.events.append(("stack-free", hex(h.x(0)))), 0)[1]
    return h
PLT = {0xA65FE0: "A65FE0(wait/join thread)", 0xA65FF0: "A65FF0(destroy thread)", 0xA66060: "A66060(finalize event)",
       0xA66070: "A66070(signal event)", 0xA66080: "A66080(start thread)", 0xA66090: "A66090(init event)"}
def plt_log(h, names):
    return [(c[0], PLT.get(c[2], hex(c[2])), hex(c[4])) for c in h.calls if c[1] == "plt" and c[2] not in (0xA65C70, 0xA65D30, 0xA65C50)]
def spawn(h, stage, runner, idx, vt):
    th = h.alloc(0x298)
    h.wq(th, G + vt + 0x10); h.wq(th + 0x18, G + vt + 0x40)
    h.call(0x514A90, th, runner, idx, G + 0x429290, th + 0x280, stage)
    h.wq(th, G + vt + 0x10); h.wq(th + 0x18, G + vt + 0x40)
    h.wq(th + 0x280, stage + 0x2C78); h.wq(th + 0x288, G + 0x428EF0); h.wq(th + 0x290, 0)
    h.call(0x5153A0, runner, th)
    return th
def teardown(order, kind="HT2"):
    h = mk(); res = {"order": order, "stage": kind}
    runner = h.alloc(0x70); h.phase = "runner-ctor"; h.call(0x515000, runner)
    stage = h.alloc(0xF000)
    grp_off = 0x2978
    h.phase = "group"; h.call(0x514760, stage + grp_off, runner, stage)
    gid = h.ri(stage + grp_off + 0x10); res["group_id"] = gid
    h.wq(stage + (0x2C80 if kind == "HT2" else 0x3550), runner)
    vt = 0xD4D450 if kind == "HT2" else 0xD4D030
    ths = [spawn(h, stage, runner, gid, vt) for _ in range(2)]
    h.phase = "step"
    for th in ths: h.call(0x514E00, th)                     # first step: state 0 -> 1, OS thread created (stub)
    res["state_after_step"] = [h.ri(th + 0x250) for th in ths]
    res["runner_groups_before"] = (h.rq(runner + 0x58) - h.rq(runner + 0x50)) // 0x18
    seq = []
    def stage_dtor():
        h.phase = "stage-dtor"; h.call(0x4290F0 if kind == "HT2" else 0x4207F0, stage)
        seq.append(("stage dtor returned; groups=%d" % ((h.rq(runner + 0x58) - h.rq(runner + 0x50)) // 0x18)))
        h.poison.append((stage, stage + 0xF000, "freed-stage"))   # model: deleting dtor frees the stage here
        seq.append("stage memory poisoned (freed)")
    def reap():
        h.phase = "reap"; h.call(0x515450, runner)
        seq.append("reap: states=%s" % [h.ri(th + 0x250) if th not in h.freed else "freed" for th in ths])
    def clear():
        h.phase = "runner-clear"; h.call(0x515290, runner)
        seq.append("clear: states=%s" % [h.ri(th + 0x250) if th not in h.freed else "freed" for th in ths])
    def stepall():
        h.phase = "step2"
        for th in ths:
            if th not in h.freed: h.call(0x514E00, th)
        seq.append("step: states=%s" % [h.ri(th + 0x250) if th not in h.freed else "freed" for th in ths])
    for step in order: {"stage": stage_dtor, "reap": reap, "clear": clear, "step": stepall}[step]()
    res["sequence"] = seq
    res["step_imports"] = dict(__import__("collections").Counter(a for p, a, lr in plt_log(h, None) if p == "step"))
    res["join_by_phase"] = dict(__import__("collections").Counter(p for p, a, lr in plt_log(h, None) if a.startswith("A65FE0")))
    res["threads_freed"] = sum(1 for th in ths if th in h.freed)
    res["thread_final_states"] = [h.ri(th + 0x250) for th in ths]
    res["os_imports"] = dict(__import__("collections").Counter("%s:%s" % (p, a) for p, a, lr in plt_log(h, None) if p in ("reap", "runner-clear", "stage-dtor", "step2")))
    res["late_stage_access"] = len(h.late); res["late_samples"] = [(p, rw, hex(pc), hex(o)) for p, rw, pc, o, l in h.late[:6]]
    res["unlisted"] = sorted(set(hex(c[2]) for c in h.calls if c[1] == "unlisted" and c[0] in ("stage-dtor", "reap", "runner-clear")))
    return res
def worker_stop(kind, stop_at):
    """Run the real native worker; the k-th wait returns with stop requested and the stage poisoned."""
    h = mk(); runner = h.alloc(0x70); h.call(0x515000, runner)
    stage = h.alloc(0xF000); h.call(0x514760, stage + 0x2978, runner, stage); gid = h.ri(stage + 0x2988)
    th = spawn(h, stage, runner, gid, 0xD4D450 if kind == "HT2" else 0xD4D030)
    h.wi(th + 0x250, 1)
    cnt = {"n": 0}
    coros = {"HT2": (0x1398B0, 0x429330, 0x42B740, 0x1367F0), "R21": ()}[kind]
    def wait(h, a=None):
        cnt["n"] += 1
        if cnt["n"] == stop_at:
            h.wi(th + 0x250, 2); h.poison.append((stage, stage + 0xF000, "stage-after-stop"))
        return None
    h.pre[0x514D70] = wait
    for c in coros:                                          # nested coroutines: treat each as one wait point
        h.stubs[c] = (lambda h, a=None: (wait(h), 0)[1])
    h.phase = "worker"; tp = {"n": 0}
    h.pre[0x514FD0] = lambda h, a=None: (tp.__setitem__("n", tp["n"] + 1), None)[1]
    try:
        h.call(0x428EF0 if kind == "HT2" else 0x420720, stage, th, count=200000)
        err = None
    except UcError as e: err = str(e)
    return {"worker": kind, "stop_at_wait": stop_at, "waits_seen": cnt["n"], "late_stage_access": len(h.late),
            "late_samples": [(rw, hex(pc), hex(o)) for p, rw, pc, o, l in h.late[:5]], "error": err,
            "final_state": h.ri(th + 0x250), "tPop_calls": tp["n"]}
out = {"teardown": [], "workers": []}
for kind in ("HT2", "R21"):
    for order in (["stage", "reap"], ["stage", "clear"], ["clear", "stage"], ["reap", "stage", "reap"], ["stage", "step", "reap"]):
        try: out["teardown"].append(teardown(order, kind))
        except Exception as e: out["teardown"].append({"order": order, "stage": kind, "error": repr(e)})
for k in (1, 2, 3, 4, 5):
    try: out["workers"].append(worker_stop("HT2", k))
    except Exception as e: out["workers"].append({"worker": "HT2", "stop_at_wait": k, "error": repr(e)})
json.dump(out, open(sys.argv[2], "w"), indent=1, default=str)
print(json.dumps(out, indent=1, default=str)[:9000])
