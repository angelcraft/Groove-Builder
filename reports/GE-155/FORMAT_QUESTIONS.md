# GE-155 — formatos pendientes para GE-154 (NO congelados)

Todo lo de abajo está implementado como **BORRADOR** en `grok/groove-package-validator` para poder probarlo,
pero no se considera contrato hasta que GE-154 lo confirme. Si GE-154 decide otra cosa, se cambia aquí
(y en las pruebas) sin tocar ramas ajenas.

## A. `sd:/groove/slots.json` — propuesta `groove-slots/1`
```json
{"format": "groove-slots/1", "capacity": 2, "generation": 0,
 "slots": [{"index": 0, "coord": [0, 9, 0], "id": null},
           {"index": 1, "coord": [0, 9, 1], "id": null}]}
```
1. ¿Objeto versionado (esta propuesta) en lugar de la lista de 2 ids del modelo del harness GE-152 (`registry_model.py`)? El instalador **rechaza** la lista (`SLOTS_LEGACY`) en vez de migrarla en silencio.
2. `capacity` 1..256, `len(slots) == capacity`, crece solo por migración explícita (`grow`), nunca encoge. Las casillas ≥ 2 llevan `coord: null` y **no son asignables** hasta que GE-152/v0.7.0 verifique celdas del menú. ¿De acuerdo?
3. `generation` +1 por cada cambio confirmado (para que el runtime detecte cambios). ¿Lo necesita el runtime o sobra?
4. Escritor único: el instalador. El runtime solo lee y falla en cerrado (casilla vacía/bloqueada). ¿Confirmado?
5. Tamaño máximo 64 KiB (256 casillas ≈ 36 KiB con ids de 96 B). ¿Límite nativo distinto?

## B. `sd:/groove/engine.json` — marcador del motor instalado (nuevo, propuesta)
```json
{"format": "groove-engine/1", "engine_version": "0.6.0", "engine_contract": 1, "build_id": "03FF4A3B"}
```
6. El instalador necesita saber qué motor hay en la SD. Sin marcador ni flags `--engine-*` **rechaza** (`ENGINE_UNKNOWN`). ¿Quién lo escribe (paquete de release de subsdk4/GE-151)? ¿Otra fuente preferida?
7. Motor < 0.6.0 → `ENGINE_NO_PACKAGE_LOADER` (v0.5.x no lee `levels/`). Build distinta de `03FF4A3B` → rechazo. ¿Correcto?

## C. Reglas del perfil runtime que el Draft 0.2 deja en prosa
8. `start` y `results` explícitos se tratan como **error** (no aviso) en el timeline; `match` explícito y `results native` → error. ¿Error o aviso?
9. Título del timeline distinto del manifiesto → solo aviso (el menú usa el manifiesto). ¿Bien?
10. id sin UUID (o UUID no v4) → **aviso**, no error, porque el instalador no puede saber cómo se generó. ¿Debe ser error en runtime?
11. Conflicto «mismo id + versión con bytes distintos»: se comparan los **bytes de los miembros extraídos**, no el SHA-256 del ZIP (dos exportadores pueden producir ZIPs distintos con el mismo contenido). ¿Confirmado?
12. Bajar de versión solo con `--allow-downgrade` explícito. ¿O prohibido siempre?

## D. Detalles ZIP (más estrictos que el editor)
13. Se rechazan: comentario de archivo, cualquier byte antes/entre/después de las entradas, ZIP64, extras distintos de 0x5455/0x7875/0x000A/0x5855, nombres no ASCII sin el flag UTF-8, «version needed» > 2.0, atributo de directorio. Se aceptan descriptores de datos (bit 3) si coinciden con la cabecera central. ¿Encaja con el exportador de GE-153 (fflate/JSZip)?
14. Extensiones prohibidas defensivas (`.cwv .bwav .spr .tex .msbt .rhref .ips .nso .zip .groove …`, rutas `romfs/ exefs/ audio/ sprites/`), aunque el perfil runtime ya exige exactamente 2 miembros.

## E. Guardados y rutas reservadas
15. El instalador **nunca escribe** `custom-saves/`. Desinstalar conserva `<id>.gsv` y `<id>.gsv.bak`; `--purge-saves` hace copia en `groove/backups/saves/<id>.<tx>.gsv*` y borra después del commit. El formato `.gsv` (160 B) sigue siendo propuesta de GE-152/GE-151; aquí no se lee ni se valida su contenido. ¿Confirmado?
16. Rutas reservadas para el instalador: `groove/.installer/` (lock, diario, staging) y `groove/backups/`. El runtime debe ignorarlas. ¿OK?

## F. Contrato y coordinación
17. `vendor/gtf.py` y `vendor/engine_contract.json` están copiados tal cual de `codex/engine-v0.5.1-hardening` @ `9b56aab` (SHA-256 en `vendor/PIN.json`). Cuando #6 se integre, ¿se importa desde `tools/` en lugar de la copia?
18. TASKS.md asigna GE-155 a «Cursor (optional)» en `cursor/groove-package-validator` con `tools/groove_package.py`. Por petición del usuario lo hace Grok en `grok/groove-package-validator`; el módulo es `tools/groove_package/` y el punto de entrada `tools/groove_install.py` (un `groove_package.py` chocaría con el paquete). ¿Actualizáis el registro?
