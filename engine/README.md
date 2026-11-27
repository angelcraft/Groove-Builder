# Motor Groove (`subsdk4`) v0.5.0

Código C++ original del módulo Atmosphere `subsdk4` (nombre de módulo
`GrooveHT3`, title `0x0100D9F01D474000`, build `03FF4A3B`).

## Fuentes

- `src/main.cpp` — arranque, montaje de `sd:/groove`, ganchos, cielo de HT3,
  títulos de mapa/prólogo, carga de Multi (`.gtf` / `.gtl`).
- `src/timeline.cpp` / `timeline.hpp` — intérprete de timelines `.gtl` (HT3).
- `src/multi.cpp` / `multi.hpp` — motor Multi de 24 slots (anfitrión Remix 21).
- `src/gtf.cpp` / `gtf.hpp` / `gtf_cues.hpp` — parser nativo de Groove Tickflow.
- `src/cuefns.hpp`, `numparse.hpp`, `sigs.hpp` — tablas propias y firmas de
  seguridad de los puntos de gancho (primeras instrucciones esperadas).
- `config/` — CMake del módulo (`MODULE_BINARY subsdk4`).
- `syms/sdk.sym` — lista corta de importaciones `nn::fs` que pide el módulo;
  no es un volcado del juego.

## Cómo se construye

Este árbol no incluye el toolchain. En una copia de trabajo aparte:

1. Coloca el loader público Hakkun (el pin está en
   [`../tools/loader_pin.json`](../tools/loader_pin.json)) de modo que
   `engine/sys` apunte a su `sys/` y, si hace falta, `engine/lib` a las
   cabeceras públicas que uses.
2. Configura y compila con el CMake del módulo:

   ```sh
   cmake -S engine -B engine/build
   cmake --build engine/build
   ```

   `CMakeLists.txt` aplica `-Wl,--lto-O0` para evitar el fallo de LTO de
   LLVM 19 (el mismo arreglo que en el constructor público).
3. El artefacto se llama `subsdk4`. **No lo subas a este repositorio**
   (está en `.gitignore`, igual que `*.nso`, `*.ips` y `romfs/`).

No uses un `main` del juego como entrada de este árbol.

## Pruebas que sí caben aquí

```sh
python3 tools/gtf.py test
```

Las 108 pruebas de integración en Unicorn de v0.5.0 no están en el repo:
necesitan una imagen del juego y no deben publicarse.
