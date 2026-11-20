# Continue Hoop Trundling 3 — Switch menu, 20 November 2026

## Current session: data-driven Hoop3 replacement policy (host-tested)

- The user accepted a **virtual level overlay**: Hoop3 uses original Hoop2
  mechanics and visual assets, but `HoopTrundling3.groove` owns its event
  timeline and must not append to or play the Hoop2 timeline. Hoop3 must **skip
  practice**, while the original Hoop2 still retains practice and gameplay.
- `examples/hoop_trundling_3/manifest.json` now requests
  `launch.practice=skip` and `sequence.mode=replace`. `tools/groove_pack.py`
  validates the combination and compiles deterministic `timeline.bin` (`GRT1`
  with 16-byte microbeat command records) *inside* a generated `.groove` ZIP.
  Stale/mismatched cache is rejected against editable `timeline.json`.
- `source/groove_replace_session.hpp` is an allocation-free, host-tested
  event dispatcher. It demands an explicitly verified launch, suppresses
  original cues during replacement, requests practice skip only for an active
  session and locks out replay if callbacks/clock fail. Its `NativeAdapter`
  callbacks are **unbound** until ARM64 entry signatures are proven.
- `source/groove_binary_timeline.hpp` is a portable GRT1 decoder. The
  `.groove` parser, SD access inside the title, real beat-clock binding,
  original scheduler bypass, secure Stage68 ticket and save routing are STILL
  NOT implemented. No runtime patch or installable build was produced.
- `tests/test_groove_hoop3_route_integration.cpp` links the existing
  Stage68 one-shot policy to the replacement session: the correct origin
  starts custom events; borrowed original Hoop2, stale manager records and
  cancellation cannot start them. **Host simulation, not hardware proof.**
- Four example events remain a **draft test**, not the 54-ring level. Recover
  and validate the proven 34+20 Hoop DX arrangement before claiming playable.
- Run `python3 -m unittest discover -s tools -p 'test_*.py' -q` and
  `g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource
  tests/test_groove_replace_session.cpp -o /tmp/groove-session &&
  /tmp/groove-session` (similarly `test_groove_binary_timeline.cpp`).

**Next critical hardware milestone:** correlate virtual Hoop3 launch
with Stage68, safely bypass its preliminary practice route for this instance,
and connect native command callbacks under its real beat clock. Do NOT install
the old Stage68-wide skip patch, and do NOT let an invalid mod fall back to
playing native Hoop2 under the Hoop3 identity.

## NEW direction: `.groove` packages and real native catalog growth

- The owner wants a **persistent Groove Engine (IPS + resident subsdk)** and
  many independent native levels, not a single borrowed level, an icon test,
  or a global Stage68 practice skip. Original kind=1 entries 0..79 remain
  untouched; the aspirational initial catalog capacity is 256 total entries.
- Extra slots should be disabled if no matching `.groove` file is loaded.
  `.groove` is a ZIP with level manifest, editable native-command timeline,
  and optional sprites/music/sound/intro. Missing resources inherit the base
  game's original assets. A single file should be portable from Android
  Groove Editor to Switch without rebuilding the engine for every level.
- **Host-only format prototype**: `tools/groove_pack.py`,
  `examples/hoop_trundling_3/`, `docs/GROOVE_FORMAT.md` and its tests.
  Current example has four demonstrative RingSpawn/BubbleState commands,
  is explicitly `draft`, **not** 54 playable aros or a Switch IPS.
- Priority is now native descriptor allocation/lookup, separate identity,
  SD loader and *real command bridge*. Prior Stage68-wide/scoped practice
  experiments remain diagnostic only; do not present them as a solution.

## Verified on the user's physical Switch

- World 1's extra visual column is visible and new `(world 1, column 9,
  row 0)` can be selected. A starts original Hoop Trundling 2 because the
  extra cell borrows native `(kind=1,index=41)`.
- The same visual alone proves neither independent progress nor custom cues.
- Current public repository ships *research source*, not a playable IPS/NSO.
  No new APK is needed for the next intended hardware A/B.

## Pinned user-owned input (never commit)

- Original Switch `main` NSO SHA-256:
  `494c35e74dae893615980134f8be7673779f8d4b9eb9601e0f1b130d5ee1870e`.
- Optional private Ring `prologue.zip`, original `main.spr`, `icon.spr`, TEX,
  MSBT, other SD modules and existing playable 54-hoop experiments are not
  included in this Git repository.
- The user provided a new private Drive reference folder for game resources;
  use it if originals are missing, and never upload game assets to public Git.

## Correct Stage 68 native route

- **StageFactory 67 is NOT Hoop 2.** Earlier `0x428fc0` practice notes were
  misattributed; that stage constructor is `0x428d70`, worker `0x428ef0`.
- **StageFactory 68 is Hoop 2.** Allocated at `0x488dc4`, constructor call
  at `0x488de8 -> 0x42bea0`, shared return `0x48a568` returns `x22` object.
- Stage68's worker is `0x42c0c0`. Its object-local byte `Stage+0x2c94` is
  checked at `0x42c190..0x42c198`; one path leads toward `0x42ed80`
  (preliminary worker), the other to `0x42c2ac` (normal route).
- That byte is also read at `0x42de7c` and `0x42e4a4`; **do not zero it** as a
  practice-skip trick. Global predicate `0x139020` affects other game logic;
  **do not patch it globally** either.
- Original branch emulated in Unicorn: flag `0 -> 0x42c2ac`,
  `1 -> 0x42c19c`, `2 -> 0x42c2ac`. This does not validate a scoped skip.
- `source/hoop3_stage68_route_gate.hpp` is an **inactive** host policy:
  exact menu confirmation -> first StageFactory return -> matching Stage68
  object -> consume on conditional branch. Scene cancellation/return lifecycle
  and safe ARM64 hook installation still need verification.
- **20 November, Stage68-wide diagnostic built (not Hoop3-specific):**
  `tools/build_stage68_global_probe.py` checks the unmodified user-owned
  original and can explicitly emit a one-opcode IPS replacing the branch
  at `main+0x42c198` (`0x540008a1` B.NE) with `0x14000045` (B).
  Optional Unicorn evidence: original flags `0,1,2` go to normal,
  preliminary, normal; IPS flags all go to normal `0x42c2ac`.
  **Original Hoop2 would be affected** as well as borrowed Hoop3: this
  does NOT establish an independent skip, scene lifetime, 54 hoops or scores.
  No hardware A/B result yet. The diagnostic kit must be removed after a
  single supervised test; it is NOT a proposed permanent install.
- **20 November, saved native menu identity found:** after `0x1d2eac` launch
  forwarding, `0x1d2ed0 -> 0x4890` copies live Scene world/col/row to manager
  `+0xb98/+0xb9a/+0xb9c`, indexed by menu mode 0/1. `0x1d3430` sets current
  mode at manager `+0x2904`, and `0x1d344c -> 0x48b0` saves native index
  `+0xba0+2*mode`. The manager singleton pointer is `*(main+0xd96058)`.
  There are TWO additional direct coordinate writers: `0x1cf294` and
  `0x1d1614`; restore reader `0x1ce03c -> 0x4860`.
  `tools/audit_hoop3_native_selection_record.py` checks opcodes and exact
  BL callers and executes real ARM64 setter/getter for four cases in Unicorn.
  `source/hoop3_stage68_route_gate.hpp` now requires a matching snapshot
  (mode 0/1, world1/col9/row0, native index41) both before tracking the object
  **and again at the original Stage68 branch**. Any intervening manager
  overwrite rejects and consumes the ticket.
  This *narrows* the async ambiguity, but the manager record may be overwritten
  while loading/returning; no scoped IPS should be installed without live proof.
- **20 November, scoped IPS A/B candidate:**
  `tools/build_stage68_scoped_probe.py` validates the user's SHA-pinned main
  and emits two IPS records only with explicit opt-in: replace the original
  `main+0x42c198` branch with a jump to a 140-byte ARM64 stub placed at
  `main+0xa66bf0`, inside the original text-page alignment gap (next rodata
  starts `0xa67000`). The stub checks live native manager mode 0/1,
  world1/col9/row0 and index41; on mismatch it reproduces the exact original
  branch using Stage68's object-local flag, without modifying that flag.
  It preserves original x9/x16/x17 and SP.
  **33 Unicorn cases PASS**: both Hoop3 modes, Hoop2 original, worlds0/2,
  other row/index, bad modes, null singleton, and flag values 0/1/2.
  Atmosphère's `ldr_process_creation.cpp` loads segments, clears alignment
  padding, then applies IPS and sets execute permission for rounded `.text`:
  https://github.com/Atmosphere-NX/Atmosphere/blob/master/stratosphere/loader/source/ldr_process_creation.cpp
  No hardware result yet. This is a high-risk prototype; disable the old
  `GrooveStage68GlobalProbe` before trying it (same branch).

## Native catalog ownership (newly proven)

- Kind=1 native descriptor table starts `0xd19108`, 48 bytes each.
  Kind=2 begins `0xd1a008`, **exactly 80** kind=1 descriptor entries.
- 80/80 records have unique original prologue resource paths.
- Index `40` = Ring 1, `41` = Ring 2, **`75..79` = Remix 16..20**, not free.
- Do not use index `80+` with the unmodified kind=1 accessor, or replace an
  occupied Remix descriptor. A separate virtual mod identity and catalog
  routing are needed for independent Hoop 3, progress and later new games.
- Optional Unicorn runs the *original* kind1 accessor for 40/41/75/79/80;
  index 80 resolves to the beginning of the kind2 descriptor array, not to
  newly allocated kind1 storage. This is **not** a playable extra entry.

## Groove Extended Catalog v1 (new code, NOT installed)

- `catalog/groove_extended_catalog.v1.json` is the canonical shared metadata
  for Android editor and Switch; entry `groove.hoop_trundling_3` gets **virtual
  index 80**, outside the original 0..79 catalog.
- It explicitly pins world1/col9/row0, original fallback kind1/index41 and
  StageFactory68. Custom title `I_RING_02`, 54-ring target and progress key
  are declarations only; external sprites, music, cues and scene/sequence
  references are null and **not packaged**.
- `tools/generate_extended_catalog.py` validates this manifest and builds
  `source/groove_extended_catalog.hpp` (checked in). It rejects duplicates,
  native index80, invalid paths, mismatched Hoop2 StageFactory and unverified
  installation claims. New slots are supported by the format but must be
  separately verified before enabling on Switch.
- The existing title/intro/Stage68 origin policies now read the generated
  Hoop3 cell/identity; no runtime hooks, playback, save or install is added.

## Other features still pending

- Actual separate Spanish name + instructions (`I_RING_02`), intro/splash 3,
  hard-style new icon, skip practice, 54-ring sequence and separate records.
- Source-only intro-title dispatcher is tested but not installed.
- Runtime code alias/IPS mechanism, instruction cache and coexistence with
  Orochi/Hoop DX/subsdk mods still need physical proof.

## Quick verification

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -q
python3 tools/generate_extended_catalog.py --check
python3 tools/build_stage68_global_probe.py /private/main
python3 tools/audit_hoop3_native_selection_record.py /private/main --unicorn
python3 tools/build_stage68_scoped_probe.py /private/main
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_stage68_route_gate.cpp -o /tmp/hoop3-stage68
/tmp/hoop3-stage68

# Only with your private pinned main and lz4 installed:
python tools/audit_hoop3_catalog_ownership.py /private/main --unicorn
python tools/audit_hoop3_stage68_route.py /private/main --unicorn
```

**Next:** perform one reversible physical Switch A/B of the *scoped* preview,
checking original Hoop2, new (1,9,0), a second world and safe return to menu.
If hardware shows stale coordinates, trace transition/cancellation callbacks.
Do not mistake the earlier Stage68-global diagnostic for Hoop3-only behavior.
No new APK, no game assets in Git, no silently altered original Hoop2.
