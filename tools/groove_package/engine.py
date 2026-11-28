"""Engine target resolution and package/engine compatibility (fail closed).

sd:/groove/engine.json is a DRAFT marker (see reports/GE-155/FORMAT_QUESTIONS.md):
  {"format": "groove-engine/1", "engine_version": "0.6.0", "engine_contract": 1, "build_id": "03FF4A3B"}
CLI flags override it. With neither, installation is refused.
"""
import json
import os
import re
from dataclasses import dataclass

from . import limits
from .errors import InstallError
from .manifest import parse_version

ENGINE_KEYS = {"format", "engine_version", "engine_contract", "build_id"}


@dataclass
class EngineTarget:
    engine_version: str
    engine_contract: int
    build_id: str
    source: str


def _norm_build(b):
    if not isinstance(b, str) or not re.fullmatch(r"[0-9A-Fa-f]{8}", b):
        raise InstallError("ENGINE_BAD_BUILD", f"build id must be 8 hex digits (got {b!r})")
    return b.upper()


def resolve_target(groove_dir, engine_version=None, engine_contract=None, build_id=None):
    data = {}
    src = "cli"
    p = os.path.join(groove_dir, "engine.json")
    if os.path.isfile(p) and not os.path.islink(p):
        if os.path.getsize(p) > 4096:
            raise InstallError("ENGINE_JSON_INVALID", "engine.json too large")
        try:
            with open(p, "rb") as f:
                data = json.loads(f.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            raise InstallError("ENGINE_JSON_INVALID", f"engine.json: {e}") from None
        if not isinstance(data, dict) or set(data) != ENGINE_KEYS or data.get("format") != "groove-engine/1":
            raise InstallError("ENGINE_JSON_INVALID", "engine.json does not match draft groove-engine/1")
        src = "engine.json" if engine_version is None and build_id is None else "engine.json+cli"
    ver = engine_version if engine_version is not None else data.get("engine_version")
    con = engine_contract if engine_contract is not None else data.get("engine_contract")
    bid = build_id if build_id is not None else data.get("build_id")
    if ver is None or con is None or bid is None:
        raise InstallError("ENGINE_UNKNOWN",
                           "engine target unknown: pass --engine-version/--engine-contract/--build-id "
                           "or provide sd:/groove/engine.json (draft)")
    if parse_version(ver) is None:
        raise InstallError("ENGINE_BAD_VERSION", f"engine version {ver!r} is not MAJOR.MINOR.PATCH")
    if type(con) is not int:
        raise InstallError("ENGINE_BAD_CONTRACT", "engine contract must be an integer")
    return EngineTarget(ver, con, _norm_build(bid), src)


def check_compat(pkg, target: EngineTarget):
    if target.build_id not in limits.KNOWN_BUILD_IDS:
        raise InstallError("ENGINE_UNKNOWN_BUILD",
                           f"game build {target.build_id} is not supported (known: {', '.join(limits.KNOWN_BUILD_IDS)})")
    if target.engine_contract not in limits.SUPPORTED_CONTRACTS:
        raise InstallError("ENGINE_CONTRACT_UNSUPPORTED", f"engine contract {target.engine_contract} unsupported by installer")
    if pkg.manifest["engine_contract"] != target.engine_contract:
        raise InstallError("ENGINE_CONTRACT_MISMATCH",
                           f"package contract {pkg.manifest['engine_contract']} != engine {target.engine_contract}")
    ev = parse_version(target.engine_version)
    if ev < limits.MIN_PACKAGE_ENGINE:
        raise InstallError("ENGINE_NO_PACKAGE_LOADER",
                           f"engine {target.engine_version} cannot load sd:/groove/levels/ "
                           f"(needs >= {'.'.join(map(str, limits.MIN_PACKAGE_ENGINE))})")
    if pkg.version_tuple() is None or parse_version(pkg.manifest["engine_min"]) > ev:
        raise InstallError("ENGINE_TOO_OLD",
                           f"package needs engine >= {pkg.manifest['engine_min']}, target is {target.engine_version}")
