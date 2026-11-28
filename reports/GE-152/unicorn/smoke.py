import sys; from common import *
h = setup(sys.argv[1])
print("unlisted during init:", {hex(k): v for k, v in h.unexpected.items()})
print("ptr 3AA0->", hex(h.rq(h.MGR+0x3AA0)-h.MGR), "3AC8->", hex(h.rq(h.MGR+0x3AC8)-h.MGR), "ver", hex(h.ri(h.MGR+0x558)))
d = desc(h,1,67); print("desc(1,67)=", hex(d-G), "kind/idx", h.ri(d), h.ri(d+4))
