# Task report: GE-152

- Agent: Grok
- Task ID: GE-152 — investigación del ABI de menú, selección y guardado para el registro dinámico de niveles
- Base branch and exact SHA: `work/groove-engine-v0.5.0` @ `61873906f016d46ac1d47d7a5016ec6e3fe93fa9`
  (coordinación: `coordination/v0.6.0` @ `0ca2c9d`, PR #4)
- Working branch and exact head SHA: `grok/dynamic-stage-research`. El head exacto es el commit que añade este
  archivo (un archivo no puede contener su propio SHA) y figura en la descripción del PR. Commit anterior de la
  misma rama: `767baaf5d249cfdc3e7aed1301311f545b2bf061`.
- PR URL: pendiente (PR en borrador contra `work/groove-engine-v0.5.0`; se anota en la descripción al abrirlo)
- Status: ready for review (solo investigación; no hay código de runtime)

## Changes

| Archivo | Motivo |
|---|---|
| `reports/GE-152/README.md` | Esta ficha (plantilla `reports/TEMPLATE.md` de la coordinación) |
| `reports/GE-152/dynamic-stage-research.md` | Investigación completa en español: cuadrícula del mapa, identidad, guardado nativo, diseño del registro y del guardado aislado, riesgos, fases (prototipo de 2 casillas primero) y aportación a las decisiones abiertas de `docs/GROOVE_SPEC.md` |
| `reports/GE-152/dynamic-stage-evidence.md` | Anexo: extractos mínimos de desensamblado, tablas, referencias cruzadas y firmas |

No se ha modificado `engine/`, `editor/`, `docs/GROOVE_SPEC.md`, `main` ni `work/groove-engine-v0.5.0`.
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

### Pruebas en host — NO REALIZADAS
No se ha escrito ni ejecutado código de host (no hay prototipo del registro ni del parser de `manifest.json`).

### Build ARM64 — NO REALIZADO
No se ha compilado `subsdk4` ni ningún prototipo.

### Emulación (Unicorn) — NO REALIZADA en GE-152
Las referencias a Unicorn del documento citan pruebas **anteriores** de v0.4.0/v0.5.0 (85/85 y 108/108, de otra
tarea). En §10 (fase 0) se proponen pruebas nuevas, que no se han ejecutado.

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
- **GE-154** (contrato, PR #4): decidir los campos propuestos (`presentation.*`, `results: "custom"` obligatorio,
  nombre de `custom-saves/`) y la política de compatibilidad con `stages/` y la IPS legada.
- **GE-155**: instalación transaccional en `sd:/groove/levels/<id>/` (validador de PC).
- **GE-156** (usuario): pruebas físicas con copia JKSV antes y después.
- Bloqueador técnico abierto: no se ha localizado el handler del stick ni de los gatillos (§8.1.1). No afecta al
  prototipo de 2 casillas.

## Next steps
1. Fase 0 (GE-152): pruebas en Unicorn de la reimplementación de `mapCell` (180 coords), `buildReverseMap` con
   `gInReverseBuild` y diferencia del blob de guardado en una partida `exit`. Resolver las preguntas de §8.1.
2. Después de revisar GE-154 y GE-151: diseño detallado del prototipo de **2 casillas** `(0,9,0)` y `(0,9,1)`, con
   `adapter: multi` y `results: custom`, como tarea de runtime aparte (sin crear aquí).
3. No se promete capacidad por encima de 2 o 30 casillas hasta tener mediciones (§10, §12).
