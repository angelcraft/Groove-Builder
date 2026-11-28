# GE-152 — Aislamiento del progreso nativo (`game_save.bin`) durante niveles custom

Evidencia: **solo revisión estática** de `main` `03FF4A3B` (imagen RE local, no publicada). No se ha ejecutado nada en Unicorn ni en Switch.
Etiquetas: **[V]** leído en el código máquina · **[H]** hipótesis pendiente de ejecución.

## 1. Modelo

- Gestor `mgr = 0x10A75F0` (GOT `0xD96058`). Blob persistente `mgr+0x548 .. +0x16D0` (`0x1188` B, versión `0x34`). Copia de preparación `mgr+0x16D0` [V].
- `writeSave 0x3D60(mgr, inc)`: si `inc` → `+0x560++`; `+0x1096 = 0`; `memcpy(+0x16D0, +0x548, 0x1188)`; escritura asíncrona `0xB470` [V].
- Fuera del blob (solo RAM, **no** se guarda): `mgr+0x2860..0x28D0` (RNG, historial reciente `0x28B0..`), `mgr+0x2904` (modo), `mgr+0x3AA8` (flags de sesión, puntero en `+0x3AA0`), globales `0xD98F28/30/38`, `0xDACF78/7C`, `0x10AB1D8/DC` [V].
- Punteros del ctor (`0x3254..0x32B8`) a palabras **dentro** del blob: `+0x3AB8 → +0x115C`, `+0x3AC8 → +0x1160`, `+0x3AD8 → +0x1164` (flags persistentes de avisos/desbloqueos) [V].

## 2. Inventario de escritores del blob (métodos del gestor, `0x2000..0xB000`)

Se buscaron los `st*` con offset inmediato o registro dentro de `[0x548, 0x16D0)`, agrupados por función, más sus llamadores `BL`/`B` [V]:

| Función | Campo(s) | Llamadores | Papel |
|---|---|---|---|
| `0x3390` | todo | `0x3C50`, `0x3D28` | reset/valores por defecto |
| `0x3CA0` | `+0x564` | `0xA81C` | cargar |
| `0x3D60` | `+0x560`, `+0x1096` | `0x1314E4`, `0x1316D0` | **writeSave** |
| `0x3E30` | `+0x568` | `0xADD8` | contador del encabezado |
| `0x3B90` | kind0 `+0x570` | `0x15DC30..0x15DD10` (6) | estados de historia |
| `0x4030` | estado kind0/1/2 | `0x15DBF8`, `0x15DD40`, `0x1CC8F0`(cola), `0x1D2FEC`, `0x1D3B9C`, `0x1D3C24`, `0x1D3E38`, `0x1D3E70`, `0x1D3F70`, `0x1D3FB0` | **setSaveState** |
| `0x47E0` | kind1 `+0x5AC` (best) | `0x1D3AF0` | récord (valor de "flow") |
| `0x4840` | kind1 `+0x5B4` (perfect) | `0x1D3B7C`, `0x1D3BC0` | perfectos |
| `0x4890` | `+0xB98/9A/9C/9E` | `0x1CF294`, `0x1D1614`, `0x1D2ED0`, `0x1D39CC` | selección/cursor |
| `0x48B0` | `+0xBA0..+0xBAF`, `+0x5B0`/`+0xAAC` | `0x1D344C`, `0x1D3604` | **beginPlay** |
| `0x4900` | `+0xBA0` | `0x1D391C` | clearPending |
| `0x4910` | `+0xBA4`, `+0xBA8` | `0x137094`, `0x206624`, `0x215210` | **setPending** (sale si `mode<0` o `curIdx<0`) |
| `0x49B0`/`0x49C0` | `+0xBB0` (objetivo de la campaña) | `0x1D22D0` / `0x1D3A4C`, `0x1D3A6C` | Campaña Perfecta |
| `0x49E0`/`0x49F0` | `+0xBB2` (restantes) | `0x1D22DC` / `0x131474` | campaña |
| `0x4A20`/`0x4A30` | `+0xBB3` | `0x1D3A54`, `0x1D3A74` / **`0x1D3228`**, `0x1D43D8` | campaña |
| `0x4A60`/`0x4A70` | `+0xBB4` | `0x1D22E4` / **`0x1D3264`** | campaña |
| `0x4A90` | `+0xBB8/+0xBBA` | `0x1D433C` | coordenada de aviso |
| `0x5940/0x5960/0x5980` | `+0x1198..+0x119D` | `0x250AEC`, `0x250A78`, `0x250BA4` | menú `0x250900` [H tienda/museo] |
| `0x59B0`/`0x59D0` | `+0x1200`/`+0x1204` | `0x1E8498..0x1E8524` | menú `0x1E8450` [H] |
| `0x5A10` | `+0x11E4` | `0x25173C` | menú `0x2516D0` [H] |
| `0x5A40` | `+0x164C + 16·a + 4·c + b` (byte ≤ `0x7F`) | 16 llamadas en `0x13EC40` | ajuste de juego/entrada [H] |
| `0x61B0` | `+0x1080` | `0x1E0880` | menú [H] |
| `0x2F00/0x3010/0x3110`, `0x25D0`, `0xA650`, `0x3C20`, `0x3C30` | opciones/ajustes | arranque/menús | no están en la ruta de juego |

Escrituras indirectas en palabras del blob a través de punteros [V]:
- `+0x1160`: `|= 2` (`0x1D3C48`) y `|= 0x20000` (`0x1D3C6C`) en `commitResult`; también `0x15DB68`, `0x250B28`, `0x25175C`.
- `+0x115C`: `0x1D3120` (`|= 8`), `0x1CE01C`, `0x24FC1C`, `0x320130`, `0x3201FC`, `0x4C0B00`.
- `+0x1164`: `0x25095C..0x250A04`.

Funciones auxiliares (no escriben en el blob) [V]: `0x63B0` (último juego y racha, RAM `+0x28B0/+0x28B4`), `0x6400`/`0x6490` (historial RAM `+0x28B8..`), `0x6580` (fusión del récord: `old + (new-old)·k/100`), `0x64F0` (flow medio de los kind1 con estado ≥ 4), `0x5AC0` (RNG RAM), `0x78E0` (RAM).

## 3. Escrituras en una partida que sale por `exit` (lo que pasa hoy con PR #6)

Ruta: `onConfirmCell 0x1D2CC0` → `launchA 0x1D3130` → stage → worker del motor (`initGameplay`, … , `exit`) → `mapEnterFromStage 0x1D38A0` → refresco `0x1D3CA0` → `commitResult 0x1D39D0` (de la corrutina del mapa) → siguiente `writeSave`.

| Paso | Dirección | Escritura persistente | Condición |
|---|---|---|---|
| launchA | `0x1D3228` → `0x4A30` | `+0xBB3++` (satura en 100) | sin objetivo de campaña, `0x1D20D0(map)` y `0x4070(6,0) ≥ 1` |
| launchA | `0x1D3264` → `0x4A70` | `+0xBB4++` | hay objetivo de campaña e `idx ≠ objetivo` |
| launchA | `0x1D344C` → `0x48B0` | pendiente del modo + **`plays++`** del anfitrión | siempre |
| stage | `0x137094` (`initGameplay`) → `0x4910` | `rank = 1`, `score = 0` | `curIdx ≥ 0` y bits 7/8 de sesión a 0 |
| stage | `0x206624`, `0x215210` | `rank`/`score` | rutas de resultados/otras (no en `exit`) |
| map | `0x1D391C` → `0x4900` | `curIdx = -1` | pendiente `≥ 0` |
| commit | `0x1D3A4C/0x1D3A54/0x1D3A6C/0x1D3A74` | campaña: `+0xBB0 = -1`, `+0xBB3 = 0` | objetivo, contadores |
| commit | `0x1D3AF0` | récord | `rank ≥ 2` |
| commit | `0x1D3B7C`/`0x1D3BC0` | perfectos `+1` / **`= 0`** | estado 7 y flags bit 0 (`rank ≥ 5` / `1 ≤ rank < 5`) |
| commit | `0x1D3B9C`, `0x1D3C24` | estado 8 / 9 | 3 perfectos / estado 8 y bit 1 y `rank ≥ 5` |
| commit | `0x1D3C48`, `0x1D3C6C` | `+0x1160 |= 2`, `|= 0x20000` | mundo completo (`0x1CFC50`) |
| refresco | `0x1D3E38`/`0x1D3E70` (kind1), `0x1D3F70`/`0x1D3FB0` (kind2) | estado 3 / 4 | pendiente `≥ 0`, casilla del cursor con estado 2, `rank` 3–5 / 2 |
| desbloqueo | `0x1CC8F0` (desde `0x1D4C04..0x1D5540`) | estados vecinos | animación de desbloqueo después del commit |
| guardar | `0x131440`→`0x3D60`; `0x1CF2A4`/`0x215C84`/…→`0x1316A0`→`0x3D60` | **todo el blob** | ver `codex-pr5-answers.md` §2 |

## 4. Estrategia mínima: cero escrituras persistentes nativas

Hooks (todos trampolín; ninguno empieza por una instrucción relativa al PC) [V en las firmas]:

1. **F0 — declinar** (`cellState 0x1CC420`): si el paquete de la casilla no es válido, devolver estado `≤ 1`. La confirmación toma la ruta nativa de "bloqueado" y no llama a `launchA`. **0 escrituras.**
2. **F1 — `launchA 0x1D3130`** (y `launchB 0x1D34A0` por seguridad):
   - Antes: resolver la casilla con `map+0x5274/+0x5298/+0x529C`.
   - Si es custom: exigir `curIdx(mode) == -1` (si no, declinar). Poner `gCustomLaunch` y forzar `w2 = w3 = 0`.
   - Hacer una foto **solo de lectura** (CRC) del registro del anfitrión y de `+0xBA0..+0xBB4`.
   - Llamar a `orig`. Después: bits 1–3 de `mgr+0x3AA8` a 0 (RAM) y `gCustomRun = slot`.
3. **F2 — `beginPlay 0x48B0`**: si `gCustomLaunch` → `return`. Con esto, de forma automática:
   - `setPending` (los 3 llamadores) no hace nada (`curIdx < 0`, `0x4920`).
   - `commitResult`, `0x1D3D40` y `0x1D3F10` se saltan los registros (`tbnz w,#31` en `0x1D3A8C`, `0x1D3DE0/0x1D3DF4`, `0x1D3F30`) [V].
4. **F3 — `0x4A30`/`0x4A70`**: si `gCustomLaunch` → `return`.
5. **F4 — `writeSave 0x3D60`**: **solo detección**. Compara el CRC con la foto de F1 y lo anota en el log. No restaura nada y no suprime ningún guardado global (política de GE-151).
6. **Fin de sesión**: post de `mapEnterFromStage 0x1D38A0` → `gCustomRun = -1`. Si la escena cambia sin volver al mapa (menú de pausa → título), lo limpia el dtor del stage [H: comprobar en Switch].

Resultado esperado (estático): durante una sesión custom no cambia **ningún** byte del blob, salvo `setSel` (`+0xB98..`, posición del cursor; conducta nativa de cualquier casilla). Las únicas escrituras de F1 son RAM no persistente. El HT2, el Remix 8, Orochi, HoopDX y las partidas normales no cambian, porque todos los hooks comprueban `gCustomLaunch`/`gCustomRun`, y esas variables solo se activan en una casilla custom.

Lo que falta: comprobar en Unicorn que ninguna llamada indirecta de `launchA` (`vt+0x48`, `0x12D310`) llega a `0x3D60`, y la prueba física de `game_save.bin` igual byte a byte (ver `two-slot-prototype.md` §7).
