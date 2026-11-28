"""CLI end-to-end, vendored-contract pins and fixture reproducibility."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from _util import REPO, FIX, HERE, make_sd

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
        rc, out = run("install", a, "--sd", sd)
        self.assertEqual((rc, out["code"]), (2, "ENGINE_UNKNOWN"))
        eng = ["--engine-version", "0.6.0", "--engine-contract", "1", "--build-id", "03FF4A3B"]
        self.assertEqual(run("install", a, "--sd", sd, *eng)[1]["slot"], 0)
        self.assertEqual(run("install", b, "--sd", sd, *eng)[1]["slot"], 1)
        rc, out = run("status", "--sd", sd)
        self.assertEqual((rc, out["problems"], len(out["levels"])), (0, [], 2))
        rc, out = run("uninstall", ID_A, "--sd", sd)
        self.assertEqual((rc, out["saves_kept"]), (0, True))
        self.assertTrue(os.path.exists(os.path.join(sd, "groove", "custom-saves", ID_A + ".gsv")))
        self.assertEqual(run("recover", "--sd", sd)[1]["recover"], "clean")


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
