# Groove Engine V0.6 — distribución futura y restauración

BORRADOR. No ejecutar instalación con el estado actual. El único ZIP preparado es
Groove-V0-Custom-Remixes-Validation-20261128.zip: dos .groove sintéticos, fixture de
lector y SHA256SUMS, sin módulo/IPS/marker. SHA-256:
920b5a90b811d24f247ce0a2c05d9cdb192ff1ce114094cb9790f3d9d91e7439.
No copiar loader-fixture sobre una SD real. Installer puede validar ambos paquetes,
pero no debe forzarse un marker ni ignorar ausencia del motor compatible.

Estructura y omisiones exactas: V06_DISTRIBUTION_DRAFT.json. El futuro ZIP tendrá
módulo compilado desde código propio en un slot acreditado, paquetes, instrucciones,
hashes e inventario transaccional de archivos propios. engine.json solo se publicará
tras instalar/verificar capacidades reales; rollback/fallo lo invalida. No se asume
slot libre por ausencia en una copia Android. No incluir main/NPDM/IPS originales ni
recursos Nintendo. No cambiar Orochi, HoopDX o partidas.

## Restauración prevista, tras aprobar un candidato

1. Cerrar el juego y mantener la SD offline respecto al juego durante Installer/recovery.
2. Comprobar inventario y hash del único módulo experimental. Si no coincide o hay un
   archivo ajeno, detenerse; nunca borrar carpetas ExeFS ni sustituir módulos existentes.
3. Desactivar únicamente el archivo propio instalado y el marker correspondiente a esa
   instalación. Conservar el respaldo verificado de cualquier configuración autorizada.
4. Desasignación/recovery de paquetes corresponde a Groove Installer con su mutex
   permanente groove/.installer.mutex. Runtime NO elimina ese mutex; tampoco borrar
   manualmente .installer/lock/journal.json para eludir el gate. Si quedó transacción,
   ejecutar recuperación revisada offline, preservando evidencia y sin purge.
5. Conservar custom-saves, backup, recibos y corrupción. Installer no los modifica.
   No restaurar ni sobrescribir partidas originales como parte de este experimento.
6. Reiniciar el juego y comprobar retorno al mapa nativo. No hay aún prueba física que
   permita declarar validado este procedimiento; la prueba A/B exacta se adjuntará al
   candidato aprobado y usará una sola sesión dirigida, con logs anonimizados.

## Datos privados necesarios para el harness, sin subirlos al repositorio

- /workspace/private/groove/main.img: imagen de memoria descomprimida de main que espera
  el harness GE-152, Build ID completo 03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8.
  No sirve renombrar un NSO a .img. Debe incluir el layout RO/RW que usa el harness.
- /workspace/private/groove/emu_v050/: harness que carga el ELF propio y los cuerpos
  reales del módulo/Stage; o ruta equivalente indicada explícitamente por su dueño.
- /workspace/private/groove/sdk.nso: SDK original del mismo juego cuando se requieran
  cuerpos SDK. No usarlo para simular éxitos Horizon: un SVC no ejecutado queda pendiente.
- ELF propio compilado: /workspace/engine-v0-bound-verified/build/GrooveHT3.nss.

No se solicitan capturas GDB ni repetir carga. Estas rutas son una propuesta local de
entrega al entorno privado; sus archivos actualmente NO existen aquí. No publicar los
archivos en GitHub, logs privados o backups. El dueño puede ejecutar las pruebas en su
entorno y devolver solo resultados sanitizados y referencias de código propio.

## B2: qué sigue sin poder integrarse

Revisión GE-154 7240789328: frontera candidata destroyPending 0x5096F0, identidad
Seq/Stage/token y LR acreditados; éxito solo tras quiescencia, fallo no retorna a
teardown. No se salta un destructor. Una incoherencia no se clasifica como llamada
ajena por defecto. Al volver a consultar origin/grok/stage-owner sigue en d2cc779,
rev2. Se necesita rev3 que corrija budget exhaustion → false done de sched.py y sus
controles antes de aceptar resultados; luego pasar el harness con worker GE-151 real.
No se activa B2 ni se declara cerrado por ejecutar únicamente un modelo cooperativo.
