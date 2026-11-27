# GE-152 — Auditoría del PR #6 (Codex, GE-151 "engine v0.5.1 hardening")

- Revisado: `codex/engine-v0.5.1-hardening` @ `07f78337c366156809e13f74f3839221047eb3aa` (código en `ff2adc2a`). El HEAD actual es `1a67208f`, que solo añade informes y herramientas de pila (`NATIVE_LIFECYCLE_FOLLOWUP.md`, `audit_engine_stack.py`) y **no cambia el runtime**.
- Tipo: **solo revisión estática del diff** (`git diff 6187390..07f78337`). No he ejecutado sus pruebas ni sus builds. No he tocado su rama.

## 1. Qué cambia (resumen)

| Área | Cambio | Fichero |
|---|---|---|
| Parsers | Fuente de 1 a 61440 B (= 60 KiB), ≤ 4096 líneas, ≤ 255 B por línea; rechazo de NUL/control/UTF-8 inválido; ≤ 12 tokens (GTL1 ≤ 4); trabajo de expansión ≤ 32768; profundidad ≤ 8; ticks con suma comprobada | `parser_support.hpp`, `gtf.cpp`, `timeline.cpp`, `multi.cpp` |
| Cadenas | Arenas persistentes con deduplicación (GTF 64 KiB, GTLM 8 KiB, GTL1 4 KiB) y vuelta atrás si el parseo falla | `parser_support.hpp` |
| Concurrencia | `TryLease` atómico **sin espera** (`gLogBusy`, `gInputBusy`, `parserBusy`, `metadataBusy`) | `parser_support.hpp`, `main.cpp` |
| Metadatos del mapa | `scanTileTitle` ejecuta el **parser completo** sobre `metadataSingle/Multi` antes de aplicar `title/match/prologue/jingle` | `metadata.hpp` |
| Cues | Validación generada desde `engine_contract.json` (127 perfiles, máscara RING, 3 variantes de Thunder rechazadas) | `cue_validation.hpp` |
| Guardado propio | `persistCustomSave`: tmp + flush → `path→.bak.N` → `tmp→path` → restaurar si falla; hasta 64 pares N | `save_replace.hpp`, `main.cpp` |
| Ciclo de vida | ctor: `if (gHt3Stage/gMultiStage) return orig` (no reutiliza un timeline vivo); dtor: llama a `orig` **antes** de soltar el timeline | `main.cpp` |
| Resultados | Multi: `resultsMode = 0` siempre (exit); HT3/DH sin cambios (siguen pudiendo usar resultados nativos) | `main.cpp` |
| Hilos | `oNew` nulo → registro en el log y no se crea el hilo | `main.cpp` |

## 2. Efectos en GE-152

1. **`exit` no aísla** (confirmado por GE-152). `beginPlay` (`0x48B0`) y `launchA` (`+0xBB3`/`+0xBB4`) escriben antes del ctor, e `initGameplay` deja `rank = 1` pendiente. Al volver al mapa, `commitResult` puede poner a cero los perfectos del anfitrión. Ver `codex-pr5-answers.md` §2 y `native-save-isolation.md` §3. Hacen falta las fronteras F0–F3 de GE-152; no basta con PR #6.
2. **Teardown**: el comentario "Keep timeline ownership through native child teardown" supone que los hijos terminan dentro de `orig(stage)`. Estáticamente, **no** es así: el join es posterior (reap del Runner `0x515450` o limpieza `0x515290`). Ver `codex-pr5-answers.md` §1. El código del motor tras `tStop()` debe seguir sin tocar `stage`/`gTl`.
3. **HT3/DH en modo nativo**: `results native` en HT3 escribe en `kind1[41]` (HT2) a través de `commitResult`. En el modo paquete de GE-152 hay que forzar `custom` también en el adaptador `hoop`.
4. **Guardado propio: límite de 64 pares**. `persistCustomSave` no borra nunca `.bak.N`/`.tmp.N`. Cuando están los 64 ocupados, rechaza el guardado ("backup slots full"). Como hay una escritura por partida, **a partir de la partida 65 del mismo destino ya no se guarda nada**. Además, cada guardado hace hasta 128 `fileExists` (aperturas en la SD). Para `custom-saves/<id>.gsv` hace falta una variante con rotación acotada (§4).
5. **`TryLease(gInputBusy)` silencioso**: `writeSave`/`writeMultiSave` vuelven **sin registro en el log** si el candado está ocupado (por ejemplo, `loadTileTitles` refrescando el mapa mientras termina un stage). Las estadísticas se pierden sin aviso. Propuesta: registrar en el log y reintentar en el siguiente contexto normal.
6. **Metadatos con el parser completo en el mapa**: es aceptable con 2–3 timelines fijos. Con 256 paquetes, no: el registro de GE-152 lee **`manifest.json`** (≤ 16 KiB, `title` ya validado por la herramienta del host) y el timeline solo se parsea al lanzar. `metadata.hpp` queda para la ruta antigua `.gtl`.
7. **`match`**: `validMatch` admite `w −1..2`, `c 0..11`, `r 0..4`, igual que la rejilla real `kGrid[3][12][5]` [V]. En modo paquete la casilla la asigna el runtime y `match` se ignora (GROOVE_SPEC).
8. **Límites**: 61440 B coincide con "timeline ≤ 60 KiB" de GROOVE_SPEC. `title[96]`: el manifiesto debería limitar `title` a ≤ 95 B UTF-8 (hoy se trunca).
9. **Arenas persistentes**: una cadena publicada a objetos nativos (nombres de escena) no se mueve. Bien para GE-152. Pero con 256 paquetes y sesiones repetidas, la deduplicación solo evita repeticiones idénticas, y GTF 64 KiB puede llenarse. Hace falta un reinicio de la arena **solo** cuando no hay stage vivo (después del reap; ver §1.4 de las respuestas).

## 3. Dependencias de GE-152 respecto a PR #6

| GE-152 necesita | Estado en PR #6 |
|---|---|
| Parsers acotados para timelines de paquetes | ✔ (límites compatibles) |
| `results: custom` en los dos adaptadores | ◐ solo Multi; falta HT3/hoop |
| Reemplazo atómico con backup acotado | ◐ existe, pero sin rotación (límite de 64) |
| Fronteras de aislamiento antes de `beginPlay` | ✘ fuera de su alcance; las propone GE-152 (F0–F4) |
| Prueba de vida útil de los hijos | ✘; GE-152 aporta la cadena estática, falta la dinámica |

## 4. Propuesta (sin tocar el runtime de Codex)

`replaceCustomSaveRotating(fs, path)`, con nombres fijos `path.tmp` y `path.bak`:
1. borrar `path.tmp` si existe (resto de un fallo anterior);
2. crear, escribir y hacer flush de `path.tmp`;
3. si existe `path`: borrar `path.bak` y renombrar `path → path.bak`;
4. renombrar `path.tmp → path`; si falla, `path.bak → path`.

Al cargar: si `path` no existe o es inválido (magic/CRC/id), usar `path.bak`.
Ocupa como máximo 3 ficheros por id y hace ≤ 3 operaciones de existencia por guardado. Sigue sin ser atómico ante un corte de corriente, pero es recuperable al cargar.
