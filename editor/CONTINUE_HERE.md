# GE-153 / GE-157 — Continuación del 28 de noviembre

Integración local en gemini/visual-editor a partir de f28f266 y del ZIP (6), SHA-256 92adacec16b578211aa3b921b1e9780fd8f146bf9869afd0d5591f8af9d4af79. El ZIP aporta Local Asset Vault, escenas, patrones y soporte Draft 0.3. El modo Drive usa Google Identity Services con drive.readonly y guarda el token en memoria.

- Windows con Node 24 y npm: ejecutar Start-Groove-Builder.cmd y abrir http://localhost:4173. Para Drive, copiar .env.example a .env.local antes de compilar y rellenar el ID OAuth de cliente web. Habilitar Drive API y autorizar http://localhost y http://localhost:4173 como orígenes JavaScript. La importación desde disco funciona sin ID.
- Android: servir dist en un origen HTTPS y abrirlo en Chrome para instalar la PWA. Autorizar ese origen en el mismo cliente OAuth si se usa Drive. El acceso por IP de la LAN con HTTP no sirve como prueba de instalación PWA.
- Pruebas: npm test, npm run typecheck y npm run build. La comparación Python usa el commit ff2adc2a186cfc3e1a15ca1957d673cf7f230dc2. Se puede indicar un directorio con los dos archivos de referencia de ese commit mediante GROOVE_REFERENCE_DIR y un ejecutable Python 3 mediante GROOVE_PYTHON.
- GE-155: npm run verify:ge155 usa el corpus de d3c971f incluido por referencia en el ZIP. La conformidad con todo el corpus de la punta de la PR #8 sigue pendiente. El registro npm está bloqueado en esta sesión. Quedan por probar build, apertura de Chrome/PWA y consentimiento real de Drive.
- Recursos originales: en romfs/graph/scene/ring/type_00, main.tex es Zstandard y se descomprimió de 247104 a 4577280 bytes. El contenido empieza por 40 40 00 10 y no presenta cabecera BNTX, FRES, FLYT o FLAN. main.spr mide 55271 bytes y empieza por 00 00 00 00 3d 00 00 00. Las pruebas de los cuatro formatos Nintendo usan muestras sintéticas. Para una escena fiel queda extraer píxeles y cuadros originales del par .tex/.spr y contrastarlos con fotogramas del juego. La escena vectorial heredada es una previsualización aproximada.

## Notas del ZIP de Gemini


# CONTINUE_HERE — Groove Builder (Visual Editor)

Estado actual del desarrollo del editor visual **Groove Builder** para **Rhythm Heaven Groove** sobre **Groove Engine v0.5.0 / v0.6.0-dev** (rama objetivo: `gemini/visual-editor`).

## 1. Arquitectura Rhythm Paradise (Referencia Principal RHREfresh + Secundaria Heaven Studio)

### Flujo de Edición RHREfresh (Referencia Principal — Clean-Room TypeScript)
- **Barra de herramientas dedicada (`TransportBar.tsx` / `patternStore.ts`)**: `Select [1]`, `Switch [2]`, `Erase/Pickaxe [3]`, `Ruler [4/R]` y `Stamp [5]` para patrón activo, con previsualización fantasma sobre el cursor y atajos de teclado (`Ctrl+D`, `Alt+Drag`, `Delete/Backspace`, `Escape`).
- **Dock inferior de 3 paneles (`BottomPickerDock.tsx`)**:
  - Columna de filtros (`All 24`, `Favorites`, `Recents`, `Patterns`, y las 4 categorías).
  - Rejilla de los **24 minijuegos compatibles** con estrellas de favoritos persistentes (`localStorage`) y seguimiento de recientes.
  - Panel de cues y **patrones reutilizables (`StoredPattern`)**: 8 frases integradas verificadas contra `engine_contract.pinned.json` + creación de patrones personalizados desde selección múltiple (`Save Selection as Pattern`), audición con reloj `AudioContext` (`auditionPattern`) y estampado rápido (`Stamp`).
- **Timeline RHREfresh (`TimelineEditor.tsx` + `TimelineMinimap.tsx`)**:
  - Minimapa completo superior de toda la canción (`GameBoundaries` + marcas de cues + `START`/`END`/`FINISH` + viewport arrastrable + salto rápido con click/`Shift+Click`).
  - Bandas de fondo por minijuego activo (`computeGameSections`), regla superior con **runner vectorial inspirado en Play-Yan** que salta al pulso (`|sin(pi * phase)|`), trackers arrastrables (`START`, `END`, `FINISH`), tira inferior de secciones activas (`BottomTrackers`), selección múltiple por cuadro (marquee), duplicado en grupo con `Alt+Drag` y regla de medición (`Δ pulsos · ticks · ms`).

### Previsualización y Mecánicas Heaven Studio (Referencia Secundaria)
- **Escenario animado de los 24 minijuegos (`stageRenderer.ts` + `StagePreview.tsx`)**: Representaciones vectoriales geométricas originales para los 24 juegos (incluyendo máscara visual de los 4 aros de `RING`), transiciones `switch`, `fade` y `anim`.
- **Modo Playalong en vivo (`StagePreview.tsx` + `evaluatePlayalongHit`)**: Barra inferior de telegrafía rítmica y evaluación en tiempo real (`ACE` ≤16ms, `JUST` ≤55ms, `EARLY`/`LATE` ≤115ms, `MISS` ≤165ms + `±ms`) mediante teclado (`J`/`K`) o botón táctil en Android/Windows.
- **Inspector de mecánicas tipadas (`InspectorPanel.tsx`)**: Lectura de `Lead-in` / `Hit Beat`, botón rápido `+ Switch`, matriz interactiva de 4 bits para `RING` (`H1..H4`, `Clear -1`, `All 4`, `Pass b=0|1`), selector segmentado de palabras `THE_A`, y edición en lote para selección múltiple + guardado como patrón reutilizable.

### Límites de Licencia y Reutilización de Componentes
| Origen | Licencia | Qué se adapta / reutiliza (Clean-Room) | Qué queda estrictamente excluido |
| --- | --- | --- | --- |
| **RHREfresh** | `GPL-3.0` | Filosofía UX/flujo en TypeScript/React propio: herramientas `1–5`, dock inferior de 3 columnas, patrones reutilizables, `GameBoundaries`, `TopTrackers`/`BottomTrackers`, `Minimap`. | Cero código fuente Kotlin GPL-3.0 copiado; cero sprites propietarios (`playyan`, iconos) o base de audio `SFXDB`. |
| **Heaven Studio** | `MIT` | Conceptos de vista de escenario por minijuego, ventanas de tiempo Playalong y controles tipados de parámetros en TypeScript/Canvas propio. | Cero assets Unity/propietarios; todos los argumentos siguen fijados a `engine_contract.pinned.json`. |
| **Groove Engine** | Propio (`v0.5.0`/`v0.6.0`) | `cues.ts`, `engineContract.ts` + `engine_contract.pinned.json`, `gtfEngine.ts`, `zipSecurity.ts`, `groovePackage.ts` (Draft 0.3 / GE-155), `rhythmAudio.ts` (Web Audio lookahead) y PWA Windows/Android. | Motor C++ nativo `engine/` intacto sin modificaciones. |

## 2. Seguridad, Contrato Nativo, Draft 0.3 y Paridad GE-155
- **`src/engine/engine_contract.pinned.json`** + **`src/engine/engineContract.ts`**: Copia literal fijada de `codex/engine-v0.5.1-hardening/tools/engine_contract.json` (`version: 1`, 53 pares cue/función, `ring_mask`, perfiles bloqueados, 23 `layouts`).
- **`src/engine/gtfEngine.ts`**: Paridad diferencial obligatoria contra `gtf.py` (`ff2adc2`), `swing` emitido en ticks enteros, y modo estricto Draft 0.3 runtime (`<= 60 KiB`, sin BOM, `GTLM 1` obligatorio en `.gtl`, requiere `start` único y `results exit`, prohíbe `force`/`disable`/`match`).
- **`src/engine/zipSecurity.ts` + `src/engine/groovePackage.ts`**:
  - Sincronizado con **Draft 0.3** y **GE-155 (`d3c971f`)**: EOCD exacto al final sin comentarios, campos extra limitados a `{0x5455, 0x7875, 0x000A, 0x5855}` (rechaza ZIP64 `0x0001` y extras desconocidos), tiling contiguo de Local File Headers, nombres ASCII en runtime, verificación pura en JS de fin exacto de bitstream `DEFLATE` (`verifyRawDeflateExactEnd` para atrapar `deflate-trailing-bytes` en navegador y Node), rechazo de BOM y surrogates JSON desapareados, y política de contenido reservado/ejecutable (`FORBIDDEN_CONTENT`).
  - Exportación dual: `editor` (bundle de trabajo con audio, sprites y metadata) vs `runtime` GE-155 (2 archivos exactos `manifest.json` + `timeline.gtf` o `timeline.gtl`), verificado con **3/3 fixtures válidos y 113/113 inválidos** del corpus GE-155 y validado con `groove_package/validator.py` en ambos formatos.

## 3. Gestor de Recursos Locales (Local Vault) y Presupuestos
- **`src/engine/localAssetVault.ts` + `src/components/LocalAssetVault.tsx` + `src/components/StagePreview.tsx`**:
  - Almacenamiento exclusivamente local en **IndexedDB** (`groove_builder_local_vault_v1`) con errores tipados explícitos (`LocalVaultStorageError`: `unavailable`, `quota_exceeded`, `aborted`, `transaction_failed`, `budget_exceeded`), lecturas acotadas por cursor (`openCursor`), y `saveVaultAssetsBatch` leyendo/validando/escribiendo de forma atómica dentro de la **misma transacción `'readwrite'`** sobre el estado autoritativo persistido en IndexedDB (devolviendo la lista canónica resultante a `App.tsx`, y propagando también `unavailable` al usuario).
  - Presupuestos acumulativos: máximo `64` archivos (incluidos `.json`) / `48 MiB` por lote, `128` ítems / `96 MiB` en bóveda total (`estimateStoredRecordBytes`), dimensiones raster verificables `4096×4096` exigidas por cabecera (`verifyVaultImageHeader` antes de DataURL/DOM decode; se excluyen formatos sin cabecera raster verificable como SVG), `512` frames máx. por atlas JSON, y caché de escenario `StageImageCacheManager` acotada por escena activa/enlazada tanto en cantidad (`64`) como en bytes RGBA globales cargados + pendientes (`128 MiB`), con descarga explícita (`img.src = ''`) al evictar o desmontar.
  - **`src/audio/rhythmAudio.ts`**: `preflightAudioContainer` previo a `decodeAudioData` (validación mágica WAV/FLAC/OGG/MP3/AAC/M4A, límite comprimido `16 MiB` SFX / `48 MiB` BGM, y límites por cabecera en WAV/FLAC; documentado con honestidad que MP3/OGG/M4A no exponen duración total antes de `decodeAudioData`, aplicándose topes post-decodificación antes de retener). Límites BGM (`<= 600s` / `<= 128 MiB` PCM), `auditionBufferOnce` con operador `||` (`<= 300s` / `<= 32 MiB` PCM), caché LRU SFX `BoundedAudioBufferCache`, y `AudioDecodeLimiter` (máx. `2` decodificaciones simultáneas y corte tras `5` fallos repetidos / skip por `assetId` fallido).
  - Resolución desambiguada de atlas acompañantes por directorio+archivo (`resolveAtlasTargetAsset`) y detección explícita de ambigüedad multi-juego en `suggestAssetAssociation`.
  - Aislamiento estricto: `.gitignore` bloquea recursos locales/Switch, la bóveda nunca entra en `dist/` ni en el ZIP de código fuente, y los paquetes `.groove` runtime exportan únicamente `manifest.json` + `timeline.{gtf|gtl}`.
  - **Importador de Google Drive (`src/engine/driveConnector.ts` + `src/components/DriveAssetBrowser.tsx`)**: Conexión cliente-only de solo lectura vía Firebase Auth (token OAuth estrictamente en memoria) para navegar e importar archivos de la carpeta `RhythmGrooveDecompiled` del usuario directamente a IndexedDB local bajo los mismos límites y validaciones.

## 4. GE-157 — Previsualización Visual Nativa (`BNTX`/`BFLYT`/`BFLAN`/`BFRES` + Hoop Trundling `RING`)
- **`src/engine/switchFormats.ts`**: Lectores y decodificadores binarios clean-room con límites estrictos de seguridad:
  - `BNTX`: Deswizzling exacto Tegra X1 Block-Linear GOB (`getAddrTegraBlockLinear`) y decodificación de `RGBA8`, `BGRA8`, `R8`, `RG8` y `BC1–BC5` a PNG local (`ASTC` y `BC7` reportados honestamente sin inventar píxeles).
  - `BFLYT` (`lyt1`, `txl1`, `mat1`, `pan1`, `pic1`, `txt1`, `wnd1`, `bnd1`, `pas1`/`pae1`, `usd1`) y `BFLAN` (`pat1`, `pai1`, curvas `FLPA`/`FLVI`/`FLMC` constantes, escalonadas, lineales y Hermite).
  - `BFRES` (`FMDL`, `FSKL`, `FMAT`, `FVTX`, `FSHP`) con extracción acotada (`<= 65535` vértices / `<= 196605` índices).
- **`src/stage/switchCompositor.ts` + `src/stage/sceneEngine.ts` + `src/stage/scenes/ringScene.ts`**:
  - Compositor reutilizable para los **24 minijuegos** (`SCENE_PROFILES`) priorizando recursos originales enlazados (`BFLYT`+`BFLAN`+`BNTX`, `BFRES`, sprites extraídos) sobre la escena vectorial de respaldo.
  - **Hoop Trundling (`RING`)**: Pista en perspectiva con rejilla en movimiento (cielo azul por defecto y tinte carmesí HT3), los 5 Trundlorbs (`pa`, `pi`, `pu`, `pe`, `po`) saltando exactamente en `H+1.0 .. H+3.0`, aros rodantes con variante `args[1]`, burbujas de jabón por bit inactivo de `ring_mask` (`args[0]`), cámara dinámica con zoom hacia `po`, y feedback Playalong.

## 5. Pruebas y Verificación

```bash
npm test              # 15/15 tests pasando (paridad Python ff2adc2, Draft 0.3/GE-155, Local Vault/IDB, Switch BNTX/BFLYT/BFLAN/BFRES, RING y 24 escenas)
npm run verify:ge155  # Verifica corpus completo GE-155 @ d3c971f (3/3 válidos, 113/113 inválidos) y exportaciones TS contra groove_package/validator.py
npm run typecheck     # tsc --noEmit (0 errores)
npm run lint          # tsc --noEmit (0 errores)
npm run build         # Vite + PWA (Windows/Android)
```

## 6. Notas del entorno
- El motor nativo C++ (`engine/`) de `work/groove-engine-v0.5.0` no ha sido modificado.
- No se han realizado pruebas en consola Nintendo Switch ni compilación nativa ARM64 (fuera de alcance en este entorno).
- El código fuente limpio completo se exporta en `public/groove-builder-source.zip` (incluyendo `package-lock.json` e informes `reports/GE-153/`), excluyendo `node_modules`, `dist`, credenciales y recursos propietarios.
