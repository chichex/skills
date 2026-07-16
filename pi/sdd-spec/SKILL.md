---
name: sdd-spec
description: >-
  Convierte un pedido de feature (texto libre, issue de GitHub o handoff confirmado de grill) en una spec verificable — el "que" contra el que /skill:sdd-run trabaja despues. Expone TODAS las inferencias que el modelo hace para que el usuario elija cuales desambiguar, cruza el pedido contra el contrato de autonomia (.sdd/project.md) y emite un veredicto de que tan verificable va a ser la ejecucion (TDD determinista vs e2e flaky vs exige prueba humana), con un plan de verificacion concreto elegido con criterio. Usar SIEMPRE que el usuario quiera especificar una feature antes de implementarla, convertir un handoff o sesion finalizada de grill en spec, escribir criterios de aceptacion, convertir un issue en spec, o diga "hagamos la spec de X", "definamos bien esto antes de codear", "especifica este issue". Exige .sdd/project.md: si no existe, hay que correr /skill:sdd-init primero.
---

Convierte un pedido en una spec: el **"que" verificable** que `/skill:sdd-run` usa como criterio de terminado. La spec no es prosa aspiracional: cada criterio de aceptacion declara COMO se va a verificar y que tan confiable es esa verificacion en ESTE repo. Los argumentos pueden traer el pedido libre ("agregar dark mode al settings"), una referencia a issue (`#42` o URL), un handoff confirmado de `grill`, y/o flags.

Dos ideas fuerza:

1. **Sin contrato no hay spec.** El veredicto de verificabilidad sale de cruzar el pedido con lo que `.sdd/project.md` dice que este repo puede correr HOY. Sin contrato, ese veredicto seria inventado.
2. **Las inferencias van sobre la mesa.** Toda decision que el pedido no fija explicitamente es una inferencia del modelo, y el usuario — no el skill — decide cuales revisar. Inferencias ocultas producen specs que parecen completas pero encodean decisiones que nadie tomo.

## Argumentos

```text
/skill:sdd-spec [pedido libre | #NN | URL de issue] [--from-grill [ID|ruta.md]] [--out local|issue] [--assume]
```

- `--from-grill [ID|ruta.md]` — usa como fuente autoritativa un handoff finalizado. Si no trae referencia, invocar `select_grill_session` con `status: "finalized"` e `intent: "spec-source"`; si trae un ID, resolver `~/.pi/agent/grill-sessions/<ID>.json` y su `.md`; si trae una ruta, leer el Markdown y, si existe, el JSON hermano. Usar `projectPath` del snapshot como raiz operativa.
- `--out local|issue` — destino de la spec sin preguntar. `local` = `.sdd/specs/`; `issue` = actualizar el issue de origen (o crear uno nuevo si el pedido fue libre) **sin crear una copia en `.sdd/specs/`**.
- `--assume` — cero preguntas: cada inferencia nueva se resuelve con el sesgo minimo seguro y queda marcada `[ASSUMED]`; el mecanismo de verificacion propuesto se toma sin confirmar; la spec queda en estado `draft`. Las decisiones ya confirmadas por grill nunca se degradan a supuestos.

## Fase 0 — Lanzador (solo con `/skill:sdd-spec` pelado)

Dispara SOLO cuando el pedido viene vacio y no vino `--from-grill`. Si trajo pedido, issue, handoff o flags, saltear: el usuario ya dijo por donde va.

```text
/skill:sdd-spec convierte un pedido en una spec verificable: expone lo que el modelo esta
infiriendo para que lo desambigues, y te dice que tan verificable va a ser la
ejecucion segun el contrato de autonomia (.sdd/project.md).

  • De una descripcion   — me escribis el pedido y arranco.
  • De un issue abierto  — abro el selector de issues del repo.
  • De un grill cerrado  — elijo un handoff confirmado como fuente.

Atajo: /skill:sdd-spec <pedido | #NN> [--from-grill [ID|ruta.md]] [--out local|issue] [--assume] saltea este menu.
```

Luego usar `ask_user_question` — una pregunta, "¿De donde sale la spec?":

1. `De una descripcion (Recomendado)` — el usuario escribe el pedido (via Other o en el mensaje siguiente).
2. `De un issue abierto` — invocar `select_github_issue`; sus detalles completos son la fuente.
3. `De un grill cerrado` — invocar `select_grill_session` con `status: "finalized"` e `intent: "spec-source"`; no duplicar ni mutar la sesion.

## Fase 1 — Raiz y contrato primero (bloqueante)

1. Resolver la raiz del proyecto sin explorar codigo: cwd para pedido/issue; `projectPath` del snapshot para `--from-grill`. Si el handoff pertenece a otro proyecto, avisar y ejecutar todas las tools con ese `cwd`; nunca escribir la spec en el cwd equivocado.
2. Leer `<raiz>/.sdd/project.md` ANTES de explorar el codigo; interesan sobre todo `## Comandos`, `## Verificacion autonoma` y `## Limites`.

- **Si NO existe**: frenar. Explicar en una linea por que (sin contrato el veredicto de verificabilidad es inventado) y usar `ask_user_question`: 1. `Correr /skill:sdd-init ahora (Recomendado)` — cargar y ejecutar ese skill en la raiz resuelta, esperar el contrato y seguir; 2. `Abortar`. NO generar spec "provisoria" sin contrato, ni siquiera si el usuario insiste con que es una feature chica: ofrecer `/skill:sdd-init --assume` como via rapida.
- **Con `--assume` y sin contrato**: correr `/skill:sdd-init --assume` automaticamente, anotarlo en el reporte, y seguir.
- **Si existe pero esta viejo** (fecha de generacion > 30 dias, o los comandos que este pedido necesita figuran `FALLA` / `no probado`): avisar en una linea y ofrecer `/skill:sdd-init --update`; no bloquear.

## Fase 2 — Entender el pedido

1. Si el pedido es `#NN` o URL: `gh issue view NN --json title,body,comments,labels` (usar la URL con `-R` si es de otro repo). Guardar el numero: importa para el destino en Fase 6. Los comments cuentan como fuente — a veces desambiguan el body.
2. Si la fuente es grill: leer el `handoffMarkdown` finalizado completo. Tratar hechos comprobados y decisiones resueltas como fuente confirmada; conservar restricciones, no-objetivos, supuestos, riesgos, pendientes y contexto recomendado. Si el snapshot no esta `finalized` o no tiene handoff, frenar y pedir que se cierre el grill. No re-preguntar decisiones confirmadas. Si el snapshot trae `sourceIssue`, heredarlo como issue de origen de la spec; para snapshots legacy, aceptar `Issue #NN` en el topic/handoff como fallback y dejar la referencia estructurada en la spec.
3. Explorar el codigo con `read`, `bash` y llamadas paralelas solo cuando sean independientes: relevar que existe hoy, archivos potenciales, convenciones, tests previos, dependencias y blast radius. La spec se escribe contra el codigo real, no contra la idea del codigo.
4. Revisar `.sdd/specs/`: si ya hay una spec para este mismo pedido, issue o grill ID, avisar y tratar la corrida como actualizacion, no crear otra.

## Fase 3 — Inferencias sobre la mesa

El corazon del skill. Toda decision que el pedido no fija explicitamente se lista como inferencia — tambien las de confianza alta, porque el usuario decide cuales revisar, no el skill. Categorias tipicas: alcance (que entra y que no), comportamiento en bordes y errores, UX/copys, datos (¿migracion? ¿backfill?), compatibilidad hacia atras, plataformas.

Mostrar la tabla completa numerada:

```markdown
| # | Inferencia | Eleccion propuesta | Alternativa razonable | Confianza |
|---|---|---|---|---|
| 1 | ¿El toggle persiste entre sesiones? | Si, en localStorage | Solo en memoria / en el perfil del user | media |
| 2 | ¿Aplica a paginas de admin? | No, solo app publica | Tambien admin | alta |
```

Luego usar `ask_user_question` una sola vez para elegir cuales revisar:

- Pregunta: `Marcá las inferencias que querés revisar. Si todas están bien, enviá sin marcar ninguna.`
- `selectionMode: "multiple"`, `allowEmptySelection: true`, `allowOther: false`.
- Una opcion por inferencia, con value estable (`inference-1`, `inference-2`, etc.), label `#N — <inferencia>` y description `Propuesta: <...> · Alternativa: <...> · Confianza: <...>`.
- Las inferencias de confianza baja se marcan `recommended: true`, con el motivo de por que conviene revisarlas.
- Cero opciones seleccionadas significa aceptar todas las propuestas. Por cada inferencia seleccionada, hacer UNA pregunta posterior con las alternativas concretas como opciones, la propuesta primera y marcada `(Recomendado)`.
- No volver a pedir numeros por texto libre ni usar el flujo binario `Ninguna` / `Revisar algunas`.

Reglas: lo que el pedido o el handoff confirmado ya fija NO es inferencia y no se lista (listarlo diluye la tabla). Ante conflicto entre el handoff y el codigo actual, mostrarlo como gap/desviacion de fuente; no reinterpretar silenciosamente la decision. Si una inferencia de confianza baja define el alcance entero (ej. "¿esto es solo UI o tambien API?") y el usuario no la selecciona, respetar su eleccion pero marcarla en la spec como riesgo. Con `--assume`: elegir el sesgo minimo seguro (la opcion mas chica y reversible) y marcar `[ASSUMED]` en la spec.

## Fase 4 — Veredicto de verificabilidad

Cruzar cada criterio de aceptacion contra la escalera de `## Verificacion autonoma` del contrato. Grados:

| Grado | Cuando | Ejemplo |
|---|---|---|
| **ALTA** | El comportamiento se expresa como tests unit/integration deterministas que el contrato sabe correr en verde hoy. TDD puro: golazo. | logica de negocio, parsers, API handlers |
| **MEDIA** | Requiere levantar la app y probarla, o e2e con browser (playwright y similares): verificable pero flaky y lento. | UI web, flows con estado, integraciones locales |
| **BAJA** | Solo llegan señales indirectas (typecheck, build, lint); el comportamiento real no se observa de forma autonoma. | detalle visual fino, copys, layout |
| **NULA** | Exige algo fuera del alcance del agente: dispositivo fisico, servicio pago, ambiente inaccesible. Requiere prueba del usuario. | app en telefono real, push notifications, hardware |

Reglas:

- El grado sale de lo que el contrato dice que se puede correr HOY, no de lo teoricamente posible. Una feature TDD-able en un repo cuyo test runner figura `FALLA` NO es ALTA — es BAJA hasta que alguien arregle el runner, y se dice explicitamente ("seria ALTA si `pnpm test` funcionara — ver Gaps del contrato").
- Si los criterios tienen grados distintos, NO promediar: desglosar por criterio y reportar mixto ("CA-1..CA-3 ALTA; CA-4 NULA — vibracion en dispositivo, exige prueba tuya").
- Mostrar el veredicto al usuario con el porque ANTES de elegir mecanismo: es el dato que le dice cuanto puede delegar de la ejecucion.

## Fase 5 — Mecanismo de verificacion

Elegir con criterio = proponer el mecanismo MAS BARATO que observe el comportamiento real, no el mas impresionante. Orden de preferencia: test unit > integration > levantar la app con probe scripteado (curl, señal de log) > e2e browser > prueba humana. Un e2e de playwright para logica que se testea unit es eleccion incorrecta aunque funcione.

1. Proponer por cada criterio de aceptacion el como concreto: comando, assertion o señal observable, anclado en los comandos del contrato.
2. Usar `ask_user_question` — "¿Con que lo verificamos?": la propuesta primera y marcada `(Recomendado)`, 1-2 alternativas reales (una mas exhaustiva, una mas barata) con su trade-off en la descripcion, y el usuario puede proponer otra via custom. Con `--assume`: tomar la propuesta sin preguntar.
3. Para los criterios NULA: escribir el **protocolo de prueba humana** — pasos concretos y chequeables que el usuario va a seguir ("1. Abri la app en tu iPhone... 2. Confirma un pago... 3. Verifica que vibro"). La spec no esconde la parte manual: la agenda.

## Fase 6 — Escribir la spec

Con EXACTAMENTE esta estructura:

```markdown
# Spec — <titulo>
<!-- Generada por /skill:sdd-spec el <fecha>. Fuente: <pedido libre | issue #NN | grill <ID>>. Estado: <aprobada|draft> -->
<!-- SDD-Tracking: issue=<#NN|owner/repo#NN|none>; grill=<ID|none> -->

## Contexto
<por que existe el pedido + que hay en el codigo hoy; 2-4 lineas con referencias reales>

## Comportamiento esperado
<criterios de aceptacion CA-1..CA-n, cada uno observable (se puede decir paso/no paso
sin interpretacion) y con su grado de verificabilidad al lado>

## Fuera de alcance
<lo que NO entra, derivado de las inferencias de alcance>

## Inferencias
<la tabla de Fase 3 + columna Resolucion: confirmada | elegida por usuario: <x> | [ASSUMED]>

## Verificabilidad
<veredicto global (o mixto, por CA) con el porque anclado en el contrato>

## Plan de verificacion
<mecanismo elegido y por CA: comando / assertion / señal. Si hay parte humana:
el protocolo de prueba paso a paso>

## Riesgos y gaps
<[ASSUMED] riesgosos, dependencias, flakiness conocida, [NEEDS-INPUT] pendientes>
```

Estado: `aprobada` si el usuario reviso inferencias y mecanismo; `draft` si corrio con `--assume`.

Destino (saltear pregunta si vino `--out`):

- **El pedido vino de un issue** — usar `ask_user_question`: 1. `Actualizar el issue (Recomendado)` — reescribir el body con la spec, archivando el body original al final dentro de un `<details><summary>Body original</summary>`; aclarar en la descripcion de esta opcion que **no crea un archivo en `.sdd/specs/`**. 2. `Local` — `.sdd/specs/issue-NN-<slug>.md`; 3. `Ambos`.
- **Pedido libre o grill sin issue de origen** — usar `ask_user_question`: 1. `Local (Recomendado)` — `.sdd/specs/<slug>.md`; 2. `Crear issue` — `gh issue create` con la spec como body. Si se crea un issue nuevo, reemplazar inmediatamente `issue=none` por el número devuelto antes de dar la spec por lista.
- Con `--assume` y sin `--out`: local.

`SDD-Tracking` es metadata local/machine-readable para que `/issues` pueda asociar artefactos sin ensuciar GitHub con labels o comments de tracking. Si la spec vive en el body del issue, conservar también el marker allí.

## Reporte

```text
Spec lista: <ruta local y/o issue #NN actualizado>
- criterios de aceptacion: <N> (ALTA <a> · MEDIA <m> · BAJA <b> · NULA <h>)
- verificabilidad global: <grado o mixto> — <motivo en una linea>
- mecanismo: <elegido> (<confirmado por usuario | asumido>)
- inferencias: <N> sobre la mesa · <K> revisadas por el usuario · <A> asumidas
- siguiente paso: /skill:sdd-run <ruta | #NN>
<si hubo que correr /skill:sdd-init, o hay CA NULA que exigen prueba humana, una linea por cada uno>
```

## MUST DO

- Leer `.sdd/project.md` antes que nada; si no existe, exigir `/skill:sdd-init` primero (u orquestarlo con `--assume`).
- Si la fuente es grill, validar que este finalizado, trabajar en su `projectPath` y conservar sus decisiones como confirmadas.
- Listar TODAS las inferencias nuevas, tambien las de confianza alta — elegir cuales revisar es del usuario.
- Anclar cada grado de verificabilidad en lo que el contrato dice que corre HOY, citando el comando o gap concreto.
- Proponer el mecanismo de verificacion mas barato que observe el comportamiento real, y dejar que el usuario lo cambie o proponga otro.
- Escribir criterios de aceptacion observables: paso/no paso sin interpretacion.
- Ser idempotente: re-correr sobre el mismo pedido actualiza la spec existente, no crea otra.
- Emitir siempre el comment `SDD-Tracking` y preservar la referencia al issue heredada del pedido o del `sourceIssue` del grill.

## MUST NOT DO

- No generar spec sin contrato, ni "provisoria".
- No esconder decisiones en la prosa: toda eleccion no fijada por el pedido va a la tabla de inferencias.
- No inflar el veredicto: runner roto en el contrato = la feature no es ALTA por mas TDD-able que sea.
- No prometer verificacion autonoma de lo que exige humano — declararlo NULA y escribir el protocolo manual.
- No tocar codigo ni commitear: la spec (y el issue, si se eligio) es el unico output.
- No pisar el body de un issue sin archivar el original en un `<details>`.
- No preguntar lo que el pedido o el handoff confirmado ya fija.
- No convertir decisiones confirmadas del grill en `[ASSUMED]` ni escribir la spec en un proyecto distinto al `projectPath` del snapshot.
