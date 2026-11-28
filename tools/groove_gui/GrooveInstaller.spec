# PyInstaller spec for the GE-155 Windows GUI (DRAFT). Build on Windows from the repo root:
#   py -3 -m pip install pyinstaller
#   py -3 -m PyInstaller tools/groove_gui/GrooveInstaller.spec --distpath build-out/dist --workpath build-out/work
# Do NOT commit the resulting .exe (public repo policy: no binaries).
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, "..", ".."))
TOOLS = os.path.join(ROOT, "tools")
VENDOR = os.path.join(TOOLS, "groove_package", "vendor")

a = Analysis(
    [os.path.join(TOOLS, "GrooveInstaller.pyw")],
    pathex=[TOOLS],
    # gtf.py loads engine_contract.json next to itself at import time
    datas=[(os.path.join(VENDOR, "engine_contract.json"), "groove_package/vendor"),
           (os.path.join(VENDOR, "PIN.json"), "groove_package/vendor")],
    hiddenimports=["groove_package.vendor.gtf"],
    excludes=["jsonschema"],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, name="GrooveInstaller", console=False, upx=False)
