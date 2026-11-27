# Groove Engine v0.4.0: título del mapa «Pasar por el anillo 3», «Remix 21» y cielo HT3 teñido de rojo

Juego: Rhythm Heaven Groove (Switch), title 0100D9F01D474000, build 03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8.
El paquete **no trae nada del juego** (ni main, ni romfs, ni audio, ni `.spr`/`.tex`/`.msbt`). Solo hay código propio y datos de tiempo.

## Qué hay de nuevo (v0.4.0)

### Título en el menú del mapa (GRO-11)
- Al poner el cursor sobre HT3 (Mundo 1, columna 9, fila 0), el panel del mapa dice **Pasar por el anillo 3**. HT2 nativo (columna 1) sigue diciendo «2».
- Double Hell (fila 1) y Multi (fila 4) también usan su línea `title` en el mapa.
- Motivo: HT3, Double Hell y HT2 comparten el mismo nombre del juego (1,41), y Multi comparte el del Remix 8 (1,67). Por eso ahora el motor decide **por la casilla del mapa**, en el refresco del panel (`0x1D0130`). Si la casilla está bloqueada, se deja el texto nativo.
- **Arreglado el «leak»** que se veía en tu log: después de jugar HT3, la intro de Double Hell salía con «Pasar por el anillo 3». Ahora la intro decide por la casilla actual y, si el texto guardado era nuestro, devuelve el nativo.

### Remix 21 (GRO-12)
- Si `multi.gtl` no tiene línea `title`, Multi se llama **Remix 21** en el mapa, en la intro y en el escenario. El Remix 8 de verdad sigue diciendo «Remix 8».
- Hay dos líneas nuevas y opcionales en `multi.gtl`. Afectan **solo a Multi**:
  - `prologue type_19`: el arte del prólogo (se busca en `graph/prologue/remix/type_XX/prologue`). También vale una ruta completa. Solo se acepta si es un prólogo del juego o si en la SD existen `romfs/<ruta>.spr` y `.tex`. Si no, se queda el nativo (type_07) y lo dice el log.
  - `jingle 0x163`: el jingle del prólogo (de 0x158 a 0x16C). Si está fuera de ese rango, se ignora.
  - Al salir de Multi, el Remix 8 y los demás vuelven a su prólogo y jingle nativos.
- En el `multi.gtl` del paquete van como comentarios: quita el `#` para probarlas.

### Cielo de HT3 (GRO-7), ahora sí sobre el cielo real
- El cielo **no es de paleta**: es una imagen ya pintada dentro de `type_00/main.tex` (recorte [57] del atlas). Por eso los parches de paleta de v0.3.7–v0.3.9 nunca podían ponerlo rojo, y esos hooks se han quitado.
- **v0.4.0** marca con un índice de color propio solo las 9 instancias (keyframes) del sprite del cielo [57]. Esas instancias, y solo en HT3, se multiplican por un tinte carmesí (1.0, 0.16, 0.16). Los actores, los aros, las estrellas y el recorte [54] no se tocan.
- En HT2 nativo, Double Hell y HT1, ese índice devuelve blanco, que es exactamente lo nativo, así que el cielo sigue azul.

En `sd:/groove/log/ht3.log` deberías ver:
- `sky hook: layoutBake=1 mulColor=1 (atlas[57] multiply, HT3 only)`
- `map title hook: mapInfo=1` y, al mover el cursor, `map title: (1,9,0) lock=.. -> 'Pasar por el anillo 3'`
- Al entrar en HT3: `ht3 sky: before layout bake: type_00/main atlas[57] keyframes tinted=9 ...` y al salir `ht3 sky: stage done: tinted keyframes=9 crimson lookups=N` (N > 0 = se pintó)
- En Multi: `multi prologue: path '...'` y `multi prologue: jingle 0x... (was 0x161)`

## Instalación (haz copia de seguridad antes)
1. Haz copia de tu partida con JKSV.
2. Guarda tu `atmosphere/contents/0100D9F01D474000/exefs/subsdk4` actual.
3. Copia `atmosphere/contents/0100D9F01D474000/exefs/subsdk4` a la SD (sobrescribe). Ese es el único archivo imprescindible.
   - La IPS (`atmosphere/exefs_patches/GrooveHT3/…ips`) es la misma que en v0.3.9.
   - `groove/`: puedes copiarla entera, pero **si tienes un `multi.gtl` propio, guárdalo antes** (el del paquete solo añade las líneas comentadas de arriba).
4. Si siguen ahí, borra `romfs/graph/scene/ring/type_01/bg.spr` y `bg.tex` (son leftovers antiguos).
5. No toques subsdk1 (Orochi) ni subsdk5 (HoopDX).

## Prueba
1. **Mapa:** pon el cursor en Mundo 1, columna 9: la fila 0 debe decir «Pasar por el anillo 3», la fila 4 «Remix 21» (o tu `title`), la columna 1 (HT2 nativo) «…2» y el Remix 8 «Remix 8».
2. **Intro:** entra en HT3 → «…3». Luego entra en Double Hell → **no** debe salir «…3». Luego entra en HT2 nativo → «…2».
3. **Cielo:** en HT3 debe verse teñido de rojo. En HT2 nativo y Double Hell debe seguir azul.
4. **Remix 21:** en Multi, la intro dice «Remix 21». Para probar otro prólogo, quita el `#` de `prologue type_19` / `jingle 0x163` en `multi.gtl`. Después entra en el Remix 8 real: debe seguir con su prólogo nativo.
5. En `sd:/groove/save/*.json` debe poner `"module": "0.4.0"`. Mándame el `ht3.log` (y una foto o vídeo del cielo y del mapa si puedes).

## Si algo falla
- **Se cuelga o se queda en negro:** crea el archivo vacío `sd:/groove/stages/multi/DISABLE` (o `ht3/DISABLE` / `doublehell/DISABLE`).
- **El cielo sigue azul:** mira si el log dice `mulColor=1` y `tinted=9`. Si sale `mulColor @0x4F3480 already hooked by another module`, otro mod ya usa esa función. Envía el `ht3.log`.
- **Volver atrás:** restaura tu subsdk4.
