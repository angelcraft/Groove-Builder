"""GE-152 T10: the REAL GE-151 ARM64 module (GrooveHT3 .nss ELF, built locally from the GE-151 branch with public
inputs only) loaded next to the local game image; its real HT2 worker hook (ht3Worker + control + spawn + cue/bg/
latency bodies) runs as the body of the native HT2 worker thread, under the rev3 B2 barrier of exp_owner3.
Usage:  python exp_t10.py $GE_MAIN_IMG $GE_MODULE_ELF [out.json]      (neither file is ever committed)
Cooperative model (sched.py), NOT Horizon. Module I/O through Hakkun-resolved fn pointers (nn::fs) is not available
here: flushLog/writeSave/writeMultiSave/persistCustomSave are recorded stubs; any other null fn-pointer call is
counted. Output = offsets, counters, labels only."""
import sys, json, collections, struct
from elftools.elf.elffile import ELFFile
from unicorn import UC_HOOK_BLOCK, UC_HOOK_CODE
from unicorn.arm64_const import *
IMG, ELF = sys.argv[1], sys.argv[2]; OUT = sys.argv[3] if len(sys.argv) > 3 else None
sys.argv = [sys.argv[0], IMG]                     # exp_owner3 reads argv[1] only
import exp_owner3 as X
from exp_owner3 import E, G, Sched, BudgetExhausted, barrier3, tstate, handle, os_state, teardown, intact
MOD = G + 0x1800000                               # within +-128MB of the image: single `b` hook patches
# ---------------------------------------------------------------- module loader
class Module:
    def __init__(s, h, path):
        f = ELFFile(open(path, "rb")); s.h = h; s.sym = {}
        top = max(p["p_vaddr"] + p["p_memsz"] for p in f.iter_segments() if p["p_type"] == "PT_LOAD")
        s.size = (top + 0xFFFF) & ~0xFFFF; h.mu.mem_map(MOD, s.size)
        for p in f.iter_segments():
            if p["p_type"] == "PT_LOAD": h.mu.mem_write(MOD + p["p_vaddr"], p.data())
        rel = f.get_section_by_name(".rela.dyn"); s.nrel = 0
        for r in rel.iter_relocations():
            assert r["r_info_type"] == 1027, "only R_AARCH64_RELATIVE expected"
            h.wq(MOD + r["r_offset"], MOD + r["r_addend"]); s.nrel += 1
        for x in f.get_section_by_name(".symtab").iter_symbols():
            if x.name and x["st_value"]: s.sym.setdefault(x.name, x["st_value"])
        s.stubs = {}; s.calls = []; s.nullcalls = collections.Counter()
        h.mu.hook_add(UC_HOOK_BLOCK, s._blk, begin=MOD, end=MOD + s.size - 1)
        h.mu.hook_add(UC_HOOK_CODE, s._null, begin=0, end=0xF)
    def a(s, name_part, exact=False):
        c = [v for k, v in s.sym.items() if (k == name_part if exact else name_part in k)]
        assert len(set(c)) == 1, (name_part, len(c)); return MOD + c[0]
    def _blk(s, uc, addr, size, ud):
        if addr in s.stubs:
            name, fn = s.stubs[addr]; s.calls.append((s.h.phase, name)); v = fn() if fn else 0
            uc.reg_write(UC_ARM64_REG_X0, v); uc.reg_write(UC_ARM64_REG_PC, uc.reg_read(UC_ARM64_REG_LR))
    def _null(s, uc, addr, size, ud):              # Hakkun-resolved SDK pointer left null in this harness
        lr = uc.reg_read(UC_ARM64_REG_LR); s.nullcalls[hex(lr - MOD) if lr >= MOD else hex(lr)] += 1
        uc.reg_write(UC_ARM64_REG_X0, 0); uc.reg_write(UC_ARM64_REG_PC, lr)
    def stub(s, name, ret=0): s.stubs[s.a(name, True)] = (name.replace("_ZN12_GLOBAL__N_1", ""), (lambda: ret))
    def hook_game(s, target, invoke, backup):
        """Install like HkTrampoline: game entry -> `b invoke`; backup = original first insn + jump to target+4."""
        h = s.h; first = h.img[target:target + 4]
        h.mu.mem_write(backup, first + struct.pack("<II", 0x58000050, 0xD61F0200) + struct.pack("<Q", G + target + 4))
        d = (invoke - (G + target)) >> 2; assert -(1 << 25) <= d < (1 << 25)
        h.mu.mem_write(G + target, struct.pack("<I", 0x14000000 | (d & 0x3FFFFFF)))
SCENE_ID = 0x33
GTL = b"""GTL1
ticks_per_beat 480
bgm 64
results exit
H 480 1
C 960 tag_a
H 1440 2
A 480 Bg01
S 960
end 1920 480
finish 2400
"""
def setup_ht2(h, S, b):
    m = Module(h, ELF); h.m = m
    N = "_ZN12_GLOBAL__N_1"
    m.gBase, m.gHt3, m.gStage, m.gTl, m.gRun = (m.a(N + "5gBaseE", 1), m.a(N + "9gHt3StageE", 1), m.a(N + "6gStageE", 1), m.a(N + "3gTlE", 1), m.a(N + "4gRunE", 1))
    h.wq(m.gBase, G)
    h.wq(m.gStage, h.rq(m.gStage) + 40)            # kStages[1] (not "ht3": no sky patch path)
    for n in ("8flushLogEv", "9writeSaveEv", "14writeMultiSaveEv", "17persistCustomSaveEPKcS1_ii"): m.stub(N + n, 1)
    txt = h.alloc(len(GTL) + 16); h.mu.mem_write(txt, GTL)
    ok = h.call(m.a("_ZN6groove13parseTimelineERNS_8TimelineEPKcl", exact=True), m.gTl, txt, len(GTL)) & 0xff
    m.parse_ok = bool(ok); m.parse_err = h.rd(m.gTl + 41376 - 128, 64).split(b"\0")[0].decode(errors="replace")
    inv = [v for k, v in m.sym.items() if "TrampolineFuncIN12_GLOBAL__N_13$_1E" in k and "invoke" in k][0] + MOD
    m.hook_game(0x428EF0, inv, m.a("TrampolineStaticBackupIJN12_GLOBAL__N_13$_1EEE4origE"))      # workerHook
    inv = [v for k, v in m.sym.items() if "TrampolineFuncIN12_GLOBAL__N_13$_2E" in k and "invoke" in k][0] + MOD
    m.hook_game(0x4290F0, inv, m.a("TrampolineStaticBackupIJN12_GLOBAL__N_13$_2EEE4origE"))      # dtorHook (observer)
    h.add_real(0x509570)                                                                         # setNextScene: real write
    h.wq(m.gHt3, b["stage"])                                                                     # as ht2CtorHook post
    h.wi(b["seq"] + 8, SCENE_ID); h.wi(b["seq"] + 0x18, -1)                                      # scene id; no pending next
GTLM = b"""GTLM 1
start 0
X 0 RING 0x217960 -1
X 480 RING 0x217960 -1
X 960 RING 0x217960 -1
end 1920 960
finish 3840
"""
def setup_r21(h, S, b):
    m = Module(h, ELF); h.m = m; N = "_ZN12_GLOBAL__N_1"
    m.gBase, m.gMS, m.gMt = m.a(N + "5gBaseE", 1), m.a(N + "11gMultiStageE", 1), m.a(N + "3gMtE", 1)
    m.gMRun = {i: MOD + v for k, v in m.sym.items() for i in range(13) if k == N + "5gMRunE.%d" % i}
    h.wq(m.gBase, G)
    for n in ("8flushLogEv", "9writeSaveEv", "14writeMultiSaveEv", "17persistCustomSaveEPKcS1_ii"): m.stub(N + n, 1)
    txt = h.alloc(len(GTLM) + 16); h.mu.mem_write(txt, GTLM)
    ok = h.call(m.a("_ZN6groove13parseTimelineERNS_13MultiTimelineEPKcl", exact=True), m.gMt, txt, len(GTLM)) & 0xff
    m.parse_ok = bool(ok); m.parse_err = ""
    h.mu.mem_write(m.a(N + "7gSlotOfE", 1), b"\0" * 96); h.mu.mem_write(m.a(N + "8gCueFnOkE", 1), b"\1" * 53)
    inv = [v for k, v in m.sym.items() if "TrampolineFuncIN12_GLOBAL__N_13$_4E" in k and "invoke" in k][0] + MOD
    m.hook_game(0x420720, inv, m.a("TrampolineStaticBackupIJN12_GLOBAL__N_13$_4EEE4origE"))      # r21WorkerHook
    inv = [v for k, v in m.sym.items() if "TrampolineFuncIN12_GLOBAL__N_13$_5E" in k and "invoke" in k][0] + MOD
    m.hook_game(0x4207F0, inv, m.a("TrampolineStaticBackupIJN12_GLOBAL__N_13$_5EEE4origE"))      # r21DtorHook (observer)
    h.add_real(0x509570)
    h.wq(m.gMS, b["stage"]); h.wi(b["seq"] + 8, SCENE_ID); h.wi(b["seq"] + 0x18, -1)
MRUN = ("started", "gameplayStarted", "reachedEnd", "finished", "stopped", "saved", "resultsMode", "calls", "callsSkipped", "switches", "fades", "anims", "late")
RUN = ("started", "gameplayStarted", "reachedEnd", "finished", "stopped", "hoopsSent", "commentsSent", "bgSent", "resultsMode", "saved", "partsStarted")
def run_stats(h):
    if hasattr(h.m, "gMRun"): return {k: h.ri(h.m.gMRun[i]) for i, k in enumerate(MRUN) if i in h.m.gMRun}
    return {k: h.ri(h.m.gRun + 4 * i) for i, k in enumerate(RUN)}
def mod_threads(h, b): return [t for t in E.all_threads(h, b["runner"]) if t not in b["kids0"]]
KIND = "HT2"
def prepare_t10():
    h, S, b = X.prepare(KIND, 0, extra=setup_ht2 if KIND == "HT2" else setup_r21); b["kids0"] = list(b["kids"]); return h, S, b
def tick(h, S, b, n):
    h.phase = "tick"
    for _ in range(n):
        for th in E.all_threads(h, b["runner"]):
            if tstate(h, th) in (0, 1): S.call(X.STEP, th)
def snapshot(h, S, b):
    th = E.all_threads(h, b["runner"])
    return {"threads": len(th), "states": dict(collections.Counter(tstate(h, t) for t in th)), "run": run_stats(h),
            "seq_next": h.ri(b["seq"] + 0x18)}
def b2_and_teardown(h, S, b, st):
    m = h.m; n_app = h.appends.get("barrier", 0); c0 = len(m.calls)
    h.phase = "barrier"; st["barrier"] = barrier3(h, S, b["runner"])
    st["appends_during_barrier"] = h.appends.get("barrier", 0) - n_app
    st["after_barrier"] = snapshot(h, S, b)
    if not st["barrier"]["quiescent"]:
        st["policy"] = "safe-stop (non-returning): orig(0x5096F0) not called"; st["intact"] = intact(h, S, b)
        st["io_calls_after_barrier"] = collections.Counter(n for p, n in m.calls[c0:]); return st
    teardown(h, S, b, st)
    st["io_calls_in_teardown"] = collections.Counter(n for p, n in m.calls[c0:] if p == "teardown")
    st["module_stage_ptr_after"] = h.rq(m.gHt3 if hasattr(m, "gHt3") else m.gMS)
    return st
R, F = [], []
def check(c, m): (None if c else F.append(m))
def run(tag, fn):
    try: r = fn()
    except Exception as e: import traceback; r = {"error": repr(e)[:300], "tb": traceback.format_exc()[-600:]}
    r["tag"] = tag; R.append(r)
    if "error" in r: F.append(tag + ": " + r["error"])
    return r
def common(h):
    return {"module_relocs": h.m.nrel, "parse_ok": h.m.parse_ok, "parse_err": h.m.parse_err,
            "null_fnptr_calls": dict(h.m.nullcalls), "unmapped": h.unmapped[:4], "null_page_rw": len(h.low)}
# ---------------------------------------------------------------- paths
def run_to_finish(h, S, b, trace):
    for k in range(60):
        tick(h, S, b, 1); s = snapshot(h, S, b); trace.append((k + 1, s["threads"], s["states"].get(1, 0)))
        if s["run"]["finished"] and all(tstate(h, t) != 1 for t in E.all_threads(h, b["runner"])): return k + 1
    return None
def p_finish():
    h, S, b = prepare_t10(); st = {}; trace = []
    for k in range(60):
        tick(h, S, b, 1); s = snapshot(h, S, b); trace.append((k + 1, s["threads"], s["states"].get(1, 0)))
        if s["run"]["finished"] and all(tstate(h, t) != 1 for t in E.all_threads(h, b["runner"])): break
    st["before_b2"] = snapshot(h, S, b); st["ticks"] = k + 1; st["trace_tail"] = trace[-4:]
    st["max_threads"] = max(t[1] for t in trace)
    st["io_calls_worker"] = collections.Counter(n for p, n in h.m.calls)
    b2_and_teardown(h, S, b, st); st.update(common(h)); return st
def p_abandon(at_tick):
    h, S, b = prepare_t10(); st = {"abandon_at_tick": at_tick}
    tick(h, S, b, at_tick); st["before_b2"] = snapshot(h, S, b)
    b2_and_teardown(h, S, b, st); st.update(common(h)); return st
def p_retry():
    h, S, b = prepare_t10(); st = {}
    tick(h, S, b, 3); st["A_before"] = snapshot(h, S, b); sA = {}; b2_and_teardown(h, S, b, sA)
    st["A"] = {k: sA.get(k) for k in ("barrier", "stage_freed", "seq_freed", "late_access", "child_events_during_teardown", "global_list_has_stage", "io_calls_in_teardown", "appends_during_barrier")}
    # B: new Seq+Stage (factory in the same frame); module state as ht2CtorHook would leave it
    h.phase = "build-B"; b2 = E.build(h, S, KIND, 0); b2["code"] = b["code"]
    if KIND == "HT2": h.wq(h.m.gHt3, b2["stage"]); h.mu.mem_write(h.m.gRun, b"\0" * 76)
    else:
        h.wq(h.m.gMS, b2["stage"])
        for a in h.m.gMRun.values(): h.wi(a, 0) if (a & 3) == 0 else h.wb(a, 0)
    h.wi(b2["seq"] + 8, SCENE_ID); h.wi(b2["seq"] + 0x18, -1)
    b2["kids"] = E.all_threads(h, b2["runner"]); b2["kids0"] = list(b2["kids"])
    st["B_ticks"] = run_to_finish(h, S, b2, []); st["B_before"] = snapshot(h, S, b2); h.late.clear()
    b2_and_teardown(h, S, b2, st); st.update(common(h)); return st
def p_fail_nonreturning():
    """fault injection: the module's spawned threads ignore cancellation (tStop forced false) -> runaway."""
    h, S, b = prepare_t10(); st = {}
    tick(h, S, b, 3); st["before_b2"] = snapshot(h, S, b); mt = set(mod_threads(h, b))
    st["module_threads"] = len(mt)
    def force(hh, a):
        if hh.phase.startswith("barrier") and a[0] in mt: return 0
        return None
    h.pre[0x514DD0] = force
    b2_and_teardown(h, S, b, st)
    st["sched_events"] = collections.Counter(e[1] for e in S.log if e[1] in ("RUNAWAY", "preempt", "DEADLOCK"))
    st.update(common(h)); return st
for KIND in ("HT2", "R21"):
    r = run("T10/" + KIND + "/finish", p_finish)
    if "error" not in r:
        check(r["parse_ok"], r["tag"] + ": timeline not parsed: " + r["parse_err"])
        check(r["before_b2"]["run"]["finished"] == 1 and r["before_b2"]["run"]["started"] == 1, r["tag"] + ": module did not reach finish")
        check(r["max_threads"] > 1, r["tag"] + ": module spawned no threads")
    for k in (2, 3):
        r = run("T10/" + KIND + "/abandon@tick%d" % k, lambda: p_abandon(k))
    r = run("T10/" + KIND + "/retry(A->B)", p_retry)
    def p_fail_stuck():
        """fault injection: module bodies re-arm themselves after cancel (their wait sees state 1) -> join never completes."""
        h, S, b = prepare_t10(); st = {}
        tick(h, S, b, 3); st["before_b2"] = snapshot(h, S, b); mt = set(mod_threads(h, b)); st["module_threads"] = len(mt)
        def rearm(hh, a):
            if hh.phase.startswith("barrier") and a[0] in mt: hh.wi(a[0] + 0x250, 1)
            return None
        h.pre[0x514D70] = rearm
        h.pre[0x514DD0] = lambda hh, a: 0 if hh.phase.startswith("barrier") and a[0] in mt else None
        b2_and_teardown(h, S, b, st)
        st["sched_events"] = collections.Counter(e[1] for e in S.log if e[1] in ("RUNAWAY", "preempt", "DEADLOCK"))
        st.update(common(h)); return st
    def p_fail_identity():
        """B2 decision table with live module threads: LR != 0x50A060 -> safe stop before any barrier/orig."""
        h, S, b = prepare_t10(); st = {}
        tick(h, S, b, 3); st["before_b2"] = snapshot(h, S, b); ss = X.Sess(); ss.open(b["seq"], b["stage"]); c0 = len(h.m.calls)
        st["decision"] = ss.pre_destroy(h, b["mgr"], 0x509728)
        st["barrier"] = {"quiescent": False, "why": "not run: " + st["decision"]}
        st["intact"] = intact(h, S, b); st["after"] = snapshot(h, S, b); st["io_calls_after_barrier"] = collections.Counter(n for p, n in h.m.calls[c0:])
        st.update(common(h)); return st
    r = run("T10/" + KIND + "/info: tStop ignored by module bodies (bounded?)", p_fail_nonreturning)
    r = run("T10/" + KIND + "/fail-nonreturning: stuck body after cancel", p_fail_stuck)
    r = run("T10/" + KIND + "/fail-nonreturning: identity/LR guard", p_fail_identity)
for r in R:
    if "error" in r: continue
    t = r["tag"]
    if "fail-nonreturning" in t:
        check(not r["barrier"]["quiescent"] and r.get("intact") and not r.get("io_calls_after_barrier"), t + ": failure path not safe")
        if "identity" in t: check(r["decision"] == "safe-stop" and r["after"]["states"] == r["before_b2"]["states"], t + ": guard did not stop / threads touched")
    else:   # finish / abandon / retry / info
        check(r["barrier"]["quiescent"], t + ": barrier " + str(r["barrier"].get("why")))
        check(r["stage_freed"] and r["seq_freed"] and r["late_access"] == 0 and r["child_events_during_teardown"] == 0 and not r["global_list_has_stage"], t + ": teardown not clean")
        check(r["appends_during_barrier"] == 0, t + ": module spawned after cancel")
    check(not r["unmapped"] and r["null_page_rw"] == 0, t + ": unmapped/null-page access")
for r in R:
    bb = r.get("barrier") or {}
    print(r["tag"], "| barrier", bb.get("quiescent"), bb.get("why", ""), "rounds", bb.get("rounds"), bb.get("per_round"),
          "|", {k: v for k, v in r.items() if k in ("ticks", "max_threads", "before_b2", "A_before", "B_before", "appends_during_barrier", "stage_freed", "seq_freed",
          "late_access", "child_events_during_teardown", "global_list_has_stage", "io_calls_in_teardown", "io_calls_worker", "io_calls_after_barrier",
          "intact", "policy", "module_threads", "sched_events", "A", "B_ticks", "decision", "after_barrier", "parse_ok", "parse_err", "null_fnptr_calls", "error", "tb")})
print("FAILURES:", len(F)); [print(" -", f) for f in F]
if OUT: json.dump({"results": R, "FAILURES": F}, open(OUT, "w"), indent=1, default=str)
sys.exit(1 if F else 0)
