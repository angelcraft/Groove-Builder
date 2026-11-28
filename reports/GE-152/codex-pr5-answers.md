# GE-152 — Respuestas a las preguntas de Codex en PR #5

- Pregunta: comentario de Codex en PR #5 (GE-151 @ `07f78337c366156809e13f74f3839221047eb3aa`;
  seguimiento en `1a67208f`, `reports/GE-151/NATIVE_LIFECYCLE_FOLLOWUP.md`).
- Binario: `main` build `03FF4A3B` (imagen RE local, **no publicada**). Direcciones = offset de memoria del módulo.
- Tipo de evidencia: **solo revisión estática** (desensamblado con capstone 5.0.7 sobre la imagen local).
  **No** se ha ejecutado nada en Unicorn ni en Switch. **No** se ha compilado nada para esta respuesta.
- Etiquetas: **[V]** = leído directamente en el código máquina; **[H]** = hipótesis/inferencia que falta comprobar en ejecución.
- No se incluyen volcados del juego ni código del SDK; solo direcciones, offsets y flujo de control.

---

## (1) Cancelación / join / destrucción de los hijos del Runner

### 1.1 Qué hacen los destructores de los stages

| Función | Dirección | Llamadas que hace | ¿Toca el Runner (`+0x2C80`/`+0x3550`) o la lista de hilos? |
|---|---|---|---|
| HT2 dtor | `0x4290F0` | `0x4EFDB0(stage+0x7AB8)`, `0x2168B0(stage+0x2C98)`, cola → `0x4D8D40` | **No** [V] |
| R21 dtor | `0x4207F0` (`oR21Dtor` en `engine/src/main.cpp`; firma `A9BD7BFD F9000BF5` en `sigs.hpp`) | libera ~24 subobjetos por vtable (+0x10), `0x4D8EF0`, `0x4EFDB0`, `0x4D7AA0`, `0x4D82C0`, `0x4D9A10`, `0x13ADC0` | **No** [V] |
| base intermedia | `0x4D8D40` | 2 objetos propios (+0x2C60/+0x2C68), cola → `0x1363D0` | **No** [V] |
| base de escena de juego | `0x1363D0` | …, `0x5148F0(stage+0x2978)`, cola → `0x505AB0` | **Indirectamente**, ver 1.2 |

Ningún destructor del stage para, despierta ni espera a sus hilos hijos. Tampoco lee `stage+0x2C80` (HT2) ni
`stage+0x3550` (R21) [V].

### 1.2 Propiedad real: el Runner es de la secuencia, no del stage

- ctor HT2 `0x428D70`: `stage+0x2C80 = (seq ? seq+0x58 : 0)` y `stage+0x2C88 = stage` [V]. El Runner vive dentro
  del objeto **secuencia** (`x1` del ctor), no dentro del stage.
- Subobjeto `stage+0x2978` = "grupo de hilos" (id en `+0x10`, es decir `stage+0x2988`, que el ctor lee) [V].
- `0x5148F0` (llamado desde `0x1363D0`): busca el id del grupo en el vector del Runner `[runner+0x50 .. +0x58)`
  (paso `0x18`) y lo **quita** con `memmove` (`0xA65D30`). **No** para ni espera a ningún hilo [V].

### 1.3 Dónde se paran y se esperan los hilos de verdad

Vtable de los hilos miembro de HT2 `0xD4D450` (= la que usa `spawn()` del motor) y de R21 `0xD4D030`. Las dos
comparten las entradas base [V]:

| Ranura (punto de dirección +0x10) | HT2 | R21 | Papel |
|---|---|---|---|
| `+0x00` | `0x514BC0` | `0x514BC0` | dtor completo de `Thread` |
| `+0x08` | `0x4292C0` | `0x4212D0` | dtor con borrado: `0x514BC0` y luego `free(0x298)` (`0x4E04E0`) |
| `+0x10` | `0x514E00` | `0x514E00` | paso (step) |
| `+0x18` | `0x514EE0` | `0x514EE0` | `shouldStop`: si el id de grupo del hilo (`th+0x254`) **ya no está** en el vector del Runner → parar |

- `0x514BC0` (dtor de `Thread`): si `state(th+0x250) == 1` → `state = 2`; señal en `th+0x220` (`0x4DFC70`);
  **join** del hilo del SO en `th+0x28` (`0x4DFB60`: dos stubs PLT consecutivos `0xA65FE0`/`0xA65FF0`, patrón
  wait+destroy, nombres de import **no resueltos** [H]); `state = 3`; resta 1 al contador del grupo en el Runner;
  destruye los eventos (`0x4DFC20` ×2) y el objeto de hilo (`0x4DF9A0`) [V].
- `0x514DD0` = `tStop(th)` del motor: devuelve `state == 2` [V].
- `0x514E00` (step): si `shouldStop()` → igual que arriba (2, señal, join, 3); si no, en la primera ejecución
  crea el hilo del SO (pila `0x10000`, entrada `0x514A40`) [V].
- Recolección (`reap`) `0x515450(runner)`: recorre la lista enlazada `runner+8`; si `vt+0x18` (shouldStop)
  devuelve true, lo desengancha y llama a `vt+0x08` (dtor con borrado → join → `free`) [V].
  La llama solo `0x132EB4`, dentro del tick de la secuencia `0x132DB0` (llamado desde `0x132358`) [V].
- Limpieza total `0x515290(runner)` (desde el dtor del Runner `0x515040`, objeto de `0x70` B): `vt+0x08` sobre
  **todos** los nodos de `runner+8` y vacía la lista [V].

### 1.4 Conclusión para GE-151

1. El dtor del stage (`0x4290F0` / `0x4207F0`) **no** cancela ni hace join de los hijos. Solo los da de baja
   (`0x5148F0` quita el grupo) [V].
2. El join ocurre **después**: en el siguiente `reap` del tick de la secuencia (`0x132DB0` → `0x515450`) o en
   `0x515290` cuando se destruye el Runner. En ese momento el hilo hijo se despierta con `state == 2` (su `tStop()`
   devuelve true) y termina su código **con el stage ya destruido** [V para la cadena; el orden temporal exacto
   frente a la liberación del stage es **[H]**].
3. Por eso, en el motor, mantener la "propiedad del timeline hasta que vuelva `orig(stage)`" (PR #6) **no basta**.
   La rama de salida de los cuerpos (`if (tStop(th)) { …; tPop(th); return; }`) no debe tocar `stage`,
   `gTl`/`gMt` ni estado que un ctor nuevo pueda reutilizar, porque puede ejecutarse después de `dtorHook`.
   Hoy esa rama solo escribe `gRun.stopped`/`gMRun.stopped` y llama a `tPop(th)` sobre el propio `th` (que sigue
   vivo hasta el `free` de `vt+0x08`), lo que estáticamente es compatible. Lo que falta demostrar es que ningún
   `waitTicks`/`waitUntil` lee `stage` **después** de despertar con stop.
4. Prueba dinámica mínima pendiente (Unicorn/Switch): puntos de parada en `0x4290F0`, `0x1363D0→0x5148F0`,
   `0x514BC0`, `0x515450` y `0x4E04E0(th,0x298)`, y anotar el orden durante una salida `exit` y durante el menú de
   pausa → "Salir".

---

## (2) ¿Se guarda el incremento de `plays` de `0x48B0` aunque se tome `exit`?

**Sí, estáticamente: se guarda en la siguiente escritura oficial, porque no hay nada que lo deshaga** [V].

1. `beginPlay 0x48B0(mgr, mode, idx, flags)` escribe en el blob en RAM (`mgr = 0x10A75F0`, blob `mgr+0x548`,
   `0x1188` B) [V]:
   `+0xBA0+2·mode = idx` (i16, curIdx), `+0xBA4+mode = 0` (rango), `+0xBA6+mode = flags`, `+0xBA8+4·mode = 0`
   (puntuación) y `plays++`: `+0x5B0+16·idx` (kind1) o `+0xAAC+8·idx` (kind2).
2. `writeSave 0x3D60(mgr, inc)` hace `memcpy(mgr+0x16D0, mgr+0x548, 0x1188)` y encola la escritura asíncrona
   (`0xB470`). Copia **todo** el blob, así que serializa cualquier cambio hecho en RAM antes [V].
3. En la ruta `exit`, nada restaura el contador. Además, el motor llama a `initGameplay 0x137050`, que hace
   `setPending(1, 0)` en `0x137094` (porque `curIdx ≥ 0`). Al volver al mapa, `0x1D38A0` lee el pendiente
   (`0x4940`) **≥ 0** y `commitResult 0x1D39D0` se ejecuta con rango 1 [V]:
   - rango < 2: no toca el récord.
   - si el estado del anfitrión es 7 y el byte de flags tiene el bit 0 → `setPerfectCount(idx, 0)` (`0x1D3BC0`):
     **pone a cero los perfectos del anfitrión** [V].
   - el bloque de la Campaña Perfecta del principio (`0x49A0..0x6400`) se evalúa sobre contadores que el propio
     lanzamiento ya ha cambiado (ver 3.2) [V].
4. ¿Quién guarda después? Llamadas directas a `writeSave` [V]:
   - `0x131440` (método virtual). Guarda si el bit 1 de `*(mgr+0x3AA0)` (= `mgr+0x3AA8`, flags de sesión en RAM)
     está puesto; el lanzamiento lo pone si el anfitrión es el objetivo de la Campaña Perfecta o si `w23`/`w24` bit 0.
     Además resta 1 a `+0xBB2`.
   - `requestSave 0x1316A0`, con 9 llamadores: el mapa `0x1CF2A4` (tick `0x1CF1D0`: guarda la selección y pide
     guardar), resultados `0x215C84`, `0x123934`, `0x1AD804`, `0x1E0890`/`0x1E0914`, `0x1E8550`, `0x2501D0`,
     `0x32013C`.
   - `mapEnterFromStage 0x1D38A0` **no** llama a `writeSave` directamente.
   Cuál de ellos se dispara primero tras un `exit` es **[H]**. En cualquier caso, la siguiente escritura oficial
   (cursor del mapa, menú, otra partida) persiste el `plays++` y lo que haya hecho `commitResult`.
5. Conclusión: bloquear `toResults` (PR #6) no aísla nada. Coincide con lo que dice Codex.

---

## (3) Frontera anterior al incremento

### 3.1 Orden dentro de "confirmar casilla" (kind1) [V]

`onConfirmCell 0x1D2CC0` (cuerpo de corrutina, termina en `tPop 0x514FD0`) sigue este orden:
1. `0x1CF440`/`0x1CF490` (consulta de bloqueo). Si `≤ 1` → `0x4EE970` (sonido de "bloqueado") y sale **sin escribir nada**.
2. `0x3F70` (lectura), diálogo opcional (`0x1D16E0`, `0x125xxx`).
3. `launchA 0x1D3130(map, desc*, w2=flags, w3=flags2)` en `0x1D2EAC`. kind2 → `launchB 0x1D34A0`; kind0 → `0x1D2F10`.
4. Después: `setSel 0x4890` (`+0xB98..`, posición del cursor), `map+0x5270 = 1`, `0x139B70`.
   El valor de retorno de `launchA` **no se usa**.

Orden dentro de `launchA 0x1D3130` [V]:
1. `0x3F70`.
2. Bits 1/2/3 de `mgr+0x3AA8` (RAM), según la Campaña Perfecta (`0x49A0`) y `w23`/`w24`.
3. **`0x4A70` → `+0xBB4++`** si hay objetivo de campaña e `idx ≠ objetivo`, o **`0x4A30` → `+0xBB3++`** si no hay
   objetivo, `0x1D20D0(map)` y `0x4070(6,0) ≥ 1`. **Escrituras en el blob antes de `beginPlay`.**
4. `0x1CD490` → `0x215DB0` (RAM `0xDACF78`), `0x215DC0`; racha `0x63E0`/`0x3F60` → bit 5 (RAM).
5. `stashName 0x206D00`, petición de escena (`vt+0x48`, `0xE`), `0x18AE40` (RAM `0xD98F28..38`, idx 65/67/73/79).
6. `mgr+0x2904 = mode` (RAM).
7. **`beginPlay 0x48B0`** (`0x1D344C`).
8. `0x5AC0` (RNG RAM `mgr+0x2870..`), `0x78E0` (RAM `0x10AB1D8/DC`), `0x12D310` (transición).
9. El **ctor del anfitrión** (`0x428D70` / `0x4202C0`) se ejecuta más tarde, cuando el gestor construye la escena.

Por eso guardar solo `0x48B0` no basta: `launchA` ya ha escrito `+0xBB3`/`+0xBB4` en el blob.

### 3.2 Frontera propuesta (sin escribir índices negativos y sin restaurar el blob)

| # | Punto | Tipo | Acción en sesión custom | Qué evita |
|---|---|---|---|---|
| F0 (declinar) | `cellState 0x1CC420` → `0x1CF490` | Trampolín (`stp x29,x30`) | Paquete no válido/desactivado → estado `≤ 1` → ruta nativa "bloqueado" (`0x1D2D04 → 0x1D2D30`) | **Cualquier** escritura: no se llama a `launchA` |
| F1 (aceptar) | `launchA 0x1D3130` (y `0x1D34A0`) | Trampolín (`sub sp` / `stp`; firma `D101C3FF A9027BFD`) | **Antes de cualquier escritura**: casilla = `map+0x5274` (mundo), `+0x5298` (col), `+0x529C` (fila) → ranura. Si es custom: `gCustomLaunch = slot`, `w2 = w3 = 0`. Precondición `curIdx(mode) == -1` (si no, declinar con F0). Llamar a `orig`; al volver, `gCustomLaunch → gCustomRun` y poner a 0 los bits 1–3 de `mgr+0x3AA8` (RAM, ver nota) | Bits de campaña y guardado de `0x131440` |
| F2 | `beginPlay 0x48B0` | Trampolín (1.ª instr. `add x8,x0,w1,sxtw #1`, sin PC-rel) | Si `gCustomLaunch`: `return` **sin llamar a `orig`** | `plays++` y todo el bloque pendiente. `curIdx` sigue en `-1`, así que `setPending` no hace nada (`0x4920`) y `commitResult`/`0x1D3D40`/`0x1D3F10` se saltan sus registros (`tbnz w,#31`) |
| F3 | `0x4A30` / `0x4A70` | Trampolín (1.ª instr. `ldrb`, sin PC-rel) | Si `gCustomLaunch`: `return` | `+0xBB3++` / `+0xBB4++` |
| F4 (solo detección) | `writeSave 0x3D60` | Trampolín (`stp`) | CRC del registro del anfitrión y de `+0xBA0..+0xBB4` frente a la foto de F1; si difieren, se anota en el log. **No suprime** ningún guardado | Regresiones |

Notas:
- F2 y F3 no escriben nada: no ponen `curIdx = -1` (ya lo es tras el `clearPending` del último `0x1D38A0`) y no
  restauran el blob. Así se cumple la condición de `NATIVE_LIFECYCLE_FOLLOWUP.md`.
- Los bits de `mgr+0x3AA8` son RAM. No pertenecen a `game_save.bin`: `writeSave` copia solo `+0x548..+0x16D0`, y el
  puntero de `mgr+0x3AA0` apunta a `mgr+0x3AA8` según el ctor `0x3254`. `launchA` ya los limpia al empezar
  (`0x1D3184..0x1D31A8`); F1 solo deja el mismo estado que tendría un lanzamiento sin campaña.
- La campaña en `commitResult` (`0x1D39F8..0x1D3A84`) no depende del pendiente. Con F3, sus contadores no cambian,
  así que el resultado es el mismo que en la última vuelta al mapa (idempotente) [V].
- `setSel 0x4890` (`0x1D2ED0`, después de `launchA`) guarda la posición del cursor (`+0xB98..`). Es la conducta
  nativa con cualquier casilla y **no es un registro del anfitrión**. Se documenta como escritura aceptada.
- Estado del mapa, rango y medallas de la casilla custom: salen del `.gsv` por id, no del anfitrión (ver
  `two-slot-prototype.md`).
- Todo lo anterior es **[V] estático**. Hay que comprobar en Unicorn que `vt+0x48` y `0x12D310`, dentro de `launchA`,
  no llegan a `0x3D60` por una ruta indirecta [H].

Detalle completo de los puntos de escritura: `native-save-isolation.md`.
