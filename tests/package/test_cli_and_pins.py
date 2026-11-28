"""CLI end-to-end, vendored-contract pins and fixture reproducibility."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from _util import REPO, FIX, HERE, make_sd, marker, BUILD_ID, CAPS

CLI = os.path.join(REPO, "tools", "groove_install.py")
VENDOR = os.path.join(REPO, "tools", "groove_package", "vendor")
ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"


def run(*args):
    p = subprocess.run([sys.executable, CLI, "--json", *args], capture_output=True, text=True)
    return p.returncode, json.loads(p.stdout)


class CLI_(unittest.TestCase):
    def test_flow(self):
        sd = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, sd)
        make_sd(sd)
        a = os.path.join(FIX, "valid", "synthetic-a-1.0.0.groove")
        b = os.path.join(FIX, "valid", "synthetic-b-1.0.0.groove")
        rc, out = run("validate", a)
        self.assertEqual((rc, out["id"]), (0, ID_A))
        rc, out = run("validate", os.path.join(FIX, "invalid", "traversal.groove"))
        self.assertEqual((rc, out["code"]), (1, "ZIP_UNSAFE_PATH"))
        os.remove(os.path.join(sd, "groove", "engine.json"))
        rc, out = run("install", a, "--sd", sd)
        self.assertEqual((rc, out["code"]), (2, "ENGINE_UNKNOWN"))
        # explicit target: accepted for the read-only plan only
        eng = ["--engine-version", "0.6.0", "--engine-contract", "1", "--build-id", BUILD_ID]
        eng += sum((["--capability", c] for c in CAPS), [])
        rc, out = run("plan", a, "--sd", sd, *eng)
        self.assertEqual((rc, out["action"], out["slot"]), (0, "install", 0))
        p = subprocess.run([sys.executable, CLI, "install", a, "--sd", sd, *eng], capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)  # argparse rejects engine flags on install (usage error)
        with open(os.path.join(sd, "groove", "engine.json"), "wb") as f:
            f.write(marker())
        self.assertEqual(run("install", a, "--sd", sd)[1]["slot"], 0)
        self.assertEqual(run("install", b, "--sd", sd, "--slot", "B")[1]["slot"], 1)
        rc, out = run("status", "--sd", sd)
        self.assertEqual((rc, out["problems"], len(out["levels"])), (0, [], 2))
        rc, out = run("uninstall", ID_A, "--sd", sd)
        self.assertEqual((rc, out["saves_kept"]), (0, True))
        self.assertTrue(os.path.exists(os.path.join(sd, "groove", "custom-saves", ID_A + ".gsv")))
        self.assertEqual(run("recover", "--sd", sd)[1]["recover"], "clean")


class CorePurity(unittest.TestCase):
    """The core must stay GUI/platform-neutral so Android (Chaquopy) can import it unchanged."""
    FORBIDDEN = ("tkinter", "_tkinter", "ctypes", "winreg", "PyQt5", "PySide6", "wx", "kivy", "jnius")

    def test_core_import_does_not_load_gui(self):
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import importlib, pkgutil, groove_package;"
                "[importlib.import_module('groove_package.' + m.name) for m in pkgutil.iter_modules(groove_package.__path__)"
                " if m.name != '__main__'];"
                "bad = [m for m in sys.modules if m.split('.')[0] in %r]; print(bad); sys.exit(1 if bad else 0)") % (self.FORBIDDEN,)
        p = subprocess.run([sys.executable, "-c", code, os.path.join(REPO, "tools")], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_core_source_has_no_gui_imports(self):
        import ast
        core = os.path.join(REPO, "tools", "groove_package")
        for d, _, files in os.walk(core):
            for n in files:
                if n.endswith(".py"):
                    with open(os.path.join(d, n), encoding="utf-8") as f:
                        tree = ast.parse(f.read())
                    for node in ast.walk(tree):
                        names = []
                        if isinstance(node, ast.Import):
                            names = [a.name for a in node.names]
                        elif isinstance(node, ast.ImportFrom) and node.module:
                            names = [node.module]
                        for name in names:
                            self.assertNotIn(name.split(".")[0], self.FORBIDDEN, f"{n} imports {name}")


class Pins(unittest.TestCase):
    def test_vendored_files_match_pin(self):
        with open(os.path.join(VENDOR, "PIN.json")) as f:
            pin = json.load(f)["files"]
        for name, meta in pin.items():
            with open(os.path.join(VENDOR, name), "rb") as f:
                self.assertEqual(hashlib.sha256(f.read()).hexdigest(), meta["sha256"], name)

    def test_fixtures_reproducible(self):
        p = subprocess.run([sys.executable, os.path.join(HERE, "make_fixtures.py"), "--check"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_no_proprietary_payloads_in_fixtures(self):
        bad_ext = (".cwv", ".bwav", ".spr", ".tex", ".msbt", ".rhref", ".nso", ".ips", ".sarc", ".szs")
        for d, _, files in os.walk(FIX):
            for n in files:
                self.assertFalse(n.lower().endswith(bad_ext), n)
                self.assertLess(os.path.getsize(os.path.join(d, n)), 64 * 1024, n)


if __name__ == "__main__":
    unittest.main()
