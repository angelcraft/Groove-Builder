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

## V0 en curso — decisiones 3642b7e / GE-155 d3c971f

Entradas ARM64 reales en v0_entries.S y dispatcher en v0_native.cpp, enlazados en
el módulo final (sin instalación ni binding desde hkMain). v0_session.hpp contiene
H0/generación, A/B exactos, contexto confirm, cursor, identidad de sesión copiada,
resultado/quiescencia y confirmación de persistencia por ID/token. No confundir la
notificación groove_v0_quiesced con un join real: todavía NO tiene proveedor nativo.
No hay nuevo hook instalado. Legacy sigue separado.

Prueba reproducible: python tools/run_engine_tests.py; después construir mediante
build_engine.py con pins previos y ejecutar tools/check_v0_arm64.py <build>.
Requiere Unicorn 2.1.4 y pyelftools del entorno Python; no usa main privado.
Resultado V0_ARM64_RESULTS.json: ejecuta entradas del ELF FINAL, 180 coordenadas,
178 delegaciones, LR/SP/callee-saved y llamada original única, flags restaurados.
Originales y memoria son fixtures sintéticos. 336 bytes observados son solamente
este recorrido de callback; NO cota transitiva del juego. La prueba host integrada
también cubre retorno de mapa, A/B sucesivos en el mismo proceso, IO fallida y retry.

Pendiente, NO implementado: lector nativo estricto slots.json/manifest/timeline,
adaptador SD con lock/journal, conexión del constructor Multi por paquete, proveedor
real de retención Stage/registro exclusivo/join, persistencia durable H9 y guardas
completas de instrucciones/IPS/visibilidad. No generar engine.json: decisiones
3642b7e prohíben marcador para investigación sin loader funcional. .gsv160 no aprobado.
Siguiente paso: lector acotado conforme a docs/GROOVE_INTEGRATION_V0_DECISIONS.md
de coordinación, contrastar corpus GE-155 d3c971f y conectar al dispatcher existente.
No recrear las entradas ARM64 ni presentar sus pruebas sintéticas como Horizon.

Batería final: 15 métodos Python, 19 casos GTF y cuatro binarios ASan/UBSan
(incluido el dispatcher V0) pasan. El verificador opcional ARM64 se llama
check_v0_arm64.py para no exigir Unicorn al descubrir pruebas host con unittest.


## Incremento lector V0 — revisión 7239745290

Leer V0_LOADER.md, V0_LOADER_RESULTS.json y V0_LOADER_STACK.json. El lector ya existe:
engine/src/v0_loader.{hpp,cpp}; no rehacer JSON/registro ni dispatcher. Admite snapshots
acotados A/B, corpus GE-155 d3c971f y guardas lock/journal/generación. Entrada SD retenida
main.cpp::groove_v0_load_sd_levels, sin llamada automática ni hooks nuevos. Falta validar
esa ruta nn::fs en contexto seguro; loader y SessionState/constructor siguen separados.

18 métodos Python, 19 GTF y cinco binarios sanitizados pasan; 3 paquetes positivos,
64 rechazos manifest/timeline y 10000 mutaciones. ELF final/NSO auditados y ejecutado
parseRegistry ARM64 real además del dispatcher; originales sintéticos, no Horizon.

Se corrigieron guardado global en contención, retorno post, consumo de cursor y
supresión de siguiente partida nativa con IO pendiente. Faltan postcondiciones de
confirm/reverse/bits bajo contención y proveedor all-or-none del cursor; no binding vivo.
Siguiente: conectar snapshot/constructor solo tras frontera Stage/Runner retenida en
éxito Y fallo; verificar no append tardío, tokens por generación y worker real. H9 durable
pendiente, .gsv no congelado; no engine.json, hooks, instalador ni prueba física.
