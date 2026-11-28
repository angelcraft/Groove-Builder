# GE-155 — formatos: decisiones de GE-154 (Draft 0.3) y puntos abiertos

Las preguntas de la primera ronda las resolvió GE-154 en `docs/GROOVE_INTEGRATION_V0_DECISIONS.md`
(`coordination/v0.6.0` @ `3642b7e`, copia fijada en `tools/groove_package/vendor/`). Todo está implementado
como **decisiones V0**, no como congelación final: falta la confirmación de conformidad de GE-154.

| # (ronda 1) | Decisión aplicada | Dónde |
|---|---|---|
| A1–A5 slots.json | `groove-slots/1`; capacidad 2..256; casillas ≥ 2 con `coord`/`id` nulos; coords de 3 enteros (no bool/float); ids `fullmatch` sin dispositivos DOS; ≤ 64 KiB JSON estricto; `generation` 0..2147483647, +1 exacto por cambio efectivo, nunca da la vuelta (`SLOTS_GENERATION_OVERFLOW`); no-op = `unchanged`; escritor único; sin migración silenciosa; offline | `slots.py`, `installer.py` |
| B6–B7 engine.json | `groove-engine/1` con claves exactas `format, engine_version, engine_contract, build_id, capabilities`; build completa `03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8`; capacidades requeridas para instalar: `package.runtime/1`, `registry.slots/1`, `adapter.multi` y `timeline.gtf`/`timeline.gtl` según el paquete (asignar exige `package.runtime/1` + `registry.slots/1`); ≤ 4 KiB; override CLI solo en `plan` | `engine.py`, `cli.py` |
| C8–C12 timeline/versiones | `start` y `results exit` explícitos obligatorios en GTF y GTLM; duplicados/conflictos, `match` y `results native` → error; id no v4 → aviso; mismo contenido con otro ZIP → idempotente; **sin downgrade ni purga** en V0 (flags eliminados) | `timeline.py`, `installer.py` |
| D13–D14 ZIP | sin comentarios (archivo y miembro); nombres ASCII exactos; extras restringidos; version needed ≤ 20; descriptores solo si coinciden; la allowlist exacta de 2 miembros manda | `zipreader.py`, `validator.py` |
| E15–E16 transacciones | diario no fiable (esquema estricto, rutas derivadas, sin listas de rutas, hashes; si hay manipulación se rechaza y se conserva la evidencia); lock exclusivo del SO, nunca se borra un lock vivo; lock antes de leer/comprobar/asignar y durante `recover`; sin symlinks/junctions/reparse points; lecturas acotadas; `tx-*` desconocidos nunca se borran | `installer.py`, `lock.py`, `safefs.py` |
| F17 | se mantienen `gtf.py` y `engine_contract.json` fijados de GE-151 @ `9b56aab` hasta la integración | `vendor/PIN.json` |
| F18 | TASKS.md (@ `1e9855c`) ya registra GE-155 → Grok, `tools/groove_package/`, `tools/groove_install.py`, `tests/package/` | — |

## Revisión GE-154 de `d3c971f` (PR #8, comentario 7239548049) — aplicada
| Punto | Implementación | Pruebas |
|---|---|---|
| Capacidades futuras desconocidas, bien formadas y únicas | **Aceptado por GE-154**: se ignoran; nunca sustituyen a una requerida ni permiten contrato/build desconocido | `test_review_7239548049.FutureCapabilities` |
| `assign` revalida el paquete instalado | lectura acotada bajo el mismo lock + `validate_installed` (manifest, id, archivos, timeline) + `check_compat` (contrato, `engine_min`, adaptador, build, capacidad `timeline.<fmt>`) | `AssignRevalidation` |
| Contrato en `check_registry_capable` | `ENGINE_CONTRACT_UNSUPPORTED` | `RegistryCapable` |
| Lock: fallo al adquirir, escrituras completas, sin borrar el lock ajeno, carrera release/reacquire (orden Windows) | `lock.py` reescrito | `LockAcquireFailure`, `LockRelease`, `LockMultiProcessRace` |
| Coherencia barrera lock/diario | el archivo de lock se conserva si queda diario, `journal.json.tmp` o la operación se interrumpe | `GateCoherence` |
| Hashes del diario = detección, no autenticación; FS de confianza; sin promesa TOCTOU | documentado en `tools/groove_package/README.md` («Modelo de confianza») | — |
| Recuperación conserva evidencia y no exige marcador retirado; sin nuevas asignaciones sin marcador | `groove/backups/recovery-<tx>/`; `recover`/`uninstall`/`unassign` sin marcador, `install`/`assign` lo exigen | `RecoveryEvidence` |
| Matriz Windows/macOS/Linux solo con autorización; mientras, Windows local con SD sintética | workflow manual sin ejecutar; `tools/groove_sd_sim.py` + `WINDOWS_VALIDATION.md` | `test_sd_sim` |

Es **conformidad provisional para integrar en V0, no congelación final**.

## Abiertos (requieren GE-154 / otros dueños; no decididos aquí)
1. ~~Capacidades desconocidas~~ — resuelto (ver arriba).
2. **Aprobación final de GE-154** sobre estas dos correcciones antes de congelar.
3. **Productor del marcador** `engine.json`: pertenece a GE-151, que solo debe producirlo junto con un cargador funcional. Aquí solo se lee.
4. **Corpus compartido**: GE-153 debe usar el corpus **de este SHA** y ejecutar `tests/package/fixtures/` (3 válidos + 113 inválidos, `corpus.json`) contra su exportador.
5. **Pruebas en Windows y Android reales** pendientes (lock `msvcrt`, junctions, GUI). El workflow manual no se ha ejecutado (requiere autorización).
6. **SAF**: no hay adaptador; no se afirma nada sobre SAF.
7. **FAT/exFAT**: no se afirma durabilidad; la inyección de fallos en Linux no es prueba para FAT/exFAT.
