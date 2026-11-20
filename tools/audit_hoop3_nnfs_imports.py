"""Read-only nn::fs symbol audit against the SHA-pinned private Switch main.

Finds exact NUL-delimited original dynstr symbol spellings. This does NOT
resolve a callable address, confirm FS service initialization or connect a
Switch backend. Original NSO bytes are never emitted or altered.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from recover_hoop3_original_rings import load_original_image


# Original ABI spellings recovered from the owner's verified original NSO.
# The MountRom ABI requires a caller-supplied cache pointer and byte size;
# calling it with only a mount-name string would be incorrect.
REQUIRED_SYMBOLS = {
    "QueryMountRomCacheSize": "_ZN2nn2fs22QueryMountRomCacheSizeEPm",
    "MountRom": "_ZN2nn2fs8MountRomEPKcPvm",
    "OpenFile": "_ZN2nn2fs8OpenFileEPNS0_10FileHandleEPKci",
    "GetFileSize": "_ZN2nn2fs11GetFileSizeEPlNS0_10FileHandleE",
    "ReadFile": "_ZN2nn2fs8ReadFileEPmNS0_10FileHandleElPvm",
    "CloseFile": "_ZN2nn2fs9CloseFileENS0_10FileHandleE",
    "Unmount": "_ZN2nn2fs7UnmountEPKc",
}


def audit_imports(image: bytes) -> dict:
    missing = [friendly for friendly, mangled in REQUIRED_SYMBOLS.items()
               if b"\0" + mangled.encode("ascii") + b"\0" not in image]
    if missing:
        raise ValueError("Pinned original nn::fs symbols missing: " + ", ".join(missing))
    return {
        "original_main_symbols_present": sorted(REQUIRED_SYMBOLS),
        "mount_rom_requires_cache": True,
        "native_calls_bound": False,
        "romfs_mount_succeeded_on_switch": False,
        "layeredfs_file_visible_on_switch": False,
        "next_step": "Verify cache size, FS init, and native mount in a read-only hardware probe",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original_main", type=Path,
                        help="SHA-pinned owner-supplied main NSO (never modified)")
    args = parser.parse_args()
    original_image, _ = load_original_image(args.original_main)
    print(json.dumps(audit_imports(original_image), indent=2))


if __name__ == "__main__":
    main()
