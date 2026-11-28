# GE-152 → GE-151: propietario nativo del Stage y frontera de retención

> **Rev 3:** la especificación implementable de B2 está en [`CODEX_HANDOFF_rev3.md`](CODEX_HANDOFF_rev3.md) y sustituye a §10.
> Scheduler corregido (solo `PC==RET` es retorno), barrera sobre todo el Runner, tabla de decisión sin contradicción,
> rutas de salida clasificadas y nuevas pruebas en `unicorn/exp_owner3.py` (§13).

Para: Codex (GE-151) y GE-154. De: Grok (GE-152). Base: `main` 03FF4A3B (imagen local, **no publicada**).
Rama local `grok/stage-owner` sobre `grok/dynamic-stage-research` @ `ab0a53b` (sin push).
Evidencia: análisis estático con capstone **[V]**, código real de `main` en Unicorn con stubs **[U-stub]**, hipótesis **[H]**.
No se publica código, datos ni desensamblado del juego: solo direcciones, offsets y flujo de control.
**Nada de esto se ha ejecutado en Switch.**

> **Rev 2 (respuesta a GE-154 7240603418).** B1 queda **descartada**: el nuevo experimento con el ctor y los dtors
> reales del anfitrión demuestra que omitir el deleting dtor deja un registro en una lista global y un puntero al
> padre ya liberado (§9). La frontera recomendada pasa a ser **B2**: barrera en el pre de `destroyPending 0x5096F0`,
> antes de cualquier destrucción del propietario y con todas las dependencias vivas. Con éxito, el teardown nativo
> corre sin cambios; con fallo, parada segura sin destruir nada. Detalle y resultados en §9–§11.

## 1. La pregunta (literal)

PR #5, GE-151 @ `823aeba` — https://github.com/angelcraft/Groove-Builder/pull/5#issuecomment-7240048944

> Para conectar el constructor y barrera necesito cerrar exactamente la observación GE-154 7230634264: ¿qué frontera
> del propietario permite conservar el Stage también si seal/cancel/join falla, impidiendo que su llamador ejecute
> deleting-dtor/free? El handoff rev2 define cancelar/señalizar/join, pero omitir orig en 0x4207F0 no retiene al
> propietario. Publicad solo flujo/callsite y evidencia sanitizada del harness privado, incluyendo exclusión de append
> tardío y self-join; no imágenes ni nuevas capturas generales.

Observación de origen (GE-154, https://github.com/angelcraft/Groove-Builder/pull/5#issuecomment-7230634264): «omitir el
dtor desde su hook no demuestra que el propietario no libere el Stage después; la ruta de fallo debe impedir también
free/destrucción del propietario mediante una frontera de ciclo de vida comprobada».

## 2. Respuesta corta

| | Respuesta | Confianza |
|---|---|---|
| Propietario del Stage | El objeto **secuencia de juego** (`Seq`, 0xA080 B, 5 clases hermanas). Guarda el Stage en **`seq+0xA078`**, lo crea en su ctor y lo destruye **solo** en su dtor | Alta [V + U-stub] |
| Propietario de la `Seq` | El **gestor de escenas** (`mgr = app+0x10`; escena actual `mgr+0x10`, siguiente `mgr+0x18/+0x20`) en el bucle de frame `0x509F50` | Alta-media [V + U-stub] |
| Por qué no basta el hook actual | `0x4207F0`/`0x4290F0` son el dtor **completo**. El propietario llama al **deleting dtor** (`vt+0x10`): `0x420C40` (R21) = `0x4207F0` + `free(0xE550)`; `0x4291A0` (HT2) = `0x4290F0` + `free(0x7AD0)`. Omitir `orig` en el dtor completo deja el `free` intacto (GE-154 tiene razón) | Alta [V] |
| Frontera recomendada (rev 2) | **B2**: pre de `destroyPending 0x5096F0` cuando `mgr+0x10` es la `Seq` de la sesión y hay transición pendiente. Barrera con `Seq`, Stage, Runner y registros vivos; éxito → `orig` sin cambios; fallo → parada segura sin entrar en `0x5096F0` (§10) | Media-alta [V + U-sched] |
| B1 (rev 1) | Pre del deleting dtor con cuarentena del Stage. **Descartada en rev 2** (§9) | — |
| Join de los hijos | No lo hace el Stage: lo hace la `Seq` **después**, en su cadena de dtors (Runner embebido en `seq+0x58` → `0x515040` → `0x515290`). Por eso el Stage se libera hoy **antes** del join | Alta [V + U-stub] |
| Self-join | La cadena entera corre en el hilo del bucle de frame, no dentro de una corrutina hija | Media [V; hilo real H] |
| Append tardío | `append 0x5153A0` no tiene lock, pero el Runner es un planificador de traspaso estricto (main ↔ un hijo); durante la barrera solo corre el hijo que la propia barrera reanuda | Media [V; semántica Horizon H] |

## 3. Cadena de propiedad (callsites)

```
App frame 0x509F50                          (único llamador de ambos: 0x50A05C y 0x50A090) [V]
 ├─ 0x50A05C  destroyPending 0x5096F0(mgr)  si mgr+0x10 ≠ 0 y mgr+0x18 ≥ 0:
 │              cur->vt+0x08  (deleting de la Seq)  y luego  mgr+0x10 = 0            [V][U-stub]
 │     └─ Seq deleting 0x2AB5F0 → Seq dtor 0x2AB4D0 → free(seq, 0xA080)
 │           0x2AB524  x = seq+0xA078
 │           0x2AB52C  seq+0xA078 = 0                    ← el propietario suelta el puntero ANTES de destruir
 │           0x2AB550  blr x->vt+0x10                    ← ÚNICO sitio que destruye+libera el Stage (clase 0)
 │                     R21 0x420C40 = dtor 0x4207F0 + free 0xE550 | HT2 0x4291A0 = dtor 0x4290F0 + free 0x7AD0
 │           0x2AB560  b 0x130080 (dtor base de la Seq)
 │                 … ~27 llamadas (p. ej. 0x5148F0(seq+0xEB0)) …
 │                 0x1302E8  0x1283A0(seq+0x30)
 │                       0x12849C  Runner::~Runner 0x515040(seq+0x58)
 │                             0x515060  clear 0x515290: para cada nodo de runner+8 → th->vt+0x08
 │                                       (Thread dtor 0x514BC0: estado 2, señal th+0x220, join th+0x28, free 0x298)
 │                             0x515078  free del vector de grupos
 │           (vuelve a 0x2AB5F0)  free(seq, 0xA080)
 └─ 0x50A090  createNext 0x509740(mgr): creador->vt+0x18 (0xB790) → 0xB5B0 → new(0xA080) + ctor Seq 0x2AB3A0
                 0x2AB454  init del Runner embebido (seq+0x58)
                 0x2AB4A4  factory 0x488940(creatorId, seq, …) → case 67 HT2 new(0x7AD0)+0x428D70 / case 108 R21 new(0xE550)+0x4202C0
                 0x2AB4A8  seq+0xA078 = stage
```

Clases hermanas de la `Seq` (elegidas en `0xB5B0` por un global de modo vía GOT `0xD96238`), mismo patrón [V]:

| ctor | sitio factory | dtor | carga / borrado de `+0xA078` | `blr vt+0x10` (LR esperado) |
|---|---|---|---|---|
| `0x2AB3A0` | `0x2AB4A4` | `0x2AB4D0` | `0x2AB524` / `0x2AB52C` | `0x2AB550` (`0x2AB554`) |
| `0x2AB7E0` | `0x2AB8F0` | `0x2AB930` | `0x2AB984` / `0x2AB98C` | `0x2AB9B0` (`0x2AB9B4`) |
| `0x2ABC40` | `0x2ABD50` | `0x2ABD90` | `0x2ABDE4` / `0x2ABDEC` | `0x2ABE10` (`0x2ABE14`) |
| `0x2AC0A0` | `0x2AC1B0` | `0x2AC1F0` | `0x2AC244` / `0x2AC24C` | `0x2AC270` (`0x2AC274`) |
| `0x2AC500` | `0x2AC604` | `0x2AC630` | `0x2AC684` / `0x2AC68C` | `0x2AC6B0` (`0x2AC6B4`) |

Otros hechos [V]:
- La factory `0x488940` solo tiene esos 5 llamadores, y los ctors de HT2 (`0x428D70`) y R21 (`0x4202C0`) solo se llaman desde ella (`0x489898`, `0x48902C`). Devuelve el puntero **primario** (sin ajuste), así que el propietario usa la vtable primaria: HT2 vptr `0xD4D258` (slot `+0x10` en `0xD4D268`), R21 slot en `0xD4CC20`.
- Referencias a `seq+0xA078` en todo `.text`: solo las de la tabla y dos lecturas de reenvío (`0x2AB7A0`-familia: `stage->vt+0x90`; `0x2AC920` → `0x1365C0`). No hay otro escritor ni otro destructor.
- Thunks deleting de bases secundarias (mismo `free`): HT2 `0x4291D0/-0x2978`, `0x429200/-0x2990`, `0x429230/-0x29B0`, `0x429260/-0x2C78`; R21 `0x420C70/-0x2978`, `0x420CA0/-0x2990`, `0x420CD0/-0x29B0`, `0x420D00/-0x3548`. Solo aparecen en sus vtables; no se ha visto ningún borrado por base secundaria [V]. Deben llevar tripwire.
- El Runner **no** es una asignación aparte: es un subobjeto base de la `Seq` en `seq+0x58` (por eso `stage+0x2C80 = seq+0x58`). Lo destruye `0x1283A0(seq+0x30)` en `0x12849C` [V][U-stub].

## 4. Evidencia de ejecución (Unicorn, código real)

`reports/GE-152/unicorn/exp_owner.py` (nuevo): ejecuta de verdad `0x5096F0`, `0x2AB5F0`, `0x2AB4D0`, `0x130080`,
`0x1283A0`, `0x515040`, `0x515290` y el ctor del Runner `0x515000`; el Stage y los nodos de hilo son objetos falsos
que solo registran la llamada; todo lo demás es stub registrado. Resultado (`results/owner_results.json`, `exit 0`, `FAILURES: []`):

| Caso | Orden observado |
|---|---|
| transición (`mgr+0x18 = 5`) | `stage.vt+0x10` (LR `0x2AB554`) → 27 llamadas de la cadena base → `thread1.vt+8`, `thread0.vt+8` (desde `0x5152B8`) → `free(seq, 0xA080)`; después `mgr+0x10 = 0`, `seq+0xA078 = 0` |
| sin transición (`mgr+0x18 = -1`) | nada destruido |
| autoprueba `seq+0xA078 = 0` | sin despacho al Stage; joins y `free(seq)` normales |

Conclusiones:
1. **El Stage se destruye y libera antes de que la `Seq` haga join de los hijos**, dentro del mismo dtor del propietario.
2. El dtor de la `Seq` **no depende** de lo que haga el deleting del Stage (no lee retorno ni estado): si el hook retorna sin `orig`, la `Seq` sigue, hace join de los hijos y se libera. Eso es lo que hace viable B1.

`reports/GE-152/unicorn/exp_owner_static.py` (nuevo) comprueba y fija todas las referencias de §3 y §6 (`results/owner_static.json`, `exit 0`, 0 fallos; solo direcciones).

## 5. Frontera propuesta para GE-151 (rev 1, sustituida por §10)

**B1 — retención en el deleting dtor (recomendada).** Hook en `0x420C40` (R21) y `0x4291A0` (HT2), no en el dtor completo:

1. Comprobar `LR ∈ {0x2AB554, 0x2AB9B4, 0x2ABE14, 0x2AC274, 0x2AC6B4}` y `x0 == gSess.stage`; cualquier otro llamador → `orig` + log (tripwire). Tripwire también en los 8 thunks secundarios.
2. Ejecutar aquí la barrera rev2 (cancelar/publicar → señalizar todos → join → punto fijo). El Stage y la `Seq` siguen vivos y el Runner (`seq+0x58`) todavía no se ha tocado.
3. Quiescente → liberar recursos del motor y llamar a `orig` (dtor + `free`). El `clear` posterior encuentra hilos ya en estado 3.
4. **No** quiescente → **retornar sin `orig`**. El propietario ya puso `seq+0xA078 = 0`, así que nadie conserva el puntero; no hay doble `free`. El Stage (0xE550 / 0x7AD0 B y sus subobjetos) queda en cuarentena para siempre, junto con `gTl/gMt` del motor. El `clear` nativo de la `Seq` hará después join de los hijos sobre un Stage **todavía asignado**. Si un hijo no termina, ese join bloquea: **cuelgue fail-closed, no use-after-free**. Nunca timeout seguido de `free`.
5. No ejecutar nunca el dtor diferido después: necesita el Runner (`0x5148F0`) y partes de la `Seq` que ya no existen.

**B0 — alternativa más gruesa (no recomendada como primera opción).** Pre de `0x5096F0`: con barrera fallida, poner `mgr+0x10 = 0` y retornar 1 sin llamar al deleting de la `Seq`. Se fuga la `Seq` entera, con su Runner y los hilos aparcados (cada uno con 0x10000 B de pila): no hay join ni cuelgue, pero todo lo que la `Seq` y el Stage registraron en sistemas globales queda colgando. Confianza baja.

**Self-join [V; hilo real H].** La barrera de B1 se ejecuta en la cadena `0x509F50 → 0x5096F0 → Seq → deleting`, que solo se llama desde el bucle de frame (`0x50A05C`). No corre dentro de una corrutina del Runner. Comprobar el LR del punto 1 lo garantiza a nivel de callsite. Falta confirmar en Switch que `0x509F50` corre siempre en el hilo principal.

**Append tardío [V; semántica Horizon H].**
- `append 0x5153A0` recorre y enlaza la lista `runner+8` **sin lock**.
- El Runner hace traspaso estricto:
  - `step` reanuda al hijo (`th+0x220`) y espera al principal (`0x514EC4` → evento `th+0x208`).
  - `wait 0x514D70` del hijo hace lo inverso (`0x514DA8`).
  - Al terminar el cuerpo (`0x514A40`): estado 2 y se reanuda al principal.
  - En cada instante corre el principal o un único hijo.
- Mientras el principal está en la barrera, solo corre el hijo que la barrera reanuda (join). Por eso un append solo puede venir de la continuación de ese hijo, y el punto fijo de rev2 lo recoge.
- El único spawn nativo de R21 (`0x4207AC`, 20 subhilos) va precedido de `tStop` (`0x420784`), así que un hijo reanudado en estado 2 no crea más. Los cuerpos del motor tienen que cumplir lo mismo.
- Los nombres de import de `0x4DFC70`/`0x4DFC80`/`0x4DFB60` (señal/espera/join) no están resueltos [H].

## 6. Lo que sigue sin saberse

1. **Registros que solo deshace el dtor.** Con B1 en fallo no se ejecutan `0x4207F0`/`0x4290F0` → `0x4D9A10`/`0x4D8D40` → `0x1363D0`. Esa cadena llama a `0x6A40`, `0x139020`, `0x85B0`, `0x86A0`, `0x7920`, `0x78E0`, `0x4EE330`, `0x4DF820`, `0x504440` y `0x5148F0`. R21 además libera unos 24 subobjetos. No está clasificado cuáles quitan el Stage de listas globales (render, audio, layout, entrada). Si alguno lo hace, un Stage en cuarentena podría recibir llamadas después de liberarse la `Seq`. **Es el riesgo principal de B1.**
2. Qué tocan los hijos al reanudarse en estado 2 durante el `clear`, cuando `0x130080` ya ha destruido otras partes de la `Seq` (p. ej. el grupo `seq+0xEB0`). Esto también pasa en nativo, pero con cuerpos del motor hay que comprobarlo.
3. Si GE-154 acepta un cuelgue (join bloqueante) como modo de fallo cerrado.
4. Semántica de Horizon de los eventos y del join. El modelo de traspaso es estático, no medido.
5. Las clases `Seq` 1–4 solo están vistas en estático; Unicorn solo ha ejecutado la clase 0 (`0x2AB4D0`).
6. En qué hilo corre `0x509F50` (llamador `0x50D078`) y el cierre de la app (no analizado).
7. Que la salida por pausa → «Salir»/«Reintentar» pase siempre por `setNextScene 0x509570` (41 llamadores) → `0x5096F0`. Es estático y probable, pero no medido.

## 7. Prueba de confirmación propuesta

**A. Unicorn (sin hardware, siguiente paso):**
- (i) Repetir `exp_owner.py` con un Stage HT2/R21 real construido como en `exp_b2.py`, hijos reales y el deleting sustituido por la política B1 en fallo. Criterios: `free(stage)` = 0, el Stage queda intacto, joins = N, `free(seq)` = 1 y 0 accesos a memoria liberada (envenenar `seq` tras su `free`).
- (ii) Clasificar las llamadas de `0x1363D0`/`0x4D9A10`/`0x4D8D40` comparando altas en el ctor y bajas en el dtor, en busca de listas globales (cubre la incógnita 1).

**B. Switch, solo diagnóstico, cuando GE-154 y el usuario lo aprueben (GE-156):**
- **Preparación:** módulo de solo registro, sin cambiar conducta: todos los trampolines llaman a `orig`, sin casillas custom ni IPS. Copia de la partida con JKSV antes.
- **Puntos de log** (cada uno con id de hilo, tick, `x0`, LR y tamaño de `free`):
  - pre/post de `0x5096F0` y de `0x2AB4D0` y sus 4 hermanas;
  - pre/post de `0x420C40`/`0x4291A0` y de `0x4207F0`/`0x4290F0`;
  - pre/post de `0x515290`;
  - pre de `0x514BC0`;
  - `0x4E04E0` filtrado a `x0 ∈ {stage, seq}`;
  - `0x509740`.
- **Escenarios:** Remix 8 (R21, caso 108) y HT2 (caso 67): fin normal, pausa → Salir, pausa → Reintentar, y HOME → volver a mitad de partida.
- **Criterio esperado en todos:**
  1. Todo ocurre en el mismo hilo que `0x509F50`.
  2. Orden: `0x5096F0` → dtor `Seq` → deleting del Stage (LR de la tabla) → `free(stage, 0xE550/0x7AD0)` → `0x515290` → `0x514BC0`×N → `free(seq, 0xA080)` → `0x509740`.
  3. Ningún otro `free(stage)` ni deleting por thunk secundario.
  4. Ninguna llamada a los hooks del Stage después de su `free`.
- Si algo no cumple el criterio, B1 queda bloqueada. Solo con esto superado se probaría B1 con fallo forzado de la barrera, en una sesión custom, revisando los logs con GE-154.

## 8. Reproducir

```
cd reports/GE-152/unicorn
python exp_owner_static.py $IMG results/owner_static.json   # exit 0, FAILURES []
python exp_owner.py        $IMG results/owner_results.json  # exit 0, FAILURES []
```
`$IMG` = ruta local al `main` 03FF4A3B descomprimido (no se publica). Python con `unicorn` 2.x y `capstone` 5.

---

## 9. Rev 2 — clasificación de dependencias del dtor del Stage

Callees del dtor base `0x1363D0` y del dtor raíz `0x505AB0`, comparados con sus altas en el ctor base `0x136180` /
raíz `0x5059C0` [V] y medidos en `exp_owner2.py` [U-sched]:

| Llamada en el dtor | Alta en el ctor | Qué es | Alcance | Si se omite el dtor |
|---|---|---|---|---|
| `0x6A40` | — | predicado sobre `stage+0x29E4` (modo) | puro | nada |
| `0x139020` → `0x1306F0` | `stage+0x29D8 = seq` (`0x136270`) | lee bits del gestor de guardado vía la `Seq` | lee al propietario | — (exige `Seq` viva al destruir el Stage) |
| `0x85B0`, `0x86A0` | — | telemetría (flags globales `0x10AB0E0`/`0x10AB0EC`, familia `0x7950…`) | global, sin punteros al Stage | evento de telemetría perdido |
| `0x7920`/`0x78E0` | — | lee/limpia los globales `0x10AB1D8`/`0x10AB1DC` | global | el flag queda puesto |
| `0x4EE330(stage+0x2B20)` → `0x4EE490` | `0x4EE260(stage+0x2B20, null)` (`0x13634C`): con dueño nulo usa el **gestor por defecto global** `*0x10BD820` (fijado por `0x4EEEC0` desde `0x5085E0`, objeto del framework con vida de app) y enlaza un nodo en su lista `+8` | **registro en lista global** | **nodo colgando en una lista global** |
| `0x4DF820` ×3 | `0x4DF800` ×3 | dtor vacío | interno | nada |
| `stage+0x29F8 → vt+8` | — | objeto propio | interno | fuga |
| `0x504440(stage+0x29B0)` | `0x5043E0` | buffer propio (`0x4E04A0`) | interno | fuga |
| `0x5148F0(stage+0x2978)` | `0x514760(stage+0x2978, seq+0x58)` | grupo de hilos en el Runner de la `Seq` | propietario | el grupo sigue registrado hasta que el Runner muere |
| `0x505AB0`: `0x4ECB50([parent+0x20], id)` por cada id | ids del gestor de recursos del padre | recursos del propietario | ids sin liberar |
| `0x505AB0`: `0x505620(parent, stage)` si `stage+0x2968` | `0x5059C0` → `0x5055C0(seq+0x30, stage)`: `stage+8 = seq+0x30`, nodo en la lista de hijos `seq+0x38` | **hijo en la lista del nodo de escena de la `Seq`** | el Stage conserva `stage+8` apuntando a la `Seq` **liberada** |
| HT2 `0x4D8D40` / R21 `0x4D9A10` y ~24 subobjetos R21 | sus ctors | subobjetos propios | interno / sin clasificar uno a uno | fuga |

La `Seq` registra a su vez `seq+0x94E0` y `seq+0x9610` en la misma lista global (`0x12FEBC`/`0x12FED0`) y los da de
baja en `0x130200`/`0x13020C`, **después** de destruir el Stage.

Conclusión: el Stage tiene **un registro global** (`stage+0x2B20` en la lista del gestor por defecto) y **tres
registros en su propietario** (hijo de `seq+0x30`, grupo en `seq+0x58`, ids en `[seq+0x30+0x20]`). Cualquier
frontera que no ejecute el dtor nativo **con la `Seq` viva** deja punteros colgando. GE-154 tenía razón: B1 no es
segura.

## 10. Rev 2 — frontera B2 (recomendada)

**Dónde:** pre de `destroyPending 0x5096F0(mgr)`, llamado solo desde el bucle de frame (`0x50A05C`, LR `0x50A060`).
**Condición:** `mgr+0x10 == gSess.seq` (la `Seq` que contiene `gSess.stage` en `+0xA078`) y `mgr+0x18 ≥ 0`.
Cualquier otra llamada → `orig` sin tocar nada.

1. **Antes de cualquier destrucción**: `Seq`, Stage, Runner (`seq+0x58`), lista de hijos, lista global y gestor de
   recursos siguen vivos. Los hijos están aparcados (traspaso estricto, §5).
2. **Barrera rev2** sobre el grupo `*(stage+0x2988)` del Runner `seq+0x58`: publicar cancelación (0/1 → 2), señalar
   a todos, join a cada uno, punto fijo (máx. 8 rondas). Cada hijo se reanuda con todas sus dependencias vivas.
3. **Éxito** → `orig(mgr)`. El teardown nativo corre **sin cambios**, en su orden, y deshace todos los registros.
   El `clear` del Runner encuentra los hilos ya en estado 3 y no reanuda a ninguno (0 eventos de hijos durante el
   teardown).
4. **Fallo** (precondición no cumplida, sin punto fijo, LR inesperado, sesión incoherente) → **parada segura**: no
   llamar a `orig`, no tocar `mgr`, no liberar nada y abortar el proceso con un diagnóstico (p. ej. abort explícito
   del módulo con log en SD), antes de cualquier escritura de guardado posterior. El grafo completo queda intacto
   hasta que el proceso muere.
5. **Join bloqueante** (un hijo que nunca termina) → cuelgue con el grafo intacto: no hay `free` ni dtor parcial.
   Nunca timeout seguido de destrucción.
6. **Tripwires**: deleting del Stage (`0x420C40`/`0x4291A0`) y los 8 thunks secundarios llamados fuera del dtor de
   la `Seq` mientras haya sesión → log + parada segura. El hook actual de `0x4207F0`/`0x4290F0` no debe omitir `orig`.

Por qué no hace falta B0 (cuarentena de la `Seq`): `0x509740` crearía la escena siguiente encima, y la `Seq` fugada
mantendría vivos sus registros globales (`seq+0x94E0/+0x9610`).

**Self-join y append tardío en B2:** la barrera corre en el hilo del frame, fuera de cualquier corrutina (LR
`0x50A060`). Los appends solo pueden venir de un hijo reanudado por la propia barrera, y el punto fijo los recoge.
El spawn nativo de R21 (`0x4207AC`) está detrás de `tStop`.

## 11. Rev 2 — evidencia (`exp_owner2.py`, código real)

Código real:
- ctor del anfitrión (`0x428D70` → `0x4D8C10` → `0x136180` → `0x5059C0`; `0x4202C0` → `0x4D94F0`);
- workers, corrutinas anidadas, Runner/Thread y nn::os modelado (`sched.py`, **no Horizon**);
- `0x5096F0`, los 5 deleting/dtors de `Seq`, `0x130080`, `0x1283A0`;
- dtors del Stage (`0x4291A0`/`0x420C40`, `0x4290F0`/`0x4207F0`, `0x1363D0`, `0x505AB0`, `0x4EE330`, `0x505620`, `0x5148F0`).

Las asignaciones devuelven objetos con vtable de harness. Ningún acceso a memoria no mapeada ni a la página nula.
Resultado: `results/owner2_results.json`, **`exit 0`, `FAILURES: 0`**.

| Caso (HT2 / R21) | Hijos | Stage liberado | `Seq` liberada | Hilos liberados | Accesos tardíos | Eventos de hijos en teardown | Registro global al final |
|---|---|---|---|---|---|---|---|
| nativo | 1 / 11 | sí | sí | 1 / 11 | 0 | **1 / 1** (el hijo corre después del `free` del Stage) | no |
| **B2 éxito** | 1 / 11 | sí | sí | 1 / 11 | **0** | **0** | **no** |
| B2 fallo (self-join) | 1 / 11 | no | no | 0 | 0 | — | sí, grafo intacto (lista global, hijo del padre, grupo) |
| B2 fallo (sin punto fijo) | 1 / 11 | no | no | 0 | 0 | — | sí, grafo intacto |
| **control negativo B1** | 1 / 11 | no | **sí** | 1 / 11 | 0 | 1 / 1 | **sí: nodo del Stage en la lista global tras liberar la `Seq`** |
| control positivo del detector (HT2) | 1 | sí | no | — | **14** | — | — |
| B2 éxito, clases `Seq` 1–4 (HT2) | 1 | sí | sí | 1 | 0 | 0 | no |

Orden medido en B2 (R21):
1. `0x420C40` → `0x4207F0` → `0x1363D0`;
2. `0x4EE330(stage+0x2B20)` → `0x5148F0(stage+0x2978)` → `0x505AB0` → `0x505620(seq+0x30)`;
3. `free(stage, 0xE550)`;
4. `0x4EE330(seq+0x9610)`, `0x4EE330(seq+0x94E0)`, `0x5148F0(seq+0xEB0)`;
5. `0x515290` → `0x514BC0`×11 → `free(thread)`×11;
6. `free(seq, 0xA080)`.

Límites:
- Cooperativo, no Horizon.
- R21 llega a 11 hilos en 3 ticks (los subhilos usan thunks stub).
- Los cuerpos del motor de GE-151 no están; hay que repetir con el módulo real.
- El gestor global es un objeto de harness con la misma lista intrusiva. No se ha identificado quién recorre la lista ni con qué frecuencia [H].

## 12. Rev 2 — qué queda abierto

1. Semántica de Horizon (eventos, join, visibilidad entre núcleos); el traspaso estricto es estático.
2. Cuerpos reales del motor (GE-151) en este harness: deben salir con trabajo acotado y sin spawn tras `tStop`.
3. Qué recorre la lista global `*0x10BD820` y si el orden B2 cambia algo para ella (en B2 el orden nativo no cambia).
4. Mecanismo concreto de parada segura en el módulo (abort con log) y que ningún guardado se dispare antes.
5. Que pausa → Salir/Reintentar y HOME pasen siempre por `0x5096F0` (estático).
6. Que `0x509F50` corra en el hilo principal.

Prueba futura en hardware (no autorizada todavía): la de §7 B, añadiendo pre/post de `0x5096F0` con la barrera B2
en modo solo registro (medir, no actuar) y comprobar que no hay eventos de hijos entre la barrera y `free(seq)`.

Reproducir: `python exp_owner2.py $IMG results/owner2_results.json` (`exit 0`, `FAILURES: 0`).

## 13. Rev 3 — resumen (detalle en `CODEX_HANDOFF_rev3.md`)

1. **Scheduler** (`sched.py`, `harness.py`): agotar el presupuesto ya no cuenta como `exit`. El hilo pasa a
   `preempt`, después a `RUNAWAY`, y el hilo principal recibe `BudgetExhausted`. `exp_b2`, `exp_v0`, `exp_owner`,
   `exp_owner_static` y `exp_owner2` se repitieron: salida idéntica, 0 eventos de presupuesto.
2. **Corrección de §10:**
   - sin sesión o con escena ajena → `orig`;
   - con nuestra `Seq` y el LR, el vptr o la identidad incoherentes → parada segura sin retorno;
   - `mgr+0x18 < 0` → `orig`, porque `0x5096F0` no destruye nada.
3. **Barrera rev3** sobre todo el Runner `seq+0x58`. El control con un hilo del grupo `seq+0xEB0` muestra que rev2
   dejaba un acceso tardío y que rev3 da 0.
4. **Rutas:**
   - finalizar, reintentar (mismo id: A destruida y B creada en el mismo frame) y abandonar convergen en `0x5096F0`
     (`0x50A05C`);
   - HOME no destruye nada;
   - el apagado no ejecuta dtors (bucle `0x50D060` sin salida);
   - `~SceneMgr 0x509640` queda como tripwire.
5. **`exp_owner3.py`:** 17 escenarios, `exit 0`, `FAILURES: 0`:
   - éxito con ticks 1/3/6 (R21 con 10 hilos en estado 0);
   - worker en bucle infinito (no quiescente, grafo intacto) y su control con el scheduler legacy (falso `done`);
   - `main` truncado;
   - agotamiento real del punto fijo (falla tras 8 rondas sin empezar la 9.ª);
   - guarda de self-join;
   - reintento A → B con generación de sesión.
