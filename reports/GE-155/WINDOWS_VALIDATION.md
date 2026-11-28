# GE-155 — Validación en Windows con una SD simulada (BORRADOR)

Objetivo: comprobar en tu portátil Windows (Lenovo IdeaPad 5 2-in-1) el instalador `.groove`
—CLI, GUI y ejecutables— **sin la Switch y sin la microSD real**. Todo se hace sobre una carpeta que imita
una SD con archivos de relleno inventados y los dos niveles sintéticos del repositorio. No se usa ningún
archivo del juego.

> **Antes de nada: haz una copia de tu partida con JKSV** (Switch → JKSV → Rhythm Paradise Groove →
> «Backup») y copia la carpeta `JKSV/` de la microSD a tu PC. Este procedimiento no toca la SD real,
> pero la copia es obligatoria antes de cualquier prueba posterior con la consola.

**No conectes la microSD real durante estas pruebas.** `groove_sd_sim.py` se niega a trabajar en una
carpeta que no esté vacía, precisamente para no poder tocar una SD de verdad. La instalación en hardware
sigue bloqueada hasta revisar los bloqueos pendientes (GE-151 aún no publica `engine.json` con cargador).

## Estado: ya validado en CI de Windows
Run https://github.com/angelcraft/Groove-Builder/actions/runs/46152652111 (commit `1ba1d13`): 94 pruebas OK en
Windows Server 2025 con Python 3.9 y 3.13 (incluye el lock `msvcrt` con 4 procesos reales), SD simulada 7/7 y
8/8 con `GrooveInstall.exe` congelado. Esta guía sirve para repetirlo en tu portátil. Sin cubrir aún en
Windows: junctions, uso interactivo de la GUI, FAT32/exFAT y SD/Switch reales.

## 0. Requisitos
- Windows 10/11, **Python 3.9 o superior de python.org** (marca «Add python.exe to PATH» y deja «tcl/tk»
  activado). Comprueba con `py -3 --version`.
- El código de la rama `grok/groove-package-validator` (PR #8): `git clone` + `git checkout`, o
  «Download ZIP» de la rama en GitHub y descomprimir, p. ej. en `C:\gb`.
- Opcional: un pendrive USB **vacío** formateado en FAT32 o exFAT, para probar sobre el mismo tipo de
  sistema de archivos que la microSD.

Abre PowerShell en la carpeta del repositorio (`cd C:\gb`).

## 1. Pruebas unitarias
```powershell
py -3 -m pip install jsonschema        # opcional: activa la prueba de paridad del esquema
py -3 tests\package\run_all.py reports-local-tests.json
```
Esperado: la última línea del JSON dice `"ok": true`, `failures: 0`, `errors: 0`. En Windows se ejecutan de
verdad el lock `msvcrt` (incluida la carrera release/reacquire entre 3 procesos) y la detección de junctions.
Los tests de symlinks POSIX se saltan en Windows (normal).

## 2. SD simulada automática (código fuente)
```powershell
py -3 tools\groove_sd_sim.py --report sim-report.json
```
Crea una SD falsa en `%TEMP%` y ejecuta estos escenarios. Esperado: `ALL PASSED: 7/7 scenarios`.

| Escenario | Qué comprueba |
|---|---|
| lifecycle | instalar A (casilla A) y B (casilla B), actualizar A 1.0.0→1.1.0, downgrade rechazado, quitar/poner casilla, desinstalar B conservando su `.gsv` |
| assign-revalidation | nivel instalado editado → `INSTALLED_INVALID`; motor sin `timeline.gtl` → rechazado; contrato 2 → rechazado; capacidad futura desconocida → aceptada |
| crash-every-step+recover | «corte de luz» en cada paso de una actualización; la barrera (lock/diario) queda cerrada; `recover` deja la SD exactamente antes o después |
| io-error-every-step | error de E/S en cada paso: si se informa error, la SD queda como estaba |
| lock-contention | otro proceso tiene el lock: las 5 operaciones devuelven `LOCKED` y no cambia nada; al soltarlo, funciona |
| lock-release-reacquire-race | 3 procesos × 100 ciclos de lock: exclusión mutua y nunca se borra el lock de otro |
| marker-withdrawn+recovery-evidence | sin `engine.json`: `recover`, `unassign` y `uninstall` funcionan; `install`/`assign` rechazados; evidencia en `groove/backups/recovery-<tx>/` |

En todos se verifica que `groove/custom-saves/` y los archivos ajenos (atmosphere, JKSV, switch…) quedan
idénticos byte a byte.

### 2b. Sobre FAT32/exFAT (opcional, recomendado)
Con el pendrive vacío en, por ejemplo, `F:`:
```powershell
py -3 tools\groove_sd_sim.py --sd F:\groove-sim --report sim-fat.json
```
(La carpeta `F:\groove-sim` debe no existir o estar vacía; se borra al terminar salvo con `--keep`.)

## 3. Construir los ejecutables
Oficialmente los construye el job `windows-exe` del workflow manual de GitHub (solo se lanza con tu
autorización). Para construirlos tú mismo:
```powershell
powershell -ExecutionPolicy Bypass -File tools\windows\build_windows.ps1
```
El script crea `build-out\venv`, instala PyInstaller fijado (`tools/windows/requirements-build.txt`),
ejecuta las pruebas, genera `build-out\dist\GrooveInstaller.exe` (GUI) y `build-out\dist\GrooveInstall.exe`
(CLI), pasa la SD simulada **también contra la CLI congelada** y guarda `build-out\SHA256SUMS.txt`.
Esperado al final: `ALL PASSED: 8/8 scenarios` y `OK: ...`. `build-out\` está en `.gitignore`: **no subas los
`.exe` al repositorio**. Windows SmartScreen puede avisar porque el `.exe` no está firmado («Más información →
Ejecutar de todas formas»).

Si descargas el artefacto de GitHub en vez de construirlo, comprueba el hash:
`Get-FileHash .\GrooveInstaller.exe -Algorithm SHA256` y compáralo con `SHA256SUMS.txt`, y valida la CLI:
```powershell
py -3 tools\groove_sd_sim.py --cli C:\ruta\GrooveInstall.exe
```

## 4. Prueba manual de la GUI sobre una SD simulada
1. Crea la SD falsa: `py -3 tools\groove_sd_sim.py --make-only C:\sim-sd`
   (los paquetes de prueba están en `tests\package\fixtures\valid\`).
2. Abre `build-out\dist\GrooveInstaller.exe` (o `py -3 tools\GrooveInstaller.pyw`).
3. Paquete → `synthetic-a-1.0.0.groove`: debe validar («Synthetic Pulse A»).
4. SD → `C:\sim-sd` → «Estado»: motor 0.6.0, casillas A y B vacías, sin problemas.
5. Casilla «Automática» → «Instalar»: A queda en la casilla A. Repite con `synthetic-b-1.0.0.groove`: casilla B.
6. Instala `synthetic-a-1.1.0.groove`: «upgrade», sigue en la casilla A. Intenta `synthetic-a-1.0.0.groove`: rechazado (no downgrade).
7. «Quitar de la casilla» con B, luego «Poner en B»: vuelve a la casilla B.
8. Edita a mano `C:\sim-sd\groove\levels\<id de B>\timeline.gtl` (añade una línea `basura` al principio),
   quita B de su casilla e intenta «Poner en B»: debe rechazarse («El nivel instalado en la SD ya no es
   válido…»). Para arreglarlo, desinstala B y vuelve a instalar `synthetic-b-1.0.0.groove` (reinstalar
   encima daría `VERSION_CONFLICT`, porque el contenido instalado ya no coincide).
9. Contención del lock: con la GUI abierta, en PowerShell ejecuta
   `py -3 -c "import sys; sys.path.insert(0,'tools'); from groove_package.lock import InstallerLock; l=InstallerLock(r'C:\sim-sd\groove\.installer\lock', r'C:\sim-sd\groove\.installer.mutex').acquire(); input('pulsa Enter para soltar')"`
   y, mientras espera, pulsa «Instalar» en la GUI: debe decir que otro instalador está usando la SD. Pulsa
   Enter en PowerShell y repite: ahora funciona y `groove\.installer\` queda vacío (el archivo permanente
   `groove\.installer.mutex` se queda: es normal y el motor debe ignorarlo).
10. «Desinstalar...» A y B. Comprueba que `C:\sim-sd\groove\custom-saves\` sigue con sus 4 archivos y que
    `atmosphere\`, `JKSV\` y `switch\` no han cambiado.
11. Cierra la GUI a mitad de una instalación no es reproducible a mano de forma fiable; los cortes los cubre
    el escenario automático `crash-every-step+recover`. Si alguna vez ves «Hay una operación interrumpida»,
    pulsa «Recuperar».

## 5. Qué enviar de vuelta
`reports-local-tests.json`, `sim-report.json` (y `sim-fat.json` / `build-out\sd-sim-report.json` si los
hiciste), la versión de Windows (`winver`) y capturas de cualquier error de la GUI. Con eso se puede marcar
el lock `msvcrt`, las junctions y la GUI como probados en Windows real.

## Límites
- Es una SD **simulada**: no prueba el cargador del motor ni el juego (eso es GE-151 y requiere hardware,
  bloqueado hasta revisar).
- Las pruebas de cortes usan inyección de fallos en el proceso; no demuestran durabilidad física de FAT/exFAT.
- El diario detecta incoherencias, no autentica; el instalador supone que nadie más escribe en la SD
  mientras trabaja.
