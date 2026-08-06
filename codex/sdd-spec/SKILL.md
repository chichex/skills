---
name: sdd-spec
description: >-
  Convierte un pedido de feature (texto libre, issue de GitHub o handoff confirmado de grill) en una spec verificable — el "qué" contra el que $sdd-run trabaja después. Expone TODAS las inferencias que el modelo hace para que el usuario elija cuáles desambiguar, cruza el pedido contra el contrato de autonomía (.sdd/project.md) y emite un veredicto de qué tan verificable va a ser la ejecución (TDD determinista vs e2e flaky vs exige prueba humana), con un plan de verificación concreto elegido con criterio. Usar SIEMPRE que el usuario quiera especificar una feature antes de implementarla, convertir un handoff o sesión finalizada de grill en spec, escribir criterios de aceptación, convertir un issue en spec, o diga "hagamos la spec de X", "definamos bien esto antes de codear", "especifica este issue". Exige .sdd/project.md: si no existe, hay que correr $sdd-init primero.
---

Convierte un pedido en una spec: el **"qué" verificable** que `$sdd-run` usa como criterio de terminado. La spec no es prosa aspiracional: cada criterio de aceptación declara CÓMO se va a verificar y qué tan confiable es esa verificación en ESTE repo. Los argumentos pueden traer el pedido libre ("agregar dark mode al settings"), una referencia a issue (`#42` o URL), un handoff confirmado de `grill`, y/o flags.

En Codex, usar `request_user_input` solo cuando esté disponible y la decisión tenga 2-3 opciones mutuamente excluyentes. Para selección múltiple o más opciones, preguntar en texto plano, terminar el turno y continuar tras la respuesta.

Dos ideas fuerza:

1. **Sin contrato no hay spec.** El veredicto de verificabilidad sale de cruzar el pedido con lo que `.sdd/project.md` dice que este repo puede correr HOY. Sin contrato, ese veredicto sería inventado.
2. **Las inferencias van sobre la mesa.** Toda decisión que el pedido no fija explícitamente es una inferencia del modelo, y el usuario — no el skill — decide cuáles revisar. Inferencias ocultas producen specs que parecen completas pero encodean decisiones que nadie tomó.

## Argumentos

```text
$sdd-spec [pedido libre | #NN | URL de issue] [--from-grill [ruta.md]] [--out local|issue] [--assume]
```

- `--from-grill [ruta.md]` — usa como fuente autoritativa un handoff finalizado en `.sdd/grills/` o en la ruta indicada. Si no trae referencia, listar los handoffs `finalized` del proyecto y pedir elegir solo cuando haya más de uno. Usar la ruta `Proyecto` declarada en el handoff como raíz operativa.
- `--out local|issue` — destino de la spec sin preguntar. `local` = `.sdd/specs/`; `issue` = actualizar el issue de origen (o crear uno nuevo si el pedido fue libre) **sin crear una copia en `.sdd/specs/`**.
- `--assume` — cero preguntas: cada inferencia nueva se resuelve con el sesgo mínimo seguro y queda marcada `[ASSUMED]`; el mecanismo de verificación propuesto se toma sin confirmar; la spec queda en estado `draft`. Las decisiones ya confirmadas por grill nunca se degradan a supuestos.

## Fase 0 — Lanzador (solo con `$sdd-spec` pelado)

Dispara SOLO cuando el pedido viene vacío y no vino `--from-grill`. Si trajo pedido, issue, handoff o flags, saltear: el usuario ya dijo por dónde va.

```text
$sdd-spec convierte un pedido en una spec verificable: expone lo que el modelo esta
infiriendo para que lo desambigues, y te dice que tan verificable va a ser la
ejecucion segun el contrato de autonomia (.sdd/project.md).

  • De una descripcion   — me escribis el pedido y arranco.
  • De un issue abierto  — abro el selector de issues del repo.
  • De un grill cerrado  — elijo un handoff confirmado como fuente.

Atajo: $sdd-spec <pedido | #NN> [--from-grill [ID|ruta.md]] [--out local|issue] [--assume] saltea este menu.
```

Luego usar `request_user_input` — una pregunta, "¿De dónde sale la spec?":

1. `De una descripcion (Recomendado)` — el usuario escribe el pedido (vía Other o en el mensaje siguiente).
2. `De un issue abierto` — invocar `github-issue-selector`; sus detalles completos son la fuente.
3. `De un grill cerrado` — listar `.sdd/grills/*.md`, filtrar los que declaren `Estado: finalized` y elegir el handoff sin mutarlo.

## Fase 1 — Raíz y contrato primero (bloqueante)

1. Resolver la raíz del proyecto sin explorar código: cwd para pedido/issue; campo `Proyecto` del handoff para `--from-grill`. Si el handoff pertenece a otro proyecto, avisar y ejecutar todas las tools con ese `cwd`; nunca escribir la spec en el cwd equivocado.
2. Leer `<raiz>/.sdd/project.md` ANTES de explorar el código; interesan sobre todo `## Comandos`, `## Verificacion autonoma`, `## Limites` y `## Politicas de generacion` (los gates duros que `$sdd-run` va a aplicar — condicionan el veredicto y el tamaño sano de la spec).

- **Si NO existe**: frenar. Explicar en una línea por qué (sin contrato el veredicto de verificabilidad es inventado) y usar `request_user_input`: 1. `Correr $sdd-init ahora (Recomendado)` — cargar y ejecutar ese skill en la raíz resuelta, esperar el contrato y seguir; 2. `Abortar`. NO generar spec "provisoria" sin contrato, ni siquiera si el usuario insiste con que es una feature chica: ofrecer `$sdd-init --assume` como vía rápida.
- **Con `--assume` y sin contrato**: correr `$sdd-init --assume` automáticamente, anotarlo en el reporte, y seguir.
- **Si existe pero está viejo** (fecha de generación > 30 días, o los comandos que este pedido necesita figuran `FALLA` / `no probado`): avisar en una línea y ofrecer `$sdd-init --update`; no bloquear.

## Fase 2 — Entender el pedido

1. Si el pedido es `#NN` o URL: `gh issue view NN --json title,body,comments,labels` (usar la URL con `-R` si es de otro repo). Guardar el número: importa para el destino en Fase 6. Los comments cuentan como fuente — a veces desambiguan el body.
2. Si la fuente es grill: leer el Markdown finalizado completo. Tratar hechos comprobados y decisiones resueltas como fuente confirmada; conservar restricciones, no-objetivos, supuestos, riesgos, pendientes y contexto recomendado. Si el archivo no declara `Estado: finalized` o no tiene `## Handoff`, frenar y pedir que se cierre el grill. No re-preguntar decisiones confirmadas. Si el encabezado `Fuente` referencia un issue, heredarlo como issue de origen de la spec.
3. Explorar el código con lectura de archivos y shell y llamadas paralelas solo cuando sean independientes: relevar qué existe hoy, archivos potenciales, convenciones, tests previos, dependencias y blast radius. La spec se escribe contra el código real, no contra la idea del código.
4. Revisar `.sdd/specs/`: si ya hay una spec para este mismo pedido, issue o ruta de handoff, avisar y tratar la corrida como actualización, no crear otra.

## Fase 3 — Inferencias sobre la mesa

El corazón del skill. Toda decisión que el pedido no fija explícitamente se lista como inferencia — también las de confianza alta, porque el usuario decide cuáles revisar, no el skill. Categorías típicas: alcance (qué entra y qué no), comportamiento en bordes y errores, UX/copys, datos (¿migración? ¿backfill?), compatibilidad hacia atrás, plataformas.

Mostrar la tabla completa numerada:

```markdown
| # | Inferencia | Eleccion propuesta | Alternativa razonable | Confianza |
|---|---|---|---|---|
| 1 | ¿El toggle persiste entre sesiones? | Si, en localStorage | Solo en memoria / en el perfil del user | media |
| 2 | ¿Aplica a paginas de admin? | No, solo app publica | Tambien admin | alta |
```

Pedir en texto plano: `Indicá los números de las inferencias que querés revisar, separados por comas; respondé "ninguna" para aceptar todas las propuestas.` Terminar el turno y esperar. Resaltar las inferencias de confianza baja y explicar por qué conviene revisarlas.

`ninguna` significa aceptar todas las propuestas. Por cada inferencia seleccionada, hacer UNA pregunta posterior con las alternativas concretas, la propuesta primera y marcada `(Recomendado)`.

Reglas: lo que el pedido o el handoff confirmado ya fija NO es inferencia y no se lista (listarlo diluye la tabla). Ante conflicto entre el handoff y el código actual, mostrarlo como gap/desviación de fuente; no reinterpretar silenciosamente la decisión. Si una inferencia de confianza baja define el alcance entero (ej. "¿esto es solo UI o también API?") y el usuario no la selecciona, respetar su elección pero marcarla en la spec como riesgo. Con `--assume`: elegir el sesgo mínimo seguro (la opción más chica y reversible) y marcar `[ASSUMED]` en la spec.

## Fase 4 — Veredicto de verificabilidad

Cruzar cada criterio de aceptación contra la escalera de `## Verificacion autonoma` del contrato. Grados:

| Grado | Cuando | Ejemplo |
|---|---|---|
| **ALTA** | El comportamiento se expresa como tests unit/integration deterministas que el contrato sabe correr en verde hoy. TDD puro: golazo. | lógica de negocio, parsers, API handlers |
| **MEDIA** | Requiere levantar la app y probarla, o e2e con browser (playwright y similares): verificable pero flaky y lento. | UI web, flows con estado, integraciones locales |
| **BAJA** | Solo llegan señales indirectas (typecheck, build, lint); el comportamiento real no se observa de forma autónoma. | detalle visual fino, copys, layout |
| **NULA** | Exige algo fuera del alcance del agente: dispositivo físico, servicio pago, ambiente inaccesible. Requiere prueba del usuario. | app en teléfono real, push notifications, hardware |

Reglas:

- El grado sale de lo que el contrato dice que se puede correr HOY, no de lo teóricamente posible. Una feature TDD-able en un repo cuyo test runner figura `FALLA` NO es ALTA — es BAJA hasta que alguien arregle el runner, y se dice explícitamente ("sería ALTA si `pnpm test` funcionara — ver Gaps del contrato").
- Si los criterios tienen grados distintos, NO promediar: desglosar por criterio y reportar mixto ("CA-1..CA-3 ALTA; CA-4 NULA — vibración en dispositivo, exige prueba tuya").
- Cruzar el alcance contra las políticas de generación del contrato y decirlo en el veredicto: una spec cuyo blast-radius estimado excede el *tamaño máximo de PR* se reporta con propuesta de partición (2+ specs encadenadas, cada una dentro del límite) — mejor partir acá que descubrirlo con el PR en draft. Un *coverage mínimo* activo sube la vara del plan de verificación: los tests de los CA ALTA tienen que cubrir el código nuevo, no solo el happy path. *Dependencias nuevas: prohibido* convierte cualquier CA que exija una dep en conflicto a resolver en la spec, no en el run. Las políticas de la tecnología con gate (linter, script) integran la vara igual que coverage; las filas `guia` no gatean ni cambian el veredicto.
- Mostrar el veredicto al usuario con el porqué ANTES de elegir mecanismo: es el dato que le dice cuánto puede delegar de la ejecución.

## Fase 5 — Mecanismo de verificación

Elegir con criterio = proponer el mecanismo MÁS BARATO que observe el comportamiento real, no el más impresionante. Orden de preferencia: test unit > integration > levantar la app con probe scripteado (curl, señal de log) > e2e browser > prueba humana. Un e2e de playwright para lógica que se testea unit es elección incorrecta aunque funcione.

1. Proponer por cada criterio de aceptación el cómo concreto: comando, assertion o señal observable, anclado en los comandos del contrato.
2. Usar `request_user_input` — "¿Con qué lo verificamos?": la propuesta primera y marcada `(Recomendado)`, 1-2 alternativas reales (una más exhaustiva, una más barata) con su trade-off en la descripción, y el usuario puede proponer otra vía custom. Con `--assume`: tomar la propuesta sin preguntar.
3. Para los criterios NULA: escribir el **protocolo de prueba humana** — pasos concretos y chequeables que el usuario va a seguir ("1. Abrí la app en tu iPhone... 2. Confirma un pago... 3. Verifica que vibró"). La spec no esconde la parte manual: la agenda.

## Fase 6 — Escribir la spec

Con EXACTAMENTE esta estructura:

```markdown
# Spec — <titulo>
<!-- Generada por $sdd-spec el <fecha>. Fuente: <pedido libre | issue #NN | grill <ruta>>. Estado: <aprobada|draft> -->
<!-- SDD-Tracking: issue=<#NN|owner/repo#NN|none>; grill=<ruta|none> -->

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
<[ASSUMED] riesgosos, dependencias, flakiness conocida, [NEEDS-INPUT] pendientes,
conflictos con politicas de generacion del contrato (tamaño, coverage, deps)>
```

Estado: `aprobada` si el usuario revisó inferencias y mecanismo; `draft` si corrió con `--assume`.

Destino (saltear pregunta si vino `--out`):

- **El pedido vino de un issue** — usar `request_user_input`: 1. `Actualizar el issue (Recomendado)` — reescribir el body con la spec, archivando el body original al final dentro de un `<details><summary>Body original</summary>`; aclarar en la descripción de esta opción que **no crea un archivo en `.sdd/specs/`**. 2. `Local` — `.sdd/specs/issue-NN-<slug>.md`; 3. `Ambos`.
- **Pedido libre o grill sin issue de origen** — usar `request_user_input`: 1. `Local (Recomendado)` — `.sdd/specs/<slug>.md`; 2. `Crear issue` — `gh issue create` con la spec como body. Si se crea un issue nuevo, reemplazar inmediatamente `issue=none` por el número devuelto antes de dar la spec por lista.
- Con `--assume` y sin `--out`: local.

`SDD-Tracking` es metadata local/machine-readable para que `/issues` pueda asociar artefactos sin ensuciar GitHub con labels o comments de tracking. Si la spec vive en el body del issue, conservar también el marker allí.

## Reporte

```text
Spec lista: <ruta local y/o issue #NN actualizado>
- criterios de aceptacion: <N> (ALTA <a> · MEDIA <m> · BAJA <b> · NULA <h>)
- verificabilidad global: <grado o mixto> — <motivo en una linea>
- mecanismo: <elegido> (<confirmado por usuario | asumido>)
- inferencias: <N> sobre la mesa · <K> revisadas por el usuario · <A> asumidas
- siguiente paso: $sdd-run <ruta | #NN>
<si hubo que correr $sdd-init, hay CA NULA que exigen prueba humana, o una politica de
generacion condiciona la ejecucion (particion por tamaño, coverage), una linea por cada uno>
```

## MUST DO

- Leer `.sdd/project.md` antes que nada; si no existe, exigir `$sdd-init` primero (u orquestarlo con `--assume`).
- Si la fuente es grill, validar que esté finalizado, trabajar en el proyecto declarado por el handoff y conservar sus decisiones como confirmadas.
- Listar TODAS las inferencias nuevas, también las de confianza alta — elegir cuáles revisar es del usuario.
- Anclar cada grado de verificabilidad en lo que el contrato dice que corre HOY, citando el comando o gap concreto.
- Cruzar el alcance contra las políticas de generación del contrato y avisar en el veredicto si la spec choca con alguna (en particular: proponer partición si no entra en el tamaño máximo de PR).
- Proponer el mecanismo de verificación más barato que observe el comportamiento real, y dejar que el usuario lo cambie o proponga otro.
- Escribir criterios de aceptación observables: pasó/no pasó sin interpretación.
- Ser idempotente: re-correr sobre el mismo pedido actualiza la spec existente, no crea otra.
- Emitir siempre el comment `SDD-Tracking` y preservar la referencia al issue heredada del pedido o del campo `Fuente` del handoff.

## MUST NOT DO

- No generar spec sin contrato, ni "provisoria".
- No esconder decisiones en la prosa: toda elección no fijada por el pedido va a la tabla de inferencias.
- No inflar el veredicto: runner roto en el contrato = la feature no es ALTA por más TDD-able que sea.
- No prometer verificación autónoma de lo que exige humano — declararlo NULA y escribir el protocolo manual.
- No tocar código ni commitear: la spec (y el issue, si se eligió) es el único output.
- No pisar el body de un issue sin archivar el original en un `<details>`.
- No preguntar lo que el pedido o el handoff confirmado ya fija.
- No convertir decisiones confirmadas del grill en `[ASSUMED]` ni escribir la spec en un proyecto distinto al declarado por el handoff.
