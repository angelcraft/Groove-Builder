"""GE-152 V0 two-slot Multi prototype, implemented as HARNESS-ONLY hooks (Python) over real game code.
This file is the executable form of the hook spec in reports/GE-152/CODEX_HANDOFF.md (H1..H10). Addresses only."""
from common import *
import registry_model as RM
SLOT_COORDS = {(0, 9, 0): 0, (0, 9, 1): 1}
HOST_MULTI = (1, 67)                                   # REMIX_21 host for adapter "multi" (existing native id; not invented)
SAVECOUNT = set(range(0x560, 0x564))                   # hdr.saveCount (mgr-relative), written by every writeSave
class V0:
    def __init__(self, h, slots, install=True):
        """slots: list of 2 dicts {enabled, id, gsv} (from registry_model)."""
        self.h = h; self.M = h.MGR; self.mp = h.map; self.slots = slots
        self.sess = None; self.reject = False; self.f4_ref = None; self.cursor = None
        self.log = []; self.f4 = []; self.cell = {}
        if not install: return
        for coord, s in SLOT_COORDS.items():
            p = h.alloc(16); h.wi(p, HOST_MULTI[0]); h.wi(p + 4, HOST_MULTI[1]); self.cell[coord] = p
        self.empty = h.alloc(16); h.wi(self.empty, 0); h.wi(self.empty + 4, 13)
        self.in_rev = False
        P = h.pre
        P[0x1CBCA0] = self.h1_mapCell; P[0x1CC420] = self.h2_cellState; P[0x1D3130] = self.h3_launch_pre
        P[0x48B0] = self.h4_skip; P[0x4A30] = self.h4_skip; P[0x4A70] = self.h4_skip
        P[0x4890] = self.h5_setSel; P[0x2E90] = self.h7_res; P[0x3D60] = self.h8_writeSave; P[0x1D39D0] = self.h10_commit
        P[0x3F70] = self.h2b_stateAt
    def coord_at(self, a0): return (self.h.ri(a0 + 8), self.h.ri(a0 + 0xC), self.h.ri(a0 + 0x10))
    def cursor_coord(self): return (self.h.ri(self.mp + 0x5274), self.h.ri(self.mp + 0x5298), self.h.ri(self.mp + 0x529C))
    def mode(self): return self.h.ri(self.mp + 0x2A38)
    # H1 mapCell: custom coordinate -> virtual host cell; during buildReverseMap -> empty (0,13)
    def h1_mapCell(self, h, a):
        c = self.coord_at(a[0])
        if c not in SLOT_COORDS: return None
        return self.empty if self.in_rev else self.cell[c]
    # H2 cellState: custom coordinate -> state from the slot's .gsv; disabled OR map mode != 0 -> 1 (locked: F0)
    def h2_cellState(self, h, a):
        c = self.coord_at(a[0])
        if c not in SLOT_COORDS: return None
        s = self.slots[SLOT_COORDS[c]]
        if not s["enabled"]: return 1
        if self.mode() != 0: self.log.append(("F0", "mode1-reject", c)); return 1
        return max(2, s["gsv"]["state"])
    # H1b: buildReverseMap 0x1CD4E0 wrapper (trampoline in the module): in_rev = true; orig(); in_rev = false
    def rebuild_reverse(self):
        self.h.mu.mem_write(G + 0x10B8068, b"\0"); self.in_rev = True
        try: self.h.call(0x1CD4E0)
        finally: self.in_rev = False
    # H2b saveStateAt 0x3F70 at the onConfirmCell call site (LR 0x1D2D68): the HOST's native state must not drive the
    # custom confirm UI (state >= 7 opens the medal path through map+0x6D68) -> return the slot state
    def h2b_stateAt(self, h, a):
        lr = h.mu.reg_read(UC_ARM64_REG_LR) - G
        c = self.cursor_coord()
        if lr != 0x1D2D68 or c not in SLOT_COORDS: return None
        st = max(2, self.slots[SLOT_COORDS[c]]["gsv"]["state"])
        self.log.append(("H2b", "confirm state from slot", st)); return st
    # H3 (F1) launchA pre
    def h3_launch_pre(self, h, a):
        c = self.cursor_coord()
        if c not in SLOT_COORDS: return None
        s = self.slots[SLOT_COORDS[c]]
        ok = s["enabled"] and self.mode() == 0 and h.rh(self.M + 0xBA0) == -1 and h.rh(self.M + 0xBA2) == -1 and h.ri(self.M + 0x2904) == -1
        if not ok:                                     # defensive: F0 should make this unreachable
            self.reject = True; self.log.append(("F1", "reject", c)); return 0
        self.sess = {"slot": SLOT_COORDS[c], "coord": c, "host": HOST_MULTI}
        self.f4_ref = blob(h); self.cursor = (0, c)
        h.mu.reg_write(UC_ARM64_REG_X2, 0); h.mu.reg_write(UC_ARM64_REG_X3, 0)
        self.log.append(("F1", "arm", c)); return None
    def h3_launch_post(self):                          # clear session bits 1..3 (RAM, via mgr+0x3AA0)
        if self.sess:
            p = self.h.rq(self.M + 0x3AA0); self.h.wi(p, self.h.ri(p) & ~0xE)
    # H4 (F2/F3): no beginPlay, no campaign counters while armed
    def h4_skip(self, h, a): return 0 if self.sess else None
    # H5 setSel suppression: only the confirm call site (LR 0x1D2ED4) and only for an armed/rejected custom launch
    def h5_setSel(self, h, a):
        lr = h.mu.reg_read(UC_ARM64_REG_LR) - G
        if (self.sess or self.reject) and lr == 0x1D2ED4:
            self.log.append(("H5", "setSel suppressed", tuple(x & 0xff for x in a[1:6]))); self.reject = False; return 0
        return None
    # H6: map init getSel post (call site 0x1CE03C): visual cursor -> custom coordinate, RAM only
    def h6_getSel_post(self, outs, mode):
        if self.cursor and self.cursor[0] == mode:
            w, c, r = self.cursor[1]
            self.h.wi(outs[0], w); self.h.wi(outs[1], c); self.h.wi(outs[2], r)
            self.log.append(("H6", "visual cursor", self.cursor[1])); self.cursor = None
    # H7: 0x2E90(kind=1, idx<0) during a custom session -> host-local idx (curIdx global untouched)
    def h7_res(self, h, a):
        if self.sess and (a[0] & 0xffffffff) == 1 and (a[1] & 0x80000000):
            h.mu.reg_write(UC_ARM64_REG_X1, self.sess["host"][1]); self.log.append(("H7", "host-local idx", self.sess["host"][1]))
        return None
    # H8 (F4): writeSave pre: byte compare vs snapshot taken at F1 (excluding hdr.saveCount)
    def h8_writeSave(self, h, a):
        if self.f4_ref is not None:
            cur = blob(h); d = [0x548 + i for i in range(len(cur)) if cur[i] != self.f4_ref[i] and (0x548 + i) not in SAVECOUNT]
            self.f4.append({"phase": h.phase, "diff": [hex(x) for x in d]})
            if not self.sess: self.f4_ref = None       # window closes at the first writeSave after the session
        return None
    # H10 (F5): commitResult skipped while armed (with pending<0 it only runs campaign expiry)
    def h10_commit(self, h, a):
        if self.sess: self.log.append(("H10", "commit skipped")); return 0
        return None
    # H9: post of mapEnterFromStage: update the slot .gsv, end the session
    def h9_end(self, result):
        if not self.sess: return
        s = self.slots[self.sess["slot"]]
        completed, rank, score = result or (False, 0, 0)
        s["gsv"] = RM.finish(s["gsv"], completed, rank, score); s["gsv"]["seq"] += 1
        self.log.append(("H9", "gsv", s["id"], s["gsv"]["plays"])); self.sess = None
def default_slots(enabled=(True, True)):
    out = []
    for i, en in enumerate(enabled):
        sid = "org.example.%s" % "ab"[i]
        out.append({"enabled": en, "id": sid, "gsv": RM.gsv_default(sid)})
    return out
def play(h, v, cell, native_results=None, custom_result=None, writes=None):
    """One map->stage->map cycle through REAL onConfirmCell / launchA / initGameplay / mapEnter / refresh / saves."""
    M, mp = h.MGR, h.map
    w, c, r = cell; h.wi(mp + 0x5274, w); h.wi(mp + 0x5298, c); h.wi(mp + 0x529C, r)
    rec = {"cell": cell, "launch": False}
    def lpre(hh, a): rec["launch"] = True; return v.h3_launch_pre(hh, a) if v.cell else None
    h.pre[0x1D3130] = lpre
    th = h.alloc(0x300); h.phase = "confirm"; h.call(0x1D2CC0, mp, th)
    if v.cell: v.h3_launch_post()
    rec["launched"] = rec["launch"] and (v.sess is not None or cell not in SLOT_COORDS or not v.cell)
    if not rec["launch"] or (cell in SLOT_COORDS and v.cell and v.sess is None):
        rec["note"] = "no launch"; return rec
    stg = h.alloc(0x8000); h.wq(stg + 0x29D8, h.alloc(0x400))
    h.phase = "initGameplay"; h.call(0x137050, stg, 0)
    if native_results and not v.sess: h.phase = "results"; h.call(0x4910, M, *native_results)
    h.phase = "mapEnter"; h.call(0x1D38A0, mp)
    if v.cell: v.h9_end(custom_result)
    # new map scene: getSel at the map-init call site (0x1CE03C), then H6 post
    mode = 1 if h.ri(mp + 0x2A38) == 1 else 0
    outs = (mp + 0x5274, mp + 0x5298, mp + 0x529C, mp + 0x52A0)
    h.phase = "mapInit"; h.call(0x4860, M, mode, *outs)
    if v.cell: v.h6_getSel_post(outs, mode)
    rec["visual_cursor"] = v.cursor_coord() if v.cell else (h.ri(mp + 0x5274), h.ri(mp + 0x5298), h.ri(mp + 0x529C))
    h.phase = "refresh"; h.call(0x1D3CA0, mp)
    h.phase = "save131440"; h.call(0x131440, h.alloc(0xA000))
    h.phase = "writeSave"; h.call(0x3D60, M, 1)
    return rec
