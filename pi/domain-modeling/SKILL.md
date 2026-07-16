---
name: domain-modeling
description: Mantiene vivo el modelo de dominio del proyecto mediante un glosario CONTEXT.md y ADRs en docs/adr/. Usar solo si el usuario pide explícitamente registrar términos o decisiones, o si el repo ya usa esos artefactos y la conversación modifica su contenido. Durante un grill, usar solo si se eligió su modo de documentación de dominio. Nunca introduce esta práctica silenciosamente.
license: MIT; adaptado de chichex/skills
---

# Domain Modeling

Construí y afilá el modelo de dominio mientras se diseña: desafiá términos, probá escenarios borde y registrá el lenguaje y las decisiones cuando cristalizan.

Meramente leer `CONTEXT.md` para entender el vocabulario no activa este workflow. Este skill aplica cuando el modelo cambia.

## Regla de contaminación cero

No introduzcas esta práctica en un repo que no la usa.

Si el repo no tiene `CONTEXT.md`, `CONTEXT-MAP.md` ni `docs/adr/`, solo podés crear esos artefactos cuando el usuario lo pidió explícitamente en la conversación. Invocar `/skill:domain-modeling` o elegir **Grill + documentación de dominio** dentro de `/skill:grill` cuenta como pedido explícito. Invocar un grill estándar no cuenta como consentimiento.

Durante una sesión de grill, el `workflowMode` persistido es autoritativo. Si es `standard`, no modifiques artefactos de dominio aunque el repo ya los use; cualquier cambio de modo debe confirmarse mediante el workflow de `grill` y persistirse antes de escribir.

## Reconocimiento

Antes de modificar el modelo:

1. Encontrá la raíz del repo.
2. Buscá `CONTEXT-MAP.md`, los `CONTEXT.md` existentes y `docs/adr/`.
3. Si existe `CONTEXT-MAP.md`, leelo y usalo para ubicar el bounded context correcto.
4. Leé el glosario y los ADRs relevantes antes de proponer cambios.
5. Conservá el idioma, tono y estructura que ya use el repo.

Creá archivos de forma lazy: solo cuando exista contenido confirmado para escribir.

## Durante la conversación

### Desafiar el glosario

Cuando el usuario use un término que contradiga el lenguaje existente, marcá la contradicción inmediatamente. Ejemplo: "El glosario define cancelación como X, pero acá parece significar Y. ¿Cuál debe ser el término canónico?"

### Afilar lenguaje difuso

Cuando aparezcan términos vagos o sobrecargados, proponé una distinción concreta. No aceptes sin examen palabras como "cuenta", "estado", "registro" o "usuario" si pueden nombrar conceptos diferentes en ese dominio.

### Probar escenarios concretos

Stress-testeá relaciones y reglas con escenarios que fuercen precisión en los límites: identidad, ownership, cardinalidad, transiciones, concurrencia, fallas y excepciones.

### Cruzar contra el código

Verificá afirmaciones comprobables en el codebase en vez de preguntarlas. Si código, glosario y explicación se contradicen, exponé la evidencia y pedí que el usuario decida cuál representa el dominio deseado.

### Actualizar CONTEXT.md inmediatamente

Cuando un término queda resuelto, actualizá el `CONTEXT.md` correspondiente antes de avanzar a otra decisión. No acumules cambios para el final.

`CONTEXT.md` es solo un glosario de dominio:

- cero detalles de implementación;
- cero decisiones arquitectónicas;
- cero contenido de spec o scratchpad;
- una o dos oraciones por definición;
- un término canónico y, cuando aporte, sinónimos desaconsejados bajo `_Avoid_`.

Seguí [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

## ADRs: default deny

La mayoría de las sesiones deben terminar con cero ADRs. Solo proponé uno si cumple simultáneamente estos tres criterios con evidencia concreta:

1. **Difícil de revertir**: cambiar luego tiene un costo específico y significativo.
2. **Sorprendente sin contexto**: un lector futuro formularía una pregunta concreta sobre por qué se eligió esto.
3. **Trade-off real**: se descartó una alternativa genuina por una razón específica.

Si alguno se expresa con vaguedad, no propongas el ADR.

Antes de escribir cada ADR:

1. Mostrá en el chat la evidencia de los tres criterios.
2. Mostrá el borrador completo y la ruta propuesta.
3. Pedí aprobación explícita del usuario; nunca infieras aprobación.
4. Escribilo solo después del OK.

En Pi, usá `ask_user_question` para esa aprobación, una decisión por vez. El borrador debe estar visible en el chat antes de abrir el selector.

Seguí [ADR-FORMAT.md](./ADR-FORMAT.md). Si una decisión reemplaza otra documentada, marcá el ADR anterior como `superseded by ADR-NNNN`.
