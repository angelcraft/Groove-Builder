"""Strict manifest.json parsing + GE-154 Draft 0.2 runtime schema + semantic checks.

The structural rules mirror vendor/groove-runtime-manifest.draft.schema.json
(tests cross-check against it with the jsonschema package when available) so
no third-party dependency is needed at runtime.
"""
import json
import re
import uuid

from . import limits
from .errors import PackageError
from .safepath import is_dos_device

M = "manifest.json"
ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$")
VERSION_RE = re.compile(r"^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

REQUIRED = ("format", "profile", "id", "version", "title", "engine_min",
            "engine_contract", "adapter", "timeline", "required_capabilities", "results")
TIMELINES = {"gtf": "timeline.gtf", "gtl": "timeline.gtl"}


def parse_version(s):
    m = VERSION_RE.match(s) if isinstance(s, str) else None
    return tuple(int(x) for x in m.groups()) if m else None


def _depth_ok(text: str, max_depth: int) -> bool:
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


def _no_dupes(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise PackageError("MANIFEST_DUPLICATE_KEY", f"duplicate key {k!r}", M)
        out[k] = v
    return out


def _reject_constant(name):
    raise PackageError("MANIFEST_JSON", f"non-standard JSON constant {name}", M)


def _check_strings(obj):
    """Reject lone surrogates that json.loads accepts from \\uD800 escapes."""
    if isinstance(obj, str):
        try:
            obj.encode("utf-8")
        except UnicodeEncodeError:
            raise PackageError("MANIFEST_UTF8", "string contains an unpaired surrogate", M) from None
    elif isinstance(obj, dict):
        for k, v in obj.items():
            _check_strings(k)
            _check_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            _check_strings(v)


def load_json_strict(raw: bytes):
    if len(raw) > limits.MAX_MANIFEST_BYTES:
        raise PackageError("MANIFEST_TOO_LARGE", f"{len(raw)} bytes (> {limits.MAX_MANIFEST_BYTES})", M)
    if raw.startswith(b"\xef\xbb\xbf"):
        raise PackageError("MANIFEST_UTF8", "UTF-8 BOM not allowed", M)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise PackageError("MANIFEST_UTF8", "manifest is not valid UTF-8", M) from None
    if not _depth_ok(text, limits.MAX_JSON_DEPTH):
        raise PackageError("MANIFEST_DEPTH", f"nesting deeper than {limits.MAX_JSON_DEPTH}", M)
    try:
        obj = json.loads(text, object_pairs_hook=_no_dupes, parse_constant=_reject_constant)
    except PackageError:
        raise
    except (ValueError, RecursionError) as e:
        raise PackageError("MANIFEST_JSON", f"invalid JSON: {e}", M) from None
    _check_strings(obj)
    return obj


def _is_str(v):
    return isinstance(v, str)


def validate_manifest(obj):
    """Return (manifest dict, warnings). Raises PackageError on the first violation."""
    warnings = []
    if not isinstance(obj, dict):
        raise PackageError("MANIFEST_SCHEMA", "manifest must be a JSON object", M)
    if obj.get("format") != "groove-package/1":
        raise PackageError("MANIFEST_FORMAT", "format must be 'groove-package/1'", M)
    prof = obj.get("profile")
    if prof == "editor":
        raise PackageError("NOT_RUNTIME_PROFILE",
                           "authoring (editor) package: export a runtime profile from Groove Builder to install it", M)
    if prof != "runtime":
        raise PackageError("MANIFEST_SCHEMA", "profile must be 'runtime'", M)
    for k in REQUIRED:
        if k not in obj:
            raise PackageError("MANIFEST_MISSING_KEY", f"missing key {k!r}", M)
    extra = sorted(set(obj) - set(REQUIRED))
    if extra:
        raise PackageError("MANIFEST_UNKNOWN_KEY", f"unknown keys {extra}", M)

    pid = obj["id"]
    if not _is_str(pid) or not (limits.ID_MIN <= len(pid) <= limits.ID_MAX) or not ID_RE.match(pid):
        raise PackageError("MANIFEST_BAD_ID", "id must be lowercase reverse-DNS-like, 3-96 chars", M)
    if is_dos_device(pid):
        raise PackageError("MANIFEST_BAD_ID", "id starts with a reserved Windows device name", M)
    if not UUID_RE.search(pid):
        warnings.append("id does not contain a UUID; Draft 0.2 asks for a cryptographic UUID generated once")
    else:
        u = UUID_RE.search(pid).group(0)
        if uuid.UUID(u).version != 4:
            warnings.append("id UUID is not version 4 (random)")

    if parse_version(obj["version"]) is None:
        raise PackageError("MANIFEST_BAD_VERSION", "version must be MAJOR.MINOR.PATCH without leading zeros", M)
    if parse_version(obj["engine_min"]) is None:
        raise PackageError("MANIFEST_BAD_VERSION", "engine_min must be MAJOR.MINOR.PATCH", M)

    title = obj["title"]
    if not _is_str(title):
        raise PackageError("MANIFEST_BAD_TITLE", "title must be a string", M)
    tb = title.encode("utf-8")
    if not (1 <= len(tb) <= limits.TITLE_MAX_BYTES):
        raise PackageError("MANIFEST_BAD_TITLE", f"title must be 1-{limits.TITLE_MAX_BYTES} UTF-8 bytes", M)
    if any(ord(c) < 32 or ord(c) == 127 or 0x80 <= ord(c) <= 0x9F for c in title):
        raise PackageError("MANIFEST_BAD_TITLE", "title contains control characters", M)
    if not title.strip():
        raise PackageError("MANIFEST_BAD_TITLE", "title is blank", M)

    ec = obj["engine_contract"]
    if type(ec) is not int:
        raise PackageError("MANIFEST_SCHEMA", "engine_contract must be an integer", M)
    if ec not in limits.SUPPORTED_CONTRACTS:
        raise PackageError("ENGINE_CONTRACT_UNSUPPORTED", f"engine_contract {ec} is not supported", M)
    if obj["adapter"] != "multi":
        raise PackageError("UNSUPPORTED_ADAPTER", f"adapter {obj['adapter']!r} not supported (runtime: multi only)", M)

    tl = obj["timeline"]
    if not isinstance(tl, dict) or set(tl) != {"format", "path"}:
        raise PackageError("MANIFEST_SCHEMA", "timeline must be exactly {format, path}", M)
    fmt = tl["format"]
    if fmt not in TIMELINES:
        raise PackageError("UNSUPPORTED_TIMELINE", f"timeline format {fmt!r} not supported", M)
    if tl["path"] != TIMELINES[fmt]:
        raise PackageError("TIMELINE_PATH_MISMATCH", f"{fmt} timeline must be at {TIMELINES[fmt]}", M)
    caps = obj["required_capabilities"]
    if not isinstance(caps, list) or not all(_is_str(c) for c in caps):
        raise PackageError("MANIFEST_SCHEMA", "required_capabilities must be a list of strings", M)
    if caps != [f"timeline.{fmt}"]:
        raise PackageError("CAPABILITY_MISMATCH",
                           f"required_capabilities must be exactly ['timeline.{fmt}'] (got {caps})", M)
    if obj["results"] != "custom":
        raise PackageError("NATIVE_RESULTS", "results must be 'custom' (native results disabled for packages)", M)
    return obj, warnings
