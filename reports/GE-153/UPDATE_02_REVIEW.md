# GE-153 — revisión independiente de la actualización 0.2

Fecha: 2026-11-27. Rama gemini/visual-editor; se conserva Draft PR #7.
Base remota dea32f2; importación literal b908144. ZIP recibido SHA-256:
`1c2c98632d3064c0457848491ecafaf07fa1481cccb2d43d2d0e5fbbe7a3c809`.
Los documentos recibidos son procedencia, no instrucciones que sustituyan la petición.

## Hallazgos y correcciones

La actualización recibida ya contiene 10 pruebas, perfiles editor/runtime Draft 0.2,
inspección ZIP cruda, UUID de proyecto y scheduler AudioContext. Su prueba diferencial
omitía silenciosamente Python si /tmp/codex_gtf.py no existía. Se elimina esa omisión:
Git extrae obligatoriamente gtf.py y engine_contract.json de
ff2adc2a186cfc3e1a15ca1957d673cf7f230dc2 en un directorio temporal, y se limpia al terminar.
Si falta Git, Python o el commit, la prueba falla.

La comparación real descubrió diferencias corregidas: results predeterminado 0,
swing expresado en ticks, nombres def/call insensibles a mayúsculas, argumentos
parciales rellenados con ceros, rechazo de enteros fuera de rango, end/finish
inválidos y duraciones fraccionarias/decimales no representables exactamente.
Las duraciones usan aritmética BigInt exacta antes de convertirse al rango admitido.

ZIP: se limita el inflado al tamaño declarado además de las cotas globales;
se rechazan regiones locales solapadas; se observan las promesas de escritura y se
cancelan los streams ante errores. Nuevos casos: deflate inválido y cabecera local
embebida/solapada. Esto complementa traversal, duplicados, colisiones de mayúsculas,
symlinks, cifrado, CRC, límites y JSON duplicado; no equivale a certificación universal.

Identidad: pruebas independientes de guardar/importar/renombrar conservan UUID y
versión en perfiles editor y runtime; fork cambia identidad. Registro de colisiones
de la interfaz sigue siendo de sesión: no se afirma persistencia de ese registro
entre reinicios ni prueba de almacenamiento del navegador/dispositivo.

## Resultados reproducidos

Node 24.22.3 / npm 11.19.1. npm test: 10/10, 0 omitidas; typecheck y build: exit 0.
Dentro de las 10 pruebas se comparan 80 cues canónicos, dos ejemplos completos,
swing/def y GTLM, y 11 entradas negativas con Python. Contrato JSON idéntico al pin.
Resultados de comandos en UPDATE_02_RESULTS.json. Dist permanece excluido de Git.
Los tests de AudioContext usan un entorno simulado: no demuestran audio ni latencia
reales. No ejecución Android, navegador físico, motor Horizon o Switch en esta revisión.

## Conservación y límites

COORDINATION_REVIEW.md permanece byte a byte igual (SHA-256
 d3103bc02dbe6c310dc42cacdb066aa3adf8ff334ce273ca45b2308730a08ec6).
Se conservan informes anteriores e IMPORT_VERIFICATION.md; documentos recibidos
previos archivados en archive-import-v1. No se altera GE-151 desde esta rama.
Draft 0.2 sigue pendiente de coordinación: no es formato nativo instalable .groove.
No Actions, despliegue, fusión main, recursos propietarios ni instalación.
