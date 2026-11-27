# GE-152 → GE-151: traspaso técnico (V0, dos casillas Multi en modo 0)

Para: Codex (GE-151). De: Grok (GE-152). Base: `main` 03FF4A3B. Evidencia: `v0-two-slot.md`, `unicorn-validation.md`.
**Alcance**: especificación mínima de los hooks y casos reproducibles. No se modifica `engine/` y no se publica ningún binario. **No hay que abrir la instalación en hardware hasta que GE-154 revise los bloqueos del §6.**

## 1. Constantes V0

| Elemento | Valor |
|---|---|
| Ranuras | A = `(0,9,0)`, B = `(0,9,1)` (mundo, col, fila; vacías `(0,13)` en la rejilla original) |
| Anfitrión `adapter: multi` | `{kind 1, idx 67}` (REMIX_21, creador 112 / caso de fábrica 108). **Es un id nativo existente; no se inventan otros.** |
| Registro | `sd:/groove/slots.json` (2 ids) + `levels/<id>/manifest.json`; fail closed (`registry_model.py`) |
| Guardado | `custom-saves/<id>.gsv` (160 B, **propuesta**) |
| Mapa | solo modo 0 (`map+0x2A38 == 0`) |
| Gestor de guardado | `mgr = 0x10A75F0`; blob `mgr+0x548` (0x1188 B); `curIdx` `mgr+0xBA0/0xBA2`; `mgr+0x2904` modo; bits de sesión en `*(mgr+0x3AA0)` |

Estado del módulo: `gSlot[2]`, `gSess = {slot, coord}` o vacío, `gReject`, `gF4Ref` (snapshot del blob), `gCustomCursor`, `gInReverseBuild`.

## 2. Hooks mínimos (orden de ejecución en una partida)

| # | Dirección / firma | Tipo | Condición | Comportamiento exacto |
|---|---|---|---|---|
| H1 | `mapCell 0x1CBCA0(const Coord* c) → const int[2]*` (`c+8` mundo, `+0xC` col, `+0x10` fila) | replace | `c ∈ {A,B}` | `gInReverseBuild ? &kEmpty{0,13} : &gSlotCell[r]{1,67}`. Para otras coordenadas, la aritmética original: `*(GOT 0xD99768) + w·0x1E0 + c·0x28 + r·8`. Una ranura con id en `slots.json` pero inválida también devuelve `{1,67}` (se pinta bloqueada); sin id → `kEmpty` |
| H1b | `buildReverseMap 0x1CD4E0()` | trampolín | siempre | `gInReverseBuild = 1; orig(); gInReverseBuild = 0` |
| H2 | `cellState 0x1CC420(const Coord*) → int` | replace | `c ∈ {A,B}` | `!enabled → 1`; modo del mapa `≠ 0` (o desconocido) → `1`; si no, `max(2, gsv.state)`. **Es el bloqueo F0 y el rechazo del modo 1 antes de cualquier escritura.** Modo: `map+0x2A38` del mapa activo (se captura en `0x1CF490`, cuyo `x0` es el mapa; si no hay mapa capturado → 1) |
| H2b | `saveStateAt 0x3F70(Mgr*, kind, idx) → int` | pre | LR `== 0x1D2D68` (sitio `0x1D2D64` de `onConfirmCell`) y cursor del mapa en `{A,B}` | devolver `max(2, gsv.state)` del slot. Sin esto, el estado ≥ 7 del anfitrión abre la ruta de medallas (`map+0x6D68`) |
| H3 | `launchA 0x1D3130(Map*, Desc*, w2, w3)` | pre + post | cursor (`map+0x5274/+0x5298/+0x529C`) en `{A,B}` | **pre**: exigir `enabled ∧ modo 0 ∧ curIdx[0] == curIdx[1] == -1 ∧ mgr+0x2904 == -1`. Si se cumple: `gSess = {r, coord}`, `gF4Ref = blob`, `gCustomCursor = (0, coord)` y `w2 = w3 = 0`. Si no (no debería pasar por H2): `gReject = 1`, `return` sin llamar al original. **post**: `*(mgr+0x3AA0) &= ~0xE` |
| H4 | `beginPlay 0x48B0`, `0x4A30`, `0x4A70` | pre | `gSess` | `return` sin llamar al original (F2/F3) |
| H5 | `setSel 0x4890(Mgr*, mode, world, col, row, x)` | pre | (`gSess` o `gReject`) **y** LR `== 0x1D2ED4` | `return` sin escribir (la coordenada custom nunca llega al blob, así que tampoco a ningún staging); `gReject = 0`. **En cualquier otro LR, o sin sesión, se llama al original** (selección nativa intacta) |
| — | (cambio de escena, stage HT2/R21 del motor, con la ranura `gSess.slot`) | — | — | el motor no llama a `setPending` (`results: custom`) |
| H10 | `commitResult 0x1D39D0(Map*)` (cola desde `0x1D38A0`) | pre | `gSess` | `return`. Con `pending < 0` solo ejecuta la caducidad de Perfect Campaign; se aplicará en la siguiente vuelta nativa |
| H9 | post de `mapEnterFromStage 0x1D38A0(Map*)` | post | `gSess` | actualizar `gSlot[r].gsv` (plays, clears, rank/score del motor) → `replaceCustomSaveRotating`; `gSess = {}` |
| H6 | `getSel 0x4860(Mgr*, mode, int* w, int* c, int* r, int* x)` | post | LR `== 0x1CE040` (inicio del mapa) y `gCustomCursor.mode == mode` | sobrescribir `*w, *c, *r` con la coordenada custom (**solo RAM**) y consumir `gCustomCursor` |
| H8 | `writeSave 0x3D60(Mgr*, w1)` | pre | `gF4Ref` | comparar el blob con `gF4Ref` byte a byte, excluyendo `+0x560..+0x563` (`hdr.saveCount`). Si hay diferencias → línea en el log (V0: solo se detecta, no se bloquea). Se cierra en el primer `writeSave` posterior a H9 |
| H7 | `0x2E90(kind, idx)` | pre | `gSess ∧ kind == 1 ∧ idx < 0` | `idx = 67` (anfitrión) solo en el argumento local. **No escribir `curIdx`.** Es defensivo: estáticamente no se alcanza desde HT2, R21 ni el mapa (§5) |

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
| `python exp_v0.py $IMG results/v0_results.json` | 17 líneas `PASS` y 0 `FAIL`. V1–V11: `non_writeSave_diffs == []` en todos los puntos (solo `hdr.saveCount`). V10: 0 puntos de escritura y `F0 mode1-reject`. N1–N5: `identical_with_and_without_V0 == true`. V12: `native_after_custom_equals_clean_native == true`. `H7_0x2E90.session_idx-1_slot == 73`. `H1b_reverse_map.bytes_different == 0` |
| `python exp_b2.py $IMG results/b2_results.json` | 36 escenarios sin error. `late_stage_access == 0` en reap/clear/step/barrera/solo-tStop. Barrera: hijos `done` antes del dtor. Solo-tStop: `tStop_true == [1,1]` con hijos `blocked`. Control positivo HT2: `late_stage_access > 0` |
| `python exp_reach.py $IMG results/reach_results.json` | `callers_X_ctor == ['0x398d08']`; `factory_cases == {16: 0x398c80, 67: 0x428d70, 108: 0x4202c0}`; `reaches == []` para los tres cierres |
| `python exp_a.py / exp_c.py / exp_c2.py` (entrega anterior) | Mismos resultados que en `unicorn-validation.md` |

Cuando Codex implemente los hooks en C++, el equivalente es reproducir V1–V12 y N1–N5 con el módulo real en el harness de v0.5 (o en `emu_v050`) y exigir los mismos criterios byte a byte.

## 4. Barrera de vida útil del Runner (diseño)

Hecho medido [U-modelo]: el dtor del stage **no** hace join; los hijos siguen vivos y bloqueados hasta `step`, `reap` o `clear`. Que `tStop` sea verdadero **no** implica que el hilo haya terminado. Una continuación que corra con el stage liberado lo escribe (control positivo HT2, 28 accesos).

En el pre del dtor del stage anfitrión (HT2 `0x4290F0`, R21 `0x4207F0`), **antes** de liberar cualquier recurso del motor:
1. **Cancelar**: marcar `gRun.cancel = 1` (el motor lo comprueba tras cada espera). Para cada hijo de la lista del Runner (`runner+8`, hilos con `th+0x254 == *(stage+0x2988)`): si `th+0x250 == 1` → `th+0x250 = 2`.
2. **Despertar**: `0x4DFC70(th+0x220)` (signal).
3. **Quiescencia**: `0x4DFB60(th+0x28)` (join; idempotente porque pone `+0x1C8 = 0`). Hay que esperar a todos. Con estado 2, `wait 0x514D70` ya no bloquea, así que un cuerpo que no compruebe `tStop` **daría vueltas sin fin**: los cuerpos del motor deben salir con trabajo acotado (patrón nativo `tStop → tPop → return`).
4. Solo después: liberar timeline, buffers y `gRun`, y llamar al dtor original. El `reap`/`clear` posterior encuentra el estado 2 y `+0x1C8 = 0`, y libera el objeto hilo sin volver a hacer join.

Precondición: la barrera debe ejecutarse en un hilo que no sea uno de esos hijos (el dtor lo llama el gestor de escenas). No se ha verificado en hardware ni con los cuerpos reales del motor.

## 5. `0x2E90` con `curIdx = -1`

La llamada sin comprobación está en `0x2068D0`, no en `0x2067B0` (ese es un thunk de destructor). Pertenece a la clase X (`scene_perfect`), que se construye solo dentro del stage del caso de fábrica 16. **No es alcanzable por llamadas directas** desde HT2, R21 ni el mapa [S]. H7 cubre el caso indirecto restante sin tocar el estado global.

## 6. Bloqueos abiertos y fuera de alcance

- **Bloqueos**:
  1. Confirmar en ejecución que una sesión Multi no crea el stage del caso 16.
  2. Barrera §4 con los cuerpos reales del motor.
  3. Captura del mapa activo para H2 y H2b en el módulo.
  4. Cuadro visual y panel de la col 9 del mundo 0.
  5. Revisión de GE-154.
- **Fuera de alcance (V0)**: modo 1, más de 2 ranuras, adaptador hoop, telemetría, medallas custom en el panel nativo, hardware.
