"""Host compile audit of the pinned PUBLIC NNSDK headers (never a Switch build).

Usage:
    python tools/verify_hoop3_pinned_nnsdk_abi.py \
        --sdk-dir /path/to/pinned/groove-mod/lib/nnsdk
    python tools/verify_hoop3_pinned_nnsdk_abi.py \
        --cross-object /path/to/aarch64/hoop3_pinned_nnsdk_abi.cpp.o

The optional SDK checkout is provided externally; it is neither downloaded
automatically nor copied into this repository. Only a temporary host object
is compiled, then its four nn::fs unresolved symbols are compared against
the exact symbols recovered earlier from the owner's original game binary.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from audit_hoop3_nnfs_imports import REQUIRED_SYMBOLS


ROOT = Path(__file__).resolve().parents[1]
READER_NAMES = ("OpenFile", "GetFileSize", "ReadFile", "CloseFile")
NNSDK_SYMBOL_PREFIX = "_ZN2nn2fs"


def parse_unresolved_nnsdk_symbols(nm_output: str) -> set[str]:
    """Accept both BSD and GNU `nm --undefined-only` symbol layouts."""
    symbols = set()
    for line in nm_output.splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[-2] == "U":
            symbol = fields[-1]
            if symbol.startswith(NNSDK_SYMBOL_PREFIX):
                symbols.add(symbol)
    return symbols


def expected_native_reader_symbols() -> set[str]:
    return {REQUIRED_SYMBOLS[name] for name in READER_NAMES}


def validate_reader_symbols(actual: set[str]) -> None:
    expected = expected_native_reader_symbols()
    if actual != expected:
        raise ValueError(
            "Native nn::fs ABI mismatch: "
            f"missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
        )


def validate_aarch64_relocatable_elf(header: str) -> None:
    """Do not mistake a native x86-64 object for an ARM64 compile proof."""
    if not re.search(r"^\s*Class:\s*ELF64\s*$", header, re.MULTILINE):
        raise ValueError("ABI audit object is not ELF64")
    if not re.search(r"^\s*Machine:\s*AArch64\s*$", header, re.MULTILINE):
        raise ValueError("ABI audit object is not AArch64")
    if not re.search(r"^\s*Type:\s*REL\s*\(", header, re.MULTILINE):
        raise ValueError("ABI audit object is not a relocatable object")


def run_checked(argv: list[str]) -> str:
    result = subprocess.run(argv, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {argv[0]}: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


def audit_sdk(sdk_dir: Path, *, compiler: str = "g++", nm: str = "nm") -> dict:
    sdk_dir = sdk_dir.resolve()
    pin = json.loads((ROOT / "tools/loader_pin.json").read_text(encoding="utf-8"))
    required_commit = pin["submodules"]["lib/nnsdk"]
    actual_commit = run_checked(["git", "-C", str(sdk_dir), "rev-parse", "HEAD"])
    if actual_commit != required_commit:
        raise ValueError(
            f"Wrong public NNSDK checkout: expected {required_commit}, got {actual_commit}"
        )

    headers = sdk_dir / "include"
    if not (headers / "nn/fs.h").is_file():
        raise ValueError("Pinned NNSDK include/nn/fs.h is missing")
    if not shutil.which(compiler) or not shutil.which(nm):
        raise RuntimeError(f"Required host tools not found: {compiler}, {nm}")

    with tempfile.TemporaryDirectory(prefix="hoop3-nnsdk-abi-") as tmp:
        compiled = Path(tmp) / "nnfs_audit.o"
        run_checked([
            compiler, "-std=c++17", "-O0", "-fno-inline", "-Wall", "-Wextra",
            "-Werror", "-c", "-I", str(ROOT / "source"), "-I", str(headers),
            str(ROOT / "tests/hoop3_pinned_nnsdk_abi.cpp"), "-o", str(compiled),
        ])
        undefined = run_checked([nm, "--undefined-only", str(compiled)])
        symbols = parse_unresolved_nnsdk_symbols(undefined)
        validate_reader_symbols(symbols)

    return {
        "public_nnsdk_commit": required_commit,
        "exact_original_main_reader_imports_matched": sorted(symbols),
        "compiled_against_pinned_public_headers": True,
        "target_architecture_compiled": False,
        "linked_into_switch_module": False,
        "safe_runtime_callback_verified": False,
        "layeredfs_visibility_on_switch_verified": False,
        "installable": False,
    }


def audit_aarch64_object(path: Path, *, nm: str = "nm",
                         readelf: str = "readelf") -> dict:
    """Verify an inert cross-built object; never run or link it on Switch."""
    path = path.resolve(strict=True)
    header = run_checked([readelf, "-h", str(path)])
    validate_aarch64_relocatable_elf(header)
    symbols = parse_unresolved_nnsdk_symbols(
        run_checked([nm, "--undefined-only", str(path)])
    )
    validate_reader_symbols(symbols)
    return {
        "exact_original_main_reader_imports_matched": sorted(symbols),
        "target_architecture_compiled": True,
        "target_machine": "AArch64",
        "read_only_probe_linked_into_switch_module": False,
        "safe_runtime_callback_verified": False,
        "layeredfs_visibility_on_switch_verified": False,
        "installable": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--sdk-dir", type=Path,
                        help="Checked-out pinned public lib/nnsdk submodule")
    source.add_argument("--cross-object", type=Path,
                        help="Inert AArch64 object from the prepared CMake build")
    args = parser.parse_args()
    try:
        report = (audit_sdk(args.sdk_dir) if args.sdk_dir else
                  audit_aarch64_object(args.cross_object))
    except (ValueError, RuntimeError, OSError) as exc:
        parser.exit(1, f"Hoop3 ABI audit FAILED: {exc}\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
