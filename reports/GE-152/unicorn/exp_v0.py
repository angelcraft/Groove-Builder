"""V0 two-slot Multi prototype (mode 0) in the Unicorn harness: byte-by-byte blob/staging comparison at EVERY write point."""
import sys, json, hashlib; from common import *; from v0 import *
IMG = sys.argv[1]
WS = (0x3D60, 0x3DC0)                                  # writeSave body: its own writes (saveCount, dirty) are allowed
def mk(install=True, enabled=(True, True), pre=None, campaign=None, perfect=None, mapmode=0):
    h = setup(IMG); M = h.MGR
    set_state(h, 1, 67, 4); set_state(h, 1, 41, 4)
    for (k, i, s) in (pre or []): set_state(h, k, i, s)
    if perfect is not None: h.wb(M + 0x5A8 + 16 * 67 + 0xC, perfect)
    if campaign:
        tgt, rem, c3, c4 = campaign; h.wh(M + 0xBB0, tgt); h.wb(M + 0xBB2, rem); h.wb(M + 0xBB3, c3); h.wb(M + 0xBB4, c4)
    h.wi(h.map + 0x2A38, mapmode)
    v = V0(h, default_slots(enabled), install=install)
    mp = h.map; h.phase = "mapInit0"                    # the map scene always initialises its cursor from sel (0x1CE03C)
    h.call(0x4860, M, 1 if mapmode == 1 else 0, mp + 0x5274, mp + 0x5298, mp + 0x529C, mp + 0x52A0)
    h.points = []; B0 = blob(h); h.B0 = B0
    def rec(kind):
        cur = blob(h) if kind == "writeSave-pre" else staging(h)
        h.points.append({"phase": h.phase, "kind": kind, "sha": hashlib.sha1(cur).hexdigest()[:12],
                         "diff_vs_B0": [i + 0x548 for i in range(len(cur)) if cur[i] != B0[i]]})
    prev = h.pre.get(0x3D60)
    h.pre[0x3D60] = lambda hh, a: (rec("writeSave-pre"), prev(hh, a) if prev else None)[1]
    h.stubs[0xB470] = lambda hh: (rec("async-staging"), 0)[1]
    return h, v
def classify(h):
    """non-writeSave writers of every differing byte at every write point"""
    W = writers_of(h, phases=None)
    bad = set()
    for p in h.points:
        for o in p["diff_vs_B0"]:
            ws = W.get(o, [])
            if any(not (WS[0] <= int(pc, 16) < WS[1]) for ph, pc in ws if ph != "mgr-init"): bad.add(o)
    return sorted(bad)
def summarize(h, v, recs, extra=None):
    bad = classify(h)
    W = writers_of(h, phases=None)
    return {"plays": recs, "write_points": len(h.points),
            "write_points_detail": [{"phase": p["phase"], "kind": p["kind"], "n_diff": len(p["diff_vs_B0"]),
                                     "fields": sorted(set(field(o) for o in p["diff_vs_B0"]))} for p in h.points],
            "non_writeSave_diffs": [(hex(o), field(o), h.B0[o - 0x548], blob(h)[o - 0x548], sorted(set("%s@%s" % x for x in W.get(o, []) if x[0] != "mgr-init"))) for o in bad],
            "final_blob_diff": [(hex(o), f, a, b) for o, f, a, b, _ in diff(h.B0, blob(h))],
            "hook_log": v.log, "F4": v.f4, "gsv": [(s["id"], {k: s["gsv"][k] for k in ("state", "plays", "clears", "bestRank", "bestScore", "seq")}) for s in v.slots],
            "curIdx": [h.rh(h.MGR + 0xBA0), h.rh(h.MGR + 0xBA2)], "mode2904": h.ri(h.MGR + 0x2904), **(extra or {})}
A, B = (0, 9, 0), (0, 9, 1); R8, HT = (0, 8, 4), (1, 1, 0)
OK = (True, 4, 85)
CASES = {
 "V1 A complete":                 dict(seq=[(A, None, OK)]),
 "V2 B complete":                 dict(seq=[(B, None, OK)]),
 "V3 A->B->A reentry":            dict(seq=[(A, None, OK), (B, None, (False, 0, 10)), (A, None, (True, 5, 99))]),
 "V4 abort/reentry A":            dict(seq=[(A, None, (False, 0, 0)), (A, None, (False, 0, 0)), (A, None, OK)]),
 "V5 host state7 perfect=2":      dict(seq=[(A, None, OK)], kw=dict(pre=[(1, 67, 7)], perfect=2)),
 "V6 PC target=50":               dict(seq=[(A, None, OK)], kw=dict(campaign=(50, 3, 0, 1))),
 "V7 PC target=67(host)":         dict(seq=[(A, None, OK)], kw=dict(campaign=(67, 3, 0, 1))),
 "V8 PC none, others state6":     dict(seq=[(A, None, OK)], kw=dict(pre=[(1, i, 6) for i in range(80) if i not in (67, 41)])),
 "V9 PC target=50 cntBB4=5":      dict(seq=[(A, None, OK)], kw=dict(campaign=(50, 3, 0, 5))),
 "V10 mode1 rejected (A)":        dict(seq=[(A, None, OK)], kw=dict(mapmode=1)),
 "V11 partial install: B off":    dict(seq=[(B, None, OK), (A, None, OK)], kw=dict(enabled=(True, False))),
 "V12 A then native Remix8":      dict(seq=[(A, None, OK), (R8, (4, 85), None)]),
}
NATIVE = {
 "N1 native Remix8 rank4":        dict(seq=[(R8, (4, 85), None)]),
 "N2 native HT2 rank5":           dict(seq=[(HT, (5, 100), None)]),
 "N3 native Remix8 exit":         dict(seq=[(R8, None, None)]),
 "N4 native Remix8 PC target=50": dict(seq=[(R8, (4, 85), None)], kw=dict(campaign=(50, 3, 0, 1))),
 "N5 native Remix8 mode1":        dict(seq=[(R8, None, None)], kw=dict(mapmode=1)),
}
def run(spec, install=True):
    kw = dict(spec.get("kw", {})); h, v = mk(install=install, **kw)
    recs = []
    for cell, nres, cres in spec["seq"]:
        r = play(h, v, cell, native_results=nres, custom_result=cres); recs.append(r)
    return h, v, recs
out = {"custom": {}, "native": {}}
for name, spec in CASES.items():
    if name.startswith("V12"): continue
    h, v, recs = run(spec); out["custom"][name] = summarize(h, v, recs)
    out["custom"][name]["PASS"] = not out["custom"][name]["non_writeSave_diffs"]
# V12: the native play after a custom play must equal a clean native play (relative diffs)
h1, v1, _ = run({"seq": [(R8, (4, 85), None)]})
d_clean = [(o, b - a if o in SAVECOUNT else b) for o, f, a, b, _ in diff(h1.B0, blob(h1))]
h2, v2, _ = run({"seq": [(A, None, OK)]}); mid = blob(h2); play(h2, v2, R8, native_results=(4, 85))
d_after = [(o, b - a if o in SAVECOUNT else b) for o, f, a, b, _ in diff(mid, blob(h2))]
out["custom"]["V12 A then native Remix8"] = summarize(h2, v2, [])
out["custom"]["V12 A then native Remix8"]["native_after_custom_equals_clean_native"] = (d_after == d_clean)
out["custom"]["V12 A then native Remix8"]["native_after_custom_fields"] = sorted(set(field(o) for o, _ in d_after))
out["custom"]["V12 A then native Remix8"]["PASS"] = (d_after == d_clean)
# native controls: V0 installed vs not installed -> byte-identical at every write point
for name, spec in NATIVE.items():
    ha, va, ra = run(spec, install=True); hb, vb, rb = run(spec, install=False)
    same = [p["sha"] for p in ha.points] == [p["sha"] for p in hb.points] and blob(ha) == blob(hb)
    out["native"][name] = {"identical_with_and_without_V0": same, "write_points": len(ha.points),
                           "fields_changed": sorted(set(field(o) for o, *_ in diff(ha.B0, blob(ha)))), "sel_after": list(blob(ha)[0xB98 - 0x548:0xBA0 - 0x548]),
                           "hook_log": va.log, "PASS": same}
# 0x2E90 host-local fix (H7): direct call with and without an armed session
h, v = mk(); h.add_real(0x2E90, 0x2CC0)
fake = h.alloc(0x1000)
for i in range(0x100): h.wq(fake + 0x498 + 8 * i, 0xA0000000 + i)
h.stubs[0x2B50] = lambda hh: fake
r_noss = h.call(0x2E90, 1, -1) - 0xA0000000
v.sess = {"slot": 0, "coord": A, "host": HOST_MULTI}; r_ss = h.call(0x2E90, 1, -1) - 0xA0000000
r_nat = h.call(0x2E90, 1, 67) - 0xA0000000; v.sess = None
out["H7_0x2E90"] = {"no_session_idx-1_slot": r_noss, "session_idx-1_slot": r_ss, "native_idx67_slot": r_nat, "curIdx_unchanged": h.rh(h.MGR + 0xBA0) == -1,
                    "PASS": r_ss == r_nat and h.rh(h.MGR + 0xBA0) == -1}
# H1b: reverse map with V0 installed (wrapper) == reverse map of the untouched image
def rev(install):
    h, v = mk(install=install)
    if install: v.rebuild_reverse()
    else: h.mu.mem_write(G + 0x10B8068, b"\0"); h.call(0x1CD4E0)
    return h.rd(G + 0x10B8070, 0x10B8A00 - 0x10B8070)
r0, r1 = rev(False), rev(True)
out["H1b_reverse_map"] = {"bytes_compared": len(r0), "bytes_different": sum(1 for a, b in zip(r0, r1) if a != b), "PASS": r0 == r1}
json.dump(out, open(sys.argv[2], "w"), indent=1, default=str)
for k in ("custom", "native"):
    for n, r in out[k].items():
        print(("PASS " if r["PASS"] else "FAIL ") + n, "| wp:", r.get("write_points"), "| bad:", r.get("non_writeSave_diffs"), "| gsv:", r.get("gsv"),
              "| log:", [x[:2] for x in r.get("hook_log", [])][:8], "| F4:", [len(f["diff"]) for f in r.get("F4", [])], "| plays:", [(p.get("note"), p.get("visual_cursor")) for p in r.get("plays", [])])
print(out["H7_0x2E90"]); print(out["H1b_reverse_map"])
