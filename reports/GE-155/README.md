# Task report: GE-155 (ronda 2: Draft 0.3 + revisión de seguridad + GUI Windows)

- Agent: Grok
- Task ID: GE-155 — validador e instalador de paquetes `.groove` (host: Windows / Android)
- Base branch and exact SHA: `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9`
- Spec: GE-154 Draft 0.3 `docs/GROOVE_INTEGRATION_V0_DECISIONS.md` + Draft 0.2 perfil/esquema (`coordination/v0.6.0` @ `3642b7e`; TASKS.md @ `1e9855c`)
- Working branch: `grok/groove-package-validator`
- Status: ready for review (BORRADOR; decisiones V0 implementadas, sin congelación final)

## Cambios de esta ronda
| Ruta | Qué |
|---|---|
| `tools/groove_package/` | Decisiones A–F de Draft 0.3 y correcciones de la revisión (ver `FORMAT_QUESTIONS.md` y el README del módulo). Nuevos `jsonstrict.py`, `safefs.py`, `lock.py`. `engine.py`, `slots.py`, `installer.py` reescritos. |
| `tools/groove_package/vendor/` | Re-fijado: `gtf.py` + `engine_contract.json` (GE-151 @ `9b56aab`, sin cambios), esquema, `GROOVE_PROFILE_DRAFT_02.md` y `GROOVE_INTEGRATION_V0_DECISIONS.md` (GE-154 @ `3642b7e`); SHA-256 en `PIN.json`. |
| `tools/groove_gui/`, `tools/GrooveInstaller.pyw` | GUI tkinter fina para Windows: `controller.py` (sin GUI, mensajes en español por código) + `app.py` (vista). `GrooveInstaller.spec` opcional (PyInstaller, sin binarios en el repo). |
| `tests/package/` | Corpus regenerado (3 válidos + 113 inválidos), `test_review_fixes.py` (diario malicioso, concurrencia, enlaces, staging desconocido), `test_gui.py`, pureza del núcleo. |

## Evidence (solo host Linux; sin Windows real, sin Android, sin Switch)
```
python3 tests/package/make_fixtures.py --check          # 118 archivos reproducibles, 0 diferencias
python3 tests/package/run_all.py                         # ver TEST_RESULTS.json
xvfb-run -a <python con tkinter> tests/package/run_all.py
```
| Python | Pruebas | Fallos/errores | Subpruebas OK | Omitidas |
|---|---|---|---|---|
| 3.13.5 (sistema, sin tkinter) | 60 | 0 | 729 | 1 (vista GUI: no hay tkinter) |
| 3.13.18 + Tk 9.0 (xvfb) | 60 | 0 | 729 | 0 |
| 3.9.25 + Tk 8.6 + jsonschema (xvfb) | 60 | 0 | 729 | 0 |

- Corpus: 113 inválidos con código exacto (archivo 38, manifiesto 38, timeline 26, conjunto de miembros 11) + 3 válidos.
- Transacciones: corte en cada paso (113), error de E/S en cada paso (113), corte durante `recover` (293) en 8 escenarios; siempre estado exacto antes/después, guardados y archivos ajenos intactos.
- Diario malicioso: 15 manipulaciones + tx ajenos + symlink → rechazo, SD sin cambios, evidencia conservada.
- Concurrencia: otro proceso con el lock → todas las operaciones `LOCKED`, el lock vivo no se borra.
- GUI: controlador (siempre) y vista tkinter con Xvfb (validar, instalar A/B, lista, asignar/quitar, desinstalar con confirmación, recuperar, errores legibles). El `.spec` se probó a construir en Linux (no se sube el binario). **No ejecutada en Windows real.**

## Compatibility and risks
- Proprietary review: solo datos sintéticos; sin binarios, ROMFS, audio, texturas, MSBT ni dumps.
- v0.5.x no lee `levels/`: sin `engine.json` ≥ 0.6.0 el instalador rechaza (`ENGINE_UNKNOWN`).
- Junctions/reparse points y lock `msvcrt` implementados para Windows pero solo probados en Linux.
- FAT/exFAT: sin afirmaciones de durabilidad. Android: sin SAF.
- Rollback: borrar `tools/groove_package/`, `tools/groove_gui/`, `tools/GrooveInstaller.pyw`, `tools/groove_install.py`, `tests/package/`, el workflow y `reports/GE-155/`.

## Dependencies / open items
Ver `FORMAT_QUESTIONS.md` § Abiertos: capacidades desconocidas, conformidad final de GE-154, productor del marcador (GE-151), corpus para GE-153, pruebas en Windows/Android, workflow manual (requiere autorización).
