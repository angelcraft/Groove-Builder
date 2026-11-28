"""V0 two-slot Multi prototype (mode 0) in the Unicorn harness. Rev 2 (review 7230247601, item 1 + item 3):
every expectation is an assertion; full-byte comparison of blob AND staging at every write point against an exact
allow-list (hdr.saveCount only); non-vacuity checks; self-tests (mutations) that must be detected. Exit != 0 on failure."""
import sys, json; from common import *; from v0 import *
import registry_model as RM
IMG = sys.argv[1]
FAILS = []
def check(cond, tag, msg):
    if not cond: FAILS.append("%s: %s" % (tag, msg))
    return bool(cond)
def mk(install=True, enabled=(True, True), ids=("org.example.a", "org.example.b"), pre=None, campaign=None, perfect=None, mapmode=0, mutate=(), bits=None):
    h = setup(IMG); M = h.MGR
    set_state(h, 1, 67, 4); set_state(h, 1, 41, 4)
    for (k, i, s) in (pre or []): set_state(h, k, i, s)
    if perfect is not None: h.wb(M + 0x5A8 + 16 * 67 + 0xC, perfect)
    if campaign:
        tgt, rem, c3, c4 = campaign; h.wh(M + 0xBB0, tgt); h.wb(M + 0xBB2, rem); h.wb(M + 0xBB3, c3); h.wb(M + 0xBB4, c4)
    h.wi(h.map + 0x2A38, mapmode)
    if bits is not None: h.wi(h.rq(M + 0x3AA0), bits)
    v = V0(h, default_slots(enabled, ids), install=install, mutate=mutate)
    mp = h.map; h.phase = "mapInit0"
    h.call(MAP_INIT, mp, h.alloc(0x100), 0)             # H0 captures the map (no-op without V0)
    h.call(0x4860, M, 1 if mapmode == 1 else 0, mp + 0x5274, mp + 0x5298, mp + 0x529C, mp + 0x52A0)
    h.points = []; h.B0 = blob(h); h.S0 = staging(h)
    def rec(kind):
        h.points.append({"phase": h.phase, "kind": kind, "bytes": blob(h) if kind == "writeSave-pre" else staging(h)})
    prev = h.pre.get(0x3D60)
    h.pre[0x3D60] = lambda hh, a: (rec("writeSave-pre"), prev(hh, a) if prev else None)[1]
    def asy(hh): rec("async-staging"); return 0
    h.stubs[0xB470] = asy
    return h, v
def diffset(a, b): return [0x548 + i for i in range(len(a)) if a[i] != b[i]]
def check_points(tag, h, expect_points):
    """every write point: full bytes vs B0; only hdr.saveCount may differ; saveCount must actually advance"""
    n = len(h.points)
    check(n == expect_points, tag, "write points %d != expected %d" % (n, expect_points))
    out = []
    for k, p in enumerate(h.points):
        d = diffset(h.B0, p["bytes"]); extra = [hex(o) for o in d if o not in SAVECOUNT]
        sc0 = int.from_bytes(h.B0[0x18:0x1C], "little"); sc = int.from_bytes(p["bytes"][0x18:0x1C], "little")
        check(not extra, tag, "point %d %s/%s: bytes outside allow-list %s" % (k, p["phase"], p["kind"], [(o, field(int(o, 16))) for o in extra[:6]]))
        if p["kind"] == "async-staging": check(sc > sc0, tag, "point %d: staging saveCount did not advance (vacuous)" % k)
        out.append({"phase": p["phase"], "kind": p["kind"], "bytes_compared": len(p["bytes"]), "diff_offsets": [hex(o) for o in d], "saveCount": [sc0, sc]})
    fb = blob(h); d = [o for o in diffset(h.B0, fb) if o not in SAVECOUNT]
    check(not d, tag, "final blob differs outside saveCount: %s" % [hex(o) for o in d[:6]])
    return out
def gsv_stats(s):
    g = s["gsv"]; return None if g is None else {k: g[k] for k in ("id", "state", "plays", "clears", "bestRank", "bestScore")}
A, B = (0, 9, 0), (0, 9, 1); R8, HT = (0, 8, 4), (1, 1, 0)
OK = (True, 4, 85)
def G_(i, state=2, plays=0, clears=0, br=0, bs=0): return {"id": "org.example." + i, "state": state, "plays": plays, "clears": clears, "bestRank": br, "bestScore": bs}
DA, DB = G_("a"), G_("b"); A1 = G_("a", 3, 1, 1, 4, 85)
# seq: (cell, native_result, custom_result, expect_launch); per launch 2 write points (writeSave-pre + async staging)
CASES = {
 "V1 A complete":              dict(seq=[(A, None, OK, True)], gsv=(A1, DB)),
 "V2 B complete":              dict(seq=[(B, None, OK, True)], gsv=(DA, G_("b", 3, 1, 1, 4, 85))),
 "V3 A->B->A reentry":         dict(seq=[(A, None, OK, True), (B, None, (False, 0, 10), True), (A, None, (True, 5, 99), True)], gsv=(G_("a", 3, 2, 2, 5, 99), G_("b", 2, 1, 0, 0, 10))),
 "V4 abort/reentry A":         dict(seq=[(A, None, (False, 0, 0), True), (A, None, (False, 0, 0), True), (A, None, OK, True)], gsv=(G_("a", 3, 3, 1, 4, 85), DB)),
 "V5 host state7 perfect=2":   dict(seq=[(A, None, OK, True)], gsv=(A1, DB), kw=dict(pre=[(1, 67, 7)], perfect=2)),
 "V6 PC target=50":            dict(seq=[(A, None, OK, True)], gsv=(A1, DB), kw=dict(campaign=(50, 3, 0, 1))),
 "V7 PC target=67(host)":      dict(seq=[(A, None, OK, True)], gsv=(A1, DB), kw=dict(campaign=(67, 3, 0, 1))),
 "V8 PC none, others state6":  dict(seq=[(A, None, OK, True)], gsv=(A1, DB), kw=dict(pre=[(1, i, 6) for i in range(80) if i not in (67, 41)])),
 "V9 PC target=50 cntBB4=5":   dict(seq=[(A, None, OK, True)], gsv=(A1, DB), kw=dict(campaign=(50, 3, 0, 5))),
 "V10 mode1 rejected (A)":     dict(seq=[(A, None, OK, False)], gsv=(DA, DB), kw=dict(mapmode=1)),
 "V11 partial install: B off": dict(seq=[(B, None, OK, False), (A, None, OK, True)], gsv=(A1, DB), kw=dict(enabled=(True, False))),
 "V13 B has no id":            dict(seq=[(B, None, OK, False), (A, None, OK, True)], gsv=(A1, None), kw=dict(ids=("org.example.a", None))),
 "V14 custom gsv state 9":     dict(seq=[(A, None, OK, True)], gsv=(G_("a", 9, 1, 1, 4, 85), DB), setgsv=(0, 9)),
 "V15 custom gsv wrong id":    dict(seq=[(A, None, OK, False)], gsv=None, setid=(0, "org.example.zzz")),
 "V16 session bits preserved": dict(seq=[(A, None, OK, True)], gsv=(A1, DB), kw=dict(bits=0x4A), points=4),   # pre-existing bit1 = native save request -> 0x131440 saves (2 extra points, saveCount only)
 "V17 x restored by H6":       dict(seq=[(A, None, OK, True)], gsv=(A1, DB), x=3),
 "V18 PC target=50 remaining=0": dict(seq=[(A, None, OK, True)], gsv=(A1, DB), kw=dict(campaign=(50, 0, 0, 1))),   # commitResult would expire the campaign
}
NATIVE = {
 "N1 native Remix8 rank4":        dict(seq=[(R8, (4, 85), None, True)]),
 "N2 native HT2 rank5":           dict(seq=[(HT, (5, 100), None, True)]),
 "N3 native Remix8 exit":         dict(seq=[(R8, None, None, True)]),
 "N4 native Remix8 PC target=50": dict(seq=[(R8, (4, 85), None, True)], kw=dict(campaign=(50, 3, 0, 1))),
 "N5 native Remix8 mode1":        dict(seq=[(R8, None, None, True)], kw=dict(mapmode=1)),
}
# positive control for the medal-path detector: native cell (1,1,0) -> desc (1,41) with state 7, V0 not installed
def run(spec, install=True, mutate=()):
    h, v = mk(install=install, mutate=mutate, **dict(spec.get("kw", {})))
    if "setgsv" in spec: v.slots[spec["setgsv"][0]]["gsv"]["state"] = spec["setgsv"][1]
    if "setid" in spec: v.slots[spec["setid"][0]]["gsv"]["id"] = spec["setid"][1]
    recs = [play(h, v, cell, native_results=n, custom_result=c, x=spec.get("x")) for cell, n, c, _ in spec["seq"]]
    return h, v, recs
def custom_case(name, spec, mutate=(), record=True):
    tag = name + (" [mutation %s]" % ",".join(mutate) if mutate else "")
    nf = len(FAILS)
    h, v, recs = run(spec, mutate=mutate)
    nl = 0
    for (cell, _, _, exp), r in zip(spec["seq"], recs):
        check(r["launched"] == exp, tag, "launch at %s: %s, expected %s" % (cell, r["launched"], exp))
        if not exp: check(r["points_after"] == r["points_before"], tag, "locked cell %s produced write points" % (cell,))
        nl += exp
    pts = check_points(tag, h, spec.get("points", 2 * nl))
    if nl == 0: check(blob(h) == h.B0 and staging(h) == h.S0, tag, "no-launch case changed blob/staging bytes")
    got = [gsv_stats(s) for s in v.slots]
    if spec.get("gsv") is not None: check(got == list(spec["gsv"]), tag, "gsv %s != expected %s" % (got, list(spec["gsv"])))
    check(v.medal == 0, tag, "native medal path entered (%d)" % v.medal)
    check(v.sess is None and v.reject is None and v.cursor is None, tag, "bounded state not cleared: sess=%s reject=%s cursor=%s" % (v.sess, v.reject, v.cursor))
    check(h.rh(h.MGR + 0xBA0) == -1 and h.rh(h.MGR + 0xBA2) == -1 and h.ri(h.MGR + 0x2904) == -1, tag, "pending/curIdx/mode touched")
    check(not v.trip, tag, "tripwire %s" % v.trip)
    for (cell, _, _, exp), r in zip(spec["seq"], recs):
        if exp: check(r["visual_cursor"] == cell + (r["x_confirm"],), tag, "visual cursor %s != %s" % (r["visual_cursor"], cell + (r["x_confirm"],)))
    if "bits" in spec.get("kw", {}):
        p = h.rq(h.MGR + 0x3AA0); b = h.ri(p)
        check((b & SESSION_BITS) == (spec["kw"]["bits"] & SESSION_BITS) and (b & 0x40) == (spec["kw"]["bits"] & 0x40), tag, "session bits not preserved: %#x" % b)
    res = {"PASS": len(FAILS) == nf, "launches": nl, "plays": [{k: r.get(k) for k in ("cell", "launched", "visual_cursor", "note")} for r in recs],
           "write_points": pts, "gsv": got, "hook_log": v.log, "F4": v.f4, "medal_path": v.medal, "tripwires": v.trip}
    if not record: res["failures"] = FAILS[nf:]; del FAILS[nf:]
    return res
out = {"custom": {}, "native": {}, "selftest": {}, "unit": {}}
for name, spec in CASES.items(): out["custom"][name] = custom_case(name, spec)
# V12: native play after a custom play == clean native play (relative bytes)
tag = "V12 A then native Remix8"; nf = len(FAILS)
h1, v1, _ = run({"seq": [(R8, (4, 85), None, True)]})
d_clean = [(o, b - a if o in SAVECOUNT else b) for o, f, a, b, _ in diff(h1.B0, blob(h1))]
h2, v2, _ = run({"seq": [(A, None, OK, True)]}); mid = blob(h2); play(h2, v2, R8, native_results=(4, 85))
d_after = [(o, b - a if o in SAVECOUNT else b) for o, f, a, b, _ in diff(mid, blob(h2))]
check(len(d_clean) > 4, tag, "vacuous: clean native play changed nothing but saveCount")
check(d_after == d_clean, tag, "native after custom != clean native")
out["custom"][tag] = {"PASS": len(FAILS) == nf, "native_changed_bytes": len(d_clean), "fields": sorted(set(field(o) for o, _ in d_clean))}
# native controls: V0 installed vs not installed -> identical full bytes at every write point
for name, spec in NATIVE.items():
    nf = len(FAILS)
    ha, va, ra = run(spec, install=True); hb, vb, rb = run(spec, install=False)
    check(all(r["launched"] for r in ra) and all(r["launched"] for r in rb), name, "native launch missing")
    check(len(ha.points) == len(hb.points) > 0, name, "write points %d vs %d" % (len(ha.points), len(hb.points)))
    for k, (pa, pb) in enumerate(zip(ha.points, hb.points)):
        check(pa["bytes"] == pb["bytes"] and pa["kind"] == pb["kind"], name, "point %d bytes differ (%d)" % (k, len(diffset(pa["bytes"], pb["bytes"]))))
    check(blob(ha) == blob(hb) and staging(ha) == staging(hb), name, "final blob/staging differ")
    check(not va.trip and all(x[0] == "H0" for x in va.log), name, "V0 acted on a native play: %s" % va.log)
    out["native"][name] = {"PASS": len(FAILS) == nf, "write_points": len(ha.points), "bytes_compared_per_point": 0x1188,
                           "fields_changed": sorted(set(field(o) for o, *_ in diff(ha.B0, blob(ha)))), "medal_path": [va.medal, vb.medal], "hook_log": va.log}
hp, vp = mk(install=False, pre=[(1, 41, 7)], perfect=2); hp.wi(hp.map + 0x5274, 1); hp.wi(hp.map + 0x5298, 1); hp.wi(hp.map + 0x529C, 0)
try: hp.call(ON_CONFIRM, hp.map, hp.alloc(0x300)); pc_err = None
except Exception as e: pc_err = repr(e)
out["medal_positive_control"] = {"medal_block_hits": vp.medal, "note": "native (1,1,0)->(1,41) state 7, no V0", "stopped_by": pc_err}
check(vp.medal > 0, "medal positive control", "medal path not reached natively (detector vacuous)")
# ---- unit tests for item 3
U = out["unit"]
def unit(name, fn):
    nf = len(FAILS)
    try: info = fn(name)
    except Exception as e:
        import traceback; FAILS.append("%s: exception %r" % (name, e)); info = traceback.format_exc()[-400:]
    U[name] = {"PASS": len(FAILS) == nf, "info": info}
def setc(h, co, c): h.wi(co + 8, c[0]); h.wi(co + 0xC, c[1]); h.wi(co + 0x10, c[2])
def t_h1(tag):
    h, v = mk(ids=("org.example.a", None)); co = h.alloc(0x20); res = {}
    for c in (A, B):
        setc(h, co, c); p = v.h1_mapCell(h, [co]); res[str(c)] = (h.ri(p), h.ri(p + 4))
    check(res[str(A)] == HOST_MULTI and res[str(B)] == (0, 13), tag, "H1 A/B cells %s" % res)
    setc(h, co, B); check(v.h2_cellState(h, [co]) is None, tag, "no-id slot must stay native-empty in H2")
    h, v = mk(enabled=(True, False)); co = h.alloc(0x20); setc(h, co, B)
    p = v.h1_mapCell(h, [co]); st = v.h2_cellState(h, [co])
    check((h.ri(p), h.ri(p + 4)) == HOST_MULTI and st == 1, tag, "invalid slot with id must be host cell + locked (state %s)" % st)
    res["invalid_with_id"] = [(h.ri(p), h.ri(p + 4)), st]; return res
def t_h2b(tag):
    h, v = mk(); r = {}
    h.wi(h.map + 0x5274, 0); h.wi(h.map + 0x5298, 9); h.wi(h.map + 0x529C, 0)
    def q():
        v.confirm_map = h.map; h.mu.reg_write(UC_ARM64_REG_LR, G + 0x1D2D68); return v.h2b_stateAt(h, [0, 1, 67])
    for st in (2, 3, 6, 7, 9, 255): v.slots[0]["gsv"]["state"] = st; r[st] = q()
    check(all(x is not None and 2 <= x < 7 for x in r.values()), tag, "H2b states %s" % r)
    v.slots[0]["gsv"]["state"] = 300; bad = q(); check(bad == 1, tag, "invalid state -> locked, got %s" % bad)
    v.slots[0]["gsv"]["state"] = 2; h.call(MAP_DTOR, h.map); dead = q(); check(dead == 1, tag, "destroyed map -> locked, got %s" % dead)
    return {"states": r, "invalid_300": bad, "destroyed_map": dead}
def t_h3(tag):
    info = {}
    h, v = mk(); mp = h.map; h.wi(mp + 0x5274, 0); h.wi(mp + 0x5298, 9); h.wi(mp + 0x529C, 0)
    r1 = v.h3_launch_pre(h, [mp, 0, 1, 1]); s1 = dict(v.sess); r2 = v.h3_launch_pre(h, [mp, 0, 1, 1])
    check(r1 is None and r2 == 0 and v.sess == s1 and v.reject is not None, tag, "re-entry not rejected")
    info["reentry"] = [r1, r2, v.log[-1]]
    h, v = mk(); other = h.alloc(0x8000); h.wi(other + 0x5298, 9)
    check(v.h3_launch_pre(h, [other, 0, 0, 0]) == 0 and v.sess is None, tag, "foreign Map* armed a session")
    info["foreign_map"] = v.log[-1]
    h, v = mk(); mp = h.map; h.wi(mp + 0x5298, 9); g0 = v.gen; h.call(MAP_DTOR, mp)
    check(v.map is None and v.gen == g0 + 1, tag, "map destroy not tracked")
    check(v.h3_launch_pre(h, [mp, 0, 0, 0]) == 0 and v.sess is None, tag, "destroyed map armed a session")
    info["destroyed_map"] = v.log[-1]
    h.call(MAP_INIT, mp, 0, 0); check(v.map == mp and v.gen == g0 + 2 and v.reject is None, tag, "re-init not tracked / reject not cleared")
    check(v.h3_launch_pre(h, [mp, 0, 0, 0]) is None and v.sess, tag, "arm failed")
    h.call(MAP_DTOR, mp); h.call(MAP_INIT, mp, 0, 0)
    check(v.sess is None and v.cursor is None and v.f4_ref is None, tag, "stale session not dropped")
    info["stale_session"] = [x for x in v.log if "dropped" in str(x)]
    v.reject = {"map": mp, "gen": v.gen}; h.call(ON_CONFIRM, mp, h.alloc(0x300)); v.h0_confirm_end()
    check(v.reject is None, tag, "gReject survived the next onConfirmCell")
    info["gen"] = v.gen; return info
def t_h7(tag):
    h, v = mk(); h.add_real(0x2E90, 0x2CC0)
    fake = h.alloc(0x1000)
    for i in range(0x100): h.wq(fake + 0x498 + 8 * i, 0xA0000000 + i)
    h.stubs[0x2B50] = lambda hh: fake
    got = {}
    def tail(hh): got["last"] = hh.x(1); return 0
    h.stubs[0x4EFF20] = tail
    def at(lr, idx):
        got.pop("last", None); mu = h.mu
        for r in range(8): mu.reg_write(UC_ARM64_REG_X0 + r, 0)
        mu.reg_write(UC_ARM64_REG_X0, 1); mu.reg_write(UC_ARM64_REG_X1, idx & 0xffffffff)
        mu.reg_write(UC_ARM64_REG_SP, STK + 0xF0000); mu.reg_write(UC_ARM64_REG_LR, G + lr)
        mu.emu_start(G + 0x2CC0, G + lr, count=100000)
        return (got["last"] - 0xA0000000) if got.get("last") else None
    v.sess = {"slot": 0, "id": "org.example.a", "coord": A, "host": HOST_MULTI, "gen": v.gen, "stage": True}
    r = {"callsite_session": at(H7_CALLSITE_LR, -1), "other_callsite_session": at(0x1D187C, -1)}
    r["direct_2E90_session"] = h.call(0x2E90, 1, -1) - 0xA0000000
    n0 = len(v.trip); h.call(X_CTOR, h.alloc(0x4000)); r["x_ctor_tripwire"] = len(v.trip) - n0
    v.sess = None; r["callsite_no_session"] = at(H7_CALLSITE_LR, -1); r["native_67"] = at(H7_CALLSITE_LR, 67)
    check(r["callsite_session"] == 73 and r["native_67"] == 73, tag, "callsite with session must resolve like native idx 67 (slot 73)")
    check(r["other_callsite_session"] != 73 and r["direct_2E90_session"] != 73, tag, "substitution outside the proven call site")
    check(r["callsite_no_session"] != 73, tag, "no-session behaviour changed")
    check(r["x_ctor_tripwire"] == 1 and any("0x206A54" in t[0] for t in v.trip), tag, "tripwires missing")
    check(h.rh(h.MGR + 0xBA0) == -1, tag, "curIdx touched")
    r["tripwires"] = v.trip; return r
def t_h1b(tag):
    def rev(install):
        h, v = mk(install=install)
        if install: v.rebuild_reverse()
        else: h.mu.mem_write(G + 0x10B8068, b"\0"); h.call(0x1CD4E0)
        return h.rd(G + 0x10B8070, 0x10B8A00 - 0x10B8070)
    r0, r1 = rev(False), rev(True)
    check(len(r0) > 0 and any(r0) and r0 == r1, tag, "reverse map differs or vacuous")
    return {"bytes_compared": len(r0), "bytes_different": sum(1 for a, b in zip(r0, r1) if a != b)}
for n, f in (("H1 no id / invalid id", t_h1), ("H2b validated state < 7", t_h2b), ("H3 Map*/gen/re-entry/bounds", t_h3),
             ("H7 call site only + tripwires", t_h7), ("H1b reverse map", t_h1b)): unit(n, f)
# ---- self-tests: each mutation must make the assertions fail
for mut, case in (("no-H5", "V1 A complete"), ("no-H4", "V1 A complete"), ("no-H10", "V18 PC target=50 remaining=0"), ("no-H2b", "V5 host state7 perfect=2"),
                  ("no-H6", "V17 x restored by H6"), ("no-H3post", "V16 session bits preserved")):
    try: r = custom_case(case, CASES[case], mutate=(mut,), record=False)
    except Exception as e: r = {"PASS": False, "failures": ["exception %r (medal path with harness map: map+0x6D68 unbacked)" % e]}
    out["selftest"][mut] = {"case": case, "detected": not r["PASS"], "first_failures": r.get("failures", [])[:2]}
    check(not r["PASS"], "selftest " + mut, "mutation not detected by %s" % case)
out["failures"] = FAILS
json.dump(out, open(sys.argv[2], "w"), indent=1, default=str)
for k in ("custom", "native", "unit"):
    for n, r in out[k].items(): print(("PASS " if r["PASS"] else "FAIL ") + n)
print("SELFTEST", {k: v["detected"] for k, v in out["selftest"].items()})
print("FAILURES:", len(FAILS)); [print(" -", f[:300]) for f in FAILS]
sys.exit(1 if FAILS else 0)
