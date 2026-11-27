# CONTINUE_HERE — Groove Builder (Visual Editor)

Estado actual del desarrollo del editor visual **Groove Builder** para **Rhythm Heaven Groove** sobre **Groove Engine v0.5.0 / v0.6.0-dev** (rama objetivo: `gemini/visual-editor`).

## 1. Qué se ha implementado (incluyendo correcciones de PR #7 y `GE-154` Draft 0.2)

### Núcleo Groove Engine + Contrato Fijado (`src/engine/`)
- **`src/engine/cues.ts`**: Catálogo completo de los **24 minijuegos compatibles** (`PUMPUP` .. `BRUSH`) con sus direcciones nativas `0x...`, argumentos por defecto, palabras de `THE_A` (`TEA`, `SODA`, `COCOA`, `AAA`), alias de RHREfresh, `LAYOUT_OFF` y antelaciones (`leadInBeats`).
- **`src/engine/engine_contract.pinned.json`** + **`src/engine/engineContract.ts`**: Copia literal fijada de `codex/engine-v0.5.1-hardening/tools/engine_contract.json` (`version: 1`, 53 pares cue/función, `ring_mask`, perfiles ASLR bloqueados, 23 `layouts` excluyendo `PUMPUP`, límites nativos de `parser_support.hpp` y `cue_validation.hpp`). No se mantiene ninguna tabla duplicada en TypeScript.
- **`src/engine/gtfEngine.ts`**: Compilador, descompilador y validador 100 % compatible con `tools/gtf.py` y `engine/src/gtf.cpp`/`multi.cpp`. Incluye modo `runtimeMode` para paquetes `.groove` Draft 0.2 (`results exit`, omisión de `match`, bloqueo explícito de `results native` y `match`).
- **`src/engine/zipSecurity.ts`**: Inspector y empaquetador ZIP binario crudo sin `JSZip` en rutas de seguridad:
  - Verifica EOCD, Central Directory (CD) y Local File Header (LFH) antes de normalizar rutas.
  - Rechaza traversal (`..`), barras invertidas `\`, colisiones exactas o por mayúsculas/minúsculas, enlaces simbólicos, directorios en perfil `runtime`, cifrado, métodos/flags no soportados, multi-disco, ZIP64, discrepancias CD-vs-LFH, nombres reservados DOS (`CON`, `NUL`, etc.), puntos/espacios finales, archivos anidados (`.zip`, `.groove`, `.rhref`, `.rhre3`), UTF-8 inválido, archivos truncados y bombas de descompresión mediante streaming acotado (`DecompressionStream`) + comprobación CRC-32 real.
  - Rechaza claves JSON duplicadas (`parseStrictJson`) y genera ZIPs canónicos deterministas (orden fijo, época DOS `1980-01-01 00:00:00`).
- **`src/engine/groovePackage.ts`**: Implementación de **`docs/GROOVE_PROFILE_DRAFT_02.md`** y **`groove-runtime-manifest.draft.schema.json`** (etiquetado **Preview Only / Draft 0.2 — no instalable en consola hasta congelar GE-154/GE-155**):
  - Perfil **`runtime` (`adapter: "multi"`)**: exactamente 2 archivos (`manifest.json` <= 16 KiB + `timeline.gtf` o `timeline.gtl` 1..60 KiB), esquema estricto (`additionalProperties: false`, `engine_contract: 1`, `engine_min` semver numérico `<= 0.6.0`, `results: "custom"`, `entry`/`capabilities` consistentes).
  - Perfil **`editor`**: paquete completo de autoría con música, sprites, carátula de prólogo y metadatos `groove-editor/1`.
  - **Identidad persistente UUID (`org.groovebuilder.<uuid>`)**: se conserva entre ediciones/renombres/importaciones, se regenera únicamente bajo acción explícita `Fork / New ID`, e incluye detección local de conflictos de versión/downgrade por `(id, version, sha256)`.
  - **Confirmación no silenciosa de export runtime**: `analyzeRuntimeExportImpact` detecta música, sprites, prólogo personalizado, `results native` o `match` antes de omitir/convertir y exige confirmación explícita del usuario.
- **`src/engine/rhreImporter.ts`**: Conversor directo de `.rhref` / `.rhre3` / `remix.json` usando el lector ZIP estricto (`zipSecurity.ts`) y ajuste automático al perfil verificado más cercano de `engine_contract.pinned.json`.

### Audio Lookahead Web Audio API y Previsualización (`src/audio/`, `src/stage/`)
- **`src/audio/rhythmAudio.ts`**: Planificador lookahead anclado al reloj de hardware **`AudioContext.currentTime`** (`planLookaheadWindow`, `LOOKAHEAD_SEC`), seguimiento/cancelación limpia de nodos al hacer `seek`/`stop`, y resincronización segura tras suspensión/cambio de pestaña (`visibilitychange`) sin ráfagas de cues atrasados.
- **`src/stage/stageRenderer.ts`**: Renderizador HTML5 Canvas a 60fps para los 24 minijuegos, transiciones, fundidos, `anim` y sprites personalizados.

### Interfaz DAW y Build (`src/components/`, `src/App.tsx`, `vite.config.ts`)
- Botones separados en `TopBar.tsx` para **`Export Authoring .groove`** y **`Export Runtime .groove (Draft 0.2)`**, modal de confirmación de omisiones en `App.tsx`, y controles de identidad (`UUID`, `Fork / New ID`, `version`, `runtimeFormat`, checksum SHA-256 de integridad local) en `CustomizationStudio.tsx`.
- Botón `Download Source (.zip)` condicional a la disponibilidad real de `/groove-builder-source.zip` (`HEAD` check).
- `vite.config.ts` usa `import.meta.dirname` (sin warnings de `__dirname` en ESM).

## 2. Pruebas y Verificación

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## 3. Notas del entorno y próximos pasos
- El motor nativo C++ (`engine/`) de `work/groove-engine-v0.5.0` no ha sido modificado.
- No se han realizado pruebas en consola Nintendo Switch ni compilación nativa ARM64 (fuera de alcance en este entorno).
- La exportación directa/push hacia GitHub desde el sandbox sigue bloqueada por ausencia de credenciales Git/SSH/GH; usar el paquete limpio actualizado en `public/groove-builder-source.zip` (o `Export -> Download Source (.zip)`).
