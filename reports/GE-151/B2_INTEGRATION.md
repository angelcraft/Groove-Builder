# GE-151 (interino Grok) — Integración H-B2 + constructores + Custom Remixes A/B

Rama: `grok/engine-b2-integration` desde `98112a9` (rama de Codex sin modificar).
Autor: Grok Bot (GE-151 interino, Codex sin cuota; autorización del propietario).
Revisión seguida: GE-154 #5 7241433453. Estado: **build de integración 0.6.0, NO release,
NO candidato instalable, NO probado en Switch**.

## Qué se implementó

### H-B2 en C++ (`engine/src/b2_owner.hpp`, `b2_entries.S`, `main.cpp`)
- Hook de `destroyPending 0x5096F0` mediante entrada ASM (`groove_b2_destroy_entry`: `mov x1,x30`) que
  entrega el LR real; sólo se reconoce el llamador `0x50A060`.
- Sesión B2 por generación (`b2Open` en el ctor HT2 / R21 legacy / V0 tras el original); tabla de decisión
  §3.1: NoSession / Foreign / NoNext → original sin tocar; identidad fallida → **safe-stop** (`svc Break`).
- Comprobaciones de identidad/ABI: vptr del Seq (5 deleting dtors), back-pointer Stage, runner, estado,
  recorrido acotado de la lista de hijos (detección de ciclos, cota), coherencia estado/handle, punteros
  plausibles (fuera de main y < 2^39), hilo principal (`nn::os::GetCurrentThread`) antes de cada join.
- Barrera: estado>3 → stop; `wr 2`, fence, signal a todos, join con cota de 8 rondas; postcondición
  estado 2/3 y handle 0. Sólo tras la barrera: guardado (HT2 fallback / R21 legacy multi / V0 quiet_token
  con `aborted=!finished`) y flush del log; después original y cierre de sesión.
- 15 tripwires sobre dtors Seq, HT2/R21 (deleting + thunks −0x2978/−0x2990/−0x29B0/−0x2C78 y R21 −0x3548)
  y `~SceneMgr 0x509640`: si se alcanzan con sesión abierta → safe-stop. Verificación de firmas
  (`kSigsB2`, 17 sitios + signal/join) antes de instalar; si falla, no se instala nada de B2/V0.
- Dtors: observadores puros (log + original), **sin I/O**.

### Correcciones T10
- `tStop` comprobado al inicio de `spawn/spawnR21` (sin hilo tardío tras cancelación) y antes de cada
  llamada al juego en los bucles cue/bg/latency/mCue/mSwitch/mDirector; re-check tras guardar.
- Salida custom = semántica **Quit** nativa (`0x132E58`): `setNextScene(ctx, *(int*)0xDAB880,
  *(void**)0x10B5A98)` + `exitToMenu(ctx,1)`. Se elimina `flags|=1, ctx+8` (era el Retry nativo
  `0x133024`). Sin escena de retorno → log + `enablePause`, sin cambio de escena. Retry explícito separado.
- GSV/H9: `syncCapable()` se comprueba **antes** de cualquier mutación (commit/restoreBackup); con
  `V0NnFiles` (syncDirectory no acreditado) devuelve Pending sin escribir en SD. No se simula persistencia.

### Integración de constructores / V0
- `r21CtorHook`: V0 (fase Armed, sin multi legacy, sin sesión B2) → `Execution` construye el Custom Remix
  vía factory (`r21CtorHook.orig` + adopción: timeline, título, slots, `gMultiV0`); legacy multi aparte y
  requiere `b2Open`. HT2: si B2 no está listo → ruta nativa.
- `bindV0()` crea el Backend estático (`mapInitHook` = carga SD + configure; `persistOnMapReturn`).
  `installV0` exige B2 + multi + firmas `kSigsV0` (19 sitios + perfectTarget); MapInit se instala el último.
- Corrección encontrada por emulación: `launchA` nativo escribe el modo de mapa en `mgr+0x2904`
  (`0x1D3430`) antes de beginPlay, así que el guard de InitGameplay que exigía `-1` rechazaba siempre
  el Custom Remix. Ahora acepta modo ∈ {-1,0,1} con `curIdx[0]=curIdx[1]=-1` (setPending `0x4910`
  sólo escribe si modo≥0 **y** curIdx[modo]≥0, E10). Test host actualizado.
- `groove_hook_plan` exportado (plan de hooks para el harness); `groove_emu_*` sólo para emulación.

## Pruebas

- `python3 tools/run_engine_tests.py`: rc 0 — 19 métodos Python, GTF, y binarios ASan/UBSan
  (nuevo `test_b2_owner`: tabla de decisión y barrera).
- `tools/check_v0_arm64.py` y `tools/verify_engine_artifacts.py` pasan sobre el build final.
- `tests/emulation/b2int.py`: **44 casos, 0 fallos** (`B2_INTEGRATION_RESULTS.json`). Ejecuta el ELF
  final cargado sobre la imagen main privada (no publicada; sólo su SHA-256) con Unicorn; cada caso en
  un proceso. Cubre HT2 y R21 legacy (finish, abandon@2/@3, retry A→B con generación+1, cuerpo atascado,
  6 fallos de identidad, LR, foreign/no-next, 4 tripwires, spawn tardío, B2 no listo, sin escena de
  retorno) y V0 A/B × finish/abandon: launch real, mapDtor, ctor vía hook, ticks, destroyPending, retorno
  al mapa con getSel en el call site real `0x1CE03C`, writeSave nativo.
  - V0 A/B finish: Execution construye, finish confirmado, Quit sin retry, barrera 1 ronda/5 hilos,
    quiesced=1, teardown limpio, cursor restaurado a la ranura, sin cambios en SD ni blob nativo,
    fase H9 = Pending, segundo launch rechazado.

```
cd tests/emulation
python b2int.py <main.img privado> <build>/build/GrooveHT3.nss <sd-tree> [out.json]
# B2INT_ONLY=<prefijo> B2INT_VERBOSE=1 ; requiere unicorn 2.1.4 + pyelftools
```
El sd-tree local se genera con `tools/make_v0_custom_remixes.py` + instalador GE-155 4ef9746 (A ranura 0,
B ranura 1) y un `sd:/groove/engine.json` escrito a mano (paso de release, sin herramienta aún).

## Límites (no inventar resultados)
- Planificador cooperativo determinista; semántica Horizon (preempción, join real, nn::fs real, GPU/audio)
  NO ejecutada. FakeSD, no SD real. No Switch.
- syncDirectory no acreditado → H9 Pending → **una partida custom por arranque** (la sesión queda
  abierta y el siguiente launch se rechaza). Es el bloqueo principal de "jugable" repetible.
- Retry de pausa durante una sesión V0: el segundo Stage sería REMIX_21 nativo e InitGameplay V0 lo
  rechaza por stage distinto → requiere diseño (retry explícito separado); no implementado.
- tx-ID = tick<<12 ^ contador, no acreditado entre reinicios.
- Visual de columna 9 / mundo 0, IPS y visibilidad de las celdas: sin verificar.
- Legacy H9 y custom H9 siguen separados; no se mezclan resultados.
