"""Command line interface (Windows/macOS/Linux; Android apps call the same functions).

  python tools/groove_install.py validate PKG.groove [--json]
  python tools/groove_install.py install  PKG.groove --sd E:\\ [--slot auto|0|1|none] [--allow-downgrade]
                                          [--engine-version 0.6.0 --engine-contract 1 --build-id 03FF4A3B]
  python tools/groove_install.py uninstall ID --sd E:\\ [--purge-saves]
  python tools/groove_install.py assign ID SLOT --sd E:\\   |  unassign ID --sd E:\\
  python tools/groove_install.py init-slots --sd E:\\ [--reset-corrupt]
  python tools/groove_install.py status --sd E:\\  |  recover --sd E:\\

Exit codes: 0 ok, 1 package rejected, 2 install refused/failed (SD unchanged), 3 usage.
"""
import argparse
import json
import sys

from . import __version__
from .errors import InstallError, PackageError
from .installer import SD
from .validator import validate_package


def _read(path):
    from . import limits
    with open(path, "rb") as f:
        data = f.read(limits.MAX_ARCHIVE_BYTES + 1)
    return data


def _out(obj, as_json):
    if as_json:
        print(json.dumps(obj, indent=2, ensure_ascii=False))
    else:
        for k, v in obj.items():
            print(f"{k}: {v}")


def build_parser():
    p = argparse.ArgumentParser(prog="groove_install", description=f"Groove Engine package installer {__version__} (DRAFT)")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate"); v.add_argument("package")

    def sd(sp):
        sp.add_argument("--sd", required=True, help="SD card root (the folder that contains groove/)")
    i = sub.add_parser("install"); i.add_argument("package"); sd(i)
    i.add_argument("--slot", default="auto", help="auto (first free), 0, 1 or none")
    i.add_argument("--allow-downgrade", action="store_true")
    i.add_argument("--engine-version"); i.add_argument("--engine-contract", type=int); i.add_argument("--build-id")
    u = sub.add_parser("uninstall"); u.add_argument("id"); sd(u)
    u.add_argument("--purge-saves", action="store_true", help="also delete custom-saves/<id>.gsv (a backup is kept)")
    a = sub.add_parser("assign"); a.add_argument("id"); a.add_argument("slot", type=int); sd(a)
    ua = sub.add_parser("unassign"); ua.add_argument("id"); sd(ua)
    s = sub.add_parser("init-slots"); sd(s); s.add_argument("--reset-corrupt", action="store_true")
    st = sub.add_parser("status"); sd(st)
    r = sub.add_parser("recover"); sd(r)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "validate":
            _out({"ok": True, **validate_package(_read(args.package)).summary()}, args.json)
            return 0
        sd = SD(args.sd)
        if args.cmd == "install":
            slot = {"auto": "auto", "none": None}.get(args.slot)
            if args.slot not in ("auto", "none"):
                if not args.slot.isdigit():
                    print("--slot must be auto, none or a slot number", file=sys.stderr)
                    return 3
                slot = int(args.slot)
            res = sd.install(_read(args.package), slot=slot, allow_downgrade=args.allow_downgrade,
                             engine_version=args.engine_version, engine_contract=args.engine_contract,
                             build_id=args.build_id)
        elif args.cmd == "uninstall":
            res = sd.uninstall(args.id, purge_saves=args.purge_saves)
        elif args.cmd == "assign":
            res = {"slots": sd.assign(args.id, args.slot)["slots"]}
        elif args.cmd == "unassign":
            res = {"slots": sd.unassign(args.id)["slots"]}
        elif args.cmd == "init-slots":
            res = {"slots": sd.init_slots(reset_corrupt=args.reset_corrupt)["slots"]}
        elif args.cmd == "status":
            res = sd.status()
        else:
            res = {"recover": sd.recover()}
        _out({"ok": True, **res}, args.json)
        return 0
    except PackageError as e:
        _out({"ok": False, "code": e.code, "error": str(e)}, args.json)
        return 1
    except InstallError as e:
        _out({"ok": False, "code": e.code, "error": str(e)}, args.json)
        return 2
    except OSError as e:
        _out({"ok": False, "code": "IO_ERROR", "error": str(e)}, args.json)
        return 2
