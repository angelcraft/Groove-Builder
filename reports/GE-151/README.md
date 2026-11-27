# GE-151 — Parser, memoria, estadísticas propias y build ARM64

- Agente: Codex. Estado: listo para revisión del código; bloqueado para release/hardware.
- Base acordada: `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9`.
- Rama exclusiva: `codex/engine-v0.5.1-hardening`.
- Revisión de código compilada y probada: `ff2adc2a186cfc3e1a15ca1957d673cf7f230dc2`.
- PR borrador: https://github.com/angelcraft/Groove-Builder/pull/6 (contra la base runtime, no main).
- Coordinación leída: `coordination/v0.6.0` @ `0ca2c9d`, AGENTS/TASKS/ROADMAP/CONTINUE y GROOVE_SPEC. Misión reclamada en #3.
- Consultados #1/#2/#4 antes de publicar; después, #5 de Grok @ `38b102d0a5cdb092cf89e9f7811df37efbf66214`. No se incorporan sus ramas ni se modifican contratos `.groove`, editor o menú.

## Implementación

- `parser_support.hpp`, `numparse.hpp`, `gtf.cpp`, `multi.cpp`, `timeline.cpp`: int32 sin conversión hex que envuelva; suma de reloj y end/finish automáticos acotados; precisión decimal sin multiplicación desbordada; presupuesto de 32768 operaciones de expansión, incluyendo bucles vacíos; profundidad loop/call limitada a 8 por clase. Entrada <= 61440 bytes, 4096 líneas, 255 bytes/línea; GTF/GTLM <=12 tokens, GTL1 <=4. Rechazo de NUL, controles y UTF-8 malformado. Se rechaza el exceso, no se trunca silenciosamente.
- Cadenas para eventos en arenas persistentes deduplicadas; el scratch de GTF ya no es almacenamiento publicado al juego. Un parse fallido revierte solo las entradas nuevas. Los punteros previamente publicados permanecen estables. Parser y búfer de entrada/estadísticas tienen exclusión atómica no bloqueante; los callbacks ocupados declinan el trabajo opcional.
- `cue_validation.hpp`, generado desde `tools/engine_contract.json`: 127 perfiles escalares documentados y dominio RING de máscaras; layouts solo por asociación de juego en el catálogo existente. Tres variantes Thunder con valores que podrían ser referencias se rechazan hasta aclarar ABI/ASLR. Procedencia: catálogo previo y docs/cue_functions.md, no nuevas pruebas del código del juego.
- `metadata.hpp` y `scanTileTitle`: se ejecuta el parser completo antes de aplicar título, match, prólogo o jingle. El almacenamiento de inspección es independiente del de los trabajadores. Una timeline inválida no puede activar metadatos válidos por separado.
- `save_replace.hpp`, `persistCustomSave`: temporal nuevo y flush, antiguo -> backup nuevo, temporal -> destino. Si falla el último rename se intenta restaurar. Si falla también la restauración, los datos permanecen en backup/temporal. No se borra el guardado antiguo para reemplazarlo. Se comprueba el resultado/tamaño de snprintf y GetFileSize.
- Las arenas tienen capacidad finita: GTF eventos 64 KiB, GTLM 8 KiB y GTL1 4 KiB; al agotarse, se rechazan cadenas nuevas. Se conservan hasta 64 pares de nombres backup/temporal por destino, sin borrar respaldos; al ocuparse todos, se rechaza una nueva escritura.
- La identidad de timeline se conserva hasta que termina el destructor original, y no se reemplaza durante otra instancia viva del mismo adaptador. Se comprueba la asignación nativa antes de usar un nuevo trabajador. Esto reduce riesgos, pero **no demuestra** el contrato de terminación de los hijos del Runner.
- `tools/groove_rhre.py:check_multi` reutiliza el parser GTLM endurecido en vez de truncar tokens con otro lector.

## Compatibilidad que requiere revisión

GTF conserva start=0; GTLM conserva start=2880. Los GTL1 de varias canciones mantienen relojes relativos por parte; se prueban partes con end final menor que los ticks de la parte anterior. Se prueban los dos ejemplos públicos, los 80 cues canónicos y 27 alias de juegos. No hay niveles privados aquí con los que acreditar equivalencia de todas las bibliotecas del usuario.

Se mantienen formatos, orden y campos de eventos válidos. Cambios deliberados de rechazo: enteros que envolvían (usar -1, no 0xFFFFFFFF), decimales no exactos, exceso de argumentos/tamaño, offsets arbitrarios, argumentos sin respaldo, rutas de prólogo que escapan y end/finish explícitos incoherentes. No se corrige silenciosamente un finish explícito anterior a end.

Multi omite `results native` por defecto. El parser conserva una petición explícita, pero el runtime bloquea la llamada directa a toResults y toma exit hasta verificar aislamiento. **Exit no demuestra ausencia de otros cambios nativos de progreso**: GE-152 describe beginPlay/setPending/commitResult; hay que comprobarlos. HT3/Double Hell mantienen su opción native/NO_NATIVE_RESULTS anterior; no se afirma aislamiento de esos modos.

Las animaciones conservan sus nombres; se valida sintaxis y layout por juego, no una biblioteca exhaustiva de nombres/recursos. Su existencia y seguridad nativas siguen pendientes. Los perfiles documentados tampoco sustituyen una prueba de comportamiento en cada Scene.

## Evidencia ejecutada

```sh
python3 tools/run_engine_tests.py
```

Exit 0. Incluye:

- 13 métodos unittest, 9 de ellos diferenciales contra las fuentes C++ reales compiladas con UBSan; 80 cues, 127 perfiles, 27 alias, 100 secuencias aleatorias reproducibles, ejemplos/round trips y entradas inválidas.
- 19 casos del compilador GTF existente: 19 OK, 0 fallos. Su caso opcional multi_prueba.gtl privado sigue omitido porque no está junto al repositorio.
- C++ con ASan+UBSan: límites, cadenas, 10000 cargas repetidas GTF, 10000 parses fallidos con tags únicos, 10000 cargas GTL1, multipartes, metadatos válidos/inválidos, exclusión atómica real y errores de rename/rollback. Más los dos binarios de política/títulos anteriores.
- Aquí LeakSanitizer no funciona bajo el ptrace del sandbox: la batería completa se ejecutó fuera de ese sandbox, con ASan/UBSan y LeakSanitizer habilitados. No se desactivaron para ocultar errores.

Builds independientes en `/workspace/engine-verified-a` y `/workspace/engine-verified-b`:

```sh
python3 tools/build_engine.py --loader /workspace/groove-loader \
  --std /workspace/public-stdlib/lib/std --out /workspace/engine-verified-a --build
# Repetir con un directorio B NUEVO.
python3 tools/verify_engine_artifacts.py /workspace/engine-verified-a
cmp /workspace/engine-verified-a/build/GrooveHT3.nss /workspace/engine-verified-b/build/GrooveHT3.nss
cmp /workspace/engine-verified-a/build/GrooveHT3.nso /workspace/engine-verified-b/build/GrooveHT3.nso
```

Clang Debian 19.1.7, CMake 3.31.6, Ninja 1.11.1.git.kitware.jobserver-1, pins de loader/submódulos y árbol stdlib verificados. Ambos builds completos terminaron con exit 0; cmp exit 0 para ELF y NSO. El entorno original no tenía toolchain; se extrajeron paquetes oficiales en el workspace y se instalaron dependencias Python en venv, sin cambios de permisos ni TLS.

Auditoría: ELF64 LE AArch64 ET_DYN, segmentos RX/RO/RW, 665 relocaciones RELATIVE a almacenamiento escribible, cero símbolos ELF sin resolver; los tres segmentos NSO descomprimidos coinciden exactamente con el ELF. Esto no verifica las búsquedas dinámicas de símbolos SDK en Horizon. NSO flags=0x7 no exige hashes embebidos de segmentos; el auditor lo indica expresamente.

SHA-256 locales de código propio compilado (NO se suben binarios):

- ELF: `2fdc2dbce7ae33a8699692bd58436e29ad1dab610a33267b05d0e9ce2e66902b`.
- NSO: `2e557d5c02bbc677550d8e82a4be7ae111417a3e4b35163461cf7489b43ba22a`.

Warnings conservados del loader: plataforma CMake NX y listas export ausentes, alineación de stdlib y warning Clang desconocido. No fueron errores. Workflow manual reproducible preparado; **no se ha ejecutado en Actions**, ni se han gastado presupuestos ni publicado artefactos.

## Bloqueos / límites reales

- No se ejecutaron Unicorn, main/SDK privados, GPU ni Switch. Las 108 pruebas privadas citadas por v0.5.0 no se reproducen: faltan imagen, harness y fixtures privados; no se convierten en tests pasados.
- GE-156 debe validar cancelación, cierre/reinicio, destrucción de hijos por el propietario nativo, TLS y resultados. El test de un lock no demuestra esa vida útil.
- No hay cota transitiva completa de pila de los callbacks/servicios nativos. Los límites de recursión/entrada son un prefijo acotado; las funciones originales, callbacks y servicios no están disponibles en esta tarea. No se certifica presupuesto de pila.
- El rollback entre dos renames no es atómico frente a corte eléctrico: puede quedar el destino ausente y el anterior en `.bak.N`. Conservar el backup y revisar/recuperar sin sobrescribir otros archivos. No se implementó recuperación automática de una caída.
- Instalación/retirada de hooks, permisos efectivos, sincronización nativa y compatibilidad física siguen siendo condiciones de release, no consecuencias de compilar.

No instalador. No fusión. No edición de ramas ajenas, módulos instalados, guardados, NPDM, IPS, ni recursos propietarios. Revisión GE-154 del contrato de validación antes de que GE-153/GE-155 lo adopten.
