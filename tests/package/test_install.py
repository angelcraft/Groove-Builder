"""Installer behaviour on a synthetic SD (with a synthetic engine marker): slots, versions, saves, refusals."""
import json
import os
import shutil
import tempfile
import unittest

from _util import valid, make_sd, snapshot, marker, A10, A11, B10
from groove_package import slots as slotreg
from groove_package.errors import InstallError, PackageError
from groove_package.installer import SD
from groove_package.validator import validate_package
from groove_package.zipreader import write_canonical

ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
ID_B = "org.groovebuilder.2247d7d8-7f17-4a5f-8a47-be342e2f3844"
OWN = ("groove/levels", "groove/slots.json", "groove/.installer", "groove/backups")


def repack(base, **manifest_over):
    p = validate_package(valid(base))
    m = dict(p.manifest, **manifest_over)
    return write_canonical([("manifest.json", (json.dumps(m, indent=2) + "\n").encode()),
                            (p.timeline_name, p.timeline_bytes)])


def third_package():
    return repack(A10, id="org.groovebuilder.0f0e6c9e-4a54-4c8e-9a51-6f1d2b3c4d5e", title="Synthetic Pulse C")


class Base(unittest.TestCase):
    with_marker = True

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        make_sd(self.tmp, with_marker=self.with_marker)
        self.sd = SD(self.tmp)
        self.protected = snapshot(self.tmp, exclude=OWN)

    def tearDown(self):
        # Invariant for every test: nothing outside the installer's own paths changed (incl. custom-saves/).
        self.assertEqual(snapshot(self.tmp, exclude=OWN), self.protected)
        shutil.rmtree(self.tmp)

    def reg(self):
        with open(self.sd.slots_path, "rb") as f:
            return slotreg.parse(f.read())

    def assertClean(self):
        self.assertFalse(os.path.exists(self.sd.lock_path))
        self.assertFalse(os.path.exists(self.sd.journal_path))


class InstallTests(Base):
    def test_two_levels_two_slots(self):
        ra = self.sd.install(valid(A10))
        rb = self.sd.install(valid(B10))
        self.assertEqual((ra["slot"], rb["slot"]), (0, 1))
        r = self.reg()
        self.assertEqual(r["capacity"], 2)
        self.assertEqual([s["coord"] for s in r["slots"]], [[0, 9, 0], [0, 9, 1]])
        self.assertEqual([s["id"] for s in r["slots"]], [ID_A, ID_B])
        self.assertEqual(sorted(os.listdir(self.sd.level_dir(ID_A))), ["manifest.json", "timeline.gtf"])
        self.assertEqual(sorted(os.listdir(self.sd.level_dir(ID_B))), ["manifest.json", "timeline.gtl"])
        self.assertEqual(self.sd.status()["problems"], [])
        self.assertEqual(os.listdir(self.sd.state), [])
        self.assertClean()

    def test_slots_full_changes_nothing(self):
        self.sd.install(valid(A10))
        self.sd.install(valid(B10))
        before = snapshot(self.tmp)
        with self.assertRaises(InstallError) as cm:
            self.sd.install(third_package())
        self.assertEqual(cm.exception.code, "SLOTS_FULL")
        self.assertEqual(snapshot(self.tmp), before)
        self.assertIsNone(self.sd.install(third_package(), slot=None)["slot"])

    def test_explicit_slot_and_conflicts(self):
        self.assertEqual(self.sd.install(valid(B10), slot=1)["slot"], 1)
        for slot, code in ((1, "SLOT_OCCUPIED"), (2, "SLOT_NOT_ASSIGNABLE"), (-1, "SLOT_NOT_ASSIGNABLE")):
            with self.assertRaises(InstallError) as cm:
                self.sd.install(valid(A10), slot=slot)
            self.assertEqual(cm.exception.code, code)
        self.assertEqual(self.sd.install(valid(A10))["slot"], 0)
        self.assertClean()

    def test_versions_no_downgrade(self):
        self.sd.install(valid(A10))
        g = self.reg()["generation"]
        self.assertEqual(self.sd.install(valid(A10))["action"], "unchanged")
        self.assertEqual(self.reg()["generation"], g)  # no-op: no bump
        self.assertEqual(self.sd.install(valid(A11))["action"], "upgrade")
        self.assertEqual(self.reg()["generation"], g)  # slot unchanged: no bump
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10))
        self.assertEqual(cm.exception.code, "DOWNGRADE_REFUSED")
        self.assertEqual(self.reg()["slots"][0]["id"], ID_A)

    def test_same_content_different_wrapper_is_idempotent(self):
        self.sd.install(valid(A10))
        p = validate_package(valid(A10))
        stored = write_canonical([("manifest.json", p.manifest_bytes), ("timeline.gtf", p.timeline_bytes)], deflate=False)
        self.assertNotEqual(stored, valid(A10))
        self.assertEqual(self.sd.install(stored)["action"], "unchanged")

    def test_same_version_different_bytes_is_conflict(self):
        self.sd.install(valid(A10))
        p = validate_package(valid(A11))
        m = dict(p.manifest, version="1.0.0")
        forged = write_canonical([("manifest.json", (json.dumps(m) + "\n").encode()), ("timeline.gtf", p.timeline_bytes)])
        with self.assertRaises(InstallError) as cm:
            self.sd.install(forged)
        self.assertEqual(cm.exception.code, "VERSION_CONFLICT")

    def test_uninstall_keeps_saves_no_purge(self):
        self.sd.install(valid(A10))
        r = self.sd.uninstall(ID_A)
        self.assertTrue(r["saves_kept"])
        self.assertFalse(os.path.exists(self.sd.level_dir(ID_A)))
        self.assertIsNone(self.reg()["slots"][0]["id"])
        with self.assertRaises(TypeError):
            self.sd.uninstall(ID_A, purge_saves=True)  # V0: no purge API at all
        with self.assertRaises(TypeError):
            self.sd.install(valid(A10), allow_downgrade=True)
        self.sd.install(valid(A10))
        self.assertClean()

    def test_assign_unassign_generation(self):
        self.sd.install(valid(A10), slot=None)
        g0 = self.reg()["generation"]
        self.sd.assign(ID_A, 1)
        self.assertEqual((self.reg()["slots"][1]["id"], self.reg()["generation"]), (ID_A, g0 + 1))
        self.assertEqual(self.sd.assign(ID_A, 1)["action"], "unchanged")
        self.assertEqual(self.reg()["generation"], g0 + 1)
        self.sd.unassign(ID_A)
        self.assertEqual(self.reg()["generation"], g0 + 2)
        with self.assertRaises(InstallError):
            self.sd.unassign(ID_A)
        with self.assertRaises(InstallError) as cm:
            self.sd.assign(ID_B, 0)
        self.assertEqual(cm.exception.code, "NOT_INSTALLED")
        self.assertClean()

    def test_generation_overflow_refused(self):
        self.sd.install(valid(A10), slot=None)
        r = self.reg()
        r["generation"] = 2147483647
        with open(self.sd.slots_path, "wb") as f:
            f.write(slotreg.dumps(r))
        before = snapshot(self.tmp)
        with self.assertRaises(InstallError) as cm:
            self.sd.assign(ID_A, 0)
        self.assertEqual(cm.exception.code, "SLOTS_GENERATION_OVERFLOW")
        self.assertEqual(snapshot(self.tmp), before)
        self.assertClean()

    def test_rejected_package_touches_nothing(self):
        before = snapshot(self.tmp)
        with self.assertRaises(PackageError):
            self.sd.install(valid(A10)[:-5])
        self.assertEqual(snapshot(self.tmp), before)

    def test_corrupt_and_legacy_slots_refused(self):
        os.makedirs(os.path.dirname(self.sd.slots_path), exist_ok=True)
        good = slotreg.default_registry()
        for content, code in ((b"{not json", "SLOTS_CORRUPT"),
                              (json.dumps([ID_A, None]).encode(), "SLOTS_LEGACY"),
                              (json.dumps(dict(good, capacity=3)).encode(), "SLOTS_CORRUPT"),
                              (b'{"format": "groove-slots/1", "format": "x"}', "SLOTS_CORRUPT"),
                              (b" " * (64 * 1024 + 1), "SLOTS_CORRUPT")):
            with open(self.sd.slots_path, "wb") as f:
                f.write(content)
            with self.assertRaises(InstallError) as cm:
                self.sd.install(valid(A10))
            self.assertEqual(cm.exception.code, code)
            self.assertEqual(open(self.sd.slots_path, "rb").read(), content)
        self.sd.init_slots(reset_corrupt=True)
        self.assertEqual(self.reg()["capacity"], 2)
        self.assertEqual(len([n for n in os.listdir(self.sd.backups) if n.endswith(".bad")]), 1)
        self.assertClean()

    def test_unmanaged_level_dir_refused(self):
        d = self.sd.level_dir(ID_A)
        os.makedirs(d)
        with open(os.path.join(d, "notes.txt"), "w") as f:
            f.write("user file")
        for call in (lambda: self.sd.install(valid(A10)), lambda: self.sd.uninstall(ID_A)):
            with self.assertRaises(InstallError) as cm:
                call()
            self.assertEqual(cm.exception.code, "LEVEL_DIR_UNEXPECTED")
        self.assertTrue(os.path.exists(os.path.join(d, "notes.txt")))
        self.assertClean()

    def test_installed_reads_are_bounded(self):
        self.sd.install(valid(A10))
        with open(os.path.join(self.sd.level_dir(ID_A), "timeline.gtf"), "ab") as f:
            f.write(b"#" * 70000)
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A11))
        self.assertEqual(cm.exception.code, "LEVEL_FILE_TOO_LARGE")
        self.assertClean()

    def test_bad_ids(self):
        for bad in ("../groove", "..", "org.x/../../y", "ORG.X", ID_A + "\n", "con.x"):
            with self.assertRaises(InstallError):
                self.sd.uninstall(bad)
            with self.assertRaises(InstallError):
                self.sd.assign(bad, 0)


class NoMarker(Base):
    with_marker = False

    def test_mutations_need_marker(self):
        before = snapshot(self.tmp)
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10))
        self.assertEqual(cm.exception.code, "ENGINE_UNKNOWN")
        with self.assertRaises(TypeError):
            self.sd.install(valid(A10), target=object())  # no override parameter for mutations
        self.assertEqual({k: v for k, v in snapshot(self.tmp).items() if v != "DIR"},
                         {k: v for k, v in before.items() if v != "DIR"})

    def test_plan_accepts_explicit_target(self):
        from _util import BUILD_ID, CAPS
        from groove_package.engine import make_target
        t = make_target("0.6.0", 1, BUILD_ID, CAPS, "explicit")
        r = self.sd.plan(valid(A10), target=t)
        self.assertEqual((r["action"], r["slot"]), ("install", 0))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "groove", "levels")))

    def test_v05_marker_refused(self):
        with open(os.path.join(self.tmp, "groove", "engine.json"), "wb") as f:
            f.write(marker(engine_version="0.5.0"))
        with self.assertRaises(InstallError) as cm:
            self.sd.install(valid(A10))
        self.assertEqual(cm.exception.code, "ENGINE_NO_PACKAGE_LOADER")
        os.remove(os.path.join(self.tmp, "groove", "engine.json"))


class SlotRegistry(unittest.TestCase):
    def test_capacity_growth_to_256(self):
        r2 = slotreg.grow(slotreg.default_registry(), 256)
        slotreg.validate(r2)
        self.assertEqual(len(r2["slots"]), 256)
        self.assertTrue(all(s["coord"] is None and s["id"] is None for s in r2["slots"][2:]))
        full = slotreg.with_assignment(slotreg.with_assignment(r2, 0, "a.b"), 1, "c.d")
        self.assertIsNone(slotreg.first_free(full))
        for cap in (257, 3, True):
            with self.assertRaises(InstallError):
                slotreg.grow(r2, cap)
        self.assertIs(slotreg.grow(r2, 256), r2)
        self.assertLess(len(slotreg.dumps(r2)), slotreg.MAX_SLOTS_BYTES)

    def test_invalid_registries(self):
        good = slotreg.default_registry()
        s0, s1 = good["slots"]
        grown = slotreg.grow(good, 3)
        s2 = grown["slots"][2]
        bads = {
            "capacity-1": dict(good, capacity=1, slots=[s0]),
            "capacity-bool": dict(good, capacity=True),
            "format": dict(good, format="x"),
            "generation-neg": dict(good, generation=-1),
            "generation-overflow": dict(good, generation=2147483648),
            "generation-float": dict(good, generation=1.0),
            "extra-key": dict(good, extra=1),
            "wrong-coord": dict(good, slots=[dict(s0, coord=[0, 9, 4]), s1]),
            "coord-bool": dict(good, slots=[dict(s0, coord=[False, 9, 0]), s1]),
            "coord-float": dict(good, slots=[dict(s0, coord=[0, 9.0, 0]), s1]),
            "coord-short": dict(good, slots=[dict(s0, coord=[0, 9]), s1]),
            "index-bool": dict(good, slots=[dict(s0, index=False), s1]),
            "dup-id": dict(good, slots=[dict(s0, id="a.b"), dict(s1, id="a.b")]),
            "bad-id": dict(good, slots=[dict(s0, id="../x"), s1]),
            "id-newline": dict(good, slots=[dict(s0, id="a.b\n"), s1]),
            "id-dos": dict(good, slots=[dict(s0, id="aux.b"), s1]),
            "order": dict(good, slots=[s1, s0]),
            "unmapped-with-id": dict(grown, slots=[s0, s1, dict(s2, id="a.b")]),
            "unmapped-with-coord": dict(grown, slots=[s0, s1, dict(s2, coord=[0, 9, 2])]),
        }
        for name, b in bads.items():
            with self.subTest(name):
                with self.assertRaises(InstallError):
                    slotreg.validate(b)


if __name__ == "__main__":
    unittest.main()
