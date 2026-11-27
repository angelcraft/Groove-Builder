# Groove Engine (Groove-Builder)

Repositorio **solo de código y documentación originales** del motor Groove
para *Rhythm Heaven Groove* en Nintendo Switch (title `0100D9F01D474000`,
build `03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8`).

**Estado actual: v0.5.0** (noviembre 2026). El runtime es un `subsdk4` propio
de Atmosphere, más un parche IPS y los datos del usuario en `sd:/groove/`.
No hace falta ningún archivo del juego en este árbol, y no debe añadirse
ninguno (`main`, romfs, audio, `.spr`, `.tex`, `.msbt`, `.cwv`, `.rhref`, etc.).

El nombre del juego se usa solo de forma descriptiva. Este proyecto no está
afiliado a Nintendo ni al editor del juego.

Resumen completo en español: [`docs/GROOVE_ENGINE_RESUMEN.md`](docs/GROOVE_ENGINE_RESUMEN.md).

## Qué hay ya en marcha

Confirmado en hardware Switch:

- **Hoop Trundling 3** (mundo 1, columna 9, fila 0), con título de intro
  «Pasar por el anillo 3».
- **HT Double Hell** (mundo 1, columna 9, fila 1).
- **Motor Multi** de 24 minijuegos en el anfitrión Remix 21
  (mundo 1, columna 9, fila 4).

Listo para probar en Switch (v0.4.0 + v0.5.0 + puente RHRE v0.4.1):

- Cielo rojo de HT3 (GRO-7).
- Título de HT3 / Double Hell / Multi en el panel del mapa, sin fugas
  al salir (GRO-11).
- Presentación de Remix 21 en mapa y prólogo, sin tocar el Remix 8 real,
  más `prologue type_XX` y `jingle 0x158..0x16C` (GRO-12).
- **Groove Tickflow (`.gtf`) nativo** (GRO-14): el motor lee el lenguaje
  directamente. `tools/gtf.py` sigue sirviendo en el PC.
- Puente **RHREfresh v0.4.1** (GRO-6) y arranque de audio en `start 0` (GRO-8).

## Árbol

| Ruta | Contenido |
| --- | --- |
| `engine/` | Código C++ del `subsdk4` v0.5.0 (`main`, timelines, Multi, parser `.gtf`). |
| `tools/gtf.py` | Compilador / descompilador / lista de cues / pruebas de Groove Tickflow. |
| `tools/groove_rhre.py` | Puente RHREfresh ↔ `.gtl` v0.4.1 (`rhre2gtlm`, `rhre2gtl`, `gtl2rhre`, `check`). |
| `docs/` | Tickflow, notas de v0.4.0 y v0.5.0, puente RHRE, tabla de cues, resumen. |
| `examples/multi/` | Ejemplos originales `.gtf` (ninguna carta oficial). |
| `source/`, `templates/`, `tests/` | Investigación previa del constructor de texto Hoop3 (host / CI). |

## Groove Tickflow

```sh
python3 tools/gtf.py compile  examples/multi/ejemplo.gtf -o multi.gtl
python3 tools/gtf.py decompile multi.gtl -o mi_remix.gtf
python3 tools/gtf.py cues
python3 tools/gtf.py test
```

En la Switch, el motor busca el remix Multi en este orden (el primero que
exista gana; el mismo orden vale para el título del mapa y el prólogo):

1. `sd:/groove/multi.gtf`
2. `sd:/groove/stages/multi/multi.gtf`
3. `sd:/groove/multi.gtl`
4. `sd:/groove/stages/multi/multi.gtl`

Lenguaje y reglas de `switch` (2 pulsos por defecto, `hard`/`cut`, cues
continuos sin corte): [`docs/TICKFLOW.md`](docs/TICKFLOW.md).

## Instalación (haz copia de seguridad antes)

1. Haz copia de tu partida con **JKSV**. El Multi usa los resultados nativos
   del Remix 21: si dejas `results native`, tu medalla o puntuación de esa
   casilla puede cambiar. Multi reutiliza además la identidad de texto del
   **Remix 8 real** (índice de catálogo 1,67); el motor las distingue por la
   casilla del mapa, pero el registro de resultados es el del anfitrión.
   Para no escribir en ese registro, crea el archivo vacío
   `sd:/groove/stages/multi/NO_NATIVE_RESULTS`.
2. Copia tu `subsdk4` compilado a
   `atmosphere/contents/0100D9F01D474000/exefs/subsdk4`.
   Este repositorio **no** incluye el binario ni el parche IPS.
3. No toques `subsdk1` (Orochi) ni `subsdk5` (HoopDX).
4. Si algo falla, un archivo vacío `sd:/groove/stages/<slot>/DISABLE`
   (ht3, doublehell o multi) desactiva ese escenario.

Guías: [`docs/ENGINE_v0.5.0.md`](docs/ENGINE_v0.5.0.md),
[`docs/ENGINE_v0.4.0.md`](docs/ENGINE_v0.4.0.md).

## Compilar el motor

Hace falta el toolchain público Hakkun / groove-loader (no está en este
árbol; ver `tools/loader_pin.json` y `engine/README.md`). No copies un
`main` del juego aquí. El `.gitignore` rechaza NSO, IPS, romfs, audio y
extensiones del juego.

## Investigación Hoop3 anterior

`source/`, `templates/` y el workflow de Actions siguen siendo el
constructor de texto Hoop3 de investigación (pruebas en host y prueba de
compilación). Esa línea **no** es el runtime que ya corre en Switch; el
runtime actual está en `engine/`.

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_text_patch_plan.cpp -o /tmp/hoop3-plan
/tmp/hoop3-plan
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_title_dispatch.cpp source/hoop3_title_bridge.cpp \
  -o /tmp/hoop3-dispatch
/tmp/hoop3-dispatch
```

## Procedencia

Código y documentación originales. No pertenecen a este repositorio:
SPR, MSBT, ROM/NSO, claves, archivos del SDK, partidas, packs privados
ni material comercial del juego.
