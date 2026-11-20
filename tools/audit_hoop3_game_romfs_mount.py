"""Read-only audit of the original game's existing nn::fs::MountRom name.

Uses the SHA-pinned owner-supplied original main. Confirms the original
query/mount call-site branch targets and resolves its literal mount label.
No Nintendo assets/binary are emitted, modified or committed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from audit_hoop3_worker_contract import decode_adrp_target, decode_add_literal
from recover_hoop3_original_rings import branch_target, load_original_image, read_word


QUERY_CACHE_CALL = 0x50B894
QUERY_CACHE_PLT = 0xA66360
MOUNT_ROM_CALL = 0x50B8B4
MOUNT_ROM_PLT = 0xA66370
MOUNT_NAME_PAGE = 0x50B8AC
MOUNT_NAME_ADD = 0x50B8B0
EXPECTED_MOUNT_NAME = "data"


def audit_original_mount(image: bytes) -> dict:
    if len(image) <= MOUNT_NAME_ADD + 4:
        raise ValueError("Original main is too short for RomFS mount sites")
    for site, target in ((QUERY_CACHE_CALL, QUERY_CACHE_PLT),
                         (MOUNT_ROM_CALL, MOUNT_ROM_PLT)):
        if branch_target(site, read_word(image, site)) != target:
            raise ValueError(f"Original nn::fs call site drifted at {site:#x}")
    pc = MOUNT_NAME_PAGE
    page = decode_adrp_target(pc, read_word(image, pc), 0)
    name_address = page + decode_add_literal(read_word(image, MOUNT_NAME_ADD), 0)
    if name_address < 0 or name_address + 5 > len(image) or \
       image[name_address:name_address + 5] != b"data\0":
        raise ValueError("Original RomFS mount name is not the expected 'data'")
    if MOUNT_ROM_CALL <= QUERY_CACHE_CALL:
        raise ValueError("Mount attempted before size query")
    return {
        "original_mount_name": EXPECTED_MOUNT_NAME,
        "query_cache_call_rva": hex(QUERY_CACHE_CALL),
        "mount_rom_call_rva": hex(MOUNT_ROM_CALL),
        "mount_name_literal_rva": hex(name_address),
        "candidate_read_path": "data:/GrooveEngine/HoopTrundling3.groove",
        "requires_new_mount": False,
        "mount_survives_until_hoop3_load_proven": False,
        "layeredfs_added_file_visible_proven": False,
        "recommended_probe": "Check existing data: mount after original init; read-only open only",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original_main", type=Path)
    args = parser.parse_args()
    image, _ = load_original_image(args.original_main)
    print(json.dumps(audit_original_mount(image), indent=2))


if __name__ == "__main__":
    main()
