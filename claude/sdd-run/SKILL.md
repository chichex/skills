---
name: sdd-run
description: Ejecuta una spec SDD de punta a punta — planifica contra el código real, implementa con tests primero, verifica cada criterio de aceptación con el mecanismo que la spec declara, y termina en un PR con la spec como body y la evidencia de verificación. El "terminado" lo define la spec, no la sensación. Usar SIEMPRE que el usuario quiera implementar una spec de .sdd/specs/, ejecutar/correr una spec, implementar un issue que ya tiene spec SDD, o diga "corre la spec de X", "implementa esto que ya especificamos", "dale para adelante con la spec". Exige spec (/sdd-spec) y contrato (/sdd-init); si faltan, hay que generarlos primero.
---

Cierra el ciclo SDD: toma una spec de `/sdd-spec` y la implementa hasta que cada criterio de aceptación (CA) esté verificado con SU mecanismo declarado, o quede honestamente reportado como FALLA o pendiente de prueba humana. Los argumentos pueden traer la ruta de la spec (`.sdd/specs/x.md`), un issue (`#NN` — busca la spec en su body), o flags.

Tres ideas fuerza:

1. **La spec es el criterio de terminado.** No se corre sin spec: "el pedido está clarito" no alcanza, porque sin CAs verificables no hay forma de saber si terminaste. Sin spec, primero `/sdd-spec`.
2. **El plan es efímero.** Se planifica contra el código real y se aprueba, pero NO se persiste: el plan es mutable y frágil, cambia con la implementación. Lo que persiste es el resultado de la verificación, que son hechos.
3. **La verificación no se negocia.** Un CA pasa cuando su mecanismo corre y da verde. Debilitar un test, aflojar un assert o marcar verificado algo que no se corrió es falsificar la verificación — el skill entero existe para impedir eso.

## Argumentos

```text
/sdd-run [.sdd/specs/<spec>.md | #NN] [--assume] [--no-pr] [--base <branch>] [--ultracode]
```

- `--assume` — cero preguntas: encadena `/sdd-spec --assume` (y este `/sdd-init --assume`) si faltan precondiciones, saltea el gate del plan, y resuelve desviaciones con sesgo mínimo seguro. Para correr desatendido.
- `--no-pr` — frena después del commit en el branch: no pushea ni crea PR. Para repos sin remote o cuando el PR lo arma el usuario.
- `--base <branch>` — branch base para ramificar y para el PR (default: el branch default que declara el contrato — main/master/otro).
- `--ultracode` — sube el motor de ejecución a orquestación multi-agente adversarial con la tool `Workflow`. NO cambia QUÉ se hace — mismas fases, misma doctrina, mismos mecanismos que la spec declara por CA — cambia el CÓMO: exploración en fan-out, CAs independientes implementados en paralelo, y un panel de escépticos que intenta REFUTAR cada CA verde. Ortogonal a `--assume`/`--no-pr`/`--base` (componen). Default siempre normal; ultracode es opt-in. Ver "## Ultracode".

## Fase 0 — Lanzador (solo con `/sdd-run` pelado)

Dispara SOLO cuando los argumentos vienen vacíos. Si trajo spec, issue o flags, saltear.

Listar las specs de `.sdd/specs/` con su estado y verificabilidad (leer el header y la sección Verificabilidad de cada una):

```text
/sdd-run implementa una spec hasta que cada criterio este verificado, y termina en un PR
con la evidencia. Specs disponibles:

  1. dark-mode-toggle.md      (aprobada · MIXTA: ALTA 4 / MEDIA 1 / NULA 1)
  2. issue-12-rate-limit.md   (draft · ALTA)

Atajo: /sdd-run <spec|#NN> [--assume] [--no-pr] [--ultracode] saltea este menu.
```

Luego usar `AskUserQuestion` — "¿Cuál spec corremos?": una opción por spec (máximo 3, las más recientes; el resto vía custom) + `Ninguna, hay que especificar primero` → ofrecer `/sdd-spec`.

Con la spec ya elegida, preguntar la intensidad con un segundo `AskUserQuestion` — "¿Con qué intensidad la corremos?": `Normal (Recomendado)` — un hilo, la de siempre — / `Ultracode` — orquestación multi-agente y verificación adversarial por CA, mismo criterio de terminado, mucho más costo en tokens (equivale a `--ultracode`; ver "## Ultracode").

## Fase 1 — Precondiciones (bloqueante)

1. **Contrato**: leer `.sdd/project.md`. Si no existe: interactivo → ofrecer `/sdd-init` ahí mismo; `--assume` → correr `/sdd-init --assume` y seguir. Anotar ya la capacidad de PR que declara el contrato (remote + gh): si no la hay, avisar desde el arranque que la corrida termina en commit local. Anotar también las **políticas de generación** activas (`## Politicas de generacion`) y anunciarlas al arranque: son gates duros que la Fase 4 verifica con el gate que cada una declara.
2. **Spec**: resolver el argumento. Ruta → leerla. `#NN` → `gh issue view` y extraer la spec del body (la generó `/sdd-spec`); si el issue no tiene spec SDD, frenar y ofrecer `/sdd-spec #NN`. Pedido libre sin spec → frenar: ofrecer `/sdd-spec <pedido>` (interactivo) o encadenarlo (`--assume`). NO improvisar una spec: ese trabajo tiene su skill.
3. **Spec en `draft`**: significa que nadie revisó las inferencias — correrla es aceptar todas las `[ASSUMED]`. Interactivo: decirlo y preguntar si seguir (u ofrecer revisar las inferencias acá, una pregunta por inferencia de confianza baja). `--assume`: seguir y dejarlo anotado en el PR.
4. **Worktree limpio desde main actualizado — o abort**: `/sdd-run` NUNCA corre sobre el checkout del usuario. Preflight: `git fetch` (si hay remote) y chequear estado sano. Ante CUALQUIER cosa rara — cambios sin commitear, rebase/merge a medias, detached HEAD, base local divergido de su remote — **ABORTAR** explicando exactamente qué se encontró. No arreglar nada (ni stash, ni reset, ni checkout): si el repo está raro, el humano está en el medio de algo.

   **Única excepción — el spec target sin comitear:** si lo ÚNICO sucio (según `git status --porcelain`) es el archivo del spec que se va a correr (el que resolvió la Fase 1.2 cuando vino como ruta local — sea `??` sin trackear o ` M` modificado), NO abortar: ese es el flujo normal de encadenar `/sdd-spec` → `/sdd-run` sin un commit intermedio. CUALQUIER otro path sucio — código, otro spec, config — sigue disparando el abort (ahí sí el humano está en el medio de algo). Lo que se corre es el contenido del working-tree, no el committeado. Con `#NN` (spec en el body del issue) la excepción no aplica: no hay archivo local que tolerar, cualquier cosa sucia aborta.

   Con todo sano (o solo el spec target sucio): crear un worktree nuevo con branch `sdd/<slug>` desde el base actualizado (`--base`; default: el branch default que declara el contrato, y si el contrato no lo dice, detectarlo — nunca asumir "main") con `git worktree add ../<repo>-sdd-<slug> -b sdd/<slug> <base>`, y TODO el run pasa ahí adentro. Si se aplico la excepción del spec: el worktree nace del base y NO trae el cambio sin comitear, así que copiar el contenido working-tree del spec (desde el checkout) al worktree en el mismo path y commitearlo ahí como PRIMER commit del branch (`spec: baseline de <slug> (sin comitear en el checkout)`). Nunca commitear en el checkout del usuario: se lee y se deja intacto. Así el worktree queda limpio para el resto del run y el spec entra al PR.

## Fase 2 — Plan efímero + gate

Planificar contra el código real, no contra la idea del código (explorar lo que la spec va a tocar; subagents en repos grandes):

- Pasos mapeados a CAs: cada paso dice qué CA ataca y cómo se va a verificar (heredado del Plan de verificacion de la spec). Trabajo que no mapea a ningún CA no entra al plan — es señal de scope creep o de spec incompleta.
- Orden test-first para los CA ALTA: los tests del plan de verificación se escriben ANTES que la implementación, y tienen que fallar primero (rojo → verde es la evidencia de que el test observa algo real).
- El plan declara los **seams** bajo prueba — las interfaces públicas donde se observa comportamiento (doctrina de `/tdd`). Preferir seams existentes, y el más alto posible; el gate del plan es donde el usuario los aprueba.
- Si el plan revela que un CA es incoherente con el código real (la spec asumió algo que no existe): NO improvisar — es una desviacion, se maneja como dice la Fase 3.
- **Políticas de generación en el plan**: con *tamaño máximo de PR* activo, estimar el blast-radius del plan contra el límite — si la spec entera no cabe, decirlo en el gate y ofrecer partirla (`/sdd-spec`) o seguir sabiendo que el PR puede terminar en draft; `--assume` → seguir y que el gate del cierre juzgue. Con *dependencias nuevas: prohibido/preguntar*, el plan declara toda dep nueva que necesite — `prohibido` → replantear sin la dep o dejarlo como FALLA honesta; `preguntar` → entra como pregunta en el gate del plan. Las políticas de la tecnología — gates y `guia` (estilo, max líneas por archivo, constructos prohibidos) — se adoptan al ESCRIBIR el código: se genera siguiendolas, no se corrige al final.

**Gate**: presentar el plan resumido (pasos ↔ CAs, archivos que toca, qué queda explícitamente afuera) y usar `AskUserQuestion`: `Aprobar (Recomendado)` / `Ajustar` (el usuario dice qué vía custom y se replantea). Con `--assume`: sin gate. El plan NO se escribe a disco — vive en la conversación y muere con ella.

## Fase 3 — Implementar con loop de verificación por CA

1. **Tests primero** (CA ALTA): escribir los tests del plan de verificación con la doctrina de `/tdd` — solo en los seams aprobados en el gate, comportamiento por interfaces públicas, mocks solo en limites de sistema, nunca tautológicos — correrlos, confirmar que fallan por la razón correcta. Recién después implementar hasta verde.
2. **Verificar cada CA con SU mecanismo** — el que la spec declara, no otro: unit con el comando del contrato, integration, probe scripteado (curl / señal de log), e2e. Para CA MEDIA con flakiness declarada en el contrato: aplicar su política (ej. reintentar una vez antes de creer un rojo) y NUNCA concluir de una sola corrida flaky.
3. **Presupuesto por CA**: 3 intentos honestos. Si un CA sigue en rojo al tercero, se congela: queda FALLA con diagnóstico concreto (qué se probó, qué dio, hipótesis) y se sigue con los demás CAs si son independientes. Prohibido el intento número 4 disfrazado de "refactor".
4. **Desviaciones**: si la implementación revela que la spec está mal (inferencia `[ASSUMED]` incorrecta, CA imposible como está escrito): interactivo → preguntar y editar la spec con una línea de changelog fechada; `--assume` → si NO cambia el alcance, documentar `[DEVIATION]` en la spec y seguir; si cambia el alcance, abortar honesto con el estado committeado en el branch. Nunca desviarse en silencio: una spec que dice A con un código que hace B mata la confianza en todo el pipeline.
5. **Regresión**: la suite existente completa (comando del contrato) tiene que quedar verde, no solo los tests nuevos.
6. Commitear por pasos coherentes (mensaje referencia el CA: `CA-2: rate limit por IP con ventana deslizante`), nunca un mega-commit final. Si el contrato declara convención de commits, cada mensaje la cumple además de referenciar el CA.

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

## Ultracode — orquestación adversarial

Motor alternativo para las Fases 2-4. Activo cuando el run corre con `--ultracode` o se eligió `Ultracode` en el lanzador. Son las MISMAS fases y la MISMA doctrina de arriba — test-first, cada CA verificado con SU mecanismo, presupuesto acotado, cero falsificación, worktree nuevo, sin merge al default. Ultracode no afloja NADA: cambia el CÓMO — de un hilo a fan-out determinista — y agrega una capa de verificación adversarial que es la forma más fuerte de "la verificación no se negocia": un CA verde no se cree, se intenta refutar. Todos los MUST NOT DO siguen intactos.

Por fase (todo lo no mencionado queda igual):

- **Fase 2 (plan)** — exploración multi-modal en paralelo: un `Workflow` con una rama `Explore` por lente (data-flow de lo que la spec toca, seams y tests existentes en la zona, blast-radius y dependencias, modos de falla y edge cases, convenciones del repo); cada lente devuelve evidencia, no opinión. Judge panel de planes SOLO si la spec es MIXTA o grande y el enfoque no es obvio (N planes candidatos → se puntúan contra criterios explícitos —factibilidad test-first, altura de los seams, blast-radius, coherencia con los Limites del contrato— → se sintetiza el ganador); en specs chicas, un plan y listo. El panel elige entre CANDIDATOS, no reemplaza el gate: el plan sintetizado pasa por el MISMO `AskUserQuestion` Aprobar/Ajustar (`--assume` lo saltea igual que en normal) y sigue sin tocar disco.

- **Fase 3 (impl + verificación)** — el corazón:
  1. **Partición por dependencias** desde los seams que declara el plan: los CAs que no comparten seams/archivos son independientes → se implementan en paralelo, cada uno en su worktree aislado (`isolation:'worktree'`, anidado del branch del run) SOLO para escribir sin pisarse. CAs dependientes → secuencial, en orden. Cada agente-CA hace la doctrina COMPLETA: test-first (test → verlo fallar por la razón correcta → implementar hasta verde) con el mecanismo que la spec declara.
  2. **Integración**: mergear cada CA de vuelta al branch del run preservando los commits por CA (`CA-N: ...`), nunca squash. Si dos CAs "independientes" chocan al mergear, la partición estaba mal → NO forzar el merge: secuencializar esos CAs y rehacerlos. Esto NO viola "no mergear" — ese MUST NOT DO es sobre el PR al branch default; integrar sub-worktrees al branch del run es parte del motor.
  3. **El verde vale sobre el árbol integrado, no sobre el worktree aislado.** Un CA que dio verde EN SU worktree no está verificado: otro CA integrado pudo romperlo. La verificación de cada CA con su mecanismo, los escépticos y la regresión completa corren sobre el branch del run YA INTEGRADO. El worktree aislado es solo para escribir código sin colisión.
  4. **Verificación adversarial por CA**: sobre cada CA que llega a verde (en el árbol integrado), lanzar un panel de N escépticos (escalar N por severidad: más para ALTA, menos para MEDIA) cuyo ÚNICO trabajo es REFUTAR "CA-k está verificado". Cada escéptico: (a) re-corre el mecanismo declarado desde limpio — ¿dio verde de verdad en esta corrida o se reportó sin correr?; (b) diffea los tests contra el base — ¿assert aflojado, `skip`/`only` colado, test borrado o comentado, umbral bajado?; (c) caza asserts tautológicos (`x == x`, asserts sobre el valor de un mock, asserts que no tocan el seam declarado); (d) mutación dirigida — invierte una condición o rompe una línea de la impl y re-corre: si ningún test se pone rojo, la rama está sin cubrir y el verde es hueco; (e) chequea que el test observe el seam aprobado (el más alto), no uno más bajo o falso. Un CA queda `verificado` SOLO si ningún escéptico lo refuta con evidencia REPRODUCIBLE (comando re-corrido, mutación que sobrevive, assert aflojado concreto); refutación o absolución sin evidencia concreta no cuentan.
  5. **Presupuesto**: cap DURO de 3 intentos por CA sobre el TOTAL — intentos normales y redos por refutación comparten el mismo cap. Una refutación en pie manda el CA de vuelta al loop con esa refutación como observación roja concreta, pero NO compra un intento extra. Agotado el cap con una refutación en pie, el CA es FALLA con esa refutación en el diagnóstico — nunca `verificado`. "Arreglar un verde refutado" es corregir una verificación que no se sostuvo, no el intento 4 disfrazado, y el cap sigue siendo el mismo número.
  6. Los CA NULA no tienen mecanismo automático: no llevan escépticos, quedan `pendiente de prueba humana` como en normal. Desviaciones (Fase 3.4) y regresión completa (Fase 3.5): igual que en normal.

- **Fase 4 (cierre)** — antes de escribir el Resultado de ejecucion, un completeness critic con `Workflow` en loop-until-dry audita todo el run cruzando contra los reportes de los escépticos: ¿qué CA quedó `verificado` sin que su mecanismo ejercitara de verdad el comportamiento? ¿qué regresión no se corrió completa? ¿qué evidencia es circunstancial? ¿qué edge case del plan quedó sin cubrir? Los hallazgos se resuelven y el critic re-corre hasta salir seco; lo que no se puede cerrar NO se descarta en silencio → FALLA o pendiente humano con diagnóstico. La tabla de Resultado de ejecucion anota, por CA verificado, cuántos escépticos lo atacaron sin lograr refutarlo (ej. `verificado (3/3 escepticos refutados)`) y la refutación que ganó si terminó en FALLA — así la verificación adversarial queda auditable en la spec y el PR.

Limpieza (Fase 5): remover también los sub-worktrees de los CAs; ante abort o FALLA que el usuario querrá inspeccionar, conservarlos y reportar sus rutas.

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

## MUST DO

- Exigir spec y contrato antes de tocar código; encadenar `/sdd-spec`/`/sdd-init` con `--assume`, ofrecerlos en interactivo.
- Escribir los tests de los CA ALTA antes que la implementación y verlos fallar primero.
- Verificar cada CA con el mecanismo que la spec declara, y la regresión completa con el comando del contrato.
- Documentar toda desviacion en la spec misma, con fecha.
- Correr SIEMPRE en un worktree nuevo creado desde el base actualizado, en branch `sdd/<slug>`; commits por paso, referenciando CAs.
- Respetar los Limites del contrato por encima de cualquier instrucción de este skill.
- Verificar cada política de generación activa con el gate que declara el contrato, y reflejar el resultado (`POL-*`) en spec, PR y reporte.
- Actualizar la spec con el Resultado de ejecucion — es el único artefacto persistente del run — con evidencia derivada del estado Git real (receipt de Fase 4.4), nunca de la narración acumulada de la conversación.
- Mantener la identidad del marker `SDD-Tracking`: la transición a `state=implemented` es un upsert que preserva `issue`, `grill` y `superseded-by` tal como estaban.
- Con `--ultracode`: correr las MISMAS fases con la MISMA doctrina, solo orquestadas; un CA queda `verificado` solo si sobrevive a sus escépticos sobre el árbol integrado, y el completeness critic corre antes de cerrar.

## MUST NOT DO

- No debilitar tests, asserts ni criterios para que pasen; no borrar tests que molestan.
- No marcar verificado un CA cuyo mecanismo no corrió en esta corrida.
- No improvisar spec ni plan persistente: sin spec no hay run, y el plan no toca el disco.
- No mergear el PR ni pushear al branch default.
- No correr sobre el checkout del usuario, y no "normalizar" un repo raro (stash, reset, checkout forzado): cambios pendientes o estado a medias = abort. Única excepción: el archivo del spec target sin comitear se tolera y se commitea en el worktree (Fase 1.4); cualquier otro path sucio aborta igual.
- No deploy, migraciones sobre datos compartidos, ni servicios pagos (Limites del contrato).
- No convertir un CA en FALLA silenciosa: FALLA siempre viene con diagnóstico y aparece en spec, PR y reporte.
- No abrir el PR como ready con una política de generación en FALLA (va en draft con la medición visible), y no maquillar el gate: ni excluir archivos del diff, ni bajar umbrales, ni cambiar el comando que la mide. Tampoco reportar una `guia` como verificada: no tiene gate, la juzga el reviewer.
- Ultracode multiplica verificadores (escépticos, completeness critic), nunca criterios: el fan-out no autoriza saltear el gate del plan, aflojar un test, dar por `verificado` un CA con una refutación en pie, ni comprar un intento extra. Los escépticos van ENCIMA del verde normal, nunca en su lugar, y el judge panel no reemplaza el gate humano.
