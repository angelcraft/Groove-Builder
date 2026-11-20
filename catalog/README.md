# Groove Extended Catalog v1 — shared Android / Switch metadata

The single source of truth is [`groove_extended_catalog.v1.json`](groove_extended_catalog.v1.json).
It is public, **resource-free metadata** and is safe to import on Android or
check into Git. Do not add Nintendo sprites/audio/cues to this folder.

## First entry (verified scope, unverified launch)

- `virtual_index=80`, `id=groove.hoop_trundling_3`.
- World 1, column 9, row 0 is physically visible/selectable on the owner's
  Switch, but currently opens original Hoop 2.
- Original fallback `(kind=1,index=41)`, native StageFactory 68.
- Original Spanish text intent: `Pasar por el anillo 3`, target message
  label `I_RING_02`; the message overlay is **not installed** yet.
- The eventual custom 54-ring sequence, music, cue bank, harder icon and
  intro are **not packaged**: their asset references are null until verified.
- Practice skip and independent save data are **not implemented**.

## How Android and Switch consume it

**Android editor:** read the JSON directly. `slot` determines visual position;
`virtual_index` is a stable mod-owned ID; `resources`/`gameplay` are future
asset references. An asset field set to `null` means *missing*, not “please
invent one.” Once users import their own original RomFS, resolved paths may be
assigned under `romfs/` in local, private exports. Never bundle commercial
assets in the public repo. Audio and cues are represented separately for
playback/editing; the actual importer/preview is a separate implementation.

**Switch module:** the checked-in `source/groove_extended_catalog.hpp` is
generated from exactly this JSON. The current *inactive* title, prologue and
stage-origin policies consult it. The native game still receives original
`(1,41)` through its normal fallback. The virtual ID **must never** be passed
to its unmodified `(kind=1,index)` getter, because native index 80 runs into
the next catalog family's memory.

## Validate or regenerate the C++ source

From the repository root (Python 3, no external dependencies):

```sh
python3 tools/generate_extended_catalog.py --check
python3 -m unittest discover -s tools -p 'test_*.py' -q
```

When deliberately changing a validated JSON entry:

```sh
python3 tools/generate_extended_catalog.py --write
```

The validator rejects duplicate slots, progress namespaces and virtual IDs;
kind1/native-index overflow; path traversal; changed Hoop3 Stage68 identity;
unknown fields; and contradictory “installed/tested” claims. Future entries
can be added to JSON, but **will not automatically be installed on Switch**.
New icons, scenes, audio/cues, save hooks and resource bundles all need
independent runtime verification and an explicit build/test gate.
