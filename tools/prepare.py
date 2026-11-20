#!/usr/bin/env python3
"""Prepare an isolated Switch cross-build of the original-source Hoop3 text probe.

Never touches installed ExeFS/RomFS, a Switch SD tree, or a game executable.
The opt-in runtime patcher is research code and NOT certified for deployment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
PIN = json.loads((ROOT / "tools/loader_pin.json").read_text())
SOURCES = (
    "hoop3_text_hook.cpp",
    "hoop3_title_bridge.cpp",
    "hoop3_title_entry.S",
    "hoop3_title_dispatch.hpp",
    "groove_extended_catalog.hpp",
    "hoop3_intro_bridge.cpp",
    "hoop3_intro_entry.S",
    "hoop3_intro_dispatch.hpp",
    "hoop3_launch_origin_gate.hpp",
    "hoop3_native_menu_record.hpp",
    "hoop3_stage68_route_gate.hpp",
    "hoop3_text_patch_plan.hpp",
    "switch_startup_plan.hpp",
)

# Compile-only audit of the future borrowed-data: file reader. This object is
# NOT added to the MenuColumn executable, cannot run during hkMain, and is
# never packaged for installation. Source lives in tests/ on purpose.
READER_AUDIT_HEADERS = (
    "groove_hoop3_nnfs_borrowed.hpp",
    "groove_hoop3_readonly_probe.hpp",
    "groove_hoop3_package_file.hpp",
    "groove_zip_archive.hpp",
)
READER_AUDIT_SOURCE = "hoop3_pinned_nnsdk_abi.cpp"


def git_head(path: Path) -> str:
    return subprocess.check_output(
        ["git", "-C", str(path), "rev-parse", "HEAD"], text=True
    ).strip()


def validate_loader(path: Path) -> None:
    if git_head(path) != PIN["commit"]:
        raise ValueError("Loader commit mismatch; refusing unpinned build")
    subprocess.run(["git", "-C", str(path), "diff", "--quiet", "HEAD", "--"], check=True)
    untracked = subprocess.check_output(
        ["git", "-C", str(path), "ls-files", "--others", "--exclude-standard"], text=True
    )
    if untracked.strip():
        raise ValueError("Loader has untracked files")
    for rel, digest in PIN["files"].items():
        actual = hashlib.sha256((path / rel).read_bytes()).hexdigest()
        if actual != digest:
            raise ValueError(f"Pinned public loader file mismatch: {rel}")
    for rel, expected in PIN["submodules"].items():
        module = path / rel
        if git_head(module) != expected:
            raise ValueError(f"Pinned submodule mismatch: {rel}")
        subprocess.run(["git", "-C", str(module), "diff", "--quiet", "HEAD", "--"], check=True)


def prepare_loader_sources(sys_root: Path) -> None:
    """Make the known, narrowly-scoped read-only loader changes in our copy."""
    util = sys_root / "hakkun/src/hk/ro/RoUtil.cpp"
    text = util.read_text()
    old = "            HK_ABORT_UNLESS_R(module.mapRw());"
    if text.count(old) != 1:
        raise ValueError("Pinned Hakkun mapRw() source changed")
    text = text.replace(old, "#ifndef HOOP_DX_READ_ONLY_BOOT\n" + old +
                        "\n#endif // HOOP_DX_READ_ONLY_BOOT")
    append = "            sModules[sNumModules++].mModule = rtldModule;"
    if text.count(append) != 1:
        raise ValueError("Pinned Hakkun loader inventory changed")
    text = text.replace(append, "#ifdef HOOP_DX_READ_ONLY_BOOT\n"
                        "            HK_ASSERT(sNumModules < cMaxModuleNum);\n"
                        "#endif // HOOP_DX_READ_ONLY_BOOT\n" + append)
    util.write_text(text)

    module = sys_root / "hakkun/src/hk/init/module.cpp"
    text = module.read_text()
    old = 'section(.rodata.modulename) const ModuleName<STR(MODULE_NAME) ".nss"> hkModuleName;'
    if text.count(old) != 1:
        raise ValueError("Pinned Hakkun module name definition changed")
    module.write_text(text.replace(old, "__attribute__((used, retain)) " + old))


def prepare(loader: Path, std: Path, output: Path, active: bool) -> Path:
    loader, std, output = loader.resolve(), std.resolve(), output.resolve()
    if not (std / "libc.a").is_file():
        raise ValueError("Missing public LibHakkun stdlib (libc.a)")
    if output.exists() or output == ROOT or ROOT in output.parents:
        raise ValueError("Build output must be a fresh path outside source checkout")
    validate_loader(loader)

    # All files below come from our own sources or from pinned PUBLIC repositories.
    (output / "config").mkdir(parents=True)
    for directory in ("sys", "syms"):
        shutil.copytree(loader / directory, output / directory,
                        ignore=shutil.ignore_patterns(".git", "__pycache__", "build"))
    shutil.copytree(loader / "lib/nnsdk", output / "lib/nnsdk",
                    ignore=shutil.ignore_patterns(".git", "__pycache__", "build"))
    shutil.copytree(std, output / "lib/std", ignore=shutil.ignore_patterns(".git"))

    for name in SOURCES:
        shutil.copy2(ROOT / "source" / name, output / name)
    for name in READER_AUDIT_HEADERS:
        shutil.copy2(ROOT / "source" / name, output / name)
    shutil.copy2(ROOT / "tests" / READER_AUDIT_SOURCE,
                 output / READER_AUDIT_SOURCE)
    for name in ("VersionList.sym", "ModuleList.sym"):
        path = loader / "config" / name
        if path.exists():
            shutil.copy2(path, output / "config" / name)
    prepare_loader_sources(output / "sys")

    cmake_config = (ROOT / "templates/config/config.cmake").read_text()
    required = (
        ("set(MODULE_NAME HoopDX)", "set(MODULE_NAME MenuColumn)"),
        ("set(MODULE_BINARY subsdk5)", "set(MODULE_BINARY subsdk6)"),
        ("set(USE_SAIL TRUE)", "set(USE_SAIL FALSE)"),
        ("-O3 -ffast-math -flto", "-O2"),
    )
    for old, new in required:
        if cmake_config.count(old) != 1:
            raise ValueError(f"Unexpected build template: {old}")
        cmake_config = cmake_config.replace(old, new)
    (output / "config/config.cmake").write_text(cmake_config)
    (output / "CMakeLists.txt").write_text(
        (ROOT / "templates/CMakeLists.txt").read_text().replace(
            "HOOP3_ACTIVE_MODE", "1" if active else "0"
        )
    )
    manifest = {
        "module": "MenuColumn.nss",
        "slot": "subsdk6",
        "loader_commit": PIN["commit"],
        "text_patch_active": active,
        "package_allowed": False,
        "installable": False,
        "requires_vacant_slot": True,
        "physical_switch_test_passed": False,
        "retail_main_or_resource_included": False,
        "note": "Research compile only; never merge into an active ExeFS tree automatically.",
    }
    (output / "deployment-status.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--loader", type=Path, required=True)
    parser.add_argument("--std", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--active", action="store_true", help="Unvalidated code-writing experiment; NOT installable")
    args = parser.parse_args()
    print(prepare(args.loader, args.std, args.out, args.active))
