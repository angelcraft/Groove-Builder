import sys; from common import *
IMG = sys.argv[1]
S = {(0, 9, 0): (1, 67), (0, 9, 1): (1, 67)}
# two-slot confirm: both slots share host {1,67}; F1 resolves slot by coordinate only
def confirm(cell, slots=S, guards=True, state=4):
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
