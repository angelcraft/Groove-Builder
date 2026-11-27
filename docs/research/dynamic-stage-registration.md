# Registro dinámico de hasta 256 niveles — investigación técnica

Rama: `grok/dynamic-stage-research` (creada desde `work/groove-engine-v0.5.0`, commit `6187390`).
Juego: *Rhythm Heaven Groove* (Switch), `main` build `03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8` (`03FF4A3B`).
Fecha: 27 de noviembre de 2026 (Europe/Amsterdam).

> Este documento es **solo investigación**. No modifica el motor (`engine/src/` sigue igual que en
> `work/groove-engine-v0.5.0`) y no contiene ni enlaza ningún archivo del juego. Las direcciones son
> desplazamientos dentro de la imagen de `main` en memoria (base 0, sin la cabecera NSO de 0x100).
> Las entradas IPS usan `desplazamiento + 0x100`.
>
> Método: desensamblado estático (Capstone) de la imagen de `main` 03FF4A3B que hay en local, con
> referencias cruzadas `ADRP+ADD/LDR`, `BL` y GOT. Los fragmentos de ensamblador del anexo son citas
> mínimas para documentar la interoperabilidad. Lo marcado como **[V]** está verificado en el binario;
> **[H]** es una hipótesis razonada que aún hay que confirmar en Unicorn o en la consola.

Anexo con las pruebas en bruto: [`dynamic-stage-evidence.md`](dynamic-stage-evidence.md).

---

## 0. Resumen ejecutivo

1. **La cuadrícula del mapa es fija y está en `.rodata`**: `3 mundos × 12 columnas × 5 filas`, 8 bytes
   por casilla `{int kind, int index}`, base `0xAE07B8` (GOT `0xD99768`). La función hoja
   `mapCell(coord*)` en `0x1CBCA0` calcula `base + w*0x1E0 + c*0x28 + r*8` **sin comprobar límites** **[V]**.
   El layout del mapa tiene exactamente 12 paneles de columna (`line00`…`line11`, tabla `0xDAC728`) y el
   objeto de vista guarda `12 × 5` widgets (`view+0x30`, columna `0xC8`, fila `0x28`) **[V]**.
   Hay **180 casillas** como máximo; el juego usa 123 y 57 son el marcador vacío `(0,13)`.
2. **No caben 256 niveles en la cuadrícula nativa**. Hay 30 casillas libres "seguras" (columnas 9–11
   de los mundos 0 y 1; tres de ellas ya las usan HT3/DH/Multi). Para llegar a 256 hace falta
   **paginar** esas columnas: `mapCell` se sustituye (HkReplace) y las coordenadas de las columnas
   personalizadas se traducen a `página × casilla → entrada del registro`.
3. **Cada casilla tiene que apuntar a un juego anfitrión nativo** `(kind,index)`, porque el lanzamiento
   usa el descriptor nativo (`desc+0x0C` = id del creador de escenario). Los datos que el juego lee
   por `(kind,index)` (nombre, prólogo, jingle, icono, estado, récord y medallas) **se mezclan con los
   del anfitrión**. Así se explica que Multi (anfitrión `(1,67)`) herede el nombre, el arte y el récord del
   **Remix 8** **[V]**.
4. **Guardado nativo**: `game_save.bin`, blob fijo de `0x1188` bytes en `mgr+0x548` (mgr = `0x10A75F0`),
   versión `0x34`. Los registros por juego están en `mgr+0x570` (kind0, 4 B), `mgr+0x5A8` (kind1, 16 B) y
   `mgr+0xAA8` (kind2, 8 B) **[V]**. No hay sitio para niveles nuevos, así que los guardados de los
   niveles personalizados **tienen que vivir en la SD**.
5. **Por qué Multi sobrescribe el Remix 8**: `beginPlay` (`0x48B0`) guarda `curIdx = 67` y suma 1 al
   contador de partidas de `kind1[67]`. Después, los resultados (`0x215210 → setPending 0x4910`) dejan el
   rango y la puntuación pendientes, y al volver al mapa `commitResult` (`0x1D39D0`) los escribe en
   `kind1[67]` con `setBest 0x47E0`, `setPerfectCount 0x4840` y `setSaveState 0x4030` **[V]**.
6. **Diseño recomendado**: un registro estático de 256 entradas en `subsdk4` (unos 60 KiB en `.bss`,
   sin memoria dinámica), un escáner de `sd:/groove/packs/<id>/pack.json` y una capa de guardado aislada
   que, mientras haya un nivel personalizado activo, (a) intercepta `beginPlay`, `setPending` y
   `commitResult`, (b) hace una instantánea del registro nativo del anfitrión y lo restaura antes de cada
   `writeSave` (`0x3D60`), y (c) guarda el resultado en `sd:/groove/saves/<id>.gsv`. Además le pasa
   el estado, el récord y las medallas a los hooks del mapa.

---

## 1. Punto de partida: qué hay en `work/groove-engine-v0.5.0`

### 1.1 Hooks instalados (engine/src/main.cpp v0.5.0)

| Hook | Dirección | Tipo | Para qué sirve hoy |
|---|---|---|---|
| HT2 ctor / worker / dtor | `0x428D70` / `0x428EF0` / `0x4290F0` | Trampolín | Ejecutar HT3 y Double Hell sobre el objeto HT2 nativo |
| REMIX_21 ctor / worker / dtor | `0x4202C0` / `0x420720` / `0x4207F0` | Trampolín | Motor Multi (24 escenas) sobre REMIX_21 |
| `ringTypeEntry` | `0x216530` | HkReplace (empieza por ADRP) | `type_01/bg` opcional de HT3 |
| `GetMessage` | `0x4EFE80` | Trampolín | Título `I_RING_01` |
| `cachedName(kind,idx)` | `0x2BD0` | Trampolín | Títulos `(1,41)` y `(1,67)` |
| `stashName(kind,idx)` | `0x206D00` | Trampolín | Nombre, prólogo y jingle al entrar |
| `prologueCtor` | `0x206DE0` | Trampolín | `fixStashForTile` (título, prólogo y jingle por casilla) |
| `mapInfoPanel(panel,anim)` | `0x1D0130` | Trampolín (post) | Título en el panel del mapa |
| `loadComplete` / `layoutBake` | `0x504720` / `0x4F40A0` | Trampolín | Cielo rojo de HT3 |
| `mulColor` | `0x4F3480` | HkReplace + shim | Tinte carmesí |

Funciones que se llaman pero no se enganchan (están en `sigs.hpp`): `wait 0x514D70`, `stop 0x514DD0`,
`push/pop 0x514FB0/0x514FD0`, `initSm`, `playBgm`, `toResults 0x138D40`, `exitToMenu 0x130500`,
`setNextScene 0x509570`, `switchCut 0x4D7B40`, `switchK0..2`, `setTransLen 0x4D9E10`,
`textQueueSet 0x504490` y `mapCellLock 0x1CF490`, entre otras.

### 1.2 Lo que está fijado a mano hoy

| Qué | Dónde | Efecto |
|---|---|---|
| Tres casillas (`1,9,0` HT3, `1,9,1` Double Hell, `1,9,4` Multi) | IPS `GrooveHT3`, offsets `0xAE0C00..0xAE0C27` (= `0xAE0B00..` en memoria) | v0.3.9: `(1,41) (1,41) (1,77) (1,78) (1,67)`. Las filas 2 y 3 duplican el Remix 18 y el Remix 19 |
| `kStages[]` = {ht3, doublehell} | `main.cpp` | Rutas fijas `sd:/groove/stages/<n>/<n>.gtl`. Se elige con `match` del `.gtl` frente a `readSelection()` |
| `kMultiStage` + `kMultiCand[4]` | `main.cpp` | Un solo Multi: `sd:/groove/multi.gtf` → `stages/multi/multi.gtf` → `.gtl` |
| `TileTitle gTT[3]` | `main.cpp` | Tres títulos de casilla como máximo |
| `kKind1Ring01 = 41`, `kKind1Multi = 67` | `main.cpp` | Identidad prestada de HT2 (`I_RING_01`) y del Remix 8 (`I_REMIX_07`) |
| `REMIX_21` = stage del **Remix 8** (`kind1[67]`) | descriptor `0xD19108 + 67*0x30` | Hereda el prólogo `remix/type_07`, el jingle `0x161`, el icono y el **guardado** |
| Guardado propio | `sd:/groove/save/<name>.json` | Solo `plays/completions/aborted`. Con `results native` el récord nativo va a parar al anfitrión |
| `readSelection()` | `mgr+0x2904` (modo), `+0xB98/+0xB9A/+0xB9C` (mundo, col, fila), `+0xBA0` (curIdx) | Decidir por casilla. Sin páginas ni registro |

### 1.3 Lo que conviene conservar

- El patrón de **firmas + instalación opcional**: si un hook falla, solo se desactiva esa función.
- Leer el **SD en diferido** (`ensureFs` al crear un stage), sin heap y con buffers estáticos.
- La decisión **por casilla** (`mapInfoHook`, `fixStashForTile`): sigue siendo la base, pero la casilla
  pasa a ser `(mundo, columna, fila, página)` → entrada del registro.
- Los dos motores anfitriones: `ring` (HT2, `.gtl` de aros) y `multi` (REMIX_21, `.gtf`/GTLM).

---

## 2. La cuadrícula del mapa en `main` 03FF4A3B

### 2.1 Estructuras **[V]**

```c
struct CellCoord {            // objeto en pila; vtable = *(GOT 0xD960C0) + 0x10 (= 0xCDB9B8 + 0x10)
    void*   vtbl;   // +0x00
    int32_t world;  // +0x08   0..2
    int32_t col;    // +0x0C   0..11
    int32_t row;    // +0x10   0..4
};
struct MapCell { int32_t kind; int32_t index; };      // 8 bytes, .rodata
MapCell kGrid[3][12][5];                              // 0xAE07B8 .. 0xAE0D58 (0x5A0 bytes), GOT 0xD99768

// 0x1CBCA0  MapCell* mapCell(const CellCoord* c)
//   return kGrid + c->world*0x1E0 + c->col*0x28 + c->row*8;   // sin comprobar límites
```

Tablas por mundo (índice `world`, comprobación `cmp w8,#2; b.hi → -1`):

| Tabla | Dirección | Valor `[w0,w1,w2]` | Getter | Uso observado |
|---|---|---|---|---|
| columnas de progresión | `0xAE0DF8` | `9, 9, 11` | `0x1CF3E0(map, w)` (`w<0` = mundo actual) | Solo en la corrutina de desbloqueo (`0x1D58D8`, `0x1D5BD4`) |
| filas | `0xAE0E04` | `5, 5, 3` | `0x1CF410(map, w)` | Igual (`0x1D58B0`, `0x1D5960`) |
| alfa por columna visible | `0xAE0E10` | 6 `float` | inline `0x1CF5CC` | `col - cursorCol + scroll + 1 ∈ [0,5]`: **6 columnas visibles** a la vez |

Descriptores por tipo de juego (`0x1CBBE0 descriptor(kind, index)`):

| kind | Tabla | Stride | Número | Notas |
|---|---|---|---|---|
| 0 | `0xAE0668` (GOT `0xD99750`) | `0x18` | 14 | `index 13` = **marcador de casilla vacía** (`{0,13,0,-1,…}`) |
| 1 | `0xD19108` (GOT `0xD99758`) | `0x30` | 80 | `+0x08` nameId, `+0x0C` creador del stage, `+0x18` id de icono/orden **[H]**, `+0x20` ruta del prólogo, `+0x28` jingle |
| 2 | `0xD1A008` (GOT `0xD99760`) | `0x30` | 30 | Mismo formato |

Contenido nativo de la cuadrícula (sin IPS):

| Mundo | Col 0 | Col 1–8 | Col 9 | Col 10 | Col 11 | Filas útiles |
|---|---|---|---|---|---|---|
| 0 | 5 × kind0 | 40 × kind1 (fila 4 = Remix 1…8, `(1,60..67)`) | `(0,13)` ×5 | `(0,13)` ×5 | `(0,13)` ×5 | 5 |
| 1 | 5 × kind0 | 40 × kind1 (incluye HT2 `(1,1,0)=(1,41)`) | `(0,13)` ×5 | `(0,13)` ×5 | `(0,13)` ×5 | 5 |
| 2 | 3 × kind0 | cols 1–10: 30 × kind2 (filas 0–2) | — | — | `(0,13)` | 3 |

**Huecos libres**: mundo 0 → 15 (cols 9–11); mundo 1 → 15 (cols 9–11, de las que la IPS ya usa la 9);
mundo 2 → col 11 (5) y filas 3–4 de las cols 0–10 (22), aunque estas últimas quedan fuera del
`rows = 3` del mundo 2 y seguramente no se pintan **[H]**. En total hay **57 casillas libres en memoria y
unas 30–33 que se pueden usar con seguridad**.

### 2.2 Vista de la cuadrícula y pintado **[V]**

- `map+0x4668` = objeto de vista de la cuadrícula. `0x1CC550(view, world)` repinta el mundo con un bucle
  `col = 0..11` (`cmp w21,#0xc`) desenrollado para `row = 0..4`, que llama a `0x1CC190(view, w, c, r)`.
- `0x1CC190`: widget = `view + 0x30 + c*0xC8 + r*0x28`. El icono sale de
  `*(u32*)(view + 0x990 + desc->nameId*4)` (`0x4F7AC0`, frame del icono), y el aspecto según el estado,
  de la tabla `0xAE0D58[state]` (16 B/estado, GOT `0xD997D8`), con `state = saveState(mgr, kind, index)`.
- Los widgets ocupan `view+0x30 .. view+0x990`, es decir, exactamente `12 × 0xC8`. **No se pueden
  pintar más de 12 columnas × 5 filas por mundo** sin cambiar el layout (`line00..line11`).

### 2.3 Cursor, navegación y desbloqueo **[V]**

Campos del objeto del mapa (escena; `map = panel+8` en el hook del panel):

| Offset | Tipo | Significado |
|---|---|---|
| `+0x2A38` | int | modo del mapa. `0x1CF4F0` → `== 1`, y se copia a `mgr+0x2904` al lanzar |
| `+0x29E8` | cola | cola de texto diferido (`0x504490`) |
| `+0x4668` | obj | vista de la cuadrícula (§2.2) |
| `+0x5274` | int | mundo actual |
| `+0x5278` | int | índice del juego con resultado pendiente (`getPending`) |
| `+0x527C / +0x5280 / +0x5284` | int | rango / puntuación / flags pendientes |
| `+0x5298 / +0x529C` | int | columna / fila del cursor |
| `+0x52A0` | int | desplazamiento horizontal (scroll) |
| `+0x52A4` | u8 | indicador de "acaba de moverse" (`0x1D2C20`) |
| `+0x52D8` | ptr | panel de información (`0x1D0130`) |
| `+0x5300..` (`+0x5274+0x8C..0xA8`) | 2 × {w,c,r} | cursor guardado por mundo (`switchWorld 0x1CF700`) |
| `+0x6328` | int | mundos disponibles (0/1/2) |
| `+0x6D60` | u8 | "récord actualizado" tras el commit |

- `setCursor` `0x1D4DE0(map, th, c, r)` escribe `+0x5298/+0x529C` y ajusta el scroll `+0x52A0`
  (de 0 a 2). Después llama a `0x1D2750` (refresco) y a `0x1D2B50` (cursor movido → `0x1D0130` y animaciones
  `line%02d` de la tabla `0xDAC728`).
- Para validar una casilla vecina se usan `0x1CF440(map, dCol, dRow)` (descriptor) y `0x1CF490(map, dCol, dRow)`
  (estado = `saveState(kind,index)`; `> 1` = visible o desbloqueada).
- **Por qué funciona la columna 9 del mundo 1** aunque `cols[1] = 9`: el número de columnas solo lo usa la
  corrutina de desbloqueo (`0x1D58A4..`). La navegación y el pintado recorren las 12 columnas y miran el
  **estado guardado** del `(kind,index)` de cada casilla. `(0,13)` tiene estado 0 y se queda oculta; si la IPS
  pone `(1,41)` (estado > 1 porque HT2 ya está desbloqueado), la casilla aparece. Esto cuadra con lo que se
  ha visto en la consola **[V parcial: código + hardware; falta trazar el handler del stick]**.

### 2.4 Mapa inverso `(kind,index) → casilla` **[V]**

- `0x1CD4E0 buildReverseMap()`: recorre `w=0..2`, `c=0..11` y `r=0..4` (`cmp #2/#0xb/#4`) con `mapCell` y escribe
  `rev[kind][index] = {w,c,r}` en `.bss`: `0x10B8070` (kind0, 14×0x18), `0x10B81C0` (kind1, 80×0x18) y
  `0x10B8940` (kind2). Gana **la última casilla** que encuentra. Se ejecuta una sola vez (flag `0x10B8068`) y la
  llaman `0xAA38` (arranque) y `0x1CBD28`.
- `0x1CD8B0 reverseCoord(kind,index)` lo usan: el aviso de "juego desbloqueado" `0x1D1830`
  (`notice_caption_00/notice_mesg_00`), `0x1CC9C0` (descriptor + coordenada, llamado desde el gestor en
  `0x7B04…0x88A4`) y `0x1CD490` (mundo del juego → `0x215DB0` guarda `int` en `0xDACF78` al lanzar).
- **Riesgo ya presente con la IPS v0.3.9**: `rev(1,41) = (1,9,1)` (Double Hell, en vez de HT2 `(1,1,0)`),
  `rev(1,67) = (1,9,4)` (Multi, en vez de Remix 8 `(0,8,4)`) y `rev(1,77)/(1,78) = (1,9,2)/(1,9,3)`. Así,
  al lanzar el **Remix 8 real**, `0xDACF78` recibe mundo 1 en vez de 0, y los avisos de desbloqueo de esos
  juegos señalarían la columna 9. Cualquier diseño dinámico tiene que **devolver el marcador `(0,13)` en
  las coordenadas personalizadas mientras se ejecuta `0x1CD4E0`**.

### 2.5 Panel de información `0x1D0130` **[V]**

`(panel, bool anim)`: `desc = 0x1CF440(map,0,0)`, `state = 0x1CF490(map,0,0)`. Si `state ≤ 1`, pone el texto
`I_LOCKED` (`0x4EFE80`). Si no, el nombre sale de `cachedName(desc.kind, desc.index)` (`0x1D0204`) →
`0x504490(map+0x29E8, panel+0x30, txt, 0)`, y la descripción de `0x1CBCD0` + `GetMessage` → `panel+0x38`.
El rango se pinta según `state ∈ 4..9` con las animaciones `stack00/stack01/stack02(_s)` (`0xDAC010..`).
Las medallas salen de `getPerfectCount 0x4820` → `SetPerfectCount_0..3` (`0xDAC7E8`). El récord, de
`getBest 0x47D0` (`≥ 0x400` activa un pane). Las animaciones de rango
`SetRankNone/Retry/Normal/High/Perfect/Lianzhuang/Complete` están en `0xDAC7B0`.

---

## 3. Guardado nativo

### 3.1 Archivo y blob **[V]**

| Qué | Valor |
|---|---|
| Archivo | `game_save.bin` (cadena `0xADA740`) |
| Gestor | `mgr = 0x10A75F0` (.bss, GOT `0xD96058`) |
| Blob | `mgr+0x548`, `0x1188` bytes. Copia de escritura en `mgr+0x16D0` |
| Cabecera | `+0x558` versión `0x34`, `+0x55C` tamaño `0x1188`, `+0x560` contador de escrituras, `+0x564`, `+0x568` u64 |
| Cargar | `0x3CA0(mgr, bool)`: lee `0x1188` bytes; si la versión o el tamaño no cuadran → `0x3390` (partida nueva) |
| Escribir | `0x3D60(mgr, bool)`: `memcpy(mgr+0x16D0, mgr+0x548, 0x1188)` → escritura asíncrona `0xB470`. La llaman `0x1314E4` y `0x1316D0` (cambio de escena, si `0x3DC0` no está ocupado) |

### 3.2 Registros por juego **[V]**

```c
// dentro del blob, a partir de mgr+0x570 (blob+0x28)
uint8_t  kind0[14][4];            // +0x570  [0] = estado
struct K1 {                       // +0x5A8, 80 × 16 B
    uint8_t  state;   // +0x0  0 oculto, 1 bloqueado, 2 disponible, … 4..9 rangos/medallas (ver §3.3)
    uint8_t  _p[3];
    int32_t  best;    // +0x4  getBest 0x47D0 / setBest 0x47E0
    int32_t  plays;   // +0x8  beginPlay ++ (0x48D8); 0x47F0 lee su byte bajo
    uint8_t  perfect; // +0xC  getPerfectCount 0x4820 / setPerfectCount 0x4840 (0..3)
    uint8_t  _q[3];
} kind1[80];
struct K2 { uint8_t state; uint8_t _p[3]; int32_t plays; } kind2[30];   // +0xAA8, 8 B
// +0xB98 int8 world[2], +0xB9A col[2], +0xB9C row[2], +0xB9E x[2]      (setSel 0x4890 / getSel 0x4860)
// +0xBA0 int16 curIdx[2], +0xBA4 int8 rank[2], +0xBA6 u8 flags[2], +0xBA8 int32 score[2]  (pendiente)
// mgr+0x2904 int modo: fuera del blob (el blob acaba en mgr+0x16D0; la copia de escritura, en mgr+0x2858)
```

Accesores: `saveState 0x3F70(mgr,kind,idx)` (111 llamadas `BL` directas, más saltos de cola), `saveStateAt 0x3FB0(mgr, coord*)`,
`setSaveState 0x4030(mgr,kind,idx,v)`.

### 3.3 Flujo de una partida (por qué el Remix 8 sale perjudicado) **[V]**

1. **Lanzar** (`0x1D3130` / `0x1D34A0`, A sobre la casilla en `0x1D2CC0`): `stashName(kind,idx)` →
   el gestor de escenas crea el stage con `desc+0x0C` → `mgr+0x2904 = modo` → **`beginPlay 0x48B0(mgr, modo, idx, flags)`**:
   `curIdx[modo] = idx`, `rank = 0`, `score = 0`, `flags = w3`, y suma 1 a `plays` de `kind1[idx]` (modo 0) o de `kind2[idx]` (modo 1).
2. Efecto secundario: `0x1D33BC` comprueba que el estado sea ≤ 4 y que `idx ∈ {65, 67, 73, 79}`, y entonces
   llama a `0x18AE40(3, 8, 9..0xC)`, que anota una petición global (`0xD98F28/30/38`). **Lanzar Multi sobre `(1,67)` dispara el mismo
   evento que el Remix 8** **[V código, efecto visible H]**.
3. **Durante el juego**: `initGameplay 0x137050` → `setPending(mgr, 1, 0)` (`0x137094`).
4. **Resultados** (`0x215090`): `res = *(0xDAB370)`, `score = *(0xDAB370+0x50C)`,
   `rank = 0xAE1700[res]` (`{4,3,3,3,2}`) → `setPending 0x4910(mgr, rank, score)`. Solo escribe si
   `curIdx[modo] ≥ 0`. También `0x206624` → `setPending(5, score)`.
5. **Volver al mapa** (`0x1D38A0`): `mgr+0x2904 = -1`, `getPending` → `map+0x5278..`, `clearPending 0x4900`,
   y luego **`commitResult 0x1D39D0`**: si `rank ≥ 2` → `setBest(idx, merge 0x6580(old,new))`, `map+0x6D60 = 1`
   y `0x63B0(mgr, idx)`. Con estado 7 y `flags&1` → `perfect++` (tope 3) y, al llegar a 3, `state = 8`.
   Con estado 8, `flags&2` y `rank ≥ 5` → `state = 9`.
6. **Guardar**: la próxima transición llama a `writeSave 0x3D60`, y lo modificado se guarda en `game_save.bin`.

Conclusión: el juego no tiene ninguna noción de "nivel personalizado". Todo se indexa con `idx` = índice
**del anfitrión**. Con `results native`, Multi suma partidas al Remix 8 y escribe su récord, sus medallas y su estado.

---

## 4. Identidad independiente

### 4.1 De dónde saca el juego cada dato **[V]**

| Dato | Fuente nativa | Clave | Hook actual | Hook propuesto |
|---|---|---|---|---|
| Nombre (mapa) | `cachedName 0x2BD0` en `0x1D0204` | `(kind,idx)` | post `0x1D0130` | Igual, pero por **entrada del registro** |
| Descripción (mapa) | `0x1CBCD0` + `GetMessage` → `panel+0x38` | nameId | — | Post `0x1D0130`: reencolar `panel+0x38` |
| Nombre (intro/resultados) | `stashName 0x206D00` → `**(0xD99D60)` | `(kind,idx)` | `stashName` + `prologueCtor` | Igual (`fixStashForTile` → `fixStashForEntry`) |
| Arte del prólogo | `desc+0x20` → `**(0xD99D68)` | `(kind,idx)` | `fixPrologueForTile` (solo Multi) | Por entrada (`prologue type_XX` o ruta LayeredFS validada) |
| Jingle | `desc+0x28` → `**(0xD99D70)`, tabla `0xD20410[id-0x158]` (21 entradas) | `(kind,idx)` | Solo Multi | Por entrada (`0x158..0x16C`) |
| Icono | `view+0x990 + nameId*4` → frame (`0x4F7AC0`) | nameId del anfitrión | — | Post `0x1CC190`: frame del icono de **otro** nameId nativo (`icon_from`) |
| Estado y rango en la casilla | `0xAE0D58[saveState]` | `(kind,idx)` | — | Post `0x1CC190` + hook `0x1CC420` (por coordenada) |
| Medallas y récord (panel) | `0x4820`, `0x47D0` | idx | — | Post `0x1D0130` (`SetPerfectCount_N`, `stackNN`) |
| Stage que se ejecuta | `desc+0x0C` (creador) | `(kind,idx)` | ctor HT2 / REMIX_21 | Igual. El **anfitrión** fija el motor (`ring`/`multi`) |
| Nombre en resultados | puntero de `stashName` | — | `cachedName` | Igual |

### 4.2 Desacoplar la identidad

- **Identidad estable** = `id` del paquete (`[a-z0-9_-]{1,31}`) → `hash64 = FNV-1a(id)`. El hash sirve
  para los guardados y los logs. Ni la casilla ni la página forman parte de la identidad, así que mover un
  paquete de casilla no pierde su récord.
- **Anfitrión** = `(kind,index)` nativo del motor elegido:
  - `ring` → `(1,41)` (HT2). El creador `desc+0x0C = 71` construye HT2, y el hook del ctor ejecuta la timeline.
  - `multi` → `(1,67)` (REMIX_21). El creador `112` construye REMIX_21 (24 escenas).
  - El anfitrión **solo** sirve para construir el stage. Todo lo que se lee por `(kind,idx)` se resuelve
    antes con la entrada activa (`gActiveEntry`).
- **Contexto activo** = `{entrada, página, w, c, r}`. Se fija en el confirm (`0x1D2CC0`, trampolín) y en `stashName`.
  Se limpia en el dtor del stage **y** en `mapEnterFromStage` (`0x1D38A0`). Se acabaron las fugas tipo
  "Double Hell hereda el título de HT3": el título nunca se elige por `(kind,idx)`, solo por la entrada.
- **Cadenas propias**: los buffers de título, descripción y prólogo son de cada entrada (estáticos). `isOurTitle()`
  pasa a ser "el puntero está dentro de `gRegistry`".

---

## 5. Paquetes en la SD y registro (hasta 256)

### 5.1 Estructura en la SD

```
sd:/groove/packs/
  index.txt                  # opcional: un id por línea (por si no se puede listar el directorio)
  <id>/
    pack.json                # manifiesto (JSON plano: solo strings y enteros)
    stage.gtf | stage.gtl    # timeline (ring: .gtl de aros · multi: .gtf o GTLM)
    DISABLE                  # opcional: desactiva el paquete sin borrarlo
    assets/                  # opcional y futuro (audio o arte propio, ver riesgos)
sd:/groove/saves/
  <id>.gsv                   # guardado binario de 64 B con CRC32 (+ <id>.json legible, opcional)
sd:/groove/packs.lock        # opcional: id → slot fijado (orden estable entre arranques)
```

`pack.json` (ejemplo, contenido original):

```json
{
  "format": "groove-pack/1",
  "id": "mi_remix_01",
  "engine": "multi",
  "timeline": "stage.gtf",
  "title": "Mi Remix",
  "description": "Remix de prueba",
  "prologue": "type_19",
  "jingle": "0x163",
  "icon_from": "1,79",
  "slot": -1,
  "results": "native"
}
```

Validación (si algo falla, el paquete se ignora con una línea en el log y **no ocupa casilla**):
`id` válido y que coincida con la carpeta; `engine ∈ {ring, multi}`; que la timeline exista y ocupe
≤ 60 KiB; `jingle ∈ 0x158..0x16C`; `prologue` igual a una ruta nativa (`nativeProloguePath`) o a un par
`.spr/.tex` en LayeredFS; `icon_from` = `(kind,idx)` nativo existente. El análisis completo de la timeline
**no** se hace al escanear (es caro), sino al lanzar. Si falla entonces, se vuelve al mapa limpiamente
(como el `DISABLE` actual).

### 5.2 Descubrimiento

- Ya se resuelven por nombre `OpenFile/ReadFile/...` (`kFsNames`). Habría que añadir
  `_ZN2nn2fs13OpenDirectoryEPNS0_15DirectoryHandleEPKci`,
  `_ZN2nn2fs13ReadDirectoryEPlPNS0_14DirectoryEntryENS0_15DirectoryHandleEl` y
  `_ZN2nn2fs14CloseDirectoryENS0_15DirectoryHandleE`. **`main` no importa estos símbolos** (en sus cadenas
  solo están `CreateDirectory` y `FlushFile`) **[V]**. `hk::ro::lookupSymbol` tendría que encontrarlos en el
  módulo `sdk` **[H, comprobar en la consola]**. Si no se encuentran, se usa **`index.txt`**, que genera la
  herramienta de PC.
- Cuándo: la primera vez que se pinta el mapa (en el post-hook de `0x1CC550`) y no en el arranque (se mantiene la
  regla de v0.1.1: nada de FS en `hkMain`). También se puede reescanear al volver de un stage si cambia el mtime o el
  tamaño de `index.txt`. Para hacer *hot-unplug* sin reiniciar habría que reescanear en cada `0x1CC550`, que es barato si solo
  se comprueba `pack.json`.

### 5.3 Registro en memoria (sin heap)

```cpp
namespace groove::reg {
constexpr int kMaxEntries   = 256;
constexpr int kCellsPerPage = 30;        // mundos 0 y 1 × cols 9..11 × filas 0..4
constexpr int kMaxPages     = 10;     // 9 bastan con 30/página; 10 con paginadoras (28/página, §6.3)

enum class Engine : uint8_t { None, Ring, Multi };

struct Entry {                 // 192 bytes, alineado a 8
    uint64_t hash;             // FNV-1a(id): identidad estable
    char     id[32];
    char     title[64];        // UTF-8 (tamaño de buffer igual que el actual)
    char     prologue[48];     // "type_XX" o ruta relativa a romfs
    int16_t  jingle;           // -1 = el del anfitrión
    uint8_t  hostKind, hostIndex;   // (1,41) ring · (1,67) multi
    uint8_t  iconKind, iconIndex;   // icon_from
    Engine   engine;
    uint8_t  flags;            // bit0 valid, bit1 disabled, bit2 resultsNative, bit3 pinned
    int16_t  slot;             // 0..kMaxEntries-1 (página*30 + casilla) o -1
    uint16_t gen;              // generación del escaneo en que se vio
    char     _pad[28];
};
static_assert(sizeof(Entry) == 192);

struct SaveRec {               // 32 bytes en RAM; 64 B en la SD con cabecera y CRC
    uint64_t hash;
    int32_t  best;             // misma escala que kind1.best
    int32_t  plays, clears;
    uint8_t  state;            // 0..9 igual que el nativo (para la tabla 0xAE0D58)
    uint8_t  perfect;          // 0..3
    uint8_t  lastRank;
    uint8_t  dirty;
    uint32_t crc;
    uint32_t _pad;
};
static_assert(sizeof(SaveRec) == 32);

struct DynamicStageRegistry {
    uint32_t magic;            // 'GREG'
    uint16_t count, gen;
    Entry    e[kMaxEntries];             // 49 152 B
    SaveRec  s[kMaxEntries];             //  8 192 B
    int16_t  bySlot[kMaxPages * kCellsPerPage];   // 600 B, -1 = vacío
    MapCell  virt[kMaxEntries];          //  2 048 B (lo que devuelve mapCell)
    uint8_t  page;                       // página visible
};   // ≈ 60 KiB en .bss
}
```

- Un solo `static DynamicStageRegistry gReg;` sin `new` ni `malloc`. El parser de JSON es plano, de una
  sola pasada y trabaja sobre `gFileBuf` (ya existe, 64 KiB). La timeline se lee al lanzar, en ese mismo buffer.
- **Asignación de slots**: (1) los `slot` fijados en `pack.json` o en `packs.lock`; (2) el resto, por orden de `id`
  (estable aunque cambie el orden en que se lee el directorio). Si dos piden el mismo slot, gana el primero por `id`
  y el otro va al primer hueco libre (queda en el log).
- **Quitar un paquete**: en el siguiente escaneo su `Entry` no aparece → `bySlot[slot] = -1` → `mapCell` devuelve
  `(0,13)` → la casilla vuelve a estar oculta como en el juego original. Su `.gsv` **se queda** en la SD (huérfano e
  inofensivo) y se recupera si el paquete vuelve. El guardado nativo no cambia nunca, así que quitarlo no puede corromper nada.
- Si el cursor estaba en una casilla que desaparece, el post-hook de `0x1CC550` comprueba la casilla del cursor y,
  si ha quedado vacía, llama a `setCursor` hacia `(c=8, r)` (la última columna nativa).

---

## 6. Casillas dinámicas en el mapa

### 6.1 Sustituir `mapCell` (en vez de usar la IPS)

`0x1CBCA0` es una hoja de 10 instrucciones, sin pila, y su 2.ª instrucción es `ADRP`, así que se usa **HkReplace** (un
`b` directo), como con `0x216530`. La reimplementación tiene que ser exacta:

```cpp
const MapCell* mapCellHook(const CellCoord* c) {
    const MapCell* nat = kGridNative + c->world*60 + c->col*5 + c->row;   // misma aritmética
    if (gInReverseBuild) return isCustom(c) ? &kPlaceholder : nat;        // §2.4
    if (!isCustom(c)) return nat;                                        // w∈{0,1}, col∈{9,10,11}
    int slot = gReg.page * 30 + (c->world * 15) + (c->col - 9) * 5 + c->row;
    int e = gReg.bySlot[slot];
    return (e < 0) ? &kPlaceholder : &gReg.virt[e];                      // {hostKind, hostIndex}
}
```

- Con esto **la IPS de casillas deja de hacer falta** (la tabla de `.rodata` vuelve a ser la original). Se puede
  mantener la IPS por compatibilidad: la regla "custom primero" la tapa.
- `gInReverseBuild` lo pone un trampolín en `0x1CD4E0` (empieza por `sub sp` y `stp x29,x30`). Así se corrige además la
  contaminación de `rev(1,41)` y `rev(1,67)` que tiene hoy la IPS.
- Coste: es la función más llamada del mapa (37 llamadas directas). El hook solo hace aritmética y una
  lectura de tabla; no puede tocar la SD ni escribir en el log.

### 6.2 Estado, aspecto y medallas por coordenada

Como `virt[e] = (1,41)/(1,67)`, todo lo que va por `saveState(kind,idx)` mostraría el estado del **anfitrión**.
Para corregirlo sin tocar las 111 llamadas `BL` a `0x3F70`:

| Punto | Tipo | Qué hace |
|---|---|---|
| `0x1CC420 cellState(coord*)` | Trampolín (`stp x29,x30`) | Coord personalizada → `gReg.s[e].state` (mínimo 2 = visible). Cubre la navegación (`0x1CF490`) y el panel |
| `0x3FB0 saveStateAt(mgr, coord*)` | Trampolín | Igual (llamado desde `0x1CFCB4..`, `0x24FEB4..` y `0x1DCED4..`) |
| `0x1CC190 paintCell` | Trampolín post | Si la coord es personalizada: aplicar `0xAE0D58[s.state]` a los panes del widget (`+0x30`, `+0x40`) y el frame del icono de `icon_from` |
| `0x1CC630` (bucle con `saveState == w19` sobre 3 filas, `0x1CC6C0..0x1CC75C`) | **[H]** efectos/conteo por estado | Revisar antes de la fase 2. Si cuenta casillas, el anfitrión cuenta de más |
| `0x1D0130` post (ya existe) | Ampliar | Título, descripción (`panel+0x38`), `stackNN` según `s.state`, `SetPerfectCount_<s.perfect>` y récord |

### 6.3 Páginas hasta 256

- **30 casillas por página** (mundos 0 y 1, cols 9–11). Con 256 entradas salen **9 páginas** (la última con 16).
- Opción P1 (recomendada, sin hook de mando): **casillas paginadoras**. En la página `p` se reservan
  `(1,11,4)` = "siguiente" y `(0,11,4)` = "anterior" (28 niveles por página → 10 páginas). Al confirmar una
  de ellas se intercepta `0x1D2CC0` (trampolín; es el handler de confirmar): `page±1`, `paintWorld(map+0x4668, w)` (`0x1CC550`)
  y `mapInfoPanel(map+0x52D8, 1)`. No se lanza ningún stage. El texto de la casilla lo pone el panel ("Página 3/10 ▶").
- Opción P2: hook del mando (cambio de página con ZL/ZR cuando el cursor está en col ≥ 9). Es más cómoda, pero
  todavía no se ha localizado el handler del stick ni el de los gatillos (**pendiente**).
- Opción P3 (no recomendada): mundos virtuales ≥ 3. Hay muchos `cmp w,#2; b.hi` (`0x1CF3F0`, `0x1CF420`,
  bucle `0x1CD540`), `mgr+0xB98` es `int8` por modo, `+0x6328` limita los mundos disponibles y `switchWorld`
  (`0x1CF700`) solo alterna entre los guardados. Habría que parchear demasiados sitios.
- La **cámara y el scroll** ya cubren las 12 columnas (las cols 9–11 se ven con el desplazamiento `+0x52A0`, como la col 9 de
  ahora). No hace falta tocar la cámara mientras el número de columnas no pase de 12.

### 6.4 Lanzar desde una casilla personalizada

1. `0x1D2CC0` (confirmar) → si la coord es personalizada: `gActive = {e, page, w, c, r}` (antes de `orig`).
2. `orig` → `stashName(host)`: el hook pone el título, el prólogo y el jingle de la entrada (`fixStashForEntry`).
3. ctor HT2/REMIX_21 → el hook busca `gActive.e` (no `match` del `.gtl`), lee `sd:/groove/packs/<id>/stage.*` y
   ejecuta el motor `ring` o `multi`. `match` en la timeline pasa a ser opcional e informativo.
4. Si el `engine` del paquete no coincide con el anfitrión que se ha construido (no debería pasar), el stage nativo sigue
   como está y queda en el log (fallo seguro).

---

## 7. Guardado aislado

### 7.1 Regla de oro

> Mientras `gActive.e ≥ 0`, el blob nativo `mgr+0x548..+0x16D0` **no debe cambiar** por culpa del
> nivel personalizado. Se comprueba con un CRC del registro del anfitrión antes y después.

### 7.2 Puntos de intercepción

| # | Función | Hook | Acción con un nivel personalizado activo |
|---|---|---|---|
| S1 | `beginPlay 0x48B0(mgr,mode,idx,flags)` | Trampolín (1.ª instr. `add x8,x0,w1,sxtw #1`, sin PC-rel) | **Instantánea** de `kind1[idx]` (16 B) o `kind2[idx]` (8 B), de `mgr+0xBA0..0xBAF` y de `mgr+0x560/0x564`. Llamar a `orig` (el resultado necesita `curIdx ≥ 0`), y justo después restaurar `plays` del anfitrión. Sumar 1 a `s.plays` en el registro |
| S2 | `setPending 0x4910(mgr,rank,score)` | Trampolín | Copiar `rank` y `score` a `gRun.custom` y llamar a `orig` (los resultados en pantalla los necesitan) |
| S3 | `mapEnterFromStage 0x1D38A0` | Trampolín (pre) | Si hay un resultado personalizado pendiente: aplicar al `SaveRec` la **misma lógica** que `commitResult` (rango ≥ 2 → récord; perfectos; estados 7→8→9), y luego `clearPending(mgr, mode)` (`0x4900`) **antes** de `orig`. Con `curIdx = -1`, `commitResult` sale enseguida (`tbnz w0,#31` en `0x1D3904/0x1D3A8C`) **[V]** |
| S4 | `writeSave 0x3D60(mgr,bool)` | Trampolín (`stp x29,x30`) | Defensa en profundidad: si hay una instantánea viva, comparar y **restaurar** los bytes del anfitrión antes del `memcpy` a `+0x16D0`. Si no coincidían, se anota en el log (`save guard: restored host (1,67)`) |
| S5 | `0x1D33BC` (petición `0x18AE40` para idx 65/67/73/79) | En el confirm (S0) | Opcional: con un nivel personalizado, guardar `0xD98F28..38` antes y restaurarlo después del lanzamiento, para no disparar el aviso del Remix 8 **[H]** |
| S6 | dtor del stage / salida sin resultados | ya existe | Si el stage termina sin `setPending`: borrar la instantánea **después** de restaurar |

Alternativa más simple (S1-b): en `beginPlay`, con un nivel personalizado, **no llamar a `orig`** y escribir `curIdx = -1`.
`setPending` no toca nada (`tbnz w8,#31` **[V]**) y `commitResult` no hace nada. El problema es que la pantalla de
resultados y `0x206604`/`0x2069D0` (que leen `curIdx`) se pueden comportar distinto (récord anterior en blanco,
saltarse algún paso). **[H]** Hay que probarlo en Unicorn antes de elegirla.

### 7.3 Persistencia en la SD

- `sd:/groove/saves/<id>.gsv`, 64 B en little endian: `magic 'GSV1'`, `u16 ver`, `u16 size`, `u64 hash`,
  `i32 best`, `i32 plays`, `i32 clears`, `u8 state`, `u8 perfect`, `u8 lastRank`, `u8 rsv`, `u32 writes`, `u8 pad[...]`,
  `u32 crc32`. Se escribe de forma atómica: primero `.tmp`, luego `Delete` + `Rename` (como `writeSave()` del motor).
- Se escribe **en contexto normal** (dtor del stage y `mapEnterFromStage`), nunca dentro de una corrutina de cues.
- `<id>.json` (opcional, legible), compatible con el formato `groove-save/1` de ahora (`plays`, `completions`,
  `aborted`) más `best`, `perfect` y `state`.
- Migración: `sd:/groove/save/ht3.json`, `doublehell.json` y `multi.json` se importan una vez como `plays/clears`
  de los paquetes `ht3`, `doublehell` y `multi` (que ya vendrían de serie).
- Al cargar: CRC incorrecto → se ignora el archivo y se usa `.json` o un registro vacío (nunca se borra nada).

### 7.4 Cómo vuelve al mapa

`SaveRec.state` usa la misma escala que el byte nativo (0..9), así que la casilla personalizada se pinta con
la tabla nativa `0xAE0D58` (§6.2) y el panel con `stackNN` / `SetPerfectCount_N` (§2.5). Estado mínimo de una entrada
válida: **2** (disponible). El aviso de "récord actualizado" (`map+0x6D60`) se puede poner a mano después de S3 si mejora.

---

## 8. Tabla de evidencias (main 03FF4A3B)

Firmas = las dos primeras palabras de cada función, leídas de la imagen local. Sirven para el `sigs.hpp` de la fase 1.

| Dirección | Función (nombre propuesto) | Firma | 1.ª / 2.ª instrucción | Hook |
|---|---|---|---|---|
| `0x1CBCA0` | mapCell(coord*) → cell* | `69412408 D0005E6B` | `ldpsw x8,x9,[x0,#8]` / `adrp` | HkReplace |
| `0x1CBBE0` | descriptor(kind,idx) | `7100081F 540001C0` | `cmp w0,#2` / `b.eq` | — |
| `0x1CC3C0` | cellDescriptor(coord*) | `A9BF7BFD 910003FD` | `stp` / `mov x29,sp` | opcional |
| `0x1CC420` | cellState(coord*) → `0x3F70` | `A9BF7BFD 910003FD` | `stp` / `mov` | Trampolín |
| `0x1CC190` | paintCell(view,w,c,r) | `D101C3FF A9027BFD` | `sub sp` / `stp` | Trampolín post |
| `0x1CC550` | paintWorld(view,w) | `A9BD7BFD F9000BF5` | `stp` / `str x21` | Trampolín post (escaneo) |
| `0x1CD4E0` | buildReverseMap() | `D10183FF A9027BFD` | `sub sp` / `stp` | Trampolín (flag) |
| `0x1CD8B0` | reverseCoord(kind,idx) | `B0005E49 7100081F` | `adrp` / `cmp` | no enganchar |
| `0x1CF3E0` / `0x1CF410` | cols/rowsOfWorld | `528A4E88 7100003F` | `mov w8,#0x5274` | no |
| `0x1CF440` / `0x1CF490` | cellDesc/StateRel(map,dc,dr) | `D100C3FF A9027BFD` | `sub sp` / `stp` | no (pasan por `0x1CC3C0/0x1CC420`) |
| `0x1CF700` | switchWorld(map) | `A9BE7BFD A9014FF4` | `stp` / `stp` | — |
| `0x1D0130` | mapInfoPanel(panel,anim) | `A9BB7BFD A90167FA` | `stp` / `stp` | ya enganchado |
| `0x1D2B50` | onCursorMoved(map,oldC,oldR) | `D10183FF A9027BFD` | `sub sp` / `stp` | — |
| `0x1D2CC0` | onConfirmCell(map, th) | `A9BB7BFD F9000BF9` | `stp x29,x30,[sp,#-0x50]!` / `str x25` | Trampolín (contexto, paginación) |
| `0x1D3130` / `0x1D34A0` | launch A / B (`stashName` + `beginPlay`) | `D101C3FF A9027BFD` / `A9BC7BFD F9000BF7` | `sub sp` / `stp` | — |
| `0x1D38A0` | mapEnterFromStage(map) | `A9BD7BFD F9000BF5` | `stp` / `str x21` | Trampolín (S3) |
| `0x1D39D0` | commitResult(map) | `A9BC7BFD A9015FF8` | `stp` / `stp` | no (lo neutraliza S3) |
| `0x1D4DE0` | setCursor(map,th,c,r) | `A9BD7BFD A90157F6` | `stp` / `stp` | llamada |
| `0x003F70` | saveState(mgr,kind,idx) | `7100083F 54000140` | `cmp w1,#2` / `b.eq` | **no** (demasiado usada) |
| `0x003FB0` | saveStateAt(mgr,coord*) | `A9BE7BFD F9000BF3` | `stp` / `str x19` | Trampolín |
| `0x004030` | setSaveState(mgr,kind,idx,v) | `7100083F 54000140` | `cmp` / `b.eq` | no |
| `0x0047D0` / `0x0047E0` | getBest / setBest(mgr,idx[,v]) | `8B21D008 B945AD00` / `8B21D008 B905AD02` | `add` / `ldr|str [x8,#0x5ac]` | no |
| `0x004820` / `0x004840` | get/setPerfectCount | `7100043F 54000081` / `7100043F 54000061` | `cmp w1,#1` | no |
| `0x004860` / `0x004890` | getSel / setSel | `8B21C008 39EE6109` / `8B21C008 392E6102` | — | no |
| `0x0048B0` | beginPlay(mgr,mode,idx,flags) | `8B21C408 7100043F` | `add` / `cmp` | Trampolín (S1) |
| `0x004900` | clearPending(mgr,mode) | `8B21C408 529FFFE9` | — | llamada |
| `0x004910` | setPending(mgr,rank,score) | `B9690408 37F80108` | `ldr w8,[x0,#0x2904]` / `tbnz` | Trampolín (S2) |
| `0x004940` | getPending(mgr,mode,&r,&s,&f) | `8B21C008 39EE9109` | — | no |
| `0x003CA0` | loadSave(mgr,bool) | `D10183FF A9037BFD` | `sub sp` / `stp` | no |
| `0x003D60` | writeSave(mgr,bool) | `A9BE7BFD A9014FF4` | `stp` / `stp` | Trampolín (S4) |
| `0x003390` | resetSave(mgr) | `D10143FF FD0013E8` | — | no |
| `0x002BD0` | cachedName(kind,idx) | `7100081F 54000220` | — | ya enganchado |
| `0x206D00` / `0x206DE0` | stashName / prologueCtor | `A9BE7BFD A9014FF4` / `A9BC7BFD A9015FF8` | — | ya enganchados |
| `0x215090` | ctor de la escena de resultados → `setPending` en `0x215210` | `A9BD7BFD A90157F6` | `stp` / `stp` | — |
| `0x18AE40` | postEvent(a,b,c) → `0xD98F28/30/38` | `D0006068 D0006069` | `adrp` / `adrp` | S5 opcional (no enganchar: ADRP) |

Datos:

| Dirección | Qué | Tamaño |
|---|---|---|
| `0xAE07B8` | `kGrid[3][12][5]` (`{kind,idx}`) | `0x5A0` |
| `0xAE0668` | descriptores kind0 | 14 × `0x18` |
| `0xD19108` / `0xD1A008` | descriptores kind1 / kind2 | 80 / 30 × `0x30` |
| `0xAE0DF8` / `0xAE0E04` | columnas / filas de progresión por mundo | 3 × `int` |
| `0xAE0E10` | alfa de las 6 columnas visibles | 6 × `float` |
| `0xAE0D58` | estado → aspecto de la casilla | 10 × 16 B |
| `0xDAC728` | `line00..line11`, `step00..` | 12 punteros + |
| `0xDAC7B0` / `0xDAC7E8` | `SetRank*` (7) / `SetPerfectCount_0..3` | punteros |
| `0x10B8068` / `0x10B8070` / `0x10B81C0` / `0x10B8940` | flag y mapa inverso kind0/1/2 | `.bss` |
| `0x10A75F0` | gestor de guardado y selección | `.bss` |
| `0xADA740` | `"game_save.bin"` | — |
| `0xAE1700` | resultado → rango pendiente `{4,3,3,3,2}` | 5 × `int` |
| `0xD20410` | jingles `0x158..0x16C` | 21 entradas |

### 8.1 Preguntas abiertas (necesitan Unicorn o la consola)

1. Handler del stick y de los gatillos (¿quién llama a `setCursor`/`0x1D2B50` al mover el cursor?), para la opción P2 de paginación.
2. Si `lookupSymbol` encuentra `nn::fs::OpenDirectory/ReadDirectory` en `sdk`.
3. Qué hace exactamente `0x1CC630` (bucle por estado sobre 3 filas) y si cuenta casillas personalizadas.
4. Escala de `best` (¿por qué `≥ 0x400`?), qué es `0x6580` (combinar récords) y qué hacen `0x63B0`/`0x6400` (¿desbloquear el siguiente?).
5. Qué evento es `0x18AE40(3,8,9..0xC)` en los Remix 6/8/14/20 (índices 65/67/73/79).
6. Qué significan del todo los estados 3..9 (relación con `SetRank*` y `stackNN`).
7. Si las filas 3–4 del mundo 2 se pintan o se pueden navegar (`rows[2] = 3`).
8. Si el cargador de prólogos (`0x505DF0`) acepta rutas con montaje propio (`ht3sd:/groove/packs/...`) o solo romfs/LayeredFS.
9. El efecto real de `0xDACF78` (`0x215DB0`) con el mapa inverso contaminado por la IPS v0.3.9.

---

## 9. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Corrupción del guardado nativo (récord, medallas o estado del anfitrión) | Media hoy (ya ocurre con `results native`) | Alto | S1–S4: instantánea + restauración antes de `writeSave`, `clearPending` antes de `commitResult` y CRC del registro del anfitrión en el log. Pruebas en Unicorn comparando el blob byte a byte |
| Mapa inverso contaminado (avisos de desbloqueo y `0xDACF78`) | Alta con la IPS actual | Medio | `gInReverseBuild` en `0x1CD4E0`. Quitar la IPS de casillas en la fase 2 |
| `mapCell` sustituida con un error de aritmética | Baja | Crítico (cuelgue del mapa) | Copia exacta probada con los 180 coords en Unicorn. Firma `69412408 D0005E6B`. Si no cuadra → no instalar |
| Otro módulo (Orochi `subsdk1`, HoopDX `subsdk5`) ya engancha alguna función | Baja | Medio | `looksHooked()` como ahora y desactivar solo la función afectada |
| Memoria de `subsdk4` (`.bss`, unos 60 KiB más) | Baja | Medio | Estructuras de tamaño fijo y `static_assert`. Comprobar el tamaño del NSO y del segmento en `GrooveHT3.nss` |
| Tiempo de escaneo (256 × `pack.json`) en el primer pintado del mapa | Media | Bajo/Medio (tirón) | Leer solo `pack.json` (≤ 4 KiB), caché por generación, `index.txt` y escaneo incremental |
| El paquete desaparece con el cursor encima o a mitad de partida | Baja | Medio | El registro solo cambia al reescanear en el pintado del mapa, nunca durante un stage. Cursor recolocado (§5.3) |
| Recursos que faltan (prólogo o `.spr/.tex` LayeredFS) | Media | Alto (pantalla negra) | Comprobar la pareja `.spr+.tex` (como `resolvePrologue`) y, si falta, usar el del anfitrión |
| Arte nuevo (iconos o prólogos propios) | — | — | Bloqueado: la codificación de `.tex` sigue sin resolver (`bg_red/NOTES.md`). Se usan iconos nativos (`icon_from`) |
| Límite de canales de audio y BGM (`initSm`/`playBgm` con id nativo) | Media | Medio | Solo ids de BGM nativos en la fase 1. Audio propio en una fase aparte (GRO-8) |
| Cámara o scroll con más de 12 columnas | — | Alto | Fuera del diseño: no se pasa de 12 columnas. Se pagina |
| Paginación P1 confusa (casillas reservadas) | Media | Bajo | Texto claro en el panel. P2 cuando aparezca el handler del mando |
| Evento `0x18AE40` del Remix 8 disparado por Multi | Media | Bajo | S5 |
| Fugas de identidad entre entradas (título o jingle) | Media (ya pasó) | Bajo | Contexto activo único que se limpia en el dtor y en `mapEnterFromStage`. Nunca decidir por `(kind,idx)` |

---

## 10. Plan por fases

### Fase 1 — Registro, escáner y guardado aislado (sin tocar el mapa)
- `groove::reg` (`registry.hpp/.cpp`): `pack.json` plano, `index.txt`, slots estables, `SaveRec` + `.gsv`.
- Paquetes de serie `ht3`, `doublehell` y `multi` generados desde las rutas actuales (compatibilidad total con v0.5.0).
- Hooks S1–S4 con firmas en `sigs.hpp` (`kSigsSave`). Si alguno falla → el modo `results native` para personalizados se desactiva y
  el nivel sale con `exit` (como `NO_NATIVE_RESULTS`).
- Pruebas en Unicorn: jugar Multi con `results native` y comprobar que el blob `mgr+0x548..+0x16D0` queda **igual byte a byte**,
  salvo los contadores de cabecera.
- Salida: Remix 8 a salvo y récords propios en `sd:/groove/saves/`.

### Fase 2 — Casillas dinámicas e identidad
- HkReplace `0x1CBCA0` + trampolín `0x1CD4E0` (mapa inverso limpio). Ya no hace falta la IPS de casillas.
- 30 casillas (mundos 0 y 1, cols 9–11) desde el registro. Hooks `0x1CC420`, `0x3FB0` y post `0x1CC190`.
- Identidad por entrada: título, descripción, prólogo, jingle e `icon_from` en `0x1D0130`, `stashName`, `prologueCtor` y `cachedName`.
- Contexto activo en `0x1D2CC0` y selección del stage por entrada en los ctor HT2/REMIX_21.
- Pruebas: los 180 coords en Unicorn (nativos iguales; personalizados → `virt`), consola: quitar o poner paquetes entre arranques.

### Fase 3 — Páginas hasta 256, iconos y resultados propios
- Paginación P1 (casillas paginadoras; 28 por página, 10 páginas) y P2 cuando se localice el handler del mando.
- Medallas, récord y rango propios en el panel y en la casilla. "Récord actualizado" (`map+0x6D60`).
- Resultados: nombre por entrada, y quizá rango o comentarios por paquete.
- Investigación aparte: arte propio (`.tex`), audio propio y prólogos desde la SD sin LayeredFS.

---

## 11. Compatibilidad y reglas del repositorio

- No se publica **ningún** archivo del juego: ni `main` ni imágenes de `main`, romfs, `.spr`, `.tex`, `.msbt`, `.cwv`, `.bwav`,
  `.bfsar`, audio, `subsdk4` compilado ni IPS. Los ejemplos de `pack.json` y `.gsv` de este documento son originales.
- `work/groove-engine-v0.5.0` y `main` no se tocan. Esta rama solo añade `docs/research/`.
