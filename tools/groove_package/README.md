# groove_package — validador e instalador de paquetes `.groove` (GE-155, BORRADOR)

Núcleo **Python 3.9+ solo con la biblioteca estándar**, para que el mismo código funcione
en Windows (CLI) y dentro de una app Android (p. ej. Chaquopy) sin dependencias nativas.
Implementa el perfil **runtime** del Draft 0.2 de GE-154 (`docs/GROOVE_PROFILE_DRAFT_02.md`
en `coordination/v0.6.0` @ `7a5fe22`). **Ningún formato está congelado.**

```
python tools/groove_install.py validate  nivel.groove [--json]
python tools/groove_install.py install   nivel.groove --sd E:\ --engine-version 0.6.0 --engine-contract 1 --build-id 03FF4A3B [--slot auto|0|1|none]
python tools/groove_install.py uninstall <id> --sd E:\ [--purge-saves]
python tools/groove_install.py assign <id> <slot> --sd E:\  |  unassign <id> --sd E:\
python tools/groove_install.py init-slots --sd E:\ [--reset-corrupt]
python tools/groove_install.py status --sd E:\  |  recover --sd E:\
```
Códigos de salida: 0 ok · 1 paquete rechazado · 2 operación rechazada o fallida (SD sin cambios) · 3 uso.

## Módulos
| Módulo | Función |
|---|---|
| `zipreader.py` | Lector ZIP estricto propio: EOCD exacto, sin ZIP64/multidisco/comentario/datos antepuestos o huecos; cada cabecera local se compara con la central; sin duplicados ni colisiones de mayúsculas/NFC; sin symlinks, directorios, cifrado, métodos ≠ stored/deflate, flags o extras desconocidos; deflate en streaming con tope de salida, CRC y longitud real. |
| `safepath.py` | Reglas de nombres (traversal, `\`, absolutas, unidad, dispositivos DOS, punto/espacio final, controles). |
| `manifest.py` | JSON estricto (UTF-8 sin BOM, claves únicas, sin NaN, profundidad ≤ 16, sin surrogates sueltos) + esquema Draft 0.2 + reglas semánticas (título 1–95 B, id sin dispositivo DOS, aviso si el id no lleva UUID v4). |
| `timeline.py` | Parser endurecido de GE-151 (`vendor/gtf.py`, fijado) + reglas runtime: `start` y `results` explícitos, sin `match`, sin `results native`, GTLM 1 (GTL1/Hoop rechazado). |
| `validator.py` | Orquesta todo; exactamente `manifest.json` + un timeline; rechaza tipos propietarios/ejecutables/anidados. |
| `engine.py` | Destino: CLI o `sd:/groove/engine.json` (borrador); exige build `03FF4A3B`, contrato 1, motor ≥ 0.6.0 y ≥ `engine_min`. |
| `slots.py` | `slots.json` (borrador `groove-slots/1`): 2 casillas A=(0,9,0), B=(0,9,1); capacidad ampliable a 256 por migración explícita; las casillas ≥ 2 no son asignables hasta que haya celdas verificadas. |
| `fsops.py` | Primitivas con fsync e inyección de fallos (corte de energía / error de E/S) para las pruebas. |
| `installer.py` | Transacciones con diario: preparar → diario `prepared` → renombrados atómicos → `committed` → limpieza. `recover` deshace o completa de forma idempotente. |

## Garantías (probadas en host, ver `tests/package/`)
- Solo escribe en `groove/levels/<id>/`, `groove/slots.json`, `groove/.installer/` y `groove/backups/`.
- **Nunca escribe `custom-saves/`.** `uninstall` conserva los `.gsv`; `--purge-saves` copia antes a `groove/backups/saves/<id>.<tx>.gsv*` y borra solo tras el commit.
- No toca `groove/multi.gtf`, `stages/`, `atmosphere/`, JKSV ni otros archivos.
- Mismo id y versión con bytes distintos → `VERSION_CONFLICT`; versión menor → `DOWNGRADE_REFUSED` (salvo `--allow-downgrade`).
- Carpeta de nivel con archivos ajenos, symlinks o `slots.json` corrupto/legado → se rechaza sin modificar nada.

## Windows y Android
- **Windows**: `py -3 tools\groove_install.py …` con la SD montada (p. ej. `E:\`). Sin fsync de directorios (no existe en Windows); se usa `os.replace`. Empaquetado `.exe` (PyInstaller) pendiente. Workflow manual preparado en `.github/workflows/package-installer.yml` (no ejecutado).
- **Android**: el núcleo es stdlib pura y se puede incrustar con Chaquopy en una app Kotlin, o usar en Termux/Pydroid con una ruta real (`/storage/XXXX-XXXX`) y permiso «Acceso a todos los archivos». **No implementado:** un adaptador SAF (`DocumentsContract`) para tarjetas accesibles solo por SAF: `SD` lee con `os.*` y `FS` escribe con `os.*`; habría que abstraer también las lecturas y aceptar que `renameDocument/moveDocument` no garantizan atomicidad en todos los proveedores. MTP (DBI) no se soporta.
- FAT32/exFAT: un rename no es atómico ante un corte de energía a nivel de sistema de archivos; el diario y `recover` cubren el estado lógico, no la corrupción del FS (usar fsck/chkdsk).
