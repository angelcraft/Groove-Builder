# Anexo: evidencias del binario (main 03FF4A3B)

Extractos mínimos del desensamblado (Capstone, AArch64) de la imagen local de `main` 03FF4A3B, citados
solo para documentar la interoperabilidad. Las direcciones son desplazamientos en la imagen de memoria
(base 0). No se incluye ningún binario ni recurso del juego.

Documento principal: [`dynamic-stage-registration.md`](dynamic-stage-registration.md).

## E1. `mapCell` 0x1CBCA0: `grid + w*0x1E0 + c*0x28 + r*8`, sin límites (GOT 0xD99768 → 0xAE07B8)

```text
1cbca0: ldpsw   x8, x9, [x0, #8]
1cbca4: adrp    x11, #0xd99000
1cbca8: mov     w12, #0x1e0
1cbcac: ldrsw   x10, [x0, #0x10]
1cbcb0: ldr     x11, [x11, #0x768]
1cbcb4: smaddl  x8, w8, w12, x11
1cbcb8: mov     w11, #0x28
1cbcbc: smaddl  x8, w9, w11, x8
1cbcc0: add     x0, x8, x10, lsl #3
1cbcc4: ret     
```

## E2. `descriptor(kind,idx)` 0x1CBBE0: kind0 0x18 (GOT 0xD99750), kind1/kind2 0x30

```text
1cbbe0: cmp     w0, #2
1cbbe4: b.eq    #0x1cbc1c
1cbbe8: cmp     w0, #1
1cbbec: b.eq    #0x1cbc08
1cbbf0: cbnz    w0, #0x1cbc30
1cbbf4: adrp    x8, #0xd99000
1cbbf8: mov     w9, #0x18
1cbbfc: ldr     x8, [x8, #0x750]
1cbc00: smaddl  x0, w1, w9, x8
1cbc04: ret     
1cbc08: adrp    x8, #0xd19000
1cbc0c: add     x8, x8, #0x108
1cbc10: mov     w9, #0x30
1cbc14: smaddl  x0, w1, w9, x8
1cbc18: ret     
1cbc1c: adrp    x8, #0xd1a000
1cbc20: add     x8, x8, #8
1cbc24: mov     w9, #0x30
1cbc28: smaddl  x0, w1, w9, x8
1cbc2c: ret     
1cbc30: mov     x0, xzr
1cbc34: ret     
```

## E3. `colsOfWorld` 0x1CF3E0 / `rowsOfWorld` 0x1CF410: 3 mundos (`cmp #2; b.hi`), tablas 0xAE0DF8 / 0xAE0E04

```text
1cf3e0: mov     w8, #0x5274
1cf3e4: cmp     w1, #0
1cf3e8: ldr     w8, [x0, x8]
1cf3ec: csel    w8, w8, w1, lt
1cf3f0: cmp     w8, #2
1cf3f4: b.hi    #0x1cf408
1cf3f8: adrp    x9, #0xae0000
1cf3fc: add     x9, x9, #0xdf8
1cf400: ldr     w0, [x9, w8, uxtw #2]
1cf404: ret     
1cf408: mov     w0, #-1
1cf40c: ret     
1cf410: mov     w8, #0x5274
1cf414: cmp     w1, #0
1cf418: ldr     w8, [x0, x8]
1cf41c: csel    w8, w8, w1, lt
1cf420: cmp     w8, #2
1cf424: b.hi    #0x1cf438
1cf428: adrp    x9, #0xae0000
1cf42c: add     x9, x9, #0xe04
1cf430: ldr     w0, [x9, w8, uxtw #2]
1cf434: ret     
1cf438: mov     w0, #-1
1cf43c: ret     
```

## E4. `buildReverseMap` 0x1CD4E0: bucles w ≤ 2, c ≤ 11, r ≤ 4; gana la última casilla

```text
1cd538: b       #0x1cd554
1cd53c: nop     
1cd540: ldr     w8, [sp, #0x10]
1cd544: add     w9, w8, #1
1cd548: cmp     w8, #2
1cd54c: str     w9, [sp, #0x10]
1cd550: b.ge    #0x1cd5ec
1cd554: str     wzr, [sp, #0x14]
1cd558: b       #0x1cd574
1cd55c: nop     
1cd560: ldr     w8, [sp, #0x14]
1cd564: add     w9, w8, #1
1cd568: cmp     w8, #0xb
1cd56c: str     w9, [sp, #0x14]
1cd570: b.ge    #0x1cd540
1cd574: str     wzr, [sp, #0x18]
```

## E5. `paintWorld` 0x1CC550: 12 columnas (`cmp w21,#0xc`) × 5 filas desenrolladas

```text
1cc5f8: mov     w3, #3
1cc5fc: bl      #0x1cc190
1cc600: mov     x0, x20
1cc604: mov     w1, w19
1cc608: mov     w2, w21
1cc60c: mov     w3, #4
1cc610: bl      #0x1cc190
1cc614: add     w21, w21, #1
1cc618: cmp     w21, #0xc
1cc61c: b.ne    #0x1cc5b0
1cc620: ldp     x20, x19, [sp, #0x20]
```

## E6. `paintCell` 0x1CC190: widget = view + c*0xC8 + r*0x28; icono por nameId en view+0x990

```text
1cc1ac: adrp    x25, #0xd96000
1cc1b0: mov     w8, #0xc8
1cc1b4: ldr     x25, [x25, #0xc0]
1cc1b8: mov     x19, x0
1cc1bc: mov     w9, #0x28
1cc1c0: smaddl  x8, w2, w8, x0
1cc1c4: add     x0, sp, #8
1cc1c8: mov     w20, w3
1cc1cc: stp     w1, w2, [sp, #0x10]
1cc1d0: mov     w21, w2
1cc1d4: mov     w23, w1
1cc1d8: smaddl  x24, w3, w9, x8
1cc1dc: str     w3, [sp, #0x18]
1cc1e0: add     x10, x25, #0x10
1cc1e4: str     x10, [sp, #8]
1cc1e8: bl      #0x1cbca0
```

## E6b. `paintCell`: estado → tabla de aspecto 0xAE0D58 (GOT 0xD997D8), stride 16

```text
1cc25c: bl      #0x1cbca0
1cc260: ldp     w1, w2, [x0]
1cc264: adrp    x0, #0x10a7000
1cc268: add     x0, x0, #0x5f0
1cc26c: bl      #0x3f70
1cc270: adrp    x8, #0xd99000
1cc274: mov     w23, w0
1cc278: ldr     x8, [x8, #0x7d8]
1cc27c: add     x25, x8, w0, sxtw #4
```

## E7. `cellState` 0x1CC420 → `saveState(mgr=0x10A75F0, kind, idx)`

```text
1cc420: stp     x29, x30, [sp, #-0x10]!
1cc424: mov     x29, sp
1cc428: bl      #0x1cbca0
1cc42c: ldp     w1, w2, [x0]
1cc430: adrp    x0, #0x10a7000
1cc434: add     x0, x0, #0x5f0
1cc438: ldp     x29, x30, [sp], #0x10
1cc43c: b       #0x3f70
```

## E8. `saveState` 0x3F70: kind0 +0x570 (×4), kind1 +0x5A8 (×16), kind2 +0xAA8 (×8)

```text
003f70: cmp     w1, #2
003f74: b.eq    #0x3f9c
003f78: cmp     w1, #1
003f7c: b.eq    #0x3f90
003f80: cbnz    w1, #0x3fa8
003f84: add     x8, x0, w2, sxtw #2
003f88: ldrb    w0, [x8, #0x570]
003f8c: ret     
003f90: add     x8, x0, w2, sxtw #4
003f94: ldrb    w0, [x8, #0x5a8]
003f98: ret     
003f9c: add     x8, x0, w2, sxtw #3
003fa0: ldrb    w0, [x8, #0xaa8]
003fa4: ret     
003fa8: mov     w0, #-1
003fac: ret     
```

## E9. `beginPlay` 0x48B0: curIdx/rank/flags/score pendientes + `plays++` del anfitrión

```text
0048b0: add     x8, x0, w1, sxtw #1
0048b4: cmp     w1, #1
0048b8: strh    w2, [x8, #0xba0]
0048bc: add     x8, x0, w1, sxtw
0048c0: strb    wzr, [x8, #0xba4]
0048c4: strb    w3, [x8, #0xba6]
0048c8: add     x8, x0, w1, sxtw #2
0048cc: str     wzr, [x8, #0xba8]
0048d0: b.eq    #0x48ec
0048d4: cbnz    w1, #0x48fc
0048d8: add     x8, x0, w2, sxtw #4
0048dc: ldr     w9, [x8, #0x5b0]
0048e0: add     w9, w9, #1
0048e4: str     w9, [x8, #0x5b0]
0048e8: ret     
0048ec: add     x8, x0, w2, sxtw #3
0048f0: ldr     w9, [x8, #0xaac]
0048f4: add     w9, w9, #1
0048f8: str     w9, [x8, #0xaac]
0048fc: ret     
```

## E10. `setPending` 0x4910: solo si curIdx ≥ 0

```text
004910: ldr     w8, [x0, #0x2904]
004914: tbnz    w8, #0x1f, #0x4934
004918: add     x9, x0, x8, lsl #1
00491c: ldrsh   w9, [x9, #0xba0]
004920: tbnz    w9, #0x1f, #0x4934
004924: add     x9, x0, x8
004928: add     x8, x0, x8, lsl #2
00492c: strb    w1, [x9, #0xba4]
004930: str     w2, [x8, #0xba8]
004934: ret     
```

## E11. `writeSave` 0x3D60: memcpy de 0x1188 bytes mgr+0x548 → mgr+0x16D0 y escritura de "game_save.bin"

```text
003d60: stp     x29, x30, [sp, #-0x20]!
003d64: stp     x20, x19, [sp, #0x10]
003d68: mov     x29, sp
003d6c: mov     x19, x0
003d70: tbz     w1, #0, #0x3d80
003d74: ldr     w8, [x19, #0x560]
003d78: add     w8, w8, #1
003d7c: str     w8, [x19, #0x560]
003d80: mov     w20, #0x16d0
003d84: mov     w8, #0x1096
003d88: add     x1, x19, #0x548
003d8c: add     x0, x19, x20
003d90: mov     w2, #0x1188
003d94: strb    wzr, [x19, x8]
003d98: bl      #0xa65c70
003d9c: add     x0, x19, #8
003da0: add     x3, x19, x20
003da4: adrp    x1, #0xada000
003da8: add     x1, x1, #0x740
003dac: ldp     x20, x19, [sp, #0x10]
003db0: mov     w2, #1
003db4: mov     w4, #0x1188
003db8: ldp     x29, x30, [sp], #0x20
003dbc: b       #0xb470
```

## E12. `loadSave` 0x3CA0: versión 0x34 y tamaño 0x1188; si no cuadran → reset 0x3390

```text
003ce4: ldr     w21, [x19, #0x564]
003ce8: add     x0, sp, #8
003cec: add     x1, x19, #0x548
003cf0: mov     w2, #0x1188
003cf4: mov     w22, #0x1188
003cf8: bl      #0x4e38a0
003cfc: add     x0, sp, #8
003d00: bl      #0x4e37c0
003d04: ldr     w8, [x19, #0x558]
003d08: cmp     w8, #0x34
003d0c: b.ne    #0x3d24
003d10: ldr     w8, [x19, #0x55c]
003d14: cmp     w8, w22
003d18: b.ne    #0x3d24
003d1c: tbnz    w20, #0, #0x3d30
003d20: b       #0x3d38
003d24: mov     x0, x19
003d28: bl      #0x3390
```

## E13. `mapEnterFromStage` 0x1D38A0: getPending → clearPending → commit

```text
1d38c0: mov     w8, #-1
1d38c4: str     w8, [x20, #0x2904]
1d38c8: mov     x0, x20
1d38cc: bl      #0x64f0
1d38d0: str     w0, [x21, #0x2c8]
1d38d4: mov     x0, x19
1d38d8: bl      #0x1cf4f0
1d38dc: mov     w8, #0x527c
1d38e0: mov     w9, #0x5280
1d38e4: mov     w10, #0x5284
1d38e8: mov     w1, w0
1d38ec: add     x2, x19, x8
1d38f0: add     x3, x19, x9
1d38f4: add     x4, x19, x10
1d38f8: mov     x0, x20
1d38fc: bl      #0x4940
1d3900: str     w0, [x21, #0x278]
1d3904: tbnz    w0, #0x1f, #0x1d3920
1d3908: mov     x0, x19
1d390c: bl      #0x1cf4f0
1d3910: mov     w1, w0
1d3914: adrp    x0, #0x10a7000
1d3918: add     x0, x0, #0x5f0
1d391c: bl      #0x4900
1d3920: ldr     x8, [x20, #0x3aa0]
```

## E14. `commitResult` 0x1D39D0: setBest / setPerfectCount / setSaveState sobre kind1[idx]

```text
1d3a88: ldr     w2, [x23]
1d3a8c: tbnz    w2, #0x1f, #0x1d3c8c
1d3a90: ldr     w8, [x23, #4]
1d3a94: cmp     w8, #2
1d3a98: b.lt    #0x1d3b18
1d3a9c: adrp    x20, #0xd96000
1d3aa0: mov     w1, #1
1d3aa4: ldr     x20, [x20, #0x58]
1d3aa8: mov     w22, #0x6d60
1d3aac: mov     w24, #1
1d3ab0: mov     x0, x20
1d3ab4: bl      #0x3f70
1d3ab8: ldr     w1, [x23]
1d3abc: cmp     w0, #4
1d3ac0: mov     w8, #0x19
1d3ac4: mov     x0, x20
1d3ac8: csel    w21, wzr, w8, lt
1d3acc: bl      #0x47d0
1d3ad0: ldr     w2, [x23, #8]
1d3ad4: mov     w1, w0
1d3ad8: mov     x0, x20
1d3adc: mov     w3, w21
1d3ae0: bl      #0x6580
1d3ae4: ldr     w1, [x23]
1d3ae8: mov     w2, w0
1d3aec: mov     x0, x20
1d3af0: bl      #0x47e0
```

## E15. Lanzamiento 0x1D3380..0x1D3450: stashName, efecto 0x18AE40 para idx 65/67/73/79, modo → mgr+0x2904, beginPlay

```text
1d3380: ldp     w0, w1, [x21]
1d3384: bl      #0x206d00
1d3388: adrp    x8, #0xd96000
1d338c: mov     w1, #0xe
1d3390: ldr     x8, [x8, #0x68]
1d3394: ldr     w2, [x21, #0xc]
1d3398: ldr     x3, [x21, #0x10]
1d339c: ldr     x0, [x8]
1d33a0: ldr     x8, [x0]
1d33a4: ldr     x8, [x8, #0x48]
1d33a8: blr     x8
1d33ac: ldr     x0, [x19, #0x38c0]
1d33b0: mov     w1, #0xe
1d33b4: mov     x2, xzr
1d33b8: bl      #0x509570
1d33bc: cmp     w22, #4
1d33c0: b.gt    #0x1d3428
1d33c4: ldr     w8, [x21]
1d33c8: cmp     w8, #1
1d33cc: b.ne    #0x1d3428
1d33d0: ldr     w8, [x21, #4]
1d33d4: sub     w8, w8, #0x41
1d33d8: ror     w8, w8, #1
1d33dc: cmp     w8, #3
1d33e0: b.gt    #0x1d33f8
1d33e4: cbz     w8, #0x1d3410
1d33e8: cmp     w8, #1
1d33ec: b.ne    #0x1d3428
1d33f0: mov     w2, #0xa
1d33f4: b       #0x1d341c
1d33f8: cmp     w8, #4
1d33fc: b.eq    #0x1d3418
1d3400: cmp     w8, #7
1d3404: b.ne    #0x1d3428
1d3408: mov     w2, #0xc
1d340c: b       #0x1d341c
1d3410: mov     w2, #9
1d3414: b       #0x1d341c
1d3418: mov     w2, #0xb
1d341c: mov     w0, #3
1d3420: mov     w1, #8
1d3424: bl      #0x18ae40
1d3428: mov     x0, x19
1d342c: bl      #0x1cf4f0
1d3430: str     w0, [x20, #0x2904]
1d3434: mov     x0, x19
1d3438: bl      #0x1cf4f0
1d343c: ldr     w2, [x21, #4]
1d3440: mov     w1, w0
1d3444: mov     x0, x20
1d3448: mov     w3, w23
1d344c: bl      #0x48b0
```

## E16. Resultados 0x2151DC: rango = 0xAE1700[res], puntuación = res+0x50C → setPending

```text
2151dc: adrp    x8, #0xdab000
2151e0: add     x8, x8, #0x370
2151e4: ldr     w2, [x8, #0x50c]
2151e8: ldr     w8, [x8]
2151ec: cmp     w8, #4
2151f0: b.hi    #0x215204
2151f4: adrp    x9, #0xae1000
2151f8: add     x9, x9, #0x700
2151fc: ldr     w1, [x9, x8, lsl #2]
215200: b       #0x215208
215204: mov     w1, wzr
215208: adrp    x0, #0x10a7000
21520c: add     x0, x0, #0x5f0
215210: bl      #0x4910
```

## E17. Panel 0x1D0130: estado de la casilla, medallas `SetPerfectCount_N`, récord ≥ 0x400

```text
1d0130: stp     x29, x30, [sp, #-0x50]!
1d0134: stp     x26, x25, [sp, #0x10]
1d0138: stp     x24, x23, [sp, #0x20]
1d013c: stp     x22, x21, [sp, #0x30]
1d0140: stp     x20, x19, [sp, #0x40]
1d0144: mov     x29, sp
1d0148: mov     x19, x0
1d014c: ldr     x0, [x0, #8]
1d0150: mov     w20, w1
1d0154: mov     w1, wzr
1d0158: mov     w2, wzr
1d015c: bl      #0x1cf440
1d0160: mov     x21, x0
1d0164: ldr     x0, [x19, #8]
1d0168: mov     w1, wzr
1d016c: mov     w2, wzr
1d0170: bl      #0x1cf490
1d0174: mov     w22, w0
1d0178: ldp     w0, w1, [x21]
1d017c: bl      #0x1cd490
1d0180: mov     w23, w0
1d0184: ldr     x0, [x19, #0x28]
```

## E18. Cuadrícula nativa `kGrid[3][12][5]` en 0xAE07B8 (sin IPS), `{kind,index}`

| Mundo | Col | Fila 0 | Fila 1 | Fila 2 | Fila 3 | Fila 4 |
|---|---|---|---|---|---|---|
| 0 | 0 | (0,0) | (0,2) | (0,5) | (0,7) | (0,10) |
| 0 | 1 | (1,40) | (1,34) | (1,16) | (1,24) | (1,60) |
| 0 | 2 | (1,30) | (1,6) | (1,26) | (1,38) | (1,61) |
| 0 | 3 | (1,10) | (1,32) | (1,12) | (1,42) | (1,62) |
| 0 | 4 | (1,36) | (1,52) | (1,22) | (1,14) | (1,63) |
| 0 | 5 | (1,28) | (1,56) | (1,50) | (1,58) | (1,64) |
| 0 | 6 | (1,48) | (1,4) | (1,54) | (1,46) | (1,65) |
| 0 | 7 | (1,7) | (1,37) | (1,43) | (1,35) | (1,66) |
| 0 | 8 | (1,51) | (1,33) | (1,31) | (1,53) | (1,67) |
| 0 | 9 | (0,13) | (0,13) | (0,13) | (0,13) | (0,13) |
| 0 | 10 | (0,13) | (0,13) | (0,13) | (0,13) | (0,13) |
| 0 | 11 | (0,13) | (0,13) | (0,13) | (0,13) | (0,13) |
| 1 | 0 | (0,1) | (0,4) | (0,6) | (0,8) | (0,9) |
| 1 | 1 | (1,41) | (1,15) | (1,29) | (1,18) | (1,68) |
| 1 | 2 | (1,5) | (1,27) | (1,57) | (1,44) | (1,69) |
| 1 | 3 | (1,49) | (1,17) | (1,13) | (1,20) | (1,70) |
| 1 | 4 | (1,19) | (1,47) | (1,59) | (1,8) | (1,71) |
| 1 | 5 | (1,23) | (1,45) | (1,55) | (1,0) | (1,72) |
| 1 | 6 | (1,21) | (1,11) | (1,39) | (1,2) | (1,73) |
| 1 | 7 | (1,1) | (1,25) | (1,9) | (1,3) | (1,74) |
| 1 | 8 | (1,75) | (1,76) | (1,77) | (1,78) | (1,79) |
| 1 | 9 | (0,13) | (0,13) | (0,13) | (0,13) | (0,13) |
| 1 | 10 | (0,13) | (0,13) | (0,13) | (0,13) | (0,13) |
| 1 | 11 | (0,13) | (0,13) | (0,13) | (0,13) | (0,13) |
| 2 | 0 | (0,12) | (0,11) | (0,3) | (0,13) | (0,13) |
| 2 | 1 | (2,9) | (2,10) | (2,11) | (0,13) | (0,13) |
| 2 | 2 | (2,0) | (2,1) | (2,2) | (0,13) | (0,13) |
| 2 | 3 | (2,21) | (2,22) | (2,23) | (0,13) | (0,13) |
| 2 | 4 | (2,18) | (2,19) | (2,20) | (0,13) | (0,13) |
| 2 | 5 | (2,24) | (2,25) | (2,26) | (0,13) | (0,13) |
| 2 | 6 | (2,27) | (2,28) | (2,29) | (0,13) | (0,13) |
| 2 | 7 | (2,12) | (2,13) | (2,14) | (0,13) | (0,13) |
| 2 | 8 | (2,15) | (2,16) | (2,17) | (0,13) | (0,13) |
| 2 | 9 | (2,3) | (2,4) | (2,5) | (0,13) | (0,13) |
| 2 | 10 | (2,6) | (2,7) | (2,8) | (0,13) | (0,13) |
| 2 | 11 | (0,13) | (0,13) | (0,13) | (0,13) | (0,13) |

`(0,13)` = marcador vacío (descriptor kind0[13] = `{0,13,0,-1,0,0}`). IPS v0.3.9 (offsets de archivo
`0xAE0C00..0xAE0C27`): mundo 1, col 9 → `(1,41) (1,41) (1,77) (1,78) (1,67)`.

## E19. Tablas por mundo y de estado

| Dirección | Valores |
|---|---|
| `0xAE0DF8` cols | [9, 9, 11] |
| `0xAE0E04` filas | [5, 5, 3] |
| `0xAE0E10` alfa | [0.5, 1.0, 1.0, 1.0, 0.5, 0.2] |
| `0xAE0D58[0]` | [0, 0, 0, 0] |
| `0xAE0D58[1]` | [1, 0, 0, 0] |
| `0xAE0D58[2]` | [1, 1, 0, 1] |
| `0xAE0D58[3]` | [1, 3, 0, 0] |
| `0xAE0D58[4]` | [1, 2, 0, 0] |
| `0xAE0D58[5]` | [1, 3, 0, 0] |
| `0xAE0D58[6]` | [1, 3, 0, 3] |
| `0xAE0D58[7]` | [1, 3, 0, 4] |
| `0xAE0D58[8]` | [1, 3, 0, 5] |
| `0xAE0D58[9]` | [1, 3, 0, 6] |
| `0xAE1700` rango | [4, 3, 3, 3, 2] |
| `0xDAC728` | line00, line01, line02, line03, line04, line05, line06, line07, line08, line09, line10, line11 |
| `0xDAC7B0` | SetRankNone, SetRankRetry, SetRankNormal, SetRankHigh, SetRankPerfect, SetRankLianzhuang, SetRankComplete |
| `0xDAC7E8` | SetPerfectCount_0, SetPerfectCount_1, SetPerfectCount_2, SetPerfectCount_3 |

## E20. Llamadas (referencias `BL` en `.text`)

| Función | Llamadas |
|---|---|
| `0x1CBCA0` | 37: `0x3400`, `0x3460`, `0x34BC`, `0x351C`, `0x357C`, `0x35E0`, `0x3644`, `0x36A8`, `0x370C`, `0x376C`, `0x37D0`, `0x3830`, `0x3890`, `0x38F4`, `0x395C`, `0x3BA8`, `0x3FC4`, `0x70E8`, `0x717C`, `0x7228`, `0x72C8`, `0x7350`, `0x73F8`, `0x1CC1E8`, `0x1CC25C`, `0x1CC3C8`, `0x1CC428`, `0x1CC6C0`, `0x1CC70C`, `0x1CC74C`, `0x1CC79C`, `0x1CC7DC`, `0x1CC82C`, `0x1CC86C`, `0x1CC8D0`, `0x1CD420`, `0x1CD5B0` |
| `0x1CD8B0` | 5: `0x3F68`, `0x1CC9F8`, `0x1CCA34`, `0x1CD4A0`, `0x1D1860` |
| `0x1CD490` | 7: `0x1D017C`, `0x1D32BC`, `0x1D34E8`, `0x1D3E94`, `0x1D3FD8`, `0x1D4C24`, `0x1D6AA0` |
| `0x48B0` | 2: `0x1D344C`, `0x1D3604` |
| `0x4910` | 3: `0x137094`, `0x206624`, `0x215210` |
| `0x4940` | 1: `0x1D38FC` |
| `0x4900` | 1: `0x1D391C` |
| `0x47E0` | 1: `0x1D3AF0` |
| `0x4840` | 2: `0x1D3B7C`, `0x1D3BC0` |
| `0x3D60` | 2: `0x1314E4`, `0x1316D0` |
| `0x3CA0` | 1: `0xA81C` |
| `0x1D0130` | 3: `0x1CF7C4`, `0x1D2BA4`, `0x1D3CD4` |
| `0x1CF3E0` | 2: `0x1D58D8`, `0x1D5BD4` |
| `0x1CF410` | 2: `0x1D58B0`, `0x1D5960` |
| `0x1D4DE0` | 4: `0x1D59F8`, `0x1D5BA4`, `0x1D5CEC`, `0x1D60D4` |
| `0x3F70` | 111 (no se listan) |
