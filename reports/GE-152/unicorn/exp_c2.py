"""Registry/partial-install cases -> enabled -> Unicorn F0 confirm on the slot coordinate; .gsv per-id independence."""
import sys, json, os, shutil, tempfile; from registry_model import *
sys.argv_img = sys.argv[1]
import exp_c_confirm as X
root = tempfile.mkdtemp(prefix="gsd_")
def pkg(i, **over):
    d = os.path.join(root, "levels", i); os.makedirs(d, exist_ok=True)
    m = {"format": "groove-package/1", "id": i, "version": "1.0.0", "title": "Demo " + i, "engine_min": "0.6.0", "adapter": "multi",
         "timeline": {"format": "gtf", "path": "timeline.gtf"}, "required_capabilities": ["timeline.gtf"], "results": "custom"}
    m.update(over.get("m", {}))
    if not over.get("no_manifest"):
        open(os.path.join(d, "manifest.json"), "w").write(over.get("raw") or json.dumps(m))
    if not over.get("no_timeline"): open(os.path.join(d, "timeline.gtf"), "wb").write(b"# synthetic\n" * over.get("tl_lines", 3))
cases = [("ok", {}), ("manifest missing", {"no_manifest": 1}), ("timeline missing", {"no_timeline": 1}),
         ("manifest JSON corrupt (truncated)", {"raw": '{"format": "groove-package/1", "id": '}),
         ("id != folder", {"m": {"id": "org.example.other"}}), ("engine_min 9.0.0", {"m": {"engine_min": "9.0.0"}}),
         ("timeline > 60 KiB", {"tl_lines": 6000}), ("adapter hoop + gtf", {"m": {"adapter": "hoop"}})]
out = {"registry": [], "gsv": {}}
for name, kw in cases:
    shutil.rmtree(os.path.join(root, "levels"), ignore_errors=True)
    pkg("org.example.a"); pkg("org.example.b", **kw)
    json.dump(["org.example.a", "org.example.b"], open(os.path.join(root, "slots.json"), "w"))
    reg = load_registry(root)
    ca = X.confirm((0, 9, 0), state=4 if reg[0]["enabled"] else 1)
    cb = X.confirm((0, 9, 1), state=4 if reg[1]["enabled"] else 1)
    out["registry"].append({"case_B": name, "A": reg[0].get("reason", "enabled"), "B": reg[1].get("reason", "enabled"),
        "unicorn_A": {k: ca[k] for k in ("launchA_reached", "SE_locked", "F1_slot", "blob_diff")},
        "unicorn_B": {k: cb[k] for k in ("launchA_reached", "SE_locked", "F1_slot", "blob_diff")}})
# duplicate id in slots.json
json.dump(["org.example.a", "org.example.a"], open(os.path.join(root, "slots.json"), "w"))
out["registry"].append({"case_B": "duplicate id", "A": load_registry(root)[0].get("reason", "enabled"), "B": load_registry(root)[1].get("reason")})
# .gsv: two ids sharing a host never touch each other
ra, _ = gsv_load(root, "org.example.a"); rb, _ = gsv_load(root, "org.example.b")
ra = gsv_write(root, finish(ra, True, 4, 85)); b_before = gsv_load(root, "org.example.b")
ra2 = gsv_write(root, finish(gsv_load(root, "org.example.a")[0], False, 0, 10))
p = os.path.join(root, "custom-saves", "org.example.a.gsv")
out["gsv"]["after_two_A_runs"] = gsv_load(root, "org.example.a")
out["gsv"]["B_untouched"] = b_before[1] == "default" and gsv_load(root, "org.example.b")[1] == "default"
raw = bytearray(open(p, "rb").read()); raw[120] ^= 1; open(p, "wb").write(raw)
out["gsv"]["corrupt_main -> source"] = gsv_load(root, "org.example.a")[1]
out["gsv"]["corrupt_main -> plays"] = gsv_load(root, "org.example.a")[0]["plays"]
os.replace(os.path.join(root, "custom-saves", "org.example.a.gsv.bak"), os.path.join(root, "custom-saves", "org.example.b.gsv"))
out["gsv"]["file of A renamed to B -> B source"] = gsv_load(root, "org.example.b")[1]
out["gsv"]["files"] = sorted(os.listdir(os.path.join(root, "custom-saves")))
shutil.rmtree(root)
json.dump(out, open(sys.argv[2], "w"), indent=1, default=str); print(json.dumps(out, indent=1, default=str))
