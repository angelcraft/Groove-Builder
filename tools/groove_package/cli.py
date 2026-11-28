"""Command line interface (Windows/macOS/Linux). The GUI and Android apps call the same core functions.

  python tools/groove_install.py validate PKG.groove [--json]
  python tools/groove_install.py plan     PKG.groove [--sd E:\\] [--engine-version 0.6.0 --engine-contract 1
                                          --build-id <40 hex> --capability package.runtime/1 ...]   (read only)
  python tools/groove_install.py install  PKG.groove --sd E:\\ [--slot auto|0|1|none]   (needs sd:/groove/engine.json)
  python tools/groove_install.py uninstall ID --sd E:\\          (custom-saves/ is never touched)
  python tools/groove_install.py assign ID SLOT --sd E:\\   |  unassign ID --sd E:\\
  python tools/groove_install.py init-slots --sd E:\\ [--reset-corrupt]
  python tools/groove_install.py status --sd E:\\  |  recover --sd E:\\

Exit codes: 0 ok, 1 package rejected, 2 install refused/failed (SD unchanged or recoverable), 3 usage.
Run only with the SD card removed from the Switch (offline installation).
"""
import argparse
import json
import sys

from . import __version__, limits
from .engine import make_target
from .errors import InstallError, PackageError
from .installer import SD
from .validator import validate_package


def read_package(path):
    with open(path, "rb") as f:
        return f.read(limits.MAX_ARCHIVE_BYTES + 1)


def _out(obj, as_json):
    if as_json:
        print(json.dumps(obj, indent=2, ensure_ascii=False))
    else:
        for k, v in obj.items():
            print(f"{k}: {v}")


def parse_slot(s):
    if s == "auto":
        return "auto"
    if s == "none":
        return None
    if s in ("A", "a"):
        return 0
    if s in ("B", "b"):
        return 1
    if s.isdigit():
        return int(s)
    raise ValueError("--slot must be auto, none, A, B or a slot number")


def build_parser():
    p = argparse.ArgumentParser(prog="groove_install", description=f"Groove Engine package installer {__version__} (DRAFT)")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("package")

    def sd(sp, required=True):
        sp.add_argument("--sd", required=required, help="SD card root (the folder that contains groove/)")
    pl = sub.add_parser("plan", help="read-only dry run; explicit engine target allowed here only")
    pl.add_argument("package")
    sd(pl, required=False)
    pl.add_argument("--slot", default="auto")
    pl.add_argument("--engine-version")
    pl.add_argument("--engine-contract", type=int)
    pl.add_argument("--build-id")
    pl.add_argument("--capability", action="append", default=[])
    i = sub.add_parser("install")
    i.add_argument("package")
    sd(i)
    i.add_argument("--slot", default="auto", help="auto (first free), A/0, B/1 or none")
    u = sub.add_parser("uninstall")
    u.add_argument("id")
    sd(u)
    a = sub.add_parser("assign")
    a.add_argument("id")
    a.add_argument("slot")
    sd(a)
    ua = sub.add_parser("unassign")
    ua.add_argument("id")
    sd(ua)
    s = sub.add_parser("init-slots")
    sd(s)
    s.add_argument("--reset-corrupt", action="store_true")
    st = sub.add_parser("status")
    sd(st)
    r = sub.add_parser("recover")
    sd(r)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "validate":
            _out({"ok": True, **validate_package(read_package(args.package)).summary()}, args.json)
            return 0
        if args.cmd == "plan":
            target = None
            if args.engine_version or args.build_id or args.engine_contract is not None or args.capability:
                target = make_target(args.engine_version, args.engine_contract, args.build_id,
                                     args.capability, "explicit (plan only)")
            sd = SD(args.sd or ".")
            if target is None and not args.sd:
                print("plan needs --sd (to read engine.json) or an explicit engine target", file=sys.stderr)
                return 3
            res = sd.plan(read_package(args.package), target=target, slot=parse_slot(args.slot))
            _out({"ok": True, **res}, args.json)
            return 0
        sd = SD(args.sd)
        if args.cmd == "install":
            res = sd.install(read_package(args.package), slot=parse_slot(args.slot))
        elif args.cmd == "uninstall":
            res = sd.uninstall(args.id)
        elif args.cmd == "assign":
            res = sd.assign(args.id, parse_slot(args.slot))
        elif args.cmd == "unassign":
            res = sd.unassign(args.id)
        elif args.cmd == "init-slots":
            res = sd.init_slots(reset_corrupt=args.reset_corrupt)
        elif args.cmd == "status":
            res = sd.status()
        else:
            res = {"recover": sd.recover()}
        _out({"ok": True, **res}, args.json)
        return 0
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 3
    except PackageError as e:
        _out({"ok": False, "code": e.code, "error": str(e)}, args.json)
        return 1
    except InstallError as e:
        _out({"ok": False, "code": e.code, "error": str(e)}, args.json)
        return 2
    except OSError as e:
        _out({"ok": False, "code": "IO_ERROR", "error": str(e)}, args.json)
        return 2
