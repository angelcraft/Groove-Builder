"""Read-only audit of the game's own last-confirmed menu coordinates.

World/column/row are copied from the menu Scene into a persistent manager on
confirmation. This may allow a scoped Hoop3 discriminator at Stage68, but the
manager's lifetime across scene transitions is NOT yet physically verified.

Only accepts the pinned user-owned original main; never edits or packages it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

from audit_hoop3_practice_path import (
    EXPECTED_MAIN_SHA, EvidenceMismatch, branch_target, load_original, u32,
)


# Every native opcode below was checked against the exact user's main NSO.
# This is deliberately a *small* set: a different binary must fail closed.
WORDS = {
    0x4860: 0x8B21C008,  # add x8,x0,w1,sxtw: manager + mode
    0x4864: 0x39EE6109,  # signed byte: world at +0xb98
    0x486C: 0x39EE6909,  # signed byte: column at +0xb9a
    0x4874: 0x39EE7109,  # signed byte: row at +0xb9c
    0x487C: 0x39EE7908,  # signed byte: extra at +0xb9e
    0x4890: 0x8B21C008,  # add x8,x0,w1,sxtw
    0x4894: 0x392E6102,  # strb w2,[x8,#0xb98] (world)
    0x4898: 0x392E6903,  # strb w3,[x8,#0xb9a] (column)
    0x489C: 0x392E7104,  # strb w4,[x8,#0xb9c] (row)
    0x48A0: 0x392E7905,  # strb w5,[x8,#0xb9e]
    0x48A4: 0xD65F03C0,  # ret
    0x48B0: 0x8B21C408,  # index setter uses manager + mode*2
    0x48B8: 0x79174102,  # strh w2,[x8,#0xba0]: native index
    0x4910: 0xB9690408,  # ldr w8,[manager,#0x2904] (active mode)
    0x4918: 0x8B080409,  # manager + mode*2
    0x491C: 0x79D74129,  # ldrsh w9,[x9,#0xba0]: native index
    0x1D2EAC: 0x940000A1,  # BL 0x1d3130, selected descriptor
    0x1D2EB0: 0x91401695,  # add x21,x20,#0x5000: Scene subobject
    0x1D2EB4: 0x90005E20,  # ADRP manager singleton
    0x1D2EB8: 0xB96A3A81,  # scene mode at +0x2a38
    0x1D2EBC: 0xB94276A2,  # world at Scene+0x5274
    0x1D2EC0: 0xB9429AA3,  # column at Scene+0x5298
    0x1D2EC4: 0xB9429EA4,  # row at Scene+0x529c
    0x1D2EC8: 0xB942A2A5,  # extra at Scene+0x52a0
    0x1D2ECC: 0xF9402C00,  # ldr singleton manager from +0x58
    0x1D2ED0: 0x97F8C670,  # BL 0x4890 (save coordinates)
    0x1D342C: 0x97FFF031,  # BL 0x1cf4f0 (active mode)
    0x1D3430: 0xB9290680,  # str w0,[manager,#0x2904]
    0x1D343C: 0xB94006A2,  # selected native index
    0x1D3440: 0x2A0003E1,  # mov w1,w0 (mode)
    0x1D3444: 0xAA1403E0,  # mov x0,x20 (manager)
    0x1D344C: 0x97F8C519,  # BL 0x48b0 (save index)
    0x1CF294: 0x97F8D57F,  # menu update can ALSO write coordinates
    0x1D1614: 0x97F8CC9F,  # other menu exit can ALSO write coordinates
    0x1CE03C: 0x97F8DA09,  # menu restore reads coordinates
}

TARGETS = {
    0x1D2EAC: 0x1D3130,
    0x1D2ED0: 0x4890,
    0x1D344C: 0x48B0,
    0x1CF294: 0x4890,
    0x1D1614: 0x4890,
    0x1CE03C: 0x4860,
}


def direct_calls(image: bytes | bytearray, target: int, text_end: int = 0xA66BF0) -> list[int]:
    """Scan original .text only; detect all immediate BL calls to target."""
    found = []
    for address in range(0, min(text_end, len(image) - 3), 4):
        word = u32(image, address)
        if word & 0xFC000000 == 0x94000000 and branch_target(address, word, link=True) == target:
            found.append(address)
    return found


def audit_image(image: bytes | bytearray) -> dict:
    for offset, expected in WORDS.items():
        if u32(image, offset) != expected:
            raise EvidenceMismatch(f"Original menu context opcode differs at 0x{offset:x}")
    for caller, target in TARGETS.items():
        if branch_target(caller, u32(image, caller), link=True) != target:
            raise EvidenceMismatch(f"Unexpected native call target from 0x{caller:x}")
    # An unexpected writer may invalidate the assumption that saved menu
    # coordinates stay stable across the asynchronous Stage68 creation.
    for target, expected in (
        (0x4890, [0x1CF294, 0x1D1614, 0x1D2ED0]),
        (0x4860, [0x1CE03C]),
    ):
        actual = direct_calls(image, target)
        if actual != expected:
            raise EvidenceMismatch(f"Additional/missing menu coordinate callsite for 0x{target:x}: {actual}")

    return {
        "type": "original_native_menu_record_read_only",
        "main_sha256_required": EXPECTED_MAIN_SHA,
        "confirmed_launch": "0x1d2eac -> 0x1d3130",
        "save_coordinates_after_confirmation": "0x1d2ed0 -> 0x4890",
        "mode_source": "Scene+0x2a38 at 0x1d2eb8",
        "manager_singleton": "*(main+0xd96058)",
        "world_address": "manager+0xb98+mode",
        "column_address": "manager+0xb9a+mode",
        "row_address": "manager+0xb9c+mode",
        "active_mode": "manager+0x2904 (set at 0x1d3430)",
        "selected_index": "manager+0xba0+2*mode (set at 0x1d344c)",
        "other_coordinate_writers": [hex(0x1CF294), hex(0x1D1614)],
        "restore_reader": hex(0x1CE03C),
        "stage68_can_read_manager_snapshot": "code candidate, not called in game",
        "scene_transition_stability_verified": False,
        "safe_to_install_scoped_practice_skip": False,
        "notes": [
            "Coordinates are saved after the confirmation forwarding call.",
            "The two other direct writers must be proven inactive before the Stage68 branch.",
            "Indirect calls or other byte writes have not been exhaustively excluded.",
            "No proof yet that the active mode or saved coordinates survive loading/cancel/reentry.",
        ],
    }


def emulate_original_round_trip(image: bytes | bytearray) -> dict[str, dict]:
    """Execute original ARM64 coordinate setter/getter, without scene logic."""
    from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM
    from unicorn.arm64_const import (
        UC_ARM64_REG_LR, UC_ARM64_REG_W1, UC_ARM64_REG_W2,
        UC_ARM64_REG_W3, UC_ARM64_REG_W4, UC_ARM64_REG_W5,
        UC_ARM64_REG_X0, UC_ARM64_REG_X2, UC_ARM64_REG_X3,
        UC_ARM64_REG_X4, UC_ARM64_REG_X5,
    )

    seen = {}
    for mode, world, column, row in ((0, 1, 9, 0), (1, 1, 9, 0), (0, 0, 8, 4), (1, 2, 7, 3)):
        machine = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        machine.mem_map(0x4000, 0x1000)
        machine.mem_write(0x4000, image[0x4000:0x5000])
        machine.mem_map(0x70000000, 0x10000)
        machine.mem_map(0x70010000, 0x1000)
        machine.reg_write(UC_ARM64_REG_X0, 0x70000000)
        machine.reg_write(UC_ARM64_REG_W1, mode)
        machine.reg_write(UC_ARM64_REG_W2, world)
        machine.reg_write(UC_ARM64_REG_W3, column)
        machine.reg_write(UC_ARM64_REG_W4, row)
        machine.reg_write(UC_ARM64_REG_W5, 4)
        machine.reg_write(UC_ARM64_REG_LR, 0x48A8)
        machine.emu_start(0x4890, 0x48A8, count=6)

        machine.reg_write(UC_ARM64_REG_X0, 0x70000000)
        machine.reg_write(UC_ARM64_REG_W1, mode)
        for reg, address in zip(
            (UC_ARM64_REG_X2, UC_ARM64_REG_X3, UC_ARM64_REG_X4, UC_ARM64_REG_X5),
            (0x70010000, 0x70010004, 0x70010008, 0x7001000C),
        ):
            machine.reg_write(reg, address)
        machine.reg_write(UC_ARM64_REG_LR, 0x4884)
        machine.emu_start(0x4860, 0x4884, count=9)
        values = struct.unpack("<iiii", machine.mem_read(0x70010000, 16))
        if values != (world, column, row, 4):
            raise EvidenceMismatch(f"Native coordinate roundtrip mismatch: {values}")
        seen[f"mode{mode}/w{world}c{column}r{row}"] = dict(
            zip(("world", "column", "row", "other"), values)
        )
    return seen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main", type=Path, help="Your original unmodified main NSO")
    parser.add_argument("--unicorn", action="store_true", help="Execute original save/restore functions")
    args = parser.parse_args()
    image = load_original(args.main)
    report = audit_image(image)
    if args.unicorn:
        report["original_arm64_round_trips"] = emulate_original_round_trip(image)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
