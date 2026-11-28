# Interfaz gráfica para Windows (GE-155, BORRADOR)

Capa fina en **tkinter** (incluido en el instalador oficial de Python para Windows) sobre el núcleo
`tools/groove_package/`. La lógica legible está en `controller.py` (sin imports de GUI); `app.py` es solo la vista.
El núcleo no importa tkinter ni nada de Windows, así que una app Android (Chaquopy) lo usa tal cual.

## Uso
1. Saca la microSD de la Switch y conéctala al PC (la instalación es **sin conexión**). Haz copia de tu partida con JKSV.
2. Doble clic en `tools/GrooveInstaller.pyw` (o `py -3 tools\GrooveInstaller.pyw`).
3. «Examinar...» → elige el `.groove` (se valida al instante, con errores en español y el código técnico).
4. «Examinar...» de la SD → la raíz de la tarjeta (p. ej. `E:\`). «Estado» muestra motor, casillas y niveles.
5. Elige casilla (Automática / A / B / Sin casilla) → «Instalar».
6. En la lista: «Poner en A/B», «Quitar de la casilla», «Desinstalar...» (el guardado se conserva siempre).
7. «Recuperar» si una operación se interrumpió (cierre, SD extraída...).

Sin `sd:/groove/engine.json` (publicado por GE-151 junto con un motor con cargador) **no se puede instalar**: la v0.5.x no lee `levels/`.

## Ejecutable (opcional, no incluido)
Hay que construirlo en Windows. En `GrooveInstaller.spec` están los comandos de PyInstaller; el `.exe` no se sube al repositorio.

## Estado de las pruebas
Solo se ha probado en Linux con Xvfb (Python 3.9.25 + Tk 8.6): `tests/package/test_gui.py`. **No se ha ejecutado en Windows real.**
