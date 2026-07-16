---
name: grill
description: Entrevista implacable para desambiguar un tema, plan o diseño y producir un contrato de handoff antes de escribir un spec. Usar cuando el usuario quiere stress-testear, aclarar o alinear una idea, pide "grill", "grillame", "entrevistame sobre esto", o quiere retomar una sesión de grilling. No implementa ni escribe el spec definitivo.
---

# Grill

Desambiguá el tema implacablemente hasta alcanzar un entendimiento compartido. El resultado es contexto confiable para escribir un spec hecho y derecho. **Nunca implementes el plan ni escribas el spec definitivo antes de finalizar el handoff.** Después de congelarlo, podés encadenar `sdd-spec` si el usuario elige esa acción.

Usá `ask_user_question` para toda interacción de elección, `grill_session` para persistir el progreso y `select_grill_session` para listar, inspeccionar o retomar entrevistas anteriores.

## Principios

- Hacé exactamente una pregunta por vez y esperá la respuesta antes de formular la siguiente.
- Cada respuesta debe influir en la siguiente pregunta. No prepares un cuestionario rígido completo.
- Recorré las dependencias entre decisiones en orden; resolvé primero aquello de lo que dependen otras ramas.
- Para cada pregunta ofrecé una respuesta recomendada y una justificación breve.
- No preselecciones la recomendación.
- Habilitá siempre respuesta libre con `allowOther: true`.
- Si un hecho se puede averiguar explorando el codebase, buscándolo en documentación local o ejecutando una comprobación segura, hacelo en vez de preguntarlo.
- Las decisiones pertenecen al usuario. No las infieras silenciosamente.
- No hagas varias preguntas en un mismo mensaje, ni siquiera como lista informal.

## Retomar una entrevista

Cuando el usuario quiera ver, inspeccionar o retomar sesiones de grilling:

1. Invocá `select_grill_session`.
2. Si devuelve `resume` o `duplicate`, tratá el snapshot seleccionado como estado autoritativo.
3. Mostrá brevemente el tema, las decisiones resueltas, lo pendiente y el próximo bloque recomendado.
4. Pedí autorización para continuar mediante `ask_user_question`.
5. Continuá desde la siguiente decisión pendiente; no repitas preguntas ya resueltas salvo que el usuario quiera revisarlas.

Una sesión finalizada es inmutable. Para cambiarla, duplicala como nueva revisión mediante `select_grill_session`. Para convertirla en spec sin cambiarla, elegí la acción de crear spec SDD del selector; el handoff congelado se usa como fuente.

## Fase 0: reconocimiento y estimación

Antes de entrevistar:

1. Explorá el codebase y resolvé todos los hechos comprobables relevantes.
2. Separá explícitamente hechos conocidos, supuestos y decisiones del usuario.
3. Construí un árbol de decisiones provisional con secciones y dependencias.
4. Estimá preguntas mínimas, probables y máximas. La cifra operativa es la estimación probable.
5. Agrupá las preguntas por secciones coherentes y asigná una estimación a cada sección.
6. No cuentes como preguntas de entrevista la autorización inicial, la elección de bloque ni la confirmación final.

El total puede cambiar porque una respuesta abre o cierra ramas. Presentalo como estimación, no como promesa exacta.

### Límite de 20

Una sesión de `grill` tiene un límite duro de 20 preguntas de decisión.

- Si la estimación probable supera 20, no comiences la entrevista completa.
- Proponé una división en bloques de hasta 20 preguntas.
- Explicá las dependencias y recomendá qué bloque abordar primero.
- Permití que el usuario elija un bloque mediante una sola llamada a `ask_user_question`.
- Creá la sesión con el bloque elegido como alcance y dejá los demás bloques en `pendingBranches`.
- Si durante la entrevista aparecen ramas nuevas y se alcanza 20, pausá. Mostrá lo resuelto, lo pendiente y una división recomendada para continuar en otra sesión.
- Nunca eludas el límite creando preguntas compuestas.

## Fase 1: mapa previo y autorización

Antes de la primera pregunta, escribí en el chat un mapa visible con:

- tema y objetivo de desambiguación;
- hechos ya comprobados;
- supuestos relevantes;
- secciones y dependencias;
- estimación mínima, probable y máxima;
- alcance de esta sesión;
- orden recomendado y motivo.

Creá el registro persistente con `grill_session` usando `action: "create"`. Guardá el `sessionId` devuelto y usalo durante toda la entrevista.

Después del mapa, pedí autorización con una sola llamada a `ask_user_question`. La pregunta debe ser autocontenida. Si el usuario no autoriza, pausá el registro y no empieces.

## Fase 2: entrevista adaptativa

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
6. Recién después formulá la siguiente pregunta.

No dependas solamente del historial conversacional: el snapshot persistente debe poder reconstruir el estado en otra sesión de Pi.

### Selección única y múltiple

- Usá selección única para alternativas excluyentes.
- Usá selección múltiple cuando varias respuestas puedan coexistir.
- No fuerces una selección múltiple si en realidad estás mezclando decisiones dependientes; separalas en preguntas sucesivas.

### Cancelación o pausa

Si `ask_user_question` indica cancelación:

1. No hagas otra pregunta.
2. Escribí un resumen visible de lo resuelto y pendiente.
3. Invocá `grill_session` con `action: "pause"`, incluyendo resumen, ramas pendientes, secciones y estimación actuales.
4. Informá el id de la sesión y que puede retomarse con `select_grill_session`.

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

No incluyas acciones para implementar o construir.

### Paso 3: persistencia final

Si el usuario confirma, con o sin encadenado:

1. Convertí el contrato visible en Markdown autocontenido.
2. Invocá `grill_session` con `action: "finalize"`, el resumen y `handoffMarkdown`.
3. Informá la ruta `.md` devuelta por la tool.
4. Si eligió **Confirmar entendimiento**, terminá sin spec ni implementación.
5. Si eligió **Confirmar y crear spec SDD**, leé `~/.agents/skills/sdd-spec/SKILL.md` y continuá ese workflow con `--from-grill <sessionId>`. El handoff confirmado es fuente autoritativa: no vuelvas a preguntar decisiones ya resueltas. La spec sigue exigiendo `.sdd/project.md`.

Si pide ajustar, retomá una sola rama y seguí el ciclo de pregunta + checkpoint. Si pausa, seguí el procedimiento de pausa.
