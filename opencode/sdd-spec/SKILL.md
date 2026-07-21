---
name: sdd-spec
description: >-
  Convierte un pedido de feature (texto libre o issue de GitHub) en una spec verificable — el "que" contra el que /sdd-run trabaja despues. Expone TODAS las inferencias que el modelo hace para que el usuario elija cuales desambiguar, cruza el pedido contra el contrato de autonomia (.sdd/project.md) y emite un veredicto de que tan verificable va a ser la ejecucion (TDD determinista vs e2e flaky vs exige prueba humana), con un plan de verificacion concreto elegido con criterio. Usar SIEMPRE que el usuario quiera especificar una feature antes de implementarla, escribir criterios de aceptacion, convertir un issue en spec, o diga "hagamos la spec de X", "definamos bien esto antes de codear", "especifica este issue". Exige .sdd/project.md: si no existe, hay que correr /sdd-init primero.
---

Convierte un pedido en una spec: el **"que" verificable** que `/sdd-run` usa como criterio de terminado. La spec no es prosa aspiracional: cada criterio de aceptacion declara COMO se va a verificar y que tan confiable es esa verificacion en ESTE repo. Los argumentos pueden traer el pedido libre ("agregar dark mode al settings"), una referencia a issue (`#42` o URL), y/o flags.

Dos ideas fuerza:

1. **Sin contrato no hay spec.** El veredicto de verificabilidad sale de cruzar el pedido con lo que `.sdd/project.md` dice que este repo puede correr HOY. Sin contrato, ese veredicto seria inventado.
2. **Las inferencias van sobre la mesa.** Toda decision que el pedido no fija explicitamente es una inferencia del modelo, y el usuario — no el skill — decide cuales revisar. Inferencias ocultas producen specs que parecen completas pero encodean decisiones que nadie tomo.

## Argumentos

```text
/sdd-spec [pedido libre | #NN | URL de issue] [--out local|issue] [--assume]
```

- `--out local|issue` — destino de la spec sin preguntar. `local` = `.sdd/specs/`, `issue` = actualizar el issue de origen (o crear uno nuevo si el pedido fue libre).
- `--assume` — cero preguntas: cada inferencia se resuelve con el sesgo minimo seguro y queda marcada `[ASSUMED]`; el mecanismo de verificacion propuesto se toma sin confirmar; la spec queda en estado `draft`. Para correr desatendido.

## Fase 0 — Lanzador (solo con `/sdd-spec` pelado)

Dispara SOLO cuando el pedido viene vacio. Si trajo pedido, issue o flags, saltear: el usuario ya dijo por donde va.

```text
/sdd-spec convierte un pedido en una spec verificable: expone lo que el modelo esta
infiriendo para que lo desambigues, y te dice que tan verificable va a ser la
ejecucion segun el contrato de autonomia (.sdd/project.md).

  • De una descripcion   — me escribis el pedido y arranco.
  • De un issue abierto  — listo los issues del repo y elegis cual especificar.

Atajo: /sdd-spec <pedido | #NN> [--out local|issue] [--assume] saltea este menu.
```

Luego usar `question` — una pregunta, "¿De donde sale la spec?":

1. `De una descripcion (Recomendado)` — el usuario escribe el pedido (via Other o en el mensaje siguiente).
2. `De un issue abierto` — correr `gh issue list --state open --limit 20`, mostrar la lista y preguntar cual.

## Fase 1 — Contrato primero (bloqueante)

Leer `.sdd/project.md` ANTES de cualquier otra cosa; interesan sobre todo `## Comandos`, `## Verificacion autonoma`, `## Limites` y `## Politicas de generacion` (los gates duros que `/sdd-run` va a aplicar — condicionan el veredicto y el tamaño sano de la spec).

- **Si NO existe**: frenar. Explicar en una linea por que (sin contrato el veredicto de verificabilidad es inventado) y usar `question`: 1. `Correr /sdd-init ahora (Recomendado)` — invocarlo, esperar el contrato y seguir; 2. `Abortar`. NO generar spec "provisoria" sin contrato, ni siquiera si el usuario insiste con que es una feature chica: ofrecer `/sdd-init --assume` como via rapida.
- **Con `--assume` y sin contrato**: correr `/sdd-init --assume` automaticamente, anotarlo en el reporte, y seguir.
- **Si existe pero esta viejo** (fecha de generacion > 30 dias, o los comandos que este pedido necesita figuran `FALLA` / `no probado`): avisar en una linea y ofrecer `/sdd-init --update`; no bloquear.

## Fase 2 — Entender el pedido

1. Si el pedido es `#NN` o URL: `gh issue view NN --json title,body,comments,labels` (usar la URL con `-R` si es de otro repo). Guardar el numero: importa para el destino en Fase 6. Los comments cuentan como fuente — a veces desambiguan el body.
2. Explorar el codigo que el pedido tocaria: subagents `explore` con la herramienta `task` en paralelo (inline si el repo es chico) para relevar que existe hoy, que archivos se tocarian, que convenciones hay, y si hay tests previos en la zona. La spec se escribe contra el codigo real, no contra la idea del codigo.
3. Revisar `.sdd/specs/`: si ya hay una spec para este mismo pedido (mismo issue o slug equivalente), avisar y tratar la corrida como actualizacion de esa spec, no crear otra.

## Fase 3 — Inferencias sobre la mesa

El corazon del skill. Toda decision que el pedido no fija explicitamente se lista como inferencia — tambien las de confianza alta, porque el usuario decide cuales revisar, no el skill. Categorias tipicas: alcance (que entra y que no), comportamiento en bordes y errores, UX/copys, datos (¿migracion? ¿backfill?), compatibilidad hacia atras, plataformas.

Mostrar la tabla completa numerada:

```markdown
| # | Inferencia | Eleccion propuesta | Alternativa razonable | Confianza |
|---|---|---|---|---|
| 1 | ¿El toggle persiste entre sesiones? | Si, en localStorage | Solo en memoria / en el perfil del user | media |
| 2 | ¿Aplica a paginas de admin? | No, solo app publica | Tambien admin | alta |
```

Luego usar `question` — "¿Alguna inferencia a revisar?":

1. `Ninguna, todas bien (Recomendado)` — solo si ninguna quedo con confianza baja.
2. `Revisar algunas` — el usuario dice cuales (numeros) via Other; por cada una, UNA pregunta con las alternativas concretas como opciones, la propuesta primera y marcada `(Recomendado)`.

Reglas: lo que el pedido ya fija NO es inferencia y no se lista (listarlo diluye la tabla). Si una inferencia de confianza baja define el alcance entero (ej. "¿esto es solo UI o tambien API?"), preguntarla directo aunque el usuario haya dicho "todas bien" no aplica — respetar su eleccion, pero marcarla en la spec como riesgo. Con `--assume`: elegir el sesgo minimo seguro (la opcion mas chica y reversible) y marcar `[ASSUMED]` en la spec.

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
- Cruzar el alcance contra las politicas de generacion del contrato y decirlo en el veredicto: una spec cuyo blast-radius estimado excede el *tamaño maximo de PR* se reporta con propuesta de particion (2+ specs encadenadas, cada una dentro del limite) — mejor partir aca que descubrirlo con el PR en draft. Un *coverage minimo* activo sube la vara del plan de verificacion: los tests de los CA ALTA tienen que cubrir el codigo nuevo, no solo el happy path. *Dependencias nuevas: prohibido* convierte cualquier CA que exija una dep en conflicto a resolver en la spec, no en el run. Las politicas de la tecnologia con gate (linter, script) integran la vara igual que coverage; las filas `guia` no gatean ni cambian el veredicto.
- Mostrar el veredicto al usuario con el porque ANTES de elegir mecanismo: es el dato que le dice cuanto puede delegar de la ejecucion.

## Fase 5 — Mecanismo de verificacion

Elegir con criterio = proponer el mecanismo MAS BARATO que observe el comportamiento real, no el mas impresionante. Orden de preferencia: test unit > integration > levantar la app con probe scripteado (curl, señal de log) > e2e browser > prueba humana. Un e2e de playwright para logica que se testea unit es eleccion incorrecta aunque funcione.

1. Proponer por cada criterio de aceptacion el como concreto: comando, assertion o señal observable, anclado en los comandos del contrato.
2. Usar `question` — "¿Con que lo verificamos?": la propuesta primera y marcada `(Recomendado)`, 1-2 alternativas reales (una mas exhaustiva, una mas barata) con su trade-off en la descripcion, y el usuario puede proponer otra via custom. Con `--assume`: tomar la propuesta sin preguntar.
3. Para los criterios NULA: escribir el **protocolo de prueba humana** — pasos concretos y chequeables que el usuario va a seguir ("1. Abri la app en tu iPhone... 2. Confirma un pago... 3. Verifica que vibro"). La spec no esconde la parte manual: la agenda.

## Fase 6 — Escribir la spec

Con EXACTAMENTE esta estructura:

```markdown
# Spec — <titulo>
<!-- Generada por /sdd-spec el <fecha>. Fuente: <pedido libre | issue #NN>. Estado: <aprobada|draft> -->

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

Estado: `aprobada` si el usuario reviso inferencias y mecanismo; `draft` si corrio con `--assume`.

Destino (saltear pregunta si vino `--out`):

- **El pedido vino de un issue** — usar `question`: 1. `Actualizar el issue (Recomendado)` — reescribir el body con la spec, archivando el body original al final dentro de un `<details><summary>Body original</summary>`; 2. `Local` — `.sdd/specs/issue-NN-<slug>.md`; 3. `Ambos`.
- **Pedido libre** — usar `question`: 1. `Local (Recomendado)` — `.sdd/specs/<slug>.md`; 2. `Crear issue` — `gh issue create` con la spec como body.
- Con `--assume` y sin `--out`: local.

## Reporte

```text
Spec lista: <ruta local y/o issue #NN actualizado>
- criterios de aceptacion: <N> (ALTA <a> · MEDIA <m> · BAJA <b> · NULA <h>)
- verificabilidad global: <grado o mixto> — <motivo en una linea>
- mecanismo: <elegido> (<confirmado por usuario | asumido>)
- inferencias: <N> sobre la mesa · <K> revisadas por el usuario · <A> asumidas
- siguiente paso: /sdd-run <ruta | #NN>
<si hubo que correr /sdd-init, hay CA NULA que exigen prueba humana, o una politica de
generacion condiciona la ejecucion (particion por tamaño, coverage), una linea por cada uno>
```

## MUST DO

- Leer `.sdd/project.md` antes que nada; si no existe, exigir `/sdd-init` primero (u orquestarlo con `--assume`).
- Listar TODAS las inferencias, tambien las de confianza alta — elegir cuales revisar es del usuario.
- Anclar cada grado de verificabilidad en lo que el contrato dice que corre HOY, citando el comando o gap concreto.
- Cruzar el alcance contra las politicas de generacion del contrato y avisar en el veredicto si la spec choca con alguna (en particular: proponer particion si no entra en el tamaño maximo de PR).
- Proponer el mecanismo de verificacion mas barato que observe el comportamiento real, y dejar que el usuario lo cambie o proponga otro.
- Escribir criterios de aceptacion observables: paso/no paso sin interpretacion.
- Ser idempotente: re-correr sobre el mismo pedido actualiza la spec existente, no crea otra.

## MUST NOT DO

- No generar spec sin contrato, ni "provisoria".
- No esconder decisiones en la prosa: toda eleccion no fijada por el pedido va a la tabla de inferencias.
- No inflar el veredicto: runner roto en el contrato = la feature no es ALTA por mas TDD-able que sea.
- No prometer verificacion autonoma de lo que exige humano — declararlo NULA y escribir el protocolo manual.
- No tocar codigo ni commitear: la spec (y el issue, si se eligio) es el unico output.
- No pisar el body de un issue sin archivar el original en un `<details>`.
- No preguntar lo que el pedido ya fija.
