"""Offline, transactional install / uninstall / slot assignment on a Switch SD root.

GE-154 Draft 0.3 V0 decisions (docs/GROOVE_INTEGRATION_V0_DECISIONS.md @ 3642b7e):
  * installer owns levels/, slots.json, .installer/, backups/; runtime alone owns custom-saves/
  * no downgrade and no save purge in V0; nothing in custom-saves/ is ever written or deleted
  * every SD mutation requires a valid sd:/groove/engine.json marker (no CLI override)
  * exclusive OS lock held from the first read to the end (also for recover)
  * the recovery journal is untrusted input: strict schema, derived paths only, content
    hashes verified before any mutation; anything unexpected is retained and reported
  * links/junctions/reparse points refused on every traversed component; bounded reads
  * unknown .installer/tx-* directories are never deleted

Layout under <SD>/groove/:
  levels/<id>/{manifest.json, timeline.gtf|timeline.gtl}    slots.json    engine.json (read only)
  .installer/lock  .installer/journal.json  .installer/tx-<12 hex>/{new-level/, old-level/, slots.json.new, slots.json.old}

Protocol: lock -> journal(staging) -> stage in tx + fsync -> journal(prepared) -> atomic renames
-> journal(committed) -> cleanup -> unlock. Recovery: staging/aborted -> discard tx; prepared ->
roll back by moving content (never deleting it); committed -> discard tx.
Linux fault injection is not proof of FAT/exFAT power-loss durability (see README).
"""
import hashlib
import os
import re
import secrets
import stat

from . import jsonstrict, limits
from . import slots as slotreg
from .engine import resolve_marker, check_compat, check_registry_capable
from .errors import InstallError, PackageError
from .fsops import FS
from .lock import InstallerLock
from .manifest import load_json_strict, validate_manifest, parse_version, valid_id_syntax, TIMELINES
from .safefs import check_chain, check_tree, read_bounded, lstat_or_none, is_link_like
from .validator import validate_package

JOURNAL_FORMAT = "groove-install-journal/2"
JOURNAL_KEYS = {"format", "tx", "op", "id", "state", "level", "had_level", "has_new_level", "slots",
                "had_slots", "level_old", "level_new", "slots_old", "slots_new", "package_sha256"}
OPS = {"install", "uninstall", "assign", "unassign", "init-slots", "reset-slots"}
STATES = {"staging", "prepared", "committed", "aborted"}
TX_RE = re.compile(r"[0-9a-f]{12}")
HEX64 = re.compile(r"[0-9a-f]{64}")
SLOTS_HASH_CAP = limits.MAX_SLOTS_JSON + 1024 * 1024  # corrupt files may be larger; only hashed/backed up
TX_NAMES = {"new-level", "old-level", "slots.json.new", "slots.json.old"}
LEVEL_FILES = {"manifest.json": limits.MAX_MANIFEST_BYTES,
               "timeline.gtf": limits.MAX_TIMELINE_BYTES, "timeline.gtl": limits.MAX_TIMELINE_BYTES}


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def level_digest_of(files: dict) -> str:
    h = hashlib.sha256()
    for name in sorted(files):
        h.update(name.encode("ascii") + b"\0" + hashlib.sha256(files[name]).digest())
    return h.hexdigest()


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

    # ------------------------------------------------------------------ paths
    def level_dir(self, pid):
        if not valid_id_syntax(pid):
            raise InstallError("BAD_ID", f"invalid id {pid!r}")
        return os.path.join(self.levels, pid)

    def tx_dir(self, tx):
        if not (isinstance(tx, str) and TX_RE.fullmatch(tx)):
            raise InstallError("JOURNAL_CORRUPT", "invalid transaction id")
        return os.path.join(self.state, f"tx-{tx}")

    def _chk(self, *paths):
        for p in paths:
            check_chain(self.root, p)

    def _ensure_dirs(self):
        st = lstat_or_none(self.root)
        if st is None or not stat.S_ISDIR(st.st_mode) and not is_link_like(st):
            raise InstallError("SD_NOT_FOUND", f"SD root {self.root} does not exist")
        self._chk(self.groove, self.levels, self.state, self.slots_path, self.saves, self.backups)
        for d in (self.groove, self.levels, self.state):
            self.fs.mkdir(d)

    # ------------------------------------------------------------- reading
    def read_slots(self):
        self._chk(self.slots_path)
        try:
            raw = read_bounded(self.slots_path, slotreg.MAX_SLOTS_BYTES, "SLOTS_CORRUPT")
        except FileNotFoundError:
            return None
        return slotreg.parse(raw)

    def _slots_hash(self, path):
        try:
            return _sha(read_bounded(path, SLOTS_HASH_CAP, "SLOTS_CORRUPT"))
        except FileNotFoundError:
            return None

    def _read_level_files(self, d):
        """Bounded read of a level directory; refuses links and unexpected entries."""
        self._chk(d)
        st = lstat_or_none(d)
        if st is None:
            return None
        if not stat.S_ISDIR(st.st_mode):
            raise InstallError("LEVEL_DIR_UNEXPECTED", f"{d} is not a directory")
        names = set(os.listdir(d))
        if not names <= set(LEVEL_FILES):
            raise InstallError("LEVEL_DIR_UNEXPECTED", f"{d} contains unexpected entries {sorted(names - set(LEVEL_FILES))}")
        return {n: read_bounded(os.path.join(d, n), LEVEL_FILES[n], "LEVEL_FILE_TOO_LARGE") for n in names}

    def _level_hash(self, d):
        files = self._read_level_files(d)
        return None if files is None else level_digest_of(files)

    def installed(self, pid):
        """Return (manifest, files) for an installed level, None if absent; raise if not a clean level dir."""
        files = self._read_level_files(self.level_dir(pid))
        if files is None:
            return None
        try:
            man, _ = validate_manifest(load_json_strict(files.get("manifest.json", b"")))
        except PackageError as e:
            raise InstallError("INSTALLED_CORRUPT", f"{pid}: installed manifest invalid ({e})") from None
        if man["id"] != pid:
            raise InstallError("INSTALLED_CORRUPT", f"{pid}: manifest id {man['id']} != directory name")
        if set(files) != {"manifest.json", TIMELINES[man["timeline"]["format"]]}:
            raise InstallError("LEVEL_DIR_UNEXPECTED", f"{pid}: incomplete level directory {sorted(files)}")
        return man, files

    def unknown_staging(self):
        out = []
        if os.path.isdir(self.state):
            for n in sorted(os.listdir(self.state)):
                if n not in ("lock", "journal.json", "journal.json.tmp"):
                    out.append(n)
        return out

    # ------------------------------------------------------------- journal
    def _write_journal(self, j):
        validate_journal(j)
        tmp = self.journal_path + ".tmp"
        self._chk(tmp)
        if os.path.lexists(tmp):
            self.fs.remove(tmp)
        self.fs.write_file(tmp, jsonstrict_dumps(j))
        self.fs.replace(tmp, self.journal_path)

    def _read_journal(self):
        self._chk(self.journal_path)
        try:
            raw = read_bounded(self.journal_path, limits.MAX_JOURNAL_JSON, "JOURNAL_CORRUPT")
        except FileNotFoundError:
            return None
        j = jsonstrict.loads(raw, limits.MAX_JOURNAL_JSON,
                             lambda k, m: InstallError("JOURNAL_CORRUPT", f"journal: {m}"), 2)
        validate_journal(j)
        return j

    # --------------------------------------------------------- transaction
    def _locations(self, j):
        txd = self.tx_dir(j["tx"])
        L = self.level_dir(j["id"]) if j["level"] else None
        return txd, L

    def _verify(self, j):
        """Check live content against the journal's hashes BEFORE mutating. Raises JOURNAL_TAMPERED."""
        txd, L = self._locations(j)
        self._chk(txd)
        if os.path.lexists(txd):
            check_tree(txd)
            extra = set(os.listdir(txd)) - TX_NAMES
            if extra:
                raise InstallError("JOURNAL_TAMPERED", f"unexpected entries in {txd}: {sorted(extra)}")
        st = j["state"]
        if st == "staging":
            here = {}
        else:
            here = {}
            if j["level"]:
                here["L"] = self._level_hash(L)
                here["TN"] = self._level_hash(os.path.join(txd, "new-level"))
                here["TO"] = self._level_hash(os.path.join(txd, "old-level"))
            if j["slots"]:
                here["S"] = self._slots_hash(self.slots_path)
                here["SN"] = self._slots_hash(os.path.join(txd, "slots.json.new"))
                here["SO"] = self._slots_hash(os.path.join(txd, "slots.json.old"))
        lo, ln, so, sn = j["level_old"], j["level_new"], j["slots_old"], j["slots_new"]

        def bad(msg):
            raise InstallError("JOURNAL_TAMPERED", f"recovery refused, evidence retained: {msg}")

        if st in ("staging", "aborted"):
            if j["level"] and self._level_hash(L) != lo:
                bad("level directory differs from its pre-transaction state")
            if j["slots"] and self._slots_hash(self.slots_path) != so:
                bad("slots.json differs from its pre-transaction state")
        elif st == "committed":
            if j["level"] and here["L"] != ln:
                bad("level directory differs from the committed state")
            if j["slots"] and here["S"] != sn:
                bad("slots.json differs from the committed state")
        else:  # prepared: every location holds an expected version, nothing is lost
            if j["level"]:
                if here["L"] not in {lo, ln, None}:
                    bad("level directory has unexpected content")
                if here["TN"] not in (None, ln) or here["TO"] not in (None, lo):
                    bad("staged level content changed")
                if ln is not None and ln not in (here["L"], here["TN"]):
                    bad("new level content missing")
                if lo is not None and lo not in (here["L"], here["TO"]):
                    bad("previous level content missing")
            if j["slots"]:
                if here["S"] not in {so, sn, None}:
                    bad("slots.json has unexpected content")
                if here["SN"] not in (None, sn) or here["SO"] not in (None, so):
                    bad("staged slots.json changed")
                if sn not in (here["S"], here["SN"]):
                    bad("new slots.json missing")
                if so is not None and so not in (here["S"], here["SO"]):
                    bad("previous slots.json missing")
                if so is None and here["S"] is None and here["SN"] is None:
                    bad("slots.json missing")
        return here

    def _apply(self, j):
        txd, L = self._locations(j)
        if j["level"]:
            if j["had_level"]:
                self.fs.replace(L, os.path.join(txd, "old-level"))
            if j["has_new_level"]:
                self.fs.replace(os.path.join(txd, "new-level"), L)
        if j["slots"]:
            self.fs.replace(os.path.join(txd, "slots.json.new"), self.slots_path)

    def _rollback(self, j):
        """Move content back; never delete it. Idempotent (re-verified on every run)."""
        txd, L = self._locations(j)
        if j["slots"]:
            if self._slots_hash(self.slots_path) == j["slots_new"]:
                self.fs.replace(self.slots_path, os.path.join(txd, "slots.json.new"))
            if j["had_slots"] and not os.path.lexists(self.slots_path):
                self.fs.replace(os.path.join(txd, "slots.json.old"), self.slots_path)
        if j["level"]:
            if j["has_new_level"] and self._level_hash(L) == j["level_new"]:
                self.fs.replace(L, os.path.join(txd, "new-level"))
            if j["had_level"] and not os.path.lexists(L):
                self.fs.replace(os.path.join(txd, "old-level"), L)

    def _discard(self, j):
        txd = self.tx_dir(j["tx"])
        self.fs.rmtree(txd)  # verified: only TX_NAMES, no links
        self.fs.remove(self.journal_path)

    def _drop_journal_tmp(self):
        tmp = self.journal_path + ".tmp"
        self._chk(tmp)
        if os.path.lexists(tmp):
            st = os.lstat(tmp)
            if stat.S_ISREG(st.st_mode) and not is_link_like(st):
                self.fs.remove(tmp)  # never renamed into place => never authoritative

    def _recover_locked(self):
        j = self._read_journal()
        if j is None:
            self._drop_journal_tmp()
            return "clean"
        self._verify(j)
        self._drop_journal_tmp()
        if j["state"] == "prepared":
            self._rollback(j)
            self._verify(dict(j, state="aborted"))
            j = dict(j, state="aborted")
            self._write_journal(j)
            self._discard(j)
            return "rolled-back"
        self._discard(j)
        return "rolled-forward" if j["state"] == "committed" else "rolled-back"

    def _run(self, j, stage):
        """Caller holds the lock. Returns True if cleanup finished, False if `recover` must finish it."""
        txd = self.tx_dir(j["tx"])
        self._chk(txd)
        if os.path.lexists(txd):
            raise InstallError("TX_COLLISION", f"{txd} already exists; not touching it")
        try:
            self._write_journal(dict(j, state="staging"))
            self.fs.mkdir(txd)
            stage(txd)
            self._write_journal(dict(j, state="prepared"))
            self._apply(j)
            self._write_journal(dict(j, state="committed"))
        except Exception:
            self._recover_locked()  # in-process failure (I/O error, disk full): roll back now
            raise
        try:
            self._discard(j)
        except OSError:
            return False
        return True

    def _locked(self, fn, need_clean=True):
        self._ensure_dirs()
        lk = InstallerLock(self.lock_path)
        lk.acquire()
        keep_lock_file = False
        try:
            if need_clean and os.path.lexists(self.journal_path):
                keep_lock_file = True  # runtime gate stays closed until `recover`
                raise InstallError("RECOVERY_NEEDED", "an interrupted operation was found; run `recover` first")
            return fn()
        except InstallError as e:
            if e.code in ("JOURNAL_TAMPERED", "JOURNAL_CORRUPT"):
                keep_lock_file = True
            raise
        finally:
            if os.path.lexists(self.journal_path):
                keep_lock_file = True
            lk.release(remove=not keep_lock_file)

    def _new_journal(self, op, pid, **kw):
        j = {"format": JOURNAL_FORMAT, "tx": secrets.token_hex(6), "op": op, "id": pid, "state": "staging",
             "level": False, "had_level": False, "has_new_level": False, "slots": False, "had_slots": False,
             "level_old": None, "level_new": None, "slots_old": None, "slots_new": None, "package_sha256": None}
        j.update(kw)
        return j

    # ------------------------------------------------------------- public API
    def recover(self):
        """Finish or undo an interrupted operation under the exclusive lock. Idempotent."""
        if not os.path.isdir(self.groove):
            return "clean"
        return self._locked(self._recover_locked, need_clean=False)

    def plan(self, data: bytes, target=None, slot="auto"):
        """Read-only dry run. `target` (explicit override) is allowed only here."""
        pkg = validate_package(data)
        tgt = target if target is not None else resolve_marker(self.groove)
        check_compat(pkg, tgt)
        cur = self.installed(pkg.id) if os.path.isdir(self.groove) else None
        reg = (self.read_slots() if os.path.isdir(self.groove) else None) or slotreg.default_registry()
        action, new_reg = self._decide(pkg, cur, reg, slot)
        return {"action": action, "id": pkg.id, "version": pkg.version, "title": pkg.title,
                "slot": slotreg.slot_of(new_reg, pkg.id), "sha256": pkg.sha256, "warnings": pkg.warnings,
                "target": tgt.source}

    def _decide(self, pkg, cur, reg, slot):
        action = "install"
        if cur is not None:
            cman, cfiles = cur
            cv, nv = parse_version(cman["version"]), pkg.version_tuple()
            if cv == nv:
                if cfiles != pkg.files:
                    raise InstallError("VERSION_CONFLICT",
                                       f"{pkg.id} {pkg.version} is installed with different content; bump the version")
                action = "unchanged"
            elif nv < cv:
                raise InstallError("DOWNGRADE_REFUSED", f"installed {cman['version']} > package {pkg.version} "
                                                        "(no downgrade in V0)")
            else:
                action = "upgrade"
        new_reg = reg
        current = slotreg.slot_of(reg, pkg.id)
        if slot == "auto":
            if current is None:
                idx = slotreg.first_free(reg)
                if idx is None:
                    raise InstallError("SLOTS_FULL", "no free slot (A and B in use); install with slot none "
                                                     "or unassign one")
                new_reg = slotreg.with_assignment(reg, idx, pkg.id)
        elif slot is not None:
            if current is not None and current != slot:
                raise InstallError("SLOT_ALREADY_ASSIGNED", f"{pkg.id} is already in slot {current}; unassign first")
            new_reg = slotreg.with_assignment(reg, slot, pkg.id)
        return action, new_reg

    def install(self, data: bytes, slot="auto"):
        pkg = validate_package(data)

        def op():
            tgt = resolve_marker(self.groove)  # read under the lock; no override for mutations
            check_compat(pkg, tgt)
            cur = self.installed(pkg.id)
            reg = self.read_slots()
            had_slots = reg is not None
            base = reg if had_slots else slotreg.default_registry()
            action, new_reg = self._decide(pkg, cur, base, slot)
            change_slots = new_reg is not base or not had_slots
            res = {"action": action, "id": pkg.id, "version": pkg.version, "title": pkg.title,
                   "slot": slotreg.slot_of(new_reg, pkg.id), "sha256": pkg.sha256, "warnings": pkg.warnings,
                   "cleanup_pending": False}
            if action == "unchanged" and not change_slots:
                return res
            new_slots = slotreg.dumps(new_reg) if change_slots else None
            lvl = action != "unchanged"
            j = self._new_journal(
                "install", pkg.id, level=lvl, had_level=lvl and cur is not None, has_new_level=lvl,
                level_old=level_digest_of(cur[1]) if lvl and cur is not None else None,
                level_new=level_digest_of(pkg.files) if lvl else None,
                slots=change_slots, had_slots=change_slots and had_slots,
                slots_old=self._slots_hash(self.slots_path) if change_slots and had_slots else None,
                slots_new=_sha(new_slots) if change_slots else None, package_sha256=pkg.sha256)

            def stage(txd):
                if lvl:
                    nl = os.path.join(txd, "new-level")
                    self.fs.mkdir(nl)
                    for name, body in sorted(pkg.files.items()):
                        self.fs.write_file(os.path.join(nl, name), body)
                if change_slots:
                    self.fs.write_file(os.path.join(txd, "slots.json.new"), new_slots)
                    if had_slots:
                        self.fs.copy_file(self.slots_path, os.path.join(txd, "slots.json.old"))

            res["cleanup_pending"] = not self._run(j, stage)
            return res

        return self._locked(op)

    def uninstall(self, pid):
        """Remove levels/<id> and its slot. custom-saves/ is never touched (no purge in V0)."""
        d = self.level_dir(pid)

        def op():
            files = self._read_level_files(d)
            reg = self.read_slots()
            new_reg = slotreg.without(reg, pid) if reg is not None else None
            in_slot = new_reg is not None and new_reg is not reg
            if files is None and not in_slot:
                raise InstallError("NOT_INSTALLED", f"{pid} is not installed")
            new_slots = slotreg.dumps(new_reg) if in_slot else None
            j = self._new_journal(
                "uninstall", pid, level=files is not None, had_level=files is not None,
                level_old=level_digest_of(files) if files is not None else None,
                slots=in_slot, had_slots=in_slot,
                slots_old=self._slots_hash(self.slots_path) if in_slot else None,
                slots_new=_sha(new_slots) if in_slot else None)

            def stage(txd):
                if in_slot:
                    self.fs.write_file(os.path.join(txd, "slots.json.new"), new_slots)
                    self.fs.copy_file(self.slots_path, os.path.join(txd, "slots.json.old"))

            done = self._run(j, stage)
            return {"action": "uninstall", "id": pid, "removed_level": files is not None,
                    "unassigned": in_slot, "saves_kept": True, "cleanup_pending": not done}

        return self._locked(op)

    def _slots_tx(self, op_name, pid, mutate, need_marker=True, allow_corrupt_backup=False):
        def op():
            if need_marker:
                check_registry_capable(resolve_marker(self.groove))
            reg = self.read_slots()
            had = reg is not None
            base = reg if had else slotreg.default_registry()
            new = mutate(base)
            if new is base and had:
                return {"action": "unchanged", "slots": base}
            data = slotreg.dumps(new)
            j = self._new_journal(op_name, pid, slots=True, had_slots=had,
                                  slots_old=self._slots_hash(self.slots_path) if had else None,
                                  slots_new=_sha(data))

            def stage(txd):
                self.fs.write_file(os.path.join(txd, "slots.json.new"), data)
                if had:
                    self.fs.copy_file(self.slots_path, os.path.join(txd, "slots.json.old"))

            done = self._run(j, stage)
            return {"action": op_name, "slots": new, "cleanup_pending": not done}

        return self._locked(op)

    def assign(self, pid, idx):
        self.level_dir(pid)

        def mutate(reg):
            if self.installed(pid) is None:  # checked under the lock
                raise InstallError("NOT_INSTALLED", f"{pid} is not installed")
            return slotreg.with_assignment(reg, idx, pid)
        return self._slots_tx("assign", pid, mutate)

    def unassign(self, pid):
        self.level_dir(pid)

        def mutate(reg):
            if slotreg.slot_of(reg, pid) is None:
                raise InstallError("NOT_ASSIGNED", f"{pid} is not in any slot")
            return slotreg.without(reg, pid)
        return self._slots_tx("unassign", pid, mutate, need_marker=False)

    def init_slots(self, reset_corrupt=False):
        """Create slots.json (2 slots). reset_corrupt: back up an unreadable/legacy file, then start empty."""
        def op():
            try:
                reg = self.read_slots()
            except InstallError as e:
                if not reset_corrupt or e.code not in ("SLOTS_CORRUPT", "SLOTS_LEGACY"):
                    raise
                old = read_bounded(self.slots_path, SLOTS_HASH_CAP, "SLOTS_CORRUPT")
                new = slotreg.default_registry()
                data = slotreg.dumps(new)
                j = self._new_journal("reset-slots", None, slots=True, had_slots=True,
                                      slots_old=_sha(old), slots_new=_sha(data))

                def stage(txd):
                    self._chk(self.backups)
                    self.fs.mkdir(self.backups)
                    self.fs.write_file(os.path.join(self.backups, f"slots.json.{j['tx']}.bad"), old)
                    self.fs.write_file(os.path.join(txd, "slots.json.new"), data)
                    self.fs.write_file(os.path.join(txd, "slots.json.old"), old)

                done = self._run(j, stage)
                return {"action": "reset-slots", "slots": new, "cleanup_pending": not done}
            if reg is not None:
                return {"action": "unchanged", "slots": reg}
            data = slotreg.dumps(slotreg.default_registry())
            j = self._new_journal("init-slots", None, slots=True, slots_new=_sha(data))

            def stage(txd):
                self.fs.write_file(os.path.join(txd, "slots.json.new"), data)

            done = self._run(j, stage)
            return {"action": "init-slots", "slots": slotreg.default_registry(), "cleanup_pending": not done}

        return self._locked(op)

    def status(self):
        """Read-only report (no lock needed)."""
        out = {"slots": None, "levels": [], "problems": [], "engine": None}
        try:
            t = resolve_marker(self.groove)
            out["engine"] = {"version": t.engine_version, "build_id": t.build_id, "capabilities": list(t.capabilities)}
        except InstallError as e:
            out["problems"].append(str(e))
        try:
            out["slots"] = self.read_slots()
        except InstallError as e:
            out["problems"].append(str(e))
        if os.path.lexists(self.journal_path) or os.path.lexists(self.lock_path):
            out["problems"].append("interrupted operation, running installer or stale lock: run `recover` "
                                   "(the game must not launch custom levels until then)")
        for n in self.unknown_staging():
            if not (n.startswith("tx-") and os.path.lexists(self.journal_path)):
                out["problems"].append(f".installer/{n} is not referenced by a journal; retained for review")
        if os.path.isdir(self.levels):
            for n in sorted(os.listdir(self.levels)):
                try:
                    cur = self.installed(n)
                    out["levels"].append({"id": n, "version": cur[0]["version"], "title": cur[0]["title"],
                                          "has_save": os.path.isfile(os.path.join(self.saves, n + ".gsv"))})
                except InstallError as e:
                    out["problems"].append(str(e))
        if out["slots"]:
            for s in out["slots"]["slots"]:
                if s["id"] and not os.path.isdir(os.path.join(self.levels, s["id"])):
                    out["problems"].append(f"slot {s['index']} references missing level {s['id']}")
        return out


def jsonstrict_dumps(j) -> bytes:
    import json
    return json.dumps(j, sort_keys=True).encode("ascii")


def validate_journal(j):
    def bad(msg):
        raise InstallError("JOURNAL_CORRUPT", f"journal: {msg}")
    if not isinstance(j, dict) or set(j) != JOURNAL_KEYS:
        bad("unexpected keys")
    if j["format"] != JOURNAL_FORMAT:
        bad("unknown format")
    if not (isinstance(j["tx"], str) and TX_RE.fullmatch(j["tx"])):
        bad("invalid tx")
    if j["op"] not in OPS or j["state"] not in STATES:
        bad("invalid op/state")
    for k in ("level", "had_level", "has_new_level", "slots", "had_slots"):
        if type(j[k]) is not bool:
            bad(f"{k} must be boolean")
    for k in ("level_old", "level_new", "slots_old", "slots_new", "package_sha256"):
        if j[k] is not None and not (isinstance(j[k], str) and HEX64.fullmatch(j[k])):
            bad(f"{k} must be null or 64 hex chars")
    op = j["op"]
    if op in ("init-slots", "reset-slots"):
        if j["id"] is not None:
            bad("id must be null")
    elif not valid_id_syntax(j["id"]):
        bad("invalid id")
    if j["level"]:
        if op not in ("install", "uninstall"):
            bad("level change not allowed for this op")
        if not (j["had_level"] or j["has_new_level"]):
            bad("level change without content")
    elif j["had_level"] or j["has_new_level"]:
        bad("level flags without level change")
    if j["has_new_level"] and op != "install":
        bad("only install brings a new level")
    if (j["level_old"] is not None) != j["had_level"] or (j["level_new"] is not None) != j["has_new_level"]:
        bad("level hashes inconsistent with flags")
    if j["slots"]:
        if j["slots_new"] is None:
            bad("slots change without new hash")
        if (j["slots_old"] is not None) != j["had_slots"]:
            bad("slots hashes inconsistent with flags")
    elif j["had_slots"] or j["slots_old"] is not None or j["slots_new"] is not None:
        bad("slots fields without slots change")
    if op in ("assign", "unassign", "init-slots", "reset-slots") and not j["slots"]:
        bad("slot operation without slots change")
    if not (j["level"] or j["slots"]):
        bad("empty transaction")
    if j["package_sha256"] is not None and op != "install":
        bad("package hash only for install")
    return j
