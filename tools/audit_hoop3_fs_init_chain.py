"""Trace the original read-only RomFS MountRom("data") startup call chain.

Only accepts the owner's SHA-pinned original NSO through the CLI. The
presence/order of calls is static proof, NOT a runtime-ready hook or a
reason to execute an injected callback at game initialization.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from audit_hoop3_game_romfs_mount import audit_original_mount
from recover_hoop3_original_rings import branch_target, load_original_image, read_word


GAME_STARTUP_CALL = 0x6708
GAME_INIT_FUNCTION = 0x50CFF0
INIT_MOUNT_CALL = 0x50D034
ORIGINAL_MOUNT_FUNCTION = 0x50B880


def audit_init_chain(image: bytes) -> dict:
    mount = audit_original_mount(image)
    for site, target in ((GAME_STARTUP_CALL, GAME_INIT_FUNCTION),
                         (INIT_MOUNT_CALL, ORIGINAL_MOUNT_FUNCTION)):
        if site + 4 > len(image) or branch_target(site, read_word(image, site)) != target:
            raise ValueError(f"Original FS initialization branch drifted at {site:#x}")
    return {
        "original_romfs_mount_name": mount["original_mount_name"],
        "startup_call_rva": hex(GAME_STARTUP_CALL),
        "startup_init_function_rva": hex(GAME_INIT_FUNCTION),
        "init_mount_call_rva": hex(INIT_MOUNT_CALL),
        "original_mount_function_rva": hex(ORIGINAL_MOUNT_FUNCTION),
        "mount_result_success_proven_dynamically": False,
        "post_init_scene_callback_verified": False,
        "read_only_probe_installed": False,
        "hook_point_safe_to_use": False,
        "next_step": "Validate post-init/game-thread lifetime before any hardware file probe",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original_main", type=Path)
    args = parser.parse_args()
    image, _ = load_original_image(args.original_main)
    print(json.dumps(audit_init_chain(image), indent=2))


if __name__ == "__main__":
    main()
