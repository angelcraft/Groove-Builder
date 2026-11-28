"""Regressions for the GE-154 review of d3c971f (PR #8 comment 7239548049):
assign re-validates the installed level under the lock, contract in check_registry_capable,
forward-compatible unknown capabilities, lock acquire failure/short writes/release ownership
(incl. the Windows release order and a multi-process release/reacquire race), gate coherence,
recovery keeps evidence and works without a marker."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

from _util import valid, make_sd, marker, snapshot, REPO, A10, A11, B10, CAPS, BUILD_ID
from groove_package import lock as lockmod
from groove_package.engine import check_registry_capable, make_target, check_compat
from groove_package.errors import InstallError
from groove_package.fsops import FS, SimulatedCrash
from groove_package.installer import SD
from groove_package.lock import InstallerLock, read_token
from groove_package.validator import validate_package

ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
ID_B = "org.groovebuilder.2247d7d8-7f17-4a5f-8a47-be342e2f3844"


class SDCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        make_sd(self.tmp)
        self.sd = SD(self.tmp)

    def set_marker(self, **over):
        with open(os.path.join(self.sd.groove, "engine.json"), "wb") as f:
            f.write(marker(**over))

    def level_file(self, pid, name):
        return os.path.join(self.sd.levels, pid, name)

    def edit_manifest(self, pid, **over):
        p = self.level_file(pid, "manifest.json")
        with open(p, "rb") as f:
            m = json.loads(f.read())
        m.update(over)
        with open(p, "wb") as f:
            f.write(json.dumps(m).encode())

    def gate_open(self):
        return not os.path.exists(self.sd.lock_path) and not os.path.exists(self.sd.journal_path)


# ------------------------------------------------------------------------------------------- assign
class AssignRevalidation(SDCase):
    def setUp(self):
        super().setUp()
        self.sd.install(valid(A10), slot=None)
        self.sd.install(valid(B10), slot=None)

    def assert_refused(self, call, code):
        before = snapshot(self.tmp)
        with self.assertRaises(InstallError) as cm:
            call()
        self.assertEqual(cm.exception.code, code, str(cm.exception))
        self.assertEqual(snapshot(self.tmp), before)  # slots.json untouched, nothing staged
        self.assertTrue(self.gate_open())

    def test_happy_path(self):
        self.assertEqual(self.sd.assign(ID_A, 0)["slots"]["slots"][0]["id"], ID_A)
        self.assertEqual(self.sd.assign(ID_B, 1)["slots"]["slots"][1]["id"], ID_B)

    def test_specific_timeline_capability(self):
        self.set_marker(capabilities=[c for c in CAPS if c != "timeline.gtl"])
        self.assert_refused(lambda: self.sd.assign(ID_B, 1), "ENGINE_MISSING_CAPABILITY")  # B is .gtl
        self.sd.assign(ID_A, 0)  # .gtf level still assignable
        self.set_marker(capabilities=[c for c in CAPS if c != "timeline.gtf"])
        self.assert_refused(lambda: self.sd.assign(ID_B, 0), "SLOT_OCCUPIED")
        self.sd.unassign(ID_A)
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "ENGINE_MISSING_CAPABILITY")

    def test_adapter_capability(self):
        self.set_marker(capabilities=[c for c in CAPS if c != "adapter.multi"])
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "ENGINE_MISSING_CAPABILITY")

    def test_engine_min_of_installed_copy(self):
        self.edit_manifest(ID_A, engine_min="0.7.0")
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "ENGINE_TOO_OLD")
        self.set_marker(engine_version="0.7.0")
        self.sd.assign(ID_A, 0)

    def test_installed_copy_invalid(self):
        cases = {
            "contract": lambda: self.edit_manifest(ID_A, engine_contract=2),
            "adapter": lambda: self.edit_manifest(ID_A, adapter="single"),
            "caps": lambda: self.edit_manifest(ID_A, required_capabilities=["timeline.gtf", "x.y"]),
            "id-mismatch": lambda: self.edit_manifest(ID_A, id=ID_B),
            "results": lambda: self.edit_manifest(ID_A, results="native"),
            "manifest-junk": lambda: put(self.level_file(ID_A, "manifest.json"), b"{oops"),
            "timeline-bom": lambda: put(self.level_file(ID_A, "timeline.gtf"), b"\xef\xbb\xbf" + valid_tl),
            "timeline-no-start": lambda: put(self.level_file(ID_A, "timeline.gtf"), b"\n".join(
                ln for ln in valid_tl.split(b"\n") if not ln.strip().lower().startswith(b"start"))),
            "timeline-empty": lambda: put(self.level_file(ID_A, "timeline.gtf"), b""),
        }
        valid_tl = validate_package(valid(A10)).timeline_bytes
        pristine = {}
        for n in ("manifest.json", "timeline.gtf"):
            with open(self.level_file(ID_A, n), "rb") as f:
                pristine[n] = f.read()
        for name, edit in cases.items():
            with self.subTest(name):
                for n, b in pristine.items():
                    with open(self.level_file(ID_A, n), "wb") as f:
                        f.write(b)
                edit()
                self.assert_refused(lambda: self.sd.assign(ID_A, 0), "INSTALLED_INVALID")

    def test_level_dir_shape_and_bounds(self):
        with open(self.level_file(ID_A, "timeline.gtl"), "wb") as f:
            f.write(b"GTLM 1\n")
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "INSTALLED_INVALID")  # two timelines
        os.remove(self.level_file(ID_A, "timeline.gtl"))
        with open(self.level_file(ID_A, "notes.txt"), "wb") as f:
            f.write(b"x")
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "LEVEL_DIR_UNEXPECTED")
        os.remove(self.level_file(ID_A, "notes.txt"))
        with open(self.level_file(ID_A, "timeline.gtf"), "ab") as f:
            f.write(b"#" * (2 * 1024 * 1024))
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "LEVEL_FILE_TOO_LARGE")
        os.remove(self.level_file(ID_A, "timeline.gtf"))
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "INSTALLED_INVALID")

    def test_marker_rules(self):
        self.set_marker(engine_contract=2)
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "ENGINE_CONTRACT_UNSUPPORTED")
        self.set_marker(build_id="0" * 40)
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "ENGINE_UNKNOWN_BUILD")
        self.set_marker(engine_version="0.5.9")
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "ENGINE_MISSING_CAPABILITY")
        os.remove(os.path.join(self.sd.groove, "engine.json"))
        self.assert_refused(lambda: self.sd.assign(ID_A, 0), "ENGINE_UNKNOWN")  # no new assignment w/o marker

    def test_revalidation_runs_under_the_lock(self):
        seen = []
        orig = self.sd.installed_package

        def spy(pid):
            seen.append(os.path.exists(self.sd.lock_path))
            with self.assertRaises(InstallError) as cm:
                InstallerLock(self.sd.lock_path, self.sd.mutex_path).acquire()
            self.assertEqual(cm.exception.code, "LOCKED")
            return orig(pid)

        self.sd.installed_package = spy
        self.sd.assign(ID_A, 0)
        self.assertEqual(seen, [True])


class RegistryCapable(unittest.TestCase):
    def t(self, **over):
        a = dict(version="0.6.0", contract=1, build_id=BUILD_ID, capabilities=list(CAPS), source="marker")
        a.update(over)
        return make_target(**a)

    def test_contract_checked(self):
        check_registry_capable(self.t())
        for over, code in (({"contract": 2}, "ENGINE_CONTRACT_UNSUPPORTED"),
                           ({"contract": 0}, "ENGINE_CONTRACT_UNSUPPORTED"),
                           ({"build_id": "F" * 40}, "ENGINE_UNKNOWN_BUILD"),
                           ({"capabilities": ["package.runtime/1"]}, "ENGINE_MISSING_CAPABILITY")):
            with self.subTest(over):
                with self.assertRaises(InstallError) as cm:
                    check_registry_capable(self.t(**over))
                self.assertEqual(cm.exception.code, code)


class FutureCapabilities(SDCase):
    """Unknown, well-formed, unique capabilities are ignored; they never replace a required one."""
    FUTURE = ["future.thing/3", "adapter.single", "timeline.gtx", "registry.slots/2"]

    def test_accepted_and_ignored(self):
        self.set_marker(capabilities=list(CAPS) + self.FUTURE)
        self.assertEqual(self.sd.install(valid(A10))["action"], "install")
        self.sd.install(valid(B10), slot=None)
        self.sd.assign(ID_B, 1)

    def test_never_substitute_required(self):
        pkg = validate_package(valid(A10))
        for req in ("package.runtime/1", "registry.slots/1", "adapter.multi", "timeline.gtf"):
            with self.subTest(req):
                caps = [c for c in CAPS if c != req] + self.FUTURE
                with self.assertRaises(InstallError) as cm:
                    check_compat(pkg, make_target("0.6.0", 1, BUILD_ID, caps, "marker"))
                self.assertEqual(cm.exception.code, "ENGINE_MISSING_CAPABILITY")

    def test_unknown_contract_or_build_still_refused(self):
        pkg = validate_package(valid(A10))
        caps = list(CAPS) + self.FUTURE
        for args, code in ((("0.6.0", 2, BUILD_ID), "ENGINE_CONTRACT_UNSUPPORTED"),
                           (("0.6.0", 1, "A" * 40), "ENGINE_UNKNOWN_BUILD")):
            with self.subTest(code):
                with self.assertRaises(InstallError) as cm:
                    check_compat(pkg, make_target(*args, caps, "marker"))
                self.assertEqual(cm.exception.code, code)

    def test_malformed_or_duplicate_refused(self):
        for caps in (list(CAPS) + ["Future.Thing"], list(CAPS) + ["a b"], list(CAPS) + ["x/"],
                     list(CAPS) + ["future.thing/3", "future.thing/3"], list(CAPS) + [3]):
            with self.subTest(caps[-1]):
                self.set_marker(capabilities=caps)
                with self.assertRaises(InstallError) as cm:
                    self.sd.install(valid(A10))
                self.assertIn(cm.exception.code, ("ENGINE_BAD_CAPABILITIES", "ENGINE_JSON_INVALID"))


# --------------------------------------------------------------------------------------------- lock
def put(path, data):
    with open(path, "wb") as f:
        f.write(data)


def open_fds():
    try:
        return set(os.listdir("/proc/self/fd"))
    except OSError:
        return None


class LockBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.path = os.path.join(self.tmp, "lock")
        self.mutex = os.path.join(self.tmp, "mutex")

    def lock(self):
        return InstallerLock(self.path, self.mutex)


class LockAcquireFailure(LockBase):
    def boom(self, *a, **k):
        raise OSError(28, "No space left on device (injected)")

    def test_failures(self):
        for what in ("ftruncate", "fsync", "write"):
            for pre in (False, True):
                with self.subTest(what=what, preexisting=pre):
                    if pre:
                        put(self.path, b'{"pid": 1}')
                    fds = open_fds()
                    patcher = (mock.patch.object(lockmod, "_write_all", self.boom) if what == "write"
                               else mock.patch.object(lockmod.os, what, self.boom))
                    lk = self.lock()
                    with patcher:
                        with self.assertRaises(InstallError) as cm:
                            lk.acquire()
                    self.assertEqual(cm.exception.code, "LOCK_IO_ERROR")
                    self.assertIsNone(lk.fd)
                    if fds is not None:
                        self.assertEqual(open_fds(), fds, "fd leaked")
                    # a sentinel THIS call created is removed; a stale/kept one is never removed by a failure
                    self.assertEqual(os.path.exists(self.path), pre)
                    again = self.lock().acquire()  # the OS mutex was released
                    again.release()
                    self.assertEqual(os.path.exists(self.path), False)
                    self.assertTrue(os.path.exists(self.mutex))  # the mutex file itself is permanent

    def test_open_failure(self):
        os.chmod(self.tmp, 0o500)
        self.addCleanup(os.chmod, self.tmp, 0o700)
        if os.access(self.tmp, os.W_OK):
            self.skipTest("running as root / permissions not enforced")
        with self.assertRaises(InstallError) as cm:
            self.lock().acquire()
        self.assertEqual(cm.exception.code, "LOCK_IO_ERROR")

    def test_short_writes_are_completed(self):
        real = os.write
        with mock.patch.object(lockmod.os, "write", lambda fd, b: real(fd, bytes(b[:3]))):
            lk = self.lock().acquire()
        try:
            self.assertEqual(read_token(self.path), lk.token)
            with open(self.path) as f:
                self.assertEqual(json.load(f)["pid"], os.getpid())
        finally:
            lk.release()

    def test_zero_progress_write(self):
        with mock.patch.object(lockmod.os, "write", lambda fd, b: 0):
            with self.assertRaises(InstallError) as cm:
                self.lock().acquire()
        self.assertEqual(cm.exception.code, "LOCK_IO_ERROR")
        self.assertFalse(os.path.exists(self.path))

    def test_stale_content_overwritten(self):
        put(self.path, b"x" * 200)
        lk = self.lock().acquire()
        with open(self.path) as f:
            self.assertEqual(json.load(f)["token"], lk.token)  # truncated, not appended
        lk.release()


class LockOwnership(LockBase):
    def test_creation_is_proven_by_o_excl(self):
        """`preexisting` no longer comes from a lexists() before O_CREAT: a sentinel that appears between
        a check and the open is still reported as pre-existing, and then never removed on failure."""
        lk = self.lock()
        real = lockmod.InstallerLock._open_sentinel

        def sneaky(self_):
            put(self.path, b'{"pid": 7}')  # someone else's/kept sentinel appears just before our open
            return real(self_)

        with mock.patch.object(lockmod.InstallerLock, "_open_sentinel", sneaky):
            lk.acquire()
        self.assertEqual((lk.created, lk.preexisting), (False, True))
        lk.release(remove=False)
        self.assertTrue(os.path.exists(self.path))
        a = self.lock().acquire()
        self.assertEqual((a.created, a.preexisting), (False, True))
        a.release()
        b = self.lock().acquire()
        self.assertEqual((b.created, b.preexisting), (True, False))
        b.release()

    def test_kept_sentinel_survives_until_next_operation(self):
        a = self.lock().acquire()
        a.release(remove=False)  # journal pending: gate must stay closed
        self.assertTrue(os.path.exists(self.path))
        with self.assertRaises(InstallError) as cm:  # mutex free, but nobody may drop the sentinel for us
            b = self.lock().acquire()
            b.release(remove=False)
            raise InstallError("X", "never reached by a removal")
        self.assertEqual(cm.exception.code, "X")
        self.assertTrue(os.path.exists(self.path))

    def test_held_mutex_blocks_everything_and_touches_nothing(self):
        a = self.lock().acquire()
        try:
            put_before = read_token(self.path)
            for _ in range(3):
                with self.assertRaises(InstallError) as cm:
                    self.lock().acquire()
                self.assertEqual(cm.exception.code, "LOCKED")
            self.assertEqual(read_token(self.path), put_before)  # loser did not rewrite/remove the sentinel
        finally:
            a.release()
        self.assertFalse(os.path.exists(self.path))
        self.assertTrue(os.path.exists(self.mutex))

    def test_release_idempotent_and_keep_flag(self):
        lk = self.lock().acquire()
        lk.release()
        lk.release()
        self.assertFalse(os.path.exists(self.path))
        self.lock().acquire().release(remove=False)
        self.assertTrue(os.path.exists(self.path))
        self.lock().acquire().release()  # stale sentinel is reusable and then removed
        self.assertFalse(os.path.exists(self.path))

    def test_sd_never_deletes_mutex(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        make_sd(tmp)
        sd = SD(tmp)
        sd.install(valid(A10))
        self.assertTrue(os.path.isfile(sd.mutex_path))
        sd.uninstall(ID_A)
        self.assertTrue(os.path.isfile(sd.mutex_path))
        self.assertFalse(os.path.exists(sd.lock_path))
        self.assertEqual(os.listdir(sd.state), [])  # the gate directory stays clean


WORKER = textwrap.dedent("""
    import os, random, sys, time
    sys.path.insert(0, sys.argv[1])
    from groove_package.lock import InstallerLock
    from groove_package.errors import InstallError
    sentinel, mutex, state, n, seed = sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6])
    rnd = random.Random(seed)
    got = 0
    deadline = time.time() + 90
    while got < n and time.time() < deadline:
        lk = InstallerLock(sentinel, mutex)
        try:
            lk.acquire()
        except InstallError as e:
            assert e.code == "LOCKED", e
            continue
        try:
            # state file (touched only under the mutex) says whether the previous holder kept the sentinel
            expected = open(state).read() if os.path.exists(state) else "absent"
            actual = "present" if os.path.exists(sentinel) else "absent"
            # our own acquire just created/reused it, so compare against what acquire saw:
            was = "present" if lk.preexisting else "absent"
            assert was == expected, "sentinel %s but previous holder left it %s" % (was, expected)
            keep = rnd.random() < 0.4
            with open(state, "w") as f:
                f.write("present" if keep else "absent")
        finally:
            lk.release(remove=not keep)
        got += 1
    print(got)
""")


class LockMultiProcessRace(LockBase):
    """Real processes hammering acquire/release with random keep/remove (native msvcrt on Windows CI, flock
    elsewhere). Invariant: the sentinel is exactly as the previous holder left it - nobody removes a kept
    one and nobody leaves a removed one behind."""

    def test_mutual_exclusion_and_sentinel_integrity(self):
        state = os.path.join(self.tmp, "state")
        n = 200
        procs = [subprocess.Popen([sys.executable, "-c", WORKER, os.path.join(REPO, "tools"), self.path,
                                   self.mutex, state, str(n), str(i)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for i in range(4)]
        for p in procs:
            out, err = p.communicate(timeout=150)
            self.assertEqual(p.returncode, 0, err)
            self.assertEqual(int(out.split()[0]), n, out)
        with open(state) as f:
            self.assertEqual(os.path.exists(self.path), f.read() == "present")
        self.assertTrue(os.path.exists(self.mutex))


# ------------------------------------------------------------------------------- gate coherence
class GateFS(FS):
    """Records, for every mutating step, whether the runtime gate (lock file or journal) is closed."""

    def __init__(self, sd_paths, **kw):
        super().__init__(**kw)
        self.lock_path, self.journal_path, self.infra = sd_paths
        self.open_steps = []

    def _step(self, what):
        is_infra_mkdir = what.startswith("mkdir ") and what[6:] in self.infra
        if not is_infra_mkdir and not (os.path.exists(self.lock_path) or os.path.exists(self.journal_path)):
            self.open_steps.append(what)
        super()._step(what)


class GateCoherence(SDCase):
    def gfs(self, **kw):
        sd = self.sd
        return GateFS((sd.lock_path, sd.journal_path, {sd.groove, sd.levels, sd.state}), **kw)

    def test_gate_closed_during_every_mutation(self):
        ops = [lambda s: s.install(valid(A10), slot=None), lambda s: s.assign(ID_A, 0),
               lambda s: s.install(valid(A11)), lambda s: s.install(valid(B10)), lambda s: s.unassign(ID_B),
               lambda s: s.uninstall(ID_A), lambda s: s.uninstall(ID_B)]
        for i, op in enumerate(ops):
            with self.subTest(op=i):
                fs = self.gfs()
                op(SD(self.tmp, fs))
                self.assertGreater(fs.steps, 0)
                self.assertEqual(fs.open_steps, [])
                self.assertTrue(self.gate_open())  # and open again after a clean finish

    def test_gate_stays_closed_after_crash_until_recover(self):
        self.sd.install(valid(A10))
        n = 0
        probe = FS()
        SD(self.tmp, probe).install(valid(A11))
        self.sd.uninstall(ID_A)
        self.sd.install(valid(A10))
        for k in range(1, probe.steps + 1):
            with self.subTest(crash_at=k):
                tmp = tempfile.mkdtemp()
                self.addCleanup(shutil.rmtree, tmp, True)
                make_sd(tmp)
                SD(tmp).install(valid(A10))
                sd = SD(tmp)
                with self.assertRaises(SimulatedCrash):
                    SD(tmp, FS(crash_at=k)).install(valid(A11))
                self.assertTrue(os.path.exists(sd.lock_path) or os.path.exists(sd.journal_path))
                sd.recover()
                self.assertFalse(os.path.exists(sd.lock_path) or os.path.exists(sd.journal_path))
                n += 1
        self.assertGreater(n, 5)


# ------------------------------------------------------------------------------ recovery evidence
class RecoveryEvidence(SDCase):
    def crash_upgrade_after_prepared(self):
        self.sd.install(valid(A10))
        probe = FS()
        SD(self.tmp, probe).install(valid(A11))
        step = next(i for i, w in enumerate(probe.log, 1) if w.startswith("replace") and "levels" in w.split("->")[1])
        self.sd.uninstall(ID_A)
        self.sd.install(valid(A10))
        with self.assertRaises(SimulatedCrash):
            SD(self.tmp, FS(crash_at=step + 1)).install(valid(A11))
        with open(self.sd.journal_path) as f:
            return json.load(f)

    def test_rollback_keeps_evidence(self):
        j = self.crash_upgrade_after_prepared()
        self.assertEqual(j["state"], "prepared")
        self.assertEqual(self.sd.recover(), "rolled-back")
        dest = os.path.join(self.sd.backups, f"recovery-{j['tx']}")
        with open(os.path.join(dest, "journal.json")) as f:
            kept = json.load(f)
        self.assertEqual((kept["tx"], kept["state"]), (j["tx"], "aborted"))
        self.assertTrue(os.path.isfile(os.path.join(dest, "tx", "new-level", "manifest.json")))  # 1.1.0 kept
        self.assertEqual(os.listdir(self.sd.state), [])
        self.assertEqual(self.sd.installed(ID_A)[0]["version"], "1.0.0")

    def test_recover_without_marker(self):
        """Marker withdrawn (engine uninstalled): recovery, uninstall and unassign still work; no new assignment."""
        j = self.crash_upgrade_after_prepared()
        os.remove(os.path.join(self.sd.groove, "engine.json"))
        self.assertEqual(self.sd.recover(), "rolled-back")
        self.assertTrue(os.path.isdir(os.path.join(self.sd.backups, f"recovery-{j['tx']}")))
        for call, code in ((lambda: self.sd.assign(ID_A, 1), "ENGINE_UNKNOWN"),
                           (lambda: self.sd.install(valid(A11)), "ENGINE_UNKNOWN")):
            with self.assertRaises(InstallError) as cm:
                call()
            self.assertEqual(cm.exception.code, code)
        self.assertEqual(self.sd.unassign(ID_A)["action"], "unassign")
        saves = snapshot(self.sd.saves)
        self.assertTrue(self.sd.uninstall(ID_A)["removed_level"])
        self.assertEqual(snapshot(self.sd.saves), saves)

    def test_archive_collision_retains_everything(self):
        j = self.crash_upgrade_after_prepared()
        clash = os.path.join(self.sd.backups, f"recovery-{j['tx']}", "tx")
        os.makedirs(clash)
        with self.assertRaises(InstallError) as cm:
            self.sd.recover()
        self.assertEqual(cm.exception.code, "RECOVERY_ARCHIVE_EXISTS")
        self.assertTrue(os.path.exists(self.sd.journal_path))
        self.assertTrue(os.path.isdir(self.sd.tx_dir(j["tx"])))
        self.assertTrue(os.path.exists(self.sd.lock_path))  # gate stays closed
        shutil.rmtree(clash)
        self.assertEqual(self.sd.recover(), "rolled-back")  # rolled back already; archive now succeeds

    def test_normal_success_does_not_archive(self):
        self.sd.install(valid(A10))
        self.sd.install(valid(A11))
        self.assertFalse(os.path.exists(self.sd.backups) and os.listdir(self.sd.backups))


if __name__ == "__main__":
    unittest.main()
