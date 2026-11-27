# GE-152 — Contaminación del mapa inverso por la IPS y corrección

Evidencia: **solo revisión estática** (`main` `03FF4A3B`). No se ha ejecutado nada en Unicorn ni en Switch.

## 1. Causa [V]

- `buildReverseMap 0x1CD4E0` recorre `w = 0..2`, `c = 0..11`, `r = 0..4` y, por cada casilla `(kind, idx)`, escribe la coordenada en `0x10B8070` (kind0), `0x10B81C0` (kind1) y `0x10B8940` (kind2), con paso `0x18`. **Gana la última** que encuentra. La marca de "construido" está en `0x10B8068`.
- Se llama desde `0xAA38` (arranque) y desde `0x1CBD28` (construcción perezosa, en cola).
- Posiciones nativas (rejilla original): HT2 `(1,41)` → `(1,1,0)`, Remix 8 `(1,67)` → `(0,8,4)`, `(1,77)` → `(1,8,2)`, `(1,78)` → `(1,8,3)`.
- La IPS v0.3.9 escribe en world1 col9 `(1,41),(1,41),(1,77),(1,78),(1,67)`. Como el bucle llega a `(1,9,*)` después de las casillas nativas, queda `rev(1,41) = (1,9,1)`, `rev(1,67) = (1,9,4)`, `rev(1,77) = (1,9,2)`, `rev(1,78) = (1,9,3)`.
- Por eso el HT2 y el Remix 8 "están" en la columna 9 para todo lo que use el mapa inverso.

## 2. Llamadores de `reverseCoord 0x1CD8B0` y efectos [V salvo indicación]

| Llamador | Función | Uso | Efecto de la contaminación |
|---|---|---|---|
| `0x3F68` (wrapper `0x3F60`) | `launchA 0x1D3338`; `0x15DAA4`, `0x15DBC4` | Umbral de la racha de fallos (bit 5 de sesión): mundo `≠ 0` → 3; si no, col `== 1` → 1, col `≥ 7` → 3, otra → 2 | Remix 8: nativo `(0,8)` → 3; con la IPS `(1,9)` → 3. HT2: 3 → 3. **El umbral no cambia** para estos dos; para `(1,77)/(1,78)` también 3 → 3 |
| `0x1CD4A0` (`0x1CD490`) | `0x1D017C`, `0x1D32BC`, `0x1D34E8`, `0x1D3E94`, `0x1D3FD8`, `0x1D4C24`, `0x1D6AA0` | `mundo`, o `fila > 1` en el mundo 2 → `0x215DB0` (RAM `0xDACF78`) y panel de información | **Remix 8: 0 → 1**. El valor de "mundo" que se pasa a la escena y al panel cambia al jugar el Remix 8 oficial |
| `0x1CC9F8`/`0x1CCA34` (`0x1CC9C0`) | `0x7B04`, `0x7FDC`, `0x82D8`, `0x8508`, `0x88A4` (gestor) | Rellena la coordenada `{+8 mundo, +0xC col, +0x10 fila}` de un juego para listas/avisos | Las coordenadas apuntan a la col 9 [H: qué menú las muestra] |
| `0x1D1860` (`0x1D1830`) | `0x1D441C` (corrutina de desbloqueo) | Aviso `notice_caption_00`/`notice_mesg_00` y animación | El aviso de desbloqueo del HT2/Remix 8 apunta a la casilla de la col 9 |

No escribe en el guardado. Es una contaminación de **RAM/presentación**, que afecta también a los juegos oficiales mientras la IPS esté instalada.

## 3. Corrección

1. **Quitar las escrituras estáticas de la IPS** en `kGrid` (`0xAE07B8`, mundo 1, col 9). Sin esto no hay corrección posible, porque la IPS altera la tabla de origen que leen tanto `mapCell` como `buildReverseMap`.
2. **`mapCell 0x1CBCA0` con HkReplace** (la 2.ª instrucción es `ADRP`): misma aritmética que el original (`base + w·0x1E0 + c·0x28 + r·8`). Para coordenadas custom habilitadas devuelve el descriptor virtual de la ranura. Si `gInReverseBuild` está activo, devuelve el marcador vacío `(0,13)`.
3. **Trampolín en `0x1CD4E0`** (`sub sp` / `stp x29,x30`; firma `D10183FF A9027BFD`): `gInReverseBuild = true; orig(); gInReverseBuild = false`. Cubre las dos entradas (`0xAA38` y `0x1CBD28`) porque las dos pasan por la función.
4. Resultado: `rev(1,41) = (1,1,0)`, `rev(1,67) = (0,8,4)`, `rev(1,77) = (1,8,2)`, `rev(1,78) = (1,8,3)`, igual que el juego original. Las ranuras custom no aparecen en el mapa inverso. Nada las busca por `(kind,idx)`: GE-152 las identifica por coordenada.

## 4. Efectos secundarios de la corrección en cada llamador

- `0x3F60` (racha): con la IPS el valor era el mismo (§2), así que no cambia nada.
- `0x1CD490` (mundo): el Remix 8 oficial vuelve a 0, que es lo correcto. En una sesión custom con anfitrión `(1,67)`, `launchA` calcula `0xDACF78 = 0` (mundo nativo del anfitrión), no el mundo de la casilla custom. Es RAM; si la escena lo usa para el tema, se puede corregir en F1 [H].
- `0x1D1830` (aviso de desbloqueo): vuelve a apuntar a las casillas nativas. Las casillas custom no reciben avisos nativos, porque su estado sale del `.gsv`.
- `0x1CC9C0` (listas del gestor): vuelven a las coordenadas nativas.
- `setCursor 0x1D4DE0` solo se llama desde la corrutina de desbloqueo: no hay movimientos de cursor espurios hacia la col 9.
- Desbloqueos (`0x1CC8F0`/`setSaveState`) y contadores de los getters `0x1CF3E0/0x1CF410` (cols `[9,9,11]`, filas `[5,5,3]`): usan la rejilla directa, no el mapa inverso. No les afecta.

## 5. Verificación propuesta

- **Host**: reimplementación en Python de `buildReverseMap` sobre una rejilla de prueba sintética (sin datos del juego). Con y sin escrituras en la col 9, y con el guard, comprobar que `rev` es igual a la referencia.
- **Unicorn**: ejecutar `0x1CD4E0` con la imagen original y con el hook. Comparar `0x10B8070..0x10B8A00` byte a byte con la versión sin IPS.
- **Switch**: aviso de desbloqueo y panel del Remix 8 oficial (mundo 0) con el módulo nuevo y sin la IPS.
