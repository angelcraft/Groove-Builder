"""Static reachability of 0x2CC0/0x2E90 (curIdx=-1 consumer) from the custom hosts. Reads the LOCAL image given in argv.
Direct BL/B call graph only (indirect blr not followed). Addresses only."""
import sys, struct, json
D = open(sys.argv[1], "rb").read(); TEXT_END = 0xA67000
u32 = lambda a: struct.unpack_from("<I", D, a)[0]; u64 = lambda a: struct.unpack_from("<Q", D, a)[0]
def bl_target(a):
    w = u32(a)
    if (w >> 26) not in (0x25, 0x05): return None
    imm = w & 0x3ffffff
    if imm & 0x2000000: imm -= 0x4000000
    return a + imm * 4
def callers(t): return [a for a in range(0, TEXT_END, 4) if bl_target(a) == t]
def body(f):
    a = f
    while a < TEXT_END and u32(a) != 0 and a - f < 0x20000: yield a; a += 4
def closure(roots):
    seen = {}; st = [(r, None) for r in roots]
    while st:
        f, p = st.pop()
        if f in seen: continue
        seen[f] = p
        for a in body(f):
            t = bl_target(a)
            if t is not None and t < 0xA65000 and t not in seen: st.append((t, f))
    return seen
T = {0x2CC0: "0x2CC0", 0x2E90: "0x2E90", 0x2068D0: "X::vt[37] 0x2068D0", 0x2064A0: "X ctor 0x2064A0", 0x398C80: "factory[16] ctor", 0x488940: "stage factory"}
out = {"callers_0x2CC0": [hex(a) for a in callers(0x2CC0)], "callers_X_ctor": [hex(a) for a in callers(0x2064A0)],
       "callers_factory16_ctor": [hex(a) for a in callers(0x398C80)], "X_vtable_slot_0xD1FF80": hex(u64(0xD1FF80)),
       "X_vtable_slot_0xD1FFB8": hex(u64(0xD1FFB8)), "X_offset_to_top_0xD1FFA0": hex(u64(0xD1FFA0))}
tbl = 0xAE45EC; fac = {}
for i in range(0xA2):
    a = 0x488998 + struct.unpack_from("<H", D, tbl + 2 * i)[0] * 4
    for k in range(40):
        t = bl_target(a + 4 * k)
        if t is not None and t != 0x4E02F0:
            if t in (0x398C80, 0x428D70, 0x4202C0): fac[i] = hex(t)
            break
out["factory_cases"] = fac
for name, roots in (("R21 host (ctor/worker/dtor)", [0x4202C0, 0x420720, 0x4207F0]), ("HT2 host", [0x428D70, 0x428EF0, 0x4290F0]),
                    ("map confirm/launch/return", [0x1D2CC0, 0x1D3130, 0x1D38A0])):
    s = closure(roots); out[name] = {"functions_in_closure": len(s), "reaches": [T[t] for t in T if t in s]}
json.dump(out, open(sys.argv[2], "w"), indent=1); print(json.dumps(out, indent=1))
