"""Read-only extraction of the 34 native Hoop2 ring times from an owner's NSO.

No original game bytes or resource paths are distributed. The tool only
accepts the SHA-256-pinned main, validates its NSO segment hashes and known
Stage68 worker structure, and outputs timing metadata outside the source tree.
It never patches, executes or installs Nintendo code.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import hashlib
import json
from pathlib import Path
import struct


ORIGINAL_MAIN_SHA256 = "494c35e74dae893615980134f8be7673779f8d4b9eb9601e0f1b130d5ee1870e"
WORKER_WINDOW_START = 0x42CA40
WORKER_WINDOW_END = 0x42DF3C
ORIGINAL_RING_EMITTER = 0x217960
NATIVE_WAIT = 0x514D70
NATIVE_STOPPED = 0x514DD0
NATIVE_TICKS_PER_BEAT = 480


def load_original_image(path: Path) -> tuple[bytes, str]:
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != ORIGINAL_MAIN_SHA256:
        raise ValueError("main SHA-256 mismatch; refuse unknown original game version")
    if len(data) < 256 or data[:4] != b"NSO0":
        raise ValueError("Invalid original NSO header")
    flags = struct.unpack_from("<I", data, 12)[0]
    if flags & 0x80:
        raise ValueError("Unsupported NSO compression type")
    sections = [struct.unpack_from("<III", data, 0x10 + 16 * i)
                for i in range(3)]
    image_size = max(memory + size for _, memory, size in sections)
    if image_size > 256 * 1024 * 1024:
        raise ValueError("NSO image is unexpectedly large")
    image = bytearray(image_size)
    lib = None
    for index, (offset, memory, size) in enumerate(sections):
        compressed = bool(flags & (1 << index))
        stored = struct.unpack_from("<I", data, 0x60 + 4 * index)[0] if compressed else size
        if offset < 256 or offset + stored > len(data):
            raise ValueError("NSO section outside file")
        segment = data[offset:offset + stored]
        if compressed:
            if lib is None:
                library_name = ctypes.util.find_library("lz4")
                if not library_name:
                    raise RuntimeError("System liblz4 is required for compressed NSO")
                lib = ctypes.CDLL(library_name)
                lib.LZ4_decompress_safe.argtypes = [ctypes.c_char_p, ctypes.c_void_p,
                                                    ctypes.c_int, ctypes.c_int]
                lib.LZ4_decompress_safe.restype = ctypes.c_int
            destination = ctypes.create_string_buffer(size)
            decoded = lib.LZ4_decompress_safe(segment, destination, len(segment), size)
            if decoded != size:
                raise ValueError("NSO compressed section does not decode to expected size")
            segment = destination.raw
        if len(segment) != size:
            raise ValueError("NSO section size mismatch")
        if flags & (1 << (index + 3)):
            reference = data[0xA0 + 32 * index:0xC0 + 32 * index]
            if hashlib.sha256(segment).digest() != reference:
                raise ValueError("NSO section hash mismatch")
        image[memory:memory + size] = segment
    return bytes(image), data[0x40:0x60].hex()


def branch_target(pc: int, word: int) -> int | None:
    if word & 0xFC000000 != 0x94000000:  # AArch64 BL immediate
        return None
    displacement = word & 0x03FFFFFF
    if displacement & 0x02000000:
        displacement -= 0x04000000
    return pc + displacement * 4


def read_word(image: bytes, pc: int) -> int:
    return struct.unpack_from("<I", image, pc)[0]


def original_ring_schedule(image: bytes) -> dict:
    """Recover wait sums at original native emitter sites; reject any drift."""
    if len(image) < max(WORKER_WINDOW_END, NATIVE_STOPPED):
        raise ValueError("NSO lacks expected Stage68 code range")
    # A misplaced offset in a new release must never produce a plausible list.
    if read_word(image, WORKER_WINDOW_START) != 0xA9BD7BFD:
        raise ValueError("Unexpected Stage68 sequence prologue")
    elapsed = 0
    original_ring_ticks: list[int] = []
    ring_sites: list[int] = []
    waits = 0
    half_waits = 0
    stop_checks = 0
    for pc in range(WORKER_WINDOW_START, WORKER_WINDOW_END, 4):
        target = branch_target(pc, read_word(image, pc))
        if target == NATIVE_WAIT:
            ticks = {0x52803C01: 480, 0x52801E01: 240}.get(read_word(image, pc - 4))
            if ticks is None or read_word(image, pc - 8) != 0xAA1303E0:
                raise ValueError(f"Unrecognized original worker wait at {pc:#x}")
            elapsed += ticks
            waits += 1
            half_waits += ticks == 240
        elif target == NATIVE_STOPPED:
            stop_checks += 1
            guard_pc = pc + 4
            guard = read_word(image, guard_pc)
            displacement = (guard >> 5) & 0x3FFF
            if displacement & 0x2000:
                displacement -= 0x4000
            if ((guard & 0x7F00001F) != 0x37000000 or
                    guard_pc + displacement * 4 != WORKER_WINDOW_END):
                raise ValueError(f"Unrecognized original worker cancellation at {pc:#x}")
        elif target == ORIGINAL_RING_EMITTER:
            ring_sites.append(pc)
            original_ring_ticks.append(elapsed)
    if (len(original_ring_ticks) != 34 or waits != 191 or stop_checks != 191
            or half_waits != 16 or original_ring_ticks[:2] != [8640, 12480]
            or original_ring_ticks[-1] != 87840
            or not all(a < b for a, b in zip(original_ring_ticks, original_ring_ticks[1:]))):
        raise ValueError("Original 34-ring Stage68 schedule no longer matches audited shape")
    # Almost every native ring passes w2=-1 directly. Original ring 33 is
    # different: a Stage68 conditional selects either -1 or a mask computed
    # by main+0x2171e0. A replacement timeline MUST preserve this behavior,
    # not flatten all 34 original emissions into constant -1 values.
    conditional_site = 0x42DEB0
    if ring_sites[32] != conditional_site:
        raise ValueError("Original special-mask ring position moved")
    if (read_word(image, conditional_site - 12) != 0x12800002 or
            read_word(image, conditional_site - 16) != 0x14000002 or
            read_word(image, conditional_site - 20) != 0x2A0003E2 or
            branch_target(conditional_site - 24,
                          read_word(image, conditional_site - 24)) != 0x2171E0):
        raise ValueError("Original conditional BubbleState calculation changed")
    if any(0x12800002 not in (read_word(image, pc - 4),
                              read_word(image, pc - 8),
                              read_word(image, pc - 12))
           for pc in ring_sites if pc != conditional_site):
        raise ValueError("Unexpected BubbleState argument in original ring sequence")
    return {
        "native_ticks_per_beat": NATIVE_TICKS_PER_BEAT,
        "original_ring_count": len(original_ring_ticks),
        "original_ring_ticks": original_ring_ticks,
        "native_emitter_call_sites": [hex(pc) for pc in ring_sites],
        "native_wait_count": waits,
        "native_stop_check_count": stop_checks,
        "half_beat_wait_count": half_waits,
        "constant_minus_one_ring_count": 33,
        "conditional_mask_ring": {
            "one_based_ring_number": 33,
            "beat": original_ring_ticks[32] // NATIVE_TICKS_PER_BEAT,
            "fallback_mask": -1,
            "native_mask_function_rva": "0x2171e0",
            "runtime_branch_and_mask_not_reimplemented": True,
        },
        "all_native_mask_values_determined": False,
        "switch_playable": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_main", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if args.private_main.resolve() == args.out.resolve() or args.out.exists():
        parser.error("Output must be a NEW file, different from the private main")
    image, build_id = load_original_image(args.private_main)
    report = original_ring_schedule(image)
    report["original_sha256"] = ORIGINAL_MAIN_SHA256
    report["build_id"] = build_id
    with args.out.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(f"Verified {report['original_ring_count']} original Hoop2 ring ticks. "
          "No game assets copied; not installable.")


if __name__ == "__main__":
    main()
