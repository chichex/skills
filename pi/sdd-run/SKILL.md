---
name: sdd-run
description: Ejecuta una spec SDD de punta a punta — planifica contra el código real, implementa con tests primero, verifica cada criterio de aceptación con el mecanismo que la spec declara, y termina en un PR con la spec como body y la evidencia de verificación. El "terminado" lo define la spec, no la sensación. Usar SIEMPRE que el usuario quiera implementar una spec de .sdd/specs/, ejecutar/correr una spec, implementar un issue que ya tiene spec SDD, o diga "corre la spec de X", "implementa esto que ya especificamos", "dale para adelante con la spec". Exige spec (/skill:sdd-spec) y contrato (/skill:sdd-init); si faltan, hay que generarlos primero.
---

Cierra el ciclo SDD: toma una spec de `/skill:sdd-spec` y la implementa hasta que cada criterio de aceptación (CA) esté verificado con SU mecanismo declarado, o quede honestamente reportado como FALLA o pendiente de prueba humana. Los argumentos pueden traer la ruta de la spec (`.sdd/specs/x.md`), un issue (`#NN` — busca la spec en su body), o flags.

Tres ideas fuerza:

1. **La spec es el criterio de terminado.** No se corre sin spec: "el pedido está clarito" no alcanza, porque sin CAs verificables no hay forma de saber si terminaste. Sin spec, primero `/skill:sdd-spec`.
2. **El plan es efímero.** Se planifica contra el código real y se aprueba, pero NO se persiste: el plan es mutable y frágil, cambia con la implementación. Lo que persiste es el resultado de la verificación, que son hechos.
3. **La verificación no se negocia.** Un CA pasa cuando su mecanismo corre y da verde. Debilitar un test, aflojar un assert o marcar verificado algo que no se corrió es falsificar la verificación — el skill entero existe para impedir eso.

## Argumentos

```text
/skill:sdd-run [.sdd/specs/<spec>.md | #NN] [--assume] [--no-pr] [--base <branch>]
```

- `--assume` — cero preguntas: encadena `/skill:sdd-spec --assume` (y este `/skill:sdd-init --assume`) si faltan precondiciones, saltea el gate del plan, y resuelve desviaciones con sesgo mínimo seguro. Para correr desatendido.
- `--no-pr` — frena después del commit en el branch: no pushea ni crea PR. Para repos sin remote o cuando el PR lo arma el usuario.
- `--base <branch>` — branch base para ramificar y para el PR (default: el branch default que declara el contrato — main/master/otro).

### Handoff directo de Pi

El launcher de Pi puede entregar, después del skill materializado, un envelope terminal:

```xml
<workflow-launch version="1">
<DirectRunRequestV1 JSON estricto>
</workflow-launch>
```

`DirectRunRequestV1` es transporte de autorización y target, separado de `WorkflowResolutionV1`: declara `repo`, `cwd`, un target discriminado `issue|spec`, referencia canónica, resumen y evidencia. Validá que sea versión 1, exacto y serializable; que el argumento materializado coincida con el target; y que repo/cwd/spec sigan siendo los resueltos por el request. Un envelope ausente, extra, conflictivo o de otro proyecto falla cerrado antes de mutar Git.

Este handoff **no reemplaza ni saltea** ninguna precondición de este skill: contrato, estado de la spec, repo limpio, worktree, gate del plan, tests y verificación completa siguen siendo obligatorios. Sólo saltea la Fase 0 porque el usuario ya eligió el target y autorizó el launcher. Para una spec artefacto con `issue=null`, conservá esa identidad: no inventes ni crees un issue.

## Fase 0 — Lanzador (solo con `/skill:sdd-run` pelado)

Dispara SOLO cuando los argumentos vienen vacíos. Si trajo spec, issue o flags, saltear.

Listar las specs de `.sdd/specs/` con su estado y verificabilidad (leer el header y la sección Verificabilidad de cada una):

```text
/skill:sdd-run implementa una spec hasta que cada criterio este verificado, y termina en un PR
con la evidencia. Specs disponibles:

  1. dark-mode-toggle.md      (aprobada · MIXTA: ALTA 4 / MEDIA 1 / NULA 1)
  2. issue-12-rate-limit.md   (draft · ALTA)

Atajo: /skill:sdd-run <spec|#NN> [--assume] [--no-pr] saltea este menu.
```

Luego usar `ask_user_question` — "¿Cuál spec corremos?": una opción por spec (máximo 4, las más recientes; el resto vía custom) + `Ninguna, hay que especificar primero` → ofrecer `/skill:sdd-spec`.

## Fase 1 — Precondiciones (bloqueante)

1. **Contrato**: leer `.sdd/project.md`. Si no existe: interactivo → ofrecer `/skill:sdd-init` ahí mismo; `--assume` → correr `/skill:sdd-init --assume` y seguir. Anotar ya la capacidad de PR que declara el contrato (remote + gh): si no la hay, avisar desde el arranque que la corrida termina en commit local. Anotar también las **políticas de generación** activas (`## Politicas de generacion`) y anunciarlas al arranque: son gates duros que la Fase 4 verifica con el gate que cada una declara.
2. **Spec**: resolver el argumento. Ruta → leerla. `#NN` → `gh issue view` y extraer la spec del body (la generó `/skill:sdd-spec`); si el issue no tiene spec SDD, frenar y ofrecer `/skill:sdd-spec #NN`. Pedido libre sin spec → frenar: ofrecer `/skill:sdd-spec <pedido>` (interactivo) o encadenarlo (`--assume`). NO improvisar una spec: ese trabajo tiene su skill.
3. **Spec en `draft`**: significa que nadie revisó las inferencias — correrla es aceptar todas las `[ASSUMED]`. Interactivo: decirlo y preguntar si seguir (u ofrecer revisar las inferencias acá, una pregunta por inferencia de confianza baja). `--assume`: seguir y dejarlo anotado en el PR.
4. **Worktree limpio desde main actualizado — o abort**: `/skill:sdd-run` NUNCA corre sobre el checkout del usuario. Preflight: `git fetch` (si hay remote) y chequear estado sano. Ante CUALQUIER cosa rara — cambios sin commitear, rebase/merge a medias, detached HEAD, base local divergido de su remote — **ABORTAR** explicando exactamente qué se encontró. No arreglar nada (ni stash, ni reset, ni checkout): si el repo está raro, el humano está en el medio de algo.

   **Única excepción — el spec target sin comitear:** si lo ÚNICO sucio (según `git status --porcelain`) es el archivo del spec que se va a correr (el que resolvió la Fase 1.2 cuando vino como ruta local — sea `??` sin trackear o ` M` modificado), NO abortar: ese es el flujo normal de encadenar `/skill:sdd-spec` → `/skill:sdd-run` sin un commit intermedio. CUALQUIER otro path sucio — código, otro spec, config — sigue disparando el abort (ahí sí el humano está en el medio de algo). Lo que se corre es el contenido del working-tree, no el committeado. Con `#NN` (spec en el body del issue) la excepción no aplica: no hay archivo local que tolerar, cualquier cosa sucia aborta.

   Con todo sano (o solo el spec target sucio): crear con `bash` un worktree nuevo y branch `sdd/<slug>` desde el base actualizado (`--base`; default: el branch default que declara el contrato, y si el contrato no lo dice, detectarlo — nunca asumir "main"): `git worktree add ../<repo>-sdd-<slug> -b sdd/<slug> <base>`. TODO el run pasa ahí adentro. Si se aplicó la excepción del spec: el worktree nace del base y NO trae el cambio sin comitear, así que copiar el contenido working-tree del spec (desde el checkout) al worktree en el mismo path y commitearlo ahí como PRIMER commit del branch (`spec: baseline de <slug> (sin comitear en el checkout)`). Nunca commitear en el checkout del usuario: se lee y se deja intacto. Así el worktree queda limpio para el resto del run y el spec entra al PR.

## Fase 2 — Plan efímero + gate

Planificar contra el código real, no contra la idea del código. Explorar con `read`, `bash` y llamadas paralelas solo para comprobaciones independientes; Pi conserva el ownership en un único agente:

- Pasos mapeados a CAs: cada paso dice qué CA ataca y cómo se va a verificar (heredado del Plan de verificacion de la spec). Trabajo que no mapea a ningún CA no entra al plan — es señal de scope creep o de spec incompleta.
- Orden test-first para los CA ALTA: los tests del plan de verificación se escriben ANTES que la implementación, y tienen que fallar primero (rojo → verde es la evidencia de que el test observa algo real).
- El plan declara los **seams** bajo prueba — las interfaces públicas donde se observa comportamiento (doctrina de `/skill:tdd`). Preferir seams existentes y el más alto posible; el gate del plan es donde el usuario los aprueba.
- Si el plan revela que un CA es incoherente con el código real (la spec asumió algo que no existe): NO improvisar — es una desviación, se maneja como dice la Fase 3.
- **Políticas de generación en el plan**: con *tamaño máximo de PR* activo, estimar el blast-radius del plan contra el límite — si la spec entera no cabe, decirlo en el gate y ofrecer partirla (`/skill:sdd-spec`) o seguir sabiendo que el PR puede terminar en draft; `--assume` → seguir y que el gate del cierre juzgue. Con *dependencias nuevas: prohibido/preguntar*, el plan declara toda dep nueva que necesite — `prohibido` → replantear sin la dep o dejarlo como FALLA honesta; `preguntar` → entra como pregunta en el gate del plan. Las políticas de la tecnología — gates y `guia` (estilo, max líneas por archivo, constructos prohibidos) — se adoptan al ESCRIBIR el código: se genera siguiendolas, no se corrige al final.

**Gate**: presentar el plan resumido (pasos ↔ CAs, archivos que toca, qué queda explícitamente afuera) y usar `ask_user_question`: `Aprobar (Recomendado)` / `Ajustar` (el usuario dice qué vía custom y se replantea). Con `--assume`: sin gate. El plan NO se escribe a disco — vive en la conversación y muere con ella.

## Fase 3 — Implementar con loop de verificación por CA

1. **Tests primero** (CA ALTA): escribir los tests del plan de verificación con la doctrina de `/skill:tdd` — solo en los seams aprobados en el gate, comportamiento por interfaces públicas, mocks solo en límites de sistema, nunca tautológicos — correrlos y confirmar que fallan por la razón correcta. Recién después implementar hasta verde.
2. **Verificar cada CA con SU mecanismo** — el que la spec declara, no otro: unit con el comando del contrato, integration, probe scripteado (curl / señal de log), e2e. Para CA MEDIA con flakiness declarada en el contrato: aplicar su política (ej. reintentar una vez antes de creer un rojo) y NUNCA concluir de una sola corrida flaky.
3. **Presupuesto por CA**: 3 intentos honestos. Si un CA sigue en rojo al tercero, se congela: queda FALLA con diagnóstico concreto (qué se probó, qué dio, hipótesis) y se sigue con los demás CAs si son independientes. Prohibido el intento número 4 disfrazado de "refactor".
4. **Desviaciones**: si la implementación revela que la spec está mal (inferencia `[ASSUMED]` incorrecta, CA imposible como está escrito): interactivo → preguntar y editar la spec con una línea de changelog fechada; `--assume` → si NO cambia el alcance, documentar `[DEVIATION]` en la spec y seguir; si cambia el alcance, abortar honesto con el estado committeado en el branch. Nunca desviarse en silencio: una spec que dice A con un código que hace B mata la confianza en todo el pipeline.
5. **Regresión**: la suite existente completa (comando del contrato) tiene que quedar verde, no solo los tests nuevos.
6. Commitear por pasos coherentes (mensaje referencia el CA: `CA-2: rate limit por IP con ventana deslizante`), nunca un mega-commit final. Si el contrato declara convención de commits, cada mensaje la cumple además de referenciar el CA.

### Ownership y tareas

- El agente conserva ownership del run hasta cerrar la spec y emitir el reporte final.
- Las llamadas paralelas se limitan a lecturas o comprobaciones realmente independientes. Sus resultados deben reconciliarse antes de editar o responder.
- Antes del cierre, comprobar que no queden tool calls ni procesos bloqueantes en estado `running`.

### Timeouts y procesos colgados

- Un timeout del harness o un `SIGTERM` NO equivale a test fallido, test verde ni fin de la corrida.
- Ante un timeout: inspeccionar la salida parcial; comprobar si quedaron handles o procesos vivos; focalizar el comando; usar modo no-watch/no-interactivo y un timeout suficiente; luego repetir el mecanismo requerido por el CA.
- No describir una suite como verde si el proceso no terminó con exit code exitoso. Tampoco abandonar implementación pendiente por un timeout de infraestructura.
- Solo registrar FALLA después de agotar el presupuesto del CA con diagnóstico concreto. Si el bloqueo es del harness y no del comportamiento, reportarlo como bloqueo de ejecución, no como CA verificado ni como implementación terminada.

### Gate de entrega humana

Antes de levantar o presentar la app para validación humana:

- Verificar que el flujo solicitado sea accesible y operable desde su interfaz pública; no puede seguir deshabilitado, oculto ni marcado "a definir".
- Ejecutar al menos los tests focalizados, typecheck y build correspondientes, salvo que el contrato declare otro mecanismo.
- No pedir prueba humana de un CA cuya implementación todavía no existe. Si el flujo no está listo, decirlo explícitamente y continuar trabajando.

## Fase 4 — Verificación final y cierre de la spec

1. Correr la escalera del contrato completa hasta su techo (typecheck, unit, build, levantar la app y probarla si el contrato sabe como).
2. **CA NULA**: no se implementan a ciegas ni se verifican por decreto — quedan `pendiente de prueba humana` con el protocolo de la spec listo para ejecutar. No bloquean el PR: se listan como checklist en el body.
3. **Gates de política**: verificar cada política de generación del contrato con el gate que ELLA declara — tamaño de PR con `git diff --stat <base>...HEAD` (excluyendo lockfiles y generados), coverage corriendo su comando y comparando contra el umbral que la política declara (% fijo o `no bajar del baseline`), deps nuevas con el diff de manifest/lockfile, commits con el patrón sobre `git log`, y las políticas de la tecnología con el linter/script/grep que cada una declara. Las filas `guia` no se gatean ni se reportan verificadas: se listan en el PR como `guias aplicadas`, para que el reviewer las juzgue. Política incumplida = **FALLA de política**: entra al Resultado de ejecucion como fila `POL-*` con la medición real, y el PR se abre en **draft** (Fase 5). Misma doctrina que los CAs: prohibido excluir archivos del diff, bajar el umbral o retocar la medición para que dé verde.
4. **Receipt Git antes de narrar**: la narración del agente es dato no confiable; la autoridad sobre qué pasó es el repo. Antes de escribir el Resultado de ejecucion, derivar la evidencia del estado real del branch, no de la memoria de la conversación:
   - `git diff --name-status <base>..HEAD` es la autoridad sobre qué cambió: cada CA verificado tiene que ser consistente con ese diff — sus tests nuevos aparecen, los archivos tocados son los del plan. Un CA "verificado" cuyos tests no están en el diff no está verificado.
   - Diffear los tests contra el base buscando verificación falsificada: asserts aflojados, `skip`/`only` colados, tests borrados, umbrales bajados. Si aparece algo, ese CA vuelve a rojo — no se narra.
   - La columna Evidencia cita SOLO comandos corridos en esta corrida (comando + resultado observado), y el título de la tabla anota el sha de HEAD sobre el que corrió la verificación final.
5. Actualizar la spec (único artefacto que persiste): estado del header a `implementada` — tanto el campo `Estado:` del comentario humano (reconciliarlo si discrepa) como el marker `SDD-Tracking`, que queda:

```markdown
<!-- SDD-Tracking: version=1; type=spec; state=implemented; issue=<#NN|owner/repo#NN|none>; grill=<ref|none>; superseded-by=none -->
```

La transición preserva la identidad: `issue`, `grill` y `superseded-by` conservan exactamente los valores que la spec ya tenía (fuera de `superseded`, `superseded-by` es siempre `none`). Es un upsert del marker existente — nunca un segundo marker — y si la spec solo trae un marker legacy (sin `version=`) o ninguno, se inserta el v1 completo derivando `issue` y `grill` del preámbulo. Además, una sección nueva al final:

```markdown
## Resultado de ejecucion (<fecha> · HEAD <abc1234>)
| CA | Estado | Evidencia |
|---|---|---|
| CA-1 | verificado | npm test: 8/8 verdes (3 nuevos) |
| CA-4 | FALLA | timeout en probe; diagnostico en PR |
| CA-5 | pendiente humano | protocolo en la spec, checklist en el PR |
| POL-coverage | FALLA (74% < 80%) | pnpm test -- --coverage; PR en draft |
```

## Fase 5 — PR

Saltear con `--no-pr` (el run termina con el branch committeado y lo dice).

1. **Aptitud primero, push después**: si el contrato declara que no hay remote o gh no está autenticado, degradar automáticamente a `--no-pr` (commit local) y avisar — no descubrirlo con un push fallido. Con aptitud ok: push del branch (`git push -u origin sdd/<slug>`), respetando los Limites del contrato — si el contrato prohíbe push en general (no solo a main), degradar a commit local, avisar, y listar el comando que el usuario debe correr.
2. `gh pr create` — base `--base`, título = título de la spec. Body: la spec completa (con su Resultado de ejecucion) + checklist de protocolo humano si hay CA NULA + `Closes #NN` si la spec vino de un issue. Cerrar con la firma estándar de PR. Con alguna política de generación en FALLA: crear con `--draft` y la política violada (con su medición) al tope del body — el pase a ready es decisión humana.
3. NO mergear: el merge es del humano, siempre.
4. Limpiar: remover el worktree (`git worktree remove`) — el branch y sus commits quedan en el repo. Si el run abortó a medias o quedó con FALLAs que el usuario querrá inspeccionar en caliente, conservarlo y reportar la ruta.

## Reporte

```text
Run completo: PR #<n> <url>   (o: branch sdd/<slug> committeado, sin PR)
- spec: <ruta> (<estado previo> → implementada)
- CAs: <N> — verificados <V> · FALLA <F> · pendiente humano <H>
- politicas de generacion: <k cumplidas · f FALLA (PR en draft) · guias aplicadas <g> | sin politicas activas>
- tests: <X> pasan (<K> nuevos) · regresion verde · escalera hasta <techo>
- desviaciones de la spec: <ninguna | una linea por cada una>
- commits: <M> en sdd/<slug>
- pendiente tuyo: <revisar PR | protocolo humano de CA-n | decidir sobre CA en FALLA>
```

### Run interrumpido

Si una restricción externa obliga a detener la sesión antes del cierre, NO usar `Run completo`. Emitir `RUN INTERRUMPIDO` e incluir obligatoriamente:

```text
RUN INTERRUMPIDO
- ultimo CA terminado: <CA-n | ninguno>
- tarea/comando activo o bloqueo: <detalle>
- cambios sin commit: <paths o ninguno>
- tests rojos/no concluyentes: <detalle>
- worktree: <ruta>
- reanudar con: <instruccion exacta>
```

Conservar el worktree. Nunca presentar una interrupción, timeout o tarea pendiente como una entrega parcial lista para validar.

### Checklist de cierre obligatorio

Antes de emitir `Run completo`, comprobar todos estos invariantes:

- [ ] Todos los CAs tienen estado y evidencia.
- [ ] Ninguna tarea, tool call o proceso bloqueante sigue `running`.
- [ ] Tests focalizados terminaron verdes.
- [ ] Regresión completa terminó verde o su FALLA quedó documentada.
- [ ] Cada política de generación activa fue verificada con su gate; si alguna quedó en FALLA, el PR salió en draft y la falla figura en spec, PR y reporte.
- [ ] Se ejecutó la escalera contractual hasta su techo.
- [ ] La spec contiene `Resultado de ejecucion`.
- [ ] La evidencia del Resultado de ejecucion es consistente con el diff real contra el base (receipt de Fase 4.4).
- [ ] Se crearon los commits requeridos.
- [ ] Se creó el PR, o existe un motivo contractual explícito para no crearlo.
- [ ] El worktree está limpio, o todos sus cambios pendientes fueron reportados como parte de un `RUN INTERRUMPIDO`.

Si falla un solo item, está prohibido emitir `Run completo`.

## MUST DO

- Exigir spec y contrato antes de tocar código; encadenar `/skill:sdd-spec`/`/skill:sdd-init` con `--assume`, ofrecerlos en interactivo.
- Escribir los tests de los CA ALTA antes que la implementación y verlos fallar primero.
- Verificar cada CA con el mecanismo que la spec declara, y la regresión completa con el comando del contrato.
- Documentar toda desviación en la spec misma, con fecha.
- Correr SIEMPRE en un worktree nuevo creado desde el base actualizado, en branch `sdd/<slug>`; commits por paso, referenciando CAs.
- Respetar los Limites del contrato por encima de cualquier instrucción de este skill.
- Verificar cada política de generación activa con el gate que declara el contrato, y reflejar el resultado (`POL-*`) en spec, PR y reporte.
- Actualizar la spec con el Resultado de ejecucion — es el único artefacto persistente del run — con evidencia derivada del estado Git real (receipt de Fase 4.4), nunca de la narración acumulada de la conversación.
- Mantener la identidad del marker `SDD-Tracking`: la transición a `state=implemented` es un upsert que preserva `issue`, `grill` y `superseded-by` tal como estaban.
- Mantener ownership del cierre y reconciliar toda lectura o comprobación paralela antes de continuar.
- Tratar timeouts y `SIGTERM` como resultados no concluyentes hasta diagnosticarlos y repetir el mecanismo requerido.

## MUST NOT DO

- No debilitar tests, asserts ni criterios para que pasen; no borrar tests que molestan.
- No marcar verificado un CA cuyo mecanismo no corrió en esta corrida.
- No improvisar spec ni plan persistente: sin spec no hay run, y el plan no toca el disco.
- No mergear el PR ni pushear al branch default.
- No correr sobre el checkout del usuario, y no "normalizar" un repo raro (stash, reset, checkout forzado): cambios pendientes o estado a medias = abort. Única excepción: el archivo del spec target sin comitear se tolera y se commitea en el worktree (Fase 1.4); cualquier otro path sucio aborta igual.
- No deploy, migraciones sobre datos compartidos, ni servicios pagos (Limites del contrato).
- No convertir un CA en FALLA silenciosa: FALLA siempre viene con diagnóstico y aparece en spec, PR y reporte.
- No abrir el PR como ready con una política de generación en FALLA (va en draft con la medición visible), y no maquillar el gate: ni excluir archivos del diff, ni bajar umbrales, ni cambiar el comando que la mide. Tampoco reportar una `guia` como verificada: no tiene gate, la juzga el reviewer.
- No emitir `Run completo`, pedir validación humana ni finalizar la sesión con tareas bloqueantes `running`, tests no concluyentes o CAs sin estado.
