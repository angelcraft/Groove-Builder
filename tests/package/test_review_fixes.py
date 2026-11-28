"""Regressions for the GE-154 security review of 447f562 (PR #8 comment 7230925053):
untrusted journal, lock exclusion, check-under-lock, links/junctions, bounded reads, unknown staging."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

from _util import valid, make_sd, snapshot, REPO, A10, A11
from groove_package.errors import InstallError
from groove_package.installer import SD, level_digest_of, JOURNAL_FORMAT
from groove_package.lock import InstallerLock
from groove_package.validator import validate_package

ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
POSIX = os.name != "nt"


def journal(**over):
    j = {"format": JOURNAL_FORMAT, "tx": "0123456789ab", "op": "uninstall", "id": ID_A, "state": "committed",
         "level": True, "had_level": True, "has_new_level": False, "slots": False, "had_slots": False,
         "level_old": "0" * 64, "level_new": None, "slots_old": None, "slots_new": None, "package_sha256": None}
    j.update(over)
    return j


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        make_sd(self.tmp)
        self.sd = SD(self.tmp)
        self.sd.install(valid(A10))

    def write_journal(self, obj_or_bytes):
        raw = obj_or_bytes if isinstance(obj_or_bytes, bytes) else json.dumps(obj_or_bytes).encode()
        with open(self.sd.journal_path, "wb") as f:
            f.write(raw)


class MaliciousJournal(Base):
    CASES = {
        "traversal-id": (journal(id="../../../atmosphere"), "JOURNAL_CORRUPT"),
        "traversal-tx": (journal(tx="../../../x"), "JOURNAL_CORRUPT"),
        "purge-list": (dict(journal(), purge=["custom-saves/" + ID_A + ".gsv"]), "JOURNAL_CORRUPT"),
        "missing-key": ({k: v for k, v in journal().items() if k != "had_level"}, "JOURNAL_CORRUPT"),
        "string-bool": (journal(level="true"), "JOURNAL_CORRUPT"),
        "bad-state": (journal(state="done"), "JOURNAL_CORRUPT"),
        "bad-op": (journal(op="rm"), "JOURNAL_CORRUPT"),
        "bad-hash": (journal(level_old="../x"), "JOURNAL_CORRUPT"),
        "flags-inconsistent": (journal(has_new_level=True), "JOURNAL_CORRUPT"),
        "slot-op-with-level": (journal(op="assign"), "JOURNAL_CORRUPT"),
        "committed-but-level-present": (journal(), "JOURNAL_TAMPERED"),
        "prepared-content-unknown": (journal(state="prepared"), "JOURNAL_TAMPERED"),
        "not-json": (b"{oops", "JOURNAL_CORRUPT"),
        "oversize": (b" " * 5000, "JOURNAL_CORRUPT"),
        "duplicate-key": (b'{"state": "committed", "state": "prepared"}', "JOURNAL_CORRUPT"),
    }

    def test_rejected_and_evidence_retained(self):
        for name, (j, code) in self.CASES.items():
            with self.subTest(name):
                self.write_journal(j)
                before = snapshot(self.tmp)
                before.pop(os.path.join("groove", ".installer", "lock"), None)
                with self.assertRaises(InstallError) as cm:
                    self.sd.recover()
                self.assertEqual(cm.exception.code, code, str(cm.exception))
                after = snapshot(self.tmp)
                after.pop(os.path.join("groove", ".installer", "lock"), None)
                self.assertEqual(after, before)  # nothing moved or deleted
                self.assertTrue(os.path.exists(self.sd.journal_path))
                self.assertTrue(os.path.exists(self.sd.lock_path))  # runtime gate stays closed
                # ordinary operations stay blocked
                with self.assertRaises(InstallError) as cm2:
                    self.sd.install(valid(A11))
                self.assertEqual(cm2.exception.code, "RECOVERY_NEEDED")
                os.remove(self.sd.journal_path)
        self.assertTrue(os.path.isdir(self.sd.level_dir(ID_A)))

    def test_tx_dir_with_foreign_entries_retained(self):
        files = validate_package(valid(A10)).files
        txd = os.path.join(self.sd.state, "tx-0123456789ab")
        os.makedirs(txd)
        with open(os.path.join(txd, "evil"), "w") as f:
            f.write("x")
        self.write_journal(journal(op="install", state="staging", had_level=True, has_new_level=True,
                                   level_old=level_digest_of(files), level_new="1" * 64, package_sha256="2" * 64))
        with self.assertRaises(InstallError) as cm:
            self.sd.recover()
        self.assertEqual(cm.exception.code, "JOURNAL_TAMPERED")
        self.assertTrue(os.path.exists(os.path.join(txd, "evil")))

    @unittest.skipUnless(POSIX, "symlinks need privileges on Windows")
    def test_tx_dir_with_symlink_retained(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        with open(os.path.join(outside, "precious"), "w") as f:
            f.write("keep")
        files = validate_package(valid(A10)).files
        txd = os.path.join(self.sd.state, "tx-0123456789ab")
        os.makedirs(txd)
        os.symlink(outside, os.path.join(txd, "old-level"))
        self.write_journal(journal(op="install", state="committed", had_level=True, has_new_level=True,
                                   level_old="1" * 64, level_new=level_digest_of(files), package_sha256="2" * 64))
        with self.assertRaises(InstallError) as cm:
            self.sd.recover()
        self.assertEqual(cm.exception.code, "SYMLINK_REFUSED")
        self.assertTrue(os.path.exists(os.path.join(outside, "precious")))


HOLDER = textwrap.dedent("""
    import sys
    sys.path.insert(0, sys.argv[1])
    from groove_package.lock import InstallerLock
    lk = InstallerLock(sys.argv[2], sys.argv[3]).acquire()
    print("locked", flush=True)
    sys.stdin.read()
    lk.release()
""")


class Concurrency(Base):
    def hold_lock(self):
        p = subprocess.Popen([sys.executable, "-c", HOLDER, os.path.join(REPO, "tools"), self.sd.lock_path, self.sd.mutex_path],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.assertEqual(p.stdout.readline().strip(), "locked")
        return p

    def test_recover_and_ops_refused_while_other_process_holds_lock(self):
        p = self.hold_lock()
        try:
            before = snapshot(self.tmp)
            for call in (self.sd.recover, lambda: self.sd.install(valid(A11)), lambda: self.sd.uninstall(ID_A),
                         lambda: self.sd.assign(ID_A, 1), lambda: self.sd.assign("org.not.installed", 1),
                         lambda: self.sd.unassign(ID_A), self.sd.init_slots):
                with self.assertRaises(InstallError) as cm:
                    call()
                self.assertEqual(cm.exception.code, "LOCKED")  # refused before any read or check
            self.assertEqual(snapshot(self.tmp), before)
            self.assertTrue(os.path.exists(self.sd.lock_path))  # live lock never unlinked
        finally:
            p.stdin.close()
            p.wait()
        self.assertEqual(self.sd.install(valid(A11))["action"], "upgrade")
        self.assertFalse(os.path.exists(self.sd.lock_path))

    def test_stale_lock_file_after_crash_is_recoverable(self):
        with open(self.sd.lock_path, "w") as f:
            f.write('{"pid": 999999}')
        self.assertEqual(self.sd.recover(), "clean")
        self.assertFalse(os.path.exists(self.sd.lock_path))

    def test_same_process_second_lock_conflicts(self):
        a = InstallerLock(self.sd.lock_path, self.sd.mutex_path).acquire()
        try:
            with self.assertRaises(InstallError):
                InstallerLock(self.sd.lock_path, self.sd.mutex_path).acquire()
        finally:
            a.release()


@unittest.skipUnless(POSIX, "symlinks need privileges on Windows; junctions are covered by the reparse-point check")
class Links(Base):
    def setUp(self):
        super().setUp()
        self.outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.outside, True)
        self.precious = os.path.join(self.outside, "timeline.gtf")
        with open(self.precious, "wb") as f:
            f.write(b"outside")

    def test_symlinked_member_in_level(self):
        t = os.path.join(self.sd.level_dir(ID_A), "timeline.gtf")
        os.remove(t)
        os.symlink(self.precious, t)
        for call in (lambda: self.sd.install(valid(A11)), lambda: self.sd.uninstall(ID_A)):
            with self.assertRaises(InstallError) as cm:
                call()
            self.assertEqual(cm.exception.code, "SYMLINK_REFUSED")
        self.assertEqual(open(self.precious, "rb").read(), b"outside")

    def test_symlinked_components(self):
        for rel in ("groove/.installer", "groove/levels", "groove/slots.json"):
            with self.subTest(rel):
                root = tempfile.mkdtemp()
                self.addCleanup(shutil.rmtree, root, True)
                make_sd(root)
                p = os.path.join(root, *rel.split("/"))
                os.makedirs(os.path.dirname(p), exist_ok=True)
                os.symlink(self.outside, p)
                with self.assertRaises(InstallError) as cm:
                    SD(root).install(valid(A10))
                self.assertEqual(cm.exception.code, "SYMLINK_REFUSED")
                self.assertEqual(sorted(os.listdir(self.outside)), ["timeline.gtf"])

    def test_symlinked_root_and_groove(self):
        real = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, real, True)
        make_sd(real)
        link = os.path.join(self.outside, "sdlink")
        os.symlink(real, link)
        with self.assertRaises(InstallError) as cm:
            SD(link).install(valid(A10))
        self.assertEqual(cm.exception.code, "SYMLINK_REFUSED")
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        os.symlink(os.path.join(real, "groove"), os.path.join(root, "groove"))
        with self.assertRaises(InstallError) as cm:
            SD(root).install(valid(A10))
        self.assertEqual(cm.exception.code, "SYMLINK_REFUSED")


class UnknownStaging(Base):
    def test_never_deleted(self):
        foreign = os.path.join(self.sd.state, "tx-deadbeef0000")
        os.makedirs(foreign)
        with open(os.path.join(foreign, "user-evidence"), "w") as f:
            f.write("keep")
        with open(os.path.join(self.sd.state, "notes.txt"), "w") as f:
            f.write("keep")
        self.assertEqual(self.sd.recover(), "clean")
        self.sd.install(valid(A11))
        self.sd.uninstall(ID_A)
        self.assertTrue(os.path.exists(os.path.join(foreign, "user-evidence")))
        self.assertTrue(os.path.exists(os.path.join(self.sd.state, "notes.txt")))
        probs = " ".join(self.sd.status()["problems"])
        self.assertIn("tx-deadbeef0000", probs)
        self.assertIn("notes.txt", probs)

    def test_tx_collision_refused(self):
        import secrets
        orig = secrets.token_hex
        os.makedirs(os.path.join(self.sd.state, "tx-aaaaaaaaaaaa"))
        secrets.token_hex = lambda n: "aaaaaaaaaaaa"
        try:
            with self.assertRaises(InstallError) as cm:
                self.sd.install(valid(A11))
            self.assertEqual(cm.exception.code, "TX_COLLISION")
        finally:
            secrets.token_hex = orig
        self.assertTrue(os.path.isdir(os.path.join(self.sd.state, "tx-aaaaaaaaaaaa")))
        self.assertFalse(os.path.exists(self.sd.journal_path))


if __name__ == "__main__":
    unittest.main()
