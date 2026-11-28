"""Shared GE-152 scenario setup (addresses/offsets only)."""
from harness import *
DESC_FN = 0x1CBBE0
def field(o):
    """mgr-relative offset -> field name"""
    if 0x570 <= o < 0x5A8: return "kind0[%d].state" % ((o - 0x570) // 4)
    if 0x5A8 <= o < 0xAA8:
        i, f = divmod(o - 0x5A8, 16); return "kind1[%d].%s" % (i, {0: "state", 4: "best", 8: "plays", 12: "perfect"}.get(f & ~3, "?") + ("" if f % 4 == 0 else "+%d" % (f % 4)))
    if 0xAA8 <= o < 0xB98:
        i, f = divmod(o - 0xAA8, 8); return "kind2[%d].%s" % (i, "state" if f < 4 else "plays")
    names = {0xB98: "sel.world[0]", 0xB99: "sel.world[1]", 0xB9A: "sel.col[0]", 0xB9B: "sel.col[1]", 0xB9C: "sel.row[0]", 0xB9D: "sel.row[1]",
             0xB9E: "sel.x[0]", 0xB9F: "sel.x[1]", 0xBA0: "pending.curIdx[0]", 0xBA1: "pending.curIdx[0]+1", 0xBA2: "pending.curIdx[1]", 0xBA3: "pending.curIdx[1]+1",
             0xBA4: "pending.rank[0]", 0xBA5: "pending.rank[1]", 0xBA6: "pending.flags[0]", 0xBA7: "pending.flags[1]",
             0xBB0: "campaign.target", 0xBB1: "campaign.target+1", 0xBB2: "campaign.remaining", 0xBB3: "campaign.cntBB3", 0xBB4: "campaign.cntBB4",
             0x560: "hdr.saveCount", 0x1096: "blob+0x1096(dirty)"}
    if o in names: return names[o]
    if 0xBA8 <= o < 0xBB0: return "pending.score[%d]+%d" % ((o - 0xBA8) // 4, (o - 0xBA8) % 4)
    if 0x115C <= o < 0x1168: return "flags@+0x%X+%d" % (o & ~3, o & 3)
    if 0x548 <= o < 0x570: return "hdr+0x%X" % o
    return "blob+0x%X" % o

def setup(img, ips=False):
    h = H(img, ips_cells=ips)
    # real game code (save manager, map/save glue, launch, return-to-map, commit)
    h.add_real_range(0x3210, 0x32DC)                   # mgr ctor
    h.add_real_range(0x3390, 0x6600)                   # reset + save accessors + writeSave/commit helpers
    h.add_real(0x78E0, 0x7920, 0x7930, 0x7940)
    for f in (0x1CBBE0, 0x1CBC40, 0x1CBC60, 0x1CBC80, 0x1CBCA0, 0x1CBCD0, 0x1CC3C0, 0x1CC420, 0x1CC9C0, 0x1CD490, 0x1CD4E0,
              0x1CD8B0, 0x1CF440, 0x1CF490, 0x1CF4E0, 0x1CF4F0, 0x1CFC50, 0x1D20D0, 0x18AE40, 0x18AE70, 0x215DB0, 0x215DC0,
              0x137050, 0x1D2CC0):
        h.add_real(f)
    h.add_real_range(0x1D3130, 0x1D349C)               # launchA
    h.add_real_range(0x1D38A0, 0x1D3D38)               # mapEnterFromStage + commitResult + refresh(1D3CA0)
    h.add_real_range(0x1D3D40, 0x1D4000)               # refresh kind1/kind2
    h.add_real(0x131440, 0x1316A0)                      # save-on-flag method, requestSave
    h.add_real(0x514D60, 0x514DD0, 0x514FB0, 0x514FD0, 0x514FF0)   # thread state helpers (wait/stop/push/pop)
    h.stubs[0xB470] = lambda h: 0                      # async file write request (recorded)
    h.stubs[0x3DC0] = lambda h: 0                      # save busy? -> not busy
    h.stubs[0x514D70] = lambda h: 0                    # thread wait -> resumes immediately
    h.stubs[0x514FD0] = lambda h: 0                    # tPop
    # watch: whole mgr object + bss globals
    M = h.MGR
    h.watch = [(M + 0x548, M + 0x16D0, "blob"), (M + 0x16D0, M + 0x2858, "staging"), (M, M + 0x548, "mgr-pre"),
               (M + 0x2858, M + 0x4000, "mgr-ram"), (G + 0x10A7310, G + 0x12A5000, "bss")]
    # scene manager singleton (GOT 0xD96068 -> var -> object)
    var = h.rq(G + 0xD96068)
    obj = h.alloc(0x100); vt = h.alloc(0x200)
    for k in range(0x40): h.wq(vt + 8 * k, h.make_fake("sceneMgr.vt+%#x" % (8 * k)))
    h.wq(obj, vt); h.wq(var, obj)
    # save manager: real ctor then real reset
    h.phase = "mgr-init"
    h.call(0x3210, M); h.call(0x3390, M)
    h.call(0x3C40, M) if False else None
    h.wi(M + 0x2904, -1)
    for m in (0, 1): h.wh(M + 0xBA0 + 2 * m, -1)
    # map object
    mp = h.alloc(0x8000)
    for o in (0x52D8, 0x52E0, 0x52F0, 0x2A30, 0x38C0, 0x29D8):
        h.wq(mp + o, h.alloc(0x400))
    b = h.alloc(0x40); h.wq(mp + 0x6F88, b + 0x18)
    h.wi(mp + 0x2A38, 0)
    h.map = mp
    h.phase = "ready"
    return h

def desc(h, k, i): return h.call(DESC_FN, k, i)
def set_state(h, k, i, v):
    base = {0: 0x570 + i * 4, 1: 0x5A8 + i * 16, 2: 0xAA8 + i * 8}[k]; h.wb(h.MGR + base, v)
def blob(h): return h.rd(h.MGR + 0x548, 0x1188)
def staging(h): return h.rd(h.MGR + 0x16D0, 0x1188)
def diff(a, b, writers=None):
    out = []
    for i in range(len(a)):
        if a[i] != b[i]:
            o = 0x548 + i
            out.append((o, field(o), a[i], b[i], writers.get(o) if writers else None))
    return out
def writers_of(h, phases=None, label="blob"):
    w = {}
    for ph, pc, addr, size, val, lbl in h.writes:
        if lbl != label or (phases and ph not in phases): continue
        for k in range(size): w.setdefault(addr - h.MGR + k, []).append((ph, "%#x" % pc))
    return w
def ram_writes(h, phases):
    out = collections.OrderedDict()
    for ph, pc, addr, size, val, lbl in h.writes:
        if ph in phases and lbl in ("mgr-ram", "bss"):
            key = ("mgr+%#x" % (addr - h.MGR)) if lbl == "mgr-ram" else ("bss %#x" % (addr - G))
            out.setdefault(key, set()).add("%#x" % pc)
    return out
