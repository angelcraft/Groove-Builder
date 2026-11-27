# Groove Engine v0.5.0: el motor lee Groove Tickflow (`.gtf`) en nativo

Juego: Rhythm Heaven Groove (Switch), title 0100D9F01D474000, build 03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8.
El paquete **no trae nada del juego** (ni main, ni romfs, ni audio, ni `.spr`/`.tex`/`.msbt`). Solo hay código propio y datos de tiempo.

## Qué hay de nuevo (v0.5.0)

El motor carga **Groove Tickflow (`.gtf`)** directamente. Ya no hace falta pasar por un `.gtl`. El `.gtl` (GTLM 1) sigue funcionando igual que en v0.4.0 (100 % compatible).

### Dónde va el archivo (Multi)

El motor busca el primero que exista, en este orden (el mismo para el escenario, el título del mapa y el prólogo/jingle):

1. `sd:/groove/multi.gtf`
2. `sd:/groove/stages/multi/multi.gtf`
3. `sd:/groove/multi.gtl`
4. `sd:/groove/stages/multi/multi.gtl`

Si tienes un `multi.gtl` de v0.4.0 y no pones ningún `.gtf`, no cambia nada. Si pones un `.gtf` en una de las dos primeras rutas, ese gana.

Hay un ejemplo en `groove/stages/multi/ejemplo.gtf`. La descripción del lenguaje está en `groove/tools/TICKFLOW.md` (y `groove/tools/gtf.py` sirve en el PC para decompilar un `.gtl` o para comprobar la sintaxis).

### Cómo se comportan los `switch` (como el juego oficial)

- `translen` por defecto es **2 pulsos (960 ticks)**, la misma duración que usa el juego en los remixes oficiales (`setTransLen`).
- `rest` y `at` avanzan el reloj; `switch` y los cues **no**. Un cambio de juego y su primer cue pueden ir seguidos **en el mismo tick** (así lo hacen los remixes oficiales).
- `switch JUEGO` (sin más) es la transición con estilo (`switchK0`, sub 2). `switch JUEGO cut` (alias `hard`) es un corte seco (`switchCut`).
- El hilo de los cues es independiente del hilo del switch. Una cue larga (por ejemplo un `countDance` de Dancers) **sigue sonando** si cambias de juego a mitad, como en un cruce oficial tipo Dancers → Hop and Roll. El `.gtf` no cambia ese runtime: emite los mismos eventos que un `.gtl`.
- `first JUEGO` elige el escenario inicial (un corte en el tick 0 del worker, como el juego). No escribe un `switch` en el pulso 0.

`title`, `prologue` y `jingle` en el `.gtf` alimentan el mapa y la intro igual que en el `.gtl`. Los títulos entre comillas (`title "Mi Remix"`) se leen bien, incluidos `#` dentro de las comillas.

En `sd:/groove/save/*.json` debe poner `"module": "0.5.0"`. En el log: `stage multi: file ht3sd:/groove/…` con la ruta que se eligió.

## Lo que ya venía de v0.4.0

### Título en el menú del mapa (GRO-11)
- Al poner el cursor sobre HT3 (Mundo 1, columna 9, fila 0), el panel del mapa dice **Pasar por el anillo 3**. HT2 nativo (columna 1) sigue diciendo «2».
- Double Hell (fila 1) y Multi (fila 4) también usan su línea `title` en el mapa.
- Si la casilla está bloqueada, se deja el texto nativo. Después de jugar HT3, la intro de Double Hell ya no «hereda» el título.

### Remix 21 (GRO-12)
- Si el Multi no tiene línea `title`, se llama **Remix 21** en el mapa, en la intro y en el escenario. El Remix 8 de verdad sigue diciendo «Remix 8».
- `prologue type_19` y `jingle 0x163` afectan **solo a Multi**. Al salir, el Remix 8 y los demás vuelven a lo nativo.

### Cielo de HT3 (GRO-7)
- En HT3 el cielo del atlas [57] se tiñe de carmesí. En HT2 nativo, Double Hell y HT1 sigue azul.

## Instalación (haz copia de seguridad antes)
1. Haz copia de tu partida con JKSV.
2. Guarda tu `atmosphere/contents/0100D9F01D474000/exefs/subsdk4` actual.
3. Copia `atmosphere/contents/0100D9F01D474000/exefs/subsdk4` a la SD (sobrescribe). Ese es el único archivo imprescindible.
   - La IPS (`atmosphere/exefs_patches/GrooveHT3/…ips`) es la misma que en v0.3.9 / v0.4.0.
   - `groove/`: puedes copiarla entera, pero **si tienes un `multi.gtl` propio, guárdalo antes**.
4. Si siguen ahí, borra `romfs/graph/scene/ring/type_01/bg.spr` y `bg.tex` (son leftovers antiguos).
5. No toques subsdk1 (Orochi) ni subsdk5 (HoopDX).

## Prueba
1. **Mapa / intro / cielo:** igual que en v0.4.0 (HT3 «…3» y cielo rojo; Double Hell y HT2 no heredan el título; Multi «Remix 21»).
2. **Tickflow:** copia `groove/stages/multi/ejemplo.gtf` a `sd:/groove/multi.gtf` (o a `stages/multi/multi.gtf`). El mapa y la intro deben usar su `title` / `prologue` / `jingle`. En el log verás `stage multi: file …/multi.gtf`.
3. **Compatibilidad:** sin ningún `.gtf`, tu `stages/multi/multi.gtl` de v0.4.0 se sigue cargando.
4. En `sd:/groove/save/*.json` debe poner `"module": "0.5.0"`. Mándame el `ht3.log` si algo no cuadra.

## Si algo falla
- **Se cuelga o se queda en negro:** crea el archivo vacío `sd:/groove/stages/multi/DISABLE` (o `ht3/DISABLE` / `doublehell/DISABLE`).
- **El cielo sigue azul:** mira si el log dice `mulColor=1` y `tinted=9`. Si sale `mulColor @0x4F3480 already hooked by another module`, otro mod ya usa esa función. Envía el `ht3.log`.
- **El `.gtf` no carga:** mira el log (`parse` / `file`). Un `jingle` fuera de 0x158..0x16C es un error en `.gtf` (en `.gtl` se ignoraba).
- **Volver atrás:** restaura tu subsdk4.
