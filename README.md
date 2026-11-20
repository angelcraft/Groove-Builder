# Groove Hoop3 — independent Switch text builder

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
The optional read-only `tools/audit_hoop3_practice_path.py` checks an older
**Stage67** practice/showtime branch; it must **not** be used to patch Hoop 2.
`tools/audit_hoop3_stage68_route.py` checks the correct **Stage68 (Hoop 2)**
constructor, preliminary/normal paths, and later uses of a local stage flag.
Both require a user-owned original `main`; neither modifies it.
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
