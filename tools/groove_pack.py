"""Build and inspect resource-optional .groove archives (research format v1).

This is a host-side validator, NOT a Switch loader or a native event bridge.
No commercial game assets are needed or distributed by this tool.
"""

from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path, PurePosixPath
import re
import zipfile


FORMAT = "groove.level"
MAX_FILES = 512
MAX_FILE_SIZE = 64 * 1024 * 1024
MAX_TOTAL_SIZE = 256 * 1024 * 1024
ID = re.compile(r"^[a-z][a-z0-9_.-]{2,79}$")
BEAT = re.compile(r"^[0-9]{1,7}(?:\.[0-9]{1,6})?$")
RESOURCE_TYPES = {".png", ".webp", ".spr", ".tex", ".ogg", ".wav",
                  ".opus", ".mp3", ".json", ".bin", ".bfsar", ".bfstm"}


class GrooveFormatError(ValueError):
    """Invalid or potentially unsafe archives fail closed."""


def fields(value: object, required: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != required:
        raise GrooveFormatError(f"{label}: invalid/missing fields")
    return value


def number(value: object, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise GrooveFormatError(f"{label}: expected integer {minimum}..{maximum}")
    return value


def stable_id(value: object, label: str) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise GrooveFormatError(f"{label}: expected stable ID")
    return value


def safe_name(name: str) -> str:
    if (not name or len(name) > 200 or "\\" in name or "\x00" in name
            or name.startswith("/") or ":" in name):
        raise GrooveFormatError("Unsafe archive path")
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise GrooveFormatError("Unsafe archive path component")
    return name


def asset_path(value: object, label: str) -> str | None:
    if value is None:
        return None  # Inherit from original base; no resource is needed in pack.
    if not isinstance(value, str):
        raise GrooveFormatError(f"{label}: expected relative archive path or null")
    safe_name(value)
    if value.split("/")[0] not in ("sprites", "audio", "intro", "effects"):
        raise GrooveFormatError(f"{label}: asset path must be under a resource folder")
    if len(value.split("/")) < 2 or PurePosixPath(value).suffix.lower() not in RESOURCE_TYPES:
        raise GrooveFormatError(f"{label}: invalid asset extension")
    return value


def decode_json(data: bytes, label: str) -> dict:
    if len(data) > 1024 * 1024:
        raise GrooveFormatError(f"{label}: JSON exceeds 1 MiB")
    try:
        def unique_pairs(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise GrooveFormatError(f"{label}: duplicate JSON key {key}")
                result[key] = value
            return result

        obj = json.loads(
            data.decode("utf-8"), object_pairs_hook=unique_pairs,
            parse_constant=lambda x: (_ for _ in ()).throw(
                GrooveFormatError(f"{label}: non-finite JSON number {x}")))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise GrooveFormatError(f"{label}: invalid UTF-8 JSON") from exc
    if not isinstance(obj, dict):
        raise GrooveFormatError(f"{label}: root must be an object")
    return obj


def validate_package(files: dict[str, bytes]) -> dict:
    if "manifest.json" not in files:
        raise GrooveFormatError("Missing manifest.json")
    if len(files) > MAX_FILES or sum(len(data) for data in files.values()) > MAX_TOTAL_SIZE:
        raise GrooveFormatError("Archive exceeds file or total size limit")
    for name, data in files.items():
        safe_name(name)
        if len(data) > MAX_FILE_SIZE:
            raise GrooveFormatError(f"{name}: too large")

    manifest = fields(decode_json(files["manifest.json"], "manifest.json"),
                      {"format", "version", "id", "title", "slot", "base", "sequence",
                       "resources", "progress_namespace", "state"}, "manifest")
    if manifest["format"] != FORMAT or number(manifest["version"], 1, 1, "version") != 1:
        raise GrooveFormatError("Unsupported .groove format/version")
    stable_id(manifest["id"], "id")
    stable_id(manifest["progress_namespace"], "progress_namespace")
    if not isinstance(manifest["title"], str) or not 1 <= len(manifest["title"]) <= 96:
        raise GrooveFormatError("Invalid title")
    slot = fields(manifest["slot"], {"world", "column", "row"}, "slot")
    number(slot["world"], 0, 2, "world")
    number(slot["column"], 0, 11, "column")
    number(slot["row"], 0, 4, "row")
    base = fields(manifest["base"], {"game", "kind", "index", "adapter"}, "base")
    if base["game"] != "rhythm_paradise_switch":
        raise GrooveFormatError("v1 supports the verified Switch base game only")
    number(base["kind"], 1, 1, "base.kind")
    number(base["index"], 0, 79, "base.index")
    stable_id(base["adapter"], "base.adapter")
    seq = fields(manifest["sequence"], {"mode", "file"}, "sequence")
    if seq["mode"] not in ("inherit", "patch", "replace"):
        raise GrooveFormatError("Unsupported sequence mode")
    if seq["mode"] == "patch":
        raise GrooveFormatError("Patch-mode target-event identity is not implemented in v1")
    if seq["mode"] == "inherit" and seq["file"] is not None:
        raise GrooveFormatError("Inherited sequence must not specify a timeline")
    if seq["mode"] != "inherit":
        if seq["file"] != "timeline.json" or seq["file"] not in files:
            raise GrooveFormatError("Missing required timeline.json")
    resources = fields(manifest["resources"],
                       {"sprites", "music", "sound_effects", "intro"}, "resources")
    for key, value in resources.items():
        path = asset_path(value, f"resources.{key}")
        if path is not None and path not in files:
            raise GrooveFormatError(f"Referenced resource missing: {path}")
    if manifest["state"] != "draft":
        raise GrooveFormatError("v1 research packs must remain draft until Switch adapter exists")

    timeline = None
    if seq["mode"] != "inherit":
        timeline = fields(decode_json(files["timeline.json"], "timeline.json"),
                          {"version", "timebase", "events"}, "timeline")
        number(timeline["version"], 1, 1, "timeline.version")
        if timeline["timebase"] != "beats":
            raise GrooveFormatError("Only beat-based timeline coordinates are supported")
        events = timeline["events"]
        if not isinstance(events, list) or len(events) > 10000:
            raise GrooveFormatError("Invalid event count")
        ids: set[str] = set()
        last_beat = Decimal(-1)
        for idx, event in enumerate(events):
            fields(event, {"id", "beat", "command", "args"}, f"event[{idx}]")
            event_id = stable_id(event["id"], f"event[{idx}].id")
            if event_id in ids:
                raise GrooveFormatError("Duplicate event ID")
            ids.add(event_id)
            if not isinstance(event["beat"], str) or not BEAT.fullmatch(event["beat"]):
                raise GrooveFormatError(f"event[{idx}]: beat must be a decimal string")
            try:
                beat = Decimal(event["beat"])
            except InvalidOperation as exc:
                raise GrooveFormatError("Invalid beat coordinate") from exc
            if beat < last_beat:
                raise GrooveFormatError("Events must be sorted by beat")
            last_beat = beat
            if event["command"] == "hoop.ring_spawn":
                args = fields(event["args"], {"variant"}, "ring_spawn.args")
                if args["variant"] != "normal":
                    raise GrooveFormatError("Unverified ring variant")
            elif event["command"] == "hoop.bubble_state":
                args = fields(event["args"], {"mask"}, "bubble_state.args")
                number(args["mask"], -1, 15, "bubble_state.mask")
            else:
                raise GrooveFormatError(f"Unimplemented command: {event['command']}")

    # Files outside a recognized resource folder are not allowed, even when unreferenced.
    allowed = {"manifest.json", "timeline.json"}
    for name in files:
        if name not in allowed:
            if name.split("/")[0] not in ("sprites", "audio", "intro", "effects"):
                raise GrooveFormatError(f"Unexpected package member: {name}")
            asset_path(name, name)
    return {"id": manifest["id"], "slot": slot, "base": base,
            "mode": seq["mode"], "event_count": len(timeline["events"]) if timeline else 0,
            "resource_overrides": [key for key, value in resources.items() if value],
            "state": manifest["state"], "switch_playable": False}


def read_folder(folder: Path) -> dict[str, bytes]:
    if not folder.is_dir():
        raise GrooveFormatError("Input folder does not exist")
    files = {}
    for path in folder.rglob("*"):
        if path.is_symlink():
            raise GrooveFormatError("Symlink in package folder")
        if not path.is_file():
            continue
        name = path.relative_to(folder).as_posix()
        safe_name(name)
        if path.stat().st_size > MAX_FILE_SIZE:
            raise GrooveFormatError(f"{name}: too large")
        files[name] = path.read_bytes()
    validate_package(files)
    return files


def read_archive(archive: Path) -> dict[str, bytes]:
    try:
        with zipfile.ZipFile(archive, "r") as zipped:
            infos = zipped.infolist()
            if len(infos) > MAX_FILES:
                raise GrooveFormatError("Too many archive members")
            files = {}
            total = 0
            for info in infos:
                name = safe_name(info.filename)
                if info.is_dir() or name in files or (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise GrooveFormatError("Directory, duplicate or symlink ZIP member")
                if info.flag_bits & 1 or info.file_size > MAX_FILE_SIZE:
                    raise GrooveFormatError("Encrypted or oversized ZIP member")
                total += info.file_size
                if total > MAX_TOTAL_SIZE:
                    raise GrooveFormatError("ZIP expanded size exceeds limit")
                files[name] = zipped.read(info)
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError) as exc:
        raise GrooveFormatError("Cannot read .groove archive") from exc
    validate_package(files)
    return files


def build_archive(folder: Path, target: Path) -> dict:
    files = read_folder(folder)
    if target.resolve().is_relative_to(folder.resolve()):
        raise GrooveFormatError("Output must be outside the input folder")
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zipped.writestr(info, files[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return validate_package(read_archive(target))


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("source", type=Path, help="A .groove archive, or source folder with --build")
    cli.add_argument("--build", type=Path, metavar="OUTPUT.groove")
    args = cli.parse_args()
    try:
        result = build_archive(args.source, args.build) if args.build else validate_package(
            read_archive(args.source) if args.source.is_file() else read_folder(args.source))
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (GrooveFormatError, OSError) as exc:
        cli.error(str(exc))


if __name__ == "__main__":
    main()
