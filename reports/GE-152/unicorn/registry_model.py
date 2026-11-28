"""Harness-level model (Python) of the proposed GE-152 two-slot registry and the 160-byte .gsv PROPOSAL (not a frozen contract).
Synthetic packages only; no game data."""
import json, os, re, struct, zlib
ENGINE = (0, 6, 0)
CAPS = {"timeline.gtf", "timeline.gtlm", "timeline.gtl1"}
FMT = {"multi": {"gtf", "gtlm"}, "hoop": {"gtl1"}}
def ver(s):
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", s or ""); return tuple(map(int, m.groups())) if m else None
def load_slot(root, sid):
    d = os.path.join(root, "levels", sid); mp = os.path.join(d, "manifest.json")
    if not os.path.isfile(mp): return {"enabled": False, "reason": "manifest missing"}
    if os.path.getsize(mp) > 16384: return {"enabled": False, "reason": "manifest > 16 KiB"}
    try: m = json.load(open(mp, encoding="utf-8"))
    except Exception: return {"enabled": False, "reason": "manifest JSON corrupt"}
    if m.get("format") != "groove-package/1": return {"enabled": False, "reason": "format"}
    i = m.get("id", "")
    if not re.fullmatch(r"[a-z0-9.-]{3,96}", i) or ".." in i: return {"enabled": False, "reason": "id syntax"}
    if i != sid: return {"enabled": False, "reason": "id != folder"}
    if ver(m.get("version")) is None: return {"enabled": False, "reason": "version"}
    em = ver(m.get("engine_min"))
    if em is None or em > ENGINE: return {"enabled": False, "reason": "engine_min > engine"}
    tl = m.get("timeline") or {}
    if m.get("adapter") not in FMT or tl.get("format") not in FMT[m["adapter"]]: return {"enabled": False, "reason": "adapter/format"}
    if not set(m.get("required_capabilities", [])) <= CAPS: return {"enabled": False, "reason": "capabilities"}
    if m.get("results") != "custom": return {"enabled": False, "reason": "results"}
    t = os.path.join(d, tl.get("path", ""))
    if not tl.get("path") or "/" in tl["path"] or not os.path.isfile(t): return {"enabled": False, "reason": "timeline missing"}
    n = os.path.getsize(t)
    if n == 0 or n > 61440: return {"enabled": False, "reason": "timeline size %d" % n}
    if len(m.get("title", "").encode()) > 95: return {"enabled": False, "reason": "title > 95 B"}
    return {"enabled": True, "id": i, "title": m["title"], "adapter": m["adapter"]}
def load_registry(root):
    p = os.path.join(root, "slots.json")
    try: ids = json.load(open(p))
    except Exception: return [{"enabled": False, "reason": "slots.json missing/corrupt"}] * 2
    ids = (ids + [None, None])[:2]; out, seen = [], set()
    for sid in ids:
        if not isinstance(sid, str): out.append({"enabled": False, "reason": "empty"}); continue
        if sid in seen: out.append({"enabled": False, "reason": "duplicate id"}); continue
        seen.add(sid); out.append(load_slot(root, sid))
    return out
# ---- .gsv proposal (160 B, LE) ----
GSV = struct.Struct("<4sHHII100sBBBBIIIII20s")
assert GSV.size == 160
FIELDS = ("state", "bestRank", "perfect", "flags", "plays", "clears", "bestScore", "lastScore", "lastRank")
def gsv_pack(rec):
    body = GSV.pack(b"GSV1", 1, 160, 0, rec["seq"], rec["id"].encode().ljust(100, b"\0"), *(rec[f] for f in FIELDS), b"\0" * 20)
    crc = zlib.crc32(body[12:]) & 0xffffffff
    return body[:8] + struct.pack("<I", crc) + body[12:]
def gsv_unpack(b, want_id):
    if len(b) != 160: return None, "size"
    t = GSV.unpack(b)
    if t[0] != b"GSV1" or t[1] != 1 or t[2] != 160: return None, "magic/version"
    if zlib.crc32(b[12:]) & 0xffffffff != t[3]: return None, "crc"
    i = t[5].rstrip(b"\0").decode("utf-8", "replace")
    if i != want_id: return None, "id mismatch"
    return dict(zip(("seq", "id") + FIELDS, (t[4], i) + t[6:15])), "ok"
def gsv_default(i): return dict(seq=0, id=i, state=2, bestRank=0, perfect=0, flags=0, plays=0, clears=0, bestScore=0, lastScore=0, lastRank=0)
def gsv_load(root, i):
    for suf in (".gsv", ".gsv.bak"):
        p = os.path.join(root, "custom-saves", i + suf)
        if os.path.isfile(p):
            r, why = gsv_unpack(open(p, "rb").read(), i)
            if r: return r, suf
    return gsv_default(i), "default"
def gsv_write(root, rec):
    d = os.path.join(root, "custom-saves"); os.makedirs(d, exist_ok=True)
    p = os.path.join(d, rec["id"] + ".gsv"); rec = dict(rec, seq=rec["seq"] + 1)
    open(p + ".tmp", "wb").write(gsv_pack(rec))
    if os.path.exists(p): os.replace(p, p + ".bak")
    os.replace(p + ".tmp", p); return rec
def finish(rec, completed, rank, score):
    r = dict(rec); r["plays"] += 1; r["lastScore"], r["lastRank"] = score, rank
    if completed: r["clears"] += 1; r["state"] = max(r["state"], 3)
    if rank > r["bestRank"]: r["bestRank"] = rank
    r["bestScore"] = max(r["bestScore"], score); return r
