# GE-153 — incoming Gemini editor review (coordination)

Status: source ZIP received and reviewed locally; SOURCE NOT YET PUBLISHED. This branch is reserved for the editor import; do not treat it as an implementation PR.

Archive: groove-builder-ge153-source.zip; SHA-256 d87b3417bc5cd675a000d95285715d5908d77b74642d186931e09d419c482999. 36 entries, 509378 bytes uncompressed; ZIP CRC checks pass. No actual credentials or original game assets found in initial scan; .env.example contains placeholders.

Contract: canonicalized editor ENGINE_CONTRACT and tools/engine_contract.json @ Codex 1a67208 match by length and FNV-1a fingerprint (3399 UTF-16 code units, 212027bb), 53 cue keys, 23 layouts, three blocked profiles. This checks the data table, not full parser semantic parity.

Independent host verification: transpiled the unmodified core TS sources (cues, engineContract, gtfEngine) with local TypeScript transpileModule; ran six existing test bodies with Node 22.16.0 after excluding JSZip/RHRE-dependent tests. 6/6 passed. Full dependency install, typecheck, production build, RHRE import and ZIP roundtrip not reproduced; Gemini reports 8/8 and build success. Git network/DNS unavailable in review sandbox; connector can write individual text but cannot directly transfer this uploaded archive. No native hardware claims.

## Open review items
- groovePackage.ts: require strict manifest schema, supported adapter/capabilities/engine_min and exact primary timeline; no implicit missing manifest or fallback in installable mode.
- Check raw ZIP directory entries before path normalization; reject traversal, duplicate/case collisions, unsupported entries, symlinks, encryption, oversized/decompression-bomb inputs; enforce limits while decompressing, not after allocation. Apply bounded import to RHRE too.
- App.tsx export does not pass persistent packageId/packageVersion; preserve ID on import/save/rename and generate a unique ID once per new project. Test collision/rename roundtrips.
- Deterministic package export: remove dynamic createdAt and ZIP timestamps from canonical package output, bound all members; distinguish editor-only assets from runtime capabilities.
- Audio: current playback tick loop uses requestAnimationFrame/performance.now and fires crossed cues; not sample-accurate scheduling. Use AudioContext clock/lookahead, test seek and background/resume behavior.
- Keep generated source ZIP out of repository or generate it reproducibly; source-download button must be optional when artifact absent.
- Generate editor contract from pinned authoritative JSON; add differential tests against Python/native parser including rejected inputs.

## Next step
Import the exact user ZIP into editor/ (preserve files including lockfile), leave this review file in reports/GE-153/. Update Gemini's report with actual base/head, run all tests/build, and open a draft PR targeting work/groove-engine-v0.5.0. No merge or runtime changes. Contract remains draft pending GE-154.
