# Continuación GE-151 (Codex)

Rama: `codex/engine-v0.5.1-hardening`. PR #6:
https://github.com/angelcraft/Groove-Builder/pull/6
Base: `61873906f016d46ac1d47d7a5016ec6e3fe93fa9`.
Código probado: `ff2adc2a186cfc3e1a15ca1957d673cf7f230dc2`; el commit siguiente añade únicamente este informe/documentación.

Leer el AGENTS/TASKS/ROADMAP/CONTINUE/GROOVE_SPEC de la coordinación actual antes de retomar. No modificar sus archivos compartidos desde GE-151. GE-152 publica investigación en #5; no incorpora cambios runtime. GE-153/154/155 deben revisar los límites nuevos antes de usar el contrato del parser, sin convertirlo en un contrato `.groove` congelado.

Implementación, compatibilidad, comandos, hashes y limitaciones: [README.md](README.md).
Resultados verificables: [test-results.json](test-results.json).

Ya realizado: parsers acotados, máscaras/perfiles/layouts documentados, cadenas persistentes con rollback/deduplicación, metadatos validados, protección del buffer de entrada, guardado con backups y rollback de rename, bloqueo de toResults directo Multi, comprobación de asignación de trabajadores y conservación del contexto hasta después del destructor original. No rehacer estos cambios.

Verificaciones: `python3 tools/run_engine_tests.py` exit 0; 13 métodos unittest, 19 casos GTF y 3 binarios C++ con ASan/UBSan. 2 builds ARM64 completos byte-idénticos. Auditor ELF/NSO pasa; hashes en informe. No pruebas nativas del juego ni físicas.

Siguiente paso exacto: revisión del PR #6 por coordinación. Después, GE-156 necesita el harness privado/SDK o evidencia física dirigida para acreditar destrucción de hijos, ausencia de commits de progreso en Multi exit y cota de pila transitiva. No confundir la supresión de toResults con prueba de aislamiento: GE-152 identifica beginPlay/setPending/commitResult. No preparar instalación desde esta rama sin esa revisión. Mantener #3 y #6 como borradores.

Build reproducible: Clang 19.1.7 en PATH; `python3 -m venv` y `pip install -r tools/engine-build-requirements.txt`; loader a321204 con submódulos exactos de tools/loader_pin.json; stdlib verificado por tools/engine_build_pin.json. tools/build_engine.py exige salida nueva y verifica pins. No subir `.nss`, `.nso`, subsdk o IPS al repo público. Workflow engine-hardening.yml es manual y no ha sido lanzado.

## Seguimiento del ciclo nativo

Ver NATIVE_LIFECYCLE_FOLLOWUP.md y stack-diagnostic.json. Nuevo auditor
ARM64 tools/audit_engine_stack.py: 114 registros locales, NO cota LTO ni
nativa. La batería ahora pasa 15 métodos unittest; runtime sin cambios.
PR #5 recibió solicitud concreta de cadena de destrucción (0x4290F0 /
0x4207F0) y aislamiento ANTES de beginPlay 0x48B0, que ya incrementa plays
antes del ctor custom. Esperar evidencia de GE-152; omitir toResults NO
basta. No candidato instalable. No volver a pedir capturas generales.


## Última continuación: GE-152 @ 8e11d7b

Leer el último apartado de NATIVE_LIFECYCLE_FOLLOWUP.md antes de reutilizar el runtime.
Join es posterior al dtor del Stage; el supuesto anterior NO queda validado.
Exit tampoco aísla progreso/perfectos. No implementar F0–F4 sin la validación dirigida
pedida por coordinación en #5. Falta imagen/harness privado en este entorno.
Se corrige saved para reflejar éxito real y registrar contención/SD ausente.
15 pruebas Python, 19 GTF y tres ASan/UBSan pasan; nuevo build ARM64 y auditor pasan.
Resultados/hashes en SAVE_FOLLOWUP_RESULTS.json. No candidato instalable ni prueba física.
Siguiente paso: traza de reap/join/último acceso y diferencias de guardado desde antes
del launch, normal/abort/reinicio. No confundir objetos host ni capacidad 64 KiB con
vida útil o cota de pila nativas verificadas.
