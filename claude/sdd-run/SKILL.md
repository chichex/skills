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
/sdd-run [.sdd/specs/<spec>.md | #NN] [--assume] [--no-pr] [--base <branch>]
```

- `--assume` — cero preguntas: encadena `/sdd-spec --assume` (y este `/sdd-init --assume`) si faltan precondiciones, saltea el gate del plan, y resuelve desviaciones con sesgo minimo seguro. Para correr desatendido.
- `--no-pr` — frena despues del commit en el branch: no pushea ni crea PR. Para repos sin remote o cuando el PR lo arma el usuario.
- `--base <branch>` — branch base para ramificar y para el PR (default: el branch default que declara el contrato — main/master/otro).

## Fase 0 — Lanzador (solo con `/sdd-run` pelado)

Dispara SOLO cuando los argumentos vienen vacios. Si trajo spec, issue o flags, saltear.

Listar las specs de `.sdd/specs/` con su estado y verificabilidad (leer el header y la seccion Verificabilidad de cada una):

```text
/sdd-run implementa una spec hasta que cada criterio este verificado, y termina en un PR
con la evidencia. Specs disponibles:

  1. dark-mode-toggle.md      (aprobada · MIXTA: ALTA 4 / MEDIA 1 / NULA 1)
  2. issue-12-rate-limit.md   (draft · ALTA)

Atajo: /sdd-run <spec|#NN> [--assume] [--no-pr] saltea este menu.
```

Luego usar `question` — "¿Cual spec corremos?": una opcion por spec (maximo 4, las mas recientes; el resto via custom) + `Ninguna, hay que especificar primero` → ofrecer `/sdd-spec`.

## Fase 1 — Precondiciones (bloqueante)

1. **Contrato**: leer `.sdd/project.md`. Si no existe: interactivo → ofrecer `/sdd-init` ahi mismo; `--assume` → correr `/sdd-init --assume` y seguir. Anotar ya la capacidad de PR que declara el contrato (remote + gh): si no la hay, avisar desde el arranque que la corrida termina en commit local.
2. **Spec**: resolver el argumento. Ruta → leerla. `#NN` → `gh issue view` y extraer la spec del body (la genero `/sdd-spec`); si el issue no tiene spec SDD, frenar y ofrecer `/sdd-spec #NN`. Pedido libre sin spec → frenar: ofrecer `/sdd-spec <pedido>` (interactivo) o encadenarlo (`--assume`). NO improvisar una spec: ese trabajo tiene su skill.
3. **Spec en `draft`**: significa que nadie reviso las inferencias — correrla es aceptar todas las `[ASSUMED]`. Interactivo: decirlo y preguntar si seguir (u ofrecer revisar las inferencias aca, una pregunta por inferencia de confianza baja). `--assume`: seguir y dejarlo anotado en el PR.
4. **Worktree limpio desde main actualizado — o abort**: `/sdd-run` NUNCA corre sobre el checkout del usuario. Preflight: `git fetch` (si hay remote) y chequear estado sano. Ante CUALQUIER cosa rara — cambios sin commitear, rebase/merge a medias, detached HEAD, base local divergido de su remote — **ABORTAR** explicando exactamente que se encontro. No arreglar nada (ni stash, ni reset, ni checkout): si el repo esta raro, el humano esta en el medio de algo. Con todo sano: crear un worktree nuevo con branch `sdd/<slug>` desde el base actualizado (`--base`; default: el branch default que declara el contrato, y si el contrato no lo dice, detectarlo — nunca asumir "main") — con la herramienta de worktrees del harness si esta disponible, si no `git worktree add ../<repo>-sdd-<slug> -b sdd/<slug> <base>` — y TODO el run pasa ahi adentro.

## Fase 2 — Plan efimero + gate

Planificar contra el codigo real, no contra la idea del codigo (explorar lo que la spec va a tocar; subagents en repos grandes):

- Pasos mapeados a CAs: cada paso dice que CA ataca y como se va a verificar (heredado del Plan de verificacion de la spec). Trabajo que no mapea a ningun CA no entra al plan — es señal de scope creep o de spec incompleta.
- Orden test-first para los CA ALTA: los tests del plan de verificacion se escriben ANTES que la implementacion, y tienen que fallar primero (rojo → verde es la evidencia de que el test observa algo real).
- El plan declara los **seams** bajo prueba — las interfaces publicas donde se observa comportamiento (doctrina de `/tdd`). Preferir seams existentes, y el mas alto posible; el gate del plan es donde el usuario los aprueba.
- Si el plan revela que un CA es incoherente con el codigo real (la spec asumio algo que no existe): NO improvisar — es una desviacion, se maneja como dice la Fase 3.

**Gate**: presentar el plan resumido (pasos ↔ CAs, archivos que toca, que queda explicitamente afuera) y usar `question`: `Aprobar (Recomendado)` / `Ajustar` (el usuario dice que via custom y se replantea). Con `--assume`: sin gate. El plan NO se escribe a disco — vive en la conversacion y muere con ella.

## Fase 3 — Implementar con loop de verificacion por CA

1. **Tests primero** (CA ALTA): escribir los tests del plan de verificacion con la doctrina de `/tdd` — solo en los seams aprobados en el gate, comportamiento por interfaces publicas, mocks solo en limites de sistema, nunca tautologicos — correrlos, confirmar que fallan por la razon correcta. Recien despues implementar hasta verde.
2. **Verificar cada CA con SU mecanismo** — el que la spec declara, no otro: unit con el comando del contrato, integration, probe scripteado (curl / señal de log), e2e. Para CA MEDIA con flakiness declarada en el contrato: aplicar su politica (ej. reintentar una vez antes de creer un rojo) y NUNCA concluir de una sola corrida flaky.
3. **Presupuesto por CA**: 3 intentos honestos. Si un CA sigue en rojo al tercero, se congela: queda FALLA con diagnostico concreto (que se probo, que dio, hipotesis) y se sigue con los demas CAs si son independientes. Prohibido el intento numero 4 disfrazado de "refactor".
4. **Desviaciones**: si la implementacion revela que la spec esta mal (inferencia `[ASSUMED]` incorrecta, CA imposible como esta escrito): interactivo → preguntar y editar la spec con una linea de changelog fechada; `--assume` → si NO cambia el alcance, documentar `[DEVIATION]` en la spec y seguir; si cambia el alcance, abortar honesto con el estado committeado en el branch. Nunca desviarse en silencio: una spec que dice A con un codigo que hace B mata la confianza en todo el pipeline.
5. **Regresion**: la suite existente completa (comando del contrato) tiene que quedar verde, no solo los tests nuevos.
6. Commitear por pasos coherentes (mensaje referencia el CA: `CA-2: rate limit por IP con ventana deslizante`), nunca un mega-commit final.

## Fase 4 — Verificacion final y cierre de la spec

1. Correr la escalera del contrato completa hasta su techo (typecheck, unit, build, levantar la app y probarla si el contrato sabe como).
2. **CA NULA**: no se implementan a ciegas ni se verifican por decreto — quedan `pendiente de prueba humana` con el protocolo de la spec listo para ejecutar. No bloquean el PR: se listan como checklist en el body.
3. Actualizar la spec (unico artefacto que persiste): estado del header a `implementada`, y una seccion nueva al final:

```markdown
## Resultado de ejecucion (<fecha>)
| CA | Estado | Evidencia |
|---|---|---|
| CA-1 | verificado | npm test: 8/8 verdes (3 nuevos) |
| CA-4 | FALLA | timeout en probe; diagnostico en PR |
| CA-5 | pendiente humano | protocolo en la spec, checklist en el PR |
```

## Fase 5 — PR

Saltear con `--no-pr` (el run termina con el branch committeado y lo dice).

1. **Aptitud primero, push despues**: si el contrato declara que no hay remote o gh no esta autenticado, degradar automaticamente a `--no-pr` (commit local) y avisar — no descubrirlo con un push fallido. Con aptitud ok: push del branch (`git push -u origin sdd/<slug>`), respetando los Limites del contrato — si el contrato prohibe push en general (no solo a main), degradar a commit local, avisar, y listar el comando que el usuario debe correr.
2. `gh pr create` — base `--base`, titulo = titulo de la spec. Body: la spec completa (con su Resultado de ejecucion) + checklist de protocolo humano si hay CA NULA + `Closes #NN` si la spec vino de un issue. Cerrar con la firma estandar de PR.
3. NO mergear: el merge es del humano, siempre.
4. Limpiar: remover el worktree (`git worktree remove`) — el branch y sus commits quedan en el repo. Si el run aborto a medias o quedo con FALLAs que el usuario querra inspeccionar en caliente, conservarlo y reportar la ruta.

## Reporte

```text
Run completo: PR #<n> <url>   (o: branch sdd/<slug> committeado, sin PR)
- spec: <ruta> (<estado previo> → implementada)
- CAs: <N> — verificados <V> · FALLA <F> · pendiente humano <H>
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
- Actualizar la spec con el Resultado de ejecucion — es el unico artefacto persistente del run.

## MUST NOT DO

- No debilitar tests, asserts ni criterios para que pasen; no borrar tests que molestan.
- No marcar verificado un CA cuyo mecanismo no corrio en esta corrida.
- No improvisar spec ni plan persistente: sin spec no hay run, y el plan no toca el disco.
- No mergear el PR ni pushear al branch default.
- No correr sobre el checkout del usuario, y no "normalizar" un repo raro (stash, reset, checkout forzado): cambios pendientes o estado a medias = abort.
- No deploy, migraciones sobre datos compartidos, ni servicios pagos (Limites del contrato).
- No convertir un CA en FALLA silenciosa: FALLA siempre viene con diagnostico y aparece en spec, PR y reporte.
