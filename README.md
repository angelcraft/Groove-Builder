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
The optional read-only `tools/audit_hoop3_practice_path.py` checks the native
practice/showtime branch against a local original `main`; it neither skips
practice nor requires distributing game binaries.

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

The application/title name is descriptive only and is not affiliated with
Nintendo or the game's publisher.
