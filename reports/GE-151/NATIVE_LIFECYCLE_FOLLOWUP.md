# GE-151 — Seguimiento nativo y dependencia GE-152

Base de esta iteración: 07f78337c366156809e13f74f3839221047eb3aa.
Consultado PR #5 / GE-152 @ 38b102d0a5cdb092cf89e9f7811df37efbf66214,
anexo E9/E10/E11/E14/E15 y ficha de resultados. No se incorpora su rama.

## Guardados: bloqueo anterior al adaptador

E9 muestra incremento del contador `plays` en RAM en beginPlay (0x48B0).
E15 sitúa esa llamada en el lanzamiento del mapa (0x1D344C). Se produce
antes del constructor custom del escenario. E11 describe la escritura del
blob de guardado completo; E14 describe el commit de resultados.

Por tanto, bloquear toResults dentro de nuestro worker no deshace ese
incremento ni demuestra aislamiento del progreso. No se ha observado aquí
la persistencia del incremento concreto al tomar exit. No se escribe un
índice negativo en curIdx, no se restaura ciegamente todo el blob y no se
suprimen guardados globales: podrían perderse cambios legítimos.

Solicitado a Grokki mediante comentario en PR #5:
https://github.com/angelcraft/Groove-Builder/pull/5#issuecomment-7229308248

Falta establecer una frontera anterior a beginPlay para la sesión custom,
sus argumentos/propietario y su ruta de salida, y reproducir el camino de
persistencia al abortar/salir. No hay nueva respuesta de Grokki al cerrar
esta iteración; el comentario no equivale a un acuerdo ni a evidencia.

## Trabajadores: evidencia disponible y faltante

Código propio: spawn usa constructor 0x514A90 y append 0x5153A0 con Runner,
índice y parent del propietario. GE-151 mantiene el contexto hasta que
retorna el destructor original. Los headers públicos fijados declaran
Thread::~Thread y Runner::~Runner, pero NO contienen sus implementaciones.
La declaración o el parámetro parent no prueban que se espere al último
callback antes de liberar el hijo o Scene.

Faltan los cuerpos/cadena de cancelación y retirada desde HT2 dtor
0x4290F0 y R21 dtor 0x4207F0: cancelación durante wait, orden de callbacks,
terminación, unlink y liberación exactamente una vez. Pedidos a GE-152.
No se introducen contadores o booleanos como sustituto de esa demostración.

## Pila: medición nueva, con límites explícitos

`tools/audit_engine_stack.py` toma el build ARM64 aislado, verifica hashes
de fuentes y genera objetos diagnósticos con `-fstack-usage`. Quita LTO
exclusivamente en ESOS objetos: no se enlazan ni se instalan. Esto permite
obtener estimaciones locales, NO una cota del módulo final con LTO.

Comando ejecutado (exit 0, Clang 19.1.7):

```
python3 tools/audit_engine_stack.py /workspace/engine-verified-a /workspace/engine-stack-checked
```

Salida sanitizada completa: stack-diagnostic.json (114 registros).
Ejemplos: writeSave/writeMultiSave 1184 bytes; logf 832; extractDefs 848;
emitRange 592 por activación. Son estimaciones del compilador para esta
configuración diagnóstica, no mediciones de stack en Switch. Los límites
de profundidad no incluyen al llamador, libc, FS, allocator, Runner,
corutinas ni callbacks indirectos del juego. No sumar estos números y
presentarlos como presupuesto transitivo completo. La capacidad real de
pila de cada contexto sigue sin acreditarse.

El auditor indica linked_module_bound_verified=false e installable=false.
Las dos pruebas nuevas comprueban que el lector conserva la distinción
static/dynamic y rechaza formatos desconocidos, sin convertirla en éxito.
La batería pública completa vuelve a pasar (15 métodos unittest, 19
casos GTF y tres binarios ASan/UBSan). No cambia código runtime, por lo que
no se repiten los dos builds enlazados previos; sí se compilan nuevamente
las cuatro unidades ARM64 para la evidencia diagnóstica.

## Decisión de candidato

NO generar paquete instalable: falta aislamiento anterior a beginPlay,
prueba de vida útil del Runner y presupuesto de pila nativa. Una copia de
seguridad es recuperación, no prueba de aislamiento. La futura prueba
física debe tener un candidato revisado y recuperación, comparar guardado
antes del lanzamiento y después de salir/cancelar, y acreditar teardown;
no se solicita repetir capturas generales ni se instala nada ahora.

## Actualización: respuesta de Grokki y corrección de guardado

Revisado PR #5 @ 8e11d7babb9ff85939dda0553a8b5407af7237d9, en particular
codex-pr5-answers.md y pr6-audit.md. Evidencia de GE-152: desensamblado estático,
NO ejecución Unicorn ni Switch. Sustituye la incertidumbre anterior sobre el dtor:
0x1363D0 → 0x5148F0 retira el grupo; Runner pertenece a seq+0x58, no a Stage.
El reap 0x515450 y dtor 0x514BC0 hacen señal/join/unlink/free posteriormente.
Por tanto conservar datos hasta el retorno de orig(stage) NO protege todo el
ciclo de vida. Se corrigen los comentarios runtime que insinuaban lo contrario.
No se cambia el orden ni se inventa un nuevo hook de join sin validar el contrato.

También se identifican escrituras de campaña en 0x4A30/0x4A70 antes de beginPlay,
setPending en 0x137094 y commitResult al regresar al mapa, incluido riesgo sobre
perfectos. Salir sin resultados no aísla la partida original. Propuesta F0–F4 y
curIdx=-1 todavía NO validadas; coordinación pide validación antes de nuevos hooks.
Solicitud concreta de traza sanitizada publicada en #5:
https://github.com/angelcraft/Groove-Builder/pull/5#issuecomment-7229815458

Corrección independiente implementada: writeSave y writeMultiSave devuelven el
resultado real de persistCustomSave; los trabajadores solo marcan saved tras éxito.
Contención del buffer y SD no disponible devuelven false con diagnóstico explícito.
Así no se suprime la oportunidad de reintento que ya existe en el dtor. Esto no
acredita seguridad del dtor ni garantiza reintento si vuelve a fallar. Se mantiene
el máximo de 64 backups sin borrar ninguno automáticamente; al agotarse se rechaza
la escritura, se informa y no se declara saved. Formato y nombres de guardado intactos.

Verificación: batería pública exit 0 (15 métodos Python, 19 casos GTF y 3 binarios
ASan/UBSan), incluida inyección de fallos de reemplazo y exclusión atómica. Compilación
ARM64 completa con toolchain fijado exit 0; auditor ELF/NSO exit 0, 665 RELATIVE,
sin imports ELF sin resolver, payload ELF/NSO idéntico. Esas pruebas no ejecutan los
servicios FS nativos ni el scheduler del juego. Esta iteración realiza UN build
ARM64; la prueba de dos builds idénticos corresponde a la revisión anterior.
NSO SHA-256 fcc1953b3f45ee93cdec99b827f76880746b116b96a15daf7c350225adea900b;
ELF SHA-256 8f4cf0143149f81e53534c4cfb11cae8f9e33a1a3818be34753fd21a0bacedde.
NSO sin verificación interna de hashes de segmento; se verifica SHA externo.
No se publican los binarios ni se prepara instalador.

Omitido explícitamente: ida/vuelta opcional de multi_prueba.gtl (fixture ausente),
main/SDK privados y suite Unicorn privada; pruebas Horizon y físicas. No se puede
calcular cota transitiva completa con callbacks y servicios no ejecutados. Los 64 KiB
que GE-152 identifica en el constructor son capacidad estática, no presupuesto probado.
