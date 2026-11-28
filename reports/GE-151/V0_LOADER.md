# GE-151 — lector nativo V0, incremento desde ed50f3b

Revisión seguida: PR #6, 7239745290. Decisiones 3642b7e y corpus GE-155
fijado d3c971f3862bb6c16cfccd4009bcfb25e37319b6. Sin cambios al dispatcher ARM64
ni hooks nuevos. Implementación propia C++, sin parser JSON externo ni ZIP nativo.

## Código ejecutable añadido

engine/src/v0_loader.{hpp,cpp}: lector dirigido por esquema, sin heap JSON;
claves exactas y duplicados incluidos nombres escapados; UTF-8/escapes Unicode,
enteros estrictos, tamaños y profundidad limitada por las estructuras del esquema.
Registro groove-slots/1 de 2..256 entradas, A/B [0,9,0]/[0,9,1], resto null;
IDs únicos/reverse-DNS y dispositivos DOS rechazados. Se valida el registro completo,
pero solo se cargan los dos paquetes mapeados. No modifica arrays/selectores nativos.

Manifest runtime/Multi/contract 1, versión y engine_min, título, capacidades y ruta
exacta timeline.gtf o timeline.gtl. Timeline compilada por parsers nativos existentes;
start y results exit explícitos/únicos, sin match/force/disable. Copia exacta de
manifest/timeline, ID/version/título por paquete; no punteros prestados de SD.
El snapshot NO está conectado aún a SessionState/constructor: no afirmar que la
identidad/version/files de la sesión real ya se hayan integrado.

Loader comprueba lock/journal antes y después, relee registro byte a byte,
rechaza retroceso de generación, cambio de asignación sin generación y reducción
silenciosa de capacidad, incluso después de un intento fallido. No presupone que
el número de generación autentique archivos. El instalador debe seguir offline.
Los ficheros extra del directorio NO se enumeran aquí: solo se leen los dos miembros
permitidos por manifiesto; validación del conjunto instalado corresponde al adaptador
futuro/instalador. No se anuncia paridad del contenedor ZIP.

main.cpp: groove_v0_load_sd_levels, entrada retenida pero desconectada, usa FsApi
ya montada (no ensureFs/creación/montaje desde esta entrada). Resuelve GetEntryType
por nombre, comprueba componentes/directorios/fichero y tamaño antes/después;
PathNotFound 0x202 se distingue de otros errores, que bloquean. Retorna sin tocar SD
si falta montaje/símbolo, hay lease ocupado, sesión custom o etapa legacy activa.
No se ejecuta desde hkMain ni de forma automática. No se ha probado nn::fs ni ese
símbolo en Horizon. Requiere una fase serializada acreditada antes de invocarla en vivo;
los checks actuales no sustituyen esa prueba. No genera engine.json ni habilita slots.

## Correcciones de revisión

Contención: MapCell custom devuelve casilla vacía, nunca null inventado; navegación
ajena delega. WriteSave global sigue llamando al original aunque el lease esté ocupado.
El retorno original se conserva si falla el lease post; los fallos se registran.
Esto NO resuelve todavía la finalización post de confirm/reverseDepth/bits bajo
contención real: falta frontera serializada/estrategia de finalización antes del binding.

Cursor ya no se consume antes de escribir. Backend requiere writeCursor validada y
all-or-none; en fallo conserva valores originales y cursor para retry. No hay proveedor
nativo aprobado de ese callback. Al volver al mapa, persistencia pendiente no suprime
beginPlay/campaña/initGameplay/commit de la siguiente sesión nativa. El detector del
blob caduca antes de esa siguiente sesión. No equivale a prueba de aislamiento físico.

## Pruebas reproducidas

python3 tools/run_engine_tests.py: 18 métodos Python, 19 casos GTF, cinco binarios
ASan/UBSan pasan. Lector: 10000 mutaciones/truncamientos con salida protegida, límite
256 y enteros estrictos; tres paquetes positivos y 64 rechazos manifest/timeline de
GE-155, con cpp real bajo UBSan. Se omiten ataques exclusivos del ZIP porque este
lector recibe directorios extraídos. Suite opcional multi_prueba.gtl ausente.

Build completo mediante tools/build_engine.py con toolchain/pins previos: exit 0.
tools/check_v0_arm64.py ejecuta ELF final: dispatcher original y además parseRegistry
real (registro válido y duplicados). Memoria/originales sintéticos, sin main/SDK privado.
Auditor ELF/NSO: exit 0, 665 RELATIVE, ningún import ELF sin resolver, payloads idénticos.
JSON de resultados y hashes: V0_LOADER_RESULTS.json. No binarios publicados.
Auditor de pila ahora deriva unidades C++ del manifiesto (incluye ambos v0_*.cpp).
V0_LOADER_STACK.json: objetos diagnósticos sin LTO, no cota del enlace ni del juego.
Ejemplos locales: Loader::load 544, parseRegistry 576, v0Read 272 bytes. 688 bytes
observados por Unicorn son el máximo de ese recorrido sintético, NO cota transitiva.

## Frontera que impide el candidato

No constructor Multi conectado ni barrera Runner instalada. El traspaso rev2 describe
cancel/signal/join, pero no aporta una frontera nativa de retención del propietario
que también impida su free si la quiescencia falla, ni exclusión del append tardío.
No implementar un hook de dtor que simplemente omita orig y deje al llamador liberar
el Stage. También faltan cuerpo real del módulo en el harness privado, scheduler
Horizon, pila indirecta, ABI/instrucciones/IPS y visualización aceptados.

Persistencia H9 sigue como intención/ack en RAM, sin adaptador durable ni formato
.gsv aprobado. No se publica engine.json: versión/capacidades no pueden certificar
un loader enlazado a gameplay que aún no existe. No instalador, distribución ni
prueba Switch. La próxima conexión requiere entregar el snapshot al constructor y
retenerlo hasta un join acreditado; antes resolver los post del lease y tokens de
trabajador para rechazar callbacks de otra generación, con el main/harness privados.
No se solicitan capturas generales ni se simula éxito de servicios desconocidos.

Para reproducir el corpus desde un clon superficial, recuperar primero su commit:
`git fetch origin grok/groove-package-validator`. La prueba exige el pin d3c971f,
no descarga ni cambia referencias automáticamente y falla si falta ese objeto.
