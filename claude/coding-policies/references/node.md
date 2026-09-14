---
stack: node
name: Node.js
version: 2026-09-14
---

### Alcance y versiones

- **MUST** Antes de editar, identificar la versión de Node de producción, si el proceso es servicio, worker, CLI o función administrada, el gestor y lockfile, los scripts y el supervisor. Porqué: lifecycle, APIs disponibles y señales operativas dependen del runtime y del dueño real del proceso. Gate: —
- **SHOULD** Usar una rama Active LTS o Maintenance LTS en producción y revalidar su estado al actualizar, sin convertir una versión concreta en recomendación eterna. Porqué: soporte y seguridad cambian con el calendario oficial de releases. Gate: `node --version` más tabla oficial de releases
- **MUST** Conservar el gestor y lockfile del proyecto; con npm usar `npm ci` en automatización y el mecanismo equivalente si el repo eligió otro gestor. Porqué: una instalación reproducible debe fallar ante drift en vez de reescribir dependencias silenciosamente. Gate: `npm ci` o comando congelado del gestor declarado
- **MUST** No cambiar versión de Node, gestor, módulos ni dependencias como efecto incidental de una corrección acotada. Porqué: esas migraciones alteran resolución, artefactos y despliegue más allá del comportamiento pedido. Gate: `git diff -- package.json '*lock*' '.nvmrc' '.node-version'`

### Event loop y CPU

- **MUST** Mantener acotado el trabajo síncrono por request o tarea y evitar APIs sync costosas dentro de handlers. Porqué: un callback que bloquea el event loop retrasa a todos los clientes del proceso. Gate: `profiling bajo una carga representativa`
- **MUST** Limitar tamaño y complejidad de entradas antes de parsear, recorrer o aplicar expresiones regulares potencialmente patológicas. Porqué: una entrada no confiable puede monopolizar CPU o memoria aunque la operación parezca pequeña en casos normales. Gate: `tests de límites y timeout bajo entradas adversas`
- **MUST** No asumir que declarar una función `async` vuelve paralelo el cálculo síncrono que ejecuta. Porqué: el JavaScript CPU-bound sigue corriendo en el mismo event loop hasta que cede. Gate: `profiler de CPU y event-loop delay`
- **SHOULD** Para CPU intensiva, evaluar partición o un pool reutilizado de workers con límites; no crear un worker por operación ni usarlos como solución habitual para I/O asíncrono. Porqué: startup, clonación y coordinación tienen costo, mientras Node ya delega gran parte del I/O. Gate: `benchmark antes/después y prueba de saturación del pool`

### Timeouts y cancelación

- **MUST** Definir plazos para operaciones externas y usar `AbortSignal` cuando la API soporte cancelación, combinando timeout y señal del caller con `AbortSignal.any` cuando corresponda. Porqué: sin deadline o propagación una dependencia colgada retiene memoria, sockets y capacidad de concurrencia indefinidamente. Gate: tests de timeout con `AbortSignal.timeout()` o mecanismo equivalente
- **MUST** Propagar la señal hasta el consumidor real y comprobar que éste la utilice. Porqué: aceptar un parámetro sin conectarlo a la operación crea una cancelación aparente que no libera trabajo. Gate: `test que observe aborto en la dependencia`
- **MUST** No presentar `Promise.race` con un timer como cancelación de la promesa perdedora. Porqué: el caller puede recibir timeout mientras la operación real continúa consumiendo recursos y produciendo efectos. Gate: `test de cleanup posterior al timeout`
- **MUST** Definir límites de concurrencia según el servicio y manejar el rechazo de toda tarea iniciada. Porqué: fan-out sin tope satura la dependencia y una promesa huérfana convierte el fallo en rechazo no observado. Gate: `tests de concurrencia máxima y fallo parcial`

### Streams y backpressure

- **SHOULD** Usar streams cuando el volumen vuelva riesgoso cargar el payload completo en memoria. Porqué: procesar por chunks acota memoria y permite empezar antes, siempre que se respete backpressure. Gate: `prueba con payload mayor al límite operativo esperado`
- **MUST** Respetar backpressure y preferir `pipeline` para coordinar errores y finalización entre streams. Porqué: ignorar el valor de `write` o encadenar eventos a mano puede acumular memoria y perder fallos. Gate: `node:stream/promises` (`pipeline`) o test equivalente de backpressure
- **MUST** Propagar `AbortSignal` cuando una transferencia deba cancelarse y cerrar los recursos asociados. Porqué: cortar solo la espera del caller deja la fuente, destino o socket activos. Gate: `test de aborto y cierre de handles`
- **MUST** Revisar qué respuesta queda posible después de fallar un pipeline HTTP. Porqué: `pipeline` puede destruir streams y cerrar el socket, por lo que ya no siempre se puede enviar un JSON de error. Gate: `test de fallo durante transmisión sobre el servidor real`

### Errores

- **MUST** Manejar rechazos y eventos `error` según el contrato específico de la API usada. Porqué: Promises, EventEmitters, callbacks y streams propagan fallos por canales distintos. Gate: `tests de cada camino de error observable`
- **MUST** Para errores de Node, decidir por códigos documentados y no por texto de `message`. Porqué: el mensaje puede cambiar entre versiones, plataformas o locale sin alterar la condición. Gate: revisión de comparaciones contra `error.code`
- **SHOULD** Envolver con `cause` al agregar contexto útil y conservar el error original. Porqué: el caller necesita tanto la operación que falló como la causa para clasificar y diagnosticar. Gate: tests de `error.cause`
- **MUST** Distinguir errores esperables de una operación de fallos que invalidan el estado del proceso. Porqué: reintentar un input inválido y continuar después de corrupción requieren decisiones opuestas. Gate: `tabla o tests de clasificación en la frontera`

### Lifecycle

- **MUST** En servicios cuyo ciclo controla la aplicación, detener nuevas conexiones, esperar trabajo en curso con un plazo y cerrar recursos durante shutdown. Porqué: terminar abruptamente pierde requests y un cierre sin deadline puede no acabar nunca. Gate: `test de señal y shutdown con trabajo en vuelo`
- **MUST** No instalar handlers de proceso indiscriminadamente cuando un framework o plataforma serverless sea dueño del lifecycle. Porqué: competir con el host puede duplicar cleanup, impedir suspensión o cortar invocaciones ajenas. Gate: `documentación del runtime y prueba de integración`
- **MUST** No continuar operando normalmente después de `uncaughtException`; realizar solo la limpieza segura necesaria y dejar que supervisión externa reinicie. Porqué: el proceso puede haber quedado en un estado inconsistente que no se puede reparar genéricamente. Gate: `test aislado de proceso hijo y configuración del supervisor`
- **MUST** No usar `process.exit()` durante el cierre normal antes de drenar trabajo y salida pendientes. Porqué: fuerza la terminación y puede truncar logs, respuestas o escrituras. Gate: `test de proceso hijo que verifica salida y cleanup`

### Seguridad

- **MUST** Configurar límites y timeouts de HTTP, bodies y operaciones acordes al contrato del servicio. Porqué: Node no limita automáticamente todo el trabajo que ejecutan parsers y handlers sobre entradas no confiables. Gate: `tests de payload excedido, request lento y timeout`
- **MUST** No fusionar JSON externo indiscriminadamente en objetos de configuración o prototipos compartidos. Porqué: claves controladas por el cliente pueden sobrescribir política interna o habilitar prototype pollution. Gate: `tests con claves peligrosas y análisis de seguridad del repo`
- **MUST** Conservar lockfiles, revisar dependencias y ejecutar la comprobación de vulnerabilidades adoptada por el proyecto. Porqué: cada paquete amplía la cadena de suministro y requiere una versión reproducible para investigar hallazgos. Gate: `npm audit` o scanner configurado en CI
- **MUST** No exponer errores internos, secretos ni detalles de sockets al cliente; mapear una respuesta pública estable en la frontera. Porqué: los diagnósticos operativos contienen datos que no forman parte del contrato externo. Gate: `tests de respuestas de error y revisión de logs`

### Contexto y testing

- **SHOULD** Reutilizar la solución de observabilidad existente; si hace falta contexto por request, usar `AsyncLocalStorage` en vez de una variable global mutable. Porqué: las operaciones concurrentes no pueden compartir de forma segura una única identidad actual. Gate: `test con requests intercaladas`
- **SHOULD** Preferir `AsyncLocalStorage.run` a `enterWith` salvo una razón concreta y acotar el store a los datos necesarios. Porqué: `run` delimita mejor el lifetime y reduce contaminación entre callbacks. Gate: `tests de propagación y aislamiento de contexto`
- **MUST** Usar el runner ya adoptado, esperar operaciones y subtests, liberar recursos y restaurar mocks. Porqué: handles abiertos y trabajo no esperado producen flakes o falsos verdes después de que el test termina. Gate: `runner del repo con detección de handles o cleanup`
- **MUST** Verificar resultados y errores observables, especialmente cancelación, concurrencia y autorización cuando cambien. Porqué: testear detalles internos no demuestra el contrato del proceso ante fallos reales. Gate: `tests de integración en límites del sistema`

### Verificación

- **MUST** Ejecutar lint, typecheck si aplica, tests y build o packaging mediante los scripts del repo. Porqué: el runtime puede ejecutar código que todavía incumple tipos, estilo o forma de despliegue. Gate: scripts de CI declarados en `package.json`
- **SHOULD** Medir event-loop delay, CPU y memoria bajo una carga representativa cuando el cambio afecte rendimiento o concurrencia. Porqué: un microbenchmark aislado no muestra saturación ni interacción entre requests. Gate: `profiler y prueba de carga del proyecto`
- **MUST** Informar la versión de Node usada, los comandos ejecutados y cualquier lifecycle o carga que quedó sin verificar. Porqué: resultados de una rama o modo local no prueban automáticamente el runtime de producción. Gate: `reporte final` con versión, comando y resultado

### Lectura ampliada

- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — calendario de soporte y ramas LTS.
- [npm: `npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci/) — instalación reproducible desde lockfile.
- [Node.js: Don't Block the Event Loop](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop) — trabajo acotado, CPU y entradas adversas.
- [Node.js: Worker threads](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) — paralelismo CPU y pools.
- [Node.js: AbortController and AbortSignal](https://nodejs.org/docs/latest-v24.x/api/globals.html#class-abortcontroller) — cancelación y composición de señales.
- [Node.js: Streams](https://nodejs.org/docs/latest-v24.x/api/stream.html) — backpressure, pipeline y abort.
- [Node.js: Errors](https://nodejs.org/docs/latest-v24.x/api/errors.html) — códigos, propagación y `cause`.
- [Node.js: Process](https://nodejs.org/docs/latest-v24.x/api/process.html) — señales, excepciones fatales y terminación.
- [Node.js: HTTP server close](https://nodejs.org/docs/latest-v24.x/api/http.html#serverclosecallback) — cierre de conexiones.
- [Node.js Security Best Practices](https://nodejs.org/learn/getting-started/security-best-practices) — límites, dependencias y entradas no confiables.
- [Node.js: AsyncLocalStorage](https://nodejs.org/docs/latest-v24.x/api/async_context.html) — contexto por operación asíncrona.
- [Node.js: Test runner](https://nodejs.org/docs/latest-v24.x/api/test.html) — subtests, mocks y cleanup.
