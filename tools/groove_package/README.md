# groove_package — validador e instalador de paquetes `.groove` (GE-155, BORRADOR)

Núcleo **Python 3.9+ solo con la biblioteca estándar** y **sin imports de GUI** (lo comprueba
`tests/package/test_cli_and_pins.py::CorePurity`), para que el mismo código funcione en Windows (CLI o
la GUI de `tools/groove_gui/`) y dentro de una app Android (p. ej. Chaquopy).
Implementa las decisiones V0 de GE-154 (**Draft 0.3**, `docs/GROOVE_INTEGRATION_V0_DECISIONS.md` en
`coordination/v0.6.0` @ `3642b7e`, copia en `vendor/`) sobre el perfil runtime del Draft 0.2.
Son decisiones V0 implementadas, **no una congelación final**.

```
python tools/groove_install.py validate  nivel.groove [--json]
python tools/groove_install.py plan      nivel.groove [--sd E:\] [--engine-version 0.6.0 --engine-contract 1 --build-id <40 hex> --capability ...]
python tools/groove_install.py install   nivel.groove --sd E:\ [--slot auto|none|A|B|<n>]
python tools/groove_install.py uninstall <id> --sd E:\
python tools/groove_install.py assign <id> A|B|<n> --sd E:\  |  unassign <id> --sd E:\
python tools/groove_install.py init-slots --sd E:\ [--reset-corrupt]
python tools/groove_install.py status --sd E:\  |  recover --sd E:\
```
Códigos de salida: 0 ok · 1 paquete rechazado · 2 operación rechazada o error de E/S (si hay diario pendiente, usar `recover`) · 3 uso.

Las operaciones que modifican la SD **solo** aceptan como destino `sd:/groove/engine.json`
(`groove-engine/1`). Los flags `--engine-*` existen únicamente en `plan` (solo lectura) para raíces sintéticas.
Sin `--allow-downgrade` ni `--purge-saves` en V0.

## Módulos
| Módulo | Función |
|---|---|
| `jsonstrict.py` | JSON estricto con tope de bytes: UTF-8 sin BOM, claves únicas, sin NaN/Infinity, profundidad limitada; `bool` no cuenta como entero. |
| `zipreader.py` | Lector ZIP estricto: EOCD exacto, sin comentario de archivo ni de miembro, nombres ASCII exactos, extras restringidos, «version needed» ≤ 20, descriptores solo si coinciden, cabecera local = central, sin ZIP64/multidisco/huecos/duplicados/colisiones, deflate con tope y CRC. |
| `safepath.py` | Reglas de nombres (traversal, `\`, absolutas, unidad, dispositivos DOS, punto/espacio final, controles). |
| `manifest.py` | Esquema Draft 0.2 + reglas semánticas; id y versión con `fullmatch` (sin salto de línea final), id sin dispositivo DOS. |
| `timeline.py` | Parser fijado de GE-151 + reglas C: `start` y `results exit` explícitos y únicos en GTF y GTLM; `match`, duplicados/conflictos y `results native` → error; id no v4 → aviso. |
| `validator.py` | Allowlist exacta de dos miembros (`manifest.json` + un timeline). |
| `engine.py` | Marcador `groove-engine/1` (claves exactas, ≤ 4 KiB, build completa de 40 hex, capacidades); compatibilidad: contrato 1, motor ≥ 0.6.0 y ≥ `engine_min`, capacidades `package.runtime/1`, `registry.slots/1`, `adapter.multi` + `timeline.gtf`/`timeline.gtl`. |
| `slots.py` | `groove-slots/1`: capacidad 2..256; casillas ≥ 2 con `coord` e `id` nulos; coords de 3 enteros; `generation` 0..2147483647, +1 exacto por cambio efectivo, sin desbordar; no-op = `unchanged`; sin migraciones silenciosas. |
| `safefs.py` | Rechazo de symlinks, junctions y reparse points (Windows `FILE_ATTRIBUTE_REPARSE_POINT`) en toda la ruta y árboles; lecturas acotadas con `O_NOFOLLOW` + `fstat`. |
| `lock.py` | Lock exclusivo del SO (`fcntl.flock` / `msvcrt.locking`), no bloqueante; nunca se borra un lock vivo. |
| `fsops.py` | Primitivas con fsync e inyección de fallos para las pruebas. |
| `installer.py` | Transacciones con diario `groove-install-journal/2` (entrada no fiable: esquema estricto, rutas derivadas, hashes verificados antes de mutar). Lock → `staging` → `prepared` → renombrados → `committed` → limpieza. El rollback mueve, nunca borra. |

## Garantías (probadas en host, ver `tests/package/`)
- Solo escribe en `groove/levels/<id>/`, `groove/slots.json`, `groove/.installer/` y `groove/backups/`.
- **Nunca escribe `custom-saves/`**; `uninstall` siempre conserva los `.gsv`.
- Lock tomado antes de cualquier lectura/comprobación/asignación y mantenido durante `recover`; con un diario pendiente toda operación devuelve `RECOVERY_NEEDED`.
- Diario manipulado o corrupto → `JOURNAL_TAMPERED`/`JOURNAL_CORRUPT`, no se toca nada y se conserva la evidencia (el lock queda como barrera).
- Directorios `tx-*` desconocidos en `.installer/` no se borran nunca (`status` los lista; colisión → `TX_COLLISION`).
- Mismo id y versión con bytes distintos → `VERSION_CONFLICT`; versión menor → `DOWNGRADE_REFUSED`; mismo contenido en otro ZIP → `unchanged`.

## Windows y Android
- **Windows**: `py -3 tools\groove_install.py …` o la GUI (`tools/groove_gui/README.md`). Detección de junctions y lock `msvcrt` implementados pero **no probados en Windows real**. Workflow manual en `.github/workflows/package-installer.yml` (no ejecutado; requiere autorización).
- **Android**: stdlib pura; con Chaquopy o Termux sobre una ruta real (`/storage/XXXX-XXXX`). **Sin adaptador SAF y sin afirmaciones sobre SAF.** No probado en Android.
- FAT32/exFAT: las pruebas de fallos en Linux no demuestran durabilidad en FAT/exFAT; el diario cubre el estado lógico, no la corrupción del FS.
