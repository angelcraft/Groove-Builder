"""Read-only proof that all 80 native kind=1 game descriptor slots are owned.

Hoop 3's visual grid cell is new, but its current launch descriptor (1,41)
still belongs to the original Ring 2. Index 75 is Remix 16, NOT a free slot.
Only inspect a hash-pinned user-owned original NSO; never change the file.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

from audit_hoop3_practice_path import EXPECTED_MAIN_SHA, EvidenceMismatch, load_original, u32


WORDS = {
    0x1CBC60: 0xD0005E68,  # descriptor kind1 getter
    0x1CBC64: 0x52800609,  # stride = 0x30 bytes
    0x1CBC68: 0xF943AD08,  # GOT descriptor kind1 base
    0x1CBC6C: 0x9B292000,  # base + index * stride
    0x1CBC80: 0xD0005E68,  # descriptor kind2 getter
    0x1CBC84: 0x52800609,
    0x1CBC88: 0xF943B108,
    0x1CBC8C: 0x9B292000,
    0x3F90: 0x8B22D008,    # manager kind1 status table: 16-byte stride
    0x3F94: 0x3956A100,
    0x3F9C: 0x8B22CC08,    # next kind2 status table starts at +0xaa8
    0x3FA0: 0x396AA100,
}

KIND1_BASE_GOT = 0xD99758
KIND2_BASE_GOT = 0xD99760
KIND1_BASE = 0xD19108
KIND2_BASE = 0xD1A008
KIND1_COUNT = 80
STRIDE = 0x30

EXPECTED_OWNERS = {
    40: "graph/prologue/ring/type_00/prologue",
    41: "graph/prologue/ring/type_01/prologue",
    75: "graph/prologue/remix/type_15/prologue",
    76: "graph/prologue/remix/type_16/prologue",
    77: "graph/prologue/remix/type_17/prologue",
    78: "graph/prologue/remix/type_18/prologue",
    79: "graph/prologue/remix/type_19/prologue",
}


def descriptor_path(image: bytes | bytearray, address: int) -> str:
    if address < 0 or address + 1 >= len(image):
        raise EvidenceMismatch("Descriptor path points outside the original image")
    end = image.find(b"\x00", address, address + 144)
    if end < 0:
        raise EvidenceMismatch("No terminated descriptor path")
    try:
        result = image[address:end].decode("ascii")
    except UnicodeError as exc:
        raise EvidenceMismatch("Non-ASCII descriptor path") from exc
    if not result.startswith("graph/prologue/") or not result.endswith("/prologue"):
        raise EvidenceMismatch("Unexpected descriptor resource classification")
    return result


def audit_image(image: bytes | bytearray) -> dict:
    for pc, word in WORDS.items():
        if u32(image, pc) != word:
            raise EvidenceMismatch(f"Original catalog instruction differs at 0x{pc:x}")

    for pointer, expected in ((KIND1_BASE_GOT, KIND1_BASE), (KIND2_BASE_GOT, KIND2_BASE)):
        if pointer + 8 > len(image) or struct.unpack_from("<Q", image, pointer)[0] != expected:
            raise EvidenceMismatch(f"Original descriptor table pointer differs at 0x{pointer:x}")

    if KIND1_BASE + KIND1_COUNT * STRIDE != KIND2_BASE:
        raise EvidenceMismatch("Kind1 descriptor capacity is not 80 records")

    resource_paths = []
    for index in range(KIND1_COUNT):
        base = KIND1_BASE + index * STRIDE
        if base + STRIDE > len(image):
            raise EvidenceMismatch("Truncated descriptor array")
        kind, recorded_index = struct.unpack_from("<II", image, base)
        if (kind, recorded_index) != (1, index):
            raise EvidenceMismatch(f"Missing or aliased kind1 descriptor {index}")
        ptr = struct.unpack_from("<Q", image, base + 0x20)[0]
        resource_paths.append(descriptor_path(image, ptr))

    if len(set(resource_paths)) != KIND1_COUNT:
        raise EvidenceMismatch("Original kind1 resource ownership is not unique")
    for index, expected_path in EXPECTED_OWNERS.items():
        if resource_paths[index] != expected_path:
            raise EvidenceMismatch(f"Original owner of descriptor {index} changed")

    return {
        "kind": "hoop3_native_catalog_ownership_readonly",
        "main_sha256_required": EXPECTED_MAIN_SHA,
        "kind1_descriptor_count": KIND1_COUNT,
        "kind1_valid_unique_resource_paths": KIND1_COUNT,
        "kind1_descriptor_stride": STRIDE,
        "next_catalog_base": hex(KIND2_BASE),
        "known_original_owners": {str(i): path for i, path in EXPECTED_OWNERS.items()},
        "new_cell_origin": [1, 9, 0],
        "new_cell_current_alias": [1, 41],
        "unallocated_native_kind1_slots_proven": 0,
        "new_unique_game_identity_created": False,
        "patch_installed": False,
        "limitations": [
            "Every kind1 descriptor has an original resource path; not all paths prove playable content.",
            "An additional game requires a separately routed identity or an expanded catalog.",
            "Changing descriptor 75 would replace original Remix 16, not add Hoop 3.",
            "No title/resource/gameplay/score extension is installed or executed.",
        ],
    }


def emulate_original_accessor(image: bytes | bytearray) -> dict[str, str]:
    """Optionally execute the original kind1 ARM64 pointer calculation.

    This does NOT dereference index 80 or demonstrate the game can use it.
    It confirms that the unguarded lookup would reach the next descriptor
    family's base address, so it cannot be treated as an empty new slot.
    """
    audit_image(image)
    from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM
    from unicorn.arm64_const import UC_ARM64_REG_PC, UC_ARM64_REG_W0, UC_ARM64_REG_X0

    destinations = {}
    for idx, expected in ((40, KIND1_BASE + 40 * STRIDE),
                          (41, KIND1_BASE + 41 * STRIDE),
                          (75, KIND1_BASE + 75 * STRIDE),
                          (79, KIND1_BASE + 79 * STRIDE),
                          (80, KIND2_BASE)):
        machine = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        machine.mem_map(0x1CB000, 0x1000)
        machine.mem_write(0x1CB000, image[0x1CB000:0x1CC000])
        machine.mem_map(0xD99000, 0x1000)
        machine.mem_write(0xD99000, image[0xD99000:0xD9A000])
        machine.reg_write(UC_ARM64_REG_W0, idx)
        machine.emu_start(0x1CBC60, 0x1CBC70, count=4)
        actual = machine.reg_read(UC_ARM64_REG_X0)
        if actual != expected or machine.reg_read(UC_ARM64_REG_PC) != 0x1CBC70:
            raise EvidenceMismatch(f"Unexpected native descriptor pointer for index {idx}")
        destinations[str(idx)] = hex(actual)
    return destinations


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main", type=Path, help="Your own unmodified Switch main NSO")
    parser.add_argument("--unicorn", action="store_true", help="Execute five native descriptor lookups")
    args = parser.parse_args()
    try:
        image = load_original(args.main)
        report = audit_image(image)
        if args.unicorn:
            report["unicorn_native_pointer_results"] = emulate_original_accessor(image)
        print(json.dumps(report, indent=2))
    except (EvidenceMismatch, ValueError, RuntimeError, ImportError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
