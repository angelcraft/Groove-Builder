"""Read-only evidence for a *Stage68-specific* Hoop 3 practice-skip candidate.

This corrects an important identity mix-up: the earlier 0x428fc0 route is
inside StageFactory 67, whereas borrowed Hoop 2 uses StageFactory 68.
The original private NSO is accepted only by hash and is never modified.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

from audit_hoop3_practice_path import (
    EXPECTED_MAIN_SHA,
    EvidenceMismatch,
    branch_target,
    load_original,
    tbz_target,
    u32,
)


# Small, independently pinned instruction anchors, NOT an executable patch.
WORDS = {
    0x488DC4: 0x528F5B00,  # StageFactory case 68: allocation size
    0x488DC8: 0x94015D4A,  # allocator
    0x488DE4: 0xAA0003F6,  # x22 = freshly allocated Stage68 pointer
    0x488DE8: 0x97FE8C2E,  # original Stage68 constructor
    0x488DEC: 0x140005DF,  # shared factory return
    0x48A568: 0xAA1603E0,  # return original x22 pointer
    0x42BEBC: 0xAA0003F3,  # constructor x19 = x0 (Stage68 object)
    0x42BED4: 0x52859298,  # x24 = object-local flag offset 0x2c94
    0x42BEF8: 0x38386A7F,  # initialize that byte to zero
    0x42BEFC: 0xF9000269,  # install Stage68 vtable in object
    0x42BFE0: 0x38386A68,  # conditionally set byte to one
    0x42C0B0: 0xF9014688,  # register native Stage68 worker pointer
    0x42C0D4: 0xAA0003F4,  # worker x20 = object x0
    0x42C170: 0x52859295,  # worker x21 = offset 0x2c94
    0x42C190: 0x38756A88,  # read object-local flag
    0x42C194: 0x7100051F,  # compare against one
    0x42C198: 0x540008A1,  # !=1: bypass preliminary branch
    0x42C208: 0x97F43386,  # original shared global predicate
    0x42C20C: 0x37000560,  # other preliminary branch condition
    0x42C2A4: 0x94000AB7,  # preliminary worker 0x42ed80
    0x42C2AC: 0xAA1403E0,  # normal route starts with stage pointer
    0x42C2B4: 0x36000420,  # predicate branch on normal route
    0x42C300: 0x940000D8,  # regular worker at 0x42c660
    0x42DE78: 0x52859288,  # object flag ALSO used later in gameplay
    0x42DE7C: 0x38686A88,
    0x42E4A0: 0x52859288,  # another later flag read
    0x42E4A4: 0x38686A88,
}

STAGE68_VTABLE_GOT = 0xD9C780
STAGE68_VTABLE_BASE = 0xD4D4A0
STAGE68_VTABLE_INSTALLED = STAGE68_VTABLE_BASE + 0x10
STAGE68_WORKER_GOT = 0xD9C798
STAGE68_WORKER = 0x42C0C0
STAGE67_WORKER_GOT = 0xD9C760
STAGE67_WORKER = 0x428EF0
FLAG_OFFSET = 0x2C94


def audit_image(image: bytes | bytearray) -> dict:
    for pc, expected in WORDS.items():
        if u32(image, pc) != expected:
            raise EvidenceMismatch(f"Original Stage68 anchor differs at 0x{pc:x}")

    for offset, expected in (
        (STAGE68_VTABLE_GOT, STAGE68_VTABLE_BASE),
        (STAGE68_WORKER_GOT, STAGE68_WORKER),
        (STAGE67_WORKER_GOT, STAGE67_WORKER),
    ):
        if offset + 8 > len(image) or struct.unpack_from("<Q", image, offset)[0] != expected:
            raise EvidenceMismatch(f"Native pointer mismatch at 0x{offset:x}")

    for pc, expected, link in (
        (0x488DC8, 0x4E02F0, True),
        (0x488DE8, 0x42BEA0, True),
        (0x488DEC, 0x48A568, False),
        (0x42C208, 0x139020, True),
        (0x42C2A4, 0x42ED80, True),
        (0x42C300, 0x42C660, True),
    ):
        if branch_target(pc, u32(image, pc), link=link) != expected:
            raise EvidenceMismatch(f"Unexpected Stage68 call at 0x{pc:x}")

    # B.NE uses imm19, unlike the TBZ/TBNZ decoder.
    instruction = u32(image, 0x42C198)
    disp = ((instruction >> 5) & 0x7FFFF) << 2
    if disp & 0x100000:
        disp -= 0x200000
    if (0x42C198 + disp) != 0x42C2AC:
        raise EvidenceMismatch("Unexpected Stage68 flag-branch target")

    target, reg, bit = tbz_target(0x42C2B4, u32(image, 0x42C2B4))
    if (target, reg, bit) != (0x42C338, 0, 0):
        raise EvidenceMismatch("Unexpected Stage68 ordinary route")

    return {
        "kind": "native_stage68_practice_route_readonly",
        "main_sha256_required": EXPECTED_MAIN_SHA,
        "stage_factory_id": 68,
        "stage_constructor": "0x42bea0",
        "factory_object_from": "0x488de4 x22 <- allocation result",
        "factory_object_return": "0x48a568 x0 <- x22",
        "stage_vtable": hex(STAGE68_VTABLE_INSTALLED),
        "stage_worker": "0x42c0c0 (distinct from Stage67's 0x428ef0)",
        "candidate_branch": "0x42c198: Stage68+[0x2c94]!=1 -> 0x42c2ac",
        "preliminary_worker": "0x42ed80",
        "ordinary_worker": "0x42c660",
        "later_flag_reads": ["0x42de7c", "0x42e4a4"],
        "scoped_origin_verified": False,
        "hook_installed": False,
        "safe_to_install": False,
        "limitations": [
            "Stage67's earlier 0x428fc0 route must NOT be treated as Stage68.",
            "The Stage68 flag affects late gameplay as well as the preliminary path; changing it globally is unsafe.",
            "Menu origin must be correlated through the asynchronous transition.",
            "A safe runtime patch, lifetime checks and Switch A/B are still missing.",
        ],
    }


def emulate_original_branch(image: bytes | bytearray) -> dict[str, str]:
    """Optionally execute THREE unmodified original ARM64 instructions.

    No menu transition, graphics, practice worker or Switch is emulated; this
    only proves what the actual Stage68 flag branch does for its three inputs.
    """
    audit_image(image)
    from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM
    from unicorn.arm64_const import UC_ARM64_REG_PC, UC_ARM64_REG_X20, UC_ARM64_REG_X21

    observed = {}
    for flag, expected in ((0, 0x42C2AC), (1, 0x42C19C), (2, 0x42C2AC)):
        machine = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        machine.mem_map(0x42C000, 0x1000)
        machine.mem_write(0x42C000, image[0x42C000:0x42D000])
        machine.mem_map(0x70000000, 0x8000)
        machine.mem_write(0x70000000 + FLAG_OFFSET, bytes((flag,)))
        machine.reg_write(UC_ARM64_REG_X20, 0x70000000)
        machine.reg_write(UC_ARM64_REG_X21, FLAG_OFFSET)
        machine.emu_start(0x42C190, 0x42C300, count=3)
        actual = machine.reg_read(UC_ARM64_REG_PC)
        if actual != expected:
            raise EvidenceMismatch(f"Unexpected native Stage68 branch for flag {flag}")
        observed[str(flag)] = hex(actual)
    return observed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main", type=Path, help="Your own unmodified Switch main NSO")
    parser.add_argument("--unicorn", action="store_true", help="Also execute the native branch in Unicorn")
    args = parser.parse_args()
    try:
        image = load_original(args.main)
        report = audit_image(image)
        if args.unicorn:
            report["unicorn_original_branch_targets"] = emulate_original_branch(image)
        print(json.dumps(report, indent=2))
    except (EvidenceMismatch, ValueError, RuntimeError, ImportError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
