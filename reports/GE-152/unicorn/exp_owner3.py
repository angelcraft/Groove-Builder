"""GE-152 / Stage owner rev3: B2 barrier as specified in CODEX_HANDOFF_rev3 (whole Runner, cap 8 rounds, native state
semantics), with the corrected scheduler (sched.py: only PC==RET is a return; budget exhaustion = preempt -> runaway).
Real game code as exp_owner2 (real host Stage ctor/dtor, real Runner/Thread, real 0x5096F0 and Seq dtors).
Harness-written thread bodies (hand-encoded ARM64, outside the image) model the GE-151 body contract
(wait -> tStop -> exit); they are NOT the compiled GE-151 module. Cooperative model, NOT Horizon.
Output = addresses, offsets, counters, labels only. Exit != 0 on any failed assertion."""
import sys, json, collections, struct
from common import *
from sched import Sched, BudgetExhausted
import exp_owner2 as E
OUT = sys.argv[2] if len(sys.argv) > 2 else None
CODE = 0x7fff1000                      # harness code page (mapped by harness.H at 0x7fff0000, no game hooks there)
WAIT, TSTOP, JOIN, SIGNAL, APPEND, TCTOR, STEP = 0x514D70, 0x514DD0, 0x4DFB60, 0x4DFC70, 0x5153A0, 0x514A90, 0x514E00
CAP = 8
HT2_THREAD_VT = 0xD4D450
# ---------------------------------------------------------------- tiny ARM64 encoder (harness bodies only)
def movx(d, v): return [0xD2800000 | (((v >> 0) & 0xffff) << 5) | d, 0xF2A00000 | (((v >> 16) & 0xffff) << 5) | d]
def blr(n): return [0xD63F0000 | (n << 5)]
PRO = [0xA9BE7BFD, 0xA90153F3, 0xAA0003F3, 0xAA0103F4]        # stp x29,x30,[sp,#-0x20]!; stp x19,x20,[sp,#0x10]; mov x19,x0; mov x20,x1
EPI = [0xA94153F3, 0xA8C27BFD, 0xD65F03C0]                    # ldp x19,x20; ldp x29,x30; ret
TOUCH = [0xB4000054, 0xB9410289]                              # cbz x20,+8 ; ldr w9,[x20,#0x100]  (touch the referenced object)
def body_coop():
    """loop { touch(arg); wait(th,1); touch(arg); if tStop(th) break }  == GE-151 waitTicks contract."""
    c = PRO[:]; loop = len(c)
    c += TOUCH + [0xAA1303E0, 0x52800021] + movx(16, G + WAIT) + blr(16) + TOUCH + [0xAA1303E0] + movx(16, G + TSTOP) + blr(16)
    off = loop - len(c); c += [0x36000000 | ((off & 0x3fff) << 5)]  # tbz w0,#0,loop
    return c + EPI
def body_runaway():
    """cooperative until cancelled, then spins forever instead of returning (control: a body stuck after tStop)."""
    c = PRO[:]; loop = len(c)
    c += [0xAA1303E0, 0x52800021] + movx(16, G + WAIT) + blr(16) + [0xAA1303E0] + movx(16, G + TSTOP) + blr(16)
    off = loop - len(c); c += [0x36000000 | ((off & 0x3fff) << 5)]
    return c + [0x14000000]
def body_spin(): return [0x14000000]                          # b .   (main truncation control)
def install_code(h):
    addrs, p = {}, CODE
    for name, c in (("coop", body_coop()), ("runaway", body_runaway()), ("spin", body_spin())):
        h.mu.mem_write(p, b"".join(struct.pack("<I", w) for w in c)); addrs[name] = p; p += (len(c) * 4 + 0x3f) & ~0x3f
    return addrs
# ---------------------------------------------------------------- helpers
def tstate(h, t): return h.ri(t + 0x250)
def handle(h, t): return h.rq(t + 0x28 + 0x1C8)                # nn::os thread created (0x4DFB60 guard)
def new_thread(h, S, runner, gid, body, arg, append=True):
    th = h.alloc(0x298 + 0x40); S.call(TCTOR, th, runner, gid, body, arg, 0)
    vt = G + HT2_THREAD_VT                                      # as GE-151 spawn(): HT2 member-thread vtable after the ctor
    h.wq(th, vt + 0x10); h.wq(th + 0x18, vt + 0x40)
    if append: S.call(APPEND, runner, th)
    h.labels[th] = "thread"; return th
def link_tail(h, runner, th):                                    # == 0x5153A0 semantics (memory-level, used inside a hook)
    p = runner + 8
    while h.rq(p): p = h.rq(p) + 8
    h.wq(th + 8, 0); h.wq(p, th)
def os_state(S, t): return S.th.get(t + 0x30, {}).get("state", "no-os-thread")
def on_main(h, S, runner):
    """Self-join guard as the module must implement it: current nn::os thread must not be any Runner thread
    (real code: nn::os::GetCurrentThread() vs &th->os == th+0x30 for every listed thread, and == captured main)."""
    cur = None if S.cur == "main" else next((k for k, v in S.th.items() if v["name"] == S.cur), "unknown")
    return cur is None and S.cur == "main" and all(cur != t + 0x30 for t in E.all_threads(h, runner))
def barrier3(h, S, runner, cap=CAP, gid=None):
    """rev3 B2 barrier (pseudo-code of CODEX_HANDOFF_rev3 §4). gid=None: whole Runner (rev3); gid=x: rev2 (group only)."""
    if not on_main(h, S, runner): return {"quiescent": False, "why": "self-join"}
    seen, rounds, per_round = set(), 0, []
    while True:
        kids = [t for t in (E.all_threads(h, runner) if gid is None else E.group_threads(h, runner, gid))
                if t not in seen and tstate(h, t) != 3]
        if not kids: break
        if rounds == cap: return {"quiescent": False, "why": "no fixed point after %d rounds" % cap, "rounds": rounds, "pending": len(kids), "per_round": per_round}
        rounds += 1; per_round.append(len(kids))
        for t in kids:                                           # 1. publish cancel for the whole round
            if tstate(h, t) in (0, 1): h.wi(t + 0x250, 2)
        for t in kids:                                           # 2. wake (only threads that exist in the OS)
            if handle(h, t): S.call(SIGNAL, t + 0x220)
        for t in kids:                                           # 3. join (0x4DFB60 skips never-created threads)
            if handle(h, t) and S.call(JOIN, t + 0x28) is None:
                return {"quiescent": False, "why": "join did not complete (deadlock/runaway)", "rounds": rounds, "per_round": per_round}
            seen.add(t)
    final = {}
    for t in E.all_threads(h, runner) if gid is None else E.group_threads(h, runner, gid):
        final[h.lbl(t) + "@%x" % (t & 0xffff)] = (tstate(h, t), bool(handle(h, t)), os_state(S, t))
    bad = [k for k, v in final.items() if v[0] != 2 or v[1] or v[2] not in ("done", "no-os-thread")]
    if bad: return {"quiescent": False, "why": "postcondition: thread not cancelled+joined", "bad": bad, "final": final}
    return {"quiescent": True, "rounds": rounds, "per_round": per_round, "children": len(seen), "final": final}
def prepare(kind, ticks, extra=None, legacy=False):
    h = E.mk(kind); S = (LegacySched if legacy else Sched)(h); h.phase = "build"; code = install_code(h)
    b = E.build(h, S, kind, 0); b["code"] = code
    h.appends = collections.Counter(); h.selfjoin = []
    h.pre[APPEND] = lambda hh, a: (hh.appends.update([hh.phase.split(":")[0]]), None)[1]
    if extra: extra(h, S, b)
    h.phase = "tick"
    for _ in range(ticks):
        for th in E.all_threads(h, b["runner"]): S.call(STEP, th)
    b["kids"] = E.all_threads(h, b["runner"]); [h.labels.__setitem__(t, "thread") for t in b["kids"]]
    return h, S, b
class LegacySched(Sched):
    """The rev2 scheduler bug, kept ONLY as a negative control: budget exhaustion treated as a normal return."""
    def _run(self, pc, ctx=None, regs=None, count=2_000_000):
        r = Sched._run(self, pc, ctx, regs, count)
        return None if r is not None and r[0] == "budget" else r
def teardown(h, S, b, st):
    h.phase = "teardown"; n0 = len(S.log); h.order.clear(); h.late.clear(); h.dtor_calls = collections.Counter()
    for f in (0x4291A0, 0x420C40, 0x1363D0, 0x515290, 0x514BC0):
        h.pre[f] = (lambda f: (lambda hh, a: (hh.dtor_calls.update([hex(f)]), None)[1]))(f)
    r = S.call(0x5096F0, b["mgr"])
    st["child_events_during_teardown"] = sum(1 for e in S.log[n0:] if e[0] != "main")
    st["destroyPending_ret"] = r; st["dtor_calls"] = dict(h.dtor_calls)
    st["stage_freed"] = b["stage"] in h.freed; st["seq_freed"] = b["seq"] in h.freed
    st["threads_freed"] = sum(1 for t in b["kids"] if t in h.freed)
    st["late_access"] = len(h.late); st["late_samples"] = [(p, rw, hex(pc), hex(o), l) for p, rw, pc, o, l in h.late[:4]]
    st["global_list_has_stage"] = any(b["stage"] <= n < b["stage"] + b["size"] for n in E.list_nodes(h, h.gm + 8))
def no_dep_freed(r): return not any(l.startswith(("stage", "seq", "thread", "runner", "mgr")) for l in r.get("freed_labels", {}))
def intact(h, S, b):
    s = E.snapshot(h, b); return s["global_list_has_stage"] and s["parent_list_has_stage"] and s["group_registered"] and not h.freed.get(b["stage"]) and b["seq"] not in h.freed
class Sess:
    """Python model of the module's gSess policy (CODEX_HANDOFF_rev3 §3)."""
    def __init__(s): s.active = False; s.gen = 0; s.log = []
    def open(s, seq, stage): s.active, s.seq, s.stage, s.gen, s.passed = True, seq, stage, s.gen + 1, False
    def pre_destroy(s, h, mgr, lr):
        cur = h.rq(mgr + 0x10); nxt = h.ri(mgr + 0x18)
        if not s.active or cur != s.seq: return "orig"
        if lr != 0x50A060 or h.rq(cur + 0xA078) != s.stage: return "safe-stop"
        if nxt < 0: return "orig"                               # 0x5096F0 destroys nothing when mgr+0x18 < 0
        return "barrier"
def main():
    global R, F
    R, F = [], []
    def check(c, m): (None if c else F.append(m))
    def run(tag, fn):
        try: r = fn()
        except Exception as e: r = {"error": repr(e)[:300]}
        r["tag"] = tag; R.append(r)
        if "error" in r: F.append(tag + ": " + r["error"])
        return r
    # ---------------------------------------------------------------- 1. B2 rev3 success matrix (ticks 1/3/6 -> threads in state 0/1/2)
    def s_success(kind, ticks):
        h, S, b = prepare(kind, ticks); st = {"kind": kind, "ticks": ticks}
        st["states_before"] = dict(collections.Counter(tstate(h, t) for t in b["kids"]))
        h.phase = "barrier"; st["barrier"] = barrier3(h, S, b["runner"]); st["appends_during_barrier"] = h.appends.get("barrier", 0)
        st["intact_after_barrier"] = intact(h, S, b)
        teardown(h, S, b, st); st["sched_events"] = collections.Counter(e[1] for e in S.log if e[1] in ("RUNAWAY", "preempt", "MAIN_BUDGET", "DEADLOCK"))
        return st
    for kind in ("HT2", "R21"):
        for ticks in (1, 3, 6):
            r = run("%s/B2-rev3/ticks%d" % (kind, ticks), lambda: s_success(kind, ticks))
            if "error" in r: continue
            t = r["tag"]
            check(r["barrier"]["quiescent"], t + ": barrier failed " + str(r["barrier"].get("why")))
            check(r["intact_after_barrier"], t + ": barrier tore down a dependency")
            check(r["stage_freed"] and r["seq_freed"] and r["threads_freed"] == len(r["barrier"].get("final", {})), t + ": native teardown incomplete")
            check(r["late_access"] == 0 and r["child_events_during_teardown"] == 0 and not r["global_list_has_stage"], t + ": late access / child event / dangling global")
            check(r["appends_during_barrier"] == 0, t + ": spawn after cancel")
            check(not r["sched_events"], t + ": scheduler budget/deadlock event in a success run " + str(r["sched_events"]))
    # ---------------------------------------------------------------- 2. other Seq group: a Seq-group coroutine that references the Stage
    def add_seq_thread(h, S, b):
        gid_seq = h.ri(b["seq"] + 0xEB0 + 0x10)
        b["seqth"] = new_thread(h, S, b["runner"], gid_seq, b["code"]["coop"], b["stage"]); b["gid_seq"] = gid_seq
    def s_seqgroup(rev):
        h, S, b = prepare("HT2", 3, add_seq_thread); st = {"rev": rev, "gid_seq": b["gid_seq"], "seqth_state_before": tstate(h, b["seqth"])}
        h.phase = "barrier"; st["barrier"] = barrier3(h, S, b["runner"], gid=None if rev == 3 else b["gid"])
        st["seqth_state_after_barrier"] = tstate(h, b["seqth"]); teardown(h, S, b, st); return st
    r2 = run("HT2/seq-group-thread/rev2-barrier(Stage group only)", lambda: s_seqgroup(2))
    r3 = run("HT2/seq-group-thread/rev3-barrier(whole Runner)", lambda: s_seqgroup(3))
    if "error" not in r2: check(r2["late_access"] > 0 and r2["child_events_during_teardown"] > 0, r2["tag"] + ": control did not show the rev2 gap")
    if "error" not in r3: check(r3["barrier"]["quiescent"] and r3["late_access"] == 0 and r3["child_events_during_teardown"] == 0 and r3["stage_freed"] and r3["seq_freed"], r3["tag"] + ": rev3 did not cover the Seq group")
    # ---------------------------------------------------------------- 3. runaway worker (infinite loop after resume)
    def add_runaway(h, S, b): b["rth"] = new_thread(h, S, b["runner"], b["gid"], b["code"]["runaway"], 0)
    def s_runaway(legacy):
        h, S, b = prepare("HT2", 3, add_runaway, legacy=legacy); st = {"legacy_sched": legacy}
        nf = len(h.freed); h.phase = "barrier"; st["barrier"] = barrier3(h, S, b["runner"])
        st["runaway_os_state"] = os_state(S, b["rth"]); st["runaway_tstate"] = tstate(h, b["rth"])
        st["sched_events"] = collections.Counter(e[1] for e in S.log if e[1] in ("RUNAWAY", "preempt", "DEADLOCK"))
        if st["barrier"]["quiescent"]: teardown(h, S, b, st)
        else: st["policy"] = "safe-stop"; st["intact"] = intact(h, S, b); st["freed"] = len(h.freed) - nf; st["freed_labels"] = collections.Counter(h.lbl(p) for p in list(h.freed)[nf:])
        return st
    ra = run("HT2/control-runaway-worker/fixed-sched", lambda: s_runaway(False))
    rl = run("HT2/control-runaway-worker/LEGACY-sched(rev2 bug)", lambda: s_runaway(True))
    if "error" not in ra: check(not ra["barrier"]["quiescent"] and ra["runaway_os_state"] == "runaway" and ra["intact"] and no_dep_freed(ra) and ra["sched_events"].get("RUNAWAY") == 1, ra["tag"] + ": runaway not detected / something destroyed")
    if "error" not in rl: check(rl["barrier"]["quiescent"] and rl["runaway_os_state"] == "done", rl["tag"] + ": legacy control did not reproduce the false 'done'")
    # ---------------------------------------------------------------- 4. truncated main return
    def s_main_trunc():
        h = E.mk("HT2"); S = Sched(h); code = install_code(h); st = {}
        try: S.call(code["spin"]); st["sched_call"] = "returned (BUG)"
        except BudgetExhausted as e: st["sched_call"] = "BudgetExhausted"
        try: h.call(code["spin"], count=200000); st["h_call"] = "returned (BUG)"
        except BudgetExhausted as e: st["h_call"] = "BudgetExhausted"
        h2 = E.mk("HT2"); L = LegacySched(h2); code2 = install_code(h2); st["legacy_sched_call"] = "returned x0=%#x (false return)" % L.call(code2["spin"])
        return st
    rm = run("control-truncated-main", s_main_trunc)
    if "error" not in rm: check(rm["sched_call"] == "BudgetExhausted" and rm["h_call"] == "BudgetExhausted" and rm["legacy_sched_call"].startswith("returned"), rm["tag"] + ": truncation not explicit")
    # ---------------------------------------------------------------- 5. real fixed-point exhaustion (each exiting child appends a LIVE sibling)
    def s_exhaust():
        pool = []
        def mkpool(h, S, b):
            for _ in range(12):
                t = new_thread(h, S, b["runner"], b["gid"], b["code"]["coop"], 0, append=False); pool.append(t)
            h.phase = "pool-start"
            for t in pool: S.call(STEP, t)                         # started: state 1, blocked in its wait (not listed yet)
        h, S, b = prepare("HT2", 3, mkpool); st = {"pool": len(pool), "pool_states": [tstate(h, t) for t in pool]}
        linked = []
        def on_exit(hh, a):                                      # block 0x514A5C = thread entry after the body returned
            if hh.phase.startswith("barrier") and len(linked) < len(pool):
                t = pool[len(linked)]; link_tail(hh, b["runner"], t); linked.append(t)
        h.pre[0x514A5C] = on_exit
        nf = len(h.freed); h.phase = "barrier"; st["barrier"] = barrier3(h, S, b["runner"])
        st["linked"] = len(linked); st["linked_states"] = [(tstate(h, t), os_state(S, t)) for t in linked]
        st["intact"] = intact(h, S, b); st["freed"] = len(h.freed) - nf; st["freed_labels"] = collections.Counter(h.lbl(p) for p in list(h.freed)[nf:])
        return st
    rx = run("HT2/fixed-point-exhaustion(real, live siblings)", s_exhaust)
    if "error" not in rx:
        bx = rx["barrier"]
        check(not bx["quiescent"] and bx.get("rounds") == CAP and bx.get("pending") == 1, rx["tag"] + ": cap not enforced at round %d" % CAP)
        check(rx["linked"] == CAP and rx["linked_states"][-1] == (1, "blocked") and all(s == (2, "done") for s in rx["linked_states"][:-1]), rx["tag"] + ": round 9 started or chain state wrong")
        check(rx["intact"] and no_dep_freed(rx), rx["tag"] + ": safe-stop destroyed something")
    # ---------------------------------------------------------------- 6. self-join: the guard evaluated from a child context must refuse
    def s_selfjoin():
        h, S, b = prepare("HT2", 3); st = {"main": on_main(h, S, b["runner"])}; seen = []
        h.pre[TSTOP] = lambda hh, a: (seen.append(on_main(hh, S, b["runner"])), None)[1]
        h.phase = "barrier"; st["barrier"] = barrier3(h, S, b["runner"]); st["child_evals"] = len(seen); st["child_true"] = sum(seen)
        return st
    rs = run("HT2/self-join-guard", s_selfjoin)
    if "error" not in rs: check(rs["main"] and rs["child_evals"] > 0 and rs["child_true"] == 0 and rs["barrier"]["quiescent"], rs["tag"] + ": guard not effective")
    # ---------------------------------------------------------------- 7. retry: same scene id -> old Seq destroyed, new Seq+Stage created; session tokens
    def s_retry(kind):
        h, S, b = prepare(kind, 3); ss = Sess(); ss.open(b["seq"], b["stage"]); st = {"kind": kind}
        st["decisions"] = {"foreign_scene": None, "bad_lr": ss.pre_destroy(h, b["mgr"], 0x509728), "no_next": None}
        h.wi(b["mgr"] + 0x18, -1); st["decisions"]["no_next"] = ss.pre_destroy(h, b["mgr"], 0x50A060); h.wi(b["mgr"] + 0x18, 5)
        other = h.alloc(0x40); h.wq(b["mgr"] + 0x10, other); st["decisions"]["foreign_scene"] = ss.pre_destroy(h, b["mgr"], 0x50A060); h.wq(b["mgr"] + 0x10, b["seq"])
        d = ss.pre_destroy(h, b["mgr"], 0x50A060); st["decisions"]["own_valid"] = d
        h.phase = "barrier"; st["barrier_A"] = barrier3(h, S, b["runner"])["quiescent"]
        teardown(h, S, b, st); ss.active = False                    # post of 0x5096F0: session closed (gen kept)
        st["A"] = {k: st.pop(k) for k in ("stage_freed", "seq_freed", "late_access", "child_events_during_teardown", "global_list_has_stage")}
        gen_a = ss.gen
        # B: the factory (0x509740 at 0x50A090, same frame) builds a new Seq+Stage for the same id on the same harness
        h.phase = "build-B"; b2 = E.build(h, S, kind, 0); ss.open(b2["seq"], b2["stage"]); h.phase = "tick-B"
        for _ in range(3):
            for th in E.all_threads(h, b2["runner"]): S.call(STEP, th)
        b2["kids"] = E.all_threads(h, b2["runner"]); h.late.clear()
        st["B_gen"] = ss.gen; st["B_decision"] = ss.pre_destroy(h, b2["mgr"], 0x50A060)
        st["stale_A_seq_rejected"] = (ss.seq != b["seq"])
        h.phase = "barrier"; st["barrier_B"] = barrier3(h, S, b2["runner"])["quiescent"]
        teardown(h, S, b2, st); st["gen_A"] = gen_a
        return st
    for kind in ("HT2", "R21"):
        rr = run("%s/retry(A destroyed -> B created -> B destroyed)" % kind, lambda: s_retry(kind))
        if "error" in rr: continue
        check(rr["decisions"] == {"foreign_scene": "orig", "bad_lr": "safe-stop", "no_next": "orig", "own_valid": "barrier"}, rr["tag"] + ": policy table " + str(rr["decisions"]))
        check(rr["A"]["stage_freed"] and rr["A"]["seq_freed"] and rr["A"]["late_access"] == 0 and not rr["A"]["global_list_has_stage"], rr["tag"] + ": A teardown")
        check(rr["B_gen"] == rr["gen_A"] + 1 and rr["B_decision"] == "barrier" and rr["stale_A_seq_rejected"] and rr["barrier_B"], rr["tag"] + ": session B")
        check(rr["stage_freed"] and rr["seq_freed"] and rr["late_access"] == 0 and rr["child_events_during_teardown"] == 0 and not rr["global_list_has_stage"], rr["tag"] + ": B teardown")
    # ---------------------------------------------------------------- report
    for r in R:
        keep = {k: v for k, v in r.items() if k not in ("barrier",)}
        bb = r.get("barrier") or {}
        print(r["tag"], "| barrier", bb.get("quiescent"), bb.get("why", ""), "rounds", bb.get("rounds"), bb.get("per_round"),
              "|", {k: v for k, v in keep.items() if k in ("states_before", "appends_during_barrier", "stage_freed", "seq_freed", "threads_freed", "late_access",
              "child_events_during_teardown", "global_list_has_stage", "runaway_os_state", "intact", "freed", "sched_call", "h_call", "legacy_sched_call",
              "linked", "linked_states", "child_evals", "child_true", "decisions", "A", "B_gen", "gen_A", "sched_events", "error")})
    print("FAILURES:", len(F)); [print(" -", f) for f in F]
    if OUT: json.dump({"results": R, "FAILURES": F}, open(OUT, "w"), indent=1, default=str)
    sys.exit(1 if F else 0)
if __name__ == "__main__": main()
