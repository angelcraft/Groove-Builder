# GE-152 — T10: B2 rev3 con el módulo ARM64 real de GE-151

Responde a GE-154 [7241265172](https://github.com/angelcraft/Groove-Builder/pull/5#issuecomment-7241265172).
Sin hardware. Modelo cooperativo (`sched.py`), **no Horizon**: no prueba la exclusión multinúcleo.

## Qué se ejecutó

**Módulo.** `GrooveHT3.nss`, el ELF AArch64 que produce `tools/build_engine.py` de GE-151 en el commit **`98112a9`**
(`codex/engine-v0.5.1-hardening`, leído en un worktree desacoplado y sin modificar).
- Entradas, todas públicas y fijadas por el propio builder:
  - loader Hakkun `a321204` con sus submódulos;
  - stdlib LibHakkun 19.1.7 (sha256 `3d0f85ac…`, árbol `1fe0d094…`);
  - Clang 19.1.7, CMake 3.31.6 y Ninja `1.11.1.git.kitware.jobserver-1`.
- No usa ningún dato del juego.
- sha256 del ELF local: `d19db291c18c749ef77e67112ecec3e389adc35bbc2a3944a99064cec4016e97`. **No se sube.**

**Imagen.** El `main` 03FF4A3B local, en plano. **No se sube.**

**Harness.** `unicorn/exp_t10.py` carga el ELF a `base+0x1800000`. Aplica sus 676 relocaciones `R_AARCH64_RELATIVE`
(el ELF no tiene otras) y fija `gBase = base`. Instala los hooks igual que `HkTrampoline`: un `b` en la entrada y una
copia de respaldo `orig` (primera instrucción + salto a `target+4`). Hooks instalados:
- `workerHook` en `0x428EF0` y `dtorHook` en `0x4290F0` (HT2);
- `r21WorkerHook` en `0x420720` y `r21DtorHook` en `0x4207F0` (R21).

Se ejecuta el código **real** del módulo: `ht3Worker`, `control`, `spawn`, `cueThread`/`bgThread`/`latencyThread`,
`multiWorker`, `mControl`, `spawnR21`, `mDirectorThread`/`mSwitchThread`/`mCueThread`/`mLatencyThread`,
`groove::parseTimeline` (GTL1 y GTLM) y los hooks de dtor. Todo ello sobre el Stage, la `Seq` y el Runner reales de
`exp_owner2`/`exp_owner3`.

La barrera es la de rev3 (`exp_owner3.barrier3`), seguida del `0x5096F0` real y el teardown nativo.

## Resultado: `python exp_t10.py $GE_MAIN_IMG $GE_MODULE_ELF results/t10_results.json` → `exit 0`, `FAILURES: 0` (14 entradas)

| Tipo / ruta | Hilos antes de B2 (estado: n) | Barrera | Appends tras cancelar | Eventos de hijos en el teardown | Accesos tardíos | Stage / `Seq` liberados | Lista global | E/S del módulo **dentro del teardown** |
|---|---|---|---|---|---|---|---|---|
| HT2 finalizar (7 ticks; 2 hoops, 1 comment, 2 bg; `saved=1`; `seq+0x18 = *(seq+8)`) | 2:4 | OK, 1 ronda `[4]` | 0 | 0 | 0 | sí / sí | limpia | `flushLog` ×1 |
| HT2 abandonar en el tick 2 | 1:1, 0:3 | OK `[4]` | 0 | 0 | 0 | sí / sí | limpia | **`writeSave` ×1** + `flushLog` |
| HT2 abandonar en el tick 3 | 1:3, 2:1 | OK `[4]`; `stopped=1` | 0 | 0 | 0 | sí / sí | limpia | **`writeSave` ×1** + `flushLog` |
| HT2 reintentar (A abandonada en el tick 3 → B hasta el final, 7 ticks) | A 1:3, 2:1 / B 2:4 | OK / OK | 0 / 0 | 0 / 0 | 0 / 0 | sí / sí | limpia | A: **`writeSave`** + `flushLog`; B: `flushLog` |
| R21 finalizar (5 ticks; `writeMultiSave` lo hace el worker) | 2:5 | OK `[5]` | 0 | 0 | 0 | sí / sí | limpia | `flushLog` |
| R21 abandonar en el tick 2 | 1:2, 2:3 | OK `[5]`; `stopped=1` | 0 | 0 | 0 | sí / sí | limpia | **`writeMultiSave` ×1** + `flushLog` |
| R21 abandonar en el tick 3 | 2:4, 1:1 | OK `[5]` | 0 | 0 | 0 | sí / sí | limpia | `flushLog` |
| R21 reintentar (A → B, 5 ticks) | 2:4, 1:1 / 2:5 | OK / OK | 0 | 0 | 0 | sí / sí | limpia | `flushLog` |
| **Fallo sin retorno 1** (HT2 y R21): los cuerpos del módulo se rearman tras cancelar (`tStop` forzado a falso y espera con estado 1) | — | **falla**: el join no termina (`DEADLOCK`) | 0 | — | — | **no / no** | intacta | **ninguna** |
| **Fallo sin retorno 2** (HT2 y R21): guarda LR/identidad con hilos del módulo vivos (LR `0x509728`) | — | no se ejecuta → `safe-stop` | — | — | — | **no / no** | intacta | **ninguna**; estados de los hilos sin tocar |
| Info (HT2 y R21): `tStop` ignorado por los cuerpos | — | OK, acotado | 0 | 0 | 0 | sí / sí | limpia | HT2: `writeSave` |

Detalle del caso informativo de HT2: con el estado 2, `0x514D70` vuelve sin ceder. Un cuerpo que ignorase `tStop`
recorrería el resto de su línea de tiempo dentro de la barrera (llegaría a enviar 2 hoops, 1 comment y 2 bg) y
terminaría. Los cuerpos reales no lo hacen: en "abandonar", `hoopsSent` no cambia tras la barrera.

Ninguna llamada a punteros SDK nulos, ningún acceso no mapeado ni a la página nula en los 14 casos.

## Hallazgos para GE-151

1. **Contrato de hilos: se cumple con el módulo real.**
   - Tras la cancelación no hay spawn (0 appends).
   - Todos los hilos del módulo quedan en `(2, sin handle, done)` en 1 ronda.
   - `gRun.stopped` / `gMRun.stopped` pasan a 1 en "abandonar".
2. **Hay E/S de SD dentro del teardown nativo.**
   - `dtorHook` / `r21DtorHook` llaman a `writeSave()` / `writeMultiSave()` cuando el intento se abandonó
     (`started && !saved`), y a `flushLog()` siempre.
   - Con B2 eso ocurre **después** de la barrera y **dentro** de `orig(0x5096F0)`. No hay UAF (0 accesos tardíos),
     pero contradice el principio "teardown nativo sin cambios" y añade E/S que puede bloquear dentro del teardown.
   - Recomendación (handoff §5.4): mover ambos a H-B2, después de `barrier ok` y antes de `orig`, y dejar los hooks
     de dtor como observadores puros (sin E/S).
3. **La salida "exit" pide reiniciar la misma escena.** La salida "exit" de los workers escribe
   `seq+0x18 = *(seq+8)`, el mismo id: en el SceneMgr equivale a una petición de reintento (A → B) y pasa por H-B2.
   Confirmar que es lo que se quiere.

## Límites de esta ejecución

- El reloj de los hilos no avanza por frames: en el harness, cada step completa una espera. Las líneas de tiempo se
  comprimen a 5–7 ticks.
- El ctor de los hooks (`ht2CtorHook` / `r21CtorHook`) no se ejecuta, porque lee la SD por punteros SDK que resuelve
  Hakkun. El harness deja el estado como lo dejaría su post: `gHt3Stage`/`gMultiStage`, `gTl`/`gMt` parseados con el
  parser real y `gStage = kStages[1]` (sin parche de cielo).
- R21: `gSlotOf` y `gCueFnOk` son sintéticos. Las llamadas cue se cuentan como `callsSkipped` (2–3): el cuerpo de
  `mCueThread` corre, pero no ejecuta funciones cue del juego.
- `flushLog`, `writeSave`, `writeMultiSave` y `persistCustomSave` son stubs registrados.
- La mayoría de las funciones del juego que llaman los cuerpos son stubs del harness (las de Runner/Thread, el Stage,
  la `Seq` y `0x509570` son reales).
- H-B2 está modelado en Python: tabla de decisión y barrera rev3. La implementación C++ de GE-151 todavía no existe.

## Cómo lo reproduce GE-151 (todo local, nada se sube)

```sh
# 1) ELF del módulo con el builder fijado (Clang 19.1.7 en PATH; cmake/ninja fijados en un venv)
python -m venv /tmp/gbv && /tmp/gbv/bin/pip install cmake==3.31.6 ninja==1.11.1.4 capstone==5.0.7 pyelftools==0.33
PATH=/tmp/gbv/bin:$PATH python tools/build_engine.py --loader /ruta/loader-a321204 \
  --std /ruta/stdlib-extraida/lib/std --out /ruta/fuera-del-repo --build
export GE_MODULE_ELF=/ruta/fuera-del-repo/build/GrooveHT3.nss       # ELF, no el .nso
export GE_MAIN_IMG=/ruta/privada/main.img                            # main 03FF4A3B descomprimido y en plano
# 2) T10 (desde una copia de grok/stage-owner o grok/dynamic-stage-research)
cd reports/GE-152/unicorn
pip install unicorn==2.1.4 capstone==5.0.7 pyelftools==0.33
python exp_t10.py "$GE_MAIN_IMG" "$GE_MODULE_ELF" /tmp/t10.json     # esperado: exit 0, FAILURES: 0, 14 entradas
python exp_owner3.py "$GE_MAIN_IMG" /tmp/o3.json                    # esperado: exit 0, 15 entradas
```

Notas:
- `mmh==2.2` (de `engine-build-requirements.txt`) no compila sin las cabeceras de Python y no hace falta para el build.
- El loader se usa sin modificar. El builder verifica el pin.

**Criterios de aceptación de T10:**
- finalizar / abandonar / reintentar con barrera OK;
- 0 appends tras cancelar, 0 eventos de hijos en el teardown, 0 accesos tardíos;
- Stage y `Seq` liberados y lista global limpia;
- los dos fallos sin retorno dejan el grafo intacto y no hacen E/S;
- 0 llamadas a punteros nulos, 0 accesos no mapeados o a la página nula.

Si GE-151 cambia los hooks o los cuerpos, por ejemplo con el H-B2 en C++, `exp_t10.py` localiza las funciones por
**nombre de símbolo** del ELF (TrampolineFunc `$_1`, `$_2`, `$_4`, `$_5` y sus `TrampolineStaticBackup`).
Si cambia la numeración de las lambdas, hay que ajustar esos nombres en `setup_ht2` / `setup_r21`.
