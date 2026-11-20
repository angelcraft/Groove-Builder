"""Read-only audit of StageFactory 67's practice/showtime split.

This is NOT the Stage68 (Hoop 2) practice route. That earlier identification
was corrected by checking the original constructor and factory mapping. See
audit_hoop3_stage68_route.py for the correct Hoop 2 candidate.

Takes the user's own pinned NSO as input. No patches or installation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct


EXPECTED_MAIN_SHA = "494c35e74dae893615980134f8be7673779f8d4b9eb9601e0f1b130d5ee1870e"

# Minimal native evidence for StageFactory 67, not StageFactory 68.
WORDS = {
    0x1D2CE8: 0x97FFF1D6,  # Menu obtains the selected descriptor
    0x1D2D00: 0x7100041F,  # CMP availability with 1
    0x1D2D04: 0x540001AC,  # B.GT into confirmation path
    0x1D2EA4: 0xAA1403E0,  # MOV x0,x20 (menu scene)
    0x1D2EA8: 0xAA1503E1,  # MOV x1,x21 (selected descriptor)
    0x1D2EAC: 0x940000A1,  # BL confirmation/launch forwarding
    0x1D3154: 0xB9400021,  # LDR w1,[x1] (selected kind)
    0x1D315C: 0xB94006A2,  # LDR w2,[x21,#4] (selected index)
    0x428FBC: 0x97F44019,  # BL predicate wrapper at main+0x139020
    0x428FC0: 0x36000420,  # TBZ w0,bit0 -> tutorial block
    0x42900C: 0x940000C9,  # BL showtime setup 0x429330
    0x4290CC: 0x9400099D,  # BL tutorial 0x42b740
    0x4290EC: 0x17FFFFC3,  # B rejoin at 0x428ff8
    0x429488: 0x9403AFC6,  # BL worker registration 0x5153a0
    0x1306F0: 0xD0006328,  # Read the predicate's backing state
    0x1306F4: 0x52802029,  # MOV w9,#0x101
    0x1306F8: 0xF9402D08,
    0x1306FC: 0xF95D5108,
    0x130700: 0x79400108,
    0x130704: 0x6A09011F,  # TST w8,w9
    0x130708: 0x1A9F07E0,
    0x13070C: 0xD65F03C0,
}
SHOWTIME_SLOT = 0xD9C768
SHOWTIME_THREAD = 0x429750


class EvidenceMismatch(ValueError):
    """The binary differs from the pinned original or expected control flow."""


def u32(image: bytes | bytearray, offset: int) -> int:
    if offset < 0 or offset + 4 > len(image):
        raise EvidenceMismatch(f"Unmapped instruction at 0x{offset:x}")
    return struct.unpack_from("<I", image, offset)[0]


def branch_target(pc: int, word: int, *, link: bool) -> int:
    if word & 0xFC000000 != (0x94000000 if link else 0x14000000):
        raise EvidenceMismatch(f"Expected {'BL' if link else 'B'} at 0x{pc:x}")
    displacement = (word & 0x03FFFFFF) << 2
    if displacement & 0x08000000:
        displacement -= 0x10000000
    return pc + displacement


def tbz_target(pc: int, word: int) -> tuple[int, int, int]:
    if word & 0x7F000000 != 0x36000000:
        raise EvidenceMismatch(f"Expected TBZ at 0x{pc:x}")
    reg = word & 31
    bit = (word >> 19) & 31 | ((word >> 31) & 1) << 5
    displacement = ((word >> 5) & 0x3FFF) << 2
    if displacement & 0x8000:
        displacement -= 0x10000
    return pc + displacement, reg, bit


def audit_image(image: bytes | bytearray) -> dict:
    for pc, word in WORDS.items():
        if u32(image, pc) != word:
            raise EvidenceMismatch(f"Original opcode differs at 0x{pc:x}")
    if SHOWTIME_SLOT + 8 > len(image) or struct.unpack_from("<Q", image, SHOWTIME_SLOT)[0] != SHOWTIME_THREAD:
        raise EvidenceMismatch("Hoop 2 showtime worker registration slot changed")
    if branch_target(0x428FBC, u32(image, 0x428FBC), link=True) != 0x139020:
        raise EvidenceMismatch("Unexpected predicate call")
    target, reg, bit = tbz_target(0x428FC0, u32(image, 0x428FC0))
    if (target, reg, bit) != (0x429044, 0, 0):
        raise EvidenceMismatch("Unexpected tutorial branch")
    for pc, expected, link in (
        (0x1D2CE8, 0x1CF440, True),
        (0x1D2EAC, 0x1D3130, True),
        (0x42900C, 0x429330, True),
        (0x4290CC, 0x42B740, True),
        (0x4290EC, 0x428FF8, False),
        (0x429488, 0x5153A0, True),
    ):
        if branch_target(pc, u32(image, pc), link=link) != expected:
            raise EvidenceMismatch(f"Unexpected control flow at 0x{pc:x}")
    return {
        "kind": "native_stage67_practice_showtime_control_readonly",
        "stage_factory_id": 67,
        "main_sha256_required": EXPECTED_MAIN_SHA,
        "predicate_callsite": "0x428fbc",
        "predicate_wrapper": "0x139020",
        "predicate_state_check": "0x1306f0",
        "predicate_mask": "0x101",
        "menu_confirm_gate": "0x1d2d00 CMP availability,1; 0x1d2d04 B.GT",
        "menu_launch_forward": "0x1d2eac -> 0x1d3130 (x0=scene, x1=selected descriptor)",
        "branch": "0x428fc0",
        "when_bit0_clear": "tutorial path at 0x429044, BL 0x42b740 at 0x4290cc",
        "tutorial_rejoins": "0x4290ec -> 0x428ff8",
        "when_bit0_set": "showtime setup at 0x428ff8, BL 0x429330 at 0x42900c",
        "showtime_worker": "0x429750 (slot 0xd9c768)",
        "practices_skipped_on_hardware": False,
        "hook_installed": False,
        "scoped_launch_origin_proven": False,
        "limitations": [
            "This worker belongs to StageFactory 67, not Stage68 (Hoop 2).",
            "The bit-0 predicate reads global state; its exact semantic meaning is unknown.",
            "Hoop 3 and original Hoop 2 currently share a menu launch identity.",
            "A future bypass MUST have an independently verified launch-origin scope and cleanup.",
            "No global predicate override, blanket branch patch or save mutation is authorized.",
        ],
    }


def load_original(path: Path) -> bytes:
    blob = path.read_bytes()
    if hashlib.sha256(blob).hexdigest() != EXPECTED_MAIN_SHA:
        raise EvidenceMismatch("Unexpected Switch main SHA-256")
    if blob[:4] != b"NSO0":
        raise EvidenceMismatch("Expected NSO0")
    # Import only for the private-original audit. The public unit tests do not
    # need game files or third-party decompression modules.
    import lz4.block

    flags = struct.unpack_from("<I", blob, 0xC)[0]
    segments = []
    for index in range(3):
        file_pos, memory_pos, uncompressed = struct.unpack_from("<III", blob, 0x10 + 0x10 * index)
        stored = struct.unpack_from("<I", blob, 0x60 + 4 * index)[0] if flags & (1 << index) else uncompressed
        if file_pos + stored > len(blob):
            raise EvidenceMismatch("Segment exceeds NSO file")
        chunk = blob[file_pos:file_pos + stored]
        if flags & (1 << index):
            chunk = lz4.block.decompress(chunk, uncompressed_size=uncompressed)
        if len(chunk) != uncompressed:
            raise EvidenceMismatch("Unexpected decompressed size")
        segments.append((memory_pos, chunk))
    size = max(base + len(data) for base, data in segments)
    image = bytearray(size)
    for base, data in segments:
        image[base:base + len(data)] = data
    return bytes(image)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main", type=Path, help="Original personal NSO, read-only")
    args = parser.parse_args()
    try:
        result = audit_image(load_original(args.main))
    except (EvidenceMismatch, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
