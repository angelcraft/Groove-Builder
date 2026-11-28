# Task report: GE-153

- Agent: Gemini
- Task ID: GE-153
- Base branch and exact SHA: `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9` (coordinated against `coordination/v0.6.0` @ `0ca2c9dbf9848e4fc1e76744145894840baae971`)
- Working branch and exact head SHA: `gemini/visual-editor` (local AI Studio workspace; not pushed — see Blockers)
- PR URL: pending manual push from local git clone (no GitHub credentials in sandbox)
- Status: ready for review (pending `GE-154` freeze for `.groove` exporter & sandbox push blocker)

## Changes

- `src/engine/cues.ts`: Canonical catalog of all 24 compatible Groove Engine minigames (`PUMPUP` .. `BRUSH`), native cue function addresses (`0x...`), arguments, `THE_A` word tokens (`TEA|SODA|COCOA|AAA`), RHREfresh aliases, `LAYOUT_OFF`, lead-in beats, and starter templates (`EXAMPLE_GTF`, `SHOWCASE_24_GTF`).
- `src/engine/engineContract.ts`: Exact client-side enforcement of `codex/engine-v0.5.1-hardening/tools/engine_contract.json` (`version: 1`), `cue_validation.hpp`, and `parser_support.hpp` (53 `cue_args` domains, `ring_mask` `-1..15` / `b: 0|1`, blocked raw pointer-like `THUNDER` profiles, 23 verified `layouts` excluding `PUMPUP`, `[A-Za-z0-9_]{1,47}` `anim` names, 60 KiB / 4096-line / 255-byte / 12-token / 32768-work / 8192-string-pool limits, and `match`/`prologue` bounds).
- `src/engine/gtfEngine.ts`: Complete TypeScript port of `tools/gtf.py` and `engine/src/gtf.cpp`/`multi.cpp` (`TPB = 480`, `compileGtf`, `parseGtl`, `emitGtl`, `decompileToGtf`, `validateTimeline`, `timelinesEqual`, `activeGameAtTick`), enforcing `engineContract.ts` identically to the native engine.
- `src/engine/rhreImporter.ts`: Direct browser importer for `.rhref` / `.rhre3` / `remix.json` implementing `PATTERN_RULES`, `EQUI_RULES`, `PAIR_RULES`, and `gtl:` subtitle directives from `tools/groove_rhre.py`, snapping resized/stretchable cues to verified `engine_contract.json` profiles.
- `src/engine/groovePackage.ts`: Draft `.groove` ZIP exporter/importer aligned with `docs/GROOVE_SPEC.md` draft 0.1 (`format: "groove-package/1"`, `adapter: "multi"`, `results: "custom"`, reverse-DNS `id`, semver, path-traversal checks, 32 MiB/64 MiB/256-file/16 KiB manifest/60 KiB timeline limits). Kept clearly labeled as draft 0.1 pending `GE-154` contract freeze.
- `src/audio/rhythmAudio.ts`: Web Audio API music decoder, waveform peak extractor, BPM/offset clock sync, metronome, procedural cue SFX synthesis across all 24 minigames, and prologue jingle preview (`0x158..0x16C`).
- `src/stage/stageRenderer.ts`: 60fps HTML5 Canvas visual preview for all 24 minigames, `switch` transitions (`translen` smooth wipe vs `cut`/`hard`), `fade` overlays, `anim` pulses, prologue preview (`type_00..type_19`), and custom sprite overrides.
- `src/components/*`, `src/App.tsx`, `vite.config.ts`, `public/*`: Responsive Windows + Android PWA DAW interface (`TopBar`, `TransportBar`, `CueLibrary`, `TimelineEditor`, `StagePreview`, `InspectorPanel`, `CustomizationStudio`, `CodeStudio`, `PWAInstallButton`), constraining args/layouts to `engine_contract.json` and offering clean source ZIP download (`Export -> Download Source (.zip)` / `public/groove-builder-source.zip`).
- `tests/grooveEngine.test.ts`: Synthetic unit, round-trip, error-parity, RHRE conversion, `.groove` draft package, and `engine_contract.json` conformance tests (8/8).
- `CONTINUE_HERE.md`: Handoff and workspace status documentation.

## Evidence

- Static TypeScript check (`npm run lint` / `tsc --noEmit`): passed cleanly (0 errors).
- Production Vite + PWA bundle (`npm run build`): succeeded cleanly.
- Host synthetic + contract tests (`node --import tsx --test tests/grooveEngine.test.ts`): 8/8 passed (`0` failures).
- Reference Python tests (`python3 /tmp/groove-engine/tools/gtf.py test`): 19 ok, 0 fallos.
- Native ARM64 build, Switch emulation, and physical Switch hardware tests: NOT performed (out of scope for `GE-153`; no `engine/` files modified).

## Compatibility and risks

- Zero proprietary game assets (`main`, `romfs`, `.spr`, `.tex`, `.msbt`, game audio) included in codebase or tests.
- Zero modifications to native C++ `engine/` runtime files.
- `.groove` exporter implements `docs/GROOVE_SPEC.md` draft 0.1 as a preview; manifest schema remains subject to `GE-154` freeze and `GE-155` host validator alignment.

## Dependencies / blockers

- **GitHub push / PR creation blocked in sandbox**: The execution environment has no `gh` CLI or GitHub write credentials/SSH keys to push `gemini/visual-editor` or open a draft PR on `angelcraft/Groove-Builder`. Alternative: download or unpack the clean source ZIP (`public/groove-builder-source.zip` / `Export -> Download Source (.zip)`) into `editor/` on branch `gemini/visual-editor` from a local authenticated clone and push/open draft PR referencing `GE-153`.
- **`.groove` contract freeze**: Depends on `GE-154` (`docs/GROOVE_SPEC.md` review) and `GE-155` (`tools/groove_package.py` validator) before considering `.groove` output frozen for `v0.6.0`.

## Next steps

1. Unpack the exported clean source ZIP into `editor/` on branch `gemini/visual-editor` (branched from `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9`), commit, push, and open a draft PR referencing `GE-153`.
2. Coordinate with `GE-154` (ChatGPT) and `GE-155` (Cursor) once `docs/GROOVE_SPEC.md` freezes to lock `manifest.json` fields and test fixtures cross-compatibility.

