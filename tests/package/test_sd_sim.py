"""The simulated-SD validation tool (tools/groove_sd_sim.py) passes and refuses non-empty folders."""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest

from _util import REPO
import groove_sd_sim


class SimulatedSD(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_sim(self, *args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            try:
                rc = groove_sd_sim.main(list(args))
            except SystemExit as e:
                rc = e.code
        return rc, buf.getvalue()

    def test_all_scenarios_pass(self):
        report = os.path.join(self.tmp, "report.json")
        rc, out = self.run_sim("--sd", os.path.join(self.tmp, "sim"), "--report", report)
        self.assertEqual(rc, 0, out)
        with open(report) as f:
            rep = json.load(f)
        self.assertTrue(rep["ok"])
        self.assertGreaterEqual(len(rep["scenarios"]), 7)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "sim")))  # removed without --keep

    def test_refuses_non_empty_folder(self):
        with open(os.path.join(self.tmp, "Nintendo"), "w") as f:
            f.write("a real SD would have this")
        rc, out = self.run_sim("--sd", self.tmp)
        self.assertEqual(rc, 3)
        self.assertEqual(os.listdir(self.tmp), ["Nintendo"])

    def test_make_only_layout_is_placeholders(self):
        d = os.path.join(self.tmp, "fake")
        rc, _ = self.run_sim("--make-only", d)
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.isfile(os.path.join(d, "groove", "engine.json")))
        for dp, _, files in os.walk(d):
            for n in files:
                ext = os.path.splitext(n)[1].lower()
                self.assertNotIn(ext, {".spr", ".tex", ".msbt", ".bwav", ".cwv", ".rhref", ".nso", ".ips"})


class NoBinariesPolicy(unittest.TestCase):
    def test_build_output_ignored(self):
        with open(os.path.join(REPO, ".gitignore")) as f:
            gi = f.read().split()
        self.assertIn("build-out/", gi)
        self.assertIn("*.exe", gi)


if __name__ == "__main__":
    unittest.main()
