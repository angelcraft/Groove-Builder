import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "tools"))
FIX = os.path.join(HERE, "fixtures")


def corpus():
    with open(os.path.join(FIX, "corpus.json")) as f:
        return json.load(f)


def fixture(sub, name):
    with open(os.path.join(FIX, sub, name), "rb") as f:
        return f.read()


def valid(name):
    return fixture("valid", name)


A10, A11, B10 = "synthetic-a-1.0.0.groove", "synthetic-a-1.1.0.groove", "synthetic-b-1.0.0.groove"


def snapshot(root, exclude=()):
    """{relative path: sha256 | 'DIR'} for the whole tree (symlinks recorded as LINK)."""
    exclude = tuple(os.path.normpath(e) for e in exclude)
    out = {}
    for d, dirs, files in os.walk(root):
        rel_d = os.path.relpath(d, root)
        if any(rel_d == e or rel_d.startswith(e + os.sep) for e in exclude):
            dirs[:] = []
            continue
        for n in dirs:
            rel = os.path.normpath(os.path.join(rel_d, n))
            if not any(rel == e for e in exclude):
                out[rel] = "DIR"
        for n in files:
            p = os.path.join(d, n)
            rel = os.path.normpath(os.path.join(rel_d, n))
            if any(rel == e or rel.startswith(e + os.sep) for e in exclude):
                continue
            if os.path.islink(p):
                out[rel] = "LINK:" + os.readlink(p)
            else:
                with open(p, "rb") as f:
                    out[rel] = hashlib.sha256(f.read()).hexdigest()
    return out


BUILD_ID = "03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8"
CAPS = ["package.runtime/1", "registry.slots/1", "adapter.multi", "timeline.gtf", "timeline.gtl"]


def marker(**over):
    m = {"format": "groove-engine/1", "engine_version": "0.6.0", "engine_contract": 1,
         "build_id": BUILD_ID, "capabilities": list(CAPS)}
    m.update(over)
    return (json.dumps(m) + "\n").encode()


def make_sd(root, with_marker=True):
    """A synthetic SD with legacy Groove files, other mods and existing custom saves.
    All bytes are placeholders; nothing here is game data."""
    files = {
        "groove/multi.gtf": b"# legacy multi (synthetic placeholder)\n",
        "groove/stages/multi/multi.gtl": b"GTLM 1\n# legacy placeholder\n",
        "groove/custom-saves/org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338.gsv": b"GSV1" + bytes(156),
        "groove/custom-saves/org.groovebuilder.e291e52f-c146-41b0-823e-40b9fccb1338.gsv.bak": b"GSV1" + b"\1" * 156,
        "groove/custom-saves/org.other.keepme.gsv": b"GSV1" + b"\2" * 156,
        "atmosphere/contents/0100000000000000/exefs/placeholder.bin": b"not a real subsdk",
        "JKSV/Rhythm Paradise Groove/backup/placeholder.txt": b"user backup placeholder",
        "switch/other-homebrew/config.ini": b"[x]\n",
    }
    if with_marker:  # synthetic fixture root: stands in for the marker GE-151 will publish
        files["groove/engine.json"] = marker()
    for rel, b in files.items():
        p = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(b)
    return files



