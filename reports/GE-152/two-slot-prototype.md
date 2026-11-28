# GE-152 — Prototipo de dos casillas independientes

Estado: **diseño**. No hay código ni build, y no se ha probado nada en Unicorn ni en Switch. Todas las direcciones vienen de revisión estática de `main` `03FF4A3B`.
Depende de: `native-save-isolation.md` (F0–F4), `inverse-map-fix.md` y PR #6 (parsers, reemplazo de guardado).

## 1. Casillas

| Ranura | Coordenada (mundo, col, fila) | Rejilla original | Anfitrión según `adapter` |
|---|---|---|---|
| A | `(0, 9, 0)` | `(0,13)` vacía [V] | `multi` → REMIX_21 `(1,67)`; `hoop` → HT2 `(1,41)` |
| B | `(0, 9, 1)` | `(0,13)` vacía [V] | ídem |

- El mundo 0 tiene las columnas 9–11 vacías en la rejilla original [V], así que ninguna casilla oficial se mueve.
- La cámara y el scroll ya llegan a la col 9: el v0.3.9 usa la col 9 del mundo 1.
- Fuera del prototipo: la página/paginación, las 256 entradas y los mundos virtuales.

## 2. Registro mínimo (RAM del módulo)

```cpp
struct SlotEntry {            // 2 entradas, < 1 KiB en total
  char id[97];               // DNS inverso, 3–96 B (manifest.id)
  char title[96];            // manifest.title (≤ 95 B UTF-8, ya validado en el host)
  char prologue[96];         // opcional; validPrologue() de PR #6
  int  jingle;               // -1, o 0x158..0x16C (rango que ya admite el motor)
  uint8_t adapter;           // 0 = multi, 1 = hoop
  uint8_t enabled;           // manifest válido + timeline presente + engine_min OK
  GsvRecord save;            // §4, cargado al iniciar
};
SlotEntry gSlot[2];
int gCustomLaunch = -1, gCustomRun = -1;   // ranura activa
```

Carga: en el primer contexto normal después del montaje de la SD (como `loadTileTitles`). Se lee `sd:/groove/slots.json` (lista ordenada de 2 ids), y para cada id, `sd:/groove/levels/<id>/manifest.json`. **No** se recorren carpetas: `main` no importa `OpenDirectory`/`ReadDirectory` [V]. La herramienta del host genera `slots.json` al instalar.

## 3. Despacho sin fugas

| Paso | Hook | Ranura A/B |
|---|---|---|
| Pintar o navegar | `mapCell 0x1CBCA0` (HkReplace) | `(0,9,r)`, con `r ∈ {0,1}` y `enabled` → descriptor virtual `{1, host}`; si no → `(0,13)`; durante `buildReverseMap` → `(0,13)` |
| Estado y bloqueo | `cellState 0x1CC420`, `saveStateAt 0x3FB0` | coordenada custom → `gSlot[r].save.state` (mínimo 2) o **≤ 1 si está desactivada (F0)** |
| Visual | post de `paintCell 0x1CC190` | `0xAE0D58[state]` en los panes del widget e icono propio |
| Panel | post de `mapInfoPanel 0x1D0130` (ya existe) | `title`, `SetRank*` según `save.bestRank`, `SetPerfectCount_<save.perfect>` |
| Confirmar | F1 `launchA 0x1D3130` | ranura = `(map+0x5274, +0x5298, +0x529C)` → `gCustomLaunch = r` |
| Título, prólogo, jingle | `stashName 0x206D00`, ranuras `0xD99D60/68/70` (como `fixStashForTile`) | se toman de `gSlot[gCustomLaunch]`, **no** del anfitrión |
| Stage | ctor HT2/R21 | timeline `levels/<id>/<timeline.path>` según `gCustomRun`; se ignora `match` |
| Progreso nativo | F2 `0x48B0`, F3 `0x4A30/0x4A70`, F4 `0x3D60` | cero escrituras (ver isolation §4) |
| Fin | post de `0x1D38A0` | escribir el `.gsv` de `gSlot[r]` y luego `gCustomRun = -1` |

Reglas contra fugas:
- Ningún hook usa `(kind, idx)` para elegir ranura. Siempre se usa la coordenada o `gCustomRun`. Así, A y B pueden tener el mismo anfitrión sin mezclarse.
- `gCustomLaunch`/`gCustomRun` solo se activan en F1 cuando la coordenada es custom. Una partida oficial del HT2 o del Remix 8 los encuentra en `-1` y sigue la ruta nativa completa.
- Los títulos del stash se restauran en el dtor (`clearTitleMode`, ya existe).

## 4. Guardado por id: `sd:/groove/custom-saves/<id>.gsv`

Binario little-endian de tamaño fijo, **160 B**:

| Offset | Tamaño | Campo |
|---|---|---|
| 0 | 4 | magic `"GSV1"` |
| 4 | 2 | `version = 1` |
| 6 | 2 | `size = 160` |
| 8 | 4 | `crc32` (IEEE) de los bytes 12..159 |
| 12 | 4 | `seq` (contador de escrituras) |
| 16 | 100 | `id` (UTF-8, terminado en NUL y relleno con NUL); debe coincidir con `manifest.id` |
| 116 | 1 | `state` (2 visible, 3 superado, 4 "ok", 7/8/9 medallas, como los nativos) |
| 117 | 1 | `bestRank` (0 ninguno, 2..5 como `0xAE1700`) |
| 118 | 1 | `perfect` (0..3) |
| 119 | 1 | `flags` (bit 0: el último fue perfecto) |
| 120 | 4 | `plays` |
| 124 | 4 | `clears` |
| 128 | 4 | `bestScore` |
| 132 | 4 | `lastScore` |
| 136 | 4 | `lastRank` |
| 140 | 20 | reservado (0) |

- Exportación JSON solo en el host (herramienta futura `tools/gsv.py dump`), con claves `id, state, bestRank, perfect, plays, clears, bestScore, lastScore, lastRank, seq`. El runtime no parsea JSON de guardado.
- Escritura: `replaceCustomSaveRotating` (propuesta de `pr6-audit.md` §4), con `<id>.gsv.tmp` y `<id>.gsv.bak`. Así no se llega al límite de 64 de `persistCustomSave` y quedan como máximo 3 ficheros por id.
- Lectura al iniciar: `<id>.gsv`; si el magic, el tamaño, el CRC o el id no son válidos → `<id>.gsv.bak`; si también falla → valores por defecto `state = 2`. Si el paquete desaparece, su `.gsv` se queda en la SD.
- Actualización al terminar, en contexto normal (post de `0x1D38A0`): `plays++`. Si el motor llegó al final: `clears++`. El rango y la puntuación salen del motor (`gRun`/`gMRun`), nunca de `setPending`. Las medallas aplican **la misma lógica** que `commitResult` (`native-save-isolation.md` §3) sobre `GsvRecord`.
- Rango: `rank`/`score` propios del motor, hasta que exista una fuente de evaluación custom. Mientras tanto, `bestRank` = 3 si se completó y 0 si se abortó [H: política por confirmar con coordinación].

## 5. Interacción con PR #6

- Se usan sus parsers, `validPrologue`, el rango de jingle y `TryLease`.
- Su `writeSave`/`writeMultiSave` (`sd:/groove/save/<name>.json`) es **otra cosa**: estadísticas de depuración por motor. El `.gsv` es el progreso por id, así que no hay conflicto de rutas.
- Su `resultsMode = 0` en Multi encaja con `results: "custom"`. Falta lo mismo en HT3/hoop para las ranuras con `adapter: hoop`.
- No se modifica su runtime. Las propuestas (rotación y registro en el log cuando `TryLease` falla) quedan para que las revise Codex.

## 6. Riesgos

- `paintCell`/`mapInfoPanel` de la col 9 en el mundo 0: el widget existe (12×5 por mundo) [V], pero su posición visual en el mundo 0 no se ha visto en pantalla [H].
- `0x1CC630` (bucle por estado con 3 filas) podría contar las casillas custom [H].
- Que una sesión termine sin pasar por `0x1D38A0` (pausa → título): el `.gsv` se escribe en el dtor del stage [H].

## 7. Plan de verificación

| Nivel | Qué | Criterio |
|---|---|---|
| Host | `gsv` codificar/decodificar, CRC, matriz de recuperación (`dest` válido/corrupto/ausente × `bak`), validación de id; réplica de `mapCell` frente a una rejilla sintética para las 180 coordenadas; asignación de ranura por coordenada | 100 % de los casos |
| ARM64 | build reproducible con los pins de PR #6; firmas de los hooks nuevos (`0x1CD4E0`, `0x48B0`, `0x4A30`, `0x4A70`, `0x1D3130`, `0x1CC420`, `0x3FB0`) | 2 builds idénticos, firmas OK |
| Unicorn | secuencia `launchA(A)` → `initGameplay` → `setPending` → `0x1D38A0` → `commitResult` → `writeSave`, con anfitrión `(1,67)` y luego `(1,41)` | staging `+0x16D0` == blob previo, salvo `+0xB98..+0xB9F` (cursor), y `rev[]` igual al nativo |
| Switch | copia de seguridad de `game_save.bin` (JKSV) → A ×3, B ×3, HT2 oficial ×1, Remix 8 oficial ×1, Orochi y HoopDX ×1 → exportar de nuevo | A/B: solo cambia su `.gsv`; partidas oficiales: cambian como en el juego sin mod |
