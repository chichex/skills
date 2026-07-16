---
name: grill
description: Entrevista implacable para desambiguar un tema, plan o diseño y producir un contrato de handoff antes de escribir un spec. Permite mantener opcionalmente CONTEXT.md y ADRs durante el grill. Usar cuando el usuario quiere stress-testear, aclarar o alinear una idea, pide "grill", "grillame", "entrevistame sobre esto", o quiere retomar una sesión de grilling. No implementa ni escribe el spec definitivo.
---

# Grill

Desambiguá el tema implacablemente hasta alcanzar un entendimiento compartido. El resultado es contexto confiable para escribir un spec hecho y derecho. **Nunca implementes el plan ni escribas el spec definitivo antes de finalizar el handoff.** Después de congelarlo, podés encadenar `sdd-spec` si el usuario elige esa acción.

`grill` es el único entry point para entrevistas. El usuario puede elegir si el mismo workflow también mantiene el modelo de dominio mediante `CONTEXT.md` y ADRs; ninguna extensión debe decidir esa modalidad por él.

Usá `ask_user_question` para toda interacción de elección, `grill_session` para persistir el progreso y `select_grill_session` para listar, inspeccionar o retomar entrevistas anteriores.

## Principios

- Después del mapa previo, dejá que el usuario elija primero el **modo de documentación** y después entre **Grillado rápido** y **Grillado pregunta a pregunta**.
- Recomendá la modalidad según un diagnóstico explícito de cuánto análisis adaptativo exige el tema, no según conveniencia, velocidad ni cantidad de preguntas por sí sola.
- En **Grillado pregunta a pregunta**, hacé exactamente una pregunta por vez y dejá que cada respuesta moldee la siguiente. No prepares un cuestionario rígido completo.
- En **Grillado rápido**, presentá juntas todas las preguntas aplicables del alcance actual, con la opción recomendada marcada como propuesta. El usuario aprueba las recomendaciones que no le hacen ruido y señala cuáles quiere revisar.
- Recorré las dependencias entre decisiones en orden; resolvé primero aquello de lo que dependen otras ramas.
- Para cada pregunta ofrecé una respuesta recomendada y una justificación breve.
- Fuera de la propuesta visible del Grillado rápido, no preselecciones recomendaciones ni las registres como decisiones antes de la aprobación del usuario.
- Habilitá siempre respuesta libre con `allowOther: true`.
- Si un hecho se puede averiguar explorando el codebase, buscándolo en documentación local o ejecutando una comprobación segura, hacelo en vez de preguntarlo.
- Las decisiones pertenecen al usuario. No las infieras silenciosamente.

## Modo de documentación

Todo grill usa exactamente uno de estos modos:

- **Solo grill y handoff** (`standard`): desambigua y persiste decisiones, pero no modifica glosarios ni crea o propone ADRs.
- **Grill + documentación de dominio** (`domain-modeling`): además mantiene términos canónicos en `CONTEXT.md` y evalúa ADRs con default deny.

Elegir el segundo modo cuenta como consentimiento explícito para crear `CONTEXT.md`, `CONTEXT-MAP.md` o `docs/adr/` aunque el repo todavía no los use. No cuenta como aprobación de ningún ADR: cada ADR sigue necesitando su propio OK explícito.

La existencia de artefactos de dominio, el tema del issue o la extensión que inició el grill **no autorizan** por sí solos el modo `domain-modeling`. Usá esos hechos únicamente para recomendar una opción. Si el usuario ya pidió documentar el dominio, recomendá `domain-modeling`; si no hay una necesidad material, recomendá `standard`.

Cuando se elige `domain-modeling`:

1. Leé completo `~/.agents/skills/domain-modeling/SKILL.md` y sus referencias de formato antes de escribir artefactos.
2. Aplicá su reconocimiento, regla de contaminación cero, formato de glosario y criterios estrictos de ADR.
3. Tratá las reglas de entrevista, persistencia y cierre de este skill como orquestación autoritativa.
4. Persistí `workflowMode: "domain-modeling"` en la sesión. En el otro modo persistí `workflowMode: "standard"`.

Meramente leer un `CONTEXT.md` para entender el vocabulario no activa la documentación de dominio.

## Retomar una entrevista

Cuando el usuario quiera ver, inspeccionar o retomar sesiones de grilling:

1. Invocá `select_grill_session`.
2. Si devuelve `resume` o `duplicate`, tratá el snapshot seleccionado como estado autoritativo.
3. Leé `workflowMode`. Para snapshots legacy sin modo, buscá una decisión explícita que active domain modeling; si sigue siendo ambiguo, preguntá el modo de documentación y persistilo con `grill_session` usando `action: "configure"` antes de continuar.
4. Si el modo es `domain-modeling`, cargá el skill de domain modeling y contrastá el snapshot con los archivos actuales. Si difieren, mostrá la contradicción y resolvela antes de avanzar.
5. Mostrá brevemente el tema, las decisiones resueltas, lo pendiente y el próximo bloque recomendado.
6. Reevaluá sobre las ramas pendientes si hace falta análisis adaptativo usando los criterios de la Fase 0. Pedí que elija **Grillado rápido** o **Grillado pregunta a pregunta** mediante `ask_user_question`, marcando la recomendación resultante y explicando sus señales concretas; cancelar pausa la sesión.
7. Continuá en la modalidad elegida desde la siguiente decisión pendiente; no repitas preguntas ya resueltas salvo que el usuario quiera revisarlas.

Una sesión finalizada es inmutable. Para cambiarla, duplicala como nueva revisión mediante `select_grill_session`. Para convertirla en spec sin cambiarla, elegí la acción de crear spec SDD del selector; el handoff congelado se usa como fuente.

## Fase 0: reconocimiento y estimación

Antes de entrevistar:

1. Explorá el codebase y resolvé todos los hechos comprobables relevantes.
2. Buscá `CONTEXT-MAP.md`, los `CONTEXT.md` y `docs/adr/`; informá su existencia en el mapa. Leé los que sean relevantes para entender el vocabulario, sin modificarlos todavía.
3. Separá explícitamente hechos conocidos, supuestos y decisiones del usuario.
4. Construí un árbol de decisiones provisional con secciones y dependencias.
5. Estimá preguntas mínimas, probables y máximas. La cifra operativa es la estimación probable.
6. Agrupá las preguntas por secciones coherentes y asigná una estimación a cada sección.
7. Diagnosticá si hace falta un grillado exhaustivo y adaptativo. Evaluá al menos: ambigüedad o contradicciones del pedido; impacto y costo de revertir decisiones; acoplamiento y dependencias entre ramas; probabilidad de que una respuesta abra preguntas nuevas; novedad frente a patrones existentes; y riesgos de datos, seguridad, compliance, migraciones o integraciones externas.
8. A partir de ese diagnóstico, recomendá **Grillado pregunta a pregunta** si hay al menos una rama material que necesite repreguntas adaptativas, consecuencias difíciles de revertir, contradicciones o riesgos altos. Recomendá **Grillado rápido** si el árbol es estable y poco profundo, las decisiones son mayormente independientes, existen defaults respaldados por evidencia y equivocarse es barato y reversible. Ante evidencia mixta, priorizá pregunta a pregunta cuando la incertidumbre afecte una decisión crítica; no uses la cantidad de preguntas como criterio decisivo.
9. Si domain modeling podría aportar valor, identificá ambigüedades reales de lenguaje, ownership, identidad, cardinalidad, estados y límites de contexto. No conviertas cada término en una pregunta.
10. Si el tema proviene de un issue de GitHub, conservá su número como referencia estructurada y resolvé `owner/repo` con `gh repo view --json nameWithOwner` cuando esté disponible. Esta referencia es metadata local del workflow: no agregues labels ni comments al issue sólo para marcarlo.
11. No cuentes como preguntas de entrevista la elección del modo de documentación, la elección de modalidad, la elección de bloque, la revisión colectiva del Grillado rápido ni la confirmación final.

El total puede cambiar porque una respuesta abre o cierra ramas. Presentalo como estimación, no como promesa exacta.

### Límite de 20

Una sesión de `grill` tiene un límite duro de 20 preguntas de decisión.

- Si la estimación probable supera 20, no comiences la entrevista completa.
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
- artefactos de dominio encontrados;
- supuestos relevantes;
- secciones y dependencias;
- estimación mínima, probable y máxima;
- alcance de esta sesión;
- orden recomendado y motivo;
- diagnóstico de profundidad necesaria, con las señales concretas a favor o en contra de un grillado exhaustivo, y modalidad recomendada.

### Paso 1: elegir documentación

Invocá `ask_user_question` una sola vez con estas opciones:

- **Solo grill y handoff**: no modifica `CONTEXT.md` ni propone ADRs.
- **Grill + documentación de dominio**: mantiene el glosario a medida que se confirman términos y, después del handoff, evalúa ADRs uno por uno.

Marcá una recomendación según la evidencia del reconocimiento, usá `allowOther: true` y no preselecciones la respuesta. Si el usuario cancela, no crees una sesión ni empieces la entrevista.

Si elige documentación de dominio, cargá ahora `domain-modeling` y completá el reconocimiento exigido por ese skill.

### Paso 2: crear la sesión

Creá el registro persistente con `grill_session` usando `action: "create"` y el `workflowMode` elegido. Si el origen es un issue, incluí `sourceIssue: { number: NN, repository: "owner/repo" }` (omití sólo `repository` si no puede resolverse). Guardá el `sessionId` devuelto y usalo durante toda la entrevista.

### Paso 3: elegir modalidad de entrevista

Invocá `ask_user_question` una sola vez con estas dos opciones:

- **Grillado rápido**: muestra todas las preguntas aplicables con las recomendaciones ya propuestas; el usuario señala solamente cuáles le hacen ruido.
- **Grillado pregunta a pregunta**: entrevista adaptativa donde cada respuesta modifica las preguntas siguientes.

Marcá como `recommended: true` exactamente la modalidad que resulte del diagnóstico de profundidad y explicá las señales concretas en `recommendationReason`. La recomendación debe responder a si hace falta explorar adaptativamente el tema: no recomiendes **Grillado rápido** sólo por ahorrar tiempo ni **Grillado pregunta a pregunta** sólo porque hay muchas preguntas. La elección de modalidad implica autorización para comenzar. Usá `allowOther: true`. Si el usuario cancela, pausá el registro y no empieces.

## Fase 2: entrevista

### Modalidad A: Grillado pregunta a pregunta

Para cada decisión:

1. Elegí la siguiente rama según dependencias y respuestas anteriores.
2. Invocá `ask_user_question` una sola vez con:
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
6. Si el modo es `domain-modeling` y quedó resuelto un término de dominio, actualizá inmediatamente el `CONTEXT.md` correcto antes de formular la siguiente pregunta.
7. Recién después formulá la siguiente pregunta.

### Modalidad B: Grillado rápido

1. Recorré el árbol por orden de dependencias simulando las opciones recomendadas y armá una propuesta para todas las preguntas aplicables del alcance actual, hasta el límite de 20.
2. Renderizá la propuesta completa en el chat. Para cada decisión incluí:
   - id y sección;
   - pregunta autocontenida;
   - opciones relevantes;
   - opción recomendada marcada como **propuesta elegida**;
   - justificación breve;
   - dependencia o condición, si existe.
3. Aclará que las propuestas todavía no son decisiones confirmadas. Las ramas que solo aparecerían con una respuesta no recomendada deben figurar como condicionales; no inventes sus preguntas antes de que se abra esa rama.
4. Invocá una sola vez `ask_user_question` en modo `multiple` con una opción por id de decisión y esta consigna: **“Seleccioná las decisiones que te hacen ruido; si no seleccionás ninguna, aprobás todas las propuestas.”** Usá `allowEmptySelection: true` y `allowOther: true`.
5. Si no selecciona ninguna:
   - considerá aprobadas todas las recomendaciones visibles;
   - persistí cada pregunta y su respuesta aprobada con un `checkpoint` separado y un id de interacción único;
   - actualizá decisiones, ramas pendientes, secciones y estimación en cada checkpoint;
   - en modo `domain-modeling`, después de cada checkpoint actualizá inmediatamente el glosario si esa decisión resolvió un término;
   - avanzá al cierre.
6. Si señala decisiones que le hacen ruido:
   - resolvelas una por una, en orden de dependencias, usando el ciclo adaptativo de la Modalidad A;
   - aceptá como confirmadas las propuestas no señaladas solo cuando ya no dependan de una decisión revisada;
   - si un cambio invalida, cierra o abre preguntas posteriores, recalculá el árbol y renderizá una propuesta rápida revisada;
   - repetí la revisión colectiva hasta que no queden objeciones.
7. Si la respuesta libre trae reemplazos inequívocos para varias decisiones, podés aplicarlos sin volver a preguntar cada una, pero debés mostrarlos en la propuesta revisada antes de darlos por confirmados.

Las preguntas mostradas en el lote sí cuentan contra el límite de 20, aunque se aprueben colectivamente. La revisión colectiva no cuenta como pregunta de decisión.

No dependas solamente del historial conversacional: el snapshot persistente debe poder reconstruir el estado en otra sesión de Pi.

### Reglas adicionales de domain modeling

Solo cuando `workflowMode` es `domain-modeling`:

- desafiá términos contradictorios o difusos;
- usá escenarios concretos para probar bordes del dominio;
- verificá hechos en el código en vez de preguntarlos;
- una aclaración de dominio que requiere elección cuenta como pregunta real y debe quedar en el checkpoint;
- no escribas en el glosario hipótesis, decisiones pendientes, implementación ni contenido del futuro spec;
- si el destino del término entre bounded contexts no es inequívoco, resolvelo como una sola pregunta antes de editar.

### Selección única y múltiple

- Usá selección única para alternativas excluyentes.
- Usá selección múltiple cuando varias respuestas puedan coexistir.
- No fuerces una selección múltiple si en realidad estás mezclando decisiones dependientes; separalas en preguntas sucesivas.

### Cancelación o pausa

Si `ask_user_question` indica cancelación:

1. No hagas otra pregunta.
2. Escribí un resumen visible de lo resuelto y pendiente.
3. En modo `domain-modeling`, incluí glosarios modificados, términos resueltos y pendientes, y candidatos a ADR todavía no evaluados.
4. Invocá `grill_session` con `action: "pause"`, incluyendo resumen, ramas pendientes, secciones y estimación actuales.
5. Informá el id de la sesión y que puede retomarse con `select_grill_session`.

## Fase 3: cierre

Cerrá solamente cuando las ramas dentro del alcance elegido estén resueltas.

### Paso 1: contrato visible

Primero escribí en el chat el entendimiento compartido completo. Debe incluir:

1. tema y alcance;
2. hechos comprobados;
3. decisiones resueltas, enumeradas una por una;
4. restricciones y no-objetivos;
5. dependencias y consecuencias importantes;
6. supuestos explícitos;
7. riesgos o preguntas deliberadamente diferidas;
8. bloques pendientes para futuras sesiones;
9. contexto recomendado para la sesión que escribirá el spec.

Este texto es el contrato de handoff. Tiene que estar renderizado en el chat; no puede vivir solamente en una tool o archivo.

### Paso 2: confirmación autocontenida

Recién después del contrato visible, invocá `ask_user_question` con una pregunta autocontenida y estas acciones provisionales:

- **Confirmar entendimiento**: finaliza y congela el handoff.
- **Confirmar y crear spec SDD**: si `sdd-spec` está disponible, primero finaliza y congela el handoff; recién después inicia el workflow de spec.
- **Ajustar una decisión**: vuelve a la rama elegida y retoma la entrevista.
- **Pausar**: conserva el progreso sin finalizar.

No incluyas acciones para implementar o construir. En modo `domain-modeling`, esta confirmación no aprueba ningún ADR.

### Paso 3: persistencia final

Si el usuario confirma, con o sin encadenado:

1. Convertí el contrato visible en Markdown autocontenido.
2. Invocá `grill_session` con `action: "finalize"`, el resumen y `handoffMarkdown`.
3. Informá la ruta `.md` devuelta por la tool.
4. Conservá si el usuario pidió encadenar `sdd-spec`.

Si pide ajustar, retomá una sola rama y seguí el ciclo de pregunta + checkpoint. Si pausa, seguí el procedimiento de pausa.

### Paso 4: ADRs separados

Solo en modo `domain-modeling`, y recién después de congelar el handoff:

1. Evaluá cada decisión contra los tres criterios simultáneos de `domain-modeling`: costo concreto de revertir, pregunta concreta de un lector sin contexto y alternativa concreta descartada con su motivo.
2. Si ninguna califica, informá brevemente que el cierre produce cero ADRs.
3. Por cada candidato que sí califica:
   - mostrá la evidencia concreta de los tres criterios;
   - mostrá la ruta propuesta y el borrador completo;
   - abrí un `ask_user_question` dedicado únicamente a ese ADR con opciones para aprobar, omitir o ajustar;
   - escribí el archivo solo tras aprobación explícita;
   - terminá esa decisión antes de presentar el siguiente ADR.

Nunca mezcles la confirmación del handoff con la aprobación de un ADR ni bundles varios ADRs en una aprobación.

### Paso 5: acción posterior

Después de finalizar directamente en modo `standard`, o de resolver todos los candidatos a ADR en modo `domain-modeling`:

- si eligió **Confirmar entendimiento**, terminá e informá el handoff y, cuando corresponda, glosarios actualizados y ADRs creados;
- si eligió **Confirmar y crear spec SDD**, leé `~/.agents/skills/sdd-spec/SKILL.md` y continuá con `--from-grill <sessionId>`;
- el handoff confirmado es fuente autoritativa: no vuelvas a preguntar decisiones ya resueltas;
- la spec sigue exigiendo `.sdd/project.md`.

No implementes el plan desde este skill.
