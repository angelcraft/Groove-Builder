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


## Incremento constructor de pruebas y GSV1/H9 — revisión 7240144273

Leer GSV1_H9_PROPOSAL.md, V0_GSV_RESULTS.json y V0_GSV_STACK.json. Nuevos módulos:
v0_execution.hpp (snapshot→constructor/adopción en harness, cinco ints originales,
StageToken por sesión, gates finish/abort/retorno/quiescencia) y v0_gsv.hpp (160 B,
CRC/LE/ID/cotas, journal GJ01, recibos por seq/token, retries y recuperación explícita).
No rehacer el lector ni dispatcher. Tests usan Loader::load real, no valid=true ficticio.
Seis binarios sanitizados, 18 pruebas Python y 19 GTF pasan; ARM64 y auditor pasan,
decoder GSV1 ejecutado en ELF final con encoder Python independiente. IO sintética;
no nn::fs durable, Stage real, GPU ni Horizon.

Snapshots y callback tokens ya se prueban, pero Execution sigue separado del binding
vivo SessionState/r21CtorHook. GSV1/GJ01/retención de recibos requieren revisión GE-154.
IO pending no suprime siguiente sesión nativa. Corrupción se conserva; backup se
restaura solo explícitamente. No inventar score/rank/perfect ni congelar .gsv160.
Siguiente: proveedor IO/locks reales, finalizar post-lease y conectar Execution al
binding cuando el propietario Stage/join esté probado. La consulta PR #5 no tenía
respuesta nueva al revisarla en esta iteración; no se ha esperado para desarrollar H9.
Sin engine.json, instalador, hooks nuevos, Actions ni instalación.


## Incremento nn::fs + binding + Custom Remixes A/B

Leer V0_NNFS_BINDING.md y V0_NNFS_BINDING_RESULTS.json. Ya están conectados en harness
Backend/SessionState/Execution/Loader/constructor/H9 para A y B; no reimplementarlos.
La API de arm exige identidad durable separada de token de callback. Legacy H9 sin
token se bloquea si existe Execution. Proveedor V0NnFiles y FileIO compilan: IO prestada,
scoping por ID, FlushFile real, centinela/journal; .installer.mutex permanente ignorado.
No hay syncDirectory acreditado: devuelve false y H9 Pending, NO éxito ficticio.

Loader ahora aísla manifest/timeline inválido por paquete. 19 métodos Python +19 GTF
+6 binarios sanitizados pasan, build ARM64 y auditor pasan. Generador
make_v0_custom_remixes.py crea 2 .groove propios reproducibles, aceptados por GE-155
4ef9746. Kit es para validación, sin marker ni módulo instalable.

B2 rev2 d2cc779 leída. GE-154 7240789328 exige rev3 con corrección scheduler budget
exhaustion antes de aceptar evidencia; origin/grok/stage-owner aún rev2 al comprobar.
No se instala destroyPending ni se omiten dtors. Próxima revisión: V06_DISTRIBUTION_DRAFT
para estructura/rollback y datos privados requeridos. No esperar a Grok para IO/tests,
pero no activar hasta evidencia; siguen pendientes sync, tx-ID nativo y retención.


## Continuación posterior al commit 80df6db — revisión 7240789328

V06_DISTRIBUTION_DRAFT.json y V06_RESTORE_ES.md preparan estructura, exclusiones,
restauración y rutas privadas exactas. No es un ZIP instalable. Kit de remixes de
validación preparado localmente con hash documentado; se regenera con el generador.
Nueva consulta git fetch grok/stage-owner confirma aún d2cc779 rev2; rev3 corregida
no disponible, así que no integrar/activar B2 todavía. No se ha detenido trabajo
independiente ni se han solicitado nuevas capturas.


## Continuación interina Grok — rama grok/engine-b2-integration (base 98112a9)

Codex sin cuota; el propietario autorizó a Grok a continuar GE-151 temporalmente siguiendo
GE-154 7241433453. La rama codex/* NO se modificó. Leer B2_INTEGRATION.md y
B2_INTEGRATION_RESULTS.json. Ya hecho (no rehacer): H-B2 C++ (b2_owner.hpp, b2_entries.S),
15 tripwires + firmas kSigsB2/kSigsV0, dtors sin I/O, tStop antes de spawn, salida Quit
nativa sin retry implícito, gate syncCapable antes de mutar SD, binding vivo V0
(r21CtorHook→Execution, bindV0/installV0) y guard InitGameplay corregido (launchA pone
mgr+0x2904=modo). run_engine_tests rc 0; check_v0_arm64/verify_engine_artifacts pasan;
b2int.py 44/44 con ELF final + main privado (cooperativo, no Horizon, no Switch).

Siguiente paso para Codex: revisar el diff 98112a9..HEAD (sobre todo main.cpp B2/V0),
decidir si integrarlo en su rama (sin reescribir autoría). Pendiente: syncDirectory
acreditado (hoy H9 Pending = una partida custom por arranque), diseño de retry de pausa
V0, tx-ID entre reinicios, herramienta de engine.json, IPS/visibilidad, y evidencia
Horizon/física (GE-156) cuando se autorice. No candidato instalable; no hardware.
No subir main.img, .nss/.nso, subsdk, IPS ni romfs.
