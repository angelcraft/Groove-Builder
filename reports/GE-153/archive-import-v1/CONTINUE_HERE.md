# CONTINUE_HERE — Groove Builder (Visual Editor)

Estado actual del desarrollo del editor visual **Groove Builder** para **Rhythm Heaven Groove** sobre **Groove Engine v0.5.0**.

## 1. Qué se ha implementado

### Núcleo Groove Engine v0.5.0 en TypeScript (`src/engine/`)
- **`src/engine/cues.ts`**: Catálogo completo de los **24 minijuegos compatibles** (`PUMPUP`, `FLYDISC`, `ROLLING`, `HUNGRY`, `CARS`, `KAERU`, `CRAB`, `INSECT`, `SOFTCATCH`, `RING`, `THUNDER`, `HAMMER`, `MOON`, `THE_A`, `PUTILABO`, `WIPER`, `SOCCER`, `HURDLE`, `TALK`, `COOKING`, `PARASOL`, `DANCER`, `SAMURAI`, `BRUSH`) con sus direcciones nativas `0x...`, argumentos por defecto, palabras de `THE_A` (`TEA`, `SODA`, `COCOA`, `AAA`), alias de RHREfresh, offsets de `layout` (`LAYOUT_OFF`), antelaciones (`leadInBeats`) y estado de calibración.
- **`src/engine/engineContract.ts`**: Contrato nativo alineado exactamente con `codex/engine-v0.5.1-hardening/tools/engine_contract.json`, `cue_validation.hpp` y `parser_support.hpp`:
  - Perfiles exactos permitidos (`cue_args`) para los 53 pares `(juego, funcion)`.
  - Regla `ring_mask` (`RING:0x217960`: `a` en `-1..15`, `b` en `0|1`, `c=0`, `d=0`).
  - Bloqueo explícito de los 3 perfiles `THUNDER` con valores crudos tipo puntero/ASLR (`11420568`, `11420576`).
  - Offsets de layout exactos (`layouts`) por minijuego (excluyendo `PUMPUP` por no tener layout verificado) y nombres `anim` `[A-Za-z0-9_]{1,47}`.
  - Límites nativos de parser (`MAX_FILE_BYTES = 60 KiB`, `MAX_SOURCE_LINES = 4096`, `MAX_LINE_BYTES = 255`, `MAX_TOKENS = 12`, `MAX_WORK = 32768`, `MAX_DEPTH = 8`, `STRING_POOL_MAX = 8192`, `match` `-1..2, 0..11, 0..4`, `prologue` seguro).
- **`src/engine/gtfEngine.ts`**: Compilador, descompilador y validador 100 % compatible con `tools/gtf.py`, `engine/src/gtf.cpp` y `engine/src/multi.cpp`, aplicando validación estricta contra `engineContract.ts` tanto en `.gtf` como en `.gtl` (`GTLM 1`) e inspector en vivo.
- **`src/engine/rhreImporter.ts`**: Conversor directo en navegador de remixes `.rhref`, `.rhre3` y `remix.json` de RHREfresh siguiendo `PATTERN_RULES`, `EQUI_RULES`, `PAIR_RULES` y subtítulos `gtl:`, ajustando argumentos estirables/pares al perfil verificado más cercano de `engine_contract.json`.
- **`src/engine/groovePackage.ts`**: Empaquetado e importación preliminar del formato **`.groove` (`groove-package/1`, borrador `docs/GROOVE_SPEC.md` draft 0.1)** en archivo ZIP (pendiente de congelación por `GE-154`):
  - `manifest.json` (`format: "groove-package/1"`, `id` reverse-DNS, `version`, `engine_min: "0.6.0"`, `adapter: "multi"`, `results: "custom"`, límites 32 MiB / 64 MiB / 256 archivos / 16 KiB manifest / 60 KiB timeline y validación contra path traversal)
  - `timeline.gtf` (fuente Groove Tickflow v0.1 listo para `sd:/groove/multi.gtf`)
  - `timeline.gtl` (`GTLM 1` compilado listo para `sd:/groove/multi.gtl`)
  - `audio/*`, `sprites/*`, `intro/*` (activos opcionales de previsualización en el editor).
- **`reports/GE-153/REPORT.md`**: Reporte de tarea `GE-153` siguiendo `reports/TEMPLATE.md` (incluyendo el bloqueo de push/PR desde el sandbox sin credenciales GitHub).

### Audio Web Audio API y Previsualización Visual (`src/audio/`, `src/stage/`)
- **`src/audio/rhythmAudio.ts`**: Decodificación de música (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`), extracción de picos de forma de onda (`waveformPeaks`), metrónomo por pulso, síntesis procedural de cues por minijuego, sonidos de transición (`switchK0` / `cut`) y previsualización de jingles `0x158..0x16C`.
- **`src/stage/stageRenderer.ts`**: Renderizador HTML5 Canvas a 60fps para los 24 minijuegos, transiciones suaves (`translen`) o de corte (`cut`/`hard`), fundidos (`fade`), animaciones de layout (`anim`), pantalla de prólogo/introducción (`type_00`..`type_19` o arte personalizado) y sprites personalizados por minijuego.

### Interfaz DAW Multiplataforma Windows + Android (`src/components/`, `src/App.tsx`)
- **Timeline multipista (`TimelineEditor.tsx`)**: Regla de pulsos, rejilla configurable (`1`, `1/2`, `1/3`, `1/4`, `1/6`, `1/8`, `Free`), forma de onda alineada al BPM, carril de cambios de escena (`Switch & FX`), 3 carriles automáticos de cues con indicación visual de antelación (`leadInBeats`), arrastrar y soltar desde la biblioteca, mover/redimensionar bloques estirables ajustados a `engine_contract.json`, y scrub con ratón o pantalla táctil.
- **Inspector restringido por contrato (`InspectorPanel.tsx`)**: Selector de perfiles `[a, b, c, d]` verificados por función, control específico `ring_mask` (`-1..15`, `0|1`) para `RING`, layouts de animación bloqueados al offset verificado de cada juego, y diagnóstico clicable en vivo.
- **Biblioteca de 24 minijuegos (`CueLibrary.tsx`)**: Búsqueda, filtros por categoría, inserción directa o `+ Switch`, audición de cues.
- **Estudio de personalización (`CustomizationStudio.tsx`)**: Configuración de prólogo/título/jingle/match, calibración de música/BPM/offset, carga de sprites personalizados por minijuego (escala, offset, tinte, rebote, `anim`) y exportación/importación `.groove`.
- **Editor de código bidireccional (`CodeStudio.tsx`)**: Edición directa de `multi.gtf` y `multi.gtl` con validación estricta del contrato nativo.
- **Exportación de código fuente limpio (`TopBar.tsx` -> `Download Source (.zip)`)**: Descarga directa del ZIP del editor (`package.json`, `bun.lock`, `src/`, `public/`, `tests/`, documentación y `reports/GE-153/`) sin `node_modules`, `dist`, credenciales ni activos propietarios.
- **PWA para Windows y Android (`vite.config.ts`, `public/`, `PWAInstallButton.tsx`)**: Instalable como aplicación standalone offline en Windows (Chrome/Edge) y Android (Chrome), con barra inferior táctil en pantallas móviles (`>= 44px`).

## 2. Pruebas y Verificación

Ejecutar pruebas unitarias, de contrato nativo y de ida y vuelta GTF/GTL/RHRE/`.groove`:
```bash
node --import tsx --test tests/grooveEngine.test.ts
```

Compilación y verificación de tipos:
```bash
npm run lint
npm run build
```

## 3. Notas del entorno y próximos pasos
- El motor nativo C++ (`engine/`) de `work/groove-engine-v0.5.0` no ha sido modificado.
- Para probar un remix exportado en consola Nintendo Switch con Groove Engine v0.5.0/v0.5.1, copia el `multi.gtf` exportado a `sd:/groove/multi.gtf` (o `sd:/groove/stages/multi/multi.gtf`).
- Próximas mejoras recomendadas cuando se integre un runtime `.groove` nativo en Switch:
  1. Soporte de duración por `switch` individual (`switch JUEGO 1`, `switch JUEGO 2`) en cuanto el motor nativo lo acepte.
  2. Exportación directa de texturas `.tex`/`.spr` desde el panel de sprites si se añade un empaquetador de gráficos Switch.
  3. Carga directa de carpetas de audio SFX personalizadas de RHREfresh cuando el usuario las seleccione en escritorio.

