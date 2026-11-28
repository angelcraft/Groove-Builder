# GE-154 — package profiles and integration gate (draft 0.2, for review)

Inputs: runtime hardening PR #6 at 1a67208, GE-152 PR #5 at 8e11d7b, editor PR #7 at 0ff399a. This supplements draft 0.1 in GROOVE_SPEC.md; it does not freeze or implement it.

## Two explicit profiles, one container
- Authoring .groove: profile editor. Preserve editor metadata, imported audio, original user graphics, BPM, offsets, timeline and stable project identity. This is not an installable package.
- Runtime .groove: profile runtime. For the first milestone, Multi only, exactly manifest.json and a single canonical timeline.gtf or timeline.gtl (GTLM 1). No editor metadata, custom audio, sprites, executable content, secondary timeline or native patches. Hoop/GTL1 remains legacy until its adapter is reviewed. Convert an editor project explicitly; if resources cannot be used on Switch, show what is omitted and require a deliberate export choice rather than silently claiming fidelity.
- No direct ZIP parsing in subsdk4 for this milestone. GE-155 validates on host and stages extracted files under sd:/groove/levels/<id>/; actual runtime registry still needs implementation. Do not copy files into legacy stages/ or game ROMFS. No native launch until GE-151/152 isolation and teardown are verified.

## Manifest
See schema/groove-runtime-manifest.draft.schema.json. Example:
```json
{"format":"groove-package/1","profile":"runtime","id":"org.groovebuilder.123e4567-e89b-42d3-a456-426614174000","version":"1.0.0","title":"Synthetic Demo","engine_min":"0.6.0","engine_contract":1,"adapter":"multi","timeline":{"format":"gtf","path":"timeline.gtf"},"required_capabilities":["timeline.gtf"],"results":"custom"}
```
Schema validates structure only. Semantic checks: title 1–95 UTF-8 bytes, valid UTF-8, no control characters, not blank; reject DOS device basenames and trailing dots/spaces in paths. IDs generated once with cryptographic UUID (not title slug); preserve on rename/import/update, regenerate only on explicit duplicate/fork. Same ID/version with different bytes is a conflict; no silent overwrite or downgrade. engine_min compared numerically; engine_contract must be supported. Contract v1 uses the authoritative tools/engine_contract.json from PR #6, not an independently edited table.

## Timeline rules
Use native hardened limits: 1–61440 bytes, 4096 lines, 255 bytes per line, at most 12 tokens (stricter legacy grammar limits still apply), expansion work <=32768, signed 32-bit nonnegative ticks and native event limits. Use exact native validation rather than only schema. GTF start=0 and GTLM start=2880 are intentional legacy defaults; export explicit start to avoid ambiguity. Export explicit results exit in the timeline for compatibility; manifest results custom means isolated package stats, not the native results screen. Reject explicit match directives in runtime packages (registry supplies the selection; do not rely on the legacy default match for routing); legacy files remain unchanged. No FORCE, DISABLE, arbitrary native addresses or unverified arguments; allowed cue offsets in GTLM are restricted by the pinned engine contract. Do not enable native results on either adapter until proven isolated.

## Archive checks and repeatability
Preserve draft 0.1 limits (32 MiB compressed, 64 MiB total expanded, 256 files for authoring; runtime exactly 2 files, manifest <=16 KiB, timeline <=60 KiB). Inspect original central and local headers before normalization; reject duplicates, traversal, backslashes, unsupported methods/flags, symlinks, encryption, multi-disk, inconsistent lengths, nested archives. Restrict runtime to stored or deflate with bounded streaming output, CRC check and actual length verification. A claimed uncompressed size is not a safety guarantee. JSON duplicate keys and invalid UTF-8 rejected before schema; bounded nesting. Canonical export fixes member order, timestamps and metadata; compare bytes within same exporter version, semantic content across implementations. Hash final bytes; no claim that hashes authenticate authors.

## Acceptance and responsibilities
GE-153: fix strict import, persistent identity and authoring/runtime split; maintain clear preview-only label and test malformed archives. GE-155: independent host validator, safe extraction/staging, rollback; fixture corpus shared with editor and runtime. GE-151: native parser/loader review; do not implement launch or package execution until isolation evidence. GE-152: two-slot registry, verified teardown and no native record changes; do not freeze binary save format yet. GE-154 reviews all contracts and disagreements.

Required evidence: positive synthetic fixtures for each supported timeline format; missing/duplicate manifest keys; path collisions/traversal; mismatched adapter/path/capability; unsupported version; native results/match rejection; parser limits; identity preserved across rename; duplicate/version conflicts; malformed/truncated ZIP and excessive actual expansion; transactional install failure and rollback. No hardware claims from host-only tests. The schema and this document are proposals, not tested implementations.
