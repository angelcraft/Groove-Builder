# Groove Builder — editor GE-153

Actualización Gemini importada bajo editor/. Se conservan los informes previos y
Draft PR #7. Revisión independiente: ../reports/GE-153/UPDATE_02_REVIEW.md.
No ejecuta el motor original de Switch. .groove Draft 0.2 no es un instalador nativo.

## Reproducir

Node 24.22.3, npm 11.19.1, Python 3 y Git:

```sh
git fetch origin codex/engine-v0.5.1-hardening
cd editor
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
```

10 pruebas, tipos y build verificados. La comparación Python no se omite: exige
el commit ff2adc2a186cfc3e1a15ca1957d673cf7f230dc2. El build usa package-lock.json;
bun.lock se conserva como procedencia. dist/ no se publica. El ZIP fuente opcional
solo se ofrece cuando existe su artefacto. No requiere claves Gemini para pruebas.

Verificados en pruebas: ZIP estructural y límites, identidad en ciclos de proyecto,
exportación determinista, paridad de cues/tiempos y reloj de audio simulado.
Pendientes: interfaz y almacenamiento en dispositivo, audio/latencia reales,
funcionamiento offline real y aprobación del contrato por coordinación.
El registro de identidades de sesión no es un registro persistente entre reinicios.
No Actions, APK, Switch, recursos propietarios ni modificación de partidas.
