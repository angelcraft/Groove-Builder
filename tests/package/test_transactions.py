"""Crash safety: interrupt every operation at every mutating step (power cut and I/O error),
then recover. The SD must end up exactly in the before- or after-state; saves and
foreign files are never damaged; recovery itself is crash-safe."""
import os
import shutil
import tempfile
import unittest

from _util import valid, make_sd, snapshot, A10, A11, B10
from groove_package.fsops import FS, SimulatedCrash
from groove_package.installer import SD

ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
INFRA_DIRS = {os.path.normpath(p) for p in ("groove/levels", "groove/.installer", "groove/backups", "groove/backups/saves")}


def state(root):
    s = snapshot(root, exclude=("groove/backups",))
    inst = os.path.join(root, "groove", ".installer")
    if os.path.isdir(inst):
        assert os.listdir(inst) == [], f"installer state left behind: {os.listdir(inst)}"
    return {k: v for k, v in s.items() if not (v == "DIR" and k in INFRA_DIRS)}


def setup_empty(sd):
    pass


def setup_a(sd):
    sd.install(valid(A10))


def setup_a_unassigned(sd):
    sd.install(valid(A10), slot=None)


def setup_corrupt_slots(sd):
    os.makedirs(os.path.dirname(sd.slots_path), exist_ok=True)
    with open(sd.slots_path, "w") as f:
        f.write("{corrupt")


SCENARIOS = {
    "install-first": (setup_empty, lambda sd: sd.install(valid(A10))),
    "install-second": (setup_a, lambda sd: sd.install(valid(B10))),
    "upgrade": (setup_a, lambda sd: sd.install(valid(A11))),
    "uninstall-keep-saves": (setup_a, lambda sd: sd.uninstall(ID_A)),
    "assign": (setup_a_unassigned, lambda sd: sd.assign(ID_A, 1)),
    "init-slots": (setup_empty, lambda sd: sd.init_slots()),
    "unassign": (setup_a, lambda sd: sd.unassign(ID_A)),
    "reset-corrupt-slots": (setup_corrupt_slots, lambda sd: sd.init_slots(reset_corrupt=True)),
}


class Transactions(unittest.TestCase):
    def fresh(self, setup):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        make_sd(root)
        setup(SD(root))
        return root

    def reference(self, setup, op):
        root = self.fresh(setup)
        pre = state(root)
        fs = FS()
        op(SD(root, fs))
        return pre, state(root), fs.steps

    def test_crash_at_every_step(self):
        total = 0
        for name, (setup, op) in SCENARIOS.items():
            pre, post, n = self.reference(setup, op)
            self.assertNotEqual(pre, post, name)
            outcomes = {"pre": 0, "post": 0}
            for k in range(1, n + 1):
                with self.subTest(scenario=name, crash_at=k):
                    root = self.fresh(setup)
                    with self.assertRaises(SimulatedCrash):
                        op(SD(root, FS(crash_at=k)))
                    SD(root).recover()
                    got = state(root)
                    self.assertIn(got, (pre, post))
                    outcomes["pre" if got == pre else "post"] += 1
                    self.assertFalse(os.path.exists(SD(root).lock_path))
                    total += 1
            self.assertGreater(outcomes["pre"], 0, name)
            self.assertGreater(outcomes["post"], 0, name)
        self.assertGreater(total, 50)

    def test_io_error_at_every_step_rolls_back_in_process(self):
        for name, (setup, op) in SCENARIOS.items():
            pre, post, n = self.reference(setup, op)
            for k in range(1, n + 1):
                with self.subTest(scenario=name, fail_at=k):
                    root = self.fresh(setup)
                    failed = False
                    try:
                        op(SD(root, FS(fail_at=k)))
                    except OSError:
                        failed = True
                    sd = SD(root)
                    if not os.path.exists(sd.journal_path):
                        self.assertFalse(os.path.exists(sd.lock_path), "lock file must be removed")
                    if os.path.exists(sd.journal_path):
                        # lock FILE stays (runtime gate closed) but the OS lock is free: recover can take it
                        # Fault hit post-commit cleanup: op reported success, recover rolls forward.
                        self.assertFalse(failed)
                        self.assertEqual(sd.recover(), "rolled-forward")
                        self.assertEqual(state(root), post)
                    elif failed:
                        self.assertEqual(state(root), pre)  # an error is reported => nothing changed
                    else:
                        self.assertEqual(state(root), post)

    def test_crash_during_recovery(self):
        for name, (setup, op) in SCENARIOS.items():
            pre, post, n = self.reference(setup, op)
            for k in range(1, n + 1):
                # how many steps does recovery take from this crash point?
                root = self.fresh(setup)
                with self.assertRaises(SimulatedCrash):
                    op(SD(root, FS(crash_at=k)))
                probe = FS()
                SD(root, probe).recover()
                for m in range(1, probe.steps + 1):
                    with self.subTest(scenario=name, crash_at=k, recover_crash_at=m):
                        root = self.fresh(setup)
                        with self.assertRaises(SimulatedCrash):
                            op(SD(root, FS(crash_at=k)))
                        with self.assertRaises(SimulatedCrash):
                            SD(root, FS(crash_at=m)).recover()
                        SD(root).recover()
                        self.assertIn(state(root), (pre, post))

    def test_saves_survive_every_crash(self):
        """custom-saves/ is byte-identical after any crash + recover (V0: the installer never deletes saves)."""
        for name, (setup, op) in SCENARIOS.items():
            _, _, n = self.reference(setup, op)
            for k in range(1, n + 1):
                root = self.fresh(setup)
                saves = os.path.join(root, "groove", "custom-saves")
                before = snapshot(saves)
                with self.assertRaises(SimulatedCrash):
                    op(SD(root, FS(crash_at=k)))
                SD(root).recover()
                self.assertEqual(snapshot(saves), before, f"{name} crash_at={k}")


if __name__ == "__main__":
    unittest.main()
