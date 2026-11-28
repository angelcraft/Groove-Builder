"""GE-156: order of Stage destruction vs Runner join inside the Stage owner (Seq) teardown.
Runs REAL main 03FF4A3B code for: SceneMgr::destroyPending 0x5096F0, Seq deleting dtor 0x2AB5F0,
Seq dtor 0x2AB4D0, Seq base dtor 0x130080, base@+0x30 dtor 0x1283A0, Runner dtor 0x515040, Runner clear 0x515290.
The Stage and the thread node are harness fakes that only log; everything else is a logged stub.
Image is passed by argument and never published. Only addresses/offsets here."""
import sys, json
from harness import H, G
IMG = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else None
REAL = (0x5096F0, 0x2AB5F0, 0x2AB4D0, 0x130080, 0x1283A0, 0x515040, 0x515290, 0x515000)
def run(next_id, nthreads=2, null_stage=False):
    h = H(IMG); [h.add_real(a) for a in REAL]
    order = []
    def log(name, fn=None):
        def f(h, a):
            order.append((name, a[0], a[1]))
            return fn(h, a) if fn else 0
        return f
    h.stubs[0x4E04E0] = lambda h: (order.append(("free", h.x(0), hex(h.x(1)))), 0)[1]
    mgr = h.alloc(0x60); seq = h.alloc(0xA080 + 0x40); h.SEQ = seq
    vt_seq = h.rq(G + 0xD9ADE8) + 0x10; h.wq(seq, vt_seq)
    h.wq(mgr + 0x10, seq); h.wi(mgr + 0x18, next_id)
    # stage fake object: vt+0x10 = deleting dtor (slot used by the owner at 0x2AB54C)
    stage = h.alloc(0x100); svt = h.alloc(0x100)
    for k in range(0x20): h.wq(svt + 8 * k, h.make_fake("stage.vt+%#x" % (8 * k), log("stage.vt+%#x" % (8 * k))))
    h.wq(stage, svt); h.wq(seq + 0xA078, 0 if null_stage else stage)
    # runner embedded at seq+0x58: real ctor, then fake thread nodes linked at runner+8 (link th+8)
    runner = seq + 0x58; h.call(0x515000, runner); h.wq(seq, vt_seq)
    prev = 0
    for t in range(nthreads):
        th = h.alloc(0x300); tvt = h.alloc(0x40)
        for k in range(8): h.wq(tvt + 8 * k, h.make_fake("thread%d.vt+%#x" % (t, 8 * k), log("thread%d.vt+%#x(join+free)" % (t, 8 * k))))
        h.wq(th, tvt); h.wq(th + 8, prev); prev = th
    h.wq(runner + 8, prev)
    var = h.rq(G + 0xD96068); h.wq(var, h.alloc(0x4000))   # framework singleton read by 0x130100
    h.phase = "teardown"
    try: r = h.call(0x5096F0, mgr)
    except Exception as e:
        from unicorn.arm64_const import UC_ARM64_REG_PC, UC_ARM64_REG_LR
        print("EMU ERROR", e, hex(h.mu.reg_read(UC_ARM64_REG_PC) - G), hex(h.mu.reg_read(UC_ARM64_REG_LR) - G), [hex(h.x(i)) for i in range(10)]); raise
    ids = {seq: "seq", stage: "stage", runner: "runner(seq+0x58)"}
    trace = [(c[1], hex(c[2]) if isinstance(c[2], int) else c[2], ids.get(c[3][0], "other"), hex(c[4])) for c in h.calls if c[0] == "teardown"]
    return {"trace": trace, "next_id": next_id, "ret": r, "mgr_cur_after": h.rq(mgr + 0x10), "seq_A078_after": h.rq(seq + 0xA078),
            "order": [(o[0], ids.get(o[1], "thread-node" if o[0].startswith("thread") else hex(o[1])), str(o[2])) for o in order],
            "unlisted_count": sum(h.unexpected.values())}
res = {"transition": run(5), "no_transition": run(-1), "selftest_null_stage": run(5, null_stage=True)}
fails = []
o = [x[0] for x in res["transition"]["order"]]
try:
    i_stage = o.index("stage.vt+0x10"); i_join = min(i for i, n in enumerate(o) if n.startswith("thread")); i_free_seq = [i for i, x in enumerate(res["transition"]["order"]) if x[0] == "free" and x[1] == "seq"][0]
    if not (i_stage < i_join < i_free_seq): fails.append("order")
except Exception as e: fails.append("missing event %r" % e)
if res["no_transition"]["order"]: fails.append("no_transition deleted something")
if any(x[0].startswith("stage") for x in res["selftest_null_stage"]["order"]): fails.append("selftest: null stage dispatched")
if not any(x[0] == "free" and x[1] == "seq" for x in res["selftest_null_stage"]["order"]): fails.append("selftest: seq not freed")
if res["transition"]["seq_A078_after"] != 0: fails.append("seq+0xA078 not cleared")
res["FAILURES"] = fails
print(json.dumps(res, indent=1))
if OUT: json.dump(res, open(OUT, "w"), indent=1)
sys.exit(1 if fails else 0)
