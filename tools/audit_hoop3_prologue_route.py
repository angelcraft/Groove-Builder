"""Read-only check of original Hoop prologue assets and native selection path.

Accepts a private local main and the user's own prologue archive; never
generates or installs a modified game resource. Outputs hashes and control-flow
facts only, not sprite or texture bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path
from zipfile import ZipFile

from audit_hoop3_practice_path import (
    EvidenceMismatch, EXPECTED_MAIN_SHA, branch_target, load_original, u32,
)


# Static AArch64 instructions from the exact pinned original. In particular,
# the menu passes both 32-bit descriptor words to the shared prologue router.
WORDS = {
    0x1D3160: 0xAA0003F3,  # MOV x19,x0 (original menu Scene)
    0x1D3380: 0x294006A0,  # LDP w0,w1,[x21] (kind, index)
    0x1D3384: 0x9400CE5F,  # BL main+0x206d00
    0x1D2FA0: 0x9400CF58,  # Special kind0/index8 route
    0x206D00: 0xA9BE7BFD,  # Router function entry
    0x206D10: 0x7100081F,  # CMP w0,#2
    0x206D18: 0x7100041F,  # CMP w0,#1
    0x206D50: 0x2A1403E1,  # MOV w1,w20 (kind1 index)
    0x206D60: 0x97FF13C0,  # BL kind1 resource table getter
    0x206D7C: 0xF9401008,  # LDR path from table entry +0x20
    0x206D80: 0xB9402809,  # LDR accompanying resource index
    0x206D94: 0x52802BC9,  # MOV w9,#0x15e (special kind0/index8)
    0x206D98: 0xF00043C8,  # ADRP type_02 path
    0x206D9C: 0x9123A508,  # ADD address of type_02 path
}

ASSET_TYPES = ("type_00", "type_01", "type_02")


def audit_image(image: bytes | bytearray) -> dict:
    for pc, expected in WORDS.items():
        if u32(image, pc) != expected:
            raise EvidenceMismatch(f"Prologue opcode differs at 0x{pc:x}")
    if branch_target(0x1D3384, u32(image, 0x1D3384), link=True) != 0x206D00:
        raise EvidenceMismatch("Menu prologue forwarding target changed")
    if branch_target(0x1D2FA0, u32(image, 0x1D2FA0), link=True) != 0x206D00:
        raise EvidenceMismatch("Special prologue forwarding target changed")
    if branch_target(0x206D60, u32(image, 0x206D60), link=True) != 0x1CBC60:
        raise EvidenceMismatch("Kind1 table getter target changed")
    for variant, offset in (("type_00", 0xA9744A),
                            ("type_01", 0xAD0C5C),
                            ("type_02", 0xA818E9)):
        literal = f"graph/prologue/ring/{variant}/prologue\0".encode()
        if image[offset:offset + len(literal)] != literal:
            raise EvidenceMismatch(f"Original {variant} path differs")
    return {
        "main_sha256_required": EXPECTED_MAIN_SHA,
        "kind1_resource_path": "main+0x206d50 -> 0x1cbc60 -> table+0x20",
        "menu_descriptor_forward": "main+0x1d3380/84 passes original kind/index to 0x206d00",
        "menu_scene_register": "main+0x1d3160 copies incoming Scene to x19; no clobber before 0x1d3384",
        "type02_direct_case": "kind0/index8 at main+0x206d94/9c; NOT evidence of Hoop3",
        "custom_intro_hook_installed": False,
        "intro_digit_source_proven": False,
    }


def inspect_archive(path: Path) -> dict:
    with ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise EvidenceMismatch("Archive has duplicate entries")
        roots = ("prologue/ring/", "graph/prologue/ring/")
        found = []
        for root in roots:
            if all(f"{root}{variant}/prologue.{ext}" in names
                   for variant in ASSET_TYPES for ext in ("spr", "tex")):
                found.append(root)
        if len(found) != 1:
            raise EvidenceMismatch("Expected one complete ring prologue resource set")
        root = found[0]
        report = {}
        for variant in ASSET_TYPES:
            report[variant] = {}
            for ext in ("spr", "tex"):
                entry = archive.getinfo(f"{root}{variant}/prologue.{ext}")
                if not 0 < entry.file_size <= 32 * 1024 * 1024:
                    raise EvidenceMismatch("Unbounded prologue asset")
                payload = archive.read(entry)
                info = {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
                if ext == "spr":
                    if len(payload) < 0x110 or struct.unpack_from("<I", payload)[0] & 1:
                        raise EvidenceMismatch("Invalid original SPR header")
                    info["parts"] = struct.unpack_from("<I", payload, 0x1C)[0]
                report[variant][ext] = info
        return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main", type=Path, help="Local original NSO; read-only")
    parser.add_argument("prologue_zip", type=Path, help="Private original prologue.zip")
    args = parser.parse_args()
    try:
        result = {"native_route": audit_image(load_original(args.main)),
                  "assets": inspect_archive(args.prologue_zip)}
    except (EvidenceMismatch, OSError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
