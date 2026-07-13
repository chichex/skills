---
name: domain-modeling
description: Mantener el modelo de dominio del proyecto — glosario (CONTEXT.md) y ADRs (docs/adr/). Usar SOLO si el usuario pide explícitamente registrar un término o una decisión, o si el repo YA tiene CONTEXT.md o docs/adr/ y la conversación toca su contenido. NUNCA introducir esta práctica en un repo que no la usa.
---

# Domain Modeling

Construir y afilar activamente el modelo de dominio del proyecto mientras se diseña: desafiar términos, inventar escenarios borde, y escribir el glosario y las decisiones en el momento en que cristalizan. (Meramente *leer* `CONTEXT.md` para conocer el vocabulario no es este skill — eso es un hábito de una línea que cualquier skill puede tener. Este skill es para cuando el modelo *cambia*, no cuando solo se consume.)

## Regla de contaminación cero

Este skill nunca introduce la práctica en un repo que no la usa. Si el repo no tiene `CONTEXT.md` ni `docs/adr/`, esos archivos solo se crean si el usuario lo pidió explícitamente en esta conversación. En repos compartidos son artefactos del equipo: crearlos sin pedido es contaminar el workflow de otros.

## Estructura de archivos

La mayoría de los repos tienen un solo contexto: un `CONTEXT.md` en la raíz y ADRs en `docs/adr/`. Si existe un `CONTEXT-MAP.md` en la raíz, el repo tiene múltiples contextos y el mapa indica dónde vive cada uno (ver [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md)).

Crear archivos de forma lazy — solo cuando hay algo que escribir (y respetando la regla de contaminación cero).

## Durante la sesión

### Desafiar contra el glosario

Cuando el usuario usa un término que contradice el lenguaje existente en `CONTEXT.md`, marcarlo de inmediato: "Tu glosario define 'cancelación' como X, pero parece que querés decir Y — ¿cuál es?"

### Afilar el lenguaje difuso

Cuando el usuario usa términos vagos o sobrecargados, proponer un término canónico preciso: "Decís 'cuenta' — ¿te referís al Customer o al User? Son cosas distintas."

### Discutir escenarios concretos

Cuando se discuten relaciones del dominio, stress-testearlas con escenarios específicos que fuercen precisión en los bordes entre conceptos.

### Cruzar contra el código

Cuando el usuario afirma cómo funciona algo, verificar si el código coincide. Si hay contradicción, exponerla: "Tu código cancela Orders enteras, pero acabás de decir que la cancelación parcial es posible — ¿cuál es la verdad?"

### Actualizar CONTEXT.md en el momento

Cuando un término queda resuelto, actualizar `CONTEXT.md` ahí mismo — no acumular para el final. Formato en [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` es un glosario y nada más: cero detalles de implementación. No es una spec, ni un scratchpad, ni un repositorio de decisiones de implementación.

### ADRs: por defecto, NO

La mayoría de las sesiones terminan con **cero ADRs**. Un ADR de más cuesta más que un ADR de menos: entierra a los que importan. Ante la duda, no ofrecer.

Ofrecer un ADR exige enunciar los tres criterios con evidencia concreta — si alguno solo se puede llenar con vaguedades, la oferta muere:

1. **Difícil de revertir** — "difícil porque \<costo concreto de cambiar de opinión\>"
2. **Sorprendente sin contexto** — "un lector futuro se preguntaría \<pregunta concreta\>"
3. **Trade-off real** — "descartamos \<alternativa concreta\> por \<razón concreta\>"

Mostrar el borrador completo del ADR y esperar el OK explícito del usuario antes de escribir el archivo. Formato y ejemplos (positivos y negativos) en [ADR-FORMAT.md](./ADR-FORMAT.md).

Al revertir o reemplazar una decisión que tiene ADR, marcar el viejo como `superseded by ADR-NNNN` — un ADR superado sin marcar empuja a los agentes futuros hacia atrás.
