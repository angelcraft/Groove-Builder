# GE-152 — V0: dos casillas Multi en modo 0 (validación en Unicorn)

- **Agente**: Grok (GE-152) · **Rama**: `grok/dynamic-stage-research` (base de esta entrega: `f851eca`)
- **Instrucciones**: PR #5, comentario 7229942917 (GE-154)
- **Estado**: V0 validada **solo en el harness de Unicorn**. Ningún hook en `engine/`; ninguna prueba en Switch. El `.gsv` sigue siendo propuesta.
- **Especificación para Codex**: `CODEX_HANDOFF.md`.
- **Rev 2 (revisión 7230247601)**: este documento describe la entrega `505612e`. Las aserciones nuevas (bytes completos, lista de bytes permitidos exacta, `exit ≠ 0`, autopruebas), los cambios de H0–H7, las trazas de automap y página nula y los 20 subhilos de R21 están en `review-7230247601.md`. Donde no coincidan, vale ese documento.

## 0. Niveles de evidencia

| Nivel | Significado |
|---|---|
| **[U]** | Código real de `main` 03FF4A3B en Unicorn (imagen sin la IPS); resultado medido |
| **[U-modelo]** | Igual, pero con un elemento modelado por el harness (indicado) |
| **[S]** | Estático (desensamblado / grafo de llamadas directas) |
| **[H]** | Modelo Python sin código del juego |
| **[I]** | Inferido, no medido |

Hooks V0 = `unicorn/v0.py` (Python, **solo harness**), forma ejecutable de H1–H10 de `CODEX_HANDOFF.md`.

## 1. Flujo ejecutado por caso [U]

Por cada partida: `onConfirmCell 0x1D2CC0` real (bloqueo, despacho kind1, `launchA` real, `setSel`) → `initGameplay 0x137050` real → resultados: nativos con el `setPending 0x4910` real; custom con un resultado del motor **modelado** que solo va al `.gsv` → `mapEnterFromStage 0x1D38A0` real (→ `commitResult 0x1D39D0`) → H9 → reinicio del mapa con el `getSel 0x4860` real (sitio `0x1CE03C`) + H6 → refresco `0x1D3CA0` → `0x131440` → `writeSave 0x3D60`.
**Puntos de escritura** comparados byte a byte (0x1188 B) con el blob inicial del caso: la entrada de cada `writeSave` y cada staging asíncrono (`0xB470`). (Rev 1: un byte distinto se aceptaba si su único escritor estaba dentro de `writeSave`. **Rev 2**: se comparan los bytes completos con una lista de bytes permitidos exacta, solo `hdr.saveCount`. Ver `review-7230247601.md`.)

## 2. Resultados

| Caso | Puntos de escritura | Bytes distintos fuera de `writeSave` | Resultado |
|---|---|---|---|
| V1 A `(0,9,0)` completada | 2 | 0 (`hdr.saveCount` 0→1) | **PASA** |
| V2 B `(0,9,1)` completada | 2 | 0 | **PASA** |
| V3 A → B (abortada) → A | 6 | 0 | **PASA**; `.gsv` A `plays 2, clears 2, best 5/99`; B `plays 1, clears 0` |
| V4 abort A → abort A → A | 6 | 0 | **PASA**; `.gsv` A `plays 3, clears 1` |
| V5 anfitrión estado 7, `perfect=2` | 2 | 0 | **PASA** (antes de H2b el harness caía en la ruta de medallas; ver §3.2) |
| V6 Perfect Campaign objetivo 50 | 2 | 0 | **PASA** |
| V7 objetivo 67 (= anfitrión) | 2 | 0 | **PASA** |
| V8 sin objetivo, resto en estado 6 | 2 | 0 | **PASA** |
| V9 objetivo 50, `cntBB4=5` (caducidad) | 2 | 0 | **PASA** (H10 evita la escritura de `target` que antes solo detectaba F4) |
| V10 mapa en modo 1, confirmar A | **0** | 0 | **PASA**: H2 → estado 1 → bloqueo, sin `launchA` ni escrituras |
| V11 instalación parcial: B desactivada | 2 | 0 | **PASA**: B bloqueada; A funciona |
| V12 A y luego Remix 8 nativo | 4 | (nativos esperados) | **PASA**: el diff de la partida nativa es idéntico al de una partida nativa limpia; `sel.col/row` se escriben con la casilla nativa |
| N1 Remix 8 nativo, rango 4 (V0 instalada / no instalada) | 2 | — | **PASA**: idéntico byte a byte en cada punto |
| N2 HT2 nativo, rango 5 | 2 | — | **PASA** (idéntico) |
| N3 Remix 8 nativo, salida | 2 | — | **PASA** (idéntico) |
| N4 Remix 8 nativo con Perfect Campaign | 2 | — | **PASA** (idéntico) |
| N5 Remix 8 nativo en modo 1 | 2 | — | **PASA** (idéntico) |
| H7 `0x2E90(1,-1)` con sesión | — | — | **PASA**: ranura 73 (= anfitrión 67) en vez de 0; `curIdx` sigue en -1 |
| H1b mapa inverso con V0 | — | — | **PASA**: 2448 B idénticos a la imagen original |

En los casos custom: `curIdx = [-1,-1]`, `mgr+0x2904 = -1` al terminar, F4 con 0 bytes distintos en cada `writeSave`, y cursor visual `(0,9,r)` tras volver (H6) **sin** que `sel` cambie en el blob.

## 3. Hallazgos nuevos

### 3.1 `0x2067B0` era una atribución errónea [S, corregido]
`0xD1FFB8 → 0x2067B0` es un *thunk* de destructor (ajuste `-0x2978`). La llamada `0x2CC0(1, curIdx)` está en `0x2068D0` (slot `0xD1FF80`) de la clase X: ctor `0x2064A0`, vtable vía GOT `0xD99D58`, recurso `scene_perfect.msbt`.
- **Alcanzabilidad desde custom: no por llamadas directas** [S]. X solo se construye en `0x398D08`, dentro del ctor `0x398C80`, que es el caso 16 de la fábrica de stages `0x488940`. Los anfitriones son HT2 = caso 67 (`0x428D70`) y REMIX_21 = caso 108 (`0x4202C0`). El cierre de llamadas directas desde R21 (1192 funciones), desde HT2 y desde confirmar/lanzar/volver no alcanza `0x2CC0`, `0x2E90`, X, el caso 16 ni la fábrica (`unicorn/exp_reach.py`).
- **Límite**: no se siguen las llamadas indirectas (`blr`), y no se ha comprobado en ejecución que una sesión Multi no cree el stage 16. Por eso H7 queda como guard **defensivo** (contexto local, sin tocar `curIdx`) y validado [U].
- El otro llamador de `0x2CC0` (`0x1D1878`, aviso de desbloqueo del mapa) no usa `curIdx`.

### 3.2 La confirmación custom leía el estado nativo del anfitrión [U]
`onConfirmCell` lee `saveStateAt 0x3F70(mgr,1,67)` en `0x1D2D64`. Si es ≥ 7, abre la ruta de medallas (`map+0x6D68`). Una casilla custom heredaba así la interfaz según el progreso nativo del Remix 8. H2b devuelve el estado de la ranura en ese sitio de llamada (LR `0x1D2D68`).

### 3.3 `commitResult` con `pending < 0` [S+U]
Con `pending < 0`, `commitResult` solo ejecuta la caducidad de Perfect Campaign (`0x49C0/0x4A20/0x6400`) y sale en `0x1D3C8C`. H10 lo salta durante la sesión. La caducidad se aplica en la siguiente vuelta nativa, como ya ocurría.

## 4. Runner [U-modelo]

`unicorn/sched.py` es un planificador cooperativo: los hilos y eventos de nn::os se modelan con cambio de contexto en una sola CPU de Unicorn. Todo el código del juego es real: Runner, hilos, workers HT2 `0x428EF0` y R21 `0x420720`, y corrutinas anidadas `0x1398B0`, `0x429330`, `0x42B740`, `0x1367F0` y `0x421340`. Los imports de nn::os se modelan (Create/Start/Wait/Destroy thread; Init/Signal/Wait/Finalize event, con autoborrado inferido del protocolo ping-pong). El join es **real en el modelo**: el hilo que hace join se bloquea, el hijo ejecuta su continuación y termina, y solo entonces el join devuelve.
`unicorn/exp_b2.py`: 2 anfitriones × 6 desmontajes × 3 puntos de parada (1, 3 y 6 ticks), con 2 hijos:

| Desmontaje | Estado de los hijos tras el dtor del stage | Accesos tardíos | Hijos liberados |
|---|---|---|---|
| reap | vivos, bloqueados en su evento | 0 | 2 |
| clear | vivos, bloqueados | 0 | 2 |
| step + reap | vivos, bloqueados | 0 | 2 |
| **barrera** (cancelar + join antes del dtor) | **terminados** | 0 | 2 |
| solo `tStop` (estado 2, sin join) | `tStop = 1`, pero **vivos y bloqueados** | 0 | 2 (tras reap) |
| **control positivo**: despertar con estado 1 después del free | — | **HT2: 28** (`W +0x6831` en `0x4290E8`, `R +0x29D8` en `0x1370C8`, …) · R21: 0 | 2 |

- Secuencia medida en reap/clear: `join(T) → T sale → join devuelve`, para cada hijo.
- **tStop ≠ join** [U-modelo]: tras `tStop = 1` los hilos siguen vivos hasta `step`, `reap` o `clear`.
- El control positivo demuestra que el detector funciona y que el riesgo es real: una continuación que corre con el stage liberado lo escribe. En R21 el harness no avanza lo bastante, porque los bucles de las corrutinas dependen de stubs que devuelven 0.
- Límites (rev 1, **corregidos en rev 2**: ya no hay página cero ni automap y R21 tiene 22 hilos; ver `review-7230247601.md` §2): el stage era sintético (los subobjetos nulos se leían de una página cero; HT2 mapeó 1 página bajo demanda); el scheduler y el orden del gestor de escenas no son los reales; no se ejecutan los cuerpos del motor de GE-151.
- Diseño de la barrera: `CODEX_HANDOFF.md` §4.

## 5. Bloqueos abiertos (antes de hardware)

1. Confirmar en ejecución que una sesión Multi nunca construye el stage del caso 16 (o mantener H7).
2. El modo 1 está bloqueado (H2). No se ha diseñado su soporte.
3. Barrera del Runner sobre los cuerpos reales del motor (GE-151): no está ejecutada.
4. La telemetría `0x7950/0x7F00/0x8180/0x8400/0x87A0` omite los campos del juego cuando `curIdx = -1`. **Es una limitación aceptada y explícita**, sin IDs nativos inventados.
5. Visual de la columna 9 del mundo 0, panel y título: sin verificar en pantalla.
6. Revisión de GE-154 antes de abrir la instalación en hardware.
