"""Strict, bounded JSON for every input the installer trusts (manifest, engine.json, slots.json, journal).

UTF-8 without BOM, unique keys, no NaN/Infinity, bounded nesting, no unpaired
surrogates. Callers pass their own error factory so codes stay specific.
"""
import json

MAX_DEPTH = 16


def _depth_ok(text, max_depth):
    depth, in_str, esc = 0, False, False
    for c in text:
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c in "[{":
            depth += 1
            if depth > max_depth:
                return False
        elif c in "]}":
            depth -= 1
    return True


class _Dup(Exception):
    pass


def _check_strings(obj):
    if isinstance(obj, str):
        obj.encode("utf-8")  # raises UnicodeEncodeError on lone surrogates
    elif isinstance(obj, dict):
        for k, v in obj.items():
            _check_strings(k)
            _check_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            _check_strings(v)


def loads(raw: bytes, cap: int, err, max_depth: int = MAX_DEPTH):
    """err(kind, message) must return an exception; kind in
    {'size', 'utf8', 'depth', 'duplicate', 'json'}."""
    if len(raw) > cap:
        raise err("size", f"{len(raw)} bytes (> {cap})")
    if raw.startswith(b"\xef\xbb\xbf"):
        raise err("utf8", "UTF-8 BOM not allowed")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise err("utf8", "not valid UTF-8") from None
    if not _depth_ok(text, max_depth):
        raise err("depth", f"nesting deeper than {max_depth}")

    def pairs(ps):
        d = {}
        for k, v in ps:
            if k in d:
                raise _Dup(k)
            d[k] = v
        return d

    def const(name):
        raise ValueError(f"non-standard JSON constant {name}")

    try:
        obj = json.loads(text, object_pairs_hook=pairs, parse_constant=const)
    except _Dup as e:
        raise err("duplicate", f"duplicate key {e.args[0]!r}") from None
    except (ValueError, RecursionError) as e:
        raise err("json", f"invalid JSON: {e}") from None
    try:
        _check_strings(obj)
    except UnicodeEncodeError:
        raise err("utf8", "string contains an unpaired surrogate") from None
    return obj


def is_int(v):
    return type(v) is int  # excludes bool
