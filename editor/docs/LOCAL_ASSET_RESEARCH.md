# Local Asset Vault & Format Research Status

Groove Builder includes a **strictly local resource vault** (`src/engine/localAssetVault.ts`, `src/engine/switchFormats.ts`, `src/components/LocalAssetVault.tsx`, and optional read-only Google Drive importer `src/components/DriveAssetBrowser.tsx`) that lets users import Nintendo Switch containers, sprites, sprite sheets/atlases, animations, music, and sound effects legitimately extracted from their own legal copy of *Rhythm Heaven Groove*, associate them with the **24 Groove Engine minigames** and verified cues, and preview them faithfully in real time.

## 1. Strict Local Isolation & Legal Boundaries

- **Zero Distribution / Zero Upload**: All imported files (whether picked from local disk or downloaded read-only from the user's Google Drive folder `RhythmGrooveDecompiled`) remain 100% on the user's device inside browser **IndexedDB** (`groove_builder_local_vault_v1`). No game assets are uploaded to any server, committed to GitHub, bundled into `dist/`, or packed into `public/groove-builder-source.zip`.
- **In-Memory Read-Only OAuth Token**: Google Drive sign-in requests exclusively the read-only scope (`https://www.googleapis.com/auth/drive.readonly`), keeps the OAuth access token strictly in memory (never in `localStorage`/`sessionStorage`), and works both in AI Studio preview (`firebase-applet-config.json`) and in standalone builds via `.env.local` (`VITE_GOOGLE_OAUTH_CLIENT_ID` for Google Identity Services or `VITE_FIREBASE_*` for Firebase Auth — public browser client IDs only, never client secrets).
- **`.gitignore` Protection**: Directories such as `local_assets/`, `extracted_assets/`, `romfs/`, `.groove-vault/` and raw Switch binary extensions (`*.bntx`, `*.bfres`, `*.bflyt`, `*.bflan`, `*.bars`, `*.bwav`, `*.bfstm`, `*.sarc`, `*.zs`, `*.szs`) are explicitly excluded in `.gitignore`.
- **Metadata-Only Association Mapping**: The vault exports only portable association manifests (`groove-builder-local-bindings.json`) referencing filenames and relative paths—never raw image or audio payloads—and Draft 0.3 **Runtime `.groove`** packages remain locked to exact 2-file `[manifest.json, timeline.gtf|gtl]` compatibility.

## 2. Format Inventory (Verified vs Parsed Locally vs Needs Research)

| Format / Magic | Role in Rhythm Heaven Groove | Status | Notes |
| --- | --- | --- | --- |
| `GTF` / `GTL (GTLM 1)` | Remix timeline scripts, tempo/meter/cues/transitions | **Verified (Groove Engine)** | Matched against `tools/gtf.py`, `engine/src/gtf.cpp`, and `src/engine/engine_contract.pinned.json`. |
| `LAYOUT_OFF` (`0x3B58..0x4778`) | Layout pointers for `anim` events across 23/24 minigames | **Verified (Groove Engine)** | Pinned in `engine_contract.pinned.json` (`PUMPUP` layout offset still pending verification). |
| `PNG` / `WebP` / `JPEG` / `GIF` | Extracted sprites, backdrops, foreground overlays, prologue art, sprite sheets | **Supported (Local Extracted)** | Verified header dimensions (`<= 4096×4096`) before decode; rendered inside `128 MiB` scene RGBA budget. |
| `BNTX` (`RGBA8`/`BGRA8`/`R8`/`RG8`/`BC1–BC5`) | Switch Tegra X1 block-linear GPU texture archives | **Supported (Local Extracted)** | Pure-TS Tegra X1 GOB deswizzling + pixel decoding into local PNGs (`src/engine/switchFormats.ts`). `ASTC` and `BC7` surfaces are flagged honestly without fabricating pixels. |
| `BFLYT` / `BFLAN` (`FLYT` / `FLAN`) | NintendoWare layouts (`lyt1`, `txl1`, `mat1`, `pan1`, `pic1`, `pas1`/`pae1`) & keyframe curves (`FLPA`, `FLVI`, `FLMC`) | **Supported (Local Extracted)** | Parsed locally and composited in `src/stage/switchCompositor.ts` with Hermite/linear/step curve evaluation matched to `anim` events and beat clock. |
| `BFRES` (`FRES` / `FMDL` / `FSKL` / `FMAT` / `FVTX` / `FSHP`) | Switch 3D models, bone hierarchies & material texture tables | **Supported (Local Extracted)** | Bounded geometry extraction (`<= 65535` verts / `<= 196605` indices) projected on stage; custom/compressed shader layouts fall back honestly with warnings. |
| `JSON` Atlas (TexturePacker / Aseprite) | Frame coordinates (`frames` array/object + `meta.image`) | **Supported (Local Extracted)** | Associated with `idle`, `beat`, `cue`, or `anim` clips synced to beat phase or FPS. |
| `WAV` / `OGG` / `MP3` / `FLAC` / `M4A` | Extracted BGM tracks, jingles & per-cue SFX | **Supported (Local Extracted)** | Preflight header check + Web Audio `decodeAudioData` scheduled sample-accurately on `AudioContext.currentTime`. |
| `.spr` / `.tex` | Proprietary Groove game atlas & texture files (`romfs:graph/scene/...`) | **Needs Research** | Exact binary packing of proprietary `.spr`/`.tex` atlases is not decoded in-browser; unpack locally to PNG + JSON or BNTX + BFLYT. |
| `.bars` / `.bwav` / `.bfstm` (`BARS` / `BWAV` / `FSTM`) | Nintendo Switch SFX archives & multi-channel stream audio | **Needs Research** | Internal cue-hash tables and stream loop metadata mapping to `CUES` still require research; extract locally to `WAV`/`OGG`. |
| `.sarc` / `.zs` / `.szs` (`SARC` / `0x28B52FFD`) | Compressed RomFS archive containers | **Needs Research** | Archive directory table & custom compression dictionaries must be unpacked locally; never fabricated by the editor. |

## 3. Native Visual Preview Architecture (GE-157)

- **Reusable 24-Minigame Scene Engine (`src/stage/sceneEngine.ts`)**: Defines `SCENE_PROFILES` for all 24 Groove Engine minigames, dynamic beat/cue camera transforms, lookahead cue windows, and strict asset priority (`Native BFLYT/BFLAN + BNTX / BFRES -> Local Vault Sprites -> Clean-Room Vector Scene`).
- **Hoop Trundling (`RING`, `src/stage/scenes/ringScene.ts`)**:
  - Perspective scrolling horizon grid with default blue dimension palette and HT3 crimson sky tint `(1.0, 0.16, 0.16)` when detected from timeline title or `anim`.
  - All 5 Trundlorbs (`pa`, `pi`, `pu`, `pe` NPCs + `po` player) placed along the depth track, jumping sequentially at `H + 1.0`, `H + 1.5`, `H + 2.0`, `H + 2.5`, and `H + 3.0` (`po`).
  - Exact `ring_mask` (`args[0]`) soap bubble mechanics: any NPC whose bit `(mask & (1 << i)) === 0` floats inside an iridescent soap bubble instead of jumping, while `args[1]` switches hoop stripe variant.
  - Dynamic tracking camera that follows rolling hoops and pulses zoom into player `po` on beat `H + 3.0`, plus Playalong hit highlight feedback and full `BFLYT`/`BFLAN`/`BFRES`/`BNTX` override priority when user assets are bound.
