"""(C) inverse map with/without prior IPS and with the build guard; two-slot dispatch via harness mapCell; F1 by coordinate."""
import sys, json; from common import *
IMG = sys.argv[1]
TABLES = ((0, 0x10B8070, 14), (1, 0x10B81C0, 80), (2, 0x10B8940, 8))
def revmap(ips, guard=False, slots=None):
    h = setup(IMG, ips); empty = h.alloc(16); h.wi(empty, 0); h.wi(empty + 4, 13)
    st = {"b": False}
    def mc(h, a):
        w, c, r = h.ri(a[0] + 8), h.ri(a[0] + 0xC), h.ri(a[0] + 0x10)
        if st["b"] and guard and ((ips and (w, c) == (1, 9)) or (slots and (w, c, r) in slots)): return empty
        if slots and (w, c, r) in slots: return slots[(w, c, r)]
        return None
    if slots: slots = {k: (lambda p: (h.wi(p, v[0]), h.wi(p + 4, v[1]), p)[2])(h.alloc(16)) for k, v in slots.items()}
    h.pre[0x1CBCA0] = mc
    h.mu.mem_write(G + 0x10B8068, b"\0")
    st["b"] = True; h.phase = "rev"; h.call(0x1CD4E0); st["b"] = False
    out = {}
    for k, base, n in TABLES:
        for i in range(n):
            e = tuple(h.ri(G + base + i * 0x18 + 4 * j) for j in range(6))
            out["%d,%d" % (k, i)] = e
    return out, h.rb(G + 0x10B8068)
res = {"revmap": {}}
ref, f = revmap(False); res["revmap"]["orig"] = {"built_flag": f}
for name, kw in (("ips", dict(ips=True)), ("ips+guard", dict(ips=True, guard=True)),
                 ("slots(0,9,0)/(0,9,1)->{1,67},{1,41} no guard", dict(ips=False, slots={(0, 9, 0): (1, 67), (0, 9, 1): (1, 41)})),
                 ("slots + guard", dict(ips=False, guard=True, slots={(0, 9, 0): (1, 67), (0, 9, 1): (1, 41)}))):
    t, f = revmap(**kw)
    d = {k: (ref[k], t[k]) for k in ref if ref[k] != t[k]}
    res["revmap"][name] = {"built_flag": f, "entries_differing_from_orig": len(d), "diff": {k: [list(a), list(b)] for k, (a, b) in d.items()}}
res["revmap"]["orig_samples"] = {k: ref[k] for k in ("1,41", "1,67", "1,77", "1,78")}
# two-slot confirm: both slots share host {1,67}; F1 resolves slot by coordinate only
def confirm(cell, slots, guards=True, state=4):
    h = setup(IMG); M = h.MGR; mp = h.map
    w, c, r = cell; h.wi(mp + 0x5274, w); h.wi(mp + 0x5298, c); h.wi(mp + 0x529C, r)
    set_state(h, 1, 67, 4); set_state(h, 1, 41, 4)
    bufs = {k: (lambda p: (h.wi(p, v[0]), h.wi(p + 4, v[1]), p)[2])(h.alloc(16)) for k, v in slots.items()}
    h.pre[0x1CBCA0] = lambda h, a: bufs.get((h.ri(a[0] + 8), h.ri(a[0] + 0xC), h.ri(a[0] + 0x10)))
    custom = cell in slots
    if custom: h.pre[0x1CC420] = lambda h, a: state
    st = {"slot": None}
    if guards:
        def g1(h, a):
            co = (h.ri(mp + 0x5274), h.ri(mp + 0x5298), h.ri(mp + 0x529C))
            if co in slots and h.rh(M + 0xBA0) == -1:
                st["slot"] = co[2]; h.mu.reg_write(UC_ARM64_REG_X2, 0); h.mu.reg_write(UC_ARM64_REG_X3, 0)
            return None
        h.pre[0x1D3130] = g1
        for o in (0x48B0, 0x4A30, 0x4A70): h.pre[o] = (lambda h, a: 0 if st["slot"] is not None else None)
    B0 = blob(h); th = h.alloc(0x300); h.phase = "confirm"; h.call(0x1D2CC0, mp, th)
    reached = any(c_[0] == "confirm" and c_[2] == 0x1D3130 for c_ in h.calls) or any(p == "confirm" and 0x1D3130 <= pc < 0x1D349C for p, pc, *_ in h.writes)
    return {"cell": cell, "custom": custom, "F1_slot": st["slot"], "launchA_reached": reached, "curIdx": h.rh(M + 0xBA0),
            "blob_diff": [(hex(o), f_, a_, b_) for o, f_, a_, b_, _ in diff(B0, blob(h))],
            "SE_locked": any(c_[0] == "confirm" and c_[2] == 0x4EE970 for c_ in h.calls)}
S = {(0, 9, 0): (1, 67), (0, 9, 1): (1, 67)}
res["two_slot"] = [confirm((0, 9, 0), S), confirm((0, 9, 1), S), confirm((0, 8, 4), S), confirm((1, 1, 0), S),
                   confirm((0, 9, 1), S, state=1)]
json.dump(res, open(sys.argv[2], "w"), indent=1, default=str); print(json.dumps(res, indent=1, default=str))
