# Groove Builder — importación GE-153

Fuentes recibidas de Gemini, importadas bajo `editor/`. Revisión de coordinación:
[COORDINATION_REVIEW.md](../reports/GE-153/COORDINATION_REVIEW.md), conservada sin cambios.
No se implementa el motor original de Switch en el navegador y los paquetes
`.groove` siguen siendo un borrador, no paquetes instalables certificados.

## Ejecutar y reproducir

Probado con Node 24.22.3 y npm 11.19.1:

```sh
cd editor
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
# Desarrollo opcional: npm run dev
```

`npm test` ejecuta directamente los ocho casos node:test con el cargador tsx.
En este entorno `node --test` con el cargador solo notificaba un archivo;
la invocación directa permite acreditar los ocho casos individuales y sus fallos.
No se modificaron las pruebas para obtener el resultado.

Se conserva el `bun.lock` original como procedencia. El build verificado de esta
importación utiliza **package-lock.json + npm ci**, no el lock de Bun, que sigue
reflejando las dependencias originales. Cambio mínimo de dependencia: esbuild
^0.25.0 → ^0.28.2, compatible con el peer requerido por Vite 8; sin --force ni
--legacy-peer-deps. Se añadieron scripts test/typecheck. No requiere claves de
Gemini para estas verificaciones; .env.example contiene solo placeholders.

El build genera dist/, excluido de Git. No se incluye un ZIP fuente recursivo;
el botón de descarga de fuentes notificará que falta ese artefacto. Los iconos
PWA son los recibidos en el ZIP, no recursos originales del juego.

## Pendientes de revisión, no resueltos por compilar

- Schema estricto de manifest, capabilities/adapter/engine_min y timeline única.
- Inspección ZIP anterior a normalización; duplicados, directorios, symlinks,
  cifrado y límites durante descompresión. La prueba actual de traversal no
  acredita todo ese conjunto. No importar archivos ZIP/RHRE no confiables.
- Identidad persistente de proyecto, colisiones y renombrado.
- Exportación determinista, timestamps y límites de cada miembro.
- Reloj/scheduling de audio: RAF/performance.now no prueba precisión por muestra.
- Generación del contrato y paridad diferencial completa con Python/C++.
- Validación de interfaz en navegador/Android, audio real y funcionamiento offline.

Se mantienen los warnings de Vite sobre __dirname y los avisos de deprecación de
dependencias glob/node-domexception. No se ejecutó una actualización masiva.
Sin Actions, despliegue, APK, instalación Switch ni cambios a GE-151.
