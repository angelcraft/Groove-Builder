"""Installer behaviour on a synthetic SD: slots, versions, saves protection, refusal paths."""
import json
import os
import shutil
import tempfile
import unittest

from _util import valid, make_sd, snapshot, A10, A11, B10, TARGET
from groove_package import slots as slotreg
from groove_package.engine import EngineTarget
from groove_package.errors import InstallError, PackageError
from groove_package.installer import SD
from groove_package.zipreader import write_canonical

T = EngineTarget(TARGET["engine_version"], TARGET["engine_contract"], TARGET["build_id"], "test")
ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
ID_B = "org.groovebuilder.2247d7d8-7f17-4a5f-8a47-be342e2f3844"
PROTECTED_EXCLUDE = ("groove/levels", "groove/slots.json", "groove/.installer", "groove/backups")


def third_package():
    import json as j
    from groove_package.validator import validate_package
    p = validate_package(valid(A10))
    m = dict(p.manifest, id="org.groovebuilder.0f0e6c9e-4a54-4c8e-9a51-6f1d2b3c4d5e", title="Synthetic Pulse C")
    return write_canonical([("manifest.json", (j.dumps(m, indent=2) + "\n").encode()), ("timeline.gtf", p.timeline_bytes)])


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        make_sd(self.tmp)
        self.sd = SD(self.tmp)
        self.protected = snapshot(self.tmp, exclude=PROTECTED_EXCLUDE)

    def tearDown(self):
        # Invariant for every test: nothing outside the installer's own paths changed.
        self.assertEqual(snapshot(self.tmp, exclude=PROTECTED_EXCLUDE), self.protected)
        self.assertFalse(os.path.exists(self.sd.lock_path))
        self.assertFalse(os.path.exists(self.sd.journal_path))
        shutil.rmtree(self.tmp)

    def reg(self):
        with open(self.sd.slots_path, "rb") as f:
            return slotreg.parse(f.read())

    def test_two_levels_two_slots(self):
        ra = self.sd.install(valid(A10), target=T)
        rb = self.sd.install(valid(B10), target=T)
        self.assertEqual((ra["slot"], rb["slot"]), (0, 1))
        r = self.reg()
        self.assertEqual(r["capacity"], 2)
        self.assertEqual([s["coord"] for s in r["slots"]], [[0, 9, 0], [0, 9, 1]])
        self.assertEqual([s["id"] for s in r["slots"]], [ID_A, ID_B])
        self.assertEqual(sorted(os.listdir(self.sd.level_dir(ID_A))), ["manifest.json", "timeline.gtf"])
        self.assertEqual(sorted(os.listdir(self.sd.level_dir(ID_B))), ["manifest.json", "timeline.gtl"])
        self.assertEqual(self.sd.status()["problems"], [])
        self.assertEqual(os.listdir(self.sd.state), [])

    def test_slots_full_changes_nothing(self):
        self.sd.install(valid(A10), target=T)
        self.sd.install(valid(B10), target=T)
        before = snapshot(self.tmp)
        with self.assertRaises(InstallError) as cm:
            self.sd.install(third_package(), target=T)
        self.assertEqual(cm.exception.code, "SLOTS_FULL")
        self.assertEqual(snapshot(self.tmp), before)
        r = self.sd.install(third_package(), target=T, slot=None)  # installed, unassigned
        self.assertIsNone(r["slot"])

    def test_explicit_slot_and_conflicts(self):
        self.assertEqual(self.sd.install(valid(B10), target=T, slot=1)["slot"], 1)
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10), target=T, slot=1)
        self.assertEqual(cm.exception.code, "SLOT_OCCUPIED")
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10), target=T, slot=2)
        self.assertEqual(cm.exception.code, "SLOT_NOT_ASSIGNABLE")
        self.assertEqual(self.sd.install(valid(A10), target=T)["slot"], 0)

    def test_versions(self):
        self.sd.install(valid(A10), target=T)
        self.assertEqual(self.sd.install(valid(A10), target=T)["action"], "unchanged")
        self.assertEqual(self.sd.install(valid(A11), target=T)["action"], "upgrade")
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10), target=T)
        self.assertEqual(cm.exception.code, "DOWNGRADE_REFUSED")
        self.assertEqual(self.sd.install(valid(A10), target=T, allow_downgrade=True)["action"], "downgrade")
        self.assertEqual(self.reg()["slots"][0]["id"], ID_A)  # slot kept across updates

    def test_same_version_different_bytes_is_conflict(self):
        from groove_package.validator import validate_package
        self.sd.install(valid(A10), target=T)
        p = validate_package(valid(A11))
        m = dict(p.manifest, version="1.0.0")
        forged = write_canonical([("manifest.json", (json.dumps(m) + "\n").encode()), ("timeline.gtf", p.timeline_bytes)])
        with self.assertRaises(InstallError) as cm:
            self.sd.install(forged, target=T)
        self.assertEqual(cm.exception.code, "VERSION_CONFLICT")

    def test_uninstall_keeps_saves(self):
        self.sd.install(valid(A10), target=T)
        r = self.sd.uninstall(ID_A)
        self.assertTrue(r["saves_kept"])
        self.assertFalse(os.path.exists(self.sd.level_dir(ID_A)))
        self.assertIsNone(self.reg()["slots"][0]["id"])
        # reinstall finds the same save untouched (checked by tearDown invariant too)
        self.sd.install(valid(A10), target=T)

    def test_purge_saves_backs_up_first(self):
        saves = os.path.join(self.tmp, "groove", "custom-saves")
        orig = {n: open(os.path.join(saves, n), "rb").read() for n in os.listdir(saves) if n.startswith(ID_A)}
        self.sd.install(valid(A10), target=T)
        r = self.sd.uninstall(ID_A, purge_saves=True)
        self.assertEqual(len(r["save_backups"]), 2)
        for rel in r["save_backups"]:
            n = os.path.basename(rel)
            key = ID_A + (".gsv.bak" if n.endswith(".bak") else ".gsv")
            self.assertEqual(open(os.path.join(self.tmp, rel), "rb").read(), orig[key])
        self.assertFalse(any(n.startswith(ID_A) for n in os.listdir(saves)))
        self.assertTrue(os.path.exists(os.path.join(saves, "org.other.keepme.gsv")))
        # restore the purged saves so the protected-files invariant still applies
        for n, b in orig.items():
            with open(os.path.join(saves, n), "wb") as f:
                f.write(b)

    def test_assign_unassign(self):
        self.sd.install(valid(A10), target=T, slot=None)
        self.sd.assign(ID_A, 1)
        self.assertEqual(self.reg()["slots"][1]["id"], ID_A)
        self.sd.unassign(ID_A)
        self.assertIsNone(self.reg()["slots"][1]["id"])
        with self.assertRaises(InstallError):
            self.sd.unassign(ID_A)
        with self.assertRaises(InstallError):
            self.sd.assign(ID_B, 0)

    def test_generation_increments(self):
        self.sd.install(valid(A10), target=T)
        g = self.reg()["generation"]
        self.sd.install(valid(B10), target=T)
        self.assertEqual(self.reg()["generation"], g + 1)

    def test_rejected_package_touches_nothing(self):
        before = snapshot(self.tmp)
        with self.assertRaises(PackageError):
            self.sd.install(valid(A10)[:-5], target=T)
        with self.assertRaises(InstallError):
            self.sd.install(valid(A10), engine_version="0.5.0", engine_contract=1, build_id="03FF4A3B")
        with self.assertRaises(InstallError):
            self.sd.install(valid(A10))  # unknown engine target
        self.assertEqual(snapshot(self.tmp), before)

    def test_corrupt_and_legacy_slots_refused(self):
        os.makedirs(os.path.dirname(self.sd.slots_path), exist_ok=True)
        for content, code in ((b"{not json", "SLOTS_CORRUPT"), (json.dumps([ID_A, None]).encode(), "SLOTS_LEGACY"),
                              (json.dumps(dict(slotreg.default_registry(), capacity=3)).encode(), "SLOTS_CORRUPT")):
            with open(self.sd.slots_path, "wb") as f:
                f.write(content)
            with self.assertRaises(InstallError) as cm:
                self.sd.install(valid(A10), target=T)
            self.assertEqual(cm.exception.code, code)
            self.assertEqual(open(self.sd.slots_path, "rb").read(), content)
        self.sd.init_slots(reset_corrupt=True)
        self.assertEqual(self.reg()["capacity"], 2)
        bad = [n for n in os.listdir(self.sd.backups) if n.endswith(".bad")]
        self.assertEqual(len(bad), 1)

    def test_unmanaged_level_dir_refused(self):
        d = self.sd.level_dir(ID_A)
        os.makedirs(d)
        with open(os.path.join(d, "notes.txt"), "w") as f:
            f.write("user file")
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10), target=T)
        self.assertIn(cm.exception.code, ("INSTALLED_CORRUPT", "LEVEL_DIR_UNEXPECTED"))
        with self.assertRaises(InstallError) as cm:
            self.sd.uninstall(ID_A)
        self.assertEqual(cm.exception.code, "LEVEL_DIR_UNEXPECTED")
        self.assertTrue(os.path.exists(os.path.join(d, "notes.txt")))

    @unittest.skipIf(os.name == "nt", "symlinks need privileges on Windows")
    def test_symlinked_level_refused(self):
        outside = tempfile.mkdtemp()
        try:
            os.makedirs(self.sd.levels)
            os.symlink(outside, self.sd.level_dir(ID_A))
            with self.assertRaises(InstallError) as cm:
                self.sd.install(valid(A10), target=T)
            self.assertEqual(cm.exception.code, "SYMLINK_REFUSED")
            with self.assertRaises(InstallError):
                self.sd.uninstall(ID_A)
            self.assertEqual(os.listdir(outside), [])
            os.remove(self.sd.level_dir(ID_A))
        finally:
            shutil.rmtree(outside)

    def test_lock_and_recovery_needed(self):
        os.makedirs(self.sd.state)
        open(self.sd.lock_path, "w").close()
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10), target=T)
        self.assertEqual(cm.exception.code, "LOCKED")
        self.assertEqual(self.sd.recover(), "clean")
        self.sd.install(valid(A10), target=T)

    def test_bad_uninstall_id(self):
        for bad in ("../groove", "..", "org.x/../../y", "ORG.X"):
            with self.assertRaises(InstallError):
                self.sd.uninstall(bad)


class SlotRegistry(unittest.TestCase):
    def test_capacity_growth_to_256(self):
        r = slotreg.default_registry()
        r2 = slotreg.grow(r, 256)
        slotreg.validate(r2)
        self.assertEqual(len(r2["slots"]), 256)
        self.assertTrue(all(s["coord"] is None for s in r2["slots"][2:]))
        self.assertEqual(slotreg.first_free(slotreg.with_assignment(
            slotreg.with_assignment(r2, 0, "a.b"), 1, "c.d")), None)  # 2..255 not assignable yet
        with self.assertRaises(InstallError):
            slotreg.grow(r2, 257)
        with self.assertRaises(InstallError):
            slotreg.grow(r2, 3)  # never shrinks
        self.assertLess(len(slotreg.dumps(r2)), slotreg.MAX_SLOTS_BYTES)

    def test_invalid_registries(self):
        good = slotreg.default_registry()
        bads = [dict(good, capacity=0, slots=[]), dict(good, format="x"), dict(good, generation=-1),
                dict(good, extra=1), dict(good, slots=[dict(good["slots"][0], coord=[0, 9, 4]), good["slots"][1]]),
                dict(good, slots=[dict(good["slots"][0], id="a.b"), dict(good["slots"][1], id="a.b")]),
                dict(good, slots=[dict(good["slots"][0], id="../x"), good["slots"][1]]),
                dict(good, slots=[good["slots"][1], good["slots"][0]])]
        for b in bads:
            with self.assertRaises(InstallError):
                slotreg.validate(b)


if __name__ == "__main__":
    unittest.main()
