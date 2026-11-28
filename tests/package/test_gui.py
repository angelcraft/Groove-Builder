"""GUI layer: controller (always, no display needed) and tkinter view smoke test (skipped without tkinter/display)."""
import os
import shutil
import sys
import tempfile
import unittest

from _util import REPO, FIX, make_sd, A10, B10
from test_install import third_package

sys.path.insert(0, os.path.join(REPO, "tools"))
from groove_gui import controller as ctl  # noqa: E402

ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
ID_B = "org.groovebuilder.2247d7d8-7f17-4a5f-8a47-be342e2f3844"
PA = os.path.join(FIX, "valid", A10)
PB = os.path.join(FIX, "valid", B10)


def sd_root(test, with_marker=True):
    d = tempfile.mkdtemp()
    test.addCleanup(shutil.rmtree, d, True)
    make_sd(d, with_marker=with_marker)
    return d


class Controller(unittest.TestCase):
    def test_controller_has_no_gui_import(self):
        import ast
        with open(ctl.__file__, encoding="utf-8") as f:
            tree = ast.parse(f.read())
        mods = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)} | \
               {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        self.assertFalse({m for m in mods if m and m.split(".")[0] in ("tkinter", "ctypes")})

    def test_flow_and_readable_errors(self):
        sd = sd_root(self)
        v = ctl.validate(PA)
        self.assertTrue(v.ok)
        self.assertIn("Synthetic Pulse A", v.text())
        bad = ctl.validate(os.path.join(FIX, "invalid", "traversal.groove"))
        self.assertFalse(bad.ok)
        self.assertIn("ZIP_UNSAFE_PATH", bad.text())
        self.assertEqual(ctl.install(PA, sd).data["slot"], 0)
        self.assertEqual(ctl.install(PB, sd, 1).data["slot"], 1)
        tmp = os.path.join(sd, "c.groove")
        with open(tmp, "wb") as f:
            f.write(third_package())
        full = ctl.install(tmp, sd)
        self.assertFalse(full.ok)
        self.assertIn("Las dos casillas", full.text())
        st = ctl.status(sd)
        self.assertTrue(st.ok, st.text())
        self.assertEqual({r["id"]: r["slot"] for r in st.data["rows"]}, {ID_A: "A", ID_B: "B"})
        self.assertTrue(ctl.unassign(sd, ID_A).ok)
        self.assertTrue(ctl.assign(sd, ID_A, 0).ok)
        u = ctl.uninstall(sd, ID_A)
        self.assertTrue(u.ok)
        self.assertTrue(os.path.exists(os.path.join(sd, "groove", "custom-saves", ID_A + ".gsv")))
        self.assertTrue(ctl.recover(sd).ok)

    def test_no_marker_explained(self):
        sd = sd_root(self, with_marker=False)
        out = ctl.install(PA, sd)
        self.assertFalse(out.ok)
        self.assertEqual(out.code, "ENGINE_UNKNOWN")
        self.assertIn("engine.json", out.text())
        self.assertFalse(os.path.exists(os.path.join(sd, "groove", "levels", ID_A)))


def _tk_or_skip():
    try:
        import tkinter as tk
    except ImportError:
        raise unittest.SkipTest("tkinter not available in this Python")
    try:
        root = tk.Tk()
    except tk.TclError as e:
        raise unittest.SkipTest(f"no display for tkinter: {e}")
    root.withdraw()
    return root


class View(unittest.TestCase):
    def setUp(self):
        self.root = _tk_or_skip()
        self.addCleanup(self.root.destroy)
        from groove_gui.app import App
        self.answers = []
        self.app = App(self.root, confirm=lambda t, m: self.answers.pop(0) if self.answers else True,
                       ask_file=lambda: PA, ask_dir=lambda: self.sd)
        self.sd = sd_root(self)
        self.root.update_idletasks()

    def test_smoke(self):
        self.assertIn("Groove Engine", self.root.title())
        self.assertFalse(self.app.on_install().ok)            # nothing chosen yet: readable message
        self.app.pick_pkg()                                    # validates automatically
        self.assertTrue(self.app.last.ok)
        self.app.pick_sd()
        self.assertTrue(self.app.last.ok, self.app.last.text())
        self.assertTrue(self.app.on_install().ok)
        self.app.pkg.set(PB)
        self.app.slot.set("B")
        self.assertTrue(self.app.on_install().ok)
        rows = {self.app.tree.set(i, "id"): self.app.tree.set(i, "slot") for i in self.app.tree.get_children()}
        self.assertEqual(rows, {ID_A: "A", ID_B: "B"})
        self.app.tree.selection_set(ID_A)
        self.assertTrue(self.app.on_unassign().ok)
        self.assertEqual(self.app.tree.set(ID_A, "slot"), "—")
        self.app.tree.selection_set(ID_A)
        self.assertFalse(self.app.on_assign(1).ok)            # B occupied
        self.assertIn("Esa casilla ya tiene otro nivel", self.app.log_text())
        self.app.tree.selection_set(ID_A)
        self.assertTrue(self.app.on_assign(0).ok)
        self.answers = [False]
        self.app.tree.selection_set(ID_A)
        self.assertEqual(self.app.on_uninstall().title, "Cancelado")
        self.app.tree.selection_set(ID_A)
        self.assertTrue(self.app.on_uninstall().ok)
        self.assertNotIn(ID_A, self.app.tree.get_children())
        self.assertTrue(os.path.exists(os.path.join(self.sd, "groove", "custom-saves", ID_A + ".gsv")))
        self.assertTrue(self.app.on_recover().ok)
        self.app.pkg.set(os.path.join(FIX, "invalid", "symlink.groove"))
        self.assertFalse(self.app.on_validate().ok)
        self.assertIn("ZIP_SYMLINK", self.app.log_text())
        self.root.update()


if __name__ == "__main__":
    unittest.main()
