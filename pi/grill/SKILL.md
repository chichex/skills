---
name: grill
description: Entrevista rigurosa y pragmática para desambiguar las decisiones materiales de un tema, plan o diseño y producir un contrato de handoff antes de escribir un spec. Avanza con supuestos explícitos cuando equivocarse es barato y reversible. Usar cuando el usuario quiere stress-testear, aclarar o alinear una idea, pide "grill", "grillame", "entrevistame sobre esto", o quiere retomar una sesión de grilling. No implementa ni escribe el spec definitivo.
compatibility: Requiere las tools ask_user_question, ask_user_questions, grill_session y select_grill_session de las extensiones Pi de este repo.
---

# Grill

Desambiguá las decisiones materiales hasta alcanzar un entendimiento compartido, con la menor cantidad de interrupciones posible. El resultado es contexto confiable para escribir un spec hecho y derecho. **Nunca implementes el plan ni escribas el spec definitivo antes de finalizar el handoff.** Después de congelarlo, podés encadenar `sdd-spec` si el usuario elige esa acción.

`grill` es el único entry point para entrevistas. Nunca escribe ni propone `CONTEXT.md`, glosarios ni ADRs: solo desambigua y produce el handoff.

Usá `ask_user_question` para una sola decisión, `ask_user_questions` para rondas de 2 a 4 decisiones independientes, `grill_session` para persistir el progreso y `select_grill_session` para listar, inspeccionar o retomar entrevistas anteriores. La modalidad elegida se persiste como `interviewMode` y las tools de preguntas la validan en runtime.

## Argumentos Pi

```text
/skill:grill [#NN | --resume <sessionId>]
```

- `#NN` inicia el reconocimiento desde ese issue.
- `--resume <sessionId>` viene de un selector o del orquestador: cargá directamente el snapshot autoritativo con `grill_session` (`action: "get"`), sin volver a abrir `select_grill_session`, y continuá en esta misma conversación.

## Principios

- Optimizá por **mínima interrupción**, no por máxima cantidad de preguntas. Un hueco en el pedido no es automáticamente una decisión para el usuario.
- Clasificá cada punto abierto como hecho comprobable, supuesto de bajo riesgo o decisión material.
- Marcá como `[ASSUMED]` una opción respaldada por el pedido, el código, convenciones del repo o un default seguro cuando sea de bajo riesgo, barata y reversible. No la preguntes.
- Preguntá solo decisiones que cambien materialmente alcance o comportamiento observable, UX/API pública, datos/seguridad/privacidad, costo o efectos externos, compatibilidad o una migración irreversible; también cuando haya una contradicción real o alternativas igual de plausibles con consecuencias relevantes.
- No preguntes por detalles de implementación que el agente puede resolver responsablemente — nombres internos, ubicación de archivos, estructura menor de tests, copy no contractual o defaults convencionales — salvo que el usuario haya expresado una preferencia o tengan consecuencias materiales.
- Nunca asumas en silencio: cada `[ASSUMED]` debe quedar visible con su evidencia en el mapa, persistido en el resumen y enumerado en el contrato final. El usuario puede corregirlo en cualquier momento.
- Elegí el `interviewMode` a partir del diagnóstico y configuralo sin abrir una pregunta de preferencias. Respetá un modo pedido explícitamente; preguntá por el modo solo ante instrucciones contradictorias o si el usuario pidió elegirlo.
- En **Grillado pregunta a pregunta**, hacé exactamente una pregunta material por vez y dejá que cada respuesta moldee la siguiente. No prepares un cuestionario rígido completo.
- En **Por rondas**, presentá juntas hasta 4 preguntas sobre decisiones materiales de la frontera de dependencias que ya estén desbloqueadas y sean realmente independientes. Recalculá la frontera recién cuando vuelva la ronda completa.
- En **Grillado rápido**, presentá juntas las decisiones materiales aplicables del alcance actual, con la opción recomendada marcada como propuesta. El usuario señala solamente cuáles quiere revisar.
- Persistí el modo antes de entrevistar: `fast` para Grillado rápido, `rounds` para Por rondas y `adaptive` para pregunta a pregunta. Nunca confíes solamente en recordar el historial.
- Recorré las dependencias entre decisiones en orden; resolvé primero aquello de lo que dependen otras ramas.
- Para cada pregunta ofrecé una respuesta recomendada y una justificación breve.
- Habilitá siempre respuesta libre con `allowOther: true`.
- Si un hecho se puede averiguar explorando el codebase, buscándolo en documentación local o ejecutando una comprobación segura, hacelo en vez de preguntarlo.
- Las decisiones materiales pertenecen al usuario; las elecciones operativas de bajo impacto son responsabilidad del agente. Si el usuario pide un grill exhaustivo o sin supuestos, activá la política `explicit-only`, registrala en el `summary` y no apliques ninguna poda `[ASSUMED]`: todo punto abierto sigue como decisión explícita. Esta regla prevalece sobre cualquier instrucción posterior de asumir o podar.

## Retomar una entrevista

`/grills` y `select_grill_session` combinan los snapshots runtime globales y los handoffs portables de cada root conocido bajo `.sdd/grills/` en un único inventario reconciliado. Abren siempre en el proyecto actual. El alcance «Todos» sólo suma roots conocidos: el root actual, los `projectPath` recuperables de snapshots y los cwd de sesiones Pi conocidas; no recorre ni escanea el filesystem. Un `project` del marker distinto de la ubicación física es una ruta histórica: se muestra como advertencia, mientras la raíz física sigue siendo la raíz operativa. Inválidos y conflictos sólo se inspeccionan.

Un handoff-only pausado se importa al runtime únicamente después de confirmar **Retomar**. La importación conserva el ID lógico, el Markdown completo, el path fuente y el proyecto histórico; no inventa respuestas ni reescribe el handoff al listar o importar. Un handoff-only finalizado permite crear spec pasando su ruta absoluta validada a `sdd-spec`, o duplicarlo importando una baseline explícita y una revisión hija.

Cuando el usuario quiera ver, inspeccionar o retomar sesiones de grilling:

1. Si recibiste `--resume <sessionId>`, cargá ese snapshot con `grill_session` (`action: "get"`); de lo contrario invocá `select_grill_session`.
2. Si el snapshot o selector devuelve `resume` o `duplicate`, tratá la selección como estado autoritativo.
3. Los handoffs viejos pueden traer una sección `## Modo`: ignorala, ya no existe.
4. Si existe un cuestionario exportado con respuestas completadas (ver **Exportar cuestionario**), leelo e incorporá cada respuesta como decisión resuelta con su checkpoint; repreguntá solo lo materialmente ambiguo.
5. Mostrá brevemente el tema, la política de supuestos persistida, las decisiones resueltas, los supuestos `[ASSUMED]`, lo pendiente y el próximo bloque recomendado.
6. Reevaluá las ramas pendientes usando los criterios de la Fase 0. Si el `summary` conserva `explicit-only`, no hagas ninguna poda; en otro caso podá los puntos que ahora puedan asumirse. Elegí **Grillado rápido**, **Por rondas** o **Grillado pregunta a pregunta**. Conservá una preferencia explícita del usuario; de lo contrario informá el modo elegido en una línea, sin abrir otro gate.
7. Persistí inmediatamente el modo con `grill_session` (`action: "configure"`, `interviewMode: "fast" | "rounds" | "adaptive"`) antes de la primera pregunta. Continuá desde la siguiente decisión material pendiente; no repitas decisiones ni supuestos aceptados salvo que el usuario quiera revisarlos.

Una sesión finalizada es inmutable. Para cambiarla, duplicala como nueva revisión mediante `select_grill_session`. Para convertirla en spec sin cambiarla, elegí la acción de crear spec SDD del selector: usa el ID si existe un snapshot válido y la ruta absoluta física si es un handoff-only; el handoff congelado se usa como fuente.

## Fase 0: reconocimiento y estimación

Antes de entrevistar:

1. Explorá el codebase y resolvé todos los hechos comprobables relevantes. Los hechos los averigua el agente, nunca el usuario: si más adelante una pregunta de la frontera necesita un hecho del entorno todavía sin comprobar, se averigua sin frenar la ronda (ver **Modalidad B: Por rondas**).
2. Buscá `CONTEXT-MAP.md`, los `CONTEXT.md` y `docs/adr/`; informá su existencia en el mapa. Leé los que sean relevantes para entender el vocabulario; nunca los modifiques.
3. Separá explícitamente: hechos comprobados, instrucciones ya dadas por el usuario y elecciones todavía abiertas.
4. Resolvé la política de supuestos antes de podar. Si el usuario pidió un grill exhaustivo o sin supuestos, usá `explicit-only`: no conviertas ningún punto en `[ASSUMED]` y tratá todas las elecciones abiertas como decisiones explícitas, también para la estimación y el límite. En otro caso usá `risk-pruned`: convertí cada elección respaldada, de bajo riesgo y reversible en `[ASSUMED]`; si corregirla durante la spec o implementación sería local y barato, no merece un gate.
5. Construí el árbol con las decisiones que sigan explícitas después de aplicar la política y sus dependencias. En `risk-pruned`, no lo infles con detalles de implementación ni preferencias hipotéticas.
6. Estimá preguntas mínimas, probables y máximas después de aplicar la política. La cifra operativa es la estimación probable y puede ser cero.
7. Agrupá las preguntas explícitas por secciones coherentes y asigná una estimación a cada sección.
8. Diagnosticá qué modalidad necesita el árbol resultante. Evaluá: contradicciones reales; costo de revertir; acoplamiento entre decisiones materiales; tamaño y estabilidad de la frontera; probabilidad de que una respuesta abra ramas materiales; novedad frente a patrones existentes; y riesgos de datos, seguridad, compliance, migraciones o integraciones externas.
9. A partir de ese diagnóstico:
   - elegí **Grillado pregunta a pregunta** solo cuando una rama material necesite repreguntas adaptativas, tenga consecuencias difíciles de revertir, contradicciones o riesgos altos, o dependencias tan densas que una respuesta reformule la siguiente;
   - elegí **Por rondas** cuando haya varias decisiones materiales desbloqueadas e independientes y alcance con recalcular el árbol entre rondas;
   - elegí **Grillado rápido** como default cuando el árbol resultante sea estable, existan recomendaciones respaldadas y corregir el rumbo sea barato.
   Ante evidencia mixta, aislá la rama crítica en vez de volver quisquillosa toda la sesión. No uses la cantidad de preguntas como criterio decisivo.
10. Si el tema proviene de un issue de GitHub, conservá su número como referencia estructurada y resolvé `owner/repo` con `gh repo view --json nameWithOwner` cuando esté disponible. Esta referencia es metadata local del workflow: no agregues labels ni comments al issue sólo para marcarlo.
11. No cuentes como preguntas de entrevista los supuestos `[ASSUMED]`, la elección automática de configuración, la elección de bloque, la revisión colectiva del Grillado rápido ni la confirmación final. Cada decisión material incluida en una ronda sí cuenta por separado.

El total puede cambiar porque una respuesta abre o cierra ramas. Presentalo como estimación, no como promesa exacta. Si quedan cero decisiones materiales, creá y configurá la sesión para dejar trazabilidad y pasá directo al cierre.

### Límite de 20

Una sesión de `grill` tiene un límite duro de 20 preguntas de decisión material. Los supuestos `[ASSUMED]` no consumen el límite.

- Si la estimación probable de decisiones materiales supera 20, no comiences la entrevista completa.
- Proponé una división en bloques de hasta 20 preguntas.
- Explicá las dependencias y recomendá qué bloque abordar primero.
- Permití que el usuario elija un bloque mediante una sola llamada a `ask_user_question`.
- Conservá el bloque elegido para crear la sesión en la Fase 1 con ese alcance y dejá los demás bloques en `pendingBranches`.
- Si durante la entrevista aparecen ramas nuevas y se alcanza 20, pausá. Mostrá lo resuelto, lo pendiente y una división recomendada para continuar en otra sesión.
- Nunca eludas el límite creando preguntas compuestas.

## Fase 1: mapa previo y configuración

Antes de la primera pregunta, escribí en el chat un mapa visible con:

- tema y objetivo de desambiguación;
- hechos ya comprobados;
- docs de dominio existentes (`CONTEXT.md`, ADRs), solo como lectura;
- política de supuestos (`risk-pruned` o `explicit-only`) y su origen;
- supuestos `[ASSUMED]`, cada uno con evidencia y motivo por el que es barato corregirlo; en `explicit-only`, la lista queda vacía;
- decisiones materiales, secciones y dependencias;
- estimación mínima, probable y máxima después de aplicar la política;
- alcance de esta sesión;
- orden recomendado y motivo;
- diagnóstico de modalidad, con señales concretas para aprobación colectiva, adaptación entre rondas o adaptación después de cada respuesta, y modalidad elegida.

### Paso 1: crear la sesión

Creá el registro persistente con `grill_session` usando `action: "create"`, un `summary` que incluya hechos, política de supuestos y supuestos `[ASSUMED]`. La tool inicializa `interviewMode: "unselected"`: ningún checkpoint de entrevista será aceptado hasta configurarlo. Si el origen es un issue, incluí `sourceIssue: { number: NN, repository: "owner/repo" }` (omití sólo `repository` si no puede resolverse). Guardá el `sessionId` devuelto y usalo durante toda la entrevista.

### Paso 2: configurar la modalidad diagnosticada

Elegí y persistí el `interviewMode` sin abrir una pregunta de configuración: `fast` para **Grillado rápido**, `rounds` para **Por rondas** o `adaptive` para **Grillado pregunta a pregunta**. Respetá cualquier modalidad que el usuario haya pedido explícitamente; si no indicó una, usá el diagnóstico de la Fase 0.

Solo si el usuario pidió elegir la modalidad o dio instrucciones contradictorias, invocá `ask_user_question` con las tres opciones, la recomendada marcada, `allowOther: true` y `grill: { sessionId, phase: "configuration" }`. Si cancela ese gate solicitado, pausá el registro y no empieces.

Persistí el modo elegido con `grill_session` (`action: "configure"`, `interviewMode: "fast" | "rounds" | "adaptive"`) antes de la primera pregunta. Este checkpoint de configuración es obligatorio aunque la elección haya sido automática: las tools rechazan combinaciones incompatibles y `grill_session` rechaza checkpoints mientras el modo siga `unselected`.

### Contexto obligatorio de las preguntas

Mientras la sesión esté activa, toda llamada de entrevista o cierre incluye un objeto `grill`:

- `sessionId`: id persistente devuelto por `grill_session`;
- `phase`: `"interview"` para decisiones o `"closure"` para la confirmación final;
- `frontierSize`: cantidad real de decisiones representadas por la llamada; es obligatorio en fase `interview`. Vale 1 en modo adaptativo, de 1 a 4 en rondas y hasta 20 en la revisión colectiva del modo rápido.

El gate de runtime aplica estas reglas:

- con `interviewMode: "rounds"`, una frontera de 2 a 4 exige `ask_user_questions`; `ask_user_question` sólo se admite con `frontierSize: 1`;
- con `interviewMode: "adaptive"` o `"fast"`, `ask_user_questions` se rechaza;
- configuración y cierre usan siempre `ask_user_question`.

No eludas el gate declarando `frontierSize: 1` cuando existen varias decisiones independientes. Si una tool rechaza la llamada, corregí la modalidad o el tamaño de frontera; no improvises un cuestionario numerado dentro de una única pregunta.

## Fase 2: entrevista

### Modalidad A: Grillado pregunta a pregunta

Para cada decisión material:

1. Si la política es `explicit-only`, no reapliques la poda y elegí la siguiente decisión según dependencias. Con `risk-pruned`, si la siguiente rama ya tiene un default respaldado, de bajo riesgo y reversible, registrala como `[ASSUMED]` en el resumen y seguí sin preguntar; si sigue siendo material, elegila según dependencias y respuestas anteriores.
2. Invocá `ask_user_question` una sola vez con:
   - `grill: { sessionId, phase: "interview", frontierSize: 1 }`;
   - una pregunta autocontenida;
   - `selectionMode: "single"` o `"multiple"` según corresponda;
   - opciones claras y mutuamente comprensibles;
   - una o más opciones marcadas `recommended: true` cuando corresponda;
   - `recommendationReason` breve;
   - `allowOther: true`;
   - sección, número actual y total estimado.
3. Esperá la respuesta de la tool.
4. Interpretá la respuesta y actualizá el árbol de decisiones.
5. Antes de hacer otra pregunta, invocá `grill_session` con `action: "checkpoint"`:
   - registrá una `interaction` con id único, pregunta y respuestas;
   - agregá o actualizá la decisión normalizada;
   - reemplazá `pendingBranches` con el estado actual;
   - actualizá secciones o estimación si cambiaron.
6. Recién después formulá la siguiente pregunta.

### Modalidad B: Por rondas

Cada ronda presenta la **frontera de dependencias**: solo decisiones cuyas dependencias ya están resueltas.

1. Calculá la frontera actual. Con `risk-pruned`, convertí en `[ASSUMED]` los defaults de bajo riesgo que hayan quedado desbloqueados; con `explicit-only`, no conviertas ninguno. Priorizá las decisiones materiales que desbloquean más ramas.
2. **Hechos sin bloqueo.** Si una pregunta de la frontera necesita un hecho del entorno todavía sin comprobar, no se lo preguntes al usuario: lanzá la exploración y no frenes la ronda. Solo esperan las preguntas que dependen de ese hecho; el resto de la frontera se pregunta ya. Cuando vuelve el hecho, sumalo a los hechos comprobados y recalculá la frontera para la ronda siguiente. Si toda la frontera depende de hechos pendientes, no abras una ronda vacía ni le preguntes el hecho al usuario: esperá la exploración. Si la exploración falla o vence, reintentala o explorá inline; si el hecho sigue sin poder comprobarse, registralo como supuesto visible y seguí. En Pi, lanzá la exploración con la tool `subagent` (agente `scout`, `background: true`) y armá la ronda sin esperarla: el reporte vuelve como mensaje `subagent-result`. Si la tool `subagent` no está disponible, explorá inline antes de la ronda.
3. Si la respuesta de una decisión material cambiaría cómo se formula otra o sus opciones, no las pongas en la misma ronda: dejá la dependiente para la ronda siguiente.
4. Elegí hasta 4 decisiones independientes entre las preguntables de la frontera (las que no esperan un hecho):
   - con 2 a 4, invocá `ask_user_questions` una sola vez con `grill: { sessionId, phase: "interview", frontierSize: N }` y enviá una entrada por decisión, cada una con `id` único, pregunta autocontenida, `section`, progreso, opciones, recomendación con motivo, `selectionMode` y `allowOther: true`;
   - si queda una sola decisión preguntable, invocá `ask_user_question` con `grill: { sessionId, phase: "interview", frontierSize: 1 }`; una ronda de una pregunta es válida cuando las dependencias no permiten agrupar.
5. Esperá la ronda completa. La tool no devuelve control al agente entre preguntas: no incluyas dos decisiones acopladas esperando corregir la segunda sobre la marcha.
6. Por cada respuesta recibida, en orden:
   - actualizá el árbol;
   - persistí un `checkpoint` separado con interacción y decisión normalizada;
   - reemplazá `pendingBranches` y actualizá secciones o estimación.
7. Recalculá la frontera recién después de procesar toda la ronda y abrí la siguiente.
8. Si una respuesta contradice una decisión previa o invalida otra rama, mostrá la contradicción y resolvé solo lo afectado antes de continuar. No repitas respuestas válidas.
9. Si el usuario cancela con respuestas parciales, checkpointá primero las respuestas efectivamente devueltas y después seguí el procedimiento de pausa. Las preguntas no respondidas siguen pendientes.

Cada pregunta incluida en la ronda cuenta individualmente contra el límite de 20.

### Modalidad C: Grillado rápido

1. Recorré el árbol por orden de dependencias. Con `risk-pruned`, sacá del lote toda elección que cumpla la regla `[ASSUMED]`; con `explicit-only`, no saques ninguna elección abierta. La propuesta contiene las decisiones materiales aplicables, hasta el límite de 20.
2. Renderizá primero los supuestos nuevos o modificados y después la propuesta de decisiones. Para cada decisión material incluí:
   - id y sección;
   - pregunta autocontenida;
   - opciones relevantes;
   - opción recomendada marcada como **propuesta elegida**;
   - justificación breve;
   - dependencia o condición, si existe.
3. Aclará que las propuestas de decisiones todavía no están confirmadas. Las ramas que solo aparecerían con una respuesta no recomendada deben figurar como condicionales; no inventes sus preguntas antes de que se abra esa rama.
4. Si quedan cero decisiones materiales, no abras la revisión colectiva: pasá directo al cierre.
5. En otro caso, invocá una sola vez `ask_user_question` en modo `multiple`, con `grill: { sessionId, phase: "interview", frontierSize: N }`, una opción por id de decisión y esta consigna: **“Seleccioná las decisiones que te hacen ruido; si no seleccionás ninguna, aprobás todas las propuestas.”** Usá `allowEmptySelection: true` y `allowOther: true`.
6. Si no selecciona ninguna:
   - considerá aprobadas todas las recomendaciones visibles;
   - persistí cada pregunta y su respuesta aprobada con un `checkpoint` separado y un id de interacción único;
   - actualizá decisiones, ramas pendientes, secciones, estimación y resumen de supuestos en cada checkpoint;
   - avanzá al cierre.
7. Si señala decisiones que le hacen ruido:
   - resolvelas una por una, en orden de dependencias, usando el ciclo adaptativo de la Modalidad A;
   - aceptá como confirmadas las propuestas no señaladas solo cuando ya no dependan de una decisión revisada;
   - si un cambio invalida, cierra o abre preguntas posteriores, recalculá el árbol, asumí las ramas baratas y renderizá una propuesta rápida revisada para lo material;
   - repetí la revisión colectiva hasta que no queden objeciones.
8. Si la respuesta libre trae reemplazos inequívocos para varias decisiones, aplicalos sin volver a preguntar cada una y mostralos en la propuesta revisada.

Las decisiones mostradas en el lote cuentan contra el límite de 20, aunque se aprueben colectivamente. Los supuestos y la revisión colectiva no cuentan.

No dependas solamente del historial conversacional: el snapshot persistente debe poder reconstruir el estado en otra sesión de Pi.

### Persistencia de supuestos

- Guardá la política vigente (`risk-pruned` o `explicit-only`) y la lista de supuestos en `summary` bajo bloques `Política de supuestos` y `Supuestos [ASSUMED]` al crear la sesión y cada vez que un checkpoint, pausa o cierre los modifique.
- En `explicit-only`, mantené vacía la lista `[ASSUMED]` y no ejecutes ninguna instrucción de poda de las tres modalidades.
- Como un supuesto no fue una pregunta, no fabriques una `interaction` ni consumas un checkpoint para persistirlo; el `summary` y el contrato son su fuente.
- Si el usuario corrige un supuesto de forma inequívoca, aplicá la corrección, actualizá las ramas afectadas y no repreguntes. Si la corrección descubre una decisión material nueva, promovela al árbol.
- La confirmación final acepta también todos los `[ASSUMED]` visibles; hasta entonces siguen siendo revisables.

### Selección única y múltiple

- Usá selección única para alternativas excluyentes.
- Usá selección múltiple cuando varias respuestas puedan coexistir.
- No fuerces una selección múltiple si en realidad estás mezclando decisiones dependientes; separalas en preguntas sucesivas.

### Cancelación o pausa

Si `ask_user_question` o `ask_user_questions` indica cancelación:

1. No hagas otra pregunta.
2. Escribí un resumen visible de lo resuelto, los supuestos `[ASSUMED]` y lo pendiente.
3. Invocá `grill_session` con `action: "pause"`, incluyendo resumen con supuestos, ramas pendientes, secciones y estimación actuales. La tool además escribe/actualiza el handoff interoperable en `.sdd/grills/` del proyecto (ver **Formato del handoff**).
4. Ofrecé exportar las decisiones pendientes como cuestionario para un stakeholder sin agente (ver **Exportar cuestionario**).
5. Informá el id de la sesión, la ruta del handoff en el repo, y que puede retomarse con `select_grill_session`.

## Formato del handoff

El handoff es el artefacto interoperable del grill: los cuatro harnesses lo escriben con el mismo template, y `sdd-spec --from-grill` de cualquier harness lo consume sin traducción. En Pi lo escribe y actualiza la tool: cada `pause` y `finalize` upsertea `.sdd/grills/<fecha>-<slug>.md` en el proyecto de la sesión y garantiza el marker `SDD-Tracking` con los valores autoritativos del snapshot (`state` según el estado real, `issue` desde `sourceIssue`, `grill` = id de la sesión, `project` = `projectPath`, percent-encodeados donde haga falta). El `handoffMarkdown` que generás en el cierre tiene que seguir este template:

```markdown
# Grill — <tema>
<!-- Estado: paused|finalized. Proyecto: <ruta absoluta>. Fuente: <issue o pedido>. -->
<!-- SDD-Tracking: version=1; type=grill; state=<paused|finalized>; issue=<#NN|owner/repo#NN|none>; grill=<ref>; project=<ref> -->

## Hechos comprobados
...

## Decisiones resueltas
1. ...

## Ramas pendientes
...

## Handoff
<vacío mientras esté paused; contrato completo cuando esté finalized>
```

Si tu marker difiere del estado real de la sesión, la tool lo corrige: siempre queda exactamente un marker con la identidad autoritativa.

## Exportar cuestionario

Tanto al pausar como en el cierre, ofrecé exportar las decisiones pendientes como `.sdd/grills/<fecha>-<slug>-cuestionario.md`: un cuestionario autocontenido para un tercero sin agente, pensado para pegar en un Google Doc y discutir con un stakeholder. Escribilo como archivo Markdown normal; no reemplaza el snapshot de `grill_session`.

Por cada decisión pendiente incluí:

- contexto breve que la haga entendible sin leer el resto de la sesión;
- la pregunta y sus opciones;
- la opción recomendada con su motivo;
- un espacio explícito para la respuesta.

No uses jerga interna de la sesión ni referencias que el tercero no pueda resolver. Después de escribir el archivo, asegurate de que la sesión quede pausada (`grill_session` con `action: "pause"`) e informá la ruta del cuestionario.

Cuando vuelvan las respuestas, el grill se retoma leyendo ese archivo: registrá cada respuesta como decisión resuelta con su checkpoint, repreguntá solo lo ambiguo y continuá con las ramas restantes.

## Fase 3: cierre

Cerrá solamente cuando las ramas dentro del alcance elegido estén resueltas.

### Paso 1: contrato visible

Primero escribí en el chat el entendimiento compartido completo. Debe incluir:

1. tema y alcance;
2. hechos comprobados;
3. decisiones resueltas, enumeradas una por una;
4. restricciones y no-objetivos;
5. dependencias y consecuencias importantes;
6. supuestos `[ASSUMED]`, cada uno con su evidencia y el impacto si fuera incorrecto;
7. riesgos o preguntas deliberadamente diferidas;
8. bloques pendientes para futuras sesiones;
9. contexto recomendado para la sesión que escribirá el spec.

Este texto es el contrato de handoff. Tiene que estar renderizado en el chat; no puede vivir solamente en una tool o archivo. La confirmación final aprueba tanto las decisiones como los `[ASSUMED]` enumerados, sin un gate separado por cada supuesto.

### Paso 2: confirmación autocontenida

Recién después del contrato visible, invocá `ask_user_question` con `grill: { sessionId, phase: "closure" }`, una pregunta autocontenida y estas acciones provisionales:

- **Confirmar entendimiento**: finaliza y congela el handoff.
- **Confirmar y crear spec SDD**: si `sdd-spec` está disponible, primero finaliza y congela el handoff; recién después inicia el workflow de spec.
- **Ajustar una decisión o supuesto**: vuelve al punto elegido y retoma solo la rama afectada.
- **Pausar**: conserva el progreso sin finalizar.
- **Exportar cuestionario**: escribe las decisiones pendientes o diferidas como cuestionario para un stakeholder sin agente y pausa la sesión hasta que vuelvan las respuestas (ver **Exportar cuestionario**).

No incluyas acciones para implementar o construir.

### Paso 3: persistencia final

Si el usuario confirma, con o sin encadenado:

1. Convertí el contrato visible en Markdown autocontenido siguiendo el template de **Formato del handoff**.
2. Invocá `grill_session` con `action: "finalize"`, el resumen actualizado — incluidos los supuestos `[ASSUMED]` — y `handoffMarkdown`.
   - Si el usuario eligió **Confirmar y crear spec SDD**, incluí `continueWithSpec: true`; la tool persiste primero y recién después encola el skill canónico materializado.
3. Informá las dos rutas que devuelve la tool: el snapshot global y el handoff del repo en `.sdd/grills/`.
4. Si hubo encadenado, terminá este turno después de la persistencia: el follow-up materializado de `sdd-spec --from-grill` continúa en esta misma sesión.

Si pide ajustar, retomá una sola rama. Una corrección inequívoca de un supuesto se aplica sin otra pregunta; una decisión material sigue el ciclo de pregunta + checkpoint. Si pausa, seguí el procedimiento de pausa.

### Paso 4: acción posterior

Después de finalizar:

- si eligió **Confirmar entendimiento**, terminá e informá el handoff;
- si eligió **Confirmar y crear spec SDD**, `grill_session finalize` con `continueWithSpec: true` entrega el skill canónico materializado con `--from-grill <sessionId>`;
- no leas un `SKILL.md` por un path inferido ni envíes slash commands;
- el handoff confirmado es fuente autoritativa: no vuelvas a preguntar decisiones ya resueltas;
- la spec sigue exigiendo `.sdd/project.md`.

No implementes el plan desde este skill.
