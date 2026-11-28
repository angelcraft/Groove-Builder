# GE-152 → GE-151: traspaso técnico (V0, dos casillas Multi en modo 0)

Para: Codex (GE-151). De: Grok (GE-152). Base: `main` 03FF4A3B. Evidencia: `v0-two-slot.md`, `unicorn-validation.md`.
**Alcance**: especificación mínima de los hooks y casos reproducibles. No se modifica `engine/` y no se publica ningún binario. **No hay que abrir la instalación en hardware hasta que GE-154 revise los bloqueos del §6.**

> **Rev 2 (revisión 7230247601)**: H0 es nuevo y cambian H1, H2, H2b, H3 (pre y post), H5, H6 y H7. La tabla de abajo ya está actualizada. Cambios, pruebas y cifras: `review-7230247601.md`. `505612e` es la base de la implementación, **no** un candidato para hardware. H9, H8, el `.gsv` y `slots.json` siguen siendo borradores (punto 4 de la revisión, Codex).

## 1. Constantes V0

| Elemento | Valor |
|---|---|
| Ranuras | A = `(0,9,0)`, B = `(0,9,1)` (mundo, col, fila; vacías `(0,13)` en la rejilla original) |
| Anfitrión `adapter: multi` | `{kind 1, idx 67}` (REMIX_21, creador 112 / caso de fábrica 108). **Es un id nativo existente; no se inventan otros.** |
| Registro | `sd:/groove/slots.json` (2 ids) + `levels/<id>/manifest.json`; fail closed (`registry_model.py`) |
| Guardado | `custom-saves/<id>.gsv` (160 B, **propuesta**) |
| Mapa | solo modo 0 (`map+0x2A38 == 0`) |
| Gestor de guardado | `mgr = 0x10A75F0`; blob `mgr+0x548` (0x1188 B); `curIdx` `mgr+0xBA0/0xBA2`; `mgr+0x2904` modo; bits de sesión en `*(mgr+0x3AA0)` |

Estado del módulo:
- `gMap` + `gMapGen`: mapa capturado y su generación.
- `gConfirmMap`.
- `gSlot[2]`.
- `gSess = {slot, id, coord, gen, stage}` o vacío.
- `gReject = {map, gen}`: dura una sola confirmación.
- `gF4Ref`: snapshot del blob.
- `gSel`: tupla `(mode, w, c, r, x)` suprimida.
- `gCustomCursor`: se consume una vez.
- `gInReverseBuild`.

Todo es acotado: H0 borra `gReject` al confirmar y al destruir el mapa, y descarta una sesión sin stage al reiniciar el mapa.

## 2. Hooks mínimos (orden de ejecución en una partida)

| # | Dirección / firma | Tipo | Condición | Comportamiento exacto |
|---|---|---|---|---|
| H0 | `Map::init 0x1CD9A0(Map*, Stage*, w)` (desde el ctor de la escena `0x371730`, mapa = escena+0x2C98); `Map::~Map 0x1CE200(Map*)` (desde el dtor de la escena `0x371AC0`); pre de `onConfirmCell 0x1D2CC0(Map*, …)`; pre de `initGameplay 0x137050` | pre | siempre | init: `gMap = x0; gMapGen++; gReject = {}`. Si `gSess` existe y no arrancó ningún stage → descartar `gSess`, `gCustomCursor` y `gF4Ref`. dtor: si `x0 == gMap` → `gMap = null; gMapGen++; gReject = {}`. confirm: `gConfirmMap = x0; gReject = {}` (al salir, `gConfirmMap = null`). initGameplay: `gSess.stage = 1` |
| H1 | `mapCell 0x1CBCA0(const Coord* c) → const int[2]*` (`c+8` mundo, `+0xC` col, `+0x10` fila) | replace | `c ∈ {A,B}` | `gInReverseBuild` **o ranura sin id** → `&kEmpty{0,13}`. Con id (válida o no) → `&gSlotCell[r]{1,67}`; si no es válida, H2 la pinta bloqueada. Otras coordenadas: aritmética original `*(GOT 0xD99768) + w·0x1E0 + c·0x28 + r·8` |
| H1b | `buildReverseMap 0x1CD4E0()` | trampolín | siempre | `gInReverseBuild = 1; orig(); gInReverseBuild = 0` |
| H2 | `cellState 0x1CC420(const Coord*) → int` | replace | `c ∈ {A,B}` | sin id → original (casilla vacía); `!enabled`, sin `gMap`, `gMap+0x2A38 ≠ 0` o `.gsv` inválido (id distinto de la ranura, estado fuera de 0..255) → `1`; si no → `clamp(gsv.state, 2, 6)` |
| H2b | `saveStateAt 0x3F70(Mgr*, kind, idx) → int` | pre | LR `== 0x1D2D68` y `gConfirmMap` con cursor en `{A,B}` | si `gConfirmMap == gMap` (vivo), la ranura tiene id y está habilitada, el modo es 0 y el `.gsv` es válido → `clamp(state, 2, 6)`; si no → `1` (bloqueada). **Nunca ≥ 7**: con ≥ 7 se abre el panel nativo de medallas (`cmp w0,#7` en `0x1D2D68`, bloque `0x1D2D70`) |
| H3 | `launchA 0x1D3130(Map*, Desc*, w2, w3)` | pre + post | cursor de **`x0`** (`+0x5274/+0x5298/+0x529C`) en `{A,B}` | **pre**: rechazar (`gReject = {x0, gMapGen}`, `return` sin original) si `x0 ≠ gMap`, si ya hay `gSess` (reentrada), si la ranura no está habilitada, si el `.gsv` es inválido, si el modo ≠ 0 o si `curIdx[0], curIdx[1]` o `mgr+0x2904` ≠ -1. Si no: `gSess = {r, id, coord, gMapGen, stage = 0}`, `gF4Ref = blob`, `before = *(mgr+0x3AA0)`, `w2 = w3 = 0`. **post**: `*p = (*p & ~0xE) \| (before & 0xE)`, es decir, solo los bits 1–3 vuelven a su valor previo (`launchA` los borra en `0x1D3184..0x1D31A8` y los pone en `0x1D31D0..0x1D32A4`; `0x131440` los lee como peticiones de guardado) |
| H4 | `beginPlay 0x48B0`, `0x4A30`, `0x4A70` | pre | `gSess` | `return` sin llamar al original (F2/F3) |
| H5 | `setSel 0x4890(Mgr*, mode, world, col, row, x)` | pre | LR `== 0x1D2ED4` y (`gSess` de esta generación **o** `gReject` de esta generación) | `return` sin escribir. Con sesión: si `mode == 0` y `(w,c,r) == gSess.coord`, entonces `gSel = (mode,w,c,r,x)` y `gCustomCursor = gSel`. Con `gReject`: consumirlo. En cualquier otro LR, o sin sesión, se llama al original |
| — | (cambio de escena; stage HT2/R21 del motor con la ranura `gSess.slot`) | — | — | el motor no llama a `setPending` (`results: custom`) |
| H6 | `getSel 0x4860(Mgr*, mode, int* w, int* c, int* r, int* x)` | post | LR `== 0x1CE040` y `gCustomCursor.mode == mode` | escribir **`*w, *c, *r, *x`** desde `gSel` (solo RAM; son los mismos valores con signo de 8 bits que habría devuelto `getSel` si `setSel` se hubiera ejecutado) y consumir `gCustomCursor` |
| H10 | `commitResult 0x1D39D0(Map*)` (cola desde `0x1D38A0`) | pre | `gSess` | `return`. Con `pending < 0` solo ejecuta la caducidad de Perfect Campaign (V9 y V18 lo demuestran); se aplicará en la siguiente vuelta nativa |
| H9 | post de `mapEnterFromStage 0x1D38A0(Map*)` | post | `gSess` | **BORRADOR (punto 4, Codex)**: guardar por id inmutable y solo con un resultado confirmado; cerrar la sesión tras la quiescencia y antes de la siguiente sesión nativa; errores de E/S. El harness solo modela `RM.finish` |
| H8 | `writeSave 0x3D60(Mgr*, w1)` | pre | `gF4Ref` | **solo detector**: compara con `gF4Ref` byte a byte, excluyendo `+0x560..+0x563`. No bloquea ni suprime escrituras globales |
| H7 | llamada `bl 0x2CC0` en `0x206A54` (dentro de `X::0x2068D0`) | wrapper del sitio | `gSess ∧ idx < 0` | pasar el id del anfitrión ya fijado (`67`) solo como argumento. Tripwire en ese sitio y en el ctor de X `0x2064A0` mientras haya `gSess`. **No interceptar `0x2E90` globalmente, no escribir `curIdx` y no inventar identidad.** Otro llamador (`0x1D1878`) o `0x2E90` directo: sin cambios |

**Qué no hacer:**
- Escribir `curIdx`, `mgr+0x2904` o `pending`.
- Llamar a `setPending` o `beginPlay`.
- Elegir la ranura por `(kind,idx)` en vez de por coordenada o `gSess`.
- Escribir `kGrid` (IPS) o `sel` con coordenadas custom.
- Soportar el modo 1.
- "Arreglar" la telemetría `0x7950/0x7F00/0x8180/0x8400/0x87A0` con IDs inventados. Con `curIdx = -1` omite los campos del juego: **es una limitación aceptada**.
- Liberar recursos ligados al stage dentro de su dtor antes de la quiescencia (§4).
- Tocar el stage o `gRun` después de `tStop`.

## 3. Casos reproducibles (Unicorn)

Desde `reports/GE-152/unicorn/`, con `IMG=<ruta local al main descomprimido>` (no se publica) y Python con `unicorn` 2.x:

| Comando | Criterio de éxito |
|---|---|
| `python exp_v0.py $IMG results/v0_results.json` | `exit 0`, `FAILURES: 0`. 28 `PASS` (V1–V18, V12, N1–N5, 5 unitarias); `SELFTEST` 6/6 detectadas. Las aserciones: lanzamiento sí/no, número de puntos, bytes completos solo con `saveCount` distinto, `.gsv` A/B exactos, 0 rutas de medallas, estado acotado vacío, cursor `(w,c,r,x)` |
| `python exp_b2.py $IMG results/b2_results.json` | `exit 0`, `FAILURES: 0`. 36 escenarios sin automap ni acceso a la página nula; todos los hilos de la lista liberados (HT2 2/2, R21 22/22); barrera quiescente antes del dtor; control positivo HT2 = 28; `SELFTEST` 2/2 |
| `python exp_reach.py $IMG results/reach_results.json` | `exit 0`. `reaches == []` para R21, HT2, el mapa y la escena del mapa; control positivo fábrica[16] → ctor de X |
| `python exp_a.py / exp_c.py / exp_c2.py` (entrega anterior) | Mismos resultados que en `unicorn-validation.md` |

Cuando Codex implemente los hooks en C++, el equivalente es reproducir V1–V18 y N1–N5 con el módulo real en el harness de v0.5 (o en `emu_v050`) y exigir los mismos criterios byte a byte.

## 4. Barrera de vida útil del Runner (diseño)

Hecho medido [U-modelo]: el dtor del stage **no** hace join; los hijos siguen vivos y bloqueados hasta `step`, `reap` o `clear`. Que `tStop` sea verdadero **no** implica que el hilo haya terminado. Una continuación que corra con el stage liberado lo escribe (control positivo HT2, 28 accesos).

En el pre del dtor del stage anfitrión (HT2 `0x4290F0`, R21 `0x4207F0`), **antes** de liberar cualquier recurso del motor (forma ejecutada en `exp_b2.py::barrier`):
0. **No llamarla desde un hijo**: sería un self-join. **No sostener locks** que puedan necesitar los hijos.
1. **Cancelar y publicar**: `gRun.cancel = 1` con store-release. Recorrer la lista del Runner (`runner+8`, enlace `th+8`) y, para cada hilo con `th+0x254 == *(stage+0x2988)`, si `th+0x250 ∈ {0,1}` → `2`. Esto incluye los subhilos que **nunca arrancaron**: R21 añade 20 en su primer tick mediante `0x421340`, con el soporte `stage+0x3548` (runner `+0x3550`, gid `+0x3560`).
2. **Señalizar a todos**: `0x4DFC70(th+0x220)`, antes de esperar a ninguno.
3. **Join de cada uno**: `0x4DFB60(th+0x28)`, idempotente porque pone `+0x1C8 = 0`. Un hilo que no arrancó y está en estado 2 cuenta como quiescente.
4. **Punto fijo**: repetir 1–3 si aparecen hijos nuevos (máximo 8 rondas).
5. **Sin quiescencia, no hay dtor ni free.** El stage queda vivo y se informa. **Nunca timeout seguido de free.**
6. Solo con quiescencia: liberar timeline, buffers y `gRun`, y llamar al dtor original. El `reap`/`clear` libera los objetos hilo (HT2 2/2, R21 22/22).

Con estado 2, `wait 0x514D70` ya no bloquea. Los cuerpos del motor tienen que salir con trabajo acotado (`tStop → tPop → return`).

**No demostrado** (punto 2 de la revisión, para el módulo):
- semántica del scheduler de Horizon (`sched.py` es cooperativo);
- sincronización de la lista frente a appends concurrentes;
- visibilidad de la cancelación entre núcleos;
- worker real del módulo.

## 5. `0x2E90` con `curIdx = -1`

La llamada sin comprobación está en `0x2068D0`, no en `0x2067B0` (ese es un thunk de destructor). Pertenece a la clase X (`scene_perfect`), que se construye solo dentro del stage del caso de fábrica 16. **No es alcanzable por llamadas directas** desde HT2, R21, el mapa ni la escena del mapa [S]. Los sitios indirectos no se resuelven (se cuentan en `reach_results.json`). H7 actúa solo en el sitio `0x206A54` y deja tripwires.

## 6. Bloqueos abiertos y fuera de alcance

- **Bloqueos**:
  1. Confirmar en ejecución que una sesión Multi no crea el stage del caso 16.
  2. Barrera §4 con los cuerpos reales del motor y la semántica de Horizon.
  2b. Punto 4 de la revisión: H9 con resultado confirmado e id inmutable, cierre de la sesión tras la quiescencia, errores de E/S, pila transitiva, retirada de la IPS antigua, visibilidad de la col 9 y guards de build-ID. El `.gsv` y `slots.json` siguen siendo borradores.
  3. Captura y destrucción del mapa (H0) en el módulo real. En el harness solo hay [S] + modelo de vida.
  4. Cuadro visual y panel de la col 9 del mundo 0.
  5. Revisión de GE-154.
- **Fuera de alcance (V0)**: modo 1, más de 2 ranuras, adaptador hoop, telemetría, medallas custom en el panel nativo, hardware.
