# PyInstaller spec for the GE-155 Windows build (DRAFT). Produces two one-file executables:
#   GrooveInstaller.exe  - tkinter GUI (tools/GrooveInstaller.pyw), no console window
#   GrooveInstall.exe    - command line (tools/groove_install.py), same core, --json output
# Build on Windows with tools/windows/build_windows.ps1 (or the "windows-exe" job of
# .github/workflows/package-installer.yml). Output goes to build-out/ which is git-ignored.
# Do NOT commit the resulting .exe files (public repo policy: no binaries).
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, "..", ".."))
TOOLS = os.path.join(ROOT, "tools")
VENDOR = os.path.join(TOOLS, "groove_package", "vendor")
# gtf.py loads engine_contract.json next to itself at import time; PIN.json documents the pinned SHAs.
DATAS = [(os.path.join(VENDOR, "engine_contract.json"), "groove_package/vendor"),
         (os.path.join(VENDOR, "PIN.json"), "groove_package/vendor")]
HIDDEN = ["groove_package.vendor.gtf"]
EXCLUDES = ["jsonschema", "unittest", "pydoc", "test"]


def build(script, name, console, excludes):
    a = Analysis([os.path.join(TOOLS, script)], pathex=[TOOLS], datas=DATAS, hiddenimports=HIDDEN,
                 excludes=excludes, noarchive=False)
    pyz = PYZ(a.pure)
    return EXE(pyz, a.scripts, a.binaries, a.datas, name=name, console=console, upx=False, strip=False)


gui = build("GrooveInstaller.pyw", "GrooveInstaller", False, EXCLUDES)
cli = build("groove_install.py", "GrooveInstall", True, EXCLUDES + ["tkinter", "_tkinter"])
