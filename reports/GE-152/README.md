# Task report: GE-152

- Agent: Grok
- Task ID: GE-152 — investigación del ABI de menú, selección y guardado para el registro dinámico de niveles
- Base branch and exact SHA: `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9`
  (coordinación: `coordination/v0.6.0` @ `0ca2c9d`, PR #4)
- Working branch and exact head SHA: `grok/dynamic-stage-research`. El head exacto es el commit que añade esta
  versión del archivo (un archivo no puede contener su propio SHA); se anota en el PR. Commit anterior de la
  misma rama: `f851eca752188c25333aac6b078177922e64f2bb`.
- PR URL: https://github.com/angelcraft/Groove-Builder/pull/5 (borrador)
- Status: ready for review (investigación + validación en Unicorn; no hay código de runtime ni hooks en `engine/`)

## Changes

| Archivo | Motivo |
|---|---|
| `reports/GE-152/README.md` | Esta ficha (plantilla `reports/TEMPLATE.md` de la coordinación) |
| `reports/GE-152/dynamic-stage-research.md` | Investigación completa en español: cuadrícula del mapa, identidad, guardado nativo, diseño del registro y del guardado aislado, riesgos, fases (prototipo de 2 casillas primero) y aportación a las decisiones abiertas de `docs/GROOVE_SPEC.md` |
| `reports/GE-152/dynamic-stage-evidence.md` | Anexo: extractos mínimos de desensamblado, tablas, referencias cruzadas y firmas |
| `reports/GE-152/codex-pr5-answers.md` | Respuesta a las 3 preguntas de Codex en PR #5: teardown de los hijos del Runner, persistencia de `plays` con `exit` y frontera anterior a `beginPlay` |
| `reports/GE-152/native-save-isolation.md` | Inventario de escritores del blob, escrituras de una partida `exit` y estrategia F0–F4 para cero escrituras nativas |
| `reports/GE-152/pr6-audit.md` | Auditoría del PR #6 (GE-151 @ `07f78337`), efectos en GE-152, dependencias y propuestas |
| `reports/GE-152/two-slot-prototype.md` | Diseño del prototipo de 2 casillas: despacho, título/prólogo/jingle, formato `.gsv` y plan de verificación |
| `reports/GE-152/inverse-map-fix.md` | Causa de la contaminación del mapa inverso por la IPS, llamadores y efectos, corrección |
| `reports/GE-152/unicorn-validation.md` | Validación en Unicorn pedida en PR #5: aislamiento F0–F4 (27 casos), `curIdx=-1`, teardown del Runner, mapa inverso, dos casillas, instalación parcial y `.gsv` |
| `reports/GE-152/v0-two-slot.md` | V0 de dos casillas Multi en modo 0: 12 casos custom + 5 nativos comparados byte a byte en cada punto de escritura, alcanzabilidad de `0x2E90` y Runner con join real en el modelo |
| `reports/GE-152/CODEX_HANDOFF.md` | Traspaso a Codex: hooks H1–H10 (direcciones, firmas, condiciones, orden, lo que no hay que hacer), barrera del Runner, casos reproducibles y bloqueos |
| `reports/GE-152/unicorn/` | Harness y experimentos (solo direcciones; la imagen se pasa por argumento) y `results/` con diffs por campo |

No se ha modificado `engine/`, `editor/`, `docs/GROOVE_SPEC.md`, `main`, `work/groove-engine-v0.5.0` ni la rama/runtime de Codex.
El borrador inicial que estaba en `docs/research/` (commit `767baaf`) se ha movido aquí y esa carpeta se ha eliminado.

## Evidence

### Revisión estática — REALIZADA
- Fuente: imagen local en memoria de `main` 03FF4A3B (`/workspace/re_main.img`, 20 971 520 bytes, sha256 `6b2f77bfb3111ebb…`).
  Es la misma imagen que usaron las investigaciones previas (GRO-9/GRO-11). No se publica.
  `.text` `0x0–0xA67000`, `.rodata` `0xA67000–0xCD89E8`, `.data` `0xCD9000–0x10A7310` (cabecera NSO de la base
  HoopDX con el mismo build id).
- Herramientas: Python 3.13 + Capstone 5.0.7 (AArch64). El script de apoyo (en local, fuera del repo) busca
  referencias `ADRP+ADD/LDR`, `BL/B` directas y punteros de 64 bits en `.rodata/.data`.
- Resultados clave (todos **[V]** en el documento):
  - `mapCell` `0x1CBCA0`: `grid(0xAE07B8) + w*0x1E0 + c*0x28 + r*8`, sin límites; **37** llamadas `BL` directas.
  - Cuadrícula `3 × 12 × 5` (`0x5A0` bytes): 123 juegos nativos y 57 marcadores `(0,13)`; vista `12 × 5` widgets
    (`view+0x30..0x990`); paneles `line00..line11`; `paintWorld` `0x1CC550` recorre `col < 12`.
  - Mapa inverso `0x1CD4E0` (bucles `w ≤ 2, c ≤ 11, r ≤ 4`, gana la última casilla). Con la IPS v0.3.9,
    `rev(1,41) = (1,9,1)` y `rev(1,67) = (1,9,4)`.
  - Guardado `game_save.bin`: blob de `0x1188` bytes en `mgr(0x10A75F0)+0x548`, versión `0x34`; kind1 de 16 B en
    `+0x5A8` (`state`, `best +4`, `plays +8`, `perfect +0xC`).
  - Flujo `beginPlay 0x48B0` → `setPending 0x4910` (resultados `0x215210`) → `mapEnterFromStage 0x1D38A0` →
    `commitResult 0x1D39D0` → `writeSave 0x3D60`. Explica por qué Multi `(1,67)` escribe el registro del Remix 8.
  - `saveState 0x3F70`: **111** llamadas `BL` directas. Firmas (2 palabras) de 40 funciones en §8.
- Recuentos de llamadas exactos: anexo E20.
- Iteración 3 (estática, **[V]** salvo marcas **[H]**):
  - Los dtors `0x4290F0`/`0x4207F0` no paran ni hacen join de los hijos. `0x1363D0 → 0x5148F0` solo da de baja el
    grupo. El join está en `0x514BC0` (estado 2 → señal → join → 3), al que se llega por el reap `0x515450` (tick de
    la secuencia `0x132DB0`) o por la limpieza `0x515290`.
  - `plays++` (`0x48B0`) y `+0xBB3/+0xBB4` (`launchA`) quedan en el blob en RAM. `writeSave 0x3D60` copia los
    `0x1188` B enteros, y con `exit` además se ejecuta `commitResult` con `rank = 1` (de `initGameplay`).
  - Frontera: F0 `cellState` (declinar), F1 `launchA 0x1D3130`, F2 `0x48B0`, F3 `0x4A30/0x4A70`, F4 `0x3D60`
    (solo detección).
  - Rejilla original: HT2 `(1,1,0)`, Remix 8 `(0,8,4)`. Con la IPS, `0x1CD490` cambia el mundo del Remix 8 de 0 a 1.

### Pruebas en host
Modelo Python del registro fail-closed y del `.gsv` (propuesta) con paquetes sintéticos: `unicorn/registry_model.py`,
`unicorn/exp_c2.py` (9 casos de instalación parcial; independencia de A/B; CRC → `.bak`; id distinto → por defecto).
**No** he ejecutado `tools/run_engine_tests.py` ni los builds de PR #6.

### Build ARM64 — NO REALIZADO
No se ha compilado `subsdk4` ni ningún prototipo.

### Emulación (Unicorn) — REALIZADA (ver `unicorn-validation.md`)
Código real de `main` `03FF4A3B` (imagen sin la IPS) con stubs explícitos del harness. Resumen: F1–F3 → staging
idéntico al blob inicial en todos los casos de modo de mapa 0 (incluida Perfect Campaign); F4 detecta derivas; F0
bloquea sin escrituras; el dtor del stage no hace join (el join se hace en `step/reap/clear`, sin accesos tardíos
al stage); mapa inverso con guard = original. **V0** (`v0-two-slot.md`): 17/17 casos pasan con los hooks H1–H10 del harness. **Contradicciones**: reset del cursor en modo de mapa 1,
`0x2067B0 → 0x2E90` con `curIdx=-1` lee fuera de la tabla, y `sel` persistente tras la confirmación.

### Switch física — NO REALIZADA
Lo único "visto en hardware" que se cita es la validación previa de las casillas HT3/DH/Multi (v0.3.x). No hay
pruebas físicas nuevas en GE-152.

## Compatibility and risks
- Solo documentación: rollback trivial (no fusionar o revertir el commit).
- Revisión de datos propietarios: no hay binarios, romfs, audio, `.spr/.tex/.msbt/.cwv/.bwav`, IPS ni `subsdk4`. Hay
  extractos cortos de desensamblado y tablas de valores (coordenadas de casillas, cadenas de nombres de animación)
  para documentar la interoperabilidad. Si el coordinador prefiere no publicar las tablas del anexo E18/E19, se
  pueden quitar sin que cambien las conclusiones.
- Riesgos técnicos del diseño: §9 del documento (guardado nativo, mapa inverso, `mapCell`, memoria, recursos,
  paginación, evento `0x18AE40`).
- Riesgo ya presente en v0.5.0 (no lo introduce esta tarea): con `results native`, Multi suma partidas al Remix 8 y
  puede escribir su récord, sus medallas y su estado, y la IPS v0.3.9 contamina el mapa inverso.

## Dependencies / blockers
- **GE-151** (Codex, `codex/engine-v0.5.1-hardening`, reclamada en PR #3): endurecimiento de los parsers y contrato de
  validación (se mantiene GTF `start=0` y GTLM `start=2880`). Hace falta antes de aceptar timelines de terceros en el
  prototipo.
- **PR #6 / GE-151**: rotación acotada del guardado propio (hoy tiene un límite de 64 pares `.bak/.tmp`),
  `results: custom` en HT3/hoop y registro en el log cuando `TryLease` falla (ver `pr6-audit.md`).
- **GE-154** (contrato, PR #4): decidir los campos propuestos (`presentation.*`, `results: "custom"` obligatorio,
  nombre de `custom-saves/`) y la política de compatibilidad con `stages/` y la IPS legada.
- **GE-155**: instalación transaccional en `sd:/groove/levels/<id>/` (validador de PC).
- **GE-156** (usuario): pruebas físicas con copia JKSV antes y después.
- Bloqueador técnico abierto: no se ha localizado el handler del stick ni de los gatillos (§8.1.1). No afecta al
  prototipo de 2 casillas.

## Next steps
0. V0 validada en Unicorn (`v0-two-slot.md`). El traspaso a Codex está en `CODEX_HANDOFF.md`. Pendiente: confirmar en ejecución
   que Multi no crea el stage del caso 16, la barrera del Runner con los cuerpos del motor, la captura del mapa activo para H2,
   la parte visual y la revisión de GE-154. **No hay que abrir hardware antes.**
1. Resolver las preguntas de §8.1.
2. Después de revisar GE-154 y GE-151: diseño detallado del prototipo de **2 casillas** `(0,9,0)` y `(0,9,1)`, con
   `adapter: multi` y `results: custom`, como tarea de runtime aparte (sin crear aquí).
3. No se promete capacidad por encima de 2 o 30 casillas hasta tener mediciones (§10, §12).
