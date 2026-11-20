"""Read-only proof of the original Stage68 sequence callback registration.

The SHA-pinned user's original main contains a relocatable function pointer
in its writable DATA segment. The Stage68 normal worker copies that callback
into the game's existing worker setup. A future interposer might wrap it, but
this auditor NEVER changes the pointer, patches instructions or installs code.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

from recover_hoop3_original_rings import (
    WORKER_WINDOW_START, branch_target, load_original_image, read_word,
)


POINTER_RVA = 0xD9C7A0
ORIGINAL_SEQUENCE_RVA = WORKER_WINDOW_START
DATA_START_RVA = 0xCD9000
DATA_END_RVA = 0x10A7310
CALLBACK_SETUP = (
    # (ADRP of callback table, LDR callback, STR into game worker, setup BL)
    (0x42C7A4, 0x42C7B4, 0x42C7C0, 0x42C7C4, POINTER_RVA,
     ORIGINAL_SEQUENCE_RVA),
    (0x42C7F8, 0x42C808, 0x42C814, 0x42C818, POINTER_RVA + 8,
     0x42E010),
    (0x42C84C, 0x42C85C, 0x42C868, 0x42C86C, POINTER_RVA + 16,
     0x42DF60),
)
SETUP_NATIVE_CALL_RVA = 0x5153A0


def adrp_page(pc: int, word: int, register: int) -> int:
    if word & 0x9F00001F != 0x90000000 | register:
        raise ValueError("Expected original callback-table ADRP")
    immediate = (((word >> 5) & 0x7FFFF) << 2) | ((word >> 29) & 3)
    if immediate & 0x100000:
        immediate -= 0x200000
    return (pc & ~0xFFF) + (immediate << 12)


def ldr64_unsigned(word: int) -> tuple[int, int, int]:
    if word & 0xFFC00000 != 0xF9400000:
        raise ValueError("Expected original 64-bit LDR unsigned immediate")
    return (word >> 5) & 31, word & 31, ((word >> 10) & 0xFFF) * 8


def str64_unsigned(word: int) -> tuple[int, int, int]:
    if word & 0xFFC00000 != 0xF9000000:
        raise ValueError("Expected original 64-bit STR unsigned immediate")
    return (word >> 5) & 31, word & 31, ((word >> 10) & 0xFFF) * 8


def audit_callback_registration(image: bytes) -> dict:
    if not (DATA_START_RVA <= POINTER_RVA < DATA_END_RVA - 24):
        raise ValueError("Stage68 callback slot is not in verified DATA")
    if len(image) < DATA_END_RVA:
        raise ValueError("Main image lacks original DATA segment")

    registration = []
    for adrp_pc, ldr_pc, store_pc, call_pc, pointer_rva, expected_entry in CALLBACK_SETUP:
        actual_pointer = struct.unpack_from("<Q", image, pointer_rva)[0]
        if actual_pointer != expected_entry:
            raise ValueError("Original Stage68 callback table has changed")
        page = adrp_page(adrp_pc, read_word(image, adrp_pc), 8)
        base_register, destination, displacement = ldr64_unsigned(
            read_word(image, ldr_pc))
        if (page + displacement != pointer_rva or base_register != 8 or
                destination != 8):
            raise ValueError("Stage68 worker no longer loads original callback")
        store_base, store_source, store_displacement = str64_unsigned(
            read_word(image, store_pc))
        if (store_base, store_source, store_displacement) != (22, 8, 0x288):
            raise ValueError("Stage68 worker callback storage path changed")
        if branch_target(call_pc, read_word(image, call_pc)) != SETUP_NATIVE_CALL_RVA:
            raise ValueError("Stage68 worker registration call changed")
        registration.append({"load_rva": hex(ldr_pc), "entry_rva": hex(expected_entry)})

    return {
        "stage68_original_sequence_callback": hex(ORIGINAL_SEQUENCE_RVA),
        "callback_pointer_rva": hex(POINTER_RVA),
        "pointer_segment": "data (writable image, permissions still untested on hardware)",
        "sequence_arguments": "x0=Stage68, x1=original SeqThread (separately audited)",
        "native_worker_registrations": registration,
        "no_text_patch_needed_for_candidate": True,
        "original_hoop2_must_pass_through": True,
        "hook_installed": False,
        "safe_to_install": False,
        "limitations": [
            "The GOT-like DATA pointer is shared by normal Hoop2 and borrowed Hoop3.",
            "A guarded interposer needs an independently verified stage instance,",
            "concurrency and scene teardown before any actual pointer rewrite.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_main", type=Path)
    args = parser.parse_args()
    image, _ = load_original_image(args.private_main)
    print(json.dumps(audit_callback_registration(image), indent=2))


if __name__ == "__main__":
    main()
