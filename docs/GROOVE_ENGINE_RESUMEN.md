# Groove Engine — resumen de lo que llevamos

Documento de seguimiento (27 de noviembre de 2026, Europe/Amsterdam).
Repositorio público, solo código y documentación originales:
[angelcraft/Groove-Builder](https://github.com/angelcraft/Groove-Builder).

> Commit de esta entrega: se indica en la [sección 6](#6-commit-subido-a-github)
> cuando el push ha terminado.

## 1. Resumen general del proyecto

Groove Engine es un motor propio para *Rhythm Heaven Groove* en Nintendo Switch.

| Dato | Valor |
| --- | --- |
| Repositorio | [github.com/angelcraft/Groove-Builder](https://github.com/angelcraft/Groove-Builder) |
| Juego | Rhythm Heaven Groove (Switch) |
| Title ID | `0100D9F01D474000` |
| Build ID | `03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8` (abreviado `03FF4A3B`) |
| Versión actual del motor | **v0.5.0** |
| Runtime | Módulo Atmosphere original `subsdk4` (nombre de módulo `GrooveHT3`) |
| Parche | IPS en `atmosphere/exefs_patches/GrooveHT3/` (no se publica el binario en el repo) |
| Datos del usuario | `sd:/groove/` (timelines, logs, guardados del módulo) |

Arquitectura, en corto:

- El juego original no se modifica en el árbol público. El motor vive en un
  **`subsdk4`** propio, cargado por Atmosphere, más un parche IPS puntual.
- Los remixes y opciones van en la **SD**: `sd:/groove/…`.
- El formato binario de timeline es **`.gtl`** (GTLM 1 para Multi). Desde
  v0.5.0 el motor también lee **Groove Tickflow (`.gtf`)** en nativo.
- En el PC, `tools/gtf.py` compila y descompila `.gtf` ↔ `.gtl`, y
  `tools/groove_rhre.py` v0.4.1 convierte remixes de RHREfresh.
- Este repositorio **no incluye** archivos del juego (`main`, romfs, audio,
  `.spr`, `.tex`, `.msbt`, `.cwv`, `.bwav`, `.bfsar`, `.rhref`, canciones,
  `subsdk4` compilado ni IPS).

El trabajo anterior de investigación (constructor de texto Hoop3, pruebas
en host) sigue en `source/`, `templates/` y el workflow de Actions. El
runtime que ya corre en Switch está en `engine/`.

## 2. Hitos ya confirmados en hardware Switch

Estas tres casillas se han jugado en consola real:

### Hoop Trundling 3

- Casilla: **mundo 1, columna 9, fila 0**.
- Título de intro: **«Pasar por el anillo 3»** (si el `.gtl` no trae `title`,
  el motor cambia el «2» final por un «3», válido en español e inglés:
  «Hoop Trundling 3»).
- Hoop Trundling 2 nativo (columna 1) sigue diciendo «…2».

### HT Double Hell

- Casilla: **mundo 1, columna 9, fila 1**.
- Se lanza y se juega como escenario propio del motor, independiente de HT3.

### Motor Multi (24 minijuegos)

- Casilla: **mundo 1, columna 9, fila 4**.
- Anfitrión nativo: **Remix 21** (`REMIX_21`, `bgm 139`).
- 24 slots de minijuego. Los remixes se escriben en `.gtl` o, desde v0.5.0,
  en `.gtf`.

## 3. Novedades listas para probar en Switch

Estas piezas están en el código de **v0.4.0 + v0.5.0** y en el puente
**RHRE v0.4.1**. En Unicorn, v0.4.0 pasó 85/85 pruebas y v0.5.0 pasó
**108/108** (las 85 anteriores más 23 de `.gtf`, incluido `multi_prueba.gtf`
clavo a clavo con su `.gtl`). Falta el visto bueno en hardware de esta
tanda (cielo, títulos de mapa, presentación de Remix 21 y lectura nativa
de `.gtf`).

### 3.1 Cielo rojo de HT3 (GRO-7)

- Solo en **HT3**, el cielo del atlas [57] se tiñe de carmesí
  `(1.0, 0.16, 0.16)`.
- Técnica: un centinela `0x200` en las instancias de cielo, aplicado al
  hornear el layout; el tinte se devuelve únicamente cuando el remap está
  activo en HT3.
- En HT2 nativo, Double Hell y HT1 el cielo debe seguir **azul**.
- Si otro módulo ya engancha `0x4F3480`, el log avisa
  (`mulColor @0x4F3480 already hooked…`) y el cielo se deja nativo.

### 3.2 Título de HT3 en el panel del mapa y Dual Hell (GRO-11)

- Al poner el cursor sobre HT3, el panel del mapa dice
  **«Pasar por el anillo 3»**.
- Double Hell (fila 1) y Multi (fila 4) también usan su línea `title` en
  el mapa.
- **Arreglo de fuga:** después de jugar HT3, la intro de Double Hell ya no
  hereda el título «…3».
- HT3, Double Hell y HT2 comparten el nombre de catálogo `(1, 41)`
  (`I_RING_01`). El motor decide **por la casilla del mapa** en el refresco
  del panel (`0x1D0130`). Si la casilla está bloqueada, se deja el texto
  nativo.

### 3.3 Presentación de Remix 21 (GRO-12)

- Si Multi no tiene línea `title`, se llama **«Remix 21»** en el mapa, en
  la intro y en el escenario.
- El **Remix 8 real** sigue diciendo «Remix 8». Multi comparte con él el
  índice de catálogo `(1, 67)`; otra vez, el motor las distingue por la
  casilla.
- Directivas (solo afectan a Multi; al salir, Remix 8 y el resto vuelven
  a lo nativo):
  - `prologue type_XX` (o una ruta), con `type_00` … `type_19`.
  - `jingle 0x158` … `0x16C`.
- En `.gtf` un `jingle` fuera de rango es un error; en `.gtl` se ignoraba.

### 3.4 Groove Tickflow nativo, v0.5.0 (GRO-14)

El motor lee **`.gtf`** directamente. El `.gtl` (GTLM 1) de v0.4.0 sigue
siendo 100 % compatible.

**Orden de carga** (el primero que exista gana; el mismo para el escenario,
el título del mapa y el prólogo/jingle):

1. `sd:/groove/multi.gtf`
2. `sd:/groove/stages/multi/multi.gtf`
3. `sd:/groove/multi.gtl`
4. `sd:/groove/stages/multi/multi.gtl`

**Sintaxis (1 pulso = 480 ticks):**

```text
title "Remix 21"
prologue type_19
jingle 0x163
bgm 139
start 0
translen 2
match -1 9 4
results native
first CARS
end 80
finish 84

rest 15
switch KAERU
frog5 basic
rest 5
switch PUTILABO cut
softGrow basic
```

- `rest` y `at` avanzan el reloj; `switch` y los cues **no**. Un cambio de
  juego y su primer cue pueden ir en el **mismo pulso**.
- Tiempos: enteros, decimales (`0.5`), fracciones (`1/3`) o ticks (`240t`).
- `switch JUEGO` es la transición con estilo (`switchK0`, sub 2), de
  **2 pulsos** por defecto (`translen 2`, 960 ticks, como `setTransLen` en
  los remixes oficiales).
- `switch JUEGO hard` (alias `cut`) es un corte seco (`switchCut`).
- Los hilos de cues son independientes del hilo del `switch`. Una cue
  larga (por ejemplo un `countDance` de Dancers) **sigue sonando** si
  cambias de juego a mitad, como en un cruce oficial tipo Dancers →
  Hop and Roll.
- `loop N … end`, `def NOMBRE … end` y `call NOMBRE` evitan repetir bloques.
- Los nombres cortos coinciden con los patrones de RHREfresh (`frog5`,
  `softGrow`, `brake`, …). `switch ribbitRocket` es lo mismo que
  `switch KAERU`.

**Herramienta de PC** (`tools/gtf.py`, Python 3, solo biblioteca estándar):

```sh
python3 tools/gtf.py compile    mi_remix.gtf -o multi.gtl
python3 tools/gtf.py decompile  multi.gtl    -o mi_remix.gtf
python3 tools/gtf.py cues
python3 tools/gtf.py test
```

Las pruebas internas del compilador pasan en este árbol. Las 108/108 de
Unicorn (imagen del juego) no se publican.

Guía: [`TICKFLOW.md`](TICKFLOW.md). Ejemplos originales:
[`examples/multi/ejemplo.gtf`](../examples/multi/ejemplo.gtf) y
[`examples/multi/multi_prueba.gtf`](../examples/multi/multi_prueba.gtf).

### 3.5 Puente RHREfresh v0.4.1 (GRO-6) y sincronía de audio (GRO-8)

`tools/groove_rhre.py` convierte remixes `.rhref` / `.rhre3` / `remix.json`:

- `rhre2gtlm` — remix de varios juegos → `multi.gtl` (escenario Remix 21).
- `rhre2gtl` / `gtl2rhre` — ida y vuelta de cartas de aros.
- `check` — valida un `.gtl` con las mismas reglas que el motor.
- En Windows: `convertir.bat` y `convertir_multi.bat` (arrastra el `.rhref`).

Novedades de **v0.4.1**:

- Subtítulo `gtl: switch JUEGO` (y `gtl: switch JUEGO hard`) para cambios
  **sin cues**, útiles en intros tipo *I'm a Lady Now*.
- El juego entra en la lista aunque no tenga ningún cue.
- Subtítulo opcional `gtl: title Mi remix`.
- Avisos si un switch es redundante, corta un patrón o llega demasiado
  cerca de otro switch normal (menos de 2 pulsos: usa `hard`).

**GRO-8 (`start 0`):** el valor por defecto de Multi es `start 0` (pulso 0
de RHRE). El valor nativo `2880` ticks (`0x3C0` + 1 compás) retrasaba
`startGameplay` 6 pulsos con la canción ya sonando. Así la música y el
juego arrancan juntos.

Guía: [`RHRE.md`](RHRE.md) y [`cue_functions.md`](cue_functions.md).

## 4. Rutas en la SD y guía rápida

### Dónde va cada cosa

```text
sd:/atmosphere/contents/0100D9F01D474000/exefs/subsdk4
sd:/atmosphere/exefs_patches/GrooveHT3/03FF4A3B….ips

sd:/groove/multi.gtf                  # remix Multi (prioridad 1)
sd:/groove/multi.gtl                  # prioridad 3
sd:/groove/stages/multi/multi.gtf     # prioridad 2
sd:/groove/stages/multi/multi.gtl     # prioridad 4
sd:/groove/stages/multi/DISABLE
sd:/groove/stages/multi/NO_NATIVE_RESULTS
sd:/groove/stages/multi/FORCE

sd:/groove/stages/ht3/ht3.gtl
sd:/groove/stages/ht3/DISABLE

sd:/groove/stages/doublehell/doublehell.gtl
sd:/groove/stages/doublehell/DISABLE

sd:/groove/log/ht3.log
sd:/groove/save/*.json                # debe decir "module": "0.5.0"
```

### Instalación

1. **Haz copia de tu partida con JKSV** (o similar) antes de instalar o
   de jugar un Multi con resultados nativos.
2. Guarda tu `subsdk4` actual por si quieres volver atrás.
3. Copia el `subsdk4` nuevo a la ruta de Atmosphere. El IPS, si lo usas,
   es el mismo desde v0.3.9 / v0.4.0.
4. Copia tu `.gtf` o `.gtl` a una de las rutas Multi de arriba. Si ya
   tenías un `multi.gtl` propio, no lo sobrescribas sin guardarlo.
5. Si quedan restos antiguos, borra
   `romfs/graph/scene/ring/type_01/bg.spr` y `bg.tex`.
6. **No toques** `subsdk1` (Orochi) ni `subsdk5` (HoopDX).

### Aviso de guardado (Remix 21 / Remix 8)

- Con `results native`, al terminar Multi se muestran los **resultados
  nativos del Remix 21** y se escriben en **su registro**: tu medalla o
  puntuación de esa casilla puede cambiar.
- Multi reutiliza la identidad de texto del **Remix 8 real** (catálogo
  1,67). El motor las distingue por la casilla del mapa, pero conviene
  no asumir que el guardado es un slot aislado. Después de probar Multi,
  entra en el Remix 8 real y comprueba que su prólogo, título y récord
  siguen siendo los suyos.
- Para **no escribir** en el registro del Remix 21, crea el archivo vacío
  `sd:/groove/stages/multi/NO_NATIVE_RESULTS`. Al acabar se vuelve al menú
  sin resultados (`results exit` / `custom` en el `.gtf` hacen lo mismo).

### Si algo falla

- Cuelgue o pantalla negra: crea `sd:/groove/stages/multi/DISABLE`
  (o `ht3/DISABLE` / `doublehell/DISABLE`).
- Cielo de HT3 sigue azul: mira en `ht3.log` si sale `mulColor=1` y
  `tinted=9`, o el aviso de que otro módulo ya usa `0x4F3480`.
- El `.gtf` no carga: mira el log (`parse` / `file`). Un `jingle` fuera
  de `0x158..0x16C` es un error.
- Para volver atrás: restaura tu `subsdk4`.

## 5. Pendientes / próximos pasos posibles

- **Probar v0.5.0 en la Switch:** cielo rojo de HT3, títulos del mapa
  (HT3 «…3», Double Hell sin fuga, Multi «Remix 21»), prólogo/jingle
  solo en Multi, carga de `multi.gtf` y compatibilidad con un `.gtl` de
  v0.4.0 si no hay `.gtf`. Enviar `ht3.log` (y foto o vídeo si se puede).
- **Duración variable por cada `switch`:** hoy `translen` vale para todo
  el remix y se puede mezclar `switch JUEGO` con `switch JUEGO hard`.
  Falta poder escribir, en el mismo remix, algo como `switch HOPROLL 1`
  y luego `switch CARS 2`.
- **`specialVfx_subtitleEntity` en RHREfresh:** para integrar mejor los
  subtítulos `gtl: …` en el editor.
- **`.tex` propias** para portada e iconos de Remix 21 (arte original;
  no reutilizar gráficos del juego).
- No publicar nunca `main`, romfs, audio ni cartas `.rhref` en el repo.

## 6. Commit subido a GitHub

- Rama: `work/groove-engine-v0.5.0` (basada en `main`).
- SHA: `PENDIENTE`
- URL: `PENDIENTE`
- Contenido previsto (solo fuentes, herramientas, docs y ejemplos
  originales; cero archivos con copyright del juego):
  - `engine/` — runtime v0.5.0
  - `tools/gtf.py`, `tools/groove_rhre.py`, scripts `.bat`
  - `docs/` — Tickflow, RHRE, notas v0.4.0 / v0.5.0, este resumen
  - `examples/multi/*.gtf`
  - `README.md` y `.gitignore` reforzado
