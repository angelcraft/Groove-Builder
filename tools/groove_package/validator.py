"""validate_package(): archive -> manifest -> timeline, fail closed (GE-154 Draft 0.2 runtime profile)."""
import hashlib
from dataclasses import dataclass, field

from . import limits
from .errors import PackageError
from .manifest import load_json_strict, validate_manifest, parse_version, TIMELINES
from .timeline import validate_timeline
from .zipreader import read_members, extract

# Reserved / proprietary content is never accepted in a runtime package.
FORBIDDEN_EXT = {
    ".cwv": "game audio", ".bwav": "game audio", ".bfwav": "game audio", ".bfstm": "game audio",
    ".bars": "game audio", ".wav": "audio", ".ogg": "audio", ".mp3": "audio", ".flac": "audio",
    ".spr": "game sprites", ".tex": "game textures", ".bntx": "game textures", ".bflim": "game textures",
    ".msbt": "game text", ".sarc": "game archive", ".szs": "game archive", ".zs": "compressed game data",
    ".rhref": "game reference data", ".nso": "executable", ".nro": "executable", ".elf": "executable",
    ".ips": "native patch", ".ips32": "native patch", ".pchtxt": "native patch", ".so": "executable",
    ".dll": "executable", ".exe": "executable", ".zip": "nested archive", ".groove": "nested archive",
    ".7z": "nested archive", ".rar": "nested archive", ".nsp": "game dump", ".xci": "game dump",
}
FORBIDDEN_NAMES = {"main", "main.npdm", "subsdk4", "subsdk9", "rtld", "sdk"}
FORBIDDEN_DIRS = {"romfs", "exefs", "sprites", "audio", "intro", "animations", "atmosphere", "contents"}


@dataclass
class ValidatedPackage:
    id: str
    version: str
    title: str
    manifest: dict
    manifest_bytes: bytes
    timeline_name: str
    timeline_bytes: bytes
    sha256: str
    timeline_info: dict
    warnings: list = field(default_factory=list)

    @property
    def files(self):
        return {"manifest.json": self.manifest_bytes, self.timeline_name: self.timeline_bytes}

    def version_tuple(self):
        return parse_version(self.version)

    def summary(self):
        return {"id": self.id, "version": self.version, "title": self.title,
                "engine_min": self.manifest["engine_min"], "timeline": self.timeline_name,
                "sha256": self.sha256, "games": self.timeline_info["games"],
                "events": self.timeline_info["events"], "warnings": self.warnings}


def _policy(name: str):
    low = name.lower()
    parts = low.split("/")
    base = parts[-1]
    ext = "." + base.rsplit(".", 1)[1] if "." in base else ""
    if ext in FORBIDDEN_EXT:
        raise PackageError("FORBIDDEN_CONTENT", f"{FORBIDDEN_EXT[ext]} ({ext}) is not allowed", name)
    if base in FORBIDDEN_NAMES or any(p in FORBIDDEN_DIRS for p in parts[:-1]):
        raise PackageError("FORBIDDEN_CONTENT", "reserved/proprietary path (sprites, audio, romfs, exefs, binaries)", name)


def validate_package(data: bytes) -> ValidatedPackage:
    members = read_members(data)
    for m in members:
        _policy(m.name)
    by_name = {m.name: m for m in members}
    if "manifest.json" not in by_name:
        raise PackageError("MANIFEST_MISSING", "manifest.json is missing")
    raw_manifest = extract(data, by_name["manifest.json"], limits.MAX_MANIFEST_BYTES)
    manifest, warnings = validate_manifest(load_json_strict(raw_manifest))
    # Only now (profile known to be runtime) enforce the exact member set.
    tl_name = TIMELINES[manifest["timeline"]["format"]]
    expected = {"manifest.json", tl_name}
    names = set(by_name)
    if names != expected or len(members) != limits.RUNTIME_ENTRIES:
        missing = sorted(expected - names)
        extra = sorted(names - expected)
        if missing:
            raise PackageError("TIMELINE_MISSING", f"missing {missing}")
        raise PackageError("UNEXPECTED_MEMBER", f"runtime packages contain exactly {sorted(expected)}; extra {extra}")
    raw_tl = extract(data, by_name[tl_name], limits.MAX_TIMELINE_BYTES)
    _, info = validate_timeline(raw_tl, manifest["timeline"]["format"], tl_name)
    if info["title"] and info["title"] != manifest["title"]:
        warnings.append("timeline title differs from manifest title (manifest is authoritative for the menu)")
    return ValidatedPackage(
        id=manifest["id"], version=manifest["version"], title=manifest["title"], manifest=manifest,
        manifest_bytes=raw_manifest, timeline_name=tl_name, timeline_bytes=raw_tl,
        sha256=hashlib.sha256(data).hexdigest(), timeline_info=info, warnings=warnings)
