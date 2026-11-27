"""GE-152 game-only Unicorn harness (main 03FF4A3B). Loads a LOCAL memory image given at runtime.
Contains only addresses/offsets; no game code or data. Real game code runs for whitelisted
functions; every other call is a logged harness stub."""
import struct, sys, collections
from unicorn import *
from unicorn.arm64_const import *

G = 0x20000000; GSIZE = 0x1400000
HEAP = 0x40000000; STK = 0x50000000; FAKE = 0x60000000; RET = 0x7ffffff0
TEXT_END = 0xA67000; PLT_LO = 0xA65000
MGR_OFF = 0x10A75F0

class H:
    def __init__(self, img_path, ips_cells=False):
        img = bytearray(open(img_path, "rb").read()[:GSIZE])
        self.img = bytes(img)
        for a in range(0xCC0000, 0xDC0000, 8):          # relocate base-0 pointers
            v = struct.unpack_from("<Q", img, a)[0]
            if 0x1000 <= v < 0x1300000: struct.pack_into("<Q", img, a, v + G)
        if ips_cells:                                   # prior IPS v0.3.9: world1 col9
            for r, (k, i) in enumerate([(1, 41), (1, 41), (1, 77), (1, 78), (1, 67)]):
                struct.pack_into("<ii", img, 0xAE07B8 + 1 * 0x1E0 + 9 * 0x28 + r * 8, k, i)
        mu = self.mu = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        mu.reg_write(UC_ARM64_REG_CPACR_EL1, 0x300000)
        mu.mem_map(G, GSIZE); mu.mem_write(G, bytes(img))
        mu.mem_map(HEAP, 0x2000000); mu.mem_map(STK, 0x100000); mu.mem_map(FAKE, 0x10000)
        mu.mem_map(0x7fff0000, 0x10000); mu.mem_write(RET, b"\x1f\x20\x03\xd5" * 4)
        mu.mem_write(FAKE, b"\xc0\x03\x5f\xd6" * 0x4000)
        self.heap = HEAP + 0x1000
        self.real = []            # (lo, hi) offsets of real game functions
        self.stubs = {}           # off -> handler(h) -> x0
        self.pre = {}             # off -> handler(h,args) -> None (run real) or x0 (skip)
        self.fake = {}            # FAKE addr -> (name, handler)
        self.calls = []           # (phase, kind, off/name, args, lr)
        self.writes = []          # (phase, pc_off, addr, size, value)
        self.phase = "init"
        self.watch = []           # (lo, hi, label)
        self.unexpected = collections.Counter()
        mu.hook_add(UC_HOOK_BLOCK, self._on_block, begin=G, end=G + TEXT_END)
        mu.hook_add(UC_HOOK_CODE, self._on_fake, begin=FAKE, end=FAKE + 0xffff)
        mu.hook_add(UC_HOOK_MEM_WRITE, self._on_write)
        mu.hook_add(UC_HOOK_MEM_READ, self._on_read)
        self.poison = []          # (lo, hi, label): reads/writes reported as late access
        self.late = []
        self.MGR = G + MGR_OFF
    # ---------------- memory helpers
    def alloc(self, n, fill=0):
        p = self.heap; self.heap += (n + 0x3f) & ~0x3f
        self.mu.mem_write(p, bytes([fill]) * n); return p
    def rq(self, a): return struct.unpack("<Q", self.mu.mem_read(a, 8))[0]
    def rd(self, a, n): return bytes(self.mu.mem_read(a, n))
    def ri(self, a): return struct.unpack("<i", self.mu.mem_read(a, 4))[0]
    def rh(self, a): return struct.unpack("<h", self.mu.mem_read(a, 2))[0]
    def rb(self, a): return self.mu.mem_read(a, 1)[0]
    def wq(self, a, v): self.mu.mem_write(a, struct.pack("<Q", v & (2**64 - 1)))
    def wi(self, a, v): self.mu.mem_write(a, struct.pack("<i", v))
    def wh(self, a, v): self.mu.mem_write(a, struct.pack("<h", v))
    def wb(self, a, v): self.mu.mem_write(a, bytes([v & 0xff]))
    def x(self, n): return self.mu.reg_read(UC_ARM64_REG_X0 + n) if n < 29 else None
    # ---------------- code control
    def add_real(self, *starts):
        for s in starts:
            e = s
            while struct.unpack_from("<I", self.img, e)[0] != 0 and e < TEXT_END: e += 4
            self.real.append((s, e))
    def add_real_range(self, lo, hi): self.real.append((lo, hi))
    def is_real(self, off): return any(a <= off < b for a, b in self.real)
    def make_fake(self, name, handler=None):
        a = FAKE + 4 * len(self.fake); self.fake[a] = (name, handler); return a
    def _ret(self, v):
        self.mu.reg_write(UC_ARM64_REG_X0, v & (2**64 - 1))
        self.mu.reg_write(UC_ARM64_REG_PC, self.mu.reg_read(UC_ARM64_REG_LR))
    def _args(self): return [self.mu.reg_read(r) for r in (UC_ARM64_REG_X0, UC_ARM64_REG_X1, UC_ARM64_REG_X2, UC_ARM64_REG_X3, UC_ARM64_REG_X4, UC_ARM64_REG_X5)]
    def _on_block(self, uc, addr, size, ud):
        off = addr - G
        if off in self.pre:
            a = self._args(); lr = uc.reg_read(UC_ARM64_REG_LR) - G
            r = self.pre[off](self, a)
            if r is not None:
                self.calls.append((self.phase, "pre-skip", off, a, lr)); self._ret(r); return
            self.calls.append((self.phase, "pre-pass", off, a, lr))
        if off in self.stubs:
            a = self._args(); lr = uc.reg_read(UC_ARM64_REG_LR) - G
            self.calls.append((self.phase, "stub", off, a, lr))
            self._ret(self.stubs[off](self) or 0); return
        if self.is_real(off): return
        a = self._args(); lr = uc.reg_read(UC_ARM64_REG_LR) - G
        if off >= PLT_LO:
            v = self._plt(off, a)
            self.calls.append((self.phase, "plt", off, a, lr)); self._ret(v); return
        self.unexpected[off] += 1
        self.calls.append((self.phase, "unlisted", off, a, lr)); self._ret(0)
    def _plt(self, off, a):
        if off == 0xA65C70:   # memcpy (writeSave, verified by use)
            self.mu.mem_write(a[0], bytes(self.mu.mem_read(a[1], a[2]))); return a[0]
        if off == 0xA65D30:   # memmove
            self.mu.mem_write(a[0], bytes(self.mu.mem_read(a[1], a[2]))); return a[0]
        if off == 0xA65C50:   # memset
            self.mu.mem_write(a[0], bytes([a[1] & 0xff]) * a[2]); return a[0]
        return 0
    def _on_fake(self, uc, addr, size, ud):
        name, h = self.fake.get(addr, ("?", None))
        a = self._args(); lr = uc.reg_read(UC_ARM64_REG_LR) - G
        self.calls.append((self.phase, "fake", name, a, lr))
        self._ret((h(self, a) if h else 0) or 0)
    def _on_write(self, uc, access, addr, size, value, ud):
        for lo, hi, lbl in self.watch:
            if lo <= addr < hi:
                self.writes.append((self.phase, uc.reg_read(UC_ARM64_REG_PC) - G, addr, size, value, lbl)); break
        for lo, hi, lbl in self.poison:
            if lo <= addr < hi: self.late.append((self.phase, "W", uc.reg_read(UC_ARM64_REG_PC) - G, addr - lo, lbl))
    def _on_read(self, uc, access, addr, size, value, ud):
        for lo, hi, lbl in self.poison:
            if lo <= addr < hi: self.late.append((self.phase, "R", uc.reg_read(UC_ARM64_REG_PC) - G, addr - lo, lbl))
    def call(self, off_or_addr, *args, count=5_000_000):
        fn = off_or_addr if off_or_addr >= G else G + off_or_addr
        for r in range(8): self.mu.reg_write(UC_ARM64_REG_X0 + r, 0)
        for r, v in enumerate(args): self.mu.reg_write(UC_ARM64_REG_X0 + r, v & (2**64 - 1))
        self.mu.reg_write(UC_ARM64_REG_SP, STK + 0xF0000); self.mu.reg_write(UC_ARM64_REG_LR, RET)
        self.mu.emu_start(fn, RET, count=count)
        return self.mu.reg_read(UC_ARM64_REG_X0)
