"""Read-only original-game NPDM FS rights check for Groove's SD strategy.

Uses the META/ACI0/ACID/FAC/FAH layouts documented by SciresM's hactool.
Never emits or modifies a proprietary NPDM, and never grants permissions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct


ORIGINAL_NPDM_SHA256 = "9ac7be05fbefa81857e23f43b905ba4efad38f948b02bfc842b844b9b6edd5cd"
ORIGINAL_PROGRAM_ID = 0x0100D9F01D474000
SD_FS_ACCESS = 0x0000000000200000
DEBUG_ONLY_FLAG = 0x4000000000000000


def u32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise ValueError("NPDM field outside file")
    return struct.unpack_from("<I", data, offset)[0]


def u64(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 8 > len(data):
        raise ValueError("NPDM field outside file")
    return struct.unpack_from("<Q", data, offset)[0]


def section(data: bytes, offset: int, size: int) -> None:
    if size == 0 or offset < 0 or offset > len(data) or size > len(data) - offset:
        raise ValueError("NPDM section outside file")


def analyze_npdm(data: bytes, expected_sha: str) -> dict:
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError("Private main.npdm SHA mismatch")
    if len(data) < 0x80 or data[:4] != b"META":
        raise ValueError("Not a valid NPDM META")
    aci0_offset, aci0_size, acid_offset, acid_size = (
        u32(data, 0x70), u32(data, 0x74), u32(data, 0x78), u32(data, 0x7C))
    section(data, aci0_offset, aci0_size)
    section(data, acid_offset, acid_size)
    if data[aci0_offset:aci0_offset + 4] != b"ACI0" or aci0_size < 0x40 or \
       data[acid_offset + 0x200:acid_offset + 0x204] != b"ACID" or acid_size < 0x240:
        raise ValueError("Invalid ACI0/ACID region")
    if u64(data, aci0_offset + 0x10) != ORIGINAL_PROGRAM_ID:
        raise ValueError("Unexpected program identity")
    fah_relative, fah_size = u32(data, aci0_offset + 0x20), u32(data, aci0_offset + 0x24)
    fac_relative, fac_size = u32(data, acid_offset + 0x220), u32(data, acid_offset + 0x224)
    if (fah_relative + fah_size > aci0_size or fac_relative + fac_size > acid_size or
            fah_size < 12 or fac_size < 12):
        raise ValueError("Filesystem control bounds invalid")
    fah = aci0_offset + fah_relative
    fac = acid_offset + fac_relative
    if u32(data, fah) != u32(data, fac):
        raise ValueError("Filesystem control version mismatch")
    effective = u64(data, fah + 4) & u64(data, fac + 4)
    return {
        "program_id": hex(ORIGINAL_PROGRAM_ID),
        "effective_fs_permissions": hex(effective),
        "sd_fs_access_bit_present": bool(effective & SD_FS_ACCESS),
        "debug_only_flag_present": bool(effective & DEBUG_ONLY_FLAG),
        "direct_sd_open_proven": False,
        "safe_to_patch_npdm": False,
        "recommended_next_probe": "Read-only ROMFS LayeredFS overlay; original title permissions unchanged",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original_npdm", type=Path)
    args = parser.parse_args()
    print(json.dumps(analyze_npdm(args.original_npdm.read_bytes(), ORIGINAL_NPDM_SHA256),
                     indent=2))


if __name__ == "__main__":
    main()
