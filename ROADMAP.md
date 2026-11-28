# Groove Engine roadmap (proposed)

Goal: create a level in Groove Builder, export a .groove package, install on SD, and play in Nintendo Switch without rebuilding subsdk4 for every level.

## v0.5.1 — hardening
Resolve PR #3 acceptance criteria; reproduce host tests and pinned ARM64 build, then validate on physical Switch. Preserve legacy GTF/GTL and original levels. Use non-native results during experimental isolation tests.

## v0.6.0 — first package round trip
Freeze the proposed package contract after review. Implement host validator and exporter, then bounded native loader. First target is the existing Multi host and/or HT3 adapter, not arbitrary new mechanics. Explicitly reject unsupported custom assets. Demonstrate two original synthetic packages, distinct stable IDs, reproducible export, reversible install, correct timing and isolated custom stats. Full scoring UI is a separate milestone.

## v0.7.0 — dynamic registry and menu
Research engine constraints before promising 256 entries. Prototype two independent additional slots, validate selection, unlock rules and persistence; expand toward 256 only after memory/layout/save constraints are understood. No overwriting native save records.

## v0.8.0+ — resources and expansion
Custom asset adapters, original audio and animation integration, verified cue semantics, more games and imported DS/Wii/3DS sequences. Editor evolves in parallel using the same contracts; native preview fidelity is not assumed.

Each release requires review, reproducible tests, explicit hardware evidence where applicable, and rollback. Version numbers are targets, not release claims.
