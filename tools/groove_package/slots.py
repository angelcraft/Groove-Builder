"""slots.json registry — groove-slots/1 (GE-154 Draft 0.3 decision A; V0 implementation, not final freeze).

{"format": "groove-slots/1", "capacity": 2, "generation": 0,
 "slots": [{"index": 0, "coord": [0, 9, 0], "id": null},
           {"index": 1, "coord": [0, 9, 1], "id": null}]}

capacity 2..256 (grow explicitly, never shrink); index 0/1 have fixed coords;
index >= 2 must have coord null AND id null until a verified mapping contract.
generation 0..2147483647, +1 exactly once per effective change, never wraps.
The installer is the only writer.
"""
import json

from . import jsonstrict, limits
from .errors import InstallError
from .manifest import valid_id_syntax

FORMAT = "groove-slots/1"
KNOWN_COORDS = {0: [0, 9, 0], 1: [0, 9, 1]}
MAX_SLOTS_BYTES = limits.MAX_SLOTS_JSON


def default_registry(capacity=limits.INITIAL_SLOTS):
    return {"format": FORMAT, "capacity": capacity, "generation": 0,
            "slots": [{"index": i, "coord": KNOWN_COORDS.get(i), "id": None} for i in range(capacity)]}


def _bad(msg):
    raise InstallError("SLOTS_CORRUPT", f"slots.json: {msg}")


def _jerr(kind, msg):
    return InstallError("SLOTS_CORRUPT", f"slots.json: {msg}")


def parse(raw: bytes):
    obj = jsonstrict.loads(raw, MAX_SLOTS_BYTES, _jerr, 4)
    if isinstance(obj, list):
        raise InstallError("SLOTS_LEGACY", "slots.json is the GE-152 harness list form; no silent migration "
                                           "(init-slots --reset-corrupt keeps a backup and starts empty)")
    validate(obj)
    return obj


def _coord_ok(c, expected):
    if expected is None:
        return c is None
    return isinstance(c, list) and len(c) == 3 and all(jsonstrict.is_int(x) for x in c) and c == expected


def validate(obj):
    if not isinstance(obj, dict) or set(obj) != {"format", "capacity", "generation", "slots"}:
        _bad("keys must be exactly format, capacity, generation, slots")
    if obj["format"] != FORMAT:
        _bad(f"unsupported format {obj['format']!r}")
    cap = obj["capacity"]
    if not jsonstrict.is_int(cap) or not (limits.MIN_SLOTS <= cap <= limits.MAX_SLOTS):
        _bad(f"capacity must be an integer {limits.MIN_SLOTS}..{limits.MAX_SLOTS}")
    gen = obj["generation"]
    if not jsonstrict.is_int(gen) or not (0 <= gen <= limits.MAX_GENERATION):
        _bad("generation must be an integer 0..2147483647")
    sl = obj["slots"]
    if not isinstance(sl, list) or len(sl) != cap:
        _bad("slots length must equal capacity")
    seen = set()
    for i, s in enumerate(sl):
        if not isinstance(s, dict) or set(s) != {"index", "coord", "id"}:
            _bad(f"slot {i}: keys must be exactly index, coord, id")
        if not jsonstrict.is_int(s["index"]) or s["index"] != i:
            _bad(f"slot {i}: index must be the integer {i}")
        if not _coord_ok(s["coord"], KNOWN_COORDS.get(i)):
            _bad(f"slot {i}: coord must be {KNOWN_COORDS.get(i)} (three integers for A/B, null otherwise)")
        sid = s["id"]
        if i not in KNOWN_COORDS and sid is not None:
            _bad(f"slot {i}: unmapped slots must have id null")
        if sid is not None:
            if not valid_id_syntax(sid):
                _bad(f"slot {i}: invalid id")
            if sid in seen:
                _bad(f"slot {i}: id {sid} assigned twice")
            seen.add(sid)
    return obj


def dumps(obj) -> bytes:
    validate(obj)
    return (json.dumps(obj, indent=2, ensure_ascii=True) + "\n").encode("ascii")


def _copy(obj):
    return json.loads(json.dumps(obj))


def _bump(new):
    if new["generation"] >= limits.MAX_GENERATION:
        raise InstallError("SLOTS_GENERATION_OVERFLOW", "generation would exceed 2147483647; refusing to wrap")
    new["generation"] += 1
    return new


def slot_of(obj, pid):
    for s in obj["slots"]:
        if s["id"] == pid:
            return s["index"]
    return None


def assignable(obj, idx):
    return jsonstrict.is_int(idx) and 0 <= idx < obj["capacity"] and obj["slots"][idx]["coord"] is not None


def with_assignment(obj, idx, pid):
    """Return a new registry, or the SAME object if nothing changes (no generation bump)."""
    if not assignable(obj, idx):
        raise InstallError("SLOT_NOT_ASSIGNABLE", f"slot {idx} has no verified menu cell")
    cur = obj["slots"][idx]["id"]
    if cur == pid:
        return obj
    if cur is not None:
        raise InstallError("SLOT_OCCUPIED", f"slot {idx} is used by {cur}")
    other = slot_of(obj, pid)
    if other is not None:
        raise InstallError("SLOT_ALREADY_ASSIGNED", f"{pid} is already in slot {other}")
    new = _copy(obj)
    new["slots"][idx]["id"] = pid
    return _bump(new)


def without(obj, pid):
    if slot_of(obj, pid) is None:
        return obj
    new = _copy(obj)
    for s in new["slots"]:
        if s["id"] == pid:
            s["id"] = None
    return _bump(new)


def first_free(obj):
    for s in obj["slots"]:
        if s["id"] is None and s["coord"] is not None:
            return s["index"]
    return None


def grow(obj, capacity):
    """Explicit capacity migration (future, up to 256). New slots are unmapped and unassignable."""
    if not jsonstrict.is_int(capacity) or not (obj["capacity"] <= capacity <= limits.MAX_SLOTS):
        raise InstallError("SLOTS_CAPACITY", f"capacity must be {obj['capacity']}..{limits.MAX_SLOTS} (never shrinks)")
    if capacity == obj["capacity"]:
        return obj
    new = _copy(obj)
    for i in range(new["capacity"], capacity):
        new["slots"].append({"index": i, "coord": None, "id": None})
    new["capacity"] = capacity
    return _bump(new)
