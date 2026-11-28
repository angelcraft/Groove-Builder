#!/usr/bin/env python3
"""GE-155 validation on a SIMULATED Switch SD (no hardware, no game files). DRAFT.

Builds a folder laid out like a Switch microSD (atmosphere/contents/<title>/romfs+exefs placeholders,
JKSV backups, other homebrew, groove/custom-saves with fake saves, a SYNTHETIC groove/engine.json that
stands in for the marker GE-151 will publish) and runs the installer against the two synthetic test
levels: install/upgrade/assign/unassign/uninstall, assign re-validation, crash at every step + recover,
I/O error at every step, lock contention with another process, release/reacquire race, marker withdrawn.
Every scenario checks that custom-saves/ and all foreign files stay byte-identical.

  py -3 tools\\groove_sd_sim.py                         # temp folder, deleted afterwards
  py -3 tools\\groove_sd_sim.py --sd D:\\sim-sd --keep   # an EMPTY folder (e.g. on a FAT32/exFAT USB stick)
  py -3 tools\\groove_sd_sim.py --cli dist\\GrooveInstall.exe   # also drive the frozen Windows CLI
  py -3 tools\\groove_sd_sim.py --make-only D:\\sim-sd  # only create the fake SD for manual GUI tests

--sd must be empty or absent: the tool refuses to run on a folder with content, so it can never touch a
real SD card. Exit code 0 = all scenarios passed. --report writes a JSON report.
"""
import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from groove_package import __version__  # noqa: E402
from groove_package.errors import InstallError  # noqa: E402
from groove_package.fsops import FS, SimulatedCrash  # noqa: E402
from groove_package.installer import SD  # noqa: E402

FIXTURES = os.path.join(HERE, "..", "tests", "package", "fixtures", "valid")
A10, A11, B10 = "synthetic-a-1.0.0.groove", "synthetic-a-1.1.0.groove", "synthetic-b-1.0.0.groove"
ID_A = "org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338"
ID_B = "org.groovebuilder.2247d7d8-7f17-4a5f-8a47-be342e2f3844"
TITLE = "0100D9F01D474000"
BUILD_ID = "03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8"
MARKER = {"format": "groove-engine/1", "engine_version": "0.6.0", "engine_contract": 1, "build_id": BUILD_ID,
          "capabilities": ["package.runtime/1", "registry.slots/1", "adapter.multi", "timeline.gtf", "timeline.gtl"]}
INSTALLER_OWNED = ("groove/levels", "groove/slots.json", "groove/.installer", "groove/backups")

# Placeholders only: every byte below is invented. Nothing here is game data.
PLACEHOLDERS = {
    f"atmosphere/contents/{TITLE}/exefs/PLACEHOLDER_NOT_A_SUBSDK.txt": b"simulated exefs folder\n",
    f"atmosphere/contents/{TITLE}/romfs/PLACEHOLDER_NOT_GAME_DATA.txt": b"simulated romfs folder\n",
    "atmosphere/config/system_settings.ini": b"; simulated\n",
    "JKSV/Rhythm Paradise Groove/2026-11-28 backup/PLACEHOLDER.txt": b"simulated JKSV backup\n",
    "switch/other-homebrew/config.ini": b"[simulated]\n",
    "groove/multi.gtf": b"# legacy multi (synthetic placeholder)\n",
    "groove/custom-saves/" + ID_A + ".gsv": b"GSV1" + bytes(156),
    "groove/custom-saves/" + ID_A + ".gsv.bak": b"GSV1" + b"\1" * 156,
    "groove/custom-saves/" + ID_B + ".gsv": b"GSV1" + b"\3" * 156,
    "groove/custom-saves/org.other.keepme.gsv": b"GSV1" + b"\2" * 156,
}


def pkg(name):
    with open(os.path.join(FIXTURES, name), "rb") as f:
        return f.read()


def write(root, rel, data):
    p = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data)


def make_sd(root, marker=True):
    for rel, data in PLACEHOLDERS.items():
        write(root, rel, data)
    if marker:
        write(root, "groove/engine.json", (json.dumps(MARKER, indent=2) + "\n").encode())


def snapshot(root, only=None, skip=()):
    out = {}
    base = os.path.join(root, only) if only else root
    for d, dirs, files in os.walk(base):
        dirs.sort()
        for n in sorted(files):
            p = os.path.join(d, n)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            if any(rel == s or rel.startswith(s + "/") for s in skip):
                continue
            with open(p, "rb") as f:
                out[rel] = hashlib.sha256(f.read()).hexdigest()
    return out


def foreign(root):
    """Everything the installer must never change (custom-saves included)."""
    return snapshot(root, skip=INSTALLER_OWNED)


def level_state(root):
    """Logical installer state, ignoring backups/ (recovery evidence) and empty infra dirs."""
    s = snapshot(root, skip=("groove/backups",))
    inst = os.path.join(root, "groove", ".installer")
    leftovers = sorted(os.listdir(inst)) if os.path.isdir(inst) else []
    return s, leftovers


class Runner:
    def __init__(self, base, cli=None):
        self.base = base
        self.cli = cli
        self.results = []
        self.n = 0

    def fresh(self, name, marker=True):
        self.n += 1
        root = os.path.join(self.base, f"{self.n:03d}-{name}")
        os.makedirs(root)
        make_sd(root, marker)
        return root

    def check(self, name, fn):
        t = time.time()
        try:
            detail = fn() or ""
            self.results.append({"scenario": name, "ok": True, "detail": detail, "seconds": round(time.time() - t, 2)})
            print(f"PASS  {name}  {detail}")
        except Exception as e:  # report and continue with the next scenario
            self.results.append({"scenario": name, "ok": False, "detail": f"{type(e).__name__}: {e}",
                                 "trace": traceback.format_exc()})
            print(f"FAIL  {name}  {type(e).__name__}: {e}")

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def expect_error(code, fn):
        try:
            fn()
        except InstallError as e:
            if e.code != code:
                raise AssertionError(f"expected {code}, got {e.code}: {e}")
            return
        raise AssertionError(f"expected {code}, operation succeeded")

    @staticmethod
    def eq(a, b, what):
        if a != b:
            raise AssertionError(f"{what}: {a!r} != {b!r}")

    # ---------------------------------------------------------------- scenarios
    def lifecycle(self):
        root = self.fresh("lifecycle")
        sd = SD(root)
        f0 = foreign(root)
        self.eq(sd.install(pkg(A10))["slot"], 0, "A goes to slot A")
        self.eq(sd.install(pkg(B10))["slot"], 1, "B goes to slot B")
        st = sd.status()
        self.eq(st["problems"], [], "status problems")
        self.eq([s["id"] for s in st["slots"]["slots"]], [ID_A, ID_B], "slots")
        r = sd.install(pkg(A11))
        self.eq((r["action"], r["slot"]), ("upgrade", 0), "upgrade keeps slot")
        self.expect_error("DOWNGRADE_REFUSED", lambda: sd.install(pkg(A10)))
        self.eq(sd.install(pkg(A11))["action"], "unchanged", "same package again")
        sd.unassign(ID_B)
        sd.assign(ID_B, 1)
        r = sd.uninstall(ID_B)
        self.eq((r["removed_level"], r["saves_kept"]), (True, True), "uninstall")
        self.eq(foreign(root), f0, "custom-saves and foreign files")
        self.eq(level_state(root)[1], [], ".installer leftovers")
        return "install A/B, upgrade, downgrade refused, assign/unassign, uninstall (saves kept)"

    def assign_revalidation(self):
        root = self.fresh("assign-revalidation")
        sd = SD(root)
        sd.install(pkg(B10), slot=None)
        tl = os.path.join(root, "groove", "levels", ID_B, "timeline.gtl")
        with open(tl, "rb") as f:
            good = f.read()
        with open(tl, "wb") as f:
            f.write(b"\xef\xbb\xbf" + good)
        before = snapshot(root)
        self.expect_error("INSTALLED_INVALID", lambda: sd.assign(ID_B, 1))
        self.eq(snapshot(root), before, "refused assign changed the SD")
        with open(tl, "wb") as f:
            f.write(good)
        caps = [c for c in MARKER["capabilities"] if c != "timeline.gtl"]
        write(root, "groove/engine.json", json.dumps(dict(MARKER, capabilities=caps)).encode())
        self.expect_error("ENGINE_MISSING_CAPABILITY", lambda: sd.assign(ID_B, 1))
        write(root, "groove/engine.json", json.dumps(dict(MARKER, engine_contract=2)).encode())
        self.expect_error("ENGINE_CONTRACT_UNSUPPORTED", lambda: sd.assign(ID_B, 1))
        write(root, "groove/engine.json", json.dumps(dict(MARKER, capabilities=MARKER["capabilities"]
                                                           + ["future.feature/9"])).encode())
        sd.assign(ID_B, 1)  # unknown well-formed capability ignored
        return "edited level, missing timeline.gtl, contract 2 refused; future capability accepted"

    def _setup_for_crash(self, root):
        SD(root).install(pkg(A10))

    def _op(self, sd):
        return sd.install(pkg(A11))

    def crash_every_step(self):
        probe_root = self.fresh("crash-probe")
        self._setup_for_crash(probe_root)
        pre = level_state(probe_root)[0]
        fs = FS()
        self._op(SD(probe_root, fs))
        post = level_state(probe_root)[0]
        f0 = foreign(probe_root)
        outcomes = {"pre": 0, "post": 0}
        for k in range(1, fs.steps + 1):
            root = self.fresh(f"crash-{k}")
            self._setup_for_crash(root)
            sd = SD(root)
            try:
                self._op(SD(root, FS(crash_at=k)))
                raise AssertionError(f"no crash at step {k}")
            except SimulatedCrash:
                pass
            if not (os.path.exists(sd.lock_path) or os.path.exists(sd.journal_path)):
                raise AssertionError(f"step {k}: runtime gate open after crash")
            sd.recover()
            got, left = level_state(root)
            self.eq(left, [], f"step {k}: .installer leftovers")
            if got not in (pre, post):
                raise AssertionError(f"step {k}: SD is neither before nor after state")
            outcomes["pre" if got == pre else "post"] += 1
            self.eq(foreign(root), f0, f"step {k}: custom-saves/foreign")
            shutil.rmtree(root)
        return f"{fs.steps} crash points: {outcomes['pre']} rolled back, {outcomes['post']} rolled forward"

    def io_error_every_step(self):
        probe_root = self.fresh("ioerr-probe")
        self._setup_for_crash(probe_root)
        pre = level_state(probe_root)[0]
        fs = FS()
        self._op(SD(probe_root, fs))
        post = level_state(probe_root)[0]
        for k in range(1, fs.steps + 1):
            root = self.fresh(f"ioerr-{k}")
            self._setup_for_crash(root)
            sd = SD(root)
            failed = False
            try:
                self._op(SD(root, FS(fail_at=k)))
            except OSError:
                failed = True
            if os.path.exists(sd.journal_path):
                self.eq(sd.recover(), "rolled-forward", f"step {k}: cleanup")
            got = level_state(root)[0]
            self.eq(got, pre if failed else post, f"step {k}: state")
            if os.path.exists(sd.lock_path):
                raise AssertionError(f"step {k}: lock file left after a clean outcome")
            shutil.rmtree(root)
        return f"{fs.steps} I/O error points: reported errors left the SD unchanged"

    def lock_contention(self):
        root = self.fresh("lock-contention")
        sd = SD(root)
        sd.install(pkg(A10))
        holder = subprocess.Popen(
            [sys.executable, "-c", "import sys; sys.path.insert(0, sys.argv[1]);"
             "from groove_package.lock import InstallerLock; lk = InstallerLock(sys.argv[2]).acquire();"
             "print('locked', flush=True); sys.stdin.read(); lk.release()", HERE, sd.lock_path],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            if holder.stdout.readline().strip() != "locked":
                raise AssertionError("holder did not lock")
            before = snapshot(root)
            for name, call in (("recover", sd.recover), ("install", lambda: sd.install(pkg(A11))),
                               ("uninstall", lambda: sd.uninstall(ID_A)), ("assign", lambda: sd.assign(ID_A, 1)),
                               ("unassign", lambda: sd.unassign(ID_A))):
                self.expect_error("LOCKED", call)
            if self.cli:
                r = self.run_cli("install", os.path.join(FIXTURES, A11), "--sd", root)
                self.eq((r["rc"], r["out"].get("code")), (2, "LOCKED"), "frozen CLI while locked")
            self.eq(snapshot(root), before, "SD changed while locked")
            if not os.path.exists(sd.lock_path):
                raise AssertionError("live lock file was unlinked")
        finally:
            holder.stdin.close()
            holder.wait(30)
        self.eq(sd.install(pkg(A11))["action"], "upgrade", "after release")
        if os.path.exists(sd.lock_path):
            raise AssertionError("lock file left after success")
        return "5 operations refused with LOCKED while another process held the lock; SD unchanged"

    def lock_race(self):
        root = self.fresh("lock-race")
        lock = os.path.join(root, "lock")
        owner = os.path.join(root, "owner")
        worker = ("import os, sys, time; sys.path.insert(0, sys.argv[1])\n"
                  "from groove_package.lock import InstallerLock\nfrom groove_package.errors import InstallError\n"
                  "got = 0; end = time.time() + 60\n"
                  "while got < 100 and time.time() < end:\n"
                  "    lk = InstallerLock(sys.argv[2])\n"
                  "    try:\n        lk.acquire()\n    except InstallError as e:\n"
                  "        assert e.code == 'LOCKED', e\n        continue\n"
                  "    try:\n        os.close(os.open(sys.argv[3], os.O_CREAT | os.O_EXCL | os.O_WRONLY)); os.remove(sys.argv[3])\n"
                  "    finally:\n        lk.release()\n    got += 1\nprint(got)\n")
        procs = [subprocess.Popen([sys.executable, "-c", worker, HERE, lock, owner], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True) for _ in range(3)]
        for p in procs:
            out, err = p.communicate(timeout=120)
            if p.returncode != 0 or out.strip() != "100":
                raise AssertionError(f"worker failed: rc={p.returncode} out={out!r} err={err[-500:]!r}")
        if os.path.exists(lock) or os.path.exists(owner):
            raise AssertionError("lock/owner file left behind")
        return "3 processes x 100 acquire/release: mutual exclusion held, no foreign unlink"

    def marker_withdrawn(self):
        root = self.fresh("marker-withdrawn")
        sd = SD(root)
        sd.install(pkg(A10))
        probe = FS()
        SD(root, probe).install(pkg(A11))
        sd.uninstall(ID_A)
        sd.install(pkg(A10))
        k = next(i for i, w in enumerate(probe.log, 1) if w.startswith("replace") and "levels" in w.split("->")[1])
        try:
            SD(root, FS(crash_at=k + 1)).install(pkg(A11))
        except SimulatedCrash:
            pass
        os.remove(os.path.join(root, "groove", "engine.json"))
        self.eq(sd.recover(), "rolled-back", "recover without marker")
        backups = os.path.join(root, "groove", "backups")
        if not any(n.startswith("recovery-") for n in os.listdir(backups)):
            raise AssertionError("recovery evidence not kept in groove/backups/recovery-<tx>/")
        self.expect_error("ENGINE_UNKNOWN", lambda: sd.assign(ID_A, 1))
        self.expect_error("ENGINE_UNKNOWN", lambda: sd.install(pkg(B10)))
        sd.unassign(ID_A)
        sd.uninstall(ID_A)
        return "recover/unassign/uninstall work without engine.json; install/assign refused; evidence kept"

    # ---------------------------------------------------------------- frozen CLI
    def run_cli(self, *args):
        p = subprocess.run([self.cli, "--json", *args], capture_output=True, text=True, timeout=120)
        try:
            out = json.loads(p.stdout) if p.stdout.strip() else {}
        except ValueError:
            out = {"raw": p.stdout}
        return {"rc": p.returncode, "out": out, "err": p.stderr}

    def frozen_cli(self):
        root = self.fresh("frozen-cli")
        f0 = foreign(root)
        steps = [(("validate", os.path.join(FIXTURES, A10)), 0),
                 (("install", os.path.join(FIXTURES, A10), "--sd", root), 0),
                 (("install", os.path.join(FIXTURES, B10), "--sd", root, "--slot", "none"), 0),
                 (("assign", ID_B, "B", "--sd", root), 0),
                 (("install", os.path.join(FIXTURES, A11), "--sd", root), 0),
                 (("install", os.path.join(FIXTURES, A10), "--sd", root), 2),
                 (("unassign", ID_B, "--sd", root), 0),
                 (("uninstall", ID_B, "--sd", root), 0),
                 (("recover", "--sd", root), 0),
                 (("status", "--sd", root), 0)]
        for args, rc in steps:
            r = self.run_cli(*args)
            if r["rc"] != rc:
                raise AssertionError(f"{args[0]}: exit {r['rc']} (expected {rc}) {r['out']} {r['err'][-300:]}")
        st = self.run_cli("status", "--sd", root)["out"]
        self.eq(st.get("problems"), [], "status problems")
        self.eq(foreign(root), f0, "custom-saves and foreign files")
        return f"{len(steps)} CLI calls with expected exit codes"

    def run(self):
        self.check("lifecycle", self.lifecycle)
        self.check("assign-revalidation", self.assign_revalidation)
        self.check("crash-every-step+recover", self.crash_every_step)
        self.check("io-error-every-step", self.io_error_every_step)
        self.check("lock-contention", self.lock_contention)
        self.check("lock-release-reacquire-race", self.lock_race)
        self.check("marker-withdrawn+recovery-evidence", self.marker_withdrawn)
        if self.cli:
            self.check("frozen-cli", self.frozen_cli)
        return all(r["ok"] for r in self.results)


def main(argv=None):
    ap = argparse.ArgumentParser(description="GE-155 simulated-SD validation (no hardware)")
    ap.add_argument("--sd", help="EMPTY folder to use (e.g. on a FAT32/exFAT USB stick); default: temp folder")
    ap.add_argument("--keep", action="store_true", help="keep the simulated SD folders afterwards")
    ap.add_argument("--cli", help="path to the frozen GrooveInstall.exe (or any CLI command) to test too")
    ap.add_argument("--make-only", metavar="DIR", help="only create one simulated SD in DIR (empty) for the GUI")
    ap.add_argument("--report", help="write a JSON report here")
    a = ap.parse_args(argv)

    def empty_or_absent(d):
        if os.path.exists(d) and (not os.path.isdir(d) or os.listdir(d)):
            print(f"Refusing: {d} exists and is not empty. Use an EMPTY folder, never a real SD card.",
                  file=sys.stderr)
            sys.exit(3)
        os.makedirs(d, exist_ok=True)

    if a.make_only:
        empty_or_absent(a.make_only)
        make_sd(a.make_only)
        print(f"Simulated SD created at {a.make_only}")
        print(f"Synthetic test packages: {os.path.abspath(FIXTURES)}")
        return 0
    if a.sd:
        empty_or_absent(a.sd)
        base = a.sd
    else:
        base = tempfile.mkdtemp(prefix="groove-sim-sd-")
    print(f"GE-155 simulated SD validation - installer {__version__}, Python {platform.python_version()}, "
          f"{platform.platform()}\nfolder: {base}")
    r = Runner(base, cli=a.cli)
    ok = r.run()
    report = {"ok": ok, "installer": __version__, "python": platform.python_version(),
              "platform": platform.platform(), "folder": base, "cli": a.cli, "scenarios": r.results}
    if a.report:
        with open(a.report, "w") as f:
            json.dump(report, f, indent=2)
            f.write("\n")
    if not a.keep:
        shutil.rmtree(base, ignore_errors=True)
    print(f"{'ALL PASSED' if ok else 'FAILURES'}: {sum(x['ok'] for x in r.results)}/{len(r.results)} scenarios")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
