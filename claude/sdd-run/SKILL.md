---
name: sdd-run
description: Ejecuta una spec SDD de punta a punta — planifica contra el codigo real, implementa con tests primero, verifica cada criterio de aceptacion con el mecanismo que la spec declara, y termina en un PR con la spec como body y la evidencia de verificacion. El "terminado" lo define la spec, no la sensacion. Usar SIEMPRE que el usuario quiera implementar una spec de .sdd/specs/, ejecutar/correr una spec, implementar un issue que ya tiene spec SDD, o diga "corre la spec de X", "implementa esto que ya especificamos", "dale para adelante con la spec". Exige spec (/sdd-spec) y contrato (/sdd-init); si faltan, hay que generarlos primero.
---

Cierra el ciclo SDD: toma una spec de `/sdd-spec` y la implementa hasta que cada criterio de aceptacion (CA) este verificado con SU mecanismo declarado, o quede honestamente reportado como FALLA o pendiente de prueba humana. Los argumentos pueden traer la ruta de la spec (`.sdd/specs/x.md`), un issue (`#NN` — busca la spec en su body), o flags.

Tres ideas fuerza:

1. **La spec es el criterio de terminado.** No se corre sin spec: "el pedido esta clarito" no alcanza, porque sin CAs verificables no hay forma de saber si terminaste. Sin spec, primero `/sdd-spec`.
2. **El plan es efimero.** Se planifica contra el codigo real y se aprueba, pero NO se persiste: el plan es mutable y fragil, cambia con la implementacion. Lo que persiste es el resultado de la verificacion, que son hechos.
3. **La verificacion no se negocia.** Un CA pasa cuando su mecanismo corre y da verde. Debilitar un test, aflojar un assert o marcar verificado algo que no se corrio es falsificar la verificacion — el skill entero existe para impedir eso.

## Argumentos

```text
/sdd-run [.sdd/specs/<spec>.md | #NN] [--assume] [--no-pr] [--base <branch>] [--ultracode]
```

- `--assume` — cero preguntas: encadena `/sdd-spec --assume` (y este `/sdd-init --assume`) si faltan precondiciones, saltea el gate del plan, y resuelve desviaciones con sesgo minimo seguro. Para correr desatendido.
- `--no-pr` — frena despues del commit en el branch: no pushea ni crea PR. Para repos sin remote o cuando el PR lo arma el usuario.
- `--base <branch>` — branch base para ramificar y para el PR (default: el branch default que declara el contrato — main/master/otro).
- `--ultracode` — sube el motor de ejecucion a orquestacion multi-agente adversarial con la tool `Workflow`. NO cambia QUE se hace — mismas fases, misma doctrina, mismos mecanismos que la spec declara por CA — cambia el COMO: exploracion en fan-out, CAs independientes implementados en paralelo, y un panel de escepticos que intenta REFUTAR cada CA verde. Ortogonal a `--assume`/`--no-pr`/`--base` (componen). Default siempre normal; ultracode es opt-in. Ver "## Ultracode".

## Fase 0 — Lanzador (solo con `/sdd-run` pelado)

Dispara SOLO cuando los argumentos vienen vacios. Si trajo spec, issue o flags, saltear.

Listar las specs de `.sdd/specs/` con su estado y verificabilidad (leer el header y la seccion Verificabilidad de cada una):

```text
/sdd-run implementa una spec hasta que cada criterio este verificado, y termina en un PR
con la evidencia. Specs disponibles:

  1. dark-mode-toggle.md      (aprobada · MIXTA: ALTA 4 / MEDIA 1 / NULA 1)
  2. issue-12-rate-limit.md   (draft · ALTA)

Atajo: /sdd-run <spec|#NN> [--assume] [--no-pr] [--ultracode] saltea este menu.
```

Luego usar `AskUserQuestion` — "¿Cual spec corremos?": una opcion por spec (maximo 3, las mas recientes; el resto via custom) + `Ninguna, hay que especificar primero` → ofrecer `/sdd-spec`.

Con la spec ya elegida, preguntar la intensidad con un segundo `AskUserQuestion` — "¿Con que intensidad la corremos?": `Normal (Recomendado)` — un hilo, la de siempre — / `Ultracode` — orquestacion multi-agente y verificacion adversarial por CA, mismo criterio de terminado, mucho mas costo en tokens (equivale a `--ultracode`; ver "## Ultracode").

## Fase 1 — Precondiciones (bloqueante)

1. **Contrato**: leer `.sdd/project.md`. Si no existe: interactivo → ofrecer `/sdd-init` ahi mismo; `--assume` → correr `/sdd-init --assume` y seguir. Anotar ya la capacidad de PR que declara el contrato (remote + gh): si no la hay, avisar desde el arranque que la corrida termina en commit local. Anotar tambien las **politicas de generacion** activas (`## Politicas de generacion`) y anunciarlas al arranque: son gates duros que la Fase 4 verifica con el gate que cada una declara.
2. **Spec**: resolver el argumento. Ruta → leerla. `#NN` → `gh issue view` y extraer la spec del body (la genero `/sdd-spec`); si el issue no tiene spec SDD, frenar y ofrecer `/sdd-spec #NN`. Pedido libre sin spec → frenar: ofrecer `/sdd-spec <pedido>` (interactivo) o encadenarlo (`--assume`). NO improvisar una spec: ese trabajo tiene su skill.
3. **Spec en `draft`**: significa que nadie reviso las inferencias — correrla es aceptar todas las `[ASSUMED]`. Interactivo: decirlo y preguntar si seguir (u ofrecer revisar las inferencias aca, una pregunta por inferencia de confianza baja). `--assume`: seguir y dejarlo anotado en el PR.
4. **Worktree limpio desde main actualizado — o abort**: `/sdd-run` NUNCA corre sobre el checkout del usuario. Preflight: `git fetch` (si hay remote) y chequear estado sano. Ante CUALQUIER cosa rara — cambios sin commitear, rebase/merge a medias, detached HEAD, base local divergido de su remote — **ABORTAR** explicando exactamente que se encontro. No arreglar nada (ni stash, ni reset, ni checkout): si el repo esta raro, el humano esta en el medio de algo.

   **Unica excepcion — el spec target sin comitear:** si lo UNICO sucio (segun `git status --porcelain`) es el archivo del spec que se va a correr (el que resolvio la Fase 1.2 cuando vino como ruta local — sea `??` sin trackear o ` M` modificado), NO abortar: ese es el flujo normal de encadenar `/sdd-spec` → `/sdd-run` sin un commit intermedio. CUALQUIER otro path sucio — codigo, otro spec, config — sigue disparando el abort (ahi si el humano esta en el medio de algo). Lo que se corre es el contenido del working-tree, no el committeado. Con `#NN` (spec en el body del issue) la excepcion no aplica: no hay archivo local que tolerar, cualquier cosa sucia aborta.

   Con todo sano (o solo el spec target sucio): crear un worktree nuevo con branch `sdd/<slug>` desde el base actualizado (`--base`; default: el branch default que declara el contrato, y si el contrato no lo dice, detectarlo — nunca asumir "main") con `git worktree add ../<repo>-sdd-<slug> -b sdd/<slug> <base>`, y TODO el run pasa ahi adentro. Si se aplico la excepcion del spec: el worktree nace del base y NO trae el cambio sin comitear, asi que copiar el contenido working-tree del spec (desde el checkout) al worktree en el mismo path y commitearlo ahi como PRIMER commit del branch (`spec: baseline de <slug> (sin comitear en el checkout)`). Nunca commitear en el checkout del usuario: se lee y se deja intacto. Asi el worktree queda limpio para el resto del run y el spec entra al PR.

## Fase 2 — Plan efimero + gate

Planificar contra el codigo real, no contra la idea del codigo (explorar lo que la spec va a tocar; subagents en repos grandes):

- Pasos mapeados a CAs: cada paso dice que CA ataca y como se va a verificar (heredado del Plan de verificacion de la spec). Trabajo que no mapea a ningun CA no entra al plan — es señal de scope creep o de spec incompleta.
- Orden test-first para los CA ALTA: los tests del plan de verificacion se escriben ANTES que la implementacion, y tienen que fallar primero (rojo → verde es la evidencia de que el test observa algo real).
- El plan declara los **seams** bajo prueba — las interfaces publicas donde se observa comportamiento (doctrina de `/tdd`). Preferir seams existentes, y el mas alto posible; el gate del plan es donde el usuario los aprueba.
- Si el plan revela que un CA es incoherente con el codigo real (la spec asumio algo que no existe): NO improvisar — es una desviacion, se maneja como dice la Fase 3.
- **Politicas de generacion en el plan**: con *tamaño maximo de PR* activo, estimar el blast-radius del plan contra el limite — si la spec entera no cabe, decirlo en el gate y ofrecer partirla (`/sdd-spec`) o seguir sabiendo que el PR puede terminar en draft; `--assume` → seguir y que el gate del cierre juzgue. Con *dependencias nuevas: prohibido/preguntar*, el plan declara toda dep nueva que necesite — `prohibido` → replantear sin la dep o dejarlo como FALLA honesta; `preguntar` → entra como pregunta en el gate del plan. Las politicas de la tecnologia — gates y `guia` (estilo, max lineas por archivo, constructos prohibidos) — se adoptan al ESCRIBIR el codigo: se genera siguiendolas, no se corrige al final.

**Gate**: presentar el plan resumido (pasos ↔ CAs, archivos que toca, que queda explicitamente afuera) y usar `AskUserQuestion`: `Aprobar (Recomendado)` / `Ajustar` (el usuario dice que via custom y se replantea). Con `--assume`: sin gate. El plan NO se escribe a disco — vive en la conversacion y muere con ella.

## Fase 3 — Implementar con loop de verificacion por CA

1. **Tests primero** (CA ALTA): escribir los tests del plan de verificacion con la doctrina de `/tdd` — solo en los seams aprobados en el gate, comportamiento por interfaces publicas, mocks solo en limites de sistema, nunca tautologicos — correrlos, confirmar que fallan por la razon correcta. Recien despues implementar hasta verde.
2. **Verificar cada CA con SU mecanismo** — el que la spec declara, no otro: unit con el comando del contrato, integration, probe scripteado (curl / señal de log), e2e. Para CA MEDIA con flakiness declarada en el contrato: aplicar su politica (ej. reintentar una vez antes de creer un rojo) y NUNCA concluir de una sola corrida flaky.
3. **Presupuesto por CA**: 3 intentos honestos. Si un CA sigue en rojo al tercero, se congela: queda FALLA con diagnostico concreto (que se probo, que dio, hipotesis) y se sigue con los demas CAs si son independientes. Prohibido el intento numero 4 disfrazado de "refactor".
4. **Desviaciones**: si la implementacion revela que la spec esta mal (inferencia `[ASSUMED]` incorrecta, CA imposible como esta escrito): interactivo → preguntar y editar la spec con una linea de changelog fechada; `--assume` → si NO cambia el alcance, documentar `[DEVIATION]` en la spec y seguir; si cambia el alcance, abortar honesto con el estado committeado en el branch. Nunca desviarse en silencio: una spec que dice A con un codigo que hace B mata la confianza en todo el pipeline.
5. **Regresion**: la suite existente completa (comando del contrato) tiene que quedar verde, no solo los tests nuevos.
6. Commitear por pasos coherentes (mensaje referencia el CA: `CA-2: rate limit por IP con ventana deslizante`), nunca un mega-commit final. Si el contrato declara convencion de commits, cada mensaje la cumple ademas de referenciar el CA.

## Fase 4 — Verificacion final y cierre de la spec

1. Correr la escalera del contrato completa hasta su techo (typecheck, unit, build, levantar la app y probarla si el contrato sabe como).
2. **CA NULA**: no se implementan a ciegas ni se verifican por decreto — quedan `pendiente de prueba humana` con el protocolo de la spec listo para ejecutar. No bloquean el PR: se listan como checklist en el body.
3. **Gates de politica**: verificar cada politica de generacion del contrato con el gate que ELLA declara — tamaño de PR con `git diff --stat <base>...HEAD` (excluyendo lockfiles y generados), coverage corriendo su comando y comparando contra el umbral que la politica declara (% fijo o `no bajar del baseline`), deps nuevas con el diff de manifest/lockfile, commits con el patron sobre `git log`, y las politicas de la tecnologia con el linter/script/grep que cada una declara. Las filas `guia` no se gatean ni se reportan verificadas: se listan en el PR como `guias aplicadas`, para que el reviewer las juzgue. Politica incumplida = **FALLA de politica**: entra al Resultado de ejecucion como fila `POL-*` con la medicion real, y el PR se abre en **draft** (Fase 5). Misma doctrina que los CAs: prohibido excluir archivos del diff, bajar el umbral o retocar la medicion para que de verde.
4. **Receipt Git antes de narrar**: la narracion del agente es dato no confiable; la autoridad sobre que paso es el repo. Antes de escribir el Resultado de ejecucion, derivar la evidencia del estado real del branch, no de la memoria de la conversacion:
   - `git diff --name-status <base>..HEAD` es la autoridad sobre que cambio: cada CA verificado tiene que ser consistente con ese diff — sus tests nuevos aparecen, los archivos tocados son los del plan. Un CA "verificado" cuyos tests no estan en el diff no esta verificado.
   - Diffear los tests contra el base buscando verificacion falsificada: asserts aflojados, `skip`/`only` colados, tests borrados, umbrales bajados. Si aparece algo, ese CA vuelve a rojo — no se narra.
   - La columna Evidencia cita SOLO comandos corridos en esta corrida (comando + resultado observado), y el titulo de la tabla anota el sha de HEAD sobre el que corrio la verificacion final.
5. Actualizar la spec (unico artefacto que persiste): estado del header a `implementada`, y una seccion nueva al final:

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

1. **Aptitud primero, push despues**: si el contrato declara que no hay remote o gh no esta autenticado, degradar automaticamente a `--no-pr` (commit local) y avisar — no descubrirlo con un push fallido. Con aptitud ok: push del branch (`git push -u origin sdd/<slug>`), respetando los Limites del contrato — si el contrato prohibe push en general (no solo a main), degradar a commit local, avisar, y listar el comando que el usuario debe correr.
2. `gh pr create` — base `--base`, titulo = titulo de la spec. Body: la spec completa (con su Resultado de ejecucion) + checklist de protocolo humano si hay CA NULA + `Closes #NN` si la spec vino de un issue. Cerrar con la firma estandar de PR. Con alguna politica de generacion en FALLA: crear con `--draft` y la politica violada (con su medicion) al tope del body — el pase a ready es decision humana.
3. NO mergear: el merge es del humano, siempre.
4. Limpiar: remover el worktree (`git worktree remove`) — el branch y sus commits quedan en el repo. Si el run aborto a medias o quedo con FALLAs que el usuario querra inspeccionar en caliente, conservarlo y reportar la ruta.

## Ultracode — orquestacion adversarial

Motor alternativo para las Fases 2-4. Activo cuando el run corre con `--ultracode` o se eligio `Ultracode` en el lanzador. Son las MISMAS fases y la MISMA doctrina de arriba — test-first, cada CA verificado con SU mecanismo, presupuesto acotado, cero falsificacion, worktree nuevo, sin merge al default. Ultracode no afloja NADA: cambia el COMO — de un hilo a fan-out determinista — y agrega una capa de verificacion adversarial que es la forma mas fuerte de "la verificacion no se negocia": un CA verde no se cree, se intenta refutar. Todos los MUST NOT DO siguen intactos.

Por fase (todo lo no mencionado queda igual):

- **Fase 2 (plan)** — exploracion multi-modal en paralelo: un `Workflow` con una rama `Explore` por lente (data-flow de lo que la spec toca, seams y tests existentes en la zona, blast-radius y dependencias, modos de falla y edge cases, convenciones del repo); cada lente devuelve evidencia, no opinion. Judge panel de planes SOLO si la spec es MIXTA o grande y el enfoque no es obvio (N planes candidatos → se puntuan contra criterios explicitos —factibilidad test-first, altura de los seams, blast-radius, coherencia con los Limites del contrato— → se sintetiza el ganador); en specs chicas, un plan y listo. El panel elige entre CANDIDATOS, no reemplaza el gate: el plan sintetizado pasa por el MISMO `AskUserQuestion` Aprobar/Ajustar (`--assume` lo saltea igual que en normal) y sigue sin tocar disco.

- **Fase 3 (impl + verificacion)** — el corazon:
  1. **Particion por dependencias** desde los seams que declara el plan: los CAs que no comparten seams/archivos son independientes → se implementan en paralelo, cada uno en su worktree aislado (`isolation:'worktree'`, anidado del branch del run) SOLO para escribir sin pisarse. CAs dependientes → secuencial, en orden. Cada agente-CA hace la doctrina COMPLETA: test-first (test → verlo fallar por la razon correcta → implementar hasta verde) con el mecanismo que la spec declara.
  2. **Integracion**: mergear cada CA de vuelta al branch del run preservando los commits por CA (`CA-N: ...`), nunca squash. Si dos CAs "independientes" chocan al mergear, la particion estaba mal → NO forzar el merge: secuencializar esos CAs y rehacerlos. Esto NO viola "no mergear" — ese MUST NOT DO es sobre el PR al branch default; integrar sub-worktrees al branch del run es parte del motor.
  3. **El verde vale sobre el arbol integrado, no sobre el worktree aislado.** Un CA que dio verde EN SU worktree no esta verificado: otro CA integrado pudo romperlo. La verificacion de cada CA con su mecanismo, los escepticos y la regresion completa corren sobre el branch del run YA INTEGRADO. El worktree aislado es solo para escribir codigo sin colision.
  4. **Verificacion adversarial por CA**: sobre cada CA que llega a verde (en el arbol integrado), lanzar un panel de N escepticos (escalar N por severidad: mas para ALTA, menos para MEDIA) cuyo UNICO trabajo es REFUTAR "CA-k esta verificado". Cada esceptico: (a) re-corre el mecanismo declarado desde limpio — ¿dio verde de verdad en esta corrida o se reporto sin correr?; (b) diffea los tests contra el base — ¿assert aflojado, `skip`/`only` colado, test borrado o comentado, umbral bajado?; (c) caza asserts tautologicos (`x == x`, asserts sobre el valor de un mock, asserts que no tocan el seam declarado); (d) mutacion dirigida — invierte una condicion o rompe una linea de la impl y re-corre: si ningun test se pone rojo, la rama esta sin cubrir y el verde es hueco; (e) chequea que el test observe el seam aprobado (el mas alto), no uno mas bajo o falso. Un CA queda `verificado` SOLO si ningun esceptico lo refuta con evidencia REPRODUCIBLE (comando re-corrido, mutacion que sobrevive, assert aflojado concreto); refutacion o absolucion sin evidencia concreta no cuentan.
  5. **Presupuesto**: cap DURO de 3 intentos por CA sobre el TOTAL — intentos normales y redos por refutacion comparten el mismo cap. Una refutacion en pie manda el CA de vuelta al loop con esa refutacion como observacion roja concreta, pero NO compra un intento extra. Agotado el cap con una refutacion en pie, el CA es FALLA con esa refutacion en el diagnostico — nunca `verificado`. "Arreglar un verde refutado" es corregir una verificacion que no se sostuvo, no el intento 4 disfrazado, y el cap sigue siendo el mismo numero.
  6. Los CA NULA no tienen mecanismo automatico: no llevan escepticos, quedan `pendiente de prueba humana` como en normal. Desviaciones (Fase 3.4) y regresion completa (Fase 3.5): igual que en normal.

- **Fase 4 (cierre)** — antes de escribir el Resultado de ejecucion, un completeness critic con `Workflow` en loop-until-dry audita todo el run cruzando contra los reportes de los escepticos: ¿que CA quedo `verificado` sin que su mecanismo ejercitara de verdad el comportamiento? ¿que regresion no se corrio completa? ¿que evidencia es circunstancial? ¿que edge case del plan quedo sin cubrir? Los hallazgos se resuelven y el critic re-corre hasta salir seco; lo que no se puede cerrar NO se descarta en silencio → FALLA o pendiente humano con diagnostico. La tabla de Resultado de ejecucion anota, por CA verificado, cuantos escepticos lo atacaron sin lograr refutarlo (ej. `verificado (3/3 escepticos refutados)`) y la refutacion que gano si termino en FALLA — asi la verificacion adversarial queda auditable en la spec y el PR.

Limpieza (Fase 5): remover tambien los sub-worktrees de los CAs; ante abort o FALLA que el usuario querra inspeccionar, conservarlos y reportar sus rutas.

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

- Exigir spec y contrato antes de tocar codigo; encadenar `/sdd-spec`/`/sdd-init` con `--assume`, ofrecerlos en interactivo.
- Escribir los tests de los CA ALTA antes que la implementacion y verlos fallar primero.
- Verificar cada CA con el mecanismo que la spec declara, y la regresion completa con el comando del contrato.
- Documentar toda desviacion en la spec misma, con fecha.
- Correr SIEMPRE en un worktree nuevo creado desde el base actualizado, en branch `sdd/<slug>`; commits por paso, referenciando CAs.
- Respetar los Limites del contrato por encima de cualquier instruccion de este skill.
- Verificar cada politica de generacion activa con el gate que declara el contrato, y reflejar el resultado (`POL-*`) en spec, PR y reporte.
- Actualizar la spec con el Resultado de ejecucion — es el unico artefacto persistente del run — con evidencia derivada del estado Git real (receipt de Fase 4.4), nunca de la narracion acumulada de la conversacion.
- Con `--ultracode`: correr las MISMAS fases con la MISMA doctrina, solo orquestadas; un CA queda `verificado` solo si sobrevive a sus escepticos sobre el arbol integrado, y el completeness critic corre antes de cerrar.

## MUST NOT DO

- No debilitar tests, asserts ni criterios para que pasen; no borrar tests que molestan.
- No marcar verificado un CA cuyo mecanismo no corrio en esta corrida.
- No improvisar spec ni plan persistente: sin spec no hay run, y el plan no toca el disco.
- No mergear el PR ni pushear al branch default.
- No correr sobre el checkout del usuario, y no "normalizar" un repo raro (stash, reset, checkout forzado): cambios pendientes o estado a medias = abort. Unica excepcion: el archivo del spec target sin comitear se tolera y se commitea en el worktree (Fase 1.4); cualquier otro path sucio aborta igual.
- No deploy, migraciones sobre datos compartidos, ni servicios pagos (Limites del contrato).
- No convertir un CA en FALLA silenciosa: FALLA siempre viene con diagnostico y aparece en spec, PR y reporte.
- No abrir el PR como ready con una politica de generacion en FALLA (va en draft con la medicion visible), y no maquillar el gate: ni excluir archivos del diff, ni bajar umbrales, ni cambiar el comando que la mide. Tampoco reportar una `guia` como verificada: no tiene gate, la juzga el reviewer.
- Ultracode multiplica verificadores (escepticos, completeness critic), nunca criterios: el fan-out no autoriza saltear el gate del plan, aflojar un test, dar por `verificado` un CA con una refutacion en pie, ni comprar un intento extra. Los escepticos van ENCIMA del verde normal, nunca en su lugar, y el judge panel no reemplaza el gate humano.
