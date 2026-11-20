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

Do not rename an arbitrary `.nso` to a slot or install the experimental active
artifact. Preserve the working IPS and all modules and backups. No original
Nintendo data belongs in this repository.
