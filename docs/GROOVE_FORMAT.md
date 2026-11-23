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
ambiguous floating-point serialization. Hoop3 currently supports these
explicitly validated commands:

- `hoop.ring_spawn` with `variant: "normal"`
- `hoop.bubble_state` with an integer `mask` in `-1..15`
- `hoop.stage68_mask` with empty `{}` arguments: read the **original
  instance's** conditional Stage68 flag for the late original ring
- `hoop.scene_action` with `action: "basic"`, `"change"` or `"hide"`:
  invoke a whitelisted native Stage68 scene-state transition

Hoop2 native reverse engineering confirms a key distinction: **`BubbleState`
is not a separate engine function**. It is the signed third argument (`w2`)
of `SceneRing_Hoop`. A `hoop.bubble_state` event updates the pending mask
for the *next* ring; `hoop.ring_spawn` calls the same original ring emitter
with that mask. `-1` is an original special sentinel, not equivalent to `15`.
The four lower mask bits have been identified, but arbitrary positive masks
have not all been verified on hardware. The initial mask defaults to `-1`.
The original ring **33 at beat 178** is exceptional: its native Stage68
sequence passes `1` when the live `Stage+0x2c94` byte equals `1`, otherwise
`-1`. `hoop.stage68_mask` requests that conditional *at event execution*,
using a guarded owner-provided resolver. After that ring, Hoop3 restores
`-1` for subsequent extra and original rings.

Modes: `inherit` uses the base sequence; `replace` describes an entire custom
sequence; `patch` is reserved for editing original events by stable IDs and
is explicitly rejected by this validator until that mapping exists. The
v1 host validator can check timeline syntax, but no *Switch-integrated*
scheduler or patch algorithm exists yet. The portable C++
`groove_replace_session.hpp` now models replacement ownership and dispatches
validated commands against injected callbacks using integer microbeats
(1 beat = 1,000,000 microbeats). It is tested on a host only, with **no actual
Switch native function bindings**. For this Hoop adapter's replacement mode,
the pack validator also checks that beat coordinates lie exactly on the
native **480-ticks-per-beat grid**. Six-decimal beats can currently represent
only multiples of 3 native ticks precisely; later versions should support
integer tick positions for finer timing. The example's four events are
**illustrative, not the 54-ring Hoop DX sequence**. No executable/game-specific
code is included in the archive; game adapters must explicitly implement and
validate each allowed command.

### Native Hoop bridge evidence and boundaries

The following relative offsets were identified in the owner's **hash-pinned
original Switch `main` only**, and are neither universal addresses nor a
working patch:

- `main+0x42c0c0`: Stage68 worker entry; `main+0x42ca40` is a ring
  emission call site inside the original worker.
- `main+0x217960`: original `SceneRing_Hoop` emitter.
- `main+0x1390e0`: original Stage68 scene helper; receives the Stage object
  in `x0` and a verified original label (`basic`/`change`/`hide`) in `x1`.
- `main+0x514d70` / `main+0x514dd0`: native wait / stopped checks.
- `Stage68+0x2ca0`: scene receiver passed in `x0`; original worker in
  `x1`; signed BubbleState mask in `w2`.
- Original clock: **480 native ticks per beat**.

`groove_hoop_native_schedule.hpp` models strict timestamp preflight and
ordered waits on the **game-owned worker**. `groove_hoop_native_bridge.hpp`
models the original native emitter/wait/stopped argument mapping. Both are host-tested
with fake native callbacks, not installed in the Switch game. The following
remain unverified in a real integration: original build/ABI binding,
Stage68 scene and worker lifetime, the scoped hook and original worker
suppression, instance-scoped practice skip, teardown of ring children, score,
independent save, `.groove` SD loader. Running the replacement alongside the
original Hoop2 worker would **double-spawn rings** and is forbidden.

`groove_hoop3_session_owner.hpp` now connects the prevalidated GRT1 cache,
menu-origin confirmation, native manager snapshot, first StageFactory return,
scoped practice decision and original-worker callback in one host-tested
state machine. The 10,000-event fixed arena belongs to a **static owner**, not
the native worker stack or a temporary decompression buffer. The virtual
slot is considered locked until a complete timeline has been prevalidated.
Wrong-origin, duplicate worker, stale manager, missing adapter and failed
wait cases block the borrowed Hoop3 stage; they never fall through to an
original Hoop2 cue stream *as if it were Hoop3*. On scene destruction the
owner releases the session only after its caller attests that the original
worker has joined. **No code here installs these original-game callbacks or
verifies the real concurrent lifetime**. The future loader must validate the
whole `.groove` ZIP, manifest and JSON/binary equivalence before supplying
the cache; the owner only validates the decoded timeline independently.
Original-event suppression is additionally scoped to the exact tracked
Stage68 object, never applied as a global Hoop2 flag.

The previous owner's successful **54-ring append experiment** gives 20
additional native ring coordinates; the original game's hash-pinned NSO
provides 34 audited native ring coordinates and **11 scene-state calls**.
The pinned Stage68 worker also contains 191 waits and 191 cancellation
checks; the audited direct-call inventory has no indirect BLR calls. The
local-only tools
`tools/recover_hoop3_original_rings.py` validates the NSO and extracts the 34
ring times, and `tools/audit_hoop3_worker_contract.py` recovers the native
argument contract and scene-state call schedule, without putting original
Nintendo bytes in Git.
`tools/build_hoop3_from_private_main.py` merges the original 34 and proven
bonus 20 into a **54-ring replacement draft with 68 events**: 54 ring
commands, 11 original scene-state commands, the default BubbleState,
the conditional late original mask, and a mask reset. The resulting ZIP has
editable `timeline.json`, a generated
`timeline.bin`, and inherited resources. This is a useful format/ordering
prototype, **not playable** until the live worker, hooks and SD loader are
verified and installed. The checked-in four-event example remains intentionally
small so public source does not embed the game's original 34-event schedule
or original scene-action timing data.

On cancellation/fault, the Hoop3 replacement stays in a fault state with
original Hoop2 events suppressed until its stage is safely destroyed. An
original Hoop2 menu launch must never be inferred to be a Hoop3 launch.

`groove_pack.py --build` now adds a generated `timeline.bin` cache while
preserving editable `timeline.json` in the same ZIP. Binary layout: ASCII
`GRT1`, little-endian `uint32` event count, then 16 bytes per event:
`uint64 beat_micro`, `uint32 command_id`, `int32 argument`. Command IDs are
1 = `hoop.ring_spawn` (argument 0/normal), 2 = `hoop.bubble_state` (mask),
3 = `hoop.stage68_mask` (argument 0; deferred native-stage mask),
4 = `hoop.scene_action` (0=basic, 1=change, 2=hide).
`groove_binary_timeline.hpp` decodes this format without allocations; both
the host validator and the eventual Switch loader must reject mismatches
between JSON and cache. No decompression, JSON parsing or SD access may happen
inside the gameplay tick callback. The session stays in error state on a
native call failure and must return safely to menu rather than replay original
Hoop2 cues halfway through the custom level.

The new **portable container-only ZIP32 reader** is
`source/groove_zip_archive.hpp`; see `docs/GROOVE_ZIP_INGEST.md`. Its Linux
test harness extracts all three control files from an actual 68-event draft
with injected zlib/ifstream functions and checks ZIP CRC + binary tick grid.
The new bounded `groove_hoop3_json_preflight.hpp` additionally verifies the
exact initial Hoop3 manifest and all editable JSON events against GRT1.
This preflight is **Hoop3-only**, not a generic resource-import runtime.
Music, effects and intro must stay `null`. `sprites` may be `null` or
`sprites/background.png`, the pack-local stage background that replaces
the inherited `ring/type_01/bg.spr` for Hoop 3 only. The loader copies that
PNG on the host. It is not drawn on Switch. The `groove_hoop3_archive_loader.hpp` now uses those checks to fill
the static `SessionOwner` event arena **only after a valid pack** (locking a
previously ready slot on invalid reloads, leaving active sessions alone).
That is a host-tested policy: it is not attached to Switch SD and still
cannot unlock the cell on the actual console.

## Host-side build and inspection

```sh
python3 tools/groove_pack.py examples/hoop_trundling_3
python3 tools/groove_pack.py examples/hoop_trundling_3 --build /tmp/HoopTrundling3.groove
python3 tools/groove_pack.py /tmp/HoopTrundling3.groove
python3 -m unittest tools/test_groove_pack.py -v

# For your own SHA-pinned original main (private, NEVER commit it):
python3 tools/build_hoop3_from_private_main.py /private/ExeFS/main \
  --out /tmp/HoopTrundling3-54-draft.groove

# Optional independent C++17 preflight of the generated event cache:
unzip -p /tmp/HoopTrundling3-54-draft.groove timeline.bin > /tmp/hoop3-timeline.bin
g++ -std=c++17 -Wall -Wextra -Werror -Isource \
  tools/verify_hoop3_native_preflight.cpp -o /tmp/hoop3-preflight
/tmp/hoop3-preflight /tmp/hoop3-timeline.bin
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
4. Confirm the native emitter ABI and Stage68 worker/scene lifetime on the
   pinned game, then bind the source-only bridge and schedule to a safe
   instance-scoped hook. Define a strict event lifecycle (load, play, return,
   cleanup) and guard against stale state on scene change.
5. Recover the 34+20 tested Hoop DX sequence, translate it into v1 commands,
   and only then mark Hoop Trundling 3 as playable after a Switch hardware A/B.
6. Extend the adapter registry for DS/Wii/3DS imports, with matching asset
   converters and mechanical implementations for games absent on Switch.

No new Citron APK or Switch install artifact is generated by this host tool.
