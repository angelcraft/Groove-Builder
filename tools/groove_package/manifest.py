"""Strict manifest.json parsing + GE-154 Draft 0.2 runtime schema + semantic checks.

The structural rules mirror vendor/groove-runtime-manifest.draft.schema.json
(tests cross-check against it with the jsonschema package when available) so
no third-party dependency is needed at runtime.
"""
import re
import uuid

from . import jsonstrict, limits
from .errors import PackageError
from .safepath import is_dos_device

M = "manifest.json"
ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$")
VERSION_RE = re.compile(r"^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

REQUIRED = ("format", "profile", "id", "version", "title", "engine_min",
            "engine_contract", "adapter", "timeline", "required_capabilities", "results")
TIMELINES = {"gtf": "timeline.gtf", "gtl": "timeline.gtl"}


def valid_id_syntax(pid):
    """Exact fullmatch (a trailing newline must not pass as with re.match + '$')."""
    return (isinstance(pid, str) and limits.ID_MIN <= len(pid) <= limits.ID_MAX
            and ID_RE.fullmatch(pid) is not None and not is_dos_device(pid))


def parse_version(s):
    m = VERSION_RE.fullmatch(s) if isinstance(s, str) else None
    return tuple(int(x) for x in m.groups()) if m else None


def _jerr(kind, msg):
    code = {"size": "MANIFEST_TOO_LARGE", "utf8": "MANIFEST_UTF8", "depth": "MANIFEST_DEPTH",
            "duplicate": "MANIFEST_DUPLICATE_KEY", "json": "MANIFEST_JSON"}[kind]
    return PackageError(code, msg, M)


def load_json_strict(raw: bytes):
    return jsonstrict.loads(raw, limits.MAX_MANIFEST_BYTES, _jerr, limits.MAX_JSON_DEPTH)


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
    if not _is_str(pid) or not (limits.ID_MIN <= len(pid) <= limits.ID_MAX) or not valid_id_syntax(pid):
        raise PackageError("MANIFEST_BAD_ID", "id must be lowercase reverse-DNS-like, 3-96 chars", M)
    if is_dos_device(pid):
        raise PackageError("MANIFEST_BAD_ID", "id starts with a reserved Windows device name", M)
    if not UUID_RE.search(pid):
        warnings.append("id does not contain a UUIDv4 (accepted legacy reverse-DNS id; new ids must use a cryptographic UUIDv4)")
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
