"""Read-only Stage68 worker ABI and non-ring call audit for pinned private main.

Proves the first two native arguments and inventories ALL direct BL targets
in the original Hoop2 sequence. Do not replace the original worker until the
non-ring actions and cancellation/teardown are preserved by the new runtime.
Original code/resources remain private; this script outputs only annotations.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from recover_hoop3_original_rings import (
    WORKER_WINDOW_START, WORKER_WINDOW_END, ORIGINAL_RING_EMITTER,
    NATIVE_WAIT, NATIVE_STOPPED, NATIVE_TICKS_PER_BEAT,
    branch_target, load_original_image, original_ring_schedule, read_word,
)


STAGE_HELPER = 0x1390E0
MASK_HELPER = 0x2171E0
WORKER_ARGUMENT_COPY = 0xAA0103F3  # mov x19, x1: original SeqThread worker
STAGE_ARGUMENT_COPY = 0xAA0003F4  # mov x20, x0: original Stage68 object
STAGE_TO_HELPER = 0xAA1403E0


def decode_adrp_target(pc: int, word: int, register: int) -> int:
    if word & 0x9F00001F != 0x90000000 | register:
        raise ValueError("Expected ADRP for original stage helper argument")
    value = (((word >> 5) & 0x7FFFF) << 2) | ((word >> 29) & 3)
    if value & 0x100000:
        value -= 0x200000
    return (pc & ~0xFFF) + (value << 12)


def decode_add_literal(word: int, register: int) -> int:
    if word & 0xFF0003FF != 0x91000000 | (register << 5) | register:
        raise ValueError("Expected original ADD immediate to same argument register")
    shift = (word >> 22) & 1
    if word & (1 << 23):
        raise ValueError("Unsupported ADD immediate shift")
    return ((word >> 10) & 0xFFF) << (12 if shift else 0)


def read_native_string(image: bytes, offset: int) -> str:
    if offset < 0 or offset >= len(image):
        raise ValueError("Stage helper string address outside verified NSO image")
    end = image.find(b"\0", offset, offset + 256)
    if end < 0:
        raise ValueError("Unterminated original stage helper string")
    data = image[offset:end]
    if not data or any(byte < 32 or byte > 126 for byte in data):
        raise ValueError("Stage helper argument does not reference an ASCII identifier")
    return data.decode("ascii")


def stage_helper_argument(image: bytes, pc: int) -> tuple[str, int]:
    receiver = read_word(image, pc - 4)
    if receiver != STAGE_TO_HELPER and not (
            pc == 0x42CA60 and receiver == STAGE_ARGUMENT_COPY):
        raise ValueError(f"Stage helper receiver changed at {pc:#x}")
    literal_pc = pc - 12
    page = decode_adrp_target(literal_pc, read_word(image, literal_pc), 1)
    address = page + decode_add_literal(read_word(image, pc - 8), 1)
    return read_native_string(image, address), address


def audit_original_worker(image: bytes) -> dict:
    original = original_ring_schedule(image)
    if (read_word(image, WORKER_WINDOW_START + 0x10) != WORKER_ARGUMENT_COPY or
            read_word(image, WORKER_WINDOW_START + 0x1C) != STAGE_ARGUMENT_COPY):
        raise ValueError("Original Stage68 callback arguments/prologue changed")
    running_ticks = 0
    helpers = []
    mask = []
    all_targets: dict[int, int] = {}
    indirect_calls = []
    for pc in range(WORKER_WINDOW_START, WORKER_WINDOW_END, 4):
        word = read_word(image, pc)
        if word & 0xFFFFFC1F == 0xD63F0000:  # AArch64 BLR Xn
            indirect_calls.append(pc)
        destination = branch_target(pc, word)
        if destination is None:
            continue
        all_targets[destination] = all_targets.get(destination, 0) + 1
        if destination == NATIVE_WAIT:
            argument = read_word(image, pc - 4)
            running_ticks += {0x52803C01: 480, 0x52801E01: 240}[argument]
        elif destination == STAGE_HELPER:
            label, address = stage_helper_argument(image, pc)
            helpers.append({"site": hex(pc), "tick": running_ticks,
                            "beat": running_ticks / NATIVE_TICKS_PER_BEAT,
                            "original_argument": label, "string_rva": hex(address)})
        elif destination == MASK_HELPER:
            mask.append({"site": hex(pc), "tick": running_ticks})
        elif destination not in (NATIVE_STOPPED, ORIGINAL_RING_EMITTER):
            raise ValueError(f"Unrecognized direct Stage68 worker call to {destination:#x}")
    expected = {NATIVE_WAIT: 191, NATIVE_STOPPED: 191,
                ORIGINAL_RING_EMITTER: 34, STAGE_HELPER: 11, MASK_HELPER: 1}
    if all_targets != expected or len(helpers) != 11 or len(mask) != 1 or indirect_calls:
        raise ValueError("Original Stage68 worker native-call inventory drifted")
    original_sites = [int(pc, 16) for pc in original["native_emitter_call_sites"]]
    for helper in helpers:
        for tick, ring_pc in zip(original["original_ring_ticks"], original_sites):
            if tick == helper["tick"] and int(helper["site"], 16) >= ring_pc:
                raise ValueError("Original scene action occurs AFTER a simultaneous ring")
    return {
        "original_worker_entry": hex(WORKER_WINDOW_START),
        "verified_entry_arguments": {"x0": "Stage68 object", "x1": "original SeqThread"},
        "native_ticks_per_beat": NATIVE_TICKS_PER_BEAT,
        "native_ring_emits": original["original_ring_count"],
        "original_ring_ticks": original["original_ring_ticks"],
        "native_wait_calls": expected[NATIVE_WAIT],
        "native_stopped_calls": expected[NATIVE_STOPPED],
        "additional_stage_helper_calls": helpers,
        "special_mask_calculation": mask,
        "indirect_blr_calls": 0,
        "same_tick_scene_actions_precede_ring_emissions": True,
        "non_ring_callbacks_present": True,
        "full_worker_replacement_ready": False,
        "original_main_only": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_main", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists() or args.out.resolve() == args.private_main.resolve():
        parser.error("Output must be a new file, never the original main")
    image, _ = load_original_image(args.private_main)
    report = audit_original_worker(image)
    with args.out.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
        stream.write("\n")
    print("Stage68 verified: 34 rings, 11 other native calls, 1 dynamic mask. "
          "No hook installed.")


if __name__ == "__main__":
    main()
