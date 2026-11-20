# Continue Hoop Trundling 3 — Switch menu, 20 November 2026

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

## Other features still pending

- Actual separate Spanish name + instructions (`I_RING_02`), intro/splash 3,
  hard-style new icon, skip practice, 54-ring sequence and separate records.
- Source-only intro-title dispatcher is tested but not installed.
- Runtime code alias/IPS mechanism, instruction cache and coexistence with
  Orochi/Hoop DX/subsdk mods still need physical proof.

## Quick verification

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -q
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_stage68_route_gate.cpp -o /tmp/hoop3-stage68
/tmp/hoop3-stage68

# Only with your private pinned main and lz4 installed:
python tools/audit_hoop3_catalog_ownership.py /private/main --unicorn
python tools/audit_hoop3_stage68_route.py /private/main --unicorn
```

**Next:** determine the actual asynchronous transition and cancellation
callbacks from menu confirmation `0x1d2eac` into the StageFactory return.
Use a verified, strictly scoped virtual identity; don't ship a practice IPS
that silently modifies original Hoop 2. Produce a reversible Switch-only A/B
when the route and safe patch locations are established. No new APK, no game
assets in Git, no patch installation without an explicitly testable artifact.
