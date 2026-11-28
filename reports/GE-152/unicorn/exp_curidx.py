"""curIdx=-1 consumers: 0x2E90 (from 0x2067B0 via 0x2CC0) and 0x4980/0x4970 getters."""
import sys, json; from common import *
h = setup(sys.argv[1]); M = h.MGR
h.add_real(0x2E90, 0x2CC0)
res = {}
fake_res = h.alloc(0x1000)
for i in range(0x100): h.wq(fake_res + 0x498 + 8 * i, 0xA0000000 + i)   # tag: resource slot i
h.stubs[0x2B50] = lambda h: fake_res
h.stubs[0x4EFF20] = lambda h: 0
for idx in (67, 41, -1):
    h.calls.clear(); h.phase = "idx%d" % idx
    r = h.call(0x2E90, 1, idx)
    d = h.call(0x1CBC60, idx)
    res[idx] = {"desc_addr": hex(d - G), "desc+0x18": h.ri(d + 0x18), "returned": hex(r), "slot": (r - 0xA0000000) if r >= 0xA0000000 else None}
for m in (0, 1):
    h.wi(M + 0x2904, m); res["0x4980 mode%d curIdx=-1" % m] = h.call(0x4980, M)
h.wi(M + 0x2904, -1); res["0x4980 mode=-1"] = h.call(0x4980, M)
json.dump(res, open(sys.argv[2], "w"), indent=1); print(json.dumps(res, indent=1))
