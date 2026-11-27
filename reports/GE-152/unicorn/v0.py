"""GE-152 V0 two-slot Multi prototype, implemented as HARNESS-ONLY hooks (Python) over real game code.
Executable form of the hook spec in reports/GE-152/CODEX_HANDOFF.md (H0..H10). Addresses only.
Rev 2 (review 7230247601): H1 empty without id, H2/H2b validated state < 7 + valid map, H3 Map* arg + generation +
no re-entry + bounded state + map-destroy hook, H3 post restores only bits 1..3, H6 restores w/c/r/x, H7 only at the
proven call site 0x206A54 + tripwires."""
from common import *
import registry_model as RM
SLOT_COORDS = {(0, 9, 0): 0, (0, 9, 1): 1}
HOST_MULTI = (1, 67)                                   # REMIX_21 host for adapter "multi" (existing native id; not invented)
SAVECOUNT = set(range(0x560, 0x564))                   # hdr.saveCount (mgr-relative), written by every writeSave
SESSION_BITS = 0xE                                     # bits 1..3 of *(mgr+0x3AA0): cleared at 0x1D3184..0x1D31A8 and set at 0x1D31D0..0x1D32A4 by launchA
STATE_MAX = 6                                          # onConfirmCell: state >= 7 -> medal path (cmp w0,#7 at 0x1D2D68)
MEDAL_BLOCK = 0x1D2D70                                 # first block of the medal path (detector used by the tests)
H7_CALLSITE_LR = 0x206A58                              # X::0x2068D0: bl 0x2CC0 at 0x206A54 (the only unchecked caller)
X_CTOR = 0x2064A0                                      # scene_perfect ctor (tripwire)
MAP_INIT, MAP_DTOR = 0x1CD9A0, 0x1CE200                # Map::init(map, stage, w) from scene ctor 0x371730; Map::~Map from scene dtor 0x371AC0
ON_CONFIRM, LAUNCH_A, INIT_GAMEPLAY = 0x1D2CC0, 0x1D3130, 0x137050
def i8(v): v &= 0xff; return v - 0x100 if v & 0x80 else v
def valid_gsv(s):
    """custom state validation: record exists, belongs to this slot id, state is a small int"""
    g = s.get("gsv")
    if not isinstance(g, dict) or g.get("id") != s.get("id"): return None
    st = g.get("state")
    if not isinstance(st, int) or not (0 <= st <= 255): return None
    return min(max(2, st), STATE_MAX)
class V0:
    def __init__(self, h, slots, install=True, mutate=()):
        """slots: list of 2 dicts {enabled, id, gsv} (from registry_model). mutate: self-test switches that disable a hook."""
        self.h = h; self.M = h.MGR; self.slots = slots; self.mut = set(mutate)
        self.map = None; self.gen = 0                    # H0: captured Map* + generation (bumped on init and destroy)
        self.confirm_map = None                          # Map* of the onConfirmCell in progress
        self.sess = None; self.reject = None; self.f4_ref = None; self.cursor = None; self.sel = None
        self.bits_before = None
        self.log = []; self.f4 = []; self.cell = {}; self.trip = []; self.medal = 0
        self.installed = install
        h.pre[MEDAL_BLOCK] = self._medal                 # detector only (returns None)
        if not install: return
        for coord, r in SLOT_COORDS.items():
            p = h.alloc(16); h.wi(p, HOST_MULTI[0]); h.wi(p + 4, HOST_MULTI[1]); self.cell[coord] = p
        self.empty = h.alloc(16); h.wi(self.empty, 0); h.wi(self.empty + 4, 13)
        self.in_rev = False
        P = h.pre
        P[MAP_INIT] = self.h0_map_init; P[MAP_DTOR] = self.h0_map_dtor; P[ON_CONFIRM] = self.h0_confirm
        P[INIT_GAMEPLAY] = self.h0_stage
        P[0x1CBCA0] = self.h1_mapCell; P[0x1CC420] = self.h2_cellState; P[0x3F70] = self.h2b_stateAt
        P[LAUNCH_A] = self.h3_launch_pre
        P[0x48B0] = self.h4_skip; P[0x4A30] = self.h4_skip; P[0x4A70] = self.h4_skip
        P[0x4890] = self.h5_setSel; P[0x2CC0] = self.h7_callsite; P[X_CTOR] = self.h7_trip_x
        P[0x3D60] = self.h8_writeSave; P[0x1D39D0] = self.h10_commit
    def _medal(self, h, a): self.medal += 1; return None
    def coord_at(self, a0): return (self.h.ri(a0 + 8), self.h.ri(a0 + 0xC), self.h.ri(a0 + 0x10))
    def cursor_of(self, mp): return (self.h.ri(mp + 0x5274), self.h.ri(mp + 0x5298), self.h.ri(mp + 0x529C))
    def mode_of(self, mp): return self.h.ri(mp + 0x2A38)
    def map_ok(self, mp): return mp is not None and self.map is not None and mp == self.map
    # ---- H0: map lifetime + confirm context
    def h0_map_init(self, h, a):
        self.gen += 1; self.map = a[0]; self.reject = None; self.log.append(("H0", "map init", self.gen))
        if self.sess and not self.sess["stage"]:         # bounded session: armed but no stage ever started -> drop it
            self.log.append(("H0", "session dropped (no stage)", self.sess["id"])); self.sess = None; self.cursor = None; self.f4_ref = None
        return None
    def h0_map_dtor(self, h, a):
        if a[0] == self.map:
            self.map = None; self.gen += 1; self.reject = None; self.confirm_map = None; self.log.append(("H0", "map destroyed", self.gen))
        return None
    def h0_confirm(self, h, a):
        self.confirm_map = a[0]; self.reject = None      # gReject lives for at most one onConfirmCell
        return None
    def h0_confirm_end(self): self.confirm_map = None
    def h0_stage(self, h, a):
        if self.sess: self.sess["stage"] = True
        return None
    # ---- H1 mapCell: custom coordinate -> host cell only when the slot has an id; no id or reverse build -> empty (0,13)
    def h1_mapCell(self, h, a):
        c = self.coord_at(a[0])
        if c not in SLOT_COORDS: return None
        s = self.slots[SLOT_COORDS[c]]
        if self.in_rev or not s.get("id"): return self.empty
        return self.cell[c]                              # id present: host cell (painted locked by H2 if invalid)
    # ---- H2 cellState: no id -> native (empty cell); invalid/disabled/mode!=0/invalid state -> 1 (locked); else state in [2,6]
    def h2_cellState(self, h, a):
        c = self.coord_at(a[0])
        if c not in SLOT_COORDS: return None
        s = self.slots[SLOT_COORDS[c]]
        if not s.get("id"): return None
        if not s["enabled"]: return 1
        if self.map is None or self.mode_of(self.map) != 0: self.log.append(("F0", "mode/map-reject", c)); return 1
        st = valid_gsv(s)
        if st is None: self.log.append(("F0", "invalid gsv", c)); return 1
        return st
    def rebuild_reverse(self):                           # H1b: buildReverseMap 0x1CD4E0 trampoline
        self.h.mu.mem_write(G + 0x10B8068, b"\0"); self.in_rev = True
        try: self.h.call(0x1CD4E0)
        finally: self.in_rev = False
    # ---- H2b saveStateAt 0x3F70 at onConfirmCell (LR 0x1D2D68): valid captured map + validated slot state, always < 7
    def h2b_stateAt(self, h, a):
        if "no-H2b" in self.mut: return None
        lr = h.mu.reg_read(UC_ARM64_REG_LR) - G
        if lr != 0x1D2D68 or self.confirm_map is None: return None
        c = self.cursor_of(self.confirm_map)
        if c not in SLOT_COORDS: return None
        s = self.slots[SLOT_COORDS[c]]
        st = valid_gsv(s) if (s.get("id") and s["enabled"] and self.map_ok(self.confirm_map) and self.mode_of(self.confirm_map) == 0) else None
        if st is None: self.log.append(("H2b", "locked (invalid map/slot/state)", c)); return 1
        self.log.append(("H2b", "confirm state from slot", st)); return st
    # ---- H3 launchA(Map*, Desc*, w2, w3) pre: Map* argument, generation snapshot, no re-entry
    def h3_launch_pre(self, h, a):
        mp = a[0]
        c = self.cursor_of(mp)
        if c not in SLOT_COORDS: self.bits_before = None; return None
        r = SLOT_COORDS[c]; s = self.slots[r]
        why = None
        if not self.map_ok(mp): why = "map not captured/destroyed"
        elif self.sess is not None: why = "re-entry (session already armed)"
        elif not (s.get("id") and s["enabled"]): why = "slot disabled"
        elif valid_gsv(s) is None: why = "invalid gsv"
        elif self.mode_of(mp) != 0: why = "mode != 0"
        elif not (h.rh(self.M + 0xBA0) == -1 and h.rh(self.M + 0xBA2) == -1 and h.ri(self.M + 0x2904) == -1): why = "native pending"
        if why:
            self.reject = {"map": mp, "gen": self.gen}; self.log.append(("F1", "reject", c, why)); return 0
        self.sess = {"slot": r, "id": s["id"], "coord": c, "host": HOST_MULTI, "gen": self.gen, "stage": False}
        self.f4_ref = blob(h); self.cursor = None; self.sel = None
        p = h.rq(self.M + 0x3AA0); self.bits_before = (p, h.ri(p))
        h.mu.reg_write(UC_ARM64_REG_X2, 0); h.mu.reg_write(UC_ARM64_REG_X3, 0)
        self.log.append(("F1", "arm", c, s["id"], self.gen)); return None
    def h3_launch_post(self):
        """restore ONLY bits 1..3 to their value before this launchA call (launchA itself clears and re-sets exactly these
        bits from w2/w3 at 0x1D3184..0x1D32A4); every other bit keeps what native code left."""
        if self.bits_before and self.sess and "no-H3post" not in self.mut:
            p, before = self.bits_before; after = self.h.ri(p)
            self.h.wi(p, (after & ~SESSION_BITS) | (before & SESSION_BITS))
            self.log.append(("H3post", "bits", hex(before), hex(after), hex(self.h.ri(p))))
        self.bits_before = None
    # ---- H4 (F2/F3): no beginPlay, no campaign counters while armed
    def h4_skip(self, h, a): return 0 if self.sess and "no-H4" not in self.mut else None
    # ---- H5 setSel at confirm (LR 0x1D2ED4): suppressed for the armed/rejected custom launch; tuple kept for H6
    def h5_setSel(self, h, a):
        if "no-H5" in self.mut: return None
        lr = h.mu.reg_read(UC_ARM64_REG_LR) - G
        if lr != 0x1D2ED4: return None
        if self.sess and self.sess["gen"] == self.gen:
            t = tuple(int(x & 0xffffffff) for x in a[1:6]); mode, w, c, r, x = (i8(v) if k else v for k, v in enumerate(t))
            if mode == 0 and (w, c, r) == self.sess["coord"]:
                self.sel = (mode, w, c, r, x); self.cursor = {"mode": 0, "sel": self.sel, "id": self.sess["id"]}
            else: self.log.append(("H5", "incoherent tuple, no cursor", t))
            self.log.append(("H5", "setSel suppressed", t)); return 0
        if self.reject and self.reject["gen"] == self.gen:
            self.log.append(("H5", "setSel suppressed (reject)")); self.reject = None; return 0
        return None
    # ---- H6 getSel post at map init (0x1CE03C): restore w, c, r AND x from the suppressed setSel tuple
    def h6_getSel_post(self, outs, mode):
        if "no-H6" in self.mut or not self.cursor: return
        if self.cursor["mode"] == mode:
            _, w, c, r, x = self.cursor["sel"]
            for o, v in zip(outs, (w, c, r, x)): self.h.wi(o, v)
            self.log.append(("H6", "visual cursor", (w, c, r, x)))
        self.cursor = None                               # one-shot
    # ---- H7: only the proven unchecked call site (bl 0x2CC0 at 0x206A54), only with a session; tripwires
    def h7_callsite(self, h, a):
        lr = h.mu.reg_read(UC_ARM64_REG_LR) - G
        if lr != H7_CALLSITE_LR: return None
        if self.sess:
            self.trip.append(("callsite 0x206A54 during custom session", self.sess["id"]))
            if (a[1] & 0x80000000) and "no-H7" not in self.mut:
                h.mu.reg_write(UC_ARM64_REG_X1, self.sess["host"][1]); self.log.append(("H7", "host-local idx at 0x206A54", self.sess["host"][1]))
        return None
    def h7_trip_x(self, h, a):
        if self.sess: self.trip.append(("scene_perfect ctor during custom session", self.sess["id"]))
        return None
    # ---- H8 (F4) detector: writeSave pre, byte compare vs snapshot taken at F1 (excluding hdr.saveCount); never blocks
    def h8_writeSave(self, h, a):
        if self.f4_ref is not None:
            cur = blob(h); d = [0x548 + i for i in range(len(cur)) if cur[i] != self.f4_ref[i] and (0x548 + i) not in SAVECOUNT]
            self.f4.append({"phase": h.phase, "diff": [hex(x) for x in d]})
            if not self.sess: self.f4_ref = None
        return None
    # ---- H10 (F5): commitResult skipped while armed
    def h10_commit(self, h, a):
        if self.sess and "no-H10" not in self.mut: self.log.append(("H10", "commit skipped")); return 0
        return None
    # ---- H9 (draft; item 4 belongs to Codex): post of mapEnterFromStage
    def h9_end(self, result):
        if not self.sess: return
        s = self.slots[self.sess["slot"]]
        assert s["id"] == self.sess["id"], "slot identity changed during session"
        completed, rank, score = result or (False, 0, 0)
        s["gsv"] = RM.finish(s["gsv"], completed, rank, score); s["gsv"]["seq"] += 1
        self.log.append(("H9", "gsv", s["id"], s["gsv"]["plays"])); self.sess = None
def default_slots(enabled=(True, True), ids=("org.example.a", "org.example.b")):
    out = []
    for en, sid in zip(enabled, ids):
        out.append({"enabled": bool(en and sid), "id": sid, "gsv": RM.gsv_default(sid) if sid else None})
    return out
def play(h, v, cell, native_results=None, custom_result=None, x=None):
    """One map->stage->map cycle through REAL onConfirmCell / launchA / initGameplay / mapEnter / refresh / saves,
    with the map lifetime modelled: Map::~Map (0x1CE200) after launch, Map::init (0x1CD9A0) on return."""
    M, mp = h.MGR, h.map
    w, c, r = cell; h.wi(mp + 0x5274, w); h.wi(mp + 0x5298, c); h.wi(mp + 0x529C, r)
    if x is not None: h.wi(mp + 0x52A0, x)
    rec = {"cell": cell, "x_confirm": h.ri(mp + 0x52A0), "launch_called": False, "points_before": len(getattr(h, "points", []))}
    prev = h.pre.get(LAUNCH_A)
    def lpre(hh, a): rec["launch_called"] = True; return prev(hh, a) if prev else None
    h.pre[LAUNCH_A] = lpre
    th = h.alloc(0x300); h.phase = "confirm"; h.call(ON_CONFIRM, mp, th)
    if prev: h.pre[LAUNCH_A] = prev
    else: h.pre.pop(LAUNCH_A, None)
    if v.installed: v.h3_launch_post(); v.h0_confirm_end()
    custom = v.installed and cell in SLOT_COORDS
    rec["launched"] = rec["launch_called"] and (v.sess is not None if custom else True)
    if not rec["launched"]:
        rec["note"] = "no launch"; rec["points_after"] = len(getattr(h, "points", [])); return rec
    h.phase = "mapDtor"; h.call(MAP_DTOR, mp)
    stg = h.alloc(0x8000); h.wq(stg + 0x29D8, h.alloc(0x400))
    h.phase = "initGameplay"; h.call(INIT_GAMEPLAY, stg, 0)
    if native_results and not v.sess: h.phase = "results"; h.call(0x4910, M, *native_results)
    h.phase = "mapInit"; h.call(MAP_INIT, mp, h.alloc(0x100), 0)
    mode = 1 if h.ri(mp + 0x2A38) == 1 else 0
    outs = (mp + 0x5274, mp + 0x5298, mp + 0x529C, mp + 0x52A0)
    h.wi(mp + 0x52A0, 0x55)                              # garbage: H6 must rewrite x too
    h.call(0x4860, M, mode, *outs)
    if v.installed: v.h6_getSel_post(outs, mode)
    rec["visual_cursor"] = tuple(h.ri(o) for o in outs)
    h.phase = "mapEnter"; h.call(0x1D38A0, mp)
    if v.installed: v.h9_end(custom_result)
    h.phase = "refresh"; h.call(0x1D3CA0, mp)
    h.phase = "save131440"; h.call(0x131440, h.alloc(0xA000))
    h.phase = "writeSave"; h.call(0x3D60, M, 1)
    rec["points_after"] = len(getattr(h, "points", []))
    return rec
