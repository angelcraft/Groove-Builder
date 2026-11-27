import os
"""(A) native-progress isolation: launchA -> beginPlay -> stage(initGameplay) -> exit/results -> mapEnter(commit) -> refresh -> save."""
import sys, json, zlib; from common import *
IMG = sys.argv[1]
HOST_R21 = (1, 67); HOST_HT2 = (1, 41)
CUSTOM_CELLS = {(0, 9, 0), (0, 9, 1)}
def region(h, k, i):
    o = {1: 0x5A8 + 16 * i, 2: 0xAA8 + 8 * i}[k]; return h.rd(h.MGR + o, 16 if k == 1 else 8)
def run(name, cell, host, ips=False, guards=False, pre=None, flags=(0, 0), results=None, mapmode=0, campaign=None, perfect=None, bssflag=False):
    h = setup(IMG, ips)
    if bssflag: h.mu.mem_write(G + 0x10B8C10, bytes([h.rb(G + 0x10B8C10) | 1]))
    M = h.MGR
    for (k, i, st) in (pre or []): set_state(h, k, i, st)
    if perfect is not None: h.wb(M + 0x5A8 + 16 * host[1] + 0xC, perfect)
    if campaign:
        tgt, rem, c3, c4 = campaign; h.wh(M + 0xBB0, tgt); h.wb(M + 0xBB2, rem); h.wb(M + 0xBB3, c3); h.wb(M + 0xBB4, c4)
    mp = h.map; h.wi(mp + 0x2A38, mapmode)
    w, c, r = cell; h.wi(mp + 0x5274, w); h.wi(mp + 0x5298, c); h.wi(mp + 0x529C, r)
    d = desc(h, *host)
    res = {"case": name, "cell": cell, "host": host, "ips": ips, "guards": guards, "flags": flags, "mapmode": mapmode}
    st = {"launch": False, "crc0": None}
    is_custom = cell in CUSTOM_CELLS or (ips and cell[1] == 9 and cell[0] == 1)
    def crc_now():
        return zlib.crc32(region(h, *host) + h.rd(M + 0xBA0, 0x18))
    if guards:
        def g_begin(h, a): return 0 if st["launch"] else None
        def g_cnt(h, a): return 0 if st["launch"] else None
        def g_save(h, a):
            if st["crc0"] is not None: res.setdefault("F4", []).append({"phase": h.phase, "crc_equal": crc_now() == st["crc0"]})
            return None
        h.pre[0x48B0] = g_begin; h.pre[0x4A30] = g_cnt; h.pre[0x4A70] = g_cnt; h.pre[0x3D60] = g_save
    B0 = blob(h); S_before = h.rd(M + 0x3AA8, 4)
    a2, a3 = flags
    # ---- F1 (harness) pre
    if guards and is_custom:
        mode = 1 if mapmode == 1 else 0
        cur = h.rh(M + 0xBA0 + 2 * (1 if h.ri(mp + 0x2A38) == 1 else 0))
        res["F1_precondition_curIdx"] = cur
        if cur != -1: res["F1"] = "decline (curIdx!=-1)"; return res
        st["launch"] = True; st["crc0"] = crc_now(); a2 = a3 = 0
    h.phase = "launchA"; h.call(0x1D3130, mp, d, a2, a3)
    if st["launch"]:
        h.wi(M + 0x3AA8, h.ri(M + 0x3AA8) & ~0xE)       # F1 post: clear session bits 1..3 (RAM)
    res["after_launch"] = {"curIdx0": h.rh(M + 0xBA0), "curIdx1": h.rh(M + 0xBA2), "mode2904": h.ri(M + 0x2904),
                           "sess3AA8": hex(h.ri(M + 0x3AA8))}
    # ---- stage: real initGameplay (0x137050)
    stg = h.alloc(0x8000); h.wq(stg + 0x29D8, h.alloc(0x400))
    h.phase = "initGameplay"; h.call(0x137050, stg, 0)
    if results:                                        # model results scene: real setPending with 0x215210 args
        h.phase = "results"; h.call(0x4910, M, results[0], results[1])
    res["pending_before_map"] = {"curIdx": h.rh(M + 0xBA0), "rank": h.rb(M + 0xBA4), "score": h.ri(M + 0xBA8)}
    st["launch"] = False
    # ---- back to map
    h.phase = "mapEnter+commit"; h.call(0x1D38A0, mp)
    res["map_after"] = {"pend5278": h.ri(mp + 0x5278), "col": h.ri(mp + 0x5298), "row": h.ri(mp + 0x529C), "scroll": h.ri(mp + 0x52A0),
                        "sel": list(h.rd(M + 0xB98, 8))}
    h.phase = "refresh"; h.call(0x1D3CA0, mp)
    # ---- saves: save-on-flag method + next official save
    obj = h.alloc(0xA000)
    h.phase = "save131440"; h.call(0x131440, obj)
    h.phase = "nextSave"; h.call(0x3D60, M, 1)
    W = writers_of(h, phases={"launchA","initGameplay","results","mapEnter+commit","refresh","save131440","nextSave"})
    res["blob_diff"] = [(hex(o), f, a, b, sorted(set("%s@%s" % x for x in W.get(o, [])))) for o, f, a, b, _ in diff(B0, blob(h))]
    res["staging_vs_B0"] = [(hex(o), f) for o, f, a, b, _ in diff(B0, staging(h)) if f not in ("hdr.saveCount", "blob+0x1096(dirty)")]
    res["ram"] = {k: sorted(v) for k, v in ram_writes(h, {"launchA", "initGameplay", "results", "mapEnter+commit", "refresh", "save131440"}).items()}
    res["async_write_requests"] = sum(1 for c in h.calls if c[1] == "stub" and c[2] == 0xB470)
    res["writeSave_calls"] = [c[0] for c in h.calls if c[2] == 0x3D60 or (c[1] == "pre-pass" and c[2] == 0x3D60)]
    res["launch_calls"] = sorted(set("%s:%s" % (c[1], hex(c[2]) if isinstance(c[2], int) else c[2]) for c in h.calls if c[0] == "launchA" and c[1] in ("unlisted", "fake", "stub")))
    res["unlisted_total"] = {hex(k): v for k, v in h.unexpected.items() if k not in (0xb3b0, 0x4e0620, 0x4efc80, 0x13bba0, 0x4df1d0, 0x4efe80, 0x4eff50, 0x4df6d0, 0x4df4b0, 0x4efdb0, 0x2520c0)}
    return res
CASES = [
 ("N1 native Remix8 (0,8,4) results rank4", dict(cell=(0, 8, 4), host=HOST_R21, pre=[(1, 67, 4)], results=(4, 85))),
 ("N2 native HT2 (1,1,0) results rank5", dict(cell=(1, 1, 0), host=HOST_HT2, pre=[(1, 41, 4)], results=(5, 100))),
 ("N3 native Remix8 exit/quit (no results)", dict(cell=(0, 8, 4), host=HOST_R21, pre=[(1, 67, 4)])),
 ("N4 native Remix8 + guards inactive (control)", dict(cell=(0, 8, 4), host=HOST_R21, pre=[(1, 67, 4)], results=(4, 85), guards=True)),
 ("C1 custom v0.5 IPS (1,9,4) exit, no guards", dict(cell=(1, 9, 4), host=HOST_R21, ips=True, pre=[(1, 67, 4)])),
 ("C1p custom IPS exit, host state7 perfect=2, flag bit0", dict(cell=(1, 9, 4), host=HOST_R21, ips=True, pre=[(1, 67, 7)], flags=(1, 0), perfect=2)),
 ("N5 native Remix8 first clear (state2) results rank4", dict(cell=(0, 8, 4), host=HOST_R21, pre=[(1, 67, 2)], results=(4, 85))),
 ("C1s custom IPS exit, host state2", dict(cell=(1, 9, 4), host=HOST_R21, ips=True, pre=[(1, 67, 2)])),
 ("C2s custom guards, host state2", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 2)], guards=True)),
 ("C2h custom guards, HT2 host (hoop adapter)", dict(cell=(0, 9, 1), host=HOST_HT2, pre=[(1, 41, 4)], guards=True)),
 ("C2 custom (0,9,0) exit, guards F1-F4", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 4)], guards=True)),
 ("C2p custom guards, host state7 perfect=2 flag bit0", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 7)], flags=(1, 0), guards=True, perfect=2)),
 ("PC-N native Remix8, campaign target=50", dict(cell=(0, 8, 4), host=HOST_R21, pre=[(1, 67, 4), (1, 50, 4)], campaign=(50, 3, 0, 1), results=(4, 85))),
 ("PC-C1 custom IPS no guards, campaign target=50", dict(cell=(1, 9, 4), host=HOST_R21, ips=True, pre=[(1, 67, 4), (1, 50, 4)], campaign=(50, 3, 0, 1))),
 ("PC-C2 custom guards, campaign target=50", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 4), (1, 50, 4)], campaign=(50, 3, 0, 1), guards=True)),
 ("PCH-C1 custom IPS no guards, campaign target=67(host)", dict(cell=(1, 9, 4), host=HOST_R21, ips=True, pre=[(1, 67, 4)], campaign=(67, 3, 0, 0))),
 ("PCH-C2 custom guards, campaign target=67(host)", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 4)], campaign=(67, 3, 0, 0), guards=True)),
 ("PC4-C2 custom guards, campaign target=50 cntBB4=5 (expiry edge)", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 4), (1, 50, 4)], campaign=(50, 3, 0, 5), guards=True)),
 ("PC0-N native Remix8, no campaign, all others state6", dict(cell=(0, 8, 4), host=HOST_R21, pre=[(1, i, 6) for i in range(80) if i != 67] + [(1, 67, 4)], results=(4, 85))),
 ("PC0-C1 custom IPS no guards, no campaign, all others state6", dict(cell=(1, 9, 4), host=HOST_R21, ips=True, pre=[(1, i, 6) for i in range(80) if i != 67] + [(1, 67, 4)])),
 ("PC0-C2 custom guards, no campaign, all others state6", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, i, 6) for i in range(80) if i != 67] + [(1, 67, 4)], guards=True)),
 ("M1 custom guards, map mode 1", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 4)], guards=True, mapmode=1)),
 ("M1b custom guards, map mode 1, bit0 0x10B8C10 set", dict(cell=(0, 9, 0), host=HOST_R21, pre=[(1, 67, 4)], guards=True, mapmode=1, bssflag=True)),
 ("M1-N native Remix8 map mode 1 exit", dict(cell=(0, 8, 4), host=HOST_R21, pre=[(1, 67, 4)], mapmode=1)),
]
def f0(name, cell_state_override, cell=(0, 9, 0), guards=False):
    h = setup(IMG); M = h.MGR; mp = h.map
    w, c, r = cell; h.wi(mp + 0x5274, w); h.wi(mp + 0x5298, c); h.wi(mp + 0x529C, r)
    set_state(h, 1, 67, 4)
    cellbuf = h.alloc(16); h.wi(cellbuf, 1); h.wi(cellbuf + 4, 67)
    def mc(h, a):          # harness dynamic mapCell: custom coord -> host {1,67}; else real
        w_, c_, r_ = h.ri(a[0] + 8), h.ri(a[0] + 0xC), h.ri(a[0] + 0x10)
        return cellbuf if (w_, c_, r_) == cell else None
    h.pre[0x1CBCA0] = mc
    if guards:
        st = {"l": False}
        def g1(h, a):
            if (h.ri(mp + 0x5274), h.ri(mp + 0x5298), h.ri(mp + 0x529C)) == cell and h.rh(M + 0xBA0) == -1:
                st["l"] = True; h.mu.reg_write(UC_ARM64_REG_X2, 0); h.mu.reg_write(UC_ARM64_REG_X3, 0)
            return None
        h.pre[0x1D3130] = g1
        for o in (0x48B0, 0x4A30, 0x4A70): h.pre[o] = (lambda h, a: 0 if st["l"] else None)
    if cell_state_override is not None:
        h.pre[0x1CC420] = lambda h, a: cell_state_override        # harness F0: cellState for the custom cell
    B0 = blob(h); th = h.alloc(0x300)
    h.phase = "confirm"; h.call(0x1D2CC0, mp, th)
    called = sorted(set(hex(c[2]) for c in h.calls if c[0] == "confirm" and isinstance(c[2], int) and c[1] in ("unlisted", "stub", "pre-skip", "pre-pass")))
    W = writers_of(h, phases={"confirm"})
    return {"case": name, "launchA_reached": any(c[0] == "confirm" and c[2] == 0x1D3130 for c in h.calls) or any(p == "confirm" and pc_in(pc) for p, pc, *_ in h.writes),
            "calls": called, "blob_diff": [(hex(o), f, a, b) for o, f, a, b, _ in diff(B0, blob(h))],
            "SE_0x4EE970": any(c[0] == "confirm" and c[2] == 0x4EE970 for c in h.calls)}
def pc_in(pc): return 0x1D3130 <= pc < 0x1D349C
out = []
for n, ov, g in (() if os.environ.get('ONLY') else (("F0 invalid package: cellState->1 (locked)", 1, False), ("F0 control: cellState->4 (enabled), no guards", 4, False), ("F0+F1-F3: enabled, guards", 4, True))):
    try: out.append(f0(n, ov, guards=g))
    except Exception as e: out.append({"case": n, "error": repr(e)})
import os
for n, kw in CASES:
    if os.environ.get('ONLY') and not n.startswith(os.environ['ONLY']): continue
    try: out.append(run(n, **kw))
    except Exception as e: out.append({"case": n, "error": repr(e)})
json.dump(out, open(sys.argv[2], "w"), indent=1, default=str)
for r in out:
    print("==", r["case"])
    if "error" in r: print("  ERROR", r["error"]); continue
    if "launchA_reached" in r: print("  ", {k: r[k] for k in ("launchA_reached", "SE_0x4EE970", "blob_diff", "calls")}); continue
    for k in ("F1_precondition_curIdx", "F1", "after_launch", "pending_before_map", "map_after", "F4", "async_write_requests"):
        if k in r: print("  %s: %s" % (k, r[k]))
    print("  blob_diff:"); [print("    ", x) for x in r["blob_diff"]]
    print("  staging_vs_B0:", r["staging_vs_B0"])
