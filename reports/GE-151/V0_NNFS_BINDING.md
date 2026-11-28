# GE-151 — nn::fs, binding de pruebas y dos remixes

Base 195a0e5. Revisiones 7240427265 / 7240603831 y continuación 7240789328.

## Implementado

main.cpp V0NnFiles: stat/tipos/lecturas acotadas, CreateDirectory del directorio
propio si falta, CreateFile sin truncar, WriteFile, RenameFile con rechazo de destino
presente, DeleteFile solo para journal propio y FlushFile resuelto por símbolo SDK.
Se cierran handles en cada rama. No montaje ni IO al iniciar el módulo: la entrada
get_save_io exige FsApi ya montada y símbolos. Ninguna de estas llamadas se ha
probado en Horizon: la compilación acredita ABI declarada, no semántica física.

v0_file_io.hpp aplica scoping estricto del ID bloqueado, mutex local no copiable y
gate del Installer antes de operaciones. No confundir ese mutex local con el mutex
OS del Installer ni afirmar exclusión entre sistemas/dispositivos. El contrato sigue
prohibiendo instalación/recovery concurrentes con el juego. Runtime ignora totalmente
el archivo permanente .installer.mutex y bloquea por .installer/lock o journal.json.
El proveedor conserva errores desconocidos; no borra centinelas ni archivos ajenos.

**syncDirectory devuelve false**: FlushFile no demuestra sincronización de directorio,
y CommitSaveData no se usa como sustituto de un SD filesystem. Por ello H9 con este
proveedor queda Pending antes de confirmar: no se simula durabilidad ni éxito. El test
inyectado reproduce exactamente ese bloqueo. Falta revisar una frontera de durabilidad
admisible o un servicio real compatible antes de una prueba física de guardado.

El primer enlace falló por free, referenciado desde el deleting-dtor generado para
la interfaz IO. Se corrige propiedad, no se introduce allocator: IO es prestada,
con destructor protegido no virtual, y FileIO no copiable. Nadie elimina IO*; cada
proveedor posee su vida útil. Build final enlaza sin imports ELF sin resolver.

Backend ahora conecta Loader/IO/Execution/factoría/identidad durable con SessionState.
configure_loaded deriva estados por ID: paquete inválido o guardado bloqueado deshabilita
solo su slot. Launch reserva sesión, suelta el lease, arma snapshot/lee guardado y solo
entonces llama al original. Entrada de constructor enlaza Execution y stageStarted;
finish/quiescencia requieren StageToken. Ruta legacy sin token/segundo consumidor de
H9 queda bloqueada cuando Execution está conectado. Persistencia confirma y cierra la
sesión solo tras commit. H9 y lecturas no se ejecutan sosteniendo el lease del estado.

La identidad durable del journal se pasa separada del token de callback. El harness
usa un proveedor de transacciones distinto; no hay aún proveedor nativo acreditado
para unicidad tras reinicio/restore. Colisiones se rechazan, no se sobrescriben.
Post-lease/actor serializado, cursor y coordinación de fallo entre Execution/SessionState
siguen pendientes para binding vivo. No se ha instalado r21Ctor ni B2 nuevos.

Loader::load ya no retorna fallo global por primer manifest/timeline malo: conserva
packageError por slot y sigue B. Registro/gate/generación corruptos sí bloquean todo el
registro custom. Hay pruebas separadas de manifest A corrupto (no solo GSV A corrupto),
B compilable y presencia inocua del mutex permanente.

## Paquetes y Installer

make_v0_custom_remixes.py produce Custom-Remix-A.groove (RING) y B (KAERU), con tiempos
sintéticos distintos, IDs UUIDv4 fijos de fixture, sin StageID nuevo ni recursos Nintendo.
Produce además loader-fixture para tests, README_ES y SHA256SUMS; no engine.json,
subsdk ni IPS. Salida siempre nueva, nunca sobrescribe. test_v0_fixtures comprueba
reproducibilidad y aceptación por GE-155 exacto 4ef974635a691d95ba59c90853c4bcc17fdfcfaf.
Los .groove son válidos para validate/preview, NO prueba de instalación/jugabilidad.
No copiar loader-fixture sobre una SD existente ni fabricar marker para eludir Installer.

## Pruebas y límites

python3 tools/run_engine_tests.py: 19 métodos Python, 19 GTF, 6 binarios ASan/UBSan,
exit 0. Incluye dispatcher→SessionState→Loader/Execution→constructor callback→H9 para
A clear y B abort; mismo Stage reutilizado, token viejo rechazado y estados cerrados.
Constructor/originales e IO son sintéticos, no ejecución de 0x4202C0/nn::fs/Horizon.
Build ARM64 final y auditor ELF/NSO pasan; payload idéntico, imports ELF pendientes
vacíos. check_v0_arm64 ejecuta lector/GSV/dispatcher del ELF, no proveedor SD.
Hashes/evidencia: V0_NNFS_BINDING_RESULTS.json. No claims de GPU, Switch o FAT/exFAT.

Sigue pendiente retención normal acotada de recibos/archivos y políticas tras restore;
no hay purga automática. No presentar el nuevo generador de transacción como solución
nativa a reinicios. No candidate/marker ni instalar: propietario/B2 corregida, IO/sync,
worker real, serialización, pila transitiva, IPS/ABI/visualización aún bloquean.
