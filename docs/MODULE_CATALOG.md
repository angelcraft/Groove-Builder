# Groove menu extensions in one subsdk — 20 November 2026

## Current verified boundary

Phylos's physical Switch already displayed and selected the new slot at
`(world=1, column=9, row=0)` using an existing IPS/SPR experiment. Pressing A
started original Hoop Trundling 2. This **does not** establish a separate game
identity, score, sequence, or practice-skip behavior.

This repository adds a source-only *text* dispatcher. The native menu has two
different callsites: one resolves the game title, and one resolves its
instruction message. The text dispatcher is not installed on Switch yet.

## One carrier, several independently verified entries

`source/hoop3_title_dispatch.hpp` defines a `constexpr kTextOverrides[]`.
Every entry must specify:

- `world`, `column`, `row`: native menu coordinates (not sprite positions).
- `native_kind`, `native_index`: identity passed to the title callsite.
- `borrowed_label`: original instruction label to match exactly.
- `replacement_label`: new message label, present in **both** message banks.

Only Hoop 3 is in the production table:

| Cell | Native title | Borrowed label | Replacement label |
|---|---|---|---|
| `(1,9,0)` | `(1,41)` | `I_RING_01` | `I_RING_02` |

The test-only two-entry catalog exercises `(1,9,4)` in addition to `(1,9,0)`;
it never enters the Switch build. Duplicate coordinates or out-of-bounds
entries fail compile-time validation. Missing messages fall back to the
original game text. Unrelated native identities or instruction labels do not
read the menu's Scene pointer.

## Separate work, not solved by a text catalog

1. **Physical load probe**: ensure `subsdk6` is unused *now* and an inert
   module loads alongside `subsdk1` and `subsdk5` on the actual Switch.
2. **Safe runtime hook**: validate code alias permissions, instruction-cache
   coherence, exclusivity/quiescence, branch distances, and menu Scene lifetime.
   Cross-compilation alone is not evidence of a safe runtime patch.
3. **Message test**: title/instructions use `I_RING_02` only for `(1,9,0)`;
   original Hoop Trundling 2 and worlds 0/2 remain unchanged.
4. **Independent gameplay**: identify the native selection-to-launch path,
   separate sequence and score/progress identity, and only then skip practice
   for Hoop 3. Reusing a graphic or changing a message cannot do this.
5. **More slots**: establish each new cell's native kind/index, original
   message label, sprite data, navigation and launch behavior individually.

## Hoop Trundling 3 — visual and gameplay acceptance checklist

These are **requirements, not implemented features**. Every change must be
scoped to `(world=1, column=9, row=0)` and leave Hoop 1/2 unchanged.

- [ ] **Name and instructions**: show `Pasar por el anillo 3` in Spanish and
  adapt the original Hoop 2 instructions for Hoop 3 using independent labels.
- [ ] **Menu icon**: use an independent, recognizably harder-looking Hoop icon
  in the same visual style as the original, rather than the temporary borrowed
  Remix graphic. Preserve all original menu cells and animations.
- [ ] **Intro/splash**: change the visible numeral from **2** to **3** only
  when Hoop 3 is launched. First identify whether the original `2` is a
  message, a texture, or an animation; do not globally replace Hoop 2 assets.
- [ ] **Skip practice**: start Hoop 3's gameplay directly, bypassing its
  practice/tutorial while preserving practice behavior for Hoop 1 and Hoop 2.
- [ ] **Separate gameplay**: connect the planned 54-ring sequence without
  reusing Hoop 2 progress/records as if it were a new level.
- [ ] **Regression A/B on Switch**: test icon/title/intro/practice, game launch,
  exit/reentry, other worlds, and Hoop 1/2 with and without the mod.

Do not mark any checkbox complete from host-side tests, Unicorn, or a cross-
compiled NSO alone. It requires the relevant Switch runtime observation.

### Read-only practice routing evidence (pinned original `main`)

The original Hoop 2 stage has a distinct practice/showtime control-flow split:

- `main+0x428fbc` calls a state predicate, then `0x428fc0` branches to the
  tutorial when its return bit 0 is clear.
- The practice path calls `0x42b740` at `main+0x4290cc`, then rejoins normal
  playback via `0x4290ec -> 0x428ff8`.
- The non-practice route goes directly to `0x428ff8`, which invokes showtime
  setup `0x429330` at `0x42900c`; the registered cue worker is `0x429750`.
- The predicate reaches `main+0x1306f0` and reads a **global** bitmask `0x101`.
  It is **not yet established** that this flag is a dedicated tutorial switch.

`tools/audit_hoop3_practice_path.py` checks these exact opcodes, branch targets,
registration pointer and original NSO SHA-256. It does **not** change a byte.
Five synthetic negative/positive tests require no Nintendo data. Example use
with an authorized private original and local `lz4` dependency:

```sh
python tools/audit_hoop3_practice_path.py /private/path/to/main
```

**Critical next gate:** verify a trustworthy *menu-confirm launch origin* for
`(1,9,0)` and a one-shot state cleared on cancellation, stage entry, return,
and menu reopen. A **candidate confirmed path** is now pinned: menu
`0x1d2d00/0x1d2d04` checks availability greater than 1, then
`0x1d2eac` passes the Scene and selected descriptor to `0x1d3130`.
That is better than the unrelated panel-title lookup as a future origin
signal, but its full asynchronous launch/cancel lifecycle remains unverified.
Simply selecting a title is **not** evidence of launching it.
Changing this global predicate or making the original branch unconditional
would also affect Hoop 2 and is therefore **not an acceptable skip patch**.

Do not rename an arbitrary `.nso` to a slot or install the experimental active
artifact. Preserve the working IPS and all modules and backups. No original
Nintendo data belongs in this repository.
