"""Engine marker sd:/groove/engine.json (groove-engine/1, GE-154 Draft 0.3 decision B) and compatibility.

  {"format": "groove-engine/1", "engine_version": "0.6.0", "engine_contract": 1,
   "build_id": "03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8",
   "capabilities": ["package.runtime/1", "registry.slots/1", "adapter.multi", "timeline.gtf", "timeline.gtl"]}

The marker is produced by the GE-151 release/install process only after the
matching loader is installed. It is NOT a signature. Explicit CLI targets are
accepted ONLY for read-only operations (validate/plan); every SD mutation
requires a valid marker on that SD (resolve_marker).
"""
import os
import re
from dataclasses import dataclass, field

from . import jsonstrict, limits
from .errors import InstallError
from .manifest import parse_version
from .safefs import read_bounded

ENGINE_KEYS = {"format", "engine_version", "engine_contract", "build_id", "capabilities"}
TOKEN_RE = re.compile(r"[a-z0-9]+(?:\.[a-z0-9]+)*(?:/[0-9]+)?")
BASE_CAPS = ("package.runtime/1", "registry.slots/1", "adapter.multi")
MAX_CAPS = 64


@dataclass
class EngineTarget:
    engine_version: str
    engine_contract: int
    build_id: str
    capabilities: tuple = field(default_factory=tuple)
    source: str = "marker"


def _jerr(kind, msg):
    return InstallError("ENGINE_JSON_INVALID", f"engine.json: {msg}")


def parse_marker(raw: bytes) -> EngineTarget:
    obj = jsonstrict.loads(raw, limits.MAX_ENGINE_JSON, _jerr, 4)
    if not isinstance(obj, dict) or set(obj) != ENGINE_KEYS:
        raise InstallError("ENGINE_JSON_INVALID", f"engine.json keys must be exactly {sorted(ENGINE_KEYS)}")
    if obj["format"] != "groove-engine/1":
        raise InstallError("ENGINE_JSON_INVALID", "engine.json format must be groove-engine/1")
    return make_target(obj["engine_version"], obj["engine_contract"], obj["build_id"], obj["capabilities"], "marker")


def make_target(version, contract, build_id, capabilities, source):
    if parse_version(version) is None:
        raise InstallError("ENGINE_BAD_VERSION", f"engine version {version!r} is not MAJOR.MINOR.PATCH")
    if not jsonstrict.is_int(contract):
        raise InstallError("ENGINE_BAD_CONTRACT", "engine contract must be an integer")
    if not isinstance(build_id, str) or not re.fullmatch(r"[0-9A-F]{40}", build_id):
        raise InstallError("ENGINE_BAD_BUILD", "build_id must be the full 40-character UPPERCASE hex game build id")
    if not isinstance(capabilities, list) or len(capabilities) > MAX_CAPS \
            or not all(isinstance(c, str) and TOKEN_RE.fullmatch(c) for c in capabilities):
        raise InstallError("ENGINE_BAD_CAPABILITIES", "capabilities must be a list of capability tokens")
    if len(set(capabilities)) != len(capabilities):
        raise InstallError("ENGINE_BAD_CAPABILITIES", "duplicate capability tokens")
    return EngineTarget(version, contract, build_id, tuple(capabilities), source)


def resolve_marker(groove_dir) -> EngineTarget:
    """The only target accepted for SD mutations."""
    p = os.path.join(groove_dir, "engine.json")
    try:
        raw = read_bounded(p, limits.MAX_ENGINE_JSON, "ENGINE_JSON_INVALID")
    except FileNotFoundError:
        raise InstallError("ENGINE_UNKNOWN", "sd:/groove/engine.json not found: no package-capable engine is "
                                             "installed on this SD (v0.5.x has no loader)") from None
    return parse_marker(raw)


def required_caps(pkg):
    return BASE_CAPS + (f"timeline.{pkg.manifest['timeline']['format']}",)


def check_compat(pkg, target: EngineTarget):
    if target.build_id not in limits.KNOWN_BUILD_IDS:
        raise InstallError("ENGINE_UNKNOWN_BUILD", f"game build {target.build_id} is not supported")
    if target.engine_contract not in limits.SUPPORTED_CONTRACTS:
        raise InstallError("ENGINE_CONTRACT_UNSUPPORTED", f"engine contract {target.engine_contract} unsupported")
    if pkg.manifest["engine_contract"] != target.engine_contract:
        raise InstallError("ENGINE_CONTRACT_MISMATCH",
                           f"package contract {pkg.manifest['engine_contract']} != engine {target.engine_contract}")
    ev = parse_version(target.engine_version)
    if ev < limits.MIN_PACKAGE_ENGINE:
        raise InstallError("ENGINE_NO_PACKAGE_LOADER",
                           f"engine {target.engine_version} cannot load sd:/groove/levels/ (needs >= 0.6.0)")
    if parse_version(pkg.manifest["engine_min"]) > ev:
        raise InstallError("ENGINE_TOO_OLD",
                           f"package needs engine >= {pkg.manifest['engine_min']}, target is {target.engine_version}")
    if pkg.manifest["adapter"] != "multi":  # re-checked here: installed manifests are re-validated too
        raise InstallError("ENGINE_ADAPTER_UNSUPPORTED", f"adapter {pkg.manifest['adapter']!r} is not supported")
    # Unknown, well-formed, unique capabilities in the marker are ignored (forward compatible); they
    # never stand in for a required one, and never make an unknown contract or build acceptable.
    needed = list(required_caps(pkg)) + [c for c in pkg.manifest["required_capabilities"]
                                         if c not in required_caps(pkg)]
    missing = [c for c in needed if c not in target.capabilities]
    if missing:
        raise InstallError("ENGINE_MISSING_CAPABILITY", f"engine does not advertise {missing}")


def check_registry_capable(target: EngineTarget):
    """Gate for NEW slot assignments (assign). Same build/contract/version rules as check_compat."""
    if target.build_id not in limits.KNOWN_BUILD_IDS:
        raise InstallError("ENGINE_UNKNOWN_BUILD", f"game build {target.build_id} is not supported")
    if target.engine_contract not in limits.SUPPORTED_CONTRACTS:
        raise InstallError("ENGINE_CONTRACT_UNSUPPORTED", f"engine contract {target.engine_contract} unsupported")
    if parse_version(target.engine_version) < limits.MIN_PACKAGE_ENGINE or \
            "registry.slots/1" not in target.capabilities or "package.runtime/1" not in target.capabilities:
        raise InstallError("ENGINE_MISSING_CAPABILITY", "engine does not advertise package.runtime/1 + registry.slots/1")
