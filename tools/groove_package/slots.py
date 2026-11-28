"""slots.json registry — DRAFT format groove-slots/1 (not frozen; see FORMAT_QUESTIONS.md).

{
  "format": "groove-slots/1",
  "capacity": 2,                # 1..256; grows only by explicit migration
  "generation": 0,              # +1 on every committed change
  "slots": [
    {"index": 0, "coord": [0, 9, 0], "id": null},   # A
    {"index": 1, "coord": [0, 9, 1], "id": null}    # B
  ]
}
Slots >= 2 must have coord null (no verified menu cell yet) and cannot be assigned.
Packages never choose slots; only the user/installer does.
"""
import json

from . import limits
from .errors import InstallError
from .manifest import ID_RE
from .safepath import is_dos_device

FORMAT = "groove-slots/1"
KNOWN_COORDS = {0: [0, 9, 0], 1: [0, 9, 1]}
MAX_SLOTS_BYTES = 64 * 1024


def default_registry(capacity=limits.INITIAL_SLOTS):
    return {"format": FORMAT, "capacity": capacity, "generation": 0,
            "slots": [{"index": i, "coord": KNOWN_COORDS.get(i), "id": None} for i in range(capacity)]}


def _bad(msg):
    raise InstallError("SLOTS_CORRUPT", f"slots.json: {msg}")


def _pairs(pairs):
    d = {}
    for k, v in pairs:
        if k in d:
            _bad(f"duplicate key {k!r}")
        d[k] = v
    return d


def parse(raw: bytes):
    if len(raw) > MAX_SLOTS_BYTES:
        _bad("too large")
    try:
        obj = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs)
    except InstallError:
        raise
    except (ValueError, UnicodeDecodeError) as e:
        _bad(f"invalid JSON ({e})")
    if isinstance(obj, list):
        raise InstallError("SLOTS_LEGACY", "slots.json is the GE-152 harness list form; migrate explicitly "
                                           "(groove_package init-slots --reset-corrupt keeps a backup)")
    validate(obj)
    return obj


def validate(obj):
    if not isinstance(obj, dict) or set(obj) != {"format", "capacity", "generation", "slots"}:
        _bad("keys must be exactly format, capacity, generation, slots")
    if obj["format"] != FORMAT:
        _bad(f"unsupported format {obj['format']!r}")
    cap = obj["capacity"]
    if type(cap) is not int or not (1 <= cap <= limits.MAX_SLOTS):
        _bad(f"capacity must be 1..{limits.MAX_SLOTS}")
    gen = obj["generation"]
    if type(gen) is not int or not (0 <= gen <= 0x7FFFFFFF):
        _bad("generation out of range")
    sl = obj["slots"]
    if not isinstance(sl, list) or len(sl) != cap:
        _bad("slots length must equal capacity")
    seen = set()
    for i, s in enumerate(sl):
        if not isinstance(s, dict) or set(s) != {"index", "coord", "id"}:
            _bad(f"slot {i}: keys must be exactly index, coord, id")
        if s["index"] != i or type(s["index"]) is not int:
            _bad(f"slot {i}: index must be {i}")
        if s["coord"] != KNOWN_COORDS.get(i):
            _bad(f"slot {i}: coord must be {KNOWN_COORDS.get(i)} (only A/B are verified menu cells)")
        sid = s["id"]
        if sid is not None:
            if not isinstance(sid, str) or not ID_RE.match(sid) or not (limits.ID_MIN <= len(sid) <= limits.ID_MAX) \
                    or is_dos_device(sid):
                _bad(f"slot {i}: invalid id")
            if sid in seen:
                _bad(f"slot {i}: id {sid} assigned twice")
            seen.add(sid)
    return obj


def dumps(obj) -> bytes:
    validate(obj)
    return (json.dumps(obj, indent=2, ensure_ascii=True) + "\n").encode("ascii")


def slot_of(obj, pid):
    for s in obj["slots"]:
        if s["id"] == pid:
            return s["index"]
    return None


def assignable(obj, idx):
    return 0 <= idx < obj["capacity"] and obj["slots"][idx]["coord"] is not None


def with_assignment(obj, idx, pid):
    new = json.loads(json.dumps(obj))
    if not assignable(new, idx):
        raise InstallError("SLOT_NOT_ASSIGNABLE", f"slot {idx} has no verified menu cell")
    cur = new["slots"][idx]["id"]
    if cur is not None and cur != pid:
        raise InstallError("SLOT_OCCUPIED", f"slot {idx} is used by {cur}")
    other = slot_of(new, pid)
    if other is not None and other != idx:
        raise InstallError("SLOT_ALREADY_ASSIGNED", f"{pid} is already in slot {other}")
    new["slots"][idx]["id"] = pid
    new["generation"] += 1
    return new


def without(obj, pid):
    new = json.loads(json.dumps(obj))
    for s in new["slots"]:
        if s["id"] == pid:
            s["id"] = None
    new["generation"] += 1
    return new


def first_free(obj):
    for s in obj["slots"]:
        if s["id"] is None and s["coord"] is not None:
            return s["index"]
    return None


def grow(obj, capacity):
    """Explicit capacity migration (future, up to 256). New slots are unassignable until mapped."""
    if not (obj["capacity"] <= capacity <= limits.MAX_SLOTS):
        raise InstallError("SLOTS_CAPACITY", f"capacity must be {obj['capacity']}..{limits.MAX_SLOTS}")
    new = json.loads(json.dumps(obj))
    for i in range(new["capacity"], capacity):
        new["slots"].append({"index": i, "coord": KNOWN_COORDS.get(i), "id": None})
    new["capacity"] = capacity
    new["generation"] += 1
    return new
