# Groove Engine ↔ RHREfresh: conversor v0.4.1

## Novedad v0.4.1: cambios de juego sin cues (`gtl: switch`)
Sirve para intros como la de *I'm a Lady Now*, donde se ven varios juegos seguidos sin que tengas que pulsar nada.

**En RHREfresh:**
1. Pon un **subtítulo** (Special → Subtitle) en el pulso exacto del cambio y escribe:
   - `gtl: switch KAERU`: cambio normal, con transición;
   - `gtl: switch PUTILABO hard`: corte seco e instantáneo. Úsalo en cambios rápidos.
2. El nombre del juego es el interno: KAERU (Ribbit Rocket), PUTILABO (Pop, Don't Drop), CARS (Stop N Go N Stop), HURDLE (Hop N Slide), RING, HUNGRY, etc. La lista completa está en `cue_functions.md`.
3. Delante de todo pon el subtítulo `gtl: origin` en el pulso 0.
   - Si el primer subtítulo `gtl: switch` está antes del primer cue, ese juego es el que se ve al empezar.
4. Arrastra el `.rhref` sobre `convertir_multi.bat`.

**Qué hace el conversor:**
- Cada `gtl: switch` sale en el `.gtl` como `W tick JUEGO` (o `W tick JUEGO cut` con `hard`), **en ese pulso exacto**, aunque no haya cues detrás. El juego entra en la lista de juegos del `.gtl` aunque no tenga ningún cue.
- Si un juego tiene cues y no le has puesto un `gtl: switch` antes, el conversor añade un cambio automático justo antes de su primer cue y te avisa.
- **Avisos:**
  - un switch al juego que ya está en pantalla (se omite);
  - un switch que corta un patrón que todavía no ha terminado;
  - dos switches normales más juntos que la transición (2 pulsos): usa `hard`.
- Opcional: con el subtítulo `gtl: title Mi remix` cambias el título (motor v0.3.5).

**Ejemplo:** `test/ejemplo_intro_switch.rhref` → `test/intro_switch.gtl`. Intro KAERU → PUTILABO → CARS → HURDLE → KAERU, un cambio por pulso con `hard` y sin cues. Después vienen los cues de los 4 juegos.

**Prueba automática:** `python test/test_switch_v041.py`.

**Avisos del motor** (subsdk4 v0.3.3 o posterior; probado en el emulador con v0.3.5):
- El `.gtl` necesita **al menos un cue** (una llamada `X`). Un remix solo con switches se rechaza.
- Los cambios van en orden en un solo hilo. Un cambio normal espera a que termine la transición anterior (2 pulsos con `translen 960`). Por eso, para cambios cada pulso usa `hard`.
- Al empezar, el motor carga todos los juegos del remix. Si un `hard` llega a un juego que aún no ha terminado de cargar, el juego espera a que cargue: ese cambio y los siguientes pueden llegar tarde. Si en la consola ves los primeros cambios retrasados, empieza la intro unos pulsos más tarde.
- La música del remix **no** pasa al juego. Suena la canción del Remix 21 (bgm 139, unos 302 pulsos), así que los pulsos de tu remix se cuentan sobre esa canción.

# Conversor v0.4

## Novedad v0.4: los 24 juegos del Remix 21 (menos uno de patrones)
- `rhre2gtlm` pasa ya los patrones de **23 juegos** más: además de los 12 de antes,
  - **Brolly Good Show**: cho, pa, allez y encore;
  - **Pop, Don't Drop** (laboratorio de burbujas): softGrow y hardGrow;
  - **Stop N Go N Stop**: accel, accelRemix7 y brake;
  - **Hop N Slide**: hop y slide;
  - **Slice N Dice Kitchen**, **Backup Spotlight**, **Sweeper Star**, **Spirit Slasher**, **Yum-Bot Simulator**, **Flutter Speed**, **Can Do** y **Alien Alphabet** (solo cha).
- La tabla completa con antelaciones y estado está en el LEEME de GrooveMulti v0.3.3 y en `cue_functions.md`.
- **Necesita el subsdk4 v0.3.3** para Brolly Good Show cho/pa, el brócoli, el codo de Backup Spotlight y el barrido largo. Con un subsdk4 anterior, ese `.gtl` se rechaza y sale el Remix 21 original.
- **Bloques estirables:** en Brolly Good Show *cho* / *pa* y en los pudines estirables de Yum-Bot, **el ancho del bloque es el espaciado** entre cues. Por ejemplo, ancho 1 = un pulso y ancho 0,5 = medio pulso.
- **Parejas:**
  - Backup Spotlight: `countDanceL/R` o `countElbow` + el siguiente `countStop`.
  - Sweeper Star: `sweepingStart` + el siguiente `sweepingStop`.
  - Cada pareja se convierte en una sola llamada nativa.
- **Pop, Don't Drop:** pon `softGrow` o `hardGrow` donde aparece la burbuja. El juego la revienta (tu golpe) 3 pulsos después. Los `softPop` y `hardPop` se ignoran, porque son tu parte.
- **Can Do** necesita 14 pulsos de antelación.
- **Ejemplos nuevos:**
  - `test/ejemplo_remix1.rhref` → `test/remix1.gtl`: tu Remix 1 con Aros, Paraguas, Disco y Bestia.
  - `test/ejemplo_remix1_plus.rhref` → `test/remix1_plus.gtl`: lo mismo más Pop Don't Drop, Stop N Go N Stop y Hop N Slide.
  - `test/games/prueba_JUEGO.rhref`: un juego en cada uno.
- **Corrección:** PUTILABO es *Pop, Don't Drop* y SOFTCATCH es *Yum-Bot Simulator*.

## Cómo hacer tu Remix 1 en RHREfresh
1. Crea un remix nuevo. Pon un subtítulo `gtl: origin` en el pulso 0.
2. Coloca los patrones de los juegos (serie *Groove*): Hoop Trundling, Brolly Good Show, Disc Dog y Feeding the Beast.
   - Puedes añadir Pop Don't Drop, Stop N Go N Stop, Hop N Slide u otros del Remix 21.
   - Entre juego y juego pon un bloque **Game Change** y deja unos pulsos libres.
3. Que acabe antes del pulso ~300 (la canción del Remix 21) y pon **End remix**.
4. Arrastra el `.rhref` sobre `convertir_multi.bat` y lee los AVISOS.
5. Copia el `multi.gtl` a `sd:/groove/stages/multi/multi.gtl` y juega en el Mundo 1, columna 9, fila 4.

# Conversor v0.3.1

## Novedad v0.3.1
- **Hasta 24 juegos por remix** (antes 8). Necesita el **subsdk4 v0.3.2**: con un subsdk4 anterior, un `.gtl` con más de 8 juegos se rechaza y sale el Remix 21 original.
- Nuevo ejemplo con los 12 juegos: `test/ejemplo_multi_C.rhref` → `test/multi_C.gtl` (287 pulsos; la canción del Remix 21 dura unos 302).
- Los mapeos de los juegos no cambian.

# Conversor v0.3

## Novedad v0.3: 12 minijuegos (motor v0.3.1)
- `rhre2gtlm` ahora pasa los patrones de **Sneezy Moon, Ribbit Rocket, Hop Stop 'n' Roll, Fruit Flex, Wiper Bosses, Soccer Dreams, Lightning Bolting, Disc Dog y A for Effort**, además de Hoop Trundling, Feeding the Beast y Crab Snacks.
- Para los juegos nuevos usa los **patrones** de RHREfresh (no los cues sueltos): el conversor pone la llamada nativa con su antelación. La tabla de patrones y antelaciones está en el LEEME del paquete GrooveMulti v0.3.1.
- **Disc Dog y A for Effort necesitan el subsdk4 v0.3.1**; con el v0.3.0 el `.gtl` se rechaza y sale el Remix 21 original.
- Máximo 8 juegos por `.gtl`.
- Pruebas: `test/games/prueba_JUEGO.rhref` (un juego cada uno, con su `.gtl`) y los ejemplos `test/ejemplo_multi_A.rhref` / `_B.rhref` → `multi_A.gtl` / `multi_B.gtl`.
- Avisos nuevos: patrones que el juego no tiene (Sneezy Moon *red*, *tadpole*, *bothAlternate*, *aaaa*), partes que no se reproducen (confeti, cuenta del perro) y mapeos aproximados.

# Conversor v0.2 (sigue igual)

Con esto puedes hacer las cartas de **Hoop Trundling** en RHREfresh y pasarlas al juego como `.gtl`, el formato del motor Groove. Solo usa Python 3; no se instala nada más. No lleva nada del juego.

## Novedad v0.2: varios minijuegos (motor v0.3.0, escenario del Remix 21)
- **`rhre2gtlm`** convierte un remix con **Hoop Trundling + Feeding the Beast + Crab Snacks** en un `multi.gtl`. Los **Game Change** de RHREfresh se convierten en cambios de escena.
- **`convertir_multi.bat`**: arrastra el remix encima y crea `multi.gtl` al lado. Cópialo a `sd:/groove/stages/multi/multi.gtl`. Se juega en el mundo 1, columna 9, fila 4.
- Las reglas (antelación de cada juego, subtítulos `gtl: anim/fade/switch/X`) están en el LEEME del paquete GrooveMulti v0.3.0. La tabla de cues de los demás juegos está en `cue_functions.md`.
- **`check`** valida tanto los `.gtl` de aros como los multi.
- Ejemplo: `test/sample_multi.rhref` → `test/multi.gtl`.

## Archivos
- `groove_rhre.py`: conversor de remixes. Comandos:
  - `rhre2gtl`: convierte un remix `.rhref`, `.rhre3` o `remix.json` en `.gtl`.
  - `gtl2rhre`: convierte un `.gtl` en `.rhref` para editarlo en RHREfresh.
  - `check`: valida un `.gtl` con las mismas reglas que el motor.
- `convertir.bat`: arrastra un `.rhref` encima y crea el `.gtl` al lado. Usa `plantilla_ht3.gtl` para la cabecera y el fondo.
- `HT3_editable.rhref`: la carta de HT3 (94 aros) ya abierta como remix, para usarla de punto de partida.
- `plantilla_ht3.gtl`: el `ht3.gtl` actual.
- `test/`: un remix de ejemplo y su conversión.

## Pasos en el PC (Windows)
1. Instala Python 3 desde python.org y marca **"Add python.exe to PATH"**.
2. Instala RHREfresh: descarga `RHREfresh_X_win_x64.zip` de su GitHub, descomprímelo y abre `RHREfresh.exe`. La primera vez descarga la base de datos de sonidos.
3. En RHREfresh, abre `HT3_editable.rhref`, o crea un remix nuevo y pon primero un subtítulo con el texto `gtl: origin`. Ese subtítulo marca el tick 0 del juego.
4. Coloca los patrones del grupo **Hoop Trundling**, que está en la serie *Groove*. También puedes poner cues sueltos: `hoop` y después `pa`, `pi`, `pu`, `pe` y `po`.
5. Guarda el `.rhref` y arrástralo sobre `convertir.bat`. Lee los AVISOS que salgan.
6. En la SD, haz copia de `sd:/groove/stages/ht3/ht3.gtl` y sustitúyelo por tu `.gtl`, renombrado a `ht3.gtl`. Se juega en el mundo 1, columna 9, fila 0.

## Reglas
- **Un aro.** Un cue `hoop` en el pulso H hace que el juego tire un aro en ese momento. Los cuatro personajes suenan en H+1, H+1,5, H+2 y H+2,5 (pa, pi, pu, pe), y tú en H+3 (po). Es lo mismo que hacen los patrones de RHREfresh.
- **Máscara.** Si suenan los cuatro, se escribe -1, el valor nativo. Para cada personaje que falte se quita su bit: pa=1, pi=2, pu=4, pe=8.
- **Tempo.** Cuenta en pulsos. El juego usa el tempo de su propia canción (HT2, bgm 64). Los cambios de tempo del remix y su música **no** pasan al juego.
- **Eventos extra.** Se ponen como subtítulos:
  - `gtl: C tech` es un comentario de puntuación. Valores: basic, tech, busy, back.
  - `gtl: A BgStep` es una animación de fondo y `gtl: S` son las estrellas.
  - `gtl: end` marca el final; también sirve el bloque **End remix**.
- **Lo que se ignora.** Otros minijuegos y las sílabas sueltas sin su `hoop` se ignoran, pero salen en los avisos.
