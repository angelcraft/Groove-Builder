# Task report: GE-155

- Agent: Grok
- Task ID: GE-155 — validador e instalador de paquetes `.groove` (host: Windows / Android)
- Base branch and exact SHA: `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9` (línea base acordada en AGENTS.md; la misma de #5/#6/#7)
- Spec: `docs/GROOVE_PROFILE_DRAFT_02.md` + `docs/schema/groove-runtime-manifest.draft.schema.json` (`coordination/v0.6.0` @ `7a5fe22`) y `docs/GROOVE_SPEC.md` (Draft 0.1, límites)
- Working branch: `grok/groove-package-validator`
- Status: ready for review (BORRADOR; formatos sin congelar)

## Changes
| Ruta | Qué |
|---|---|
| `tools/groove_package/` | Núcleo stdlib: ZIP estricto, manifiesto, timeline, compatibilidad, `slots.json`, instalador transaccional, CLI. Ver su `README.md`. |
| `tools/groove_package/vendor/` | `gtf.py` + `engine_contract.json` de GE-151 @ `9b56aab` y esquema de GE-154 @ `7a5fe22`, sin editar; hashes en `PIN.json`. |
| `tools/groove_install.py` | Punto de entrada CLI. |
| `tests/package/` | 6 módulos de prueba, `make_fixtures.py` (corpus determinista), `run_all.py`. |
| `tests/package/fixtures/` | 2 niveles sintéticos (A: GTF, B: GTLM 1; ids UUID v4 distintos) + A 1.1.0 para actualización + 102 paquetes inválidos con el código esperado en `corpus.json`. |
| `.github/workflows/package-installer.yml` | Solo `workflow_dispatch` (Windows/macOS/Linux, Py 3.9 y 3.13). **No ejecutado.** |
| `reports/GE-155/` | Este informe, `FORMAT_QUESTIONS.md`, `TEST_RESULTS.json`. |

No se toca `engine/`, `editor/`, `main` ni ramas `codex/*`, `gemini/*` o `grok/dynamic-stage-research`.

## Evidence (solo host; sin ARM64, sin emulación, sin Switch)
```
python3 tests/package/run_all.py reports/GE-155/TEST_RESULTS.json      # Python 3.13.5, Linux
python3 -m unittest discover -s tests/package                          # mismo resultado
python3 tests/package/make_fixtures.py --check                         # 107 archivos reproducibles byte a byte
```
- Python 3.13.5: **39 pruebas, 0 fallos, 0 errores, 0 omitidas; 553 subpruebas OK, 0 fallidas.**
- Python 3.9.25: 39 pruebas, 0 fallos, 0 errores; 528 subpruebas OK; 1 omitida (paridad con jsonschema, no instalado ahí).

Desglose:
- **Seguridad del archivo**: 102 paquetes maliciosos/malformados rechazados con el código exacto (traversal, rutas absolutas, `\`, unidad, dispositivos DOS, symlink, directorio, duplicados, colisión de mayúsculas, cifrado, método/flags/extras no admitidos, ZIP64, multidisco, datos antepuestos/finales, cabecera local ≠ central, CRC, longitud, bombas con tamaño falso y declarado, deflate corrupto, >256 miembros, miembros extra, audio/texto/romfs/main/IPS/ZIP anidado/.rhref, 37 de manifiesto y 19 de timeline). 3000 mutaciones aleatorias de bytes y **todas** las truncaciones de A y B: siempre `PackageError`, nunca otra excepción ni aceptación de contenido cambiado.
- **Compatibilidad**: paridad estructural con el esquema de GE-154 en 25 variantes; reglas semánticas extra; matriz motor (0.5.x rechazado, 0.6.0/0.6.1/0.10.0/1.0.0 aceptados, comparación numérica), contrato 2 y build desconocida rechazados; `engine_min` numérico.
- **Instalación**: A→casilla 0 (0,9,0), B→casilla 1 (0,9,1); tercera → `SLOTS_FULL` sin cambios; actualización conserva casilla y guardado; mismo contenido → `unchanged`; mismo id+versión con otros bytes → `VERSION_CONFLICT`; bajada → `DOWNGRADE_REFUSED`; desinstalar conserva `.gsv`; purga con copia idéntica previa; `slots.json` corrupto/legado/inválido rechazado sin tocarlo; carpeta con archivos ajenos o symlink rechazada; registro ampliable a 256 y no más.
- **Transacciones**: 7 escenarios (instalar primero, segundo, actualizar, desinstalar, purgar, desasignar, reparar `slots.json`). Corte de energía simulado en **cada** paso (93 puntos) → tras `recover` el SD queda exactamente antes o después; error de E/S en cada paso (93) → si se informa error, el SD queda exactamente como antes; corte **durante** `recover` (223 combinaciones) → consistente. En cada prueba de instalación se verifica que los archivos ajenos (`multi.gtf`, `stages/`, `atmosphere/`, JKSV, otros `.gsv`) quedan byte a byte iguales.

Fallos encontrados y corregidos durante el trabajo: (1) un corte durante la limpieza de un rollback podía hacer que una segunda recuperación tratara el nivel antiguo como nuevo → ahora se escribe el estado `aborted` en el diario antes de borrar el staging; (2) un error de E/S en la limpieza posterior al commit dejaba el lock puesto → ahora se libera y `recover` completa.

## Compatibility and risks
- Proprietary review: solo datos sintéticos (tiempos y nombres de cue); sin binarios, ROMFS, audio, texturas, MSBT ni dumps. Los marcadores del SD de prueba son texto inventado.
- El runtime v0.5.0 **no** lee `sd:/groove/levels/`; instalar hoy solo prepara archivos. Por eso, sin un destino ≥ 0.6.0 el instalador rechaza.
- FAT32/exFAT: el diario garantiza el estado lógico, no la integridad del sistema de archivos ante un corte (recomendado chkdsk/fsck y copia con JKSV).
- Solo probado en Linux. Windows y Android: ver `tools/groove_package/README.md`.
- Rollback: borrar `tools/groove_package/`, `tools/groove_install.py`, `tests/package/`, el workflow y `reports/GE-155/`; nada más depende de ellos.

## Dependencies / blockers
- GE-154: confirmar o cambiar los formatos de `FORMAT_QUESTIONS.md` (slots.json, engine.json, reglas runtime, rutas reservadas).
- GE-151: loader nativo de `levels/` + `slots.json`; publicar `engine.json` o equivalente; re-fijar `gtf.py`/contrato si cambian.
- GE-152/151: formato `.gsv` (el instalador no depende de él, solo lo protege).
- GE-153: compartir el corpus `tests/package/fixtures/` y alinear el exportador con las reglas ZIP de la sección D.

## Next steps
Respuesta de GE-154 → congelar o ajustar; adaptador SAF para Android; ejecutable Windows; ejecutar el workflow manual cuando se autorice. Sin instalación en hardware.
