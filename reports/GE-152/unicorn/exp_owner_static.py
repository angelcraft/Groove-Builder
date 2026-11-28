"""GE-152 / Stage owner: static cross-references in main 03FF4A3B (local image by argument, never published).
Prints and asserts only addresses/offsets. Requires capstone 5."""
import sys, struct, json, capstone
IMG = open(sys.argv[1], "rb").read(); OUT = sys.argv[2] if len(sys.argv) > 2 else None
TEXT_END = 0xA67000
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
W = struct.unpack_from("<%dI" % (TEXT_END // 4), IMG, 0)
def q(a): return struct.unpack_from("<Q", IMG, a)[0]
def bl_to(t, link=None):
    r = []
    for i, w in enumerate(W):
        op = w >> 26
        if op in (0x25, 0x05):
            imm = w & 0x3ffffff; imm -= (imm & 0x2000000) << 1
            if i * 4 + imm * 4 == t and (link is None or (op == 0x25) == link): r.append(i * 4)
    return r
def ptrs_to(v, lo=0xA67000, hi=0x1300000):
    b = struct.pack("<Q", v); r = []; s = lo
    while (k := IMG.find(b, s, hi)) >= 0:
        if k % 8 == 0: r.append(k)
        s = k + 1
    return r
def ins(a, n): return [(i.address, i.mnemonic, i.op_str) for i in md.disasm(IMG[a:a + 4 * n], a)]
def a078_refs():
    hits = []
    for i, w in enumerate(W):
        if (w & 0xfffffc00) == 0x91402800:                       # add xK, xM, #0xa, lsl #12
            K = w & 31
            for j in range(i + 1, min(i + 80, len(W))):
                w2 = W[j]
                if (w2 & 0xffc00000) in (0xf9400000, 0xf9000000) and ((w2 >> 5) & 31) == K and ((w2 >> 10) & 0xfff) == 0xF:
                    hits.append((hex(j * 4), "ldr" if w2 & 0x400000 else "str"))
        if (w & 0x7fffffe0) == (0x52800000 | (0xA078 << 5)): hits.append((hex(i * 4), "mov #0xa078"))
    return hits
R, F = {}, []
def check(c, m):
    if not c: F.append(m)
R["factory_0x488940_callers"] = [hex(a) for a in bl_to(0x488940)]
check(R["factory_0x488940_callers"] == ["0x2ab4a4", "0x2ab8f0", "0x2abd50", "0x2ac1b0", "0x2ac604"], "factory callers")
R["ht2_ctor_callers"] = [hex(a) for a in bl_to(0x428D70)]; R["r21_ctor_callers"] = [hex(a) for a in bl_to(0x4202C0)]
check(R["ht2_ctor_callers"] == ["0x489898"] and R["r21_ctor_callers"] == ["0x48902c"], "host ctors only from factory")
R["seq_A078_refs"] = a078_refs()
R["stage_vptr"] = {"HT2": hex(q(0xD9C748) + 0x10), "R21_deleting_slot_ptr": [hex(x) for x in ptrs_to(0x420C40)], "HT2_deleting_slot_ptr": [hex(x) for x in ptrs_to(0x4291A0)]}
check(q(0xD9C748) + 0x10 + 0x10 == 0xD4D268 and q(0xD4D268) == 0x4291A0 and q(0xD4CC20) == 0x420C40, "deleting slot vt+0x10")
def has(a, n, mn, sub): return any(x[1] == mn and sub in x[2] for x in ins(a, n))
check(has(0x4291A0, 10, "bl", "#0x4290f0") and has(0x4291A0, 10, "mov", "#0x7ad0") and has(0x4291A0, 10, "b", "#0x4e04e0"), "HT2 deleting = dtor + free(0x7AD0)")
check(has(0x420C40, 10, "bl", "#0x4207f0") and has(0x420C40, 10, "mov", "#0xe550") and has(0x420C40, 10, "b", "#0x4e04e0"), "R21 deleting = dtor + free(0xE550)")
check(has(0x2AB510, 22, "ldr", "#0x78]") and has(0x2AB510, 22, "str", "xzr, [x9, #0x78]") and has(0x2AB510, 22, "ldr", "#0x10]") and has(0x2AB510, 22, "blr", "x9") and has(0x2AB510, 22, "b", "#0x130080"), "Seq dtor: load+clear +0xA078, stage vt+0x10, then base dtor")
check(has(0x2AB5F0, 10, "bl", "#0x2ab4d0") and has(0x2AB5F0, 10, "mov", "#0xa080"), "Seq deleting = dtor + free(0xA080)")
check(has(0x5096F0, 19, "ldr", "[x0, #0x10]") and has(0x5096F0, 19, "ldr", "#0x18]") and has(0x5096F0, 19, "ldr", "[x8, #8]") and has(0x5096F0, 19, "str", "xzr, [x19, #0x10]"), "SceneMgr destroyPending: cur->vt+8 then cur=0")
R["destroy_callers"] = [hex(a) for a in bl_to(0x5096F0)]; R["create_next_callers"] = [hex(a) for a in bl_to(0x509740)]
check(R["destroy_callers"] == ["0x50a05c"] and R["create_next_callers"] == ["0x50a090"], "app frame order")
R["runner_dtor_0x515040_callers"] = [hex(a) for a in bl_to(0x515040)]
check("0x12849c" in R["runner_dtor_0x515040_callers"], "runner dtor from base@+0x30")
R["base30_dtor_from_seq_base"] = [hex(a) for a in bl_to(0x1283A0)]
R["secondary_deleting_thunks"] = {hex(t): [hex(x) for x in ptrs_to(t)] for t in (0x4291D0, 0x429200, 0x429230, 0x429260, 0x420C70, 0x420CA0, 0x420CD0, 0x420D00)}
check(not any(x[1] in ("bl", "blr") for x in ins(0x5153A0, 10)[:9]), "append has no lock call")
check(has(0x514EC4, 6, "add", "#0x220") and has(0x514EC4, 6, "b", "#0x4dfc80"), "step: resume child then wait main event")
check(has(0x514DA8, 6, "bl", "#0x4dfc70") and has(0x514DA8, 6, "b", "#0x4dfc80"), "child wait: resume main then wait child event")
R["r21_spawn_site"] = [hex(a) for a in bl_to(0x421340)]
R["FAILURES"] = F
print(json.dumps({k: v for k, v in R.items() if k in ("factory_0x488940_callers", "seq_A078_refs", "destroy_callers", "FAILURES")}, indent=1))
if OUT: json.dump(R, open(OUT, "w"), indent=1)
sys.exit(1 if F else 0)
