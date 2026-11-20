# Groove Level Archive — research format v1

**Status: host-side research only. This does not install a level, change an
NSO, provide an ARM64 runtime or make Hoop Trundling 3 playable.**

## Objective

`*.groove` is one ZIP archive containing editable level data and only the
optional resources the author changed. The planned resident Switch mod will
discover compatible archives on the user's SD and register their distinct
game IDs in a **separately expanded** native catalog. Original games and their
saved data must remain unchanged.

The original Switch catalog currently contains 80 occupied kind=1 slots. A
mod entry with a stable ID (such as `groove.hoop_trundling_3`) is distinct from
its *base* kind=1 index 41. The `.groove` host format can describe that
distinction, but **cannot by itself make the original native getter safe for
index 80 or higher**. A runtime accessor/owner/allocator and save routing must
be audited and implemented separately. The proposed target of 256 catalog
entries is a design goal, not an installed binary patch.

## Contents

```text
HoopTrundling3.groove (ZIP)
  manifest.json      required, validated game ID, origin, menu slot, adapter
  timeline.json      required for patch/replace modes
  timeline.bin       generated cache of timeline.json in built archives
  sprites/           optional graphic resources (inherit if absent)
  audio/             optional music (inherit if absent)
  effects/           optional sound effects (inherit if absent)
  intro/             optional intro resources (inherit if absent)
```

`resources` keys set to JSON `null` inherit the corresponding original
resource. A non-null resource points **inside the same archive**. Imported
commercial assets should remain in local/private archives and never be
committed to public Git. A self-contained pack can include modified sprites,
music, introduction and effects without requiring separate SD folders.

## Virtual launch and practice

`manifest.launch.practice` is `"native"` or `"skip"`. Hoop3 declares
`"skip"`, paired with `"sequence": {"mode": "replace", "file":
"timeline.json"}`. The host validator rejects `skip` on an inherited
sequence. `skip` is a **request**, not a working Switch hook. A future runtime
must authorize it only for the correlated Hoop3 Stage68 launch, never as a
global Stage68 patch. It must leave native Hoop2 launches and practice intact.

The virtual catalog selects a stable Groove ID (Hoop3 = virtual index 80),
then borrows the compatible native mechanics of kind1/index41. The native
descriptor table has only 80 occupied entries: virtual index 80 must NEVER
be passed to the original kind1 getter. The original sequence is suppressed
only after the matching launch has been verified and custom commands are
ready. A missing/broken pack must leave the extra slot unavailable rather
than silently play Hoop2 as if it were Hoop3.

## Time and commands

`timeline.json` specifies `timebase: "beats"`, monotonically ordered event
objects and stable IDs. Beat positions are decimal **strings**, avoiding
ambiguous floating-point serialization. The example uses only two prototype
command names:

- `hoop.ring_spawn` with `variant: "normal"`
- `hoop.bubble_state` with an integer `mask` in `-1..15`

These are **abstract command contracts**, not verified native ARM64 function
signatures. In particular, the `mask` range is only a conservative preliminary
format bound; it does not certify the meaning of every BubbleState bit.

Modes: `inherit` uses the base sequence; `replace` describes an entire custom
sequence; `patch` is reserved for editing original events by stable IDs and
is explicitly rejected by this validator until that mapping exists. The
v1 host validator can check timeline syntax, but no *Switch-integrated*
scheduler or patch algorithm exists yet. The portable C++
`groove_replace_session.hpp` now models replacement ownership and dispatches
validated commands against injected callbacks using integer microbeats
(1 beat = 1,000,000 microbeats). It is tested on a host only, with **no actual
Switch native function bindings**. The example's four events are
**illustrative, not the 54-ring Hoop DX sequence**. No executable/game-specific
code is included in
the archive; game adapters must explicitly implement and validate each
allowed command.

`groove_pack.py --build` now adds a generated `timeline.bin` cache while
preserving editable `timeline.json` in the same ZIP. Binary layout: ASCII
`GRT1`, little-endian `uint32` event count, then 16 bytes per event:
`uint64 beat_micro`, `uint32 command_id`, `int32 argument`. Command IDs are
1 = `hoop.ring_spawn` (argument 0/normal), 2 = `hoop.bubble_state` (mask).
`groove_binary_timeline.hpp` decodes this format without allocations; both
the host validator and the eventual Switch loader must reject mismatches
between JSON and cache. No decompression, JSON parsing or SD access may happen
inside the gameplay tick callback. The session stays in error state on a
native call failure and must return safely to menu rather than replay original
Hoop2 cues halfway through the custom level.

## Host-side build and inspection

```sh
python3 tools/groove_pack.py examples/hoop_trundling_3
python3 tools/groove_pack.py examples/hoop_trundling_3 --build /tmp/HoopTrundling3.groove
python3 tools/groove_pack.py /tmp/HoopTrundling3.groove
python3 -m unittest tools/test_groove_pack.py -v
```

The builder writes a deterministic ZIP (stable order/timestamps), checks ZIP
CRC on inspection, limits expanded file sizes, forbids directory traversal,
symlinks, duplicate paths, unknown commands and missing resource references.
All v1 packs are forced to `state: "draft"`; the tool never claims Switch
playability or imports assets without the user's files.

## Next native milestones (not yet verified)

1. Audit allocation and every consumer of the native 80-record catalog, plus
   selection, launch and save paths. Find a reversible, safe enlarged table
   or a native-compatible descriptor sidecar and test actual ARM64 access.
2. Register a distinct extra game ID while preserving all 80 original slots;
   block a new slot when its `.groove` is missing or incompatible.
3. Verify SD file access **inside the game's process** and coexistence with
   existing subsdk1/subsdk5 and Orochi/Hoop DX. Never assume the main game
   automatically has the same FS permissions as homebrew.
4. Connect `hoop.ring_spawn` and `hoop.bubble_state` to verified native
   function signatures and the game beat clock. Define a strict event lifecycle
   (load, play, return, cleanup) and guard against stale state on scene change.
5. Recover the 34+20 tested Hoop DX sequence, translate it into v1 commands,
   and only then mark Hoop Trundling 3 as playable after a Switch hardware A/B.
6. Extend the adapter registry for DS/Wii/3DS imports, with matching asset
   converters and mechanical implementations for games absent on Switch.

No new Citron APK or Switch install artifact is generated by this host tool.
