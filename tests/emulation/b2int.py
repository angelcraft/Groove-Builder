"""GE-151 interim (Grok) - integration harness for grok/engine-b2-integration.
The REAL compiled module (GrooveHT3 .nss ELF built with tools/build_engine.py) is loaded next to a LOCAL main 03FF4A3B
image; every hook hkMain installs is patched into the image from the module's own plan (groove_hook_plan: offset, entry,
backup), the module is activated as hkMain does after a full install (groove_emu_activate), and nn::fs / nn::os symbols
resolved through hk::ro::lookupSymbol are served by a fake SD rooted at a copy of a GE-155-installed tree.
Covers: compiled H-B2 (decision table, barrier, safe-stop, tripwires, observers) on stages constructed THROUGH the module
ctor hooks (HT2 custom, legacy multi, V0 Custom Remix A/B), T10 paths (finish/abandon/retry) + late spawn + failures,
and the V0 map flow (confirm -> launch -> Seq/R21 ctor -> worker -> exit -> H-B2 -> teardown -> map -> H9).
Cooperative scheduler (sched.py), NOT Horizon. Neither the image nor the module is ever committed.
Usage: python b2int.py $GE_MAIN_IMG $GE_MODULE_ELF $SD_TREE [out.json]"""
import sys, os, json, shutil, tempfile, collections, struct, traceback
IMG, ELF, SDSRC = sys.argv[1], sys.argv[2], sys.argv[3]; OUT = sys.argv[4] if len(sys.argv) > 4 else None
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.argv = [sys.argv[0], IMG]
from elftools.elf.elffile import ELFFile
from unicorn import UC_HOOK_BLOCK, UC_HOOK_CODE
from unicorn.arm64_const import *
import exp_owner3 as X
from exp_owner3 import E, G, Sched, BudgetExhausted, tstate, handle, os_state
from harness import HEAP
def _all_threads(h, runner, limit=128):
    out, p = [], h.rq(runner + 8)
    while p and len(out) < limit and p not in out: out.append(p); p = h.rq(p + 8)
    return out
E.all_threads = _all_threads                      # bounded: a corrupted (cyclic) list must not hang the harness
MOD = G + 0x1800000
N = "_ZN12_GLOBAL__N_1"
MAIN_OS = 0x7fff8000            # nn::os::ThreadType* of the main thread (fake, non-null)
RET = 0x7ffffff0
CALL_SITE, CALL_LR = 0x50A05C, 0x50A060
RET_SCENE = 0x7                 # return scene id the map registers at 0x1CE154 (harness model of *(0xDAB880))
PATH_NOT_FOUND, ALREADY_EXISTS, FS_ERR = 0x202, 0x402, 0x1
# ---------------------------------------------------------------- fake SD (nn::fs over a temp copy of an installed tree)
class FakeSD:
    def __init__(s, h, src):
        s.h = h; s.root = tempfile.mkdtemp(prefix="b2sd-"); shutil.copytree(src, s.root, dirs_exist_ok=True)
        s.fh = {}; s.next = 1; s.ops = []; s.mutations = []
    def path(s, a):
        p = s.h.cstr(a); assert p.startswith("ht3sd:/"), p
        return p, os.path.join(s.root, p[7:])
    def rec(s, op, p, mut):
        s.ops.append((s.h.phase, op, p))
        if mut: s.mutations.append((s.h.phase, op, p))
    def mount(s, h, a): s.rec("mount", h.cstr(a[0]), False); return 0
    def mkdir(s, h, a):
        p, f = s.path(a[0]); s.rec("mkdir", p, True)
        if os.path.exists(f): return ALREADY_EXISTS
        if not os.path.isdir(os.path.dirname(f)): return PATH_NOT_FOUND
        os.mkdir(f); return 0
    def create(s, h, a):
        p, f = s.path(a[0]); s.rec("create", p, True)
        if os.path.exists(f): return ALREADY_EXISTS
        if not os.path.isdir(os.path.dirname(f)): return PATH_NOT_FOUND
        open(f, "wb").write(b"\0" * a[1]); return 0
    def delete(s, h, a):
        p, f = s.path(a[0]); s.rec("delete", p, True)
        if not os.path.isfile(f): return PATH_NOT_FOUND
        os.remove(f); return 0
    def rename(s, h, a):
        p, f = s.path(a[0]); q, g = s.path(a[1]); s.rec("rename", p + " -> " + q, True)
        if not os.path.exists(f): return PATH_NOT_FOUND
        if os.path.exists(g): return ALREADY_EXISTS
        os.rename(f, g); return 0
    def open(s, h, a):
        p, f = s.path(a[1]); s.rec("open%d" % a[2], p, False)
        if not os.path.isfile(f): return PATH_NOT_FOUND
        k = s.next; s.next += 1; s.fh[k] = (f, a[2], p); h.wq(a[0], k); return 0
    def read(s, h, a):
        f, mode, p = s.fh[a[0]]; d = open(f, "rb").read()[a[1]:a[1] + a[3]]; h.mu.mem_write(a[2], d); return 0
    def write(s, h, a):
        f, mode, p = s.fh[a[0]]
        if not mode & 2: return FS_ERR
        s.rec("write", p, True)
        d = bytearray(open(f, "rb").read()); data = h.rd(a[2], a[3]); off = a[1]
        if off + len(data) > len(d):
            if not mode & 4: return FS_ERR
            d.extend(b"\0" * (off + len(data) - len(d)))
        d[off:off + len(data)] = data; open(f, "wb").write(bytes(d)); return 0
    def size(s, h, a):
        f, mode, p = s.fh[a[1]]; h.wq(a[0], os.path.getsize(f)); return 0
    def close(s, h, a): s.fh.pop(a[0], None); return 0
    def flush(s, h, a): s.rec("flush", s.fh.get(a[0], ("", 0, "?"))[2], True); return 0
    def entry(s, h, a):
        p, f = s.path(a[1]); s.rec("stat", p, False)
        if os.path.isdir(f): h.wi(a[0], 0); return 0
        if os.path.isfile(f): h.wi(a[0], 1); return 0
        return PATH_NOT_FOUND
    def files(s):
        out = {}
        for dp, dn, fn in os.walk(s.root):
            for n in fn: q = os.path.join(dp, n); out[os.path.relpath(q, s.root)] = open(q, "rb").read()
        return out
# ---------------------------------------------------------------- module
class Mod:
    def __init__(s, h, S, sd_src, cur_thread=True):
        f = ELFFile(open(ELF, "rb")); s.h = h; s.S = S; s.sym = {}
        top = max(p["p_vaddr"] + p["p_memsz"] for p in f.iter_segments() if p["p_type"] == "PT_LOAD")
        s.size = (top + 0xFFFF) & ~0xFFFF; h.mu.mem_map(MOD, s.size)
        for p in f.iter_segments():
            if p["p_type"] == "PT_LOAD": h.mu.mem_write(MOD + p["p_vaddr"], p.data())
        s.nrel = 0
        for r in f.get_section_by_name(".rela.dyn").iter_relocations():
            assert r["r_info_type"] == 1027, "only R_AARCH64_RELATIVE expected"
            h.wq(MOD + r["r_offset"], MOD + r["r_addend"]); s.nrel += 1
        for x in f.get_section_by_name(".symtab").iter_symbols():
            if x.name and x["st_value"]: s.sym.setdefault(x.name, x["st_value"])
        s.stubs = {}; s.nullcalls = collections.Counter(); s.breaks = []
        h.mu.hook_add(UC_HOOK_BLOCK, s._blk, begin=MOD, end=MOD + s.size - 1)
        h.mu.hook_add(UC_HOOK_CODE, s._null, begin=0, end=0xF)
        h.cstr = lambda a: bytes(h.mu.mem_read(a, 256)).split(b"\0")[0].decode()
        s.sd = FakeSD(h, sd_src); sd = s.sd
        s.tick = 0x1000
        def cur(hh, a):
            if s.S.cur == "main": return MAIN_OS
            return next((k for k, v in s.S.th.items() if v["name"] == s.S.cur), 0xdead0)
        def systick(hh, a): s.tick += 0x111; return s.tick
        names = {"_ZN2nn2fs11MountSdCardEPKc": sd.mount, "_ZN2nn2fs15CreateDirectoryEPKc": sd.mkdir,
                 "_ZN2nn2fs10CreateFileEPKcl": sd.create, "_ZN2nn2fs10DeleteFileEPKc": sd.delete,
                 "_ZN2nn2fs10RenameFileEPKcS2_": sd.rename, "_ZN2nn2fs8OpenFileEPNS0_10FileHandleEPKci": sd.open,
                 "_ZN2nn2fs8ReadFileENS0_10FileHandleElPvm": sd.read,
                 "_ZN2nn2fs9WriteFileENS0_10FileHandleElPKvmRKNS0_11WriteOptionE": sd.write,
                 "_ZN2nn2fs11GetFileSizeEPlNS0_10FileHandleE": sd.size, "_ZN2nn2fs9CloseFileENS0_10FileHandleE": sd.close,
                 "_ZN2nn2fs12GetEntryTypeEPNS0_18DirectoryEntryTypeEPKc": sd.entry,
                 "_ZN2nn2fs9FlushFileENS0_10FileHandleE": sd.flush, "_ZN2nn2os13GetSystemTickEv": systick}
        if cur_thread: names["_ZN2nn2os16GetCurrentThreadEv"] = cur
        s.fakes = {n: h.make_fake(n, fn) for n, fn in names.items()}
        s.lookups = collections.Counter()
        def lookup(uc):
            n = h.cstr(h.x(0)); s.lookups[n] += 1; return s.fakes.get(n, 0)
        s.stubs[s.a("_ZN2hk2ro12lookupSymbolEPKc")] = lookup
        def brk(uc):
            s.breaks.append((h.phase, s.S.cur)); uc.emu_stop(); return None
        s.stubs[s.a("_ZN2hk3svc5BreakENS0_11BreakReasonEPvm")] = brk
    def a(s, name): return MOD + s.sym[name]
    def g(s, name): return MOD + s.sym[N + name]
    def _blk(s, uc, addr, size, ud):
        if addr in s.stubs:
            v = s.stubs[addr](uc)
            if v is None: return
            uc.reg_write(UC_ARM64_REG_X0, v); uc.reg_write(UC_ARM64_REG_PC, uc.reg_read(UC_ARM64_REG_LR))
    def _null(s, uc, addr, size, ud):
        lr = uc.reg_read(UC_ARM64_REG_LR); s.nullcalls[hex(lr - MOD) if lr >= MOD else hex(lr)] += 1
        uc.reg_write(UC_ARM64_REG_X0, 0); uc.reg_write(UC_ARM64_REG_PC, lr)
    def install(s):
        h = s.h; buf = h.alloc(24 * 64)
        n = h.call(s.a("groove_hook_plan"), buf, 64); assert 0 < n <= 64
        s.plan = []
        for i in range(n):
            off, kind, to, bk = struct.unpack("<IIQQ", h.rd(buf + 24 * i, 24)); s.plan.append((off, kind, to, bk))
            if kind == 0 and not h.is_real(off):
                # unlisted game function: its original is a logged harness stub (never half a prologue)
                stub = h.make_fake("orig:%#x" % off)
                h.mu.mem_write(bk, struct.pack("<II", 0x58000050, 0xD61F0200) + struct.pack("<Q", stub) + b"\0" * 4)
            elif kind == 0:
                first = h.img[off:off + 4]
                h.mu.mem_write(bk, first + struct.pack("<II", 0x58000050, 0xD61F0200) + struct.pack("<Q", G + off + 4))
            if kind == 0:
                d = (to - (G + off)) >> 2; assert -(1 << 25) <= d < (1 << 25)
                h.mu.mem_write(G + off, struct.pack("<I", 0x14000000 | (d & 0x3FFFFFF)))
            if kind == 1:
                d = (to - (G + off)) >> 2; assert -(1 << 25) <= d < (1 << 25)
                h.mu.mem_write(G + off, struct.pack("<I", 0x94000000 | (d & 0x3FFFFFF)))
            if not h.is_real(off): h.add_real_range(off, off + 4)    # patched instr runs; orig continues as stub if unlisted
        h.mu.ctl_remove_cache(G, G + 0x1400000)                     # drop translations made before the patches
        h.wq(s.g("5gBaseE"), G)
        s.v0_bound = bool(h.call(s.a("groove_emu_activate")) & 1)
        return n
    def u8(s, name): return s.h.rb(s.g(name))
    def b2(s):
        a = s.g("3gB2E"); h = s.h
        return {"active": h.rb(a), "passed": h.rb(a + 1), "kind": h.rb(a + 2), "gen": h.rq(a + 8), "seq": h.rq(a + 16), "stage": h.rq(a + 24)}
    def branches(s): return [s.h.ri(s.g("9gB2BranchE") + 4 * i) for i in range(5)]
    def log(s):
        a = s.g("7gLogBufE"); n = s.h.ri(s.g("7gLogLenE")); return s.h.rd(a, n).decode(errors="replace")
    def sdlog(s):
        f = os.path.join(s.sd.root, "groove/log/ht3.log"); return open(f, errors="replace").read() if os.path.exists(f) else ""
# ---------------------------------------------------------------- scenario plumbing
GTL_DH = b"GTL1\nticks_per_beat 480\nbgm 64\nresults exit\nH 480 1\nC 960 tag_a\nH 1440 2\nA 480 Bg01\nS 960\nend 1920 480\nfinish 2400\n"
GTLM = b"GTLM 1\nstart 0\nresults exit\nX 0 RING 0x217960 -1\nX 480 RING 0x217960 -1\nX 960 RING 0x217960 -1\nend 1920 960\nfinish 3840\n"
def sd_tree(kind, v0=True):
    """GE-155-installed tree (levels + slots.json + engine.json) plus the legacy stage files the test needs."""
    d = tempfile.mkdtemp(prefix="b2src-"); shutil.copytree(SDSRC, d, dirs_exist_ok=True)
    if not v0:
        for x in ("groove/levels", "groove/slots.json"): p = os.path.join(d, x); shutil.rmtree(p) if os.path.isdir(p) else (os.path.exists(p) and os.remove(p))
    if kind == "HT2":
        os.makedirs(os.path.join(d, "groove/stages/doublehell"), exist_ok=True)
        open(os.path.join(d, "groove/stages/doublehell/doublehell.gtl"), "wb").write(GTL_DH)
        open(os.path.join(d, "groove/stages/doublehell/FORCE"), "wb").write(b"")
    if kind == "R21L":
        os.makedirs(os.path.join(d, "groove/stages/multi"), exist_ok=True)
        open(os.path.join(d, "groove/stages/multi/multi.gtl"), "wb").write(GTLM)
        open(os.path.join(d, "groove/stages/multi/FORCE"), "wb").write(b"")
    return d
class Env:
    def __init__(s, kind, v0=True, cur_thread=True, ret_scene=RET_SCENE):
        s.kind = kind
        h = s.h = E.mk("HT2" if kind == "HT2" else "R21"); S = s.S = Sched(h); h.phase = "build"
        s.code = X.install_code(h)
        h.appends = collections.Counter()
        h.pre[X.APPEND] = lambda hh, a: (hh.appends.update([hh.phase.split(":")[0]]), None)[1]
        s.m = Mod(h, S, sd_tree(kind, v0), cur_thread); h.m = s.m
        s.nplan = s.m.install()
        h.add_real(0x509570)                                       # setNextScene: real field writes
        h.add_real_range(CALL_SITE, CALL_SITE + 0x14)
        h.mu.mem_write(G + CALL_LR, struct.pack("<II", 0x58000050, 0xD61F0200) + struct.pack("<Q", RET))
        h.wi(G + 0xDAB880, ret_scene); h.wq(G + 0x10B5A98, 0)    # what the map registers at 0x1CE154 (0x130560)
        if not h.rq(h.MGR + 0x3AA0): s.flags = h.alloc(16); h.wq(h.MGR + 0x3AA0, s.flags)
        else: s.flags = h.rq(h.MGR + 0x3AA0)
        h.exits = []
        h.pre[0x130500] = lambda hh, a: (hh.exits.append((hh.phase, a[1])), None)[1]
        h.pre[0x138F80] = lambda hh, a: (hh.exits.append((hh.phase, "enablePause")), None)[1]
        h.pre[0x138D40] = lambda hh, a: (hh.exits.append((hh.phase, "toResults")), None)[1]
    def build(s):
        h, S = s.h, s.S; h.phase = "ctor"; f0 = h.ri(s.flags)
        b = E.build(h, S, "HT2" if s.kind == "HT2" else "R21", 0)  # Seq + Stage through the MODULE ctor hook
        h.wi(b["seq"] + 8, 0xE); h.wi(b["seq"] + 0x18, -1)
        b["kids0"] = E.all_threads(h, b["runner"]); b["flags0"] = f0
        return b
    def tick(s, b, n):
        h, S = s.h, s.S; h.phase = "tick"
        for _ in range(n):
            for th in E.all_threads(h, b["runner"]):
                if tstate(h, th) in (0, 1): S.call(X.STEP, th)
    def run_to_finish(s, b, run_sym, maxk=80):
        for k in range(maxk):
            s.tick(b, 1)
            fin = s.h.ri(s.m.g(run_sym) + 12) if run_sym == "4gRunE" else s.h.ri(s.m.g("5gMRunE.3"))
            if fin and all(tstate(s.h, t) != 1 for t in E.all_threads(s.h, b["runner"])): return k + 1
        return None
    def destroy(s, b, phase="b2", lr_site=CALL_SITE, mgr=None):
        """SceneMgr::update -> bl destroyPending at 0x50A05C (LR 0x50A060): compiled H-B2 + native teardown."""
        h, S, m = s.h, s.S, s.m; h.phase = phase; h.order.clear(); h.late.clear(); n0 = len(S.log); io0 = len(m.sd.ops)
        nbrk = len(m.breaks); r = {"returned": True}
        try: r["ret"] = S.call(lr_site, mgr or b["mgr"])
        except BudgetExhausted as e: r["returned"] = False; r["exc"] = str(e)[:120]
        r["safe_stop"] = len(m.breaks) > nbrk
        r["hang_intact"] = r["returned"] and r.get("ret") is None   # join never completes: cooperative DEADLOCK (rev3 §4: no timeout)
        r["stage_freed"] = b["stage"] in h.freed; r["seq_freed"] = b["seq"] in h.freed
        r["late_access"] = len(h.late)
        r["child_events_after_b2"] = sum(1 for e in S.log[n0:] if e[0] != "main" and e[1] not in ("exit",))
        r["io"] = [(p, o, q) for p, o, q in m.sd.ops[io0:]]
        r["global_list_has_stage"] = any(b["stage"] <= n < b["stage"] + b["size"] for n in E.list_nodes(h, h.gm + 8))
        r["threads"] = collections.Counter(tstate(h, t) for t in E.all_threads(h, b["runner"])) if not r["stage_freed"] else {}
        return r
def ok_teardown(r): return r["returned"] and not r["safe_stop"] and r["stage_freed"] and r["seq_freed"] and r["late_access"] == 0 and not r["global_list_has_stage"]
def stopped_intact(env, b, r): return r["safe_stop"] and not r["stage_freed"] and not r["seq_freed"]
R, F = [], []
def check(c, msg):
    if not c: F.append(msg)
    return c
ONLY = os.environ.get("B2INT_ONLY")
def case(tag, fn):
    if ONLY and not tag.startswith(ONLY): return {"error": "skipped", "tag": tag}
    # one forked process per case: every case owns a fresh Unicorn instance (memory is returned to the OS)
    rd, wr = os.pipe(); pid = os.fork()
    if pid == 0:
        os.close(rd)
        try: r = fn()
        except Exception as e: r = {"error": repr(e)[:300], "tb": traceback.format_exc()[-1500:]}
        os.write(wr, json.dumps(r, default=str).encode()); os._exit(0)
    os.close(wr); data = b""
    while True:
        chunk = os.read(rd, 1 << 16)
        if not chunk: break
        data += chunk
    os.close(rd); _, status = os.waitpid(pid, 0)
    r = json.loads(data) if data else {"error": "case process died (status %d)" % status}
    r["tag"] = tag; R.append(r)
    if "error" in r: F.append(tag + ": " + r["error"])
    return r
# ---------------------------------------------------------------- legacy custom stages (HT2 / R21 multi) - T10 through compiled H-B2
RUNSYM = {"HT2": "4gRunE", "R21L": "5gMRunE"}
def stage_ptr(env): return env.h.rq(env.m.g("9gHt3StageE") if env.kind == "HT2" else env.m.g("11gMultiStageE"))
def legacy_common(env, b, st):
    m = env.m; st["plan_hooks"] = env.nplan; st["b2_after_ctor"] = m.b2(); st["diverted"] = stage_ptr(env) == b["stage"]
    st["nullcalls"] = dict(m.nullcalls); st["unmapped"] = env.h.unmapped[:3]
def run_stats(env):
    a = env.m.g(RUNSYM[env.kind]) if env.kind == "HT2" else None
    if env.kind == "HT2": return {k: env.h.ri(a + 4 * i) for i, k in enumerate(("started", "gameplayStarted", "reachedEnd", "finished", "stopped"))}
    return {k: mrun_field(env, i) for i, k in enumerate(("started", "gameplayStarted", "reachedEnd", "finished", "stopped"))}
def mrun_field(env, i):
    return env.h.ri(env.m.g("5gMRunE.%d" % i))
def p_finish(kind):
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st)
    st["ticks"] = env.run_to_finish(b, RUNSYM[kind]); st["run"] = run_stats(env)
    st["exits"] = list(env.h.exits); st["seq_next"] = env.h.ri(b["seq"] + 0x18); st["flags_after"] = env.h.ri(env.flags)
    st["io_before_b2"] = len(env.m.sd.ops); st["teardown"] = env.destroy(b); st["b2_after"] = env.m.b2(); st["branches"] = env.m.branches()
    st["log_b2"] = [l for l in env.m.sdlog().splitlines() if "B2 " in l or "exit:" in l or "dtor" in l][-6:]
    return st
def p_abandon(kind, k):
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st)
    env.tick(b, k); st["run"] = run_stats(env); st["exits"] = list(env.h.exits)
    st["teardown"] = env.destroy(b); st["b2_after"] = env.m.b2(); return st
def p_retry(kind):
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st)
    env.tick(b, 3); st["A"] = env.destroy(b); st["gen_A"] = st["b2_after_ctor"]["gen"]
    b2 = env.build(); st["B_b2"] = env.m.b2(); st["B_diverted"] = stage_ptr(env) == b2["stage"]
    st["B_ticks"] = env.run_to_finish(b2, RUNSYM[kind]); st["B"] = env.destroy(b2); st["b2_after"] = env.m.b2(); return st
def p_stuck(kind):
    """bodies re-arm after cancel (wait sees state 1): barrier cannot reach a fixed point -> safe stop, nothing freed."""
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st)
    env.tick(b, 3); mt = set(t for t in E.all_threads(env.h, b["runner"]) if t not in b["kids0"]); st["module_threads"] = len(mt)
    def rearm(hh, a):
        if hh.phase.startswith("b2") and a[0] in mt: hh.wi(a[0] + 0x250, 1)
        return None
    env.h.pre[0x514D70] = rearm
    env.h.pre[0x514DD0] = lambda hh, a: 0 if hh.phase.startswith("b2") and a[0] in mt else None
    st["teardown"] = env.destroy(b); st["b2_after"] = env.m.b2(); return st
def p_identity(kind, what):
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st)
    env.tick(b, 3); before = collections.Counter(tstate(env.h, t) for t in E.all_threads(env.h, b["runner"]))
    if what == "back": env.h.wq(b["stage"] + 0x29D8, b["seq"] + 0x40)
    if what == "vptr": env.h.wq(b["seq"], G + 0xD2B730 + 0x100)
    if what == "runner": env.h.wq(b["stage"] + 0x2980, 0)
    if what == "cycle":
        ts = E.all_threads(env.h, b["runner"]); env.h.wq(ts[-1] + 8, ts[0])
    if what == "state": env.h.wi(E.all_threads(env.h, b["runner"])[0] + 0x250, 7)
    if what == "incoherent":
        t = next(t for t in E.all_threads(env.h, b["runner"]) if tstate(env.h, t) == 1); env.h.wq(t + 0x1F0, 0)
    r = st["teardown"] = env.destroy(b)
    st["threads_untouched"] = what in ("cycle", "state", "incoherent") or collections.Counter(tstate(env.h, t) for t in E.all_threads(env.h, b["runner"])) == before
    return st
def p_lr(kind):
    """H-B2 entry reached from a call site other than 0x50A05C (LR != 0x50A060) with our Seq current -> safe stop."""
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st); env.tick(b, 2)
    tramp = 0x7fff3000; env.h.mu.mem_write(tramp, struct.pack("<IIII", 0xA9BF7BFD, 0x94000000, 0xA8C17BFD, 0xD65F03C0))
    # bl from harness page cannot reach the image; use blr x16 to the patched entry instead
    code = [0xA9BF7BFD] + X.movx(16, G + 0x5096F0) + X.blr(16) + [0xA8C17BFD, 0xD65F03C0]
    env.h.mu.mem_write(tramp, b"".join(struct.pack("<I", w) for w in code))
    r = st["teardown"] = env.destroy(b, lr_site=tramp); return st
def p_foreign_nonext(kind):
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st); env.tick(b, 2)
    other = env.h.alloc(0x60); env.h.wq(other + 0x10, env.h.alloc(0x100)); env.h.wi(other + 0x18, -1)
    st["foreign"] = env.destroy(b, mgr=other); st["after_foreign"] = env.m.b2()
    env.h.wi(b["mgr"] + 0x18, -1); st["nonext"] = env.destroy(b); st["after_nonext"] = env.m.b2()
    env.h.wi(b["mgr"] + 0x18, 5); st["own"] = env.destroy(b); st["branches"] = env.m.branches(); return st
def p_trip(kind, where):
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st); env.tick(b, 2)
    env.h.phase = "trip"; nb = len(env.m.breaks)
    try:
        if where == "seq": env.S.call(0x2AB5F0, b["seq"])
        elif where == "stage": env.S.call(0x4291A0 if kind == "HT2" else 0x420C40, b["stage"])
        elif where == "thunk": env.S.call(0x4291D0 if kind == "HT2" else 0x420C70, b["stage"] + 0x2978)
        elif where == "mgr": env.S.call(0x509640, b["mgr"])
        st["returned"] = True
    except BudgetExhausted: st["returned"] = False
    st["safe_stop"] = len(env.m.breaks) > nb; st["stage_freed"] = b["stage"] in env.h.freed; st["seq_freed"] = b["seq"] in env.h.freed
    st["trips"] = env.h.ri(env.m.g("8gB2TripsE")); return st
def p_late_spawn(kind):
    """GE-151 spawn()/spawnR21() with a cancelled parent: no thread object, no append (rev3 §5.2)."""
    env = Env(kind, v0=False); b = env.build(); st = {}; legacy_common(env, b, st); env.tick(b, 2)
    th = E.all_threads(env.h, b["runner"])[0]; env.h.wi(th + 0x250, 2)
    fn = [v for k, v in env.m.sym.items() if k == N + ("5spawnEPvS0_PFvS0_S0_E" if kind == "HT2" else "8spawnR21EPvS0_PFvS0_S0_E")]
    st["spawn_sym"] = bool(fn); n0 = len(E.all_threads(env.h, b["runner"])); a0 = sum(env.h.appends.values())
    env.h.phase = "late"; env.S.call(MOD + fn[0], b["stage"], th, env.code["coop"])
    st["appended"] = sum(env.h.appends.values()) - a0; st["threads_delta"] = len(E.all_threads(env.h, b["runner"])) - n0
    env.h.wi(th + 0x250, 1); st["teardown"] = env.destroy(b); return st
def p_not_ready(kind):
    """GetCurrentThread unresolved: B2 not ready -> no custom session, stage stays native."""
    env = Env(kind, v0=False, cur_thread=False); b = env.build(); st = {}; legacy_common(env, b, st)
    env.tick(b, 2); st["teardown"] = env.destroy(b); return st
def p_no_return_scene(kind):
    env = Env(kind, v0=False, ret_scene=-1); b = env.build(); st = {}; legacy_common(env, b, st)
    st["ticks"] = env.run_to_finish(b, RUNSYM[kind]); st["exits"] = list(env.h.exits); st["seq_next"] = env.h.ri(b["seq"] + 0x18)
    st["teardown"] = env.destroy(b); return st
# ---------------------------------------------------------------- V0 Custom Remix A/B (installer layout) map flow
ON_CONFIRM, MAP_INIT, MAP_DTOR = 0x1D2CC0, 0x1CD9A0, 0x1CE200
SLOTS = {"A": (0, 9, 0), "B": (0, 9, 1)}
def v0_map(env):
    h = env.h; mp = h.alloc(0x8000)
    for o in (0x52D8, 0x52E0, 0x52F0, 0x2A30, 0x38C0, 0x29D8): h.wq(mp + o, h.alloc(0x400))
    bb = h.alloc(0x40); h.wq(mp + 0x6F88, bb + 0x18); h.wi(mp + 0x2A38, 0); return mp
def v0_state(env):
    m = env.m; ex = m.g("7gV0ExecE")
    return {"phase": env.h.ri(m.sym.get("dummy", 0) or ex + phase_off(env)), "v0Live": m.u8("7gV0LiveE"), "multiV0": m.u8("8gMultiV0E")}
_PH = {}
def phase_off(env):
    if "o" not in _PH:
        # Execution: Package snapshot, MultiTimeline, Record, Intent, 5 bools, 2 u64, StageToken, then `phase` (public).
        _PH["o"] = None
    return _PH["o"]
def v0_phase(env):
    return env.h.ri(env.m.a("groove_emu_v0_phase") if "groove_emu_v0_phase" in env.m.sym else 0)
def blob(env): return env.h.rd(env.h.MGR + 0x548, 0x1188)
def map_init(env, mp):
    env.h.phase = "mapInit"; env.h.call(MAP_INIT, mp, env.h.alloc(0x100), 0)
def confirm(env, mp, slot):
    h = env.h; w, c, r = SLOTS[slot] if slot in SLOTS else slot
    h.wi(mp + 0x5274, w); h.wi(mp + 0x5298, c); h.wi(mp + 0x529C, r)
    th = h.alloc(0x300); h.phase = "confirm"; launches = []
    h.pre[0x1D3134] = lambda hh, a: (launches.append(1), None)[1]   # native launch body ran (V0 did not reject)
    if not h.is_real(0x1D3134): h.add_real_range(0x1D3134, 0x1D3138)
    h.call(ON_CONFIRM, mp, th); h.pre.pop(0x1D3134, None)
    return launches
def map_back(env, mp):
    h = env.h; M = h.MGR
    h.phase = "mapDtor2"; map_init(env, mp)
    mode = 1 if h.ri(mp + 0x2A38) == 1 else 0
    outs = (mp + 0x5274, mp + 0x5298, mp + 0x529C, mp + 0x52A0); h.wi(mp + 0x52A0, 0x55)
    # getSel from its real call site in Map::init (bl 0x4860 at 0x1CE03C, LR 0x1CE040) so H6 sees the proven LR
    h.mu.mem_write(G + 0x1CE040, struct.pack("<II", 0x58000050, 0xD61F0200) + struct.pack("<Q", RET))
    if not h.is_real(0x1CE03C): h.add_real_range(0x1CE03C, 0x1CE050)
    h.mu.ctl_remove_cache(G + 0x1CE000, G + 0x1CE100)
    h.phase = "getSel"; h.call(0x1CE03C, M, mode, *outs); cur = tuple(h.ri(o) for o in outs)
    h.phase = "mapEnter"; h.call(0x1D38A0, mp); env.phase_after_return = h.call(env.m.a("groove_emu_v0_phase"))
    h.phase = "refresh"; h.call(0x1D3CA0, mp)
    h.phase = "writeSave"; h.call(0x3D60, M, 1)
    return cur
def v0_session(slot, mode, k=3):
    env = Env("R21", v0=True); h, m = env.h, env.m; st = {"slot": slot, "mode": mode, "v0_bound": m.v0_bound}
    files0 = m.sd.files(); blob0 = blob(env)
    mp = v0_map(env); map_init(env, mp)
    st["log_mapinit"] = [l for l in m.log().splitlines() if "v0:" in l][-2:]
    st["launches"] = len(confirm(env, mp, slot))
    h.phase = "mapDtor"; h.call(MAP_DTOR, mp)
    b = env.build(); st["b2_after_ctor"] = m.b2(); st["multiV0"] = m.u8("8gMultiV0E")
    st["diverted"] = h.rq(m.g("11gMultiStageE")) == b["stage"]
    if mode == "finish": st["ticks"] = env.run_to_finish(b, "5gMRunE")
    else: env.tick(b, k)
    st["mrun"] = {k2: mrun_field(env, i) for i, k2 in enumerate(("started", "gameplayStarted", "reachedEnd", "finished", "stopped"))}
    st["exits"] = list(h.exits); st["seq_next"] = h.ri(b["seq"] + 0x18); st["retry_flag"] = h.ri(env.flags) != b["flags0"]
    st["teardown"] = env.destroy(b); st["b2_after"] = m.b2()
    st["cursor"] = map_back(env, mp)
    st["v0_log"] = [l for l in (m.sdlog() + m.log()).splitlines() if "v0:" in l or "B2 barrier" in l or "exit:" in l][-8:]
    files1 = m.sd.files()
    st["sd_changed"] = sorted(k2 for k2 in set(files0) | set(files1) if files0.get(k2) != files1.get(k2) and not k2.startswith("groove/log/"))
    st["custom_saves"] = sorted(k2 for k2 in files1 if k2.startswith("groove/custom-saves"))
    st["blob_changed"] = [i for i, (x, y) in enumerate(zip(blob0, blob(env))) if x != y and not (0x560 - 0x548 <= i < 0x564 - 0x548)]
    st["v0_phase_after_map_return"] = env.phase_after_return   # 4 = Pending (H9 blocked: syncDirectory not accredited)
    st["faults"] = h.call(m.a("groove_v0_fault")); st["session_active"] = h.call(m.a("groove_v0_session_active")) & 1
    # second launch in the same boot (session Pending: syncDirectory not accredited) -> must not run custom again
    h.exits.clear(); st["second_launches"] = len(confirm(env, mp, "B" if slot == "A" else "A"))
    st["nullcalls"] = dict(m.nullcalls); st["unmapped"] = h.unmapped[:3]
    return st
# ---------------------------------------------------------------- run
for kind in ("HT2", "R21L"):
    r = case(kind + "/finish", lambda: p_finish(kind))
    if "error" not in r:
        check(r["diverted"] and r["b2_after_ctor"]["active"] == 1, r["tag"] + ": ctor hook did not open a B2 session")
        check(r["ticks"] is not None and r["run"]["finished"] == 1, r["tag"] + ": module did not reach finish")
        check(ok_teardown(r["teardown"]), r["tag"] + ": teardown not clean " + str(r["teardown"]))
        check(r["b2_after"]["active"] == 0, r["tag"] + ": session not closed")
        check((r["tag"], 1) in [(r["tag"], e[1]) for e in r["exits"] if e[1] == 1] and r["seq_next"] == RET_SCENE, r["tag"] + ": exit is not Quit-to-return-scene " + str(r["exits"]) + " next=%d" % r["seq_next"])
        check(r["flags_after"] == 0, r["tag"] + ": retry flag set by custom exit")
        check(not any(p.startswith("teardown") or ":" in p and "b2" not in p for p, o, q in r["teardown"]["io"] if o in ("write", "create", "rename", "delete")) and all(p == "b2" for p, o, q in r["teardown"]["io"]), r["tag"] + ": I/O outside the post-barrier window " + str(set(p for p, o, q in r["teardown"]["io"])))
    for k in (2, 3):
        r = case(kind + "/abandon@%d" % k, lambda: p_abandon(kind, k))
        if "error" not in r: check(ok_teardown(r["teardown"]) and r["b2_after"]["active"] == 0 and r["diverted"], r["tag"] + ": abandon not clean")
    r = case(kind + "/retry(A->B)", lambda: p_retry(kind))
    if "error" not in r:
        check(ok_teardown(r["A"]) and ok_teardown(r["B"]) and r["B_diverted"] and r["B_b2"]["gen"] == r["gen_A"] + 1, r["tag"] + ": retry/generation")
    r = case(kind + "/fail: stuck body", lambda: p_stuck(kind))
    if "error" not in r: check((r["teardown"]["safe_stop"] or r["teardown"]["hang_intact"]) and not r["teardown"]["stage_freed"] and not r["teardown"]["seq_freed"] and r["teardown"]["io"] == [] and r["b2_after"]["passed"] == 0, r["tag"] + ": stuck body not stopped with graph intact")
    for what in ("back", "vptr", "runner", "cycle", "state", "incoherent"):
        r = case(kind + "/fail: " + what, lambda: p_identity(kind, what))
        if "error" not in r: check(r["teardown"]["safe_stop"] and not r["teardown"]["stage_freed"] and not r["teardown"]["seq_freed"] and r["threads_untouched"], r["tag"] + ": not a non-returning safe stop " + str(r["teardown"]))
    r = case(kind + "/fail: LR", lambda: p_lr(kind))
    if "error" not in r: check(r["teardown"]["safe_stop"] and not r["teardown"]["stage_freed"], r["tag"] + ": LR guard")
    r = case(kind + "/decision: foreign + no-next", lambda: p_foreign_nonext(kind))
    if "error" not in r:
        check(not r["foreign"]["safe_stop"] and r["after_foreign"]["active"] == 1 and not r["nonext"]["safe_stop"] and r["after_nonext"]["active"] == 1 and ok_teardown(r["own"]), r["tag"] + ": decision table")
    for where in ("seq", "stage", "thunk", "mgr"):
        r = case(kind + "/tripwire: " + where, lambda: p_trip(kind, where))
        if "error" not in r: check(r["safe_stop"] and not r["stage_freed"] and not r["seq_freed"] and r["trips"] == 1, r["tag"] + ": tripwire")
    r = case(kind + "/late spawn after cancel", lambda: p_late_spawn(kind))
    if "error" not in r: check(r["spawn_sym"] and r["appended"] == 0 and r["threads_delta"] == 0 and ok_teardown(r["teardown"]), r["tag"] + ": late spawn")
    r = case(kind + "/B2 not ready -> native", lambda: p_not_ready(kind))
    if "error" not in r: check(not r["diverted"] and r["b2_after_ctor"]["active"] == 0 and ok_teardown(r["teardown"]), r["tag"] + ": native fallback")
    r = case(kind + "/exit without return scene", lambda: p_no_return_scene(kind))
    if "error" not in r: check(all(e[1] != 1 for e in r["exits"]) and any(e[1] == "enablePause" for e in r["exits"]) and ok_teardown(r["teardown"]), r["tag"] + ": no invented scene")
for slot in ("A", "B"):
    for mode in ("finish", "abandon"):
        r = case("V0/%s/%s" % (slot, mode), lambda: v0_session(slot, mode))
        if "error" not in r:
            t = r["tag"]
            check(r["v0_bound"], t + ": V0 backend not bound")
            check(r["launches"] == 1 and r["diverted"] and r["multiV0"] == 1 and r["b2_after_ctor"]["active"] == 1, t + ": custom stage not constructed through Execution/H-open")
            if mode == "finish": check(r["mrun"]["finished"] == 1 and any(e[1] == 1 for e in r["exits"]) and r["seq_next"] == RET_SCENE and not r["retry_flag"], t + ": finish/exit")
            check(ok_teardown(r["teardown"]) and r["b2_after"]["active"] == 0, t + ": teardown")
            check(tuple(r["cursor"][:3]) == SLOTS[slot], t + ": cursor not restored " + str(r["cursor"]))
            check(r["sd_changed"] == [] and r["custom_saves"] == [], t + ": SD mutated without accredited sync " + str(r["sd_changed"]))
            check(r["blob_changed"] == [], t + ": native save blob changed")
            check(r["session_active"] == 1 and r["second_launches"] == 0, t + ": second custom launch allowed while H9 Pending")
            check(r["v0_phase_after_map_return"] == 4, t + ": H9 not Pending after map return")
            check(r["faults"] == 0, t + ": V0 dispatcher faults %d" % r["faults"])
for r in R:
    print(r["tag"], "|", "ERROR " + r["error"] if "error" in r else "ok")
    if os.environ.get("B2INT_VERBOSE"): print(json.dumps({k: v for k, v in r.items() if k != "tb"}, default=str)[:3000]); print(r.get("tb", ""))
print("CASES:", len(R), "FAILURES:", len(F)); [print(" -", f) for f in F]
if OUT: json.dump({"results": R, "FAILURES": F}, open(OUT, "w"), indent=1, default=str)
sys.exit(1 if F else 0)
