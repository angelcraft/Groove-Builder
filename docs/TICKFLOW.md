# Groove Tickflow v0.1

Lenguaje tipo **Tickflow** para escribir remixes de Groove Engine a mano.
El archivo `.gtf` se lee con pulsos (beats). A partir de Groove Engine v0.5.0
el motor lo carga en nativo (no hace falta compilar). `gtf.py` sigue sirviendo
para decompilar un `.gtl` o para trabajar en el PC.

Hace falta **Python 3** (viene en Windows desde python.org; marca “Add to PATH”).
No instala nada más.

```
python3 gtf.py compile    mi_remix.gtf  -o multi.gtl
python3 gtf.py decompile  multi.gtl     -o mi_remix.gtf
python3 gtf.py cues                   # lista juegos y nombres de cue
```

Copia el `.gtf` a `sd:/groove/multi.gtf` o a `sd:/groove/stages/multi/multi.gtf`
(haz antes una copia de seguridad con JKSV). El motor busca en este orden:
`.gtf` corto, `.gtf` en stages, `.gtl` corto, `.gtl` en stages.
Se juega en la casilla del Multi (mundo 1, columna 9, fila 4), salvo que cambies `match`.

## La idea

- **1 pulso = 480 ticks.**
- `rest 4` avanza el reloj 4 pulsos.
- `switch` y los cues **no** avanzan el reloj: ocurren en el pulso actual.
  Por eso un cambio de juego y su primer cue pueden ir seguidos, clavados
  en el mismo pulso.
- También puedes escribir `at 15` para saltar a un pulso absoluto
  (solo hacia adelante).

Valores de tiempo aceptados: enteros (`1`), decimales (`0.5`, `1.5`),
fracciones (`1/3`, `2/3`) o ticks sueltos (`240t`).

## Cabecera

```
title "Remix 21"          # texto del mapa y de la intro
prologue type_19          # arte del prologo (type_00 .. type_19, o una ruta)
jingle 0x163              # jingle del prologo, 0x158 .. 0x16C
bgm 139
start 0                   # pulso en el que arranca startGameplay
translen 2                # duracion de la transicion (pulsos)
match -1 9 4
results native            # o exit / custom (salen al menu, no guardan el record)
first CARS                # escenario inicial (no escribe un switch en el pulso 0)
end 80                    # pulso del endGameplay; opcional: end 80 2 (fade de 2 pulsos)
finish 84                 # pulso del finish
```

Si omites `end` y `finish`, el compilador los calcula: el final 4 pulsos
después del último evento, y `finish` 4 pulsos después de `end`.
`start` por defecto es 0 (la canción y el juego arrancan juntos).

## Juegos y cues

Después de `switch KAERU` puedes escribir el nombre corto del cue:

```
switch KAERU
frog5 basic
rest 5
frog3 basic
```

También vale el nombre cualificado en cualquier momento: `KAERU.frog5 basic`.
Y los identificadores crudos del `.gtl`: `KAERU.0x1B8DB0 5 0 0 basic`.

La etiqueta final (`basic`, `tech`, `busy`, `back`, …) es opcional: es el
comentario de puntuación, igual que en el `.gtl`.

`switch PUTILABO cut` (alias: `hard`) hace un corte seco en lugar de la
transición con estilo. También se acepta `switch JUEGO 0|1|2` y un sub `1|2`.

Otros eventos que entiende el motor:

```
fade 0.5 0.6              # fundido de 0.5 pulsos hasta alpha 0.6
anim Remix8               # animacion del layout del juego actual
anim CRAB Remix8 0x3B58   # juego y layout explicitos
```

La lista completa está en `python3 gtf.py cues`. Los nombres cortos coinciden
con los patrones de RHREfresh (frog5, softGrow, brake, hoop, tea, …).
Si un nombre existe en dos juegos (`yellow` en HUNGRY y en SOCCER), hay que
cualificarlo o estar dentro del `switch` correspondiente.

También se aceptan los alias de RHREfresh en el switch:
`switch ribbitRocket` es lo mismo que `switch KAERU`.

## Repeticiones: loop, def y call

```
def burbujas
  loop 3
    softGrow basic
    rest 1
  end
end

switch PUTILABO
call burbujas
```

- `loop N ... end` repite el bloque N veces.
- `def NOMBRE ... end` define una subrutina; `call NOMBRE` la expande
  en ese punto (se puede usar antes o después del `def`).
- `end` sin argumentos cierra un `loop` o un `def`.
  `end 80` (con un numero) es el final de la canción.
- Los `def` no se pueden anidar ni llamarse a sí mismos.

## Comentarios

`#` y `//` comentan hasta el final de la linea. Se pueden poner al final
de una instrucción. Dentro de un `title "..."` no cuentan como comentario.

## De `.gtl` a `.gtf`

```
python3 gtf.py decompile multi.gtl -o multi.gtf
```

El descompilador reconstruye `rest`, `switch` y los nombres de cue. Si lo
vuelves a compilar, el `.gtl` queda **equivalente pulso a pulso** (mismos
juegos, cambios, cues, start/end/finish y ticks). Luego puedes limpiar el
`.gtf` a mano con `loop` y `def` para que se lea todavía mejor.

## Notas

- Groove Tickflow genera timelines **Multi** (`GTLM 1`, anfitrión Remix 21).
  No sustituye al `.gtl` de Hoop Trundling 3 (esa pista va por otro formato).
- El tempo lo pone la canción del `bgm`. Un comando `tempo` no se aplica.
- Este paquete no incluye archivos del juego ni audio.
