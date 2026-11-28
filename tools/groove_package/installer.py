"""Transactional install / uninstall / slot assignment on a Switch SD root.

Layout (all under <SD>/groove/):
  levels/<id>/manifest.json + timeline.gtf|timeline.gtl   package content (Draft 0.2)
  slots.json                                               registry (DRAFT groove-slots/1)
  custom-saves/<id>.gsv[.bak]                              runtime-owned; never written here
  backups/saves/<id>.<tx>.gsv[.bak]                        copies made before an explicit purge
  .installer/lock, .installer/journal.json, .installer/tx-<tx>/   transaction state

Protocol (write-ahead journal, idempotent recovery):
  1. lock (O_EXCL)            2. stage everything inside tx dir + fsync
  3. journal state=prepared   4. apply atomic renames (old level -> tx, new level -> levels, slots.json.new -> slots.json)
  5. journal state=committed  6. cleanup (purge saves if requested, remove tx, journal, lock)
A crash before 3 leaves only tx garbage; between 3 and 5 recovery rolls BACK; after 5 it rolls FORWARD.
Nothing outside levels/<id>, slots.json, .installer/ and backups/ is ever modified, except
custom-saves/<id>.gsv* on `uninstall --purge-saves`, after a durable backup.
"""
import json
import os
import secrets
import time

from . import slots as slotreg
from .engine import resolve_target, check_compat
from .errors import InstallError, PackageError
from .fsops import FS
from .manifest import load_json_strict, validate_manifest, parse_version, TIMELINES
from .validator import validate_package

JOURNAL_FORMAT = "groove-install-journal/1"


class SD:
    def __init__(self, root, fs=None):
        self.root = os.path.abspath(root)
        self.groove = os.path.join(self.root, "groove")
        self.levels = os.path.join(self.groove, "levels")
        self.saves = os.path.join(self.groove, "custom-saves")
        self.backups = os.path.join(self.groove, "backups")
        self.state = os.path.join(self.groove, ".installer")
        self.slots_path = os.path.join(self.groove, "slots.json")
        self.journal_path = os.path.join(self.state, "journal.json")
        self.lock_path = os.path.join(self.state, "lock")
        self.fs = fs or FS()

    # ------------------------------------------------------------------ helpers
    def level_dir(self, pid):
        return os.path.join(self.levels, pid)

    def tx_dir(self, tx):
        return os.path.join(self.state, f"tx-{tx}")

    def _check_no_symlinks(self):
        for p in (self.groove, self.levels, self.saves, self.backups, self.state, self.slots_path):
            if os.path.islink(p):
                raise InstallError("SYMLINK_REFUSED", f"{p} is a symlink; refusing to operate")

    def _ensure_dirs(self):
        if not os.path.isdir(self.root):
            raise InstallError("SD_NOT_FOUND", f"SD root {self.root} does not exist")
        self._check_no_symlinks()
        for d in (self.groove, self.levels, self.state):
            self.fs.mkdir(d)

    def _acquire(self):
        self._ensure_dirs()
        if os.path.exists(self.journal_path):
            raise InstallError("RECOVERY_NEEDED", "an interrupted operation was found; run `recover` first")
        try:
            fd = os.open(self.lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        except FileExistsError:
            raise InstallError("LOCKED", "another installer holds the lock (or a crash left it): run `recover`") from None
        try:
            os.write(fd, json.dumps({"pid": os.getpid(), "time": int(time.time())}).encode())
            os.fsync(fd)
        finally:
            os.close(fd)

    def _release(self):
        if os.path.exists(self.lock_path):
            os.remove(self.lock_path)

    def read_slots(self):
        if not os.path.exists(self.slots_path):
            return None
        with open(self.slots_path, "rb") as f:
            return slotreg.parse(f.read())

    def installed(self, pid):
        """Return (manifest, files) for an installed level, None if absent; raise if not a clean level dir."""
        d = self.level_dir(pid)
        if os.path.islink(d):
            raise InstallError("SYMLINK_REFUSED", f"{d} is a symlink")
        if not os.path.exists(d):
            return None
        if not os.path.isdir(d):
            raise InstallError("LEVEL_DIR_UNEXPECTED", f"{d} is not a directory")
        try:
            with open(os.path.join(d, "manifest.json"), "rb") as f:
                man, _ = validate_manifest(load_json_strict(f.read()))
        except (OSError, PackageError) as e:
            raise InstallError("INSTALLED_CORRUPT", f"{d}: installed manifest unreadable/invalid ({e}); "
                                                    "uninstall it first") from None
        if man["id"] != pid:
            raise InstallError("INSTALLED_CORRUPT", f"{d}: manifest id {man['id']} != directory name")
        tl = TIMELINES[man["timeline"]["format"]]
        names = set(os.listdir(d))
        if names != {"manifest.json", tl}:
            raise InstallError("LEVEL_DIR_UNEXPECTED", f"{d} contains unexpected files {sorted(names)}; refusing to touch it")
        files = {}
        for n in names:
            with open(os.path.join(d, n), "rb") as f:
                files[n] = f.read()
        return man, files

    def _write_journal(self, j):
        tmp = self.journal_path + ".tmp"
        if os.path.exists(tmp):
            self.fs.remove(tmp)
        self.fs.write_file(tmp, json.dumps(j, sort_keys=True).encode())
        self.fs.replace(tmp, self.journal_path)

    # ------------------------------------------------------------- transaction
    def _run(self, j, stage):
        """Stage, journal, apply, commit, cleanup. `stage(txdir)` writes staged files.
        Returns True if cleanup finished, False if it must be completed by `recover`."""
        tx = j["tx"]
        txd = self.tx_dir(tx)
        try:
            self.fs.mkdir(txd)
            stage(txd)
            self._write_journal(j)
            self._apply(j)
            j["state"] = "committed"
            self._write_journal(j)
        except Exception:
            # In-process failure (I/O error, disk full): roll back now.
            try:
                self._recover_journal()
            finally:
                self._release()
            raise
        try:
            self._finish(j)
        except OSError:
            # Committed and durable; only cleanup is left. `recover` rolls it forward.
            self._release()
            return False
        self._release()
        return True

    def _apply(self, j):
        txd = self.tx_dir(j["tx"])
        if j.get("level"):
            dst = self.level_dir(j["id"])
            if j["had_level"]:
                self.fs.replace(dst, os.path.join(txd, "old-level"))
            if j["has_new_level"]:
                self.fs.replace(os.path.join(txd, "new-level"), dst)
        if j.get("slots"):
            self.fs.replace(os.path.join(txd, "slots.json.new"), self.slots_path)

    def _rollback(self, j):
        txd = self.tx_dir(j["tx"])
        if j.get("slots"):
            old = os.path.join(txd, "slots.json.old")
            if j["had_slots"]:
                if os.path.exists(old):
                    self.fs.replace(old, self.slots_path)
            elif os.path.exists(self.slots_path):
                self.fs.remove(self.slots_path)
        if j.get("level"):
            dst = self.level_dir(j["id"])
            new = os.path.join(txd, "new-level")
            if j["has_new_level"] and not os.path.exists(new) and os.path.exists(dst):
                self.fs.replace(dst, new)  # new level was applied: take it back out
            old = os.path.join(txd, "old-level")
            if j["had_level"] and os.path.exists(old) and not os.path.exists(dst):
                self.fs.replace(old, dst)

    def _finish(self, j):
        for p in j.get("purge", []):
            self.fs.remove(os.path.join(self.groove, p))
        self.fs.rmtree(self.tx_dir(j["tx"]))
        self.fs.remove(self.journal_path)

    def _abort_cleanup(self, j):
        self.fs.rmtree(self.tx_dir(j["tx"]))
        self.fs.remove(self.journal_path)

    def _recover_journal(self):
        if os.path.exists(self.journal_path):
            with open(self.journal_path, "rb") as f:
                j = json.loads(f.read())
            if j.get("format") != JOURNAL_FORMAT:
                raise InstallError("JOURNAL_CORRUPT", "unknown journal format; inspect .installer manually")
            if j["state"] == "committed":
                self._finish(j)
                result = "rolled-forward"
            elif j["state"] == "prepared":
                self._rollback(j)
                # Record that the live tree is restored BEFORE discarding the
                # staging dir: the rollback rules read the staging dir.
                j["state"] = "aborted"
                self._write_journal(j)
                self._abort_cleanup(j)
                result = "rolled-back"
            elif j["state"] == "aborted":
                self._abort_cleanup(j)
                result = "rolled-back"
            else:
                raise InstallError("JOURNAL_CORRUPT", f"unknown journal state {j['state']!r}")
        else:
            result = "clean"
        tmp = self.journal_path + ".tmp"
        if os.path.exists(tmp):
            self.fs.remove(tmp)
        if os.path.isdir(self.state):
            for n in sorted(os.listdir(self.state)):
                if n.startswith("tx-"):  # staging leftovers never referenced by a live journal
                    self.fs.rmtree(os.path.join(self.state, n))
                    if result == "clean":
                        result = "cleaned-staging"
        return result

    # ------------------------------------------------------------- public API
    def recover(self):
        """Finish or undo an interrupted operation. Safe to run any number of times."""
        if not os.path.isdir(self.groove):
            return "clean"
        self._check_no_symlinks()
        result = self._recover_journal()
        self._release()
        return result

    def install(self, data: bytes, target=None, slot="auto", allow_downgrade=False, **engine_kw):
        pkg = validate_package(data)
        target = target or resolve_target(self.groove, **engine_kw)
        check_compat(pkg, target)
        self._acquire()
        try:
            cur = self.installed(pkg.id)
            reg = self.read_slots()
            had_slots = reg is not None
            if reg is None:
                reg = slotreg.default_registry()
            action = "install"
            if cur is not None:
                cman, cfiles = cur
                cv, nv = parse_version(cman["version"]), pkg.version_tuple()
                if cv == nv:
                    if cfiles == pkg.files:
                        action = "unchanged"
                    else:
                        raise InstallError("VERSION_CONFLICT",
                                           f"{pkg.id} {pkg.version} is installed with different bytes; bump the version")
                elif nv < cv and not allow_downgrade:
                    raise InstallError("DOWNGRADE_REFUSED", f"installed {cman['version']} > package {pkg.version}")
                else:
                    action = "downgrade" if nv < cv else "upgrade"
            new_reg = reg
            current = slotreg.slot_of(reg, pkg.id)
            if slot == "auto":
                if current is None:
                    idx = slotreg.first_free(reg)
                    if idx is None:
                        raise InstallError("SLOTS_FULL", f"no free slot (capacity {reg['capacity']}); "
                                                         "use --no-slot or unassign one")
                    new_reg = slotreg.with_assignment(reg, idx, pkg.id)
            elif slot is not None:
                if current != slot:
                    new_reg = slotreg.with_assignment(reg, int(slot), pkg.id)
            if action == "unchanged" and new_reg is reg and had_slots:
                self._release()
                return {"action": "unchanged", "id": pkg.id, "version": pkg.version,
                        "slot": current, "sha256": pkg.sha256, "warnings": pkg.warnings}
        except BaseException:
            self._release()
            raise
        tx = secrets.token_hex(6)
        change_slots = new_reg is not reg or not had_slots
        j = {"format": JOURNAL_FORMAT, "tx": tx, "op": "install", "id": pkg.id, "state": "prepared",
             "level": action != "unchanged", "had_level": cur is not None, "has_new_level": True,
             "slots": change_slots, "had_slots": had_slots, "purge": [], "sha256": pkg.sha256}

        def stage(txd):
            if j["level"]:
                nl = os.path.join(txd, "new-level")
                self.fs.mkdir(nl)
                for name, body in sorted(pkg.files.items()):
                    self.fs.write_file(os.path.join(nl, name), body)
            if change_slots:
                self.fs.write_file(os.path.join(txd, "slots.json.new"), slotreg.dumps(new_reg))
                if had_slots:
                    self.fs.copy_file(self.slots_path, os.path.join(txd, "slots.json.old"))

        done = self._run(j, stage)
        return {"action": action, "cleanup_pending": not done, "id": pkg.id, "version": pkg.version,
                "slot": slotreg.slot_of(new_reg, pkg.id), "sha256": pkg.sha256, "warnings": pkg.warnings}

    def uninstall(self, pid, purge_saves=False):
        if not isinstance(pid, str) or not slotreg.ID_RE.match(pid):
            raise InstallError("BAD_ID", f"invalid id {pid!r}")
        self._acquire()
        try:
            d = self.level_dir(pid)
            if os.path.islink(d):
                raise InstallError("SYMLINK_REFUSED", f"{d} is a symlink")
            had_level = os.path.isdir(d)
            if had_level:
                names = set(os.listdir(d))
                if not names <= {"manifest.json", "timeline.gtf", "timeline.gtl"}:
                    raise InstallError("LEVEL_DIR_UNEXPECTED", f"{d} contains unexpected files {sorted(names)}")
            reg = self.read_slots()
            in_slot = reg is not None and slotreg.slot_of(reg, pid) is not None
            saves = [n for n in (f"{pid}.gsv", f"{pid}.gsv.bak")
                     if os.path.isfile(os.path.join(self.saves, n))] if purge_saves else []
            if not had_level and not in_slot and not saves:
                raise InstallError("NOT_INSTALLED", f"{pid} is not installed")
        except BaseException:
            self._release()
            raise
        tx = secrets.token_hex(6)
        new_reg = slotreg.without(reg, pid) if in_slot else None
        j = {"format": JOURNAL_FORMAT, "tx": tx, "op": "uninstall", "id": pid, "state": "prepared",
             "level": had_level, "had_level": had_level, "has_new_level": False,
             "slots": in_slot, "had_slots": True, "purge": [f"custom-saves/{n}" for n in saves]}
        backed = []

        def stage(txd):
            if new_reg is not None:
                self.fs.write_file(os.path.join(txd, "slots.json.new"), slotreg.dumps(new_reg))
                self.fs.copy_file(self.slots_path, os.path.join(txd, "slots.json.old"))
            if saves:
                bdir = os.path.join(self.backups, "saves")
                self.fs.mkdir(self.backups)
                self.fs.mkdir(bdir)
                for n in saves:
                    b = os.path.join(bdir, n.replace(".gsv", f".{tx}.gsv", 1))
                    self.fs.copy_file(os.path.join(self.saves, n), b)
                    backed.append(os.path.relpath(b, self.root))

        done = self._run(j, stage)
        return {"action": "uninstall", "cleanup_pending": not done, "id": pid, "removed_level": had_level, "unassigned": in_slot,
                "saves_kept": not purge_saves, "save_backups": backed}

    def _slots_tx(self, mutate, op):
        self._acquire()
        try:
            reg = self.read_slots()
            had = reg is not None
            new = mutate(reg if had else slotreg.default_registry())
        except BaseException:
            self._release()
            raise
        tx = secrets.token_hex(6)
        j = {"format": JOURNAL_FORMAT, "tx": tx, "op": op, "id": None, "state": "prepared",
             "level": False, "had_level": False, "has_new_level": False,
             "slots": True, "had_slots": had, "purge": []}

        def stage(txd):
            self.fs.write_file(os.path.join(txd, "slots.json.new"), slotreg.dumps(new))
            if had:
                self.fs.copy_file(self.slots_path, os.path.join(txd, "slots.json.old"))

        self._run(j, stage)
        return new

    def assign(self, pid, idx):
        if self.installed(pid) is None:
            raise InstallError("NOT_INSTALLED", f"{pid} is not installed")
        return self._slots_tx(lambda r: slotreg.with_assignment(r, idx, pid), "assign")

    def unassign(self, pid):
        def m(r):
            if slotreg.slot_of(r, pid) is None:
                raise InstallError("NOT_ASSIGNED", f"{pid} is not in any slot")
            return slotreg.without(r, pid)
        return self._slots_tx(m, "unassign")

    def init_slots(self, reset_corrupt=False):
        """Create slots.json (2 slots). With reset_corrupt, an unreadable one is backed up then replaced."""
        self._ensure_dirs()
        if not os.path.exists(self.slots_path):
            return self._slots_tx(lambda r: r, "init-slots")
        try:
            return self.read_slots()
        except InstallError:
            if not reset_corrupt:
                raise
        self._acquire()
        tx = secrets.token_hex(6)
        new = slotreg.default_registry()
        j = {"format": JOURNAL_FORMAT, "tx": tx, "op": "reset-slots", "id": None, "state": "prepared",
             "level": False, "had_level": False, "has_new_level": False,
             "slots": True, "had_slots": True, "purge": []}

        def stage(txd):
            self.fs.mkdir(self.backups)
            self.fs.copy_file(self.slots_path, os.path.join(self.backups, f"slots.json.{tx}.bad"))
            self.fs.write_file(os.path.join(txd, "slots.json.new"), slotreg.dumps(new))
            self.fs.copy_file(self.slots_path, os.path.join(txd, "slots.json.old"))

        self._run(j, stage)
        return new

    def status(self):
        out = {"slots": None, "levels": [], "problems": []}
        try:
            out["slots"] = self.read_slots()
        except InstallError as e:
            out["problems"].append(str(e))
        if os.path.exists(self.journal_path) or os.path.exists(self.lock_path):
            out["problems"].append("interrupted operation or stale lock: run `recover`")
        if os.path.isdir(self.levels):
            for n in sorted(os.listdir(self.levels)):
                try:
                    cur = self.installed(n)
                    out["levels"].append({"id": n, "version": cur[0]["version"], "title": cur[0]["title"],
                                          "save": os.path.isfile(os.path.join(self.saves, n + ".gsv"))})
                except InstallError as e:
                    out["problems"].append(str(e))
        if out["slots"]:
            for s in out["slots"]["slots"]:
                if s["id"] and not os.path.isdir(self.level_dir(s["id"])):
                    out["problems"].append(f"slot {s['index']} references missing level {s['id']}")
        return out
