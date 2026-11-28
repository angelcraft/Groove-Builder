# GE-152 → GE-151: CODEX_HANDOFF rev3 — frontera B2 del propietario del Stage (implementable)

Build `03FF4A3B`. Direcciones = offsets desde la base de `main`. Sustituye a §10 de `STAGE_OWNER.md` (rev2) y amplía
`CODEX_HANDOFF.md` (V0, que sigue vigente para la parte V0). Contenido saneado: solo direcciones, offsets,
contadores y etiquetas. Ningún binario, romfs, IPS, cabecera SDK ni volcado.

Etiquetas: **[S]** estático sobre `main`; **[U]** Unicorn con código real del juego + `sched.py` (cooperativo,
**no Horizon**); **[H]** hipótesis; **[C]** revisión del código fuente de GE-151 (`origin/codex/engine-v0.5.1-hardening`
@ `195a0e5`, solo lectura, no compilado ni ejecutado).

Sin pruebas físicas ni cambios en la Switch (no autorizadas).

---

## 0. Qué cambia respecto a rev2

1. **Scheduler corregido** (hallazgo de Codex `discussion_r4727444769`). `Sched._run` solo devuelve "retorno normal"
   si `PC == RET`. Agotar el presupuesto ya no se confunde con `exit`: el hilo pasa a `preempted` y, tras 4 presupuestos
   sin bloquearse ni volver, a `runaway`. Un `runaway` nunca está `done` y su `join` no se cumple nunca. En el hilo
   principal, el agotamiento lanza `BudgetExhausted`. `harness.H.call` aplica la misma regla.
   Las trazas distinguen `exit` / `preempt` / `RUNAWAY` / `MAIN_BUDGET` / `DEADLOCK`.
2. **Barrera sobre todo el Runner** `seq+0x58`, no solo el grupo del Stage. rev2 dejaba fuera los hilos de otros grupos.
   Un control nuevo lo demuestra: un hilo del grupo de la `Seq` (`seq+0xEB0`) que referencia el Stage se reanuda
   después del `free` del Stage con la barrera rev2 (1 acceso tardío). Con la barrera rev3: 0 accesos.
3. **Contradicción de §10 resuelta** (tabla de decisión, §3). Una llamada ajena va a `orig`. Una sesión propia
   activa con LR, propietario o identidad incoherentes provoca una parada segura sin retorno. Nunca se desmonta la
   sesión propia sin una barrera aprobada.
4. **Semántica nativa de estados** en la barrera (igual que `0x514BC0`). Los hilos que no existen en el SO no se
   señalan ni se joinean.
5. **Rutas** finalizar / abandonar / reintentar / HOME / apagado clasificadas (§2). Apagado: `0x509640` es un
   segundo punto de borrado de la escena, estáticamente inalcanzable, y se cubre con un tripwire.
6. **Tope del punto fijo** con agotamiento real (no forzado): falla con 8 rondas completas, sin empezar la 9.ª.

## 1. Evidencia de esta revisión

Comando: `python exp_owner3.py $IMG results/owner3_results.json` → **`exit 0`, `FAILURES: 0`**. El JSON tiene **15 entradas**
(no 17, como se dijo por error en el comentario de rev3): 6 de éxito, 2 del grupo `Seq` (rev2 y rev3), 2 de worker en
bucle (corregido y legacy), 1 de `main` truncado que agrupa 3 comprobaciones (`Sched.call`, `H.call` y legacy),
1 de agotamiento, 1 de self-join y 2 de reintento.
También se repitieron, con el scheduler corregido:

| Script | Salida | Diferencia con rev2 |
|---|---|---|
| `exp_b2.py` | `FAILURES: 0` | idéntica byte a byte |
| `exp_v0.py` | `FAILURES: 0` | idéntica byte a byte |
| `exp_owner.py` | `FAILURES: []` | idéntica |
| `exp_owner_static.py` | `FAILURES: []` | idéntica |
| `exp_owner2.py` | `FAILURES: 0` | idéntica byte a byte |

Con un contador instrumentado, ninguno de esos cinco scripts produce eventos `preempt`, `RUNAWAY`, `MAIN_BUDGET`,
`DEADLOCK` ni `H.call` sin retorno. El defecto del scheduler no enmascaraba ningún resultado previo, pero ahora es
imposible que lo haga.

Resultados de `exp_owner3.py` [U]:

| Escenario | Barrera | Resultado medido |
|---|---|---|
| HT2 B2 rev3, ticks 1/3/6 | OK, 1 ronda (1 hilo) | Stage, `Seq` y 1 hilo liberados. 0 accesos tardíos, 0 eventos de hijos en el teardown, 0 appends durante la barrera, lista global limpia. |
| R21 B2 rev3, ticks 1 | OK, 1 ronda (11 hilos; **10 en estado 0**, 1 en estado 1) | Igual: 11 hilos liberados, 0 accesos tardíos. Los hilos en estado 0 no se señalan ni se joinean. |
| R21 B2 rev3, ticks 3/6 | OK, 1 ronda (10 en estado 2, 1 en estado 1) | Igual. |
| Hilo del grupo `Seq` que toca el Stage, **barrera rev2** | "OK" (falso) | **1 evento de hijo en el teardown y 1 acceso tardío** al Stage liberado. Control: expone el hueco de rev2. |
| Mismo hilo, **barrera rev3** | OK, 2 hilos | 0 eventos y 0 accesos tardíos. Todo liberado. |
| Worker bloqueado en bucle infinito tras `tStop`, scheduler corregido | **falla**: el join no termina | 3 `preempt`, 1 `RUNAWAY`, `DEADLOCK`. Grafo intacto: Stage, `Seq`, Runner, lista global y padre. Nada del grafo liberado. |
| El mismo worker con el **scheduler legacy** (rev2) | "OK" (falso) | El hilo queda marcado `done` sin haber salido. Control: reproduce el defecto. |
| `main` truncado (`b .`) | — | `Sched.call` y `H.call` lanzan `BudgetExhausted`. Con el scheduler legacy, "retorna" `x0 = 0`. |
| Agotamiento real del punto fijo: cada hijo que sale enlaza un hermano **vivo** (estado 1, bloqueado) | **falla tras 8 rondas** `[1,1,1,1,1,1,1,1]` | 7 hermanos en `(2, done)`. El 8.º sigue en `(1, blocked)`, nunca señalado: la ronda 9 no empieza. Grafo intacto. Solo se liberan objetos `heap` propios de los hijos (8, ninguno del grafo). |
| Guarda de self-join | OK | Evaluada en el hilo principal: `true`. Evaluada 2 veces desde contexto hijo (en `tStop`): `false` las 2. |
| Reintento HT2 / R21: A destruida → B creada en el mismo harness → B destruida | OK | Tabla de decisión (§3): ajena → `orig`; LR malo → parada segura; `mgr+0x18 < 0` → `orig`; propia válida → barrera. A y B liberadas, 0 accesos tardíos. Generación 1 → 2. La `Seq` antigua no se acepta en B. |

Los cuerpos de los hilos del harness son ARM64 codificado a mano, fuera de la imagen, y modelan el contrato de los
cuerpos de GE-151 (wait → `tStop` → salir). **No son el módulo de GE-151 compilado.**

## 2. Rutas de salida de un nivel

Base estática [S]:
- `setNextScene 0x509570(scene, id, arg)` escribe `scene+0x18` y `scene+0x20`, nada más (lo mismo `0x509580`).
- `SceneMgr::update 0x509740`, llamado en `0x50A090`, hace dos cosas:
  - llama a `cur->vt+0x10`, que en la `Seq` es el tick `0x132300` y es donde se ejecutan los hijos;
  - si `cur->vt+0x18` lo permite, copia `cur+0x18/+0x20` a `mgr+0x18/+0x20` (`0x5097BC`).
- En el frame siguiente, `0x509F50` llama a `destroyPending 0x5096F0` en `0x50A05C`, con LR `0x50A060`.
  `0x5096F0` borra `cur` mediante `cur->vt+8` en `0x509724` (LR `0x509728`) solo si `cur != 0 && mgr+0x18 ≥ 0`,
  y después pone `mgr+0x10 = 0`.
- Justo después, `0x509740` crea la escena siguiente con la fábrica `mgr+8 → vt+0x18`.
- `0x5096F0` solo tiene un llamador directo (`0x50A05C`) y ningún puntero a él.

| Ruta | Llamada | Llega a `0x5096F0` | Nota |
|---|---|---|---|
| Finalizar (resultados) | El worker llama a `toResults 0x138D40` → resultados → `setNextScene` sobre la `Seq` | sí [S] | GE-151 usa la misma ruta (`oToResults`). |
| Reintentar | `0x133070` (tick `0x132DB0`) y `0x13350C` (`0x1332E0`): `setNextScene(seq, *(seq+8), 0)`, es decir, **el mismo id** | sí [S] | En el mismo frame: `0x5096F0` destruye la `Seq` A y `0x509740` construye la `Seq` B con un Stage B nuevo. `seq+0xA078` solo lo escriben el ctor y el dtor de la `Seq`: un Stage no se reutiliza entre intentos. |
| Abandonar (pausa → Salir) | `0x138F58` (`0x138E78`, método del Stage base): `setNextScene(*(stage+0x29D8) = seq, 0xF, 0)`. Otra ruta: `0x132E74` (id global vía GOT `0xD98408`). | sí [S] | No se ha verificado qué botón corresponde a cada sitio [H]. Todos convergen en el mismo punto, que es lo que importa. |
| Salida propia de GE-151 | `ht3Worker` / `multiWorker`: `setNextScene(ctx, *(ctx+8), nullptr)` + `0x130500(ctx, 1)` [C] | sí | Como "reintentar" en id. Lo hace un hijo y el traspaso ocurre en el frame siguiente. |
| HOME | Sin cambio de escena. El proceso se suspende y el bucle de frame deja de avanzar. | **no** | Correcto: los hijos siguen aparcados y no hay teardown [H, semántica del SO]. |
| Apagado / cerrar software | `0x50D060`: `bl 0x509F50; b 0x50D074`, un bucle **sin arista de salida** [S]. El App y el SceneMgr no se destruyen y el SO termina el proceso. | **no** | `~SceneMgr 0x509640` borraría `cur` en `0x509670` (LR `0x509674`) sin pasar por `0x5096F0`, pero solo es alcanzable desde los dtors de App (`0x50CC90` → `0x509EA0`), que el bucle nunca invoca [S]. Se cubre con un tripwire (§6). |

Otros escritores de `mgr+0x18`, fuera del código del SceneMgr, no están descartados estáticamente [H]. Da igual: la
guarda decide por la identidad de `cur`, no por quién pidió el cambio.

## 3. Hooks, direcciones y guardas

Todos los prólogos empiezan por `stp x29, x30, [sp, #-N]!` (sin ADRP), así que admiten trampolín [S].

| Id | Dirección | Tipo | Función |
|---|---|---|---|
| **H-open** | post de `0x428D70` (HT2) / `0x4202C0` (R21), ya enganchados (`ht2CtorHook` / `r21CtorHook`) | post | Abre la sesión: `gSess = {active=1, gen++, seq=x1, stage=self, kind, passed=0}`. |
| **H-B2** | pre de `destroyPending 0x5096F0(mgr)` | pre, decide | Barrera y tabla de decisión. |
| H-tw-seq | pre de los deleting de `Seq`: `0x2AB5F0`, `0x2ABA50`, `0x2ABEB0`, `0x2AC310`, `0x2AC750` | tripwire | Si `this == gSess.seq && !gSess.passed` → parada segura. En los demás casos, `orig`. |
| H-tw-stage | pre de los deleting del Stage `0x4291A0` (HT2) / `0x420C40` (R21) y sus thunks `0x4291D0`, `0x429200`, `0x429230`, `0x429260`, `0x420C70`, `0x420CA0`, `0x420CD0`, `0x420D00` | tripwire | Si la base ajustada `== gSess.stage && !gSess.passed` → parada segura. En los demás casos, `orig`. |
| H-obs | los hooks actuales de `0x4290F0` / `0x4207F0` (`dtorHook` / `r21DtorHook`) | observador | **Siempre** `orig`. No deben hacer nada que dependa de hilos (§5.4). |
| H-tw-mgr | pre de `~SceneMgr 0x509640(mgr)` | tripwire | Si `gSess.active && *(mgr+0x10) == gSess.seq` → parada segura (inalcanzable [S], defensa). |

Cálculo de la base ajustada en los thunks del Stage: `base = this − 0x2978`, `− 0x2990`, `− 0x29B0` y `− 0x2C78` (HT2)
o `− 0x3548` (R21), en el orden de las direcciones de la tabla.

Constantes de identidad [S, U]:
- vptr de la `Seq`, es decir `*(seq) - base`:

  | Clase | vptr |
  |---|---|
  | 0 | `0xD2B730` |
  | 1 | `0xD2B988` |
  | 2 | `0xD2BBE0` |
  | 3 | `0xD2BE38` |
  | 4 | `0xD2C090` |

  En las cinco, `vt+8` es el deleting de la tabla H-tw-seq y `vt+0x10 = 0x132300`.
- `*(seq+0xA078) == stage`. Lo escribe el ctor de la `Seq` **después** del ctor del Stage, así que en H-open todavía
  no está.
- `*(stage+0x29D8) == seq`; `*(stage+8) == seq+0x30`; `*(stage+0x2980) == seq+0x58`.
  En HT2 además `*(stage+0x2C80) == seq+0x58`; en R21, `*(stage+0x3550) == seq+0x58`. Verificado [U] en los dos tipos.
- Runner = `seq+0x58`. Lista simple de hilos en `runner+8`, siguiente en `th+8`.
- Campos del hilo:

  | Campo | Significado |
  |---|---|
  | `th+0x250` | estado 0..3 |
  | `th+0x254` | gid |
  | `th+0x220` | evento de reanudar |
  | `th+0x208` | evento de ceder |
  | `th+0x28` | objeto hilo del wrapper |
  | `th+0x1F0` (`= th+0x28+0x1C8`) | handle del SO (≠ 0 solo si el hilo se creó) |
  | `th+0x30` | `nn::os::ThreadType` |

- Funciones reales que usa la barrera: `0x4DFC70` (señalar), `0x4DFB60` (join; no hace nada si `th+0x1F0 == 0`;
  si no, espera, destruye el hilo y pone el handle a 0).

### 3.1 Tabla de decisión de H-B2 (resuelve §10)

```
pre_destroyPending(mgr):                       // LR = __builtin_return_address(0) del trampolín
  cur = *(mgr+0x10); nxt = *(int*)(mgr+0x18)
  if (!gSess.active)              return orig(mgr);          // sin sesión: no es nuestro
  if (cur != gSess.seq)           return orig(mgr);          // escena ajena: no es nuestra
  // a partir de aquí cur ES nuestra Seq: cualquier incoherencia = parada segura, nunca orig
  if (LR != base+0x50A060)        safe_stop("H-B2: LR");
  if (!seq_vptr_ok(cur))          safe_stop("H-B2: vptr Seq");
  if (*(cur+0xA078) != gSess.stage || *(gSess.stage+0x29D8) != cur
      || *(gSess.stage+0x2980) != cur+0x58) safe_stop("H-B2: identidad");
  if (on_runner_thread())         safe_stop("H-B2: self-join");
  if (nxt < 0)                    return orig(mgr);          // 0x5096F0 no destruye nada en este caso [S]
  r = barrier(cur+0x58, 8);
  if (!r.ok)                      safe_stop(r.why);          // nada destruido
  gSess.passed = 1;
  save_fallback_if_needed();      // opcional, aquí y no en el dtor (§5.4)
  ret = orig(mgr);                // teardown nativo SIN cambios
  gSess = {active=0, gen=gSess.gen};                          // la sesión se cierra; un reintento abre gen+1 en H-open
  return ret;
```

Nota: "sin sesión, va a `orig`" incluye el caso en que H-open no llegó a abrir la sesión (fallo del ctor). En ese
caso no hay cuerpos del motor que proteger.

## 4. Barrera (pseudo-código exacto, validado en `exp_owner3.barrier3`)

```
struct BarrierResult { bool ok; const char* why; int rounds; };
BarrierResult barrier(Runner* r, int cap /*=8*/) {
  Thread* seen[MAX]; int nseen = 0, rounds = 0;
  for (;;) {
    Thread* kids[MAX]; int n = 0;
    for (Thread* t = r->head /*r+8*/; t; t = t->next /*t+8*/)          // TODO el Runner, todos los grupos
      if (!contains(seen, t) && t->state /*+0x250*/ != 3) kids[n++] = t;
    if (n == 0) break;                                                  // punto fijo
    if (rounds == cap) return {false, "no fixed point", rounds};        // nunca empieza la ronda cap+1
    rounds++;
    for (i) if (kids[i]->state == 0 || kids[i]->state == 1) kids[i]->state = 2;   // 1) publicar cancelación
    for (i) if (kids[i]->osHandle /*+0x1F0*/) signal(&kids[i]->resume /*+0x220*/); // 2) despertar (0x4DFC70)
    for (i) { if (kids[i]->osHandle) join(&kids[i]->wrap /*+0x28*/);              // 3) join (0x4DFB60)
              seen[nseen++] = kids[i]; }
  }
  for (Thread* t = r->head; t; t = t->next)                             // postcondición
    if (t->state != 2 && t->state != 3) return {false, "post: state", rounds};
    else if (t->osHandle) return {false, "post: handle", rounds};
  return {true, nullptr, rounds};
}
```

- Un join que no termina deja un cuelgue con el grafo intacto: **sin timeout** seguido de destrucción. Un timeout, si
  se añade, solo puede llevar a `safe_stop`.
- La barrera no toma ningún lock del módulo (ni el del log) mientras señala o hace join. El log se escribe antes o
  después.
- El estado 3 no aparece antes del teardown nativo. Se trata como "ya terminado" por compatibilidad con
  `0x514BC0` [S].
- `MAX`: R21 tiene 11 hilos medidos más los del motor (unos 11 en `multiWorker` [C]). Se recomienda 64, y si se
  supera, `safe_stop`.

Por qué es suficiente [S + U]:
- **Spawn cerrado.** Append `0x5153A0` no tiene lock y solo lo llama código que corre en contexto hijo. Los hijos
  solo corren mientras el hilo principal está bloqueado en step/join (traspaso estricto `0x514E00` ↔ `0x514D70`).
  Durante la barrera, los únicos hijos que corren son los que ella misma despierta, y ya ven `state == 2`.
  - Spawn nativo de R21 en `0x4207AC`: precedido por `tStop` en `0x420784`.
  - GE-151: `spawn()` y `spawnR21()` solo se llaman justo después de un `tStop` falso y sin ceder entre medias [C].
  - Medido: 0 appends durante la barrera en los 6 casos de éxito.
  - Un hermano añadido en estado 0 se cancela sin ejecutarse.
  - Solo un hermano ya arrancado (estado 1) puede alargar el punto fijo, y lo corta el tope.
- **Lista estable.** Fuera de la barrera nadie añade ni quita: la quita solo ocurre en el dtor nativo (`0x515290`).
- **Estado 0.** Se marca 2 y no se señala ni se hace join (handle 0). El `0x514BC0` nativo sobre un estado 2 sin
  handle no espera nada (guarda de `0x4DFB60`) [S, U con ticks 1: 10 hilos en estado 0].
- **Self-join** (`on_runner_thread()`):
  - En el módulo: `nn::os::GetCurrentThread()` no debe ser `&th->os` (`th+0x30`) para ningún hilo de la lista, y
    debe coincidir con el hilo principal capturado en el primer frame.
  - Con LR `0x50A060` es imposible estar en contexto hijo, pero se comprueba igual.
  - [U]: `false` en las 2 evaluaciones desde contexto hijo, `true` en el principal.
- **Locks.**
  - En lo alcanzado por los cuerpos nativos, el contexto hijo no hace ninguna llamada PLT fuera de las de hilos y
    eventos (aparte de `0xA66100`, valor TLS en `0x4DFDF0`) [U].
  - `0x5096F0` (`0x50A05C`) y `0x509740` (`0x50A090`) se llaman al mismo nivel de `0x509F50`, y los hijos ya corren
    cada frame dentro de `0x509740`. Un lock que `0x509F50` mantuviera en `0x50A05C` lo mantendría también allí.
  - Residual [H]: un lock tomado antes de `0x50A05C` y liberado entre `0x50A060` y `0x50A090`. Solo hay dos `blr`
    ahí (`0x50A074`, `0x50A088`), y solo en frames con cambio de escena. Si pasara, el resultado sería un cuelgue con
    el grafo intacto, no un UAF.
- **Otros grupos y recorridos globales.**
  - La barrera cubre todo el Runner (control rev2 frente a rev3, §1).
  - No se encontró ningún spawn estático en el grupo `seq+0xEB0`. De los 4486 llamadores de `0x514A90`, ninguno con un
    desplazamiento inmediato lee el gid desde `+0xEC0`/`+0xEE0` (los de la `Seq`); unos pocos con origen indirecto
    quedan sin resolver [H]. Los spawners del Stage base (`0x1379A0`, `0x137A80`, `0x139250`,
    `0x139700`) leen `stage+0x29A8` [S].
  - El gestor global `*0x10BD820` solo lo leen `0x4EE260` (alta por defecto) y `0x4EEEC0` (setter) [S]. El nodo del
    Stage lo quita su propio dtor base (`0x4EE330(stage+0x2B20)`) antes del `free`, en el hilo principal.
  - Ningún hilo del Runner corre durante el teardown tras la barrera (0 eventos medidos).

### 4.1 Requisitos de la implementación real (revisión GE-154 7241265172)

El modelo cooperativo **no prueba la exclusión multinúcleo**. En el módulo:
1. **Límites antes de escribir.** Comprobar `n < MAX` antes de `kids[n++]` y `nseen < MAX` antes de `seen[nseen++]`.
   Si se desborda: `safe_stop("barrier: MAX")`.
2. **Ciclos en la lista.** Limitar cada recorrido de `r->head → t->next` a `MAX` pasos (o usar Floyd). Un ciclo o un
   puntero no alineado o fuera del heap da `safe_stop`.
3. **Estados y handles.**
   - `state ∉ {0,1,2,3}` → `safe_stop`.
   - `state == 0` con `osHandle != 0`, o `state == 1` con `osHandle == 0` → `safe_stop`, porque es incoherente con
     `0x514E00`.
4. **Identidad e hilo.** Hacer las comprobaciones de §3.1 **antes** de leer la lista, y repetir `on_runner_thread()`
   justo antes de cada join.
5. **Sincronización nativa.**
   - Las escrituras `state = 2` deben ser visibles antes de `signal`. Usar la propia señal del juego (`0x4DFC70`)
     después de una barrera `std::atomic_thread_fence(std::memory_order_seq_cst)`.
   - Hacer el join solo con `0x4DFB60` (WaitThread + DestroyThread nativos).
   - No leer `t->state` de un hilo en ejecución sin haber hecho su join, salvo en la postcondición, que se evalúa
     después de todos los joins.
6. Las recomendaciones de §5.4 (E/S en el teardown) se confirman con el módulo real en `T10_RESULTS.md`.

## 5. Contrato de los hilos del motor (GE-151)

1. Cada espera (`tWait`, `waitTicks`, `oWaitReady`, `oWaitAudio`, `oPlayBgm`, `oWaitSlotLoaded`, `oSwitchCut`) va
   seguida de `tStop(th)`. Si es verdadero: `tPop` y `return`, con trabajo acotado y sin ceder de nuevo. [C]: se
   cumple en todos los cuerpos revisados (`cueThread`, `bgThread`, `latencyThread`, `control`, `ht3Worker`,
   `mControl`, `multiWorker`, `mCueThread`, `mSwitchThread`).
2. **Ningún spawn tras la cancelación.** [C]: se cumple por construcción. Recomendación (defensa): al principio de
   `spawn()` / `spawnR21()`, `if (tStop(parent)) return;`.
3. Ningún `setNextScene`, `toResults` ni `writeSave` después de que `tStop` sea verdadero. [C]: se cumple (`if
   (tStop) return` antes de `writeSave`).
4. **Los dtors no hacen trabajo de hilos.** `dtorHook` / `r21DtorHook` llaman a `writeSave()` /
   `writeMultiSave()` antes de `orig` [C]. Con B2 eso es E/S de SD dentro del teardown nativo. Recomendación: mover
   el guardado de respaldo a H-B2, después de la barrera aprobada y antes de `orig` (`save_fallback_if_needed`).
   Mantener el hook del dtor como observador puro (log y limpieza de globales del módulo como `gHt3Stage` /
   `gMultiStage`) y llamar siempre a `orig`.
5. Ningún cuerpo toma un lock del módulo que el hilo principal pueda tener durante la barrera. `logf` / `flushLog`:
   el hilo principal no debe tener el lock del log mientras hace join (§4).
6. Ningún cuerpo hace join ni step de un hilo hermano (el self-join se evita por diseño). Si se añadieran corrutinas
   anidadas con step propio, el tope de 8 rondas las acota y falla de forma segura.

## 6. Fallo y parada segura

`safe_stop(why)`, que **no retorna**:
1. Un registro en el log de SD ya abierto: `why`, `gen`, `rounds` y los estados de los hilos. Nada de E/S que pueda
   bloquear indefinidamente: si el log no está abierto, se omite.
2. **Ningún guardado** (ni `writeSave` ni `writeMultiSave`) y ninguna llamada a `orig`. No se toca `mgr` y no se
   libera nada.
3. `abort` explícito del módulo (el mecanismo de abort que ya usa el módulo, o `svcBreak`). Si no hay abort
   disponible, un bucle de `nn::os::SleepThread` (cuelgue con el grafo intacto).

**Nunca** "seguir con `orig`" tras una incoherencia de la sesión propia, ni un timeout seguido de destrucción.

Tripwires (H-tw-*): mismo `safe_stop`, con el motivo `"tw:<dir>"`.

## 7. Observadores y log (en modo solo registro primero)

- H-B2, en una sola línea: `gen`, `kind`, `rounds`, `per_round`, hilos por estado antes y después, `passed` y el
  tiempo de la barrera.
- H-obs (dtor del Stage): `passed` debe valer 1. Si vale 0, el tripwire ya habría parado antes.
- Contadores: llamadas a H-B2 por rama (`no-session`, `foreign`, `no-next`, `own`) y tripwires disparados.

## 8. Matriz de pruebas

| # | Prueba | Dónde | Estado |
|---|---|---|---|
| T1 | B2 éxito HT2/R21, ticks 1/3/6 (estados 0/1/2) | Unicorn `exp_owner3` | **pasa** [U] |
| T2 | Hilo de otro grupo (`Seq`) que toca el Stage: rev2 falla, rev3 pasa | Unicorn | **pasa** [U] |
| T3 | Worker en bucle infinito tras `tStop` → no quiescente, grafo intacto | Unicorn | **pasa** [U] |
| T4 | Control del scheduler legacy (rev2) → falso "done" | Unicorn | **reproduce** [U] |
| T5 | `main` truncado → `BudgetExhausted` | Unicorn | **pasa** [U] |
| T6 | Agotamiento real del punto fijo → falla en la ronda 8 y la 9 no empieza | Unicorn | **pasa** [U] |
| T7 | Guarda de self-join desde contexto hijo | Unicorn | **pasa** [U] |
| T8 | Reintento (A → B), tabla de decisión y generación de sesión | Unicorn | **pasa** [U] |
| T9 | Clases de `Seq` 0–4, nativo, B1 (control negativo), detector (control positivo) | Unicorn `exp_owner2` | **pasa** [U] |
| T10 | Cuerpos reales de GE-151 compilados (HT3 y Multi) con B2 | `exp_t10.py` + ELF real de `98112a9` + imagen local | **pasa** [U], ejecutado por GE-152 (ver `T10_RESULTS.md`). Codex debe reproducirlo con su ELF. |
| T11 | H-B2 en modo solo registro sobre hardware: finalizar / Salir / Reintentar / HOME | Switch | **no autorizado** |
| T12 | H-B2 activo sobre hardware | Switch | **no autorizado** |

## 9. Qué tiene que aportar GE-151 (Codex)

1. Implementar H-open, H-B2 (§3.1 + §4), H-tw-seq, H-tw-stage, H-tw-mgr y `safe_stop` (§6) en el módulo. Mover el
   guardado de respaldo desde los dtors a H-B2 (§5.4).
2. Confirmar cómo expone el trampolín de Hakkun el LR del llamador original (H-B2 necesita LR `== base+0x50A060`).
   Si el trampolín no conserva `x30`, comprobarlo en un stub de entrada, o leer el LR del frame
   (`[x29+8]` del llamador) [H].
3. **T10:** compilar el módulo y ejecutar sus cuerpos dentro de este harness, o de uno equivalente, con el `main`
   local. Rutas locales que el propietario tiene que proporcionar, **sin subir nada a GitHub**:
   - `$GE_MAIN_IMG`: imagen de `main` 03FF4A3B descomprimida y en plano (NSO → `main.img`), la misma que se pasa como
     `argv[1]` a `reports/GE-152/unicorn/*.py`;
   - `$GE_MODULE_ELF`: `subsdk` ELF del motor compilado sin strip, con símbolos;
   - `$SWITCH_SDK` / toolchain: solo en la máquina del propietario.

   Con eso, el harness puede cargar el ELF en una región aparte, resolver los imports del módulo a stubs
   registrados y ejecutar `ht3Worker` / `multiWorker` como cuerpos (`th+0x240`), como hace `exp_owner3`.
   Si GE-151 prefiere su propio harness, que reproduzca T1–T8 con los mismos criterios de aceptación.
4. Publicar la traza de T10 con las mismas columnas de §1: `rounds`, estados, appends durante la barrera,
   eventos de hijos en el teardown, accesos tardíos, lista global y `exit`/`preempt`/`RUNAWAY`.

## 10. Lo que sigue sin saberse

1. La semántica Horizon de eventos y join (multinúcleo, visibilidad, prioridades). El traspaso estricto es estático.
   El modelo es cooperativo.
2. Qué botón de la pausa corresponde a cada `setNextScene` (`0x138F58`, `0x132E74`, `0x133070`, `0x13350C`) [H].
   No afecta a B2: todos convergen en `0x5096F0`.
3. Si hay escritores de `mgr+0x18` fuera del SceneMgr, y el lock residual entre `0x50A060` y `0x50A090` [H].
4. T10 ejecutado por GE-152 con el ELF real de `98112a9` (`T10_RESULTS.md`). Falta que GE-151 lo reproduzca con su
   build y su implementación de H-B2 en C++.
5. Cómo pasa Hakkun el LR al hook (§9.2).

## Reproducir

```
cd reports/GE-152/unicorn
python exp_owner3.py $GE_MAIN_IMG results/owner3_results.json   # exit 0, FAILURES: 0
python exp_owner2.py $GE_MAIN_IMG results/owner2_results.json   # exit 0
python exp_b2.py     $GE_MAIN_IMG results/b2_results.json       # exit 0
python exp_v0.py     $GE_MAIN_IMG results/v0_results.json       # exit 0
```
Requiere `unicorn 2.1.x` y `capstone 5`.
