# GE-151 — GSV1/H9 y constructor Multi: propuesta para GE-154

Base 823aeba, revisión 7240144273. Implementado, no congelado ni aprobado para
hardware. No se cambian contratos compartidos ni el instalador. Fuentes propias:
engine/src/v0_gsv.hpp, v0_execution.hpp y v0_persistence.cpp.

## Conexión comprobada

El harness carga slots.json y manifests/timelines mediante Loader::load real,
arma A o B copiando Package completo (ID, versión, título, bytes de los archivos),
compila la timeline propia y llama a MultiFactory::construct exactamente una vez.
Se conservan self, sequence y los CINCO argumentos int del constructor REMIX_21.
Solo después se solicita adopción de timeline/paquete. Es un constructor callback
sintético: no se afirma ejecución de 0x4202C0 ni creación de escenas en el juego.

Modificar el cache del Loader después de arm no modifica el snapshot. Execution
no admite copia y exige token monotónico no nulo. Cada callback usa StageToken
(stage, session); reutilizar la misma dirección Stage en B no valida callbacks de A.
Adopción fallida deja OwnershipFault y conserva StageToken: nunca llama al dtor ni
simula free. El propietario externo aún debe mantener vivo ese objeto; este módulo
NO resuelve la barrera nativa. No se conecta al r21CtorHook existente en Switch.

H9 exige resultado finish/abort explícitamente confirmado, retorno de mapa y aviso
de quiescencia del mismo token. Retornar al mapa solo no guarda. La quiescencia es
una entrada del harness, NO un join. Abort prevalece sobre finish hasta quiescencia.
La intención before/after/token queda congelada durante todo retry. Tras retornar,
la persistencia pendiente no suprime progreso nativo. Score/rank/perfect no se leen
ni se inventan: permanecen cero, sin medallas.

## GSV1 propuesto, 160 bytes exactos

Todos los enteros little-endian, sin serializar padding de structs C++.

| Offset | Tamaño | Campo |
|---|---:|---|
| 0 | 4 | GSV1 |
| 4 | 2 | versión 1 |
| 6 | 2 | longitud 160 |
| 8 | 4 | CRC-32/IEEE de bytes 12..159 |
| 12 | 4 | seq uint32 |
| 16 | 100 | ID ASCII canónico, NUL y resto cero, máximo 96 bytes |
| 116 | 1 | estado 2 inicial / 3 con al menos un clear |
| 117 | 3 | rank/perfect/flags, cero obligatorio |
| 120 | 4 | intentos confirmados (plays) |
| 124 | 4 | clears confirmados |
| 128 | 12 | bestScore/lastScore/lastRank, cero obligatorio |
| 140 | 20 | reservado, cero obligatorio |

Se valida ID exacto frente al nivel, sintaxis/DOS, estado coherente con clears,
clears <= plays, todos los campos deshabilitados y CRC. Cada intento incrementa
seq y plays una vez; clear solo con finish sin abort. Rechazar overflow sin wrap.
Esta restricción de estados/métricas refina la propuesta de GE-152 para V0; todavía
requiere revisión. No debe declararse compatible con GSV1 futuro/externo con métricas
no cero: se bloquea y conserva, no se migra ni borra.

## Journal, recibos y reemplazo

IO inyectable: lock exclusivo por ID, lecturas acotadas con Missing/Present/Error/
Oversized, create-new, rename sin reemplazo, flush por archivo y sync de directorio.
Un proveedor real debe validar tipos, componentes y rechazar links, convertir errores
y garantizar la semántica de esas operaciones. No se ha escrito un adaptador nn::fs.

Propuesta GJ01, 340 bytes: magic [0..3], versión uint32=1 [4..7], token uint64
[8..15], GSV before [16..175], GSV after [176..335], CRC de [0..335] en [336..339].
ID coincide en ambos, seq/plays aumentan exactamente uno y clears aumenta cero o uno.
No contiene rutas: todas se derivan del ID validado.

1. Crear custom-saves/<id>.gsv.pending con GJ01, flush y sync antes de mover main.
2. Crear .gsv.new completo y flush. Con main previo, conservar .gsv.bak; si ya existe,
   archivarlo con su seq bajo nombre fresco, sin reemplazar ningún archivo.
3. Mover main a backup, sync; promover new a main, sync/flush.
4. Renombrar pending a .gsv.done-<seq>-<token>, flush y sync antes de confirmar éxito.

Los recibos conservados distinguen un retry del mismo intento de otro token con
bytes after iguales. Se comprueba también before exacto; no se sobrescribe un
estado inesperado. Si hay conflicto/corrupción se conserva evidencia. No hay borrado
automático de backups/recibos ni política de purga; colisión de archivo de archivo o
falta de espacio bloquean/requieren revisión. No es una estrategia escalable ya validada.

Si se pierde ack tras promoción/recibo, retry valida main+recibo y no vuelve a sumar.
Si queda pending tras reinicio, recover valida GJ01 y repite commit bajo lock; la
relectura evita confiar en el intervalo entre inspección y recuperación. Main corrupto
nunca es sustituido por commit. El journal no equivale a autenticación criptográfica.

## Política de carga y recuperación explícita

Ausencia real de main/backup/journal/new -> estado inicial. IO desconocida, pending
inválido o new huérfano -> bloqueo. Main corrupto (incluido tamaño excesivo) con backup
válido -> RecoveryAvailable, nunca reset silencioso. Ambos inválidos -> bloqueo solo
para ese ID. A corrupto no impide armar B.

restoreBackup requiere decisión explícita y token de recuperación. Rechaza un main
válido diferente (no downgrade automático), conserva el corrupto en .corrupt-<token>,
publica copia flush/sync del backup por nombre nuevo y conserva backup/evidencia.
Retry de restauración no sobrescribe nombres previos. Restaurar copia su seq confiable;
no cuenta un nuevo intento. Historia previa/colisiones de recibos tras una recuperación
explícita pueden requerir revisión manual: no se promete rollback/migración automáticos
ni monotonicidad autenticada respecto a archivos corruptos o historia eliminada.

## Evidencia

python3 tools/run_engine_tests.py: 18 métodos Python, 19 GTF y SEIS binarios
ASan/UBSan, todos pasan. Nueva integración tests/test_v0_persistence.cpp cubre lector
real→snapshot→constructor/adopción→finish/abort→quiescencia→H9; A/B y reapertura,
mutación del cache, callbacks atrasados y fallo de adopción. Codec: vector CRC conocido,
160 mutaciones de byte, reservados no cero con CRC recalculado, ID y overflow.
Matrices de fallos en cada operación de primera escritura, reemplazo, archivo y
restauración; lost ack, recibo con otro token, journal parcial, backup, main excesivo,
ambos corruptos y temporal huérfano. IO en memoria, fallos booleanos: no power-cut real.

Build ARM64 final con pins previos: pasa. Auditor: AArch64 RX/RO/RW, 666 RELATIVE,
sin imports ELF pendientes, payload ELF/NSO idéntico. check_v0_arm64 ejecuta además
el decoder GSV1 del ELF final contra encoder Python struct/zlib, incluidos reservados
no cero con CRC correcto; no ejecuta IO ni constructor original ni Horizon.
GSV/commit/constructor tienen entradas retenidas pero desconectadas, sin hooks.
Resultados/hashes: V0_GSV_RESULTS.json. Pila diagnóstica: V0_GSV_STACK.json, objetos
sin LTO. No sumar estas cifras como cota nativa. El máximo de 688 bytes de Unicorn
solo pertenece a su recorrido sintético.

## Pendiente para integrar en vivo

Revisión GE-154 de formatos/recibos/restauración, adaptador IO durable y lock real,
conexión de SessionState/dispatcher al nuevo Execution, post-lease y proveedor de
cursor, propietario Stage retenido en éxito/fallo, exclusión de append tardío y join
con cuerpos reales. No se espera ese informe para desarrollar lo aquí independiente,
pero tampoco se usa un booleano de quiescencia para certificarlo. Faltan pila transitiva,
ABI de binding, guardas/IPS y visualización. No marker, instalador, merge ni hardware.
