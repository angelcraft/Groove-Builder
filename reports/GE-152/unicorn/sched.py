"""Cooperative scheduler for the harness: models nn::os threads/events on ONE Unicorn CPU by context switching.
Real game code runs on every thread; only the nn::os imports (PLT) are modelled here (names inferred from use):
A66000 CreateThread, A66010/A66020 thread attrs, A66030 StartThread, A65FE0 WaitThread (join), A65FF0 DestroyThread,
A66090 InitializeEvent, A66060 FinalizeEvent, A66070 SignalEvent, A66080 WaitEvent (auto-clear model)."""
from harness import *
class Sched:
    def __init__(self, h):
        self.h = h; self.th = {}; self.sig = {}; self.cur = "main"; self.block = None; self.log = []
        self.order = []
        P = {0xA66000: self.create, 0xA66010: lambda a: 0, 0xA66020: lambda a: 0, 0xA66030: self.start,
             0xA65FE0: self.join, 0xA65FF0: lambda a: (self.ev("destroy", a[0]), 0)[1], 0xA66090: self.einit,
             0xA66060: lambda a: 0, 0xA66070: self.signal, 0xA66080: self.wait}
        for k, f in P.items(): h.pre[k] = (lambda f: (lambda h, a: f(a)))(f)
    def ev(self, *e): self.log.append((self.cur,) + e)
    def name(self, tobj): return "T%x" % (tobj & 0xfffff)
    def create(self, a):
        tobj, entry, arg = a[0], a[1], a[2]
        stk = self.h.alloc(0x20000)
        self.th[tobj] = {"name": self.name(tobj), "entry": entry, "arg": arg, "sp": stk + 0x1FF00, "state": "created", "ctx": None, "wait": None}
        self.ev("create", self.name(tobj), hex(entry - G)); return 0
    def start(self, a):
        t = self.th[a[0]]; t["state"] = "runnable"; self.ev("start", t["name"]); return 0
    def einit(self, a): self.sig[a[0]] = bool(a[1] & 0xff); return 0
    def signal(self, a): self.sig[a[0]] = True; self.ev("signal", hex(a[0] & 0xfff)); return 0
    def _block(self, why):
        mu = self.h.mu
        mu.reg_write(UC_ARM64_REG_X0, 0); mu.reg_write(UC_ARM64_REG_PC, mu.reg_read(UC_ARM64_REG_LR))
        self.block = (why, mu.context_save()); mu.emu_stop(); return 0
    def wait(self, a):
        if self.sig.get(a[0]): self.sig[a[0]] = False; return 0
        self.ev("wait", hex(a[0] & 0xfff)); return self._block(("ev", a[0]))
    def join(self, a):
        t = self.th.get(a[0])
        self.ev("join", t["name"] if t else "?", t["state"] if t else "-")
        if not t or t["state"] in ("done", "created"): return 0
        return self._block(("join", a[0]))
    def ready(self, who):
        w = who["wait"]
        if w is None: return True
        if w[0] == "ev":
            if self.sig.get(w[1]): self.sig[w[1]] = False; return True
            return False
        return self.th[w[1]]["state"] == "done"
    MAX_SLICES = 4   # a child that burns 4 full budgets without blocking or returning is "runaway"
    def _run(self, pc, ctx=None, regs=None, count=2_000_000):
        """Returns None ONLY if PC reached RET (normal return); a (why, ctx) tuple if the thread blocked in a
        modelled wait/join; ("budget", ctx) if the instruction budget ran out (GE-152 rev3 fix for Codex
        r4727444769: exhaustion used to be indistinguishable from a return and marked the thread done)."""
        mu = self.h.mu; self.block = None
        if ctx is not None: mu.context_restore(ctx); pc = mu.reg_read(UC_ARM64_REG_PC)
        if regs:
            for r, v in regs.items(): mu.reg_write(r, v)
        mu.emu_start(pc, RET, count=count)
        if self.block is not None: return self.block
        if mu.reg_read(UC_ARM64_REG_PC) == RET: return None
        return ("budget", mu.context_save())
    def call(self, off, *args):
        """Run `off` on the main thread to completion, scheduling children whenever main blocks.
        Main budget exhaustion raises BudgetExhausted. A child that exhausts MAX_SLICES budgets becomes
        "runaway": never done, never joinable; if main then has nothing to run the result is DEADLOCK (None)."""
        mu = self.h.mu
        regs = {UC_ARM64_REG_X0 + i: 0 for i in range(8)}
        for i, v in enumerate(args): regs[UC_ARM64_REG_X0 + i] = v & (2**64 - 1)
        regs[UC_ARM64_REG_SP] = STK + 0xF0000; regs[UC_ARM64_REG_LR] = RET
        main = {"name": "main", "wait": None}
        self.cur = "main"; b = self._run(G + off if off < G else off, regs=regs)
        while b is not None:
            if b[0] == "budget":
                self.ev("MAIN_BUDGET", hex(mu.reg_read(UC_ARM64_REG_PC)))
                raise BudgetExhausted("main call 0x%x did not return (pc=0x%x)" % (off, mu.reg_read(UC_ARM64_REG_PC)))
            main["wait"], main["ctx"] = b
            while not self.ready(main):
                ran = False
                for tobj, t in list(self.th.items()):
                    if t["state"] in ("runnable", "preempted") or (t["state"] == "blocked" and self.ready(t)):
                        ran = True; self.cur = t["name"]; ph = self.h.phase; self.h.phase = ph + ":" + t["name"]
                        if t["ctx"] is None:
                            r = {UC_ARM64_REG_X0: t["arg"], UC_ARM64_REG_SP: t["sp"], UC_ARM64_REG_LR: RET}
                            bb = self._run(t["entry"], regs=r)
                        else:
                            t["wait"] = None; bb = self._run(0, ctx=t["ctx"])
                        self.h.phase = ph
                        if bb is None: t["state"] = "done"; self.ev("exit", t["name"])
                        elif bb[0] == "budget":
                            t["slices"] = t.get("slices", 0) + 1; t["ctx"] = bb[1]; t["wait"] = None
                            if t["slices"] >= self.MAX_SLICES: t["state"] = "runaway"; self.ev("RUNAWAY", t["name"])
                            else: t["state"] = "preempted"; self.ev("preempt", t["name"])
                        else: t["state"] = "blocked"; t["wait"], t["ctx"] = bb
                        break
                if not ran:
                    self.ev("DEADLOCK", str(main["wait"])); self.cur = "main"; return None
            self.cur = "main"; main["wait"] = None
            b = self._run(0, ctx=main["ctx"])
        return mu.reg_read(UC_ARM64_REG_X0)
    def status(self): return {t["name"]: (t["state"], (t["wait"][0], hex(t["wait"][1] & 0xfff)) if t["wait"] else None) for t in self.th.values()}
