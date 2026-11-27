# Llamadas de cue que acepta el motor v0.3.3 (escenario REMIX_21)

Solo son direcciones y números: no hay nada del juego aquí. Las columnas de argumentos son los valores que usan los remixes originales del juego, con cuántas veces aparecen.

Uso en RHREfresh, como subtítulo: `gtl: X JUEGO 0xFUNCION a b c [d] [etiqueta]`. Se llama **en ese pulso exacto**; el juego hace su animación a partir de ahí (sin adelanto automático, así que hay que probar).

Efecto `gtl: anim JUEGO Remix8` usa el layout de la columna "layout".

| Juego | Función | Estado | Argumentos nativos (veces) | layout |
|---|---|---|---|---|
| PUMPUP | 0x209B80 | aprox v0.3: fruitFlex apple | [1, 0, 0] (26), [0, 0, 0] (11) | - |
| PUMPUP | 0x20A170 | calibrado v0.3: fruitFlex lemon | [0, 0, 0] (8) | - |
| FLYDISC | 0x18D3F0 | NUEVO v0.3.1, calibrado: discDog throw* (4º argumento d = 0, como el juego) | [0, 3360, -1] (21) | 0x40B8 |
| ROLLING | 0x222FA0 | calibrado v0.3: hopStopNRoll rolling (a=1), stopHopping (a=2) | [0, 0, 0] (169), [0, 3360, -1] (13), [1, 0, 0] (10), [2, 0, 0] (10) | 0x3E08 |
| ROLLING | 0x223350 | aprox v0.3: hopStopNRoll startHopping | [0, 0, 0] (13), [0, 3360, -1] (1) | 0x3E08 |
| ROLLING | 0x223800 | disponible (sin calibrar, sin conversor) | [0, 0, 0] (4) | 0x3E08 |
| HUNGRY | 0x1AF800 | calibrada + conversor (Feeding the Beast) | [0, 0, 0] (44), [1, 0, 0] (26) | 0x3CB0 |
| CARS | 0x1601D0 | calibrado v0.4: stopNGoNStop accel (a=1, -0,5) / accelRemix7 (a=0, -2,5) | [1, 0, 0] (12), [0, 0, 0] (4) | 0x3CB0 |
| CARS | 0x1608F0 | calibrado v0.4: stopNGoNStop brake (-2) | [0, -1, 0] (7), [0, -1, 1] (1) | 0x3CB0 |
| KAERU | 0x1B8DB0 | calibrado v0.3: ribbitRocket frog3/4/5 (a = numero) | [4, 0, 0] (7), [4, 1, 0] (4), [3, 0, 0] (2), [2, 0, 0] (1) | 0x4778 |
| KAERU | 0x1B8F70 | disponible (sin conversor: renacuajo con otro espaciado) | [3, 0, 0] (2), [3, 3, 0] (2) | 0x4778 |
| CRAB | 0x17BFC0 | calibrada + conversor (Crab Snacks, macaron) | [-1, -1, -1] (29) | 0x3B58 |
| CRAB | 0x17D0D0 | calibrada + conversor (Crab Snacks, habas) | [-1, -1, -1] (3) | 0x3B58 |
| INSECT | 0x1B54C0 | calibrado v0.4: flutterSpeed butterfly (a=360) / butterflyRemix5 (a=720), -4 | [720, 1920, 0] (28), [360, 1920, 0] (9) | 0x3CA8 |
| INSECT | 0x1B5A60 | calibrado v0.4: flutterSpeed grasshopper (a=240) / grasshopperRemix5 (a=480), -4 | [240, 1920, 0] (7), [480, 1920, 0] (6) | 0x3CA8 |
| INSECT | 0x1B60F0 | calibrado v0.4: flutterSpeed dragonfly (-3) | [480, 1920, 0] (6) | 0x3CA8 |
| SOFTCATCH | 0x248B70 | calibrado v0.4: yumBotSimulator pudding (b=320) / puddingLong (b=480), -2; defective* a=1, -1 | [0, 480, 0] (5), [1, 480, 0] (1) | 0x3CB0 |
| RING | 0x217960 | calibrada + conversor (Hoop Trundling) | [-1, 0, 0] (11), [0, 1, 0] (7), [-1, 1, 0] (5) | 0x3B58 |
| THUNDER | 0x27DBA0 | calibrado v0.3: lightningBolting cloudYellow(+Swing) | [1, 0, 0] (17), [2, 0, 0] (7), [1, 11420576, 0] (4), [1, 11420568, 0] (2) | 0x3B58 |
| THUNDER | 0x27E130 | disponible (sin calibrar, sin conversor) | [0, 0, 0] (11) | 0x3B58 |
| THUNDER | 0x27E6C0 | calibrado v0.3: lightningBolting cloudPink(+Swing) | [1, 0, 0] (4), [1, 11420576, 0] (1), [2, 0, 0] (1) | 0x3B58 |
| THUNDER | 0x27EC00 | disponible (sin calibrar, sin conversor) | [0, 0, 0] (1) | 0x3B58 |
| HAMMER | 0x1AB410 | aprox v0.4: canDo red (-14,5; la lata sale 16 pulsos antes del golpe) | [0, 0, 7680] (30), [-960, 1, 7680] (3), [-1440, 1, 7680] (2), [-3360, 0, 7680] (1) | 0x3B58 |
| HAMMER | 0x1ABCB0 | calibrado v0.4: canDo blue (-14); frog aprox | [0, 0, 7680] (2), [-1200, 1, 7680] (2), [-1440, 1, 7680] (2), [-1440, 0, 7680] (1) | 0x3B58 |
| MOON | 0x1DB630 | calibrado v0.3: sneezyMoon green* (a=1 con preparacion, a=0 standalone) | [0, 0, 0] (5), [1, 0, 0] (2), [1, 1, -1] (1) | 0x3E00 |
| THE_A | 0x278FE0 | NUEVO v0.3.1, calibrado: aForEffort tea/soda/cocoa/aaa; se escribe `X t THE_A 0x278FE0 TEA` (palabra TEA, SODA, COCOA o AAA) | ["TEA", 0, 0] (20), ["COCOA", 0, 0] (8), ["SODA", 0, 0] (2), ["AAA", 0, 0] (1) | 0x4360 |
| PUTILABO | 0x20BF90 | calibrado v0.4: popDontDrop softGrow (-5; el jugador revienta a +3) | [0, 0, 0] (54), [0, 1, 0] (1) | 0x3E08 |
| PUTILABO | 0x20C190 | aprox v0.4: popDontDrop hardGrow (-5; a=480) | [480, 0, 0] (16), [240, 0, 0] (3) | 0x3E08 |
| WIPER | 0x2AA2F0 | calibrado v0.3: wiperBosses pinkFast | [3, 0, 0] (5), [0, 0, 0] (1) | 0x3F60 |
| WIPER | 0x2A9B00 | calibrado v0.3: wiperBosses bothSlow | [3, 0, 0] (7) | 0x3F60 |
| WIPER | 0x2AA6F0 | calibrado v0.3: wiperBosses bothFast | [3, 0, 0] (4), [0, 0, 0] (3), [9, 0, 0] (3), [15, 0, 0] (1) | 0x3F60 |
| WIPER | 0x2AA4F0 | calibrado v0.3: wiperBosses blueFast | [3, 0, 0] (3), [0, 0, 0] (1) | 0x3F60 |
| WIPER | 0x2A9900 | calibrado v0.3: wiperBosses blueSlow | [1, 0, 0] (1) | 0x3F60 |
| WIPER | 0x2A9700 | calibrado v0.3: wiperBosses pinkSlow | [1, 0, 0] (1), [0, 0, 0] (1) | 0x3F60 |
| SOCCER | 0x246760 | calibrado v0.3: soccerDreams white | [0, 0, 0] (26), [0, 1920, 0] (1) | 0x3E00 |
| SOCCER | 0x246B80 | calibrado v0.3: soccerDreams pink | [0, 0, 0] (8), [0, 1920, 0] (3) | 0x3E00 |
| SOCCER | 0x246FF0 | calibrado v0.3: soccerDreams yellow / yellowThunder (aprox) | [0, 0, 0] (2), [0, 1920, 0] (1) | 0x3E00 |
| HURDLE | 0x1B1FC0 | calibrado v0.4: hopNSlide hop (a=0, -6); slide (a=1, -6,5) aprox | [1, 0, 0] (25), [0, 0, 0] (10) | 0x3CB0 |
| HURDLE | 0x1B24D0 | disponible (sin efecto medido en el emulador; sin conversor) | [2, 2, 0] (4), [2, 0, 0] (1), [5, 0, 0] (1) | 0x3CB0 |
| TALK | 0x255100 | aprox v0.4: alienAlphabet cha/chaGrown (-0,5) | [1, 0, 0] (8), [4, 0, 0] (2) | 0x3CB0 |
| COOKING | 0x178880 | calibrado v0.4: sliceNDiceKitchen tomatoN (b=1) / pepperN (b=3), -1,5 (a=N-1 aprox) | [0, 1, 0] (5), [3, 1, -1] (5), [3, 1, 0] (4), [0, 1, -1] (4) | 0x3CB0 |
| COOKING | 0x178DC0 | NUEVO v0.3.3, calibrado: sliceNDiceKitchen broccoli [3,2,-1,-1], -2 (d=-1 como el juego) | [3, 2, -1] (11) | 0x3CB0 |
| PARASOL | 0x204970 | NUEVO v0.3.3, calibrado: brollyGoodShow cho (b=0) / pa (b=1); a = espaciado en ticks (ancho del bloque x480); -3; d=0 | [960, 1, 0] (6), [480, 1, 0] (6), [960, 0, 0] (4), [480, 0, 0] (4) | 0x3CA8 |
| PARASOL | 0x205030 | calibrado v0.4: brollyGoodShow allez (-1) | [1, 1, 0] (1) | 0x3CA8 |
| DANCER | 0x181210 | calibrado v0.4: backupSpotlight countDanceL/R (-3) + countStop: a = stop - inicio + 2, b=3 | [12, 3, 0] (4), [4, 3, 0] (3), [8, 3, 0] (2), [10, 1, 0] (1) | 0x3E08 |
| DANCER | 0x181C70 | NUEVO v0.3.3: backupSpotlight countElbow (-3,5) + countStop: a = stop - inicio + 2,5; d=0 | [12, 3, 0] (1), [8, 1, 0] (1), [4, 1, 1] (1) | 0x3E08 |
| DANCER | 0x182460 | aprox v0.4: backupSpotlight flashyLeft/Right (-3,5) | [0, 1, 0] (1), [0, 0, 0] (1) | 0x3E08 |
| SAMURAI | 0x22AD50 | calibrado v0.4: spiritSlasher singleSlash/singleStarter [1,1] (-2) | [1, 1, 0] (24), [1, 2, 0] (6), [2, 2, 0] (6), [1, 3, 0] (2) | 0x3E08 |
| SAMURAI | 0x22AFF0 | calibrado v0.4: spiritSlasher doubleSlash/doubleStarter [1,1] (-2) | [1, 1, 0] (6) | 0x3E08 |
| BRUSH | 0x15AF40 | calibrado v0.4: sweeperStar spin (-2) | [0, 0, 0] (15), [0, 1, 1] (1), [0, 0, -1] (1) | 0x40B0 |
| BRUSH | 0x15B2E0 | disponible (sin conversor) | [0, 0, 0] (15), [0, 1, 1] (1), [0, 0, -1] (1) | 0x40B0 |
| BRUSH | 0x15AB00 | calibrado v0.4: sweeperStar sweepThree (-3,5) | [0, 0, 0] (18), [2, 0, -1] (1) | 0x40B0 |
| BRUSH | 0x15A560 | NUEVO v0.3.3, aprox: sweeperStar sweepingStart (-2) + sweepingStop: a = pulsos de barrido; d=0 | [12, 1, 1] (1), [6, 1, 1] (1), [4, 1, 0] (1) | 0x40B0 |


Cambio v0.4: PUTILABO es **Pop, Don't Drop** (laboratorio de burbujas) y SOFTCATCH es **Yum-Bot Simulator** (pudines); en la v0.3 estaban al revés en las notas.