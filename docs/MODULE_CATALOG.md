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

### Read-only Stage68 practice routing evidence (pinned original `main`)

**Correction, 20 November:** the older practice route at `0x428fbc/0x428fc0`
belongs to **StageFactory 67**, not Stage68. Its constructor starts at
`0x428d70` and its registered worker is `0x428ef0`. That route remains in
`tools/audit_hoop3_practice_path.py` as an explicitly labeled Stage67 audit;
it **must not** be used as an address for Hoop 3's borrowed Hoop 2 game.

The correctly identified **StageFactory 68 (Hoop 2)** route is now pinned:

- Factory case `0x488dc4` allocates the object, `0x488de8` calls constructor
  `0x42bea0`, and the common factory exit `0x48a568` returns the same stage
  pointer held in `x22`.
- The constructor installs the Stage68 vtable `0xd4d4b0`; its native worker
  is `0x42c0c0` (registered via the pointer at `0xd9c798`). The worker copies
  the Stage pointer from `x0` to `x20`.
- The branch `0x42c190..0x42c198` consults the instance-local byte at
  `Stage68+0x2c94`. The path for byte `!=1` reaches `0x42c2ac`; the other
  path can call the preliminary worker `0x42ed80`.
- Regular gameplay proceeds through `0x42c660`. The global predicate
  `0x139020` is shared with other code and **must not** be rewritten globally.
- **Important:** the local byte is read again at `0x42de7c` and `0x42e4a4`.
  Blindly clearing it would alter *other* Stage68 behavior; therefore the
  candidate bypass is scoped to the branch, not a write to that byte.

`tools/audit_hoop3_stage68_route.py` checks these original opcodes, branch
targets, factory/worker pointers and NSO SHA-256. It modifies nothing and
has synthetic negative/positive tests. Run with your own original and local
`lz4` dependency:

```sh
python tools/audit_hoop3_stage68_route.py /private/path/to/main
# Optional, if Unicorn is installed: execute the unmodified branch for 0/1/2
python tools/audit_hoop3_stage68_route.py /private/path/to/main --unicorn
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

`source/hoop3_launch_origin_gate.hpp` contains an **inactive one-shot policy**:
confirming precisely `(1,9,0)` with the borrowed `(kind=1,index=41)` may arm
one nonzero launch ticket, and the matching stage entry may consume it once.
Any other confirmation, a mismatched stage entry, cancellation, menu reopen,
scene destruction or return must clear the ticket. Host tests exercise all 180
menu cells and stale-ticket cases. **No native correlated launch ticket has been
verified**, so this is not yet wired to an IPS/subsdk or presented as a working
practice skip. It must never be armed from mere cursor movement.

The newer `source/hoop3_stage68_route_gate.hpp` models an alternative requiring
**no invented native ticket**: the menu confirmation for `(1,9,0)` arms a
pending origin; the *first* StageFactory return consumes it and, only if it
returns the Stage68 vtable, tags that object; the worker's conditional branch
consumes the tag only for the exact matching Stage pointer. Any unrelated
factory return, other confirmation, cancellation or reentry clears it. Tests
cover all 180 coordinates, original Hoop 2, pointer reuse and invalid vtables.
This is a **host-side policy only**. The real cancel/Scene lifecycle and an
ARM64 installer are not validated, so no experimental IPS is shipped yet.

Do not rename an arbitrary `.nso` to a slot or install the experimental active
artifact. Preserve the working IPS and all modules and backups. No original
Nintendo data belongs in this repository.

### Original prologue resource inspection (user-supplied 20 November archive)

The separately supplied `prologue.zip` provides original
`prologue/ring/type_00`, `type_01` **and `type_02`**, each with its own SPR
and TEX. Their decoded 1680×752 image atlases contain ring art/animation
pieces, but no visible glyph **2**. Therefore the intro numeral might be
drawn by a game-title message or a shared element; the actual numeral source
remains **unproven**. Do not blindly replace a texture or edit Hoop 2 globally.

The native selection entry `main+0x1d3380/84` passes `kind,index` to the
shared prologue router `0x206d00`. Its `kind=1` path calls table getter
`0x1cbc60` and loads the resource path at entry `+0x20`. The visible
`ring/type_02/prologue` literal belongs to a special `kind=0,index=8` branch
at `0x206d94/9c`: **its existence is not evidence of a playable Hoop 3**.
The custom tile still borrows the `(1,41)` Hoop 2 descriptor, so a separate
launch origin is needed before changing *its* prologue title or animation.

There is now a **candidate narrower intro-only route**. The confirmed menu
Scene enters `0x1d3130` as `x0`; its `0x1d3160` copies it to callee-saved
`x19`, and native disassembly shows **no later write to x19** before the
prologue-router call at `0x1d3384`. Hence that one original callsite has both
the selected descriptor `(w0,w1)` and an unmodified menu-Scene pointer. A
future bridge can check `(1,9,0)` *there*, call `0x206d00` **exactly once**,
then try a separate `I_RING_02` title in the prologue-name global. This avoids
a persistent global origin flag for the **intro only**, not for a later
asynchronous gameplay/practice callback.

`source/hoop3_intro_dispatch.hpp` provides only this host-tested logic; no
ARM64 callsite has been rewritten, no live global address has been bound, and
the actual scene lifetime/renderer title use remains a physical Switch gate.
The original prologue art and all other 179 menu cells are unchanged.

`tools/audit_hoop3_prologue_route.py` validates those native offsets on the
pinned original and reports private sprite/texture SHA-256/size from the ZIP
without copying content. This is an inspector, not an installer. Example:

```sh
python tools/audit_hoop3_prologue_route.py /private/main /private/prologue.zip
```
