# GE-152 — Validación en Unicorn (aislamiento de progreso, Runner, dos casillas)

- **Agente**: Grok (GE-152)
- **Tarea**: pruebas pedidas en <https://github.com/angelcraft/Groove-Builder/pull/5#issuecomment-7229540839>
- **Rama**: `grok/dynamic-stage-research` (base de esta entrega: `8e11d7b`)
- **Ramas no tocadas**: `main` `97cee31`, `work/groove-engine-v0.5.0` `6187390`, `codex/engine-v0.5.1-hardening` `9b56aab` (solo lectura), `editor/`, `engine/`
- **PR**: #5 (borrador; se mantiene en borrador)
- **Estado**: pruebas ejecutadas en Unicorn. **Ningún hook en `engine/`.** El `.gsv` de 160 B sigue siendo una **propuesta**, no un contrato congelado.

## 0. Niveles de evidencia y método

| Nivel | Qué significa aquí |
|---|---|
| **[U]** Unicorn | Código ARM64 real de `main` `03FF4A3B` ejecutado en Unicorn (imagen original, **sin** la IPS). Resultado medido. |
| **[U-stub]** | Igual, pero el resultado depende de un stub del harness (indicado en cada caso). |
| **[H]** host | Modelo Python sin código del juego (registro, `.gsv`). |
| **[S]** estático | Desensamblado (Capstone). |
| **[I]** inferido | Conclusión no medida. |
| **Switch** | **No se ha ejecutado nada en hardware.** |

- Imagen: el `main` privado, cargado desde una ruta local que se pasa como argumento. No se publica.
- Harness (`unicorn/harness.py`, `unicorn/common.py`): solo contiene direcciones/offsets. Ejecuta como **código real** las funciones listadas en `common.setup()` y en cada `exp_*.py`; todo `BL` a una función no listada es un **stub "unlisted" que devuelve 0** y queda contado. Las importaciones PLT (nn::os) son stubs que devuelven 0, salvo `memcpy/memmove/memset`, que se emulan.
- Hooks F0–F4 **solo en el harness** (handlers `pre[...]` de Python), no en `engine/`.
- Comandos (desde `reports/GE-152/unicorn/`, `IMG=<ruta local a main descomprimido>`):

```sh
python exp_a.py      $IMG results/a_results.json > results/a_results.txt   # (A) 27 casos
python exp_curidx.py $IMG results/curidx_results.json                      # (A) consumidores de curIdx
python exp_b.py      $IMG results/b_results.json                           # (B) 10 secuencias de teardown + 5 paradas de worker
python exp_c.py      $IMG results/c_results.json                           # (C) mapa inverso (5 configs) + 5 confirmaciones
python exp_c2.py     $IMG results/c2_results.json                          # (C) 9 casos de instalación parcial + .gsv
```

Los resultados (`unicorn/results/`) contienen solo diffs por campo, contadores y direcciones; no hay volcados.

Convención de los diffs: offset relativo al blob de guardado (`mgr+0x548`), campo, antes → después, y PC del escritor (offset en `main`). `hdr.saveCount` (`+0x560`, escrito por `0x3D7C`) se excluye cuando se habla de "cero cambios": es el contador de escrituras de cualquier guardado. "staging" = la copia que `writeSave 0x3D60` envía a la escritura asíncrona (`0xB470`, stub).

## 1. (A) Aislamiento del progreso nativo

Ruta ejecutada (todo real salvo lo indicado): `onConfirmCell 0x1D2CC0` **o** `launchA 0x1D3130` → `initGameplay 0x137050(stage,0)` → resultados opcionales vía el `setPending 0x4910(mgr, rank, score)` real (**el rango/puntuación de la partida son un modelo**: no se ejecuta un stage) → `mapEnterFromStage 0x1D38A0` (→ `commitResult 0x1D39D0`) → refresco `0x1D3CA0` → `0x131440` → `writeSave 0x3D60(mgr,1)`.

### 1.1 Comportamiento nativo actual [U]

| Caso | Diffs del blob (escritor) |
|---|---|
| N1 Remix 8 `(0,8,4)`, rango 4 | `+0x9DC kind1[67].best 0→64` (`0x47E4`, commit); `+0x9E0 kind1[67].plays 0→1` (`0x48E4`, launchA→beginPlay); `+0xBA4 pending.rank 0→4`, `+0xBA8 pending.score 0→85` (`0x492C/0x4930`) |
| N2 HT2 `(1,1,0)`, rango 5 | `+0x83C kind1[41].best 0→75`, `+0x840 plays 0→1`, pending 5/100 |
| N3 Remix 8 salida/abandono | `plays 0→1` (`0x48E4`), `pending.rank 0→1` (`0x492C`, el valor que deja `initGameplay`) |
| N4 Remix 8, guards cargados pero inactivos | idéntico a N1 (los guards no afectan a partidas oficiales) |
| N5 Remix 8 desde estado 2 | además `state 2→3` (`0x4054`, refresco `0x1D3D40`) |
| C1 custom con la IPS `(1,9,4)`, salida, sin guards | `kind1[67].plays 0→1`, `pending.rank 1` → **contamina el anfitrión** |
| C1p ídem, anfitrión estado 7, `perfect=2`, flags `(1,0)` | además `perfect 2→0` (`0x484C`, commit); bits de sesión `0x2`; guardado extra desde `0x131440` (2 escrituras asíncronas) |
| C1s ídem, anfitrión estado 2 | `plays` y `pending` |

### 1.2 Con F0–F4 en el harness [U]

F1 = pre de `launchA` (coordenada custom + `curIdx == -1` → `w2=w3=0`, marca la sesión); F2 = saltar `0x48B0`; F3 = saltar `0x4A30/0x4A70`; F4 = CRC del staging frente al blob inicial en `writeSave`.

| Caso | Resultado |
|---|---|
| C2 `(0,9,0)` salida (anfitrión R21) | staging == B0; F4 `crc_equal=True`; `curIdx` sigue en -1 |
| C2p estado 7, `perfect=2`, flags (1,0) | staging == B0 (no hay reset de `perfect`, no hay guardado extra) |
| C2s anfitrión estado 2 | staging == B0 (el refresco no promociona a 3: `pending < 0`) |
| C2h anfitrión HT2 (adaptador hoop) | staging == B0 |
| PC-C2 Perfect Campaign, objetivo 50 | staging == B0 (`cntBB4` sin cambios) |
| PCH-C2 objetivo 67 = anfitrión | staging == B0 (no se marcan bits 1–2, `remaining` sin cambios) |
| PC0-C2 sin objetivo, resto en estado 6 | staging == B0 (`cntBB3` sin cambios) |
| PC4-C2 sintético `cntBB4=5` | commit escribe `target 50→0xFFFF` (`0x49C4`); **F4 lo detecta** (`crc_equal=False`) |

Perfect Campaign sin guards (referencia) [U]: PC-N/PC-C1 `cntBB4 1→2` (`0x4A80`); PCH-C1 bits de sesión `0x6` y `remaining 3→2` (`0x49FC`, desde `0x131440`); PC0-N/PC0-C1 `cntBB3 0→1` (`0x4A40`).

### 1.3 Frontera F0 y paquete inválido [U] + [H]

| Caso | Resultado |
|---|---|
| F0: `cellState 0x1CC420 → 1` (forzado en el harness) | `launchA` **no se alcanza**; SE de bloqueo `0x4EE970`; `tPop`; blob sin cambios |
| F0 control: estado 4, sin guards | `launchA` alcanzado; `plays 0→1`, `curIdx -1→67`, `sel.col 1→9`, `sel.x 1→0` |
| F0 + F1–F3 | quedan **solo** `sel.col[0] 1→9` y `sel.x[0] 1→0` (ver 1.5-c) |
| Instalación parcial (9 casos, §3.3) | todo paquete inválido → `enabled=false` → estado ≤ 1 → misma ruta F0: `launchA` no alcanzado, blob sin cambios |

### 1.4 `curIdx = -1`: verificación por ruta

Lectores de `curIdx` (`+0xBA0/0xBA2`) encontrados con un barrido de cargas `#0xba0..#0xba8` [S]:

| Lector | Uso | ¿Seguro con -1? |
|---|---|---|
| `setPending 0x4910` | sale si `curIdx < 0` | **Sí** [U: C2 no escribe pending] |
| `getPending 0x4940` → `0x1D38A0` | `map+0x5278 = -1`; no llama a `clearPending`; en modo 0 va a commit (que no escribe nada con -1) | **Sí en modo 0** [U]; **no en modo 1** (1.5-a) |
| `0x4970` → informes `0x7950/0x7F00/0x8180/0x8400/0x87A0` | cada uno tiene `tbnz w0,#31` y omite los campos del juego | Sin crash [S], pero **cambia el contenido de la telemetría** de la partida (no se envían campos de juego) [S] |
| `0x4980` → `0x2064A0` | comprueba el signo antes de `setPending(5,…)` | **Sí** [S] |
| `0x4980` → `0x2067B0` (vtable `0xD1FFB8`) → `0x2CC0(1, curIdx)` → `0x2E90` | **sin comprobación** | **No**: ver 1.5-b [U] |

`0x4980` devuelve -1 en modo 0, 1 y -1 cuando `curIdx = -1` [U].

### 1.5 Contradicciones con el análisis estático previo

- **(a) Modo de mapa 1** (`map+0x2A38 = 1`) [U]: saltar `beginPlay` hace que `0x1D38A0` tome la rama "sin juego pendiente" y **resetee el cursor** (col/row/scroll → 0) y llame a `setSel(mgr,1,world,0,0,0)`: `+0xB99 sel.world[1] 2→0` (`0x4894`, vía `0x1D39CC`), que sí llega al staging. `native-save-isolation.md` lo daba por seguro. Con el bit 0 de `0x10B8C10` a 1 (caso M1b), la rama se salta: cursor `col=9` y staging == B0. Ese byte solo lo escribe el init del mapa en `0x1CE01C`, condicionado al bit 3 de `*(mgr+0x3AB8)` (= `blob+0x115C`) [S]. **No recomiendo usar ese flag**: su semántica no está confirmada. Mitigación propuesta [I]: en el post de `0x1D38A0`, para sesiones custom en modo 1, restaurar col/row/scroll y `sel` a la casilla custom (o rechazar F1 en modo 1). Además, en modo 1 nativo (M1-N) `launchA` escribe `plays` en `blob+0xCC4` (`0x48F8`, registro kind2): F2 también lo cubre.
- **(b) `0x2067B0` con `curIdx = -1`** [U]: `0x2E90(1,-1)` llama a `0x1CBC60(-1)`, que devuelve el descriptor `tabla-0x30` (`0xD190D8`, **fuera de la tabla kind1**). Su `+0x18` vale 0 en la imagen, así que devuelve el recurso **ranura 0** en vez del anfitrión (67 → ranura 73, 41 → ranura 47). No hay crash en Unicorn, pero se lee fuera de la tabla y se usa un recurso equivocado. No se ha determinado qué escena es la dueña de la vtable `0xD1FFB8` ni si se ejecuta en una sesión custom [S: está junto a `stashName 0x206D00`; podría ser el prólogo]. **Implicación**: F2 no puede "olvidarse" de `curIdx`. Hace falta un hook en `0x2CC0`/`0x2E90` que use el índice del anfitrión cuando la sesión custom esté activa, o bien comprobar en Switch que esa ruta no se ejecuta.
- **(c) Selección persistente**: `onConfirmCell` llama a `setSel 0x4890` en `0x1D2ED0`, después de `launchA`. Por eso F1–F3 dejan `sel.col/row/x` (3 bytes del blob) apuntando a la casilla custom, y se guardan en el siguiente `writeSave` [U]. Es el mismo comportamiento que con una casilla oficial, pero si se desinstala el módulo, el cursor apunta a `(0,9,r)` (vacía en la rejilla original). No se ha medido qué hace el juego en ese caso. Hay que decidir si se acepta o si se restaura en F1-post.

## 2. (B) Destrucción de trabajadores del Runner

Código real: Runner ctor `0x515000`, reap `0x515450`, clear `0x515290`, `ThreadGroup` ctor `0x514760` / registro `0x5147A0`, unregister `0x5148F0`, Thread ctor `0x514A90`, append `0x5153A0`, step `0x514E00`, shouldStop `0x514EE0`, dtor `0x514BC0` + deleting `0x4292C0/0x4212D0`, dtors de stage HT2 `0x4290F0` → `0x4D8D40` → `0x1363D0` y R21 `0x4207F0` → `0x4D9A10` → `0x1363D0`, y los wrappers de nn::os `0x4DFA20` (crear), `0x4DFB60` (join), `0x4DF9A0`, `0x4DFC20`, `0x4DFC70`, `0x4DFC80`.
**Stubs del harness**: las importaciones nn::os (`0xA65FE0` wait/join, `0xA65FF0` destroy, `0xA66060` finalize event, `0xA66070` signal, `0xA66080` start, `0xA66090` init, más `0xA66000/10/30` en la creación; nombres **inferidos por uso**, no por símbolo), el asignador (`0x4E02F0/0x4E04E0`, `0x50A6B0/0x50A710`) y los sub-dtors no relacionados (`0x2168B0, 0x4EFDB0, 0x504440, 0x505AB0, 0x6A40, 0x4EE330, …`, contados como "unlisted"). **No hay hilos reales**: un join stub devuelve inmediatamente, así que la continuación del hijo se prueba aparte (2.2).

Montaje: 1 Runner, 1 stage (0xF000 B) con su grupo en `+0x2978`, 2 hijos (vtable HT2 `0xD4D450` o R21 `0xD4D030`) en estado 1 tras el primer `step` (hilo OS creado y arrancado: `A66080 ×2`). Después de que retorna el dtor del stage, **toda la memoria del stage se envenena** (cualquier lectura o escritura se registra) para modelar el `free`.

### 2.1 Secuencias [U-stub]

| Secuencia (HT2 y R21, idénticas) | Resultado |
|---|---|
| stage dtor → reap (salida normal) | El dtor **solo** desregistra el grupo (grupos 1→0): **0** llamadas nn::os en la fase del dtor (ni signal ni join). Reap: `signal ×2`, `join ×2`, `destroy ×2`, `finalize ×4`; estados 1→2→3; 2 hijos liberados; **0 accesos tardíos al stage** |
| stage dtor → clear (Runner destruido / abort) | lo mismo, pero el join ocurre en `clear`; 2 hijos liberados; 0 accesos tardíos |
| clear → stage dtor | los hijos se liberan antes; 0 accesos tardíos |
| reap → stage dtor → reap | el primer reap **no** para nada (grupo presente, estados `[1,1]`); el segundo los para y libera |
| stage dtor → step → reap | `step` ve el grupo ausente (`shouldStop`) → estado 2, signal, **join dentro de step**, estado 3; reap libera |

Conclusiones:
- [U] Ningún dtor de stage hace join de sus hijos. Entre el `free` del stage y el siguiente `step`/`reap`/`clear`, los hilos OS siguen vivos y bloqueados en su evento, con estado 1.
- [U] El primer punto que los para es `step` o `reap` (sequence tick `0x132DB0`) o `clear` (dtor del Runner). Los tres hacen signal + join antes de liberar.
- [I] Que un hijo se despierte sin señal en esa ventana depende del scheduler real. **No es reproducible** en este harness.

### 2.2 Continuación del worker nativo tras la parada [U]

`HT2 worker 0x428EF0` real; la k-ésima espera (`0x514D70` real, o una corrutina anidada `0x1398B0/0x429330/0x42B740/0x1367F0` tratada como stub de espera) vuelve con estado 2 y el stage envenenado:

| k | Esperas vistas | Accesos tardíos al stage | `tPop 0x514FD0` | Estado final |
|---|---|---|---|---|
| 1–5 | k | **0** | 1 | 2 |

El camino de parada del worker nativo (`tStop` → `0x428F70` → `tPop`) solo toca el hilo, nunca el stage. **No ejecutado**: el interior de las corrutinas anidadas, el worker R21 `0x420720` y los cuerpos del motor de GE-151, por lo que su camino de parada solo tiene evidencia estática.

### 2.3 Implicaciones para GE-151

- El motor no debe tocar el stage (ni `gRun` ligado a él) después de `tStop` en ningún camino. Debe seguir el patrón nativo: `tStop → tPop → return`.
- Los recursos que el motor asocie al stage (buffers, timeline) no pueden liberarse en el dtor del stage si un hijo puede leerlos antes del siguiente `step/reap/clear`. Hay que liberarlos cuando el hijo haya terminado (tras el join) o protegerlos con una marca que el hijo compruebe tras cada espera.
- No es reproducible aquí: el orden real del scene manager entre el dtor del stage y el siguiente tick, y el abort por pausa → menú. Eso necesita Switch.

## 3. (C) Prototipo de dos casillas

### 3.1 Mapa inverso: `buildReverseMap 0x1CD4E0` real [U]

Tablas `0x10B8070` (14 kind0), `0x10B81C0` (80 kind1), `0x10B8940` (8 kind2), paso 0x18:

| Configuración | Entradas distintas a la imagen original |
|---|---|
| Imagen original (referencia) | — (`rev(1,41)=(1,1,0)`, `rev(1,67)=(0,8,4)`, `rev(1,77)=(1,8,2)`, `rev(1,78)=(1,8,3)`) |
| IPS v0.3.9 en la rejilla | **4**: `(1,41)→(1,9,1)`, `(1,67)→(1,9,4)`, `(1,77)→(1,9,2)`, `(1,78)→(1,9,3)` (confirma la causa estática) |
| IPS + guard en `mapCell` durante el build | **0** |
| Sin IPS, `mapCell` dinámico A=`(0,9,0)→{1,67}`, B=`(0,9,1)→{1,41}`, sin guard | **1**: `(1,67)→(0,9,0)` (`(1,41)` no cambia porque el mundo 1 se recorre después) |
| Ídem + guard | **0** |

`buildReverseMap` llama a `mapCell 0x1CBCA0` (en `0x1CD5B0`), así que el guard en `mapCell` es suficiente [U].

### 3.2 Despacho y selección de dos casillas con el mismo anfitrión [U]

Las dos ranuras usan `{1,67}`. `mapCell` dinámico en el harness, F1–F3 activos:

| Confirmación | F1 ranura | `launchA` | Diffs |
|---|---|---|---|
| A `(0,9,0)` | 0 | sí | `sel.col 1→9`, `sel.x 1→0` (solo selección); `curIdx` -1 |
| B `(0,9,1)` | 1 | sí | `sel.col 1→9`, `sel.row 0→1`, `sel.x 1→0`; `curIdx` -1 |
| Remix 8 oficial `(0,8,4)` | — | sí | ruta nativa completa: `plays 0→1`, `curIdx 67` |
| HT2 oficial `(1,1,0)` | — | sí | ruta nativa completa: `kind1[41].plays 0→1`, `curIdx 41` |
| B desactivada (estado 1) | — | no | SE de bloqueo, sin diffs |

F1 elige la ranura **por coordenada**, nunca por `(kind,idx)`: A y B no se confunden aunque compartan anfitrión, y las partidas oficiales del mismo anfitrión siguen la ruta nativa.

### 3.3 Registro e instalación parcial [H → U]

`registry_model.py` implementa las reglas fail-closed de `dynamic-stage-research.md` §5.1 sobre paquetes sintéticos. Cada resultado se lleva a Unicorn como `cellState` (habilitada → 4, si no → 1) y se confirma la casilla B:

| Caso (ranura B; A siempre válida) | Registro | Unicorn (B) |
|---|---|---|
| válido | enabled | `launchA`, F1 ranura 1, solo `sel` |
| falta `manifest.json` | manifest missing | bloqueada, sin diffs |
| falta la timeline | timeline missing | bloqueada, sin diffs |
| JSON truncado | manifest JSON corrupt | bloqueada, sin diffs |
| `id` ≠ carpeta | id != folder | bloqueada, sin diffs |
| `engine_min` 9.0.0 | engine_min > engine | bloqueada, sin diffs |
| timeline de 72000 B (> 60 KiB) | timeline size | bloqueada, sin diffs |
| `adapter: hoop` + gtf | adapter/format | bloqueada, sin diffs |
| `slots.json` con id duplicado | B: duplicate id | — |

En los 9 casos la ranura A sigue habilitada y funcional.

### 3.4 Guardado por id (`.gsv` de 160 B, **propuesta**) [H]

- Dos partidas de A (completada con rango 4 y 85 puntos; luego abandonada con 10): `plays=2, clears=1, state=3, bestRank=4, bestScore=85, lastScore=10, seq=2`. B queda en sus valores por defecto: no se crea ni se toca su fichero.
- CRC corrupto en `a.gsv` → se carga `a.gsv.bak` (`plays=1`).
- Un fichero de A renombrado como `b.gsv` → se rechaza por id distinto → valores por defecto.
- Ficheros por id: `.gsv` + `.gsv.bak` (más `.tmp` transitorio).
- **No ejecutado**: escritura en SD real, límite de `persistCustomSave`, y cortes de alimentación.

## 4. Casos no reproducibles o no ejecutados

- Escenas y stages completos: rango y puntuación modelados con `setPending` real; no se ejecuta ningún stage ni el motor de GE-151.
- Hilos OS reales y scheduler; orden real del scene manager en pausa → abort; worker R21 y corrutinas anidadas.
- Qué escena posee la vtable `0xD1FFB8` (`0x2067B0`) y si se ejecuta en una sesión custom.
- Semántica de `0x10B8C10` / bit 3 de `blob+0x115C`.
- Efecto visual de la telemetría sin campos de juego; cursor guardado en `(0,9,r)` tras desinstalar.
- Todo lo relativo a Switch.

## 5. Implicaciones para GE-151 (Codex)

1. F1–F3 aíslan el progreso **en modo de mapa 0** en todos los casos medidos, incluida Perfect Campaign. F4 detecta derivas (PC4).
2. **Antes de preparar hardware**: (a) cubrir el modo 1 (restaurar el cursor en el post de `0x1D38A0` o rechazar F1); (b) resolver `0x2067B0 → 0x2CC0/0x2E90` con `curIdx=-1` (hook que use el índice del anfitrión o demostrar que no se ejecuta); (c) decidir sobre `sel` persistente.
3. Hilos: no tocar el stage tras `tStop`. No liberar en el dtor del stage nada que un hijo pueda leer antes del siguiente `step/reap/clear`.
4. Mapa inverso: retirar las escrituras de la IPS en `kGrid` y usar el guard en `mapCell` durante `buildReverseMap` (0 entradas distintas a la original).
5. El `.gsv` sigue siendo propuesta. El registro fail-closed lleva todo paquete inválido a la ruta F0 sin escrituras.

## 6. Ficheros

- `unicorn/harness.py`, `unicorn/common.py`: harness (solo direcciones; la imagen se pasa por argumento).
- `unicorn/exp_a.py`, `exp_curidx.py`, `exp_b.py`, `exp_c.py`, `exp_c_confirm.py`, `exp_c2.py`, `registry_model.py`, `smoke.py`.
- `unicorn/results/*.json|txt`: diffs y contadores (sin volcados).
- No se publican `main`, la imagen descomprimida, romfs, la IPS ni binarios compilados.
