# Groove Hoop3 — independent Switch text builder

> **Current direction (20 Nov 2026): Groove Engine + `.groove` levels.**
> New research-only tools can validate and build ZIP-based `.groove` packs
> with native-style timelines and optional resources; see
> [`docs/GROOVE_FORMAT.md`](docs/GROOVE_FORMAT.md) and
> `examples/hoop_trundling_3/`. The catalog metadata plans 256 identities
> (80 originals + 176 new), but **no Switch runtime loader, native table
> expansion or playable custom sequence is installed yet**. Existing Stage68
> practice probes do not implement this new architecture.

Small, **source-only** public research project for cross-compiling the proposed
Hoop Trundling 3 menu title / description bridge.

It is deliberately independent of the private `RhythmHeavenGroove-Android`
repository and can be published without original game files.

## Scope and current result

- Intended cell: world **1**, column **9**, row **0**, already visually present
  in the user's Switch. The bridge changes only this menu entry's text lookup.
- Retains original text behavior for the other 179 tested selections.
- Two compile variants: read-only diagnostic (default), experimental code-writing
  patcher (explicit `--active`). Neither has passed a hardware runtime test.
- One compile-time **text override catalog** in `source/hoop3_title_dispatch.hpp`:
  currently **only** `(world=1, column=9, row=0)`. The same `subsdk6`
  carrier can eventually route more independently verified cells; a host test
  exercises two entries without enabling the second entry in the Switch build.
- Does **not** make the new cell a separate 54-ring gameplay level, change cues,
  skip practice, or supply/modify the proprietary resource containing the Spanish
  title `Pasar por el anillo 3` and matching description.

**This is NOT an installer. Do not copy the `.nso` into an active Switch setup.**
The slot, memory mapping, cache behavior, build identity, coexistence with other
mods, and game Scene lifetime still need physical verification.

See [`docs/MODULE_CATALOG.md`](docs/MODULE_CATALOG.md) for the boundaries
between menu text, selection, game routing, cues, practice, and progress.
The new [`Groove Extended Catalog v1`](catalog/README.md) now holds the first
**mod-owned** entry, `groove.hoop_trundling_3` / virtual index `80`, as shared
JSON metadata for Android and a generated C++17 table for Switch. The existing
title/intro/stage-origin policies use this shared entry; a virtual launch,
independent records, music/cues and game assets remain **uninstalled**.
The optional read-only `tools/audit_hoop3_practice_path.py` checks an older
**Stage67** practice/showtime branch; it must **not** be used to patch Hoop 2.
`tools/audit_hoop3_stage68_route.py` checks the correct **Stage68 (Hoop 2)**
constructor, preliminary/normal paths, and later uses of a local stage flag.
Both require a user-owned original `main`; neither modifies it.
`tools/build_stage68_global_probe.py` now optionally generates a **single-
instruction, reversible IPS diagnostic** for this original Stage68 branch.
The unmodified branch and proposed branch both execute in Unicorn, but the
candidate has **not** been tested on Switch. Crucially, the diagnostic applies
to the **original Hoop 2 as well as the new Hoop3-looking menu slot**; it does
not grant a unique identity, add 54 hoops, or safely implement a Hoop3-only
practice skip. The script requires an explicit long opt-in before emitting an
IPS and does not include game files in source control. See the kit's `LEEME`.
The new `tools/audit_hoop3_native_selection_record.py` independently traces
the game's native manager slots for the confirmed world/column/row and native
index. The original setters/getters now pass an ARM64 Unicorn round-trip for
both native menu modes. `source/hoop3_stage68_route_gate.hpp` additionally
requires a matching native-manager snapshot before accepting the Stage68
object. This is **only a host-side guard**: coordinate stability across the
actual async scene transition is still unverified.
**New scoped diagnostic:** `tools/build_stage68_scoped_probe.py` builds a
two-record experimental IPS. It intercepts the Stage68 branch and checks the
native saved `(world=1,column=9,row=0,index=41)` before bypassing its
preliminary route. Hoop2 and other selections retain their original branch
decision in 33 original-code Unicorn cases. A 140-byte stub lives in the
zero-filled alignment gap after `.text`, not in the 80-record native array.
Atmosphère's official loader zeroes that gap, applies IPS and marks the
page-rounded text region executable. The stub preserves x9/x16/x17/SP, but
the actual Switch and asynchronous manager lifetime are NOT yet verified.
The generator refuses to emit the hardware A/B kit without explicit opt-in;
this is not a new game, a release or a guaranteed working practice skip.
The inactive `source/hoop3_stage68_route_gate.hpp` models a one-shot stage
instance match. It does not patch a branch or prove the asynchronous lifecycle.
`tools/audit_hoop3_prologue_route.py` audits the original prologue selection
and scans the independently supplied ring SPR/TEX set without modifying it.
`tools/audit_hoop3_catalog_ownership.py` confirms that native kind=1 has
**80 occupied descriptors**: `41` is the original Hoop 2, and `75..79` are
Remix 16–20, not unused places for an independent Hoop 3 identity. A future
extension must add a separate catalog route without overwriting them.
The inactive `source/hoop3_intro_dispatch.hpp` models a prologue-title
override from the original menu Scene, with a 180-cell regression test.
Its candidate `source/hoop3_intro_entry.S` is linked only for compilation
proof; the hook is NOT installed, the API is NOT bound and no title is changed.

## Run local source tests (Linux, g++ and Python)

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
python3 tools/generate_extended_catalog.py --check
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_groove_extended_catalog.cpp -o /tmp/hoop3-catalog
/tmp/hoop3-catalog
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_text_patch_plan.cpp -o /tmp/hoop3-plan
/tmp/hoop3-plan
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_title_dispatch.cpp source/hoop3_title_bridge.cpp \
  -o /tmp/hoop3-dispatch
/tmp/hoop3-dispatch
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_launch_origin_gate.cpp -o /tmp/hoop3-origin
/tmp/hoop3-origin
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_stage68_route_gate.cpp -o /tmp/hoop3-stage68
/tmp/hoop3-stage68
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_intro_dispatch.cpp -o /tmp/hoop3-intro
/tmp/hoop3-intro

# Optional PRIVATE binary audit (no IPS emitted unless separately opted in):
# <main> must be your exact verified, original Switch NSO.
python3 tools/build_stage68_global_probe.py /private/main
python3 tools/build_stage68_scoped_probe.py /private/main
```

## GitHub Actions cross-build

Use **Actions → Switch Hoop3 title bridge (research cross-build) → Run workflow**.
The workflow downloads the pinned public `groove-mod` source + LibHakkun
standard libraries and produces a *compilation proof* only. The active artifact
is intentionally marked unfit for installation.

Actions billing or account restrictions may block the job even in a public repo.
If the run has no steps and complains about spending limits, this is **not** a
compiler error. Do not keep retrying builds without resolving the account issue.

## Files and provenance

- `source/`: own C++/ARM64 original research code, moved from a private checkout.
- `tools/prepare.py`: source-only build generator (copies public pinned loader
  and applies known narrow read-only fixes in a temporary copy).
- `tools/loader_pin.json`: public loader hash/submodule integrity record.
- `tests/`: independent original host tests, no Nintendo files.
- `templates/`: source-only CMake preparation templates.
- `.github/workflows/`: compile proof, no application/APK or Switch deploy.

No original SPR, MSBT, ROM/NSO, title keys, SDK files, saves, private bundles,
or commercial media belong in this repository.

For the next engineering step and exact hardware limitations, read
[`CONTINUE_HERE.md`](CONTINUE_HERE.md).

The application/title name is descriptive only and is not affiliated with
Nintendo or the game's publisher.
