# Task report: GE-153

- Agent: Grok
- Task ID: GE-153
- Base branch and exact SHA: `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9`
- Working branch and exact head SHA (código ya importado por Codex, verificado aquí): `gemini/visual-editor` @ `0ff399a819e1b4716f12eb4ad824f48c6fae20b7`. Este informe y el ajuste de `.gitignore` raíz se añaden en un commit posterior sobre la misma rama.
- PR URL: https://github.com/angelcraft/Groove-Builder/pull/7
- Status: ready for review (borrador). La importación, las ocho pruebas, el typecheck y el build de producción están verificados de forma independiente. Los hallazgos de coordinación de ChatGPT siguen abiertos salvo lo indicado abajo. No se marca el formato `.groove` como instalable.

## Changes

- No se reimportó el código de `editor/`: ya estaba publicado en `d653945` / documentado en `0ff399a` (Codex, por instrucción previa del usuario) sobre la rama existente `gemini/visual-editor` (reserva inicial `9a7f385`).
- El ZIP adjunto en esta pasada **no** es el archivo original `groove-builder-ge153-source.zip` (SHA-256 `d87b3417bc5cd675a000d95285715d5908d77b74642d186931e09d419c482999`, 36 entradas). Es un archivo GitHub de la rama ya actualizada en `0ff399a` (comentario ZIP = ese SHA; SHA-256 del adjunto: `1e2122800c683c0932030609ecbbab710a5099f120aeb39db60f661833042ec7`). El árbol extraído coincide byte a byte con el worktree en `0ff399a` (único wrapping: `Groove-Builder-gemini-visual-editor/`).
- `reports/GE-153/COORDINATION_REVIEW.md` (ChatGPT) no se ha modificado. SHA-256 `d3103bc02dbe6c310dc42cacdb066aa3adf8ff334ce273ca45b2308730a08ec6`, idéntico a `9a7f385`, a `HEAD` y a la copia dentro del ZIP adjunto. No hay una versión distinta en el ZIP que comparar.
- Este archivo (`IMPORT_VERIFICATION.md`) revisa esos hallazgos contra el código importado, `docs/GROOVE_SPEC.md` draft 0.1, `AGENTS.md` y `reports/TEMPLATE.md` de `coordination/v0.6.0` @ `7a5fe22`. No se reescribe el informe de ChatGPT ni el de Codex (`IMPORT_VALIDATION.md`).
- Ajuste mínimo: se añaden `node_modules/` y `coverage/` al `.gitignore` de la raíz. `editor/.gitignore` ya cubría `editor/node_modules/`, `editor/dist/`, `coverage/` y `.env*`. El `.gitignore` raíz ya tenía `dist/` y `*.zip`.
- No se ha modificado `editor/src/`, las ocho pruebas, `engine/`, contratos compartidos, `codex/engine-v0.5.1-hardening`, `main` ni `work/groove-engine-v0.5.0`.

## Revisión de hallazgos de ChatGPT (`COORDINATION_REVIEW.md`)

Clasificación: confirmed (el problema existe en el código importado) / fixed / not applicable / still open. “Confirmed” y “still open” coinciden cuando el hallazgo es correcto y no se ha corregido en esta pasada.

| # | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| 1 | Schema estricto de manifest; validar `adapter` / `required_capabilities` / `engine_min` y la timeline primaria exacta; no admitir manifest ausente ni fallback en modo instalable | **confirmed / still open** | `importGroovePackage` (`editor/src/engine/groovePackage.ts`) deja `manifest = null` si falta `manifest.json`. Si el formato viene informado, acepta tanto `groove-package/1` como `groove-package`. No exige ni comprueba `engine_min`, `adapter`, `results` ni `required_capabilities`. La ruta de timeline cae a `timeline.gtf` y, si falta la entrada primaria, a `timeline.gtl`. Esto contradice `docs/GROOVE_SPEC.md`: rechazar adapter/timeline/capability no soportados y fallar cerrado. Alineado con el contrato aún en borrador (GE-154). |
| 2 | Inspeccionar el directorio crudo del ZIP antes de normalizar rutas; rechazar traversal, colisiones mayúsculas/duplicados, entradas no soportadas, symlinks, cifrado y bombas de descompresión; aplicar límites *durante* la descompresión, no tras reservar; aplicar lo mismo a RHRE | **confirmed / still open** (parcialmente mitigado) | Hay tope de 32 MiB *antes* de `JSZip.loadAsync`, recuento de archivos, `assertSafeArchivePath`, colisión case-insensitive y suma del tamaño ya descomprimido (hasta 64 MiB). Eso no inspecciona el directorio central/local *antes* de que JSZip parsee/normalice, ni usa el tamaño declarado en cabecera para rechazar antes de asignar memoria. No hay rechazo explícito de symlinks, cifrado, ejecutables ni archivos anidados. La prueba de traversal (`foo/../escape.txt`) no cubre ese conjunto. `editor/src/engine/rhreImporter.ts` hace `JSZip.loadAsync(buf)` sin límites. |
| 3 | `App.tsx` no pasa `packageId`/`packageVersion` al exportar; hay que conservar el ID al importar/guardar/renombrar, generar un ID único una sola vez por proyecto nuevo, y probar colisiones/renombres | **confirmed / still open** | `handleExportGroove` (`editor/src/App.tsx`, ~501–520) llama a `exportGroovePackage` sin `packageId` ni `packageVersion`. `handleImportFile` (~462–476) aplica timeline, BPM, sprites, prólogo y música, pero no guarda el ID en estado. `exportGroovePackage` regenera el ID con `sanitizePackageId(title)` si no recibe uno válido, así que un cambio de título cambia el ID. No hay tests de colisión ni de renombrado. |
| 4 | Exportación determinista: quitar `createdAt` dinámico y timestamps ZIP del paquete canónico; acotar todos los miembros; distinguir activos solo de editor de las capabilities de runtime | **confirmed / still open** | Cada export escribe `editor.createdAt: new Date().toISOString()` y `zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })` sin fechas DOS fijas. `required_capabilities` queda siempre en `['timeline.gtf']`. Sprites/intro/audio van bajo `manifest.editor` (esbozo útil), pero no hay separación canónica ni tope por miembro más allá de manifest/timeline y los totales del archivo. Choca con la exportación determinista pedida en `GROOVE_SPEC.md`. |
| 5 | El bucle de reproducción usa `requestAnimationFrame` / `performance.now` y dispara cues cruzados; no es scheduling preciso por muestra. Usar reloj/lookahead de `AudioContext` y probar seek y background/resume | **confirmed / still open** | `tickLoop` en `editor/src/App.tsx` (~156–219) avanza con `performance.now()` y `requestAnimationFrame`. `rhythmAudio.ts` sí tiene `AudioContext` y puede programar con `ctx.currentTime`, pero el reloj que dispara cues no es ese. No hay tests de seek, segundo plano ni reanudación. |
| 6 | No meter en el repo el ZIP fuente generado, o generarlo de forma reproducible; el botón de descarga debe ser opcional si el artefacto no está | **partially fixed / still open** (generación reproducible) | El ZIP fuente no está en el repositorio (`*.zip` en el `.gitignore` raíz). El botón (`handleDownloadSourceZip`) hace `fetch('/groove-builder-source.zip')` y, si falta, muestra un toast de error; no rompe la app. `vite.config.ts` no genera ese artefacto. Sigue abierto: no hay generación reproducible y el botón apunta a un estático que no se publica. |
| 7 | Generar el contrato del editor desde un JSON autoritativo fijado; tests diferenciales contra el parser Python/nativo, incluidos rechazos | **confirmed / still open** | `editor/src/engine/engineContract.ts` es una constante TypeScript escrita a mano (comentario: alineada con `codex/engine-v0.5.1-hardening/tools/engine_contract.json`), no un artefacto generado. ChatGPT comprobó la tabla (53 claves, 23 layouts, 3 perfiles bloqueados; huella FNV-1a `212027bb`) y advirtió que eso no es paridad semántica del parser. Hay tests de perfiles/errores GTF y un round-trip `.groove`, pero no un diferencial automatizado contra `tools/gtf.py` ni el parser C++ con entradas rechazadas. |

## Evidence

Verificación independiente en este host el 27 nov 2026, 23:47 CET (Europe/Amsterdam). No se reutilizaron los logs de Codex.

Entorno: Node `v24.22.1`, npm `11.21.1`, directorio `editor/`.

```text
$ npm ci --ignore-scripts
# exit 0
# added 492 packages, and audited 499 packages in 5s
# npm warn deprecated node-domexception@1.0.0
# npm warn deprecated glob@11.1.0
# 4 moderate severity vulnerabilities (no se ejecutó npm audit fix --force)

$ npm test
# = node --import tsx tests/grooveEngine.test.ts
# exit 0
# 8 tests, 8 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo
# duration_ms 48.647035
#   ✔ all 24 Groove Engine minigames have registered cues
#   ✔ duration parsing and beat formatting match gtf.py
#   ✔ loop, def/call, fractions, prologue/jingle/title, fade, anim, switch cut round-trip
#   ✔ example GTF and 24-game showcase GTF compile and round-trip cleanly
#   ✔ GTF error cases match gtf.py validation rules
#   ✔ RHREfresh remix JSON converts patterns, pairs, stretchables, and subtitles
#   ✔ .groove ZIP package round-trips timeline, BPM, sprites, and prologue image
#   ✔ enforces Codex engine_contract.json cue arg profiles, ring_mask, blocked profiles, and layouts

$ node --import tsx --test tests/grooveEngine.test.ts
# exit 0; también 8/8 (a diferencia del entorno de Codex, aquí --test sí enumera los ocho cuerpos)

$ npm run typecheck
# = tsc --noEmit
# exit 0; sin errores

$ npm run build
# = vite build
# exit 0
# aviso: Vite config uses features unsupported by configLoader: 'native'
#   — __dirname (vite.config.ts:95:40); sugiere import.meta.dirname
# vite v8.4.0, 1678 modules transformed, built in 216ms
#   dist/assets/index-2dNmLT6K.css   32.27 kB (gzip 6.72 kB)
#   dist/assets/index-V6vqu-Aj.js   489.24 kB (gzip 144.22 kB)
# PWA v2.0.0 generateSW, precache 15 entries (524.04 KiB)
#   dist/sw.js, dist/workbox-835c8c05.js
```

`editor/dist/` y `editor/node_modules/` quedaron locales y fuera de Git (`git check-ignore` lo confirma). No se ha hecho prueba de UI en navegador, audio real, Android, emulación Unicorn ni hardware Switch. No se compiló APK ni módulo ARM64. No se publicaron recursos del juego ni secretos (escaneo: ningún `main` binario, `.cwv`, `.spr`, `.tex`, `.msbt`, `.bwav`, `.rhref` ni `.env` bajo `editor/`, excluyendo `node_modules`/`dist`).

El ZIP fuente original `d87b3417…` no está en este box, así que no se ha vuelto a calcular el CRC ni el diff de `package.json` contra ese archivo. Se acepta la evidencia de Codex: único cambio en fuentes importadas fue `package.json` (`esbuild` `^0.25.0` → `^0.28.2` por peer de Vite 8, más scripts `test`/`typecheck`; se conserva `bun.lock` como procedencia; el flujo verificado es `package-lock.json` + `npm ci`, sin `--force` ni `--legacy-peer-deps`). `npm ci` ha reproducido esa instalación sin ERESOLVE.

## Compatibility and risks

- El contrato `.groove` sigue siendo borrador 0.1 (`docs/GROOVE_SPEC.md`). Pasar 8 pruebas no acredita un paquete instalable ni paridad completa de parsers.
- No importar ZIP/RHRE no confiables en este prototipo: los límites de `rhreImporter.ts` y parte de la validación de archivo siguen abiertos.
- Identidad de paquete inestable: exportar tras un renombrado puede cambiar el ID y pisar o desligar guardados futuros indexados por ID (relevante para GE-152).
- Exportación no determinista (`createdAt`, timestamps ZIP): hashes de release no serían estables.
- Reloj de audio por RAF: no sirve para afirmar fidelidad rítmica ni comportamiento en segundo plano.
- Warnings de Vite (`__dirname`) y deprecaciones `glob` / `node-domexception` no se han silenciado ni convertido en fallos. Hay 4 avisos moderados de `npm audit`; no se ha forzado una actualización masiva.
- Rollback: la rama no toca el runtime nativo; revertir este PR deja `work/groove-engine-v0.5.0` intacto.

## Dependencies / blockers

- GE-154 (ChatGPT): formalizar/congelar el contrato de paquete antes de tratar `.groove` como instalable.
- GE-155 (Cursor, opcional): validador de host y fixtures tras esa aprobación.
- GE-151 (Codex, `codex/engine-v0.5.1-hardening` @ `1a67208`): no se ha modificado. El endurecimiento de escritura nativa y el prototipo de casillas independientes siguen en esa línea y en GE-152.
- El botón «Download Source» requiere un artefacto opcional no versionado si se quiere esa descarga en la PWA.

## Next steps

1. Revisar este informe junto con `COORDINATION_REVIEW.md` e `IMPORT_VALIDATION.md` en el Draft PR #7. No fusionar a `main` ni a `work/groove-engine-v0.5.0` hasta el orden de integración de GE-154.
2. Cuando GE-154 lo autorice: schema estricto y fail-closed, inspección del ZIP antes de descomprimir (también en RHRE), ID persistente con tests de colisión/renombrado, exportación determinista y contrato generado desde el JSON fijado más tests diferenciales contra `tools/gtf.py` / parser nativo.
3. Sustituir el reloj RAF por scheduling con `AudioContext` (lookahead, seek, resume) y añadir pruebas.
4. Pruebas de UI en navegador/Android y, más adelante, validación en Switch (GE-156) solo con backups; no es el alcance de esta importación.
