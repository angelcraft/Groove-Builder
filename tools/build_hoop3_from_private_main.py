"""Generate the 54-ring Hoop3 *draft* .groove from a verified private main.

This deliberately makes no game installation and cannot be marked playable.
The original 34 ring locations and 11 native scene actions are independently
recovered from the owner's hash-pinned executable. The additional 20 beats
come from the owner's tested Hoop54 experiment. No game binaries, sprites,
audio or bytecode enter the ZIP.
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import json
from pathlib import Path
import tempfile

from groove_pack import build_archive, GrooveFormatError, validate_package
from audit_hoop3_worker_contract import audit_original_worker
from recover_hoop3_original_rings import (
    load_original_image, original_ring_schedule, NATIVE_TICKS_PER_BEAT,
)


EXAMPLE = Path(__file__).resolve().parents[1] / "examples/hoop_trundling_3"
EXTRA_RING_BEATS = (
    22, 30, 41, 47, 57, 63, 69, 79, 85, 100,
    104, 109, 120, 125, 136, 146, 154, 164, 170, 180,
)


def tick_to_beat(tick: int) -> str:
    beat = Decimal(tick) / NATIVE_TICKS_PER_BEAT
    if tick < 0 or beat != beat.quantize(Decimal("0.000001")):
        raise GrooveFormatError("Original tick cannot be represented exactly in v1 beats")
    return format(beat.normalize(), "f")


def timeline_from_original(report: dict, scene_calls: list[dict]) -> dict:
    native = report["original_ring_ticks"]
    special = report["conditional_mask_ring"]
    if len(native) != 34 or special["one_based_ring_number"] != 33:
        raise GrooveFormatError("Unsupported original Hoop2 timeline")
    extra = [beat * NATIVE_TICKS_PER_BEAT for beat in EXTRA_RING_BEATS]
    if len(set(native + extra)) != 54:
        raise GrooveFormatError("A bonus ring overlaps the original ring coordinate")
    if (len(scene_calls) != 11 or
            sum(c["original_argument"] == "basic" for c in scene_calls) != 2 or
            sum(c["original_argument"] == "change" for c in scene_calls) != 8 or
            sum(c["original_argument"] == "hide" for c in scene_calls) != 1):
        raise GrooveFormatError("Unexpected original native scene-action inventory")
    actions = []
    counters = {"basic": 0, "change": 0, "hide": 0}
    for call in scene_calls:
        action = call["original_argument"]
        tick = call["tick"]
        tick_to_beat(tick)  # fail closed for non-representable timing
        counters[action] += 1
        actions.append((tick, 0, "scene", f"{action}_{counters[action]:02}"))
    rings = sorted([(tick, 1, "original", index + 1)
                    for index, tick in enumerate(native)] +
                   [(tick, 1, "bonus", index + 1)
                    for index, tick in enumerate(extra)] + actions)
    events = [{"id": "bubble_default", "beat": "0", "command": "hoop.bubble_state",
               "args": {"mask": -1}}]
    for tick, _, source, index in rings:
        beat = tick_to_beat(tick)
        if source == "scene":
            action = index.rsplit("_", 1)[0]
            events.append({"id": f"scene_{index}", "beat": beat,
                           "command": "hoop.scene_action", "args": {"action": action}})
            continue
        if source == "original" and index == 33:
            events.append({"id": "bubble_stage68_original_33", "beat": beat,
                           "command": "hoop.stage68_mask", "args": {}})
        events.append({"id": f"ring_{source}_{index:02}", "beat": beat,
                       "command": "hoop.ring_spawn", "args": {"variant": "normal"}})
        if source == "original" and index == 33:
            events.append({"id": "bubble_reset_after_33", "beat": beat,
                           "command": "hoop.bubble_state", "args": {"mask": -1}})
    if (sum(e["command"] == "hoop.ring_spawn" for e in events) != 54
            or len(events) != 68):
        raise GrooveFormatError("54-ring replacement must preserve 11 original scene actions")
    return {"version": 1, "timebase": "beats", "events": events}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_main", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if args.out.exists() or args.out.resolve() == args.private_main.resolve():
        parser.error("Output must be a NEW .groove, different from the original main")
    image, _ = load_original_image(args.private_main)
    original = original_ring_schedule(image)
    worker = audit_original_worker(image)
    timeline = timeline_from_original(original, worker["additional_stage_helper_calls"])
    with tempfile.TemporaryDirectory(prefix="groove-hoop3-stage-") as temporary:
        folder = Path(temporary)
        (folder / "manifest.json").write_bytes((EXAMPLE / "manifest.json").read_bytes())
        (folder / "timeline.json").write_text(
            json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        manifest = validate_package({p.name: p.read_bytes() for p in folder.iterdir()})
        if manifest["state"] != "draft" or manifest["switch_playable"]:
            raise GrooveFormatError("Unsafe claim of native playability")
        result = build_archive(folder, args.out)
    print(f"Generated 54 rings + 11 original scene actions / "
          f"{result['event_count']} events: {args.out}")
    print("DRAFT ONLY: no Switch .groove loader, original worker bypass or save hook.")


if __name__ == "__main__":
    main()
