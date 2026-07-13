---
name: domain-modeling
description: Mantener el modelo de dominio del proyecto; glosario (CONTEXT.md) y ADRs (docs/adr/). Usar SOLO si el usuario pide explicitamente registrar un termino o una decision, o si el repo YA tiene CONTEXT.md o docs/adr/ y la conversacion toca su contenido. NUNCA introducir esta practica en un repo que no la usa.
---

# Domain Modeling

Construir y afilar activamente el modelo de dominio del proyecto mientras se disena: desafiar terminos, inventar escenarios borde, y escribir el glosario y las decisiones en el momento en que cristalizan. (Meramente *leer* `CONTEXT.md` para conocer el vocabulario no es este skill; eso es un habito de una linea que cualquier skill puede tener. Este skill es para cuando el modelo *cambia*, no cuando solo se consume.)

## Regla de contaminacion cero

Este skill nunca introduce la practica en un repo que no la usa. Si el repo no tiene `CONTEXT.md` ni `docs/adr/`, esos archivos solo se crean si el usuario lo pidio explicitamente en esta conversacion. En repos compartidos son artefactos del equipo: crearlos sin pedido es contaminar el workflow de otros.

## Estructura de archivos

La mayoria de los repos tienen un solo contexto: un `CONTEXT.md` en la raiz y ADRs en `docs/adr/`. Si existe un `CONTEXT-MAP.md` en la raiz, el repo tiene multiples contextos y el mapa indica donde vive cada uno (ver [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md)).

Crear archivos de forma lazy: solo cuando hay algo que escribir (y respetando la regla de contaminacion cero).

## Durante la sesion

### Desafiar contra el glosario

Cuando el usuario usa un termino que contradice el lenguaje existente en `CONTEXT.md`, marcarlo de inmediato: "Tu glosario define 'cancelacion' como X, pero parece que queres decir Y, cual es?"

### Afilar el lenguaje difuso

Cuando el usuario usa terminos vagos o sobrecargados, proponer un termino canonico preciso: "Decis 'cuenta': te referis al Customer o al User? Son cosas distintas."

### Discutir escenarios concretos

Cuando se discuten relaciones del dominio, stress-testearlas con escenarios especificos que fuercen precision en los bordes entre conceptos.

### Cruzar contra el codigo

Cuando el usuario afirma como funciona algo, verificar si el codigo coincide. Si hay contradiccion, exponerla: "Tu codigo cancela Orders enteras, pero acabas de decir que la cancelacion parcial es posible, cual es la verdad?"

### Actualizar CONTEXT.md en el momento

Cuando un termino queda resuelto, actualizar `CONTEXT.md` ahi mismo; no acumular para el final. Formato en [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` es un glosario y nada mas: cero detalles de implementacion. No es una spec, ni un scratchpad, ni un repositorio de decisiones de implementacion.

### ADRs: por defecto, NO

La mayoria de las sesiones terminan con **cero ADRs**. Un ADR de mas cuesta mas que un ADR de menos: entierra a los que importan. Ante la duda, no ofrecer.

Ofrecer un ADR exige enunciar los tres criterios con evidencia concreta; si alguno solo se puede llenar con vaguedades, la oferta muere:

1. **Dificil de revertir**: "dificil porque \<costo concreto de cambiar de opinion\>"
2. **Sorprendente sin contexto**: "un lector futuro se preguntaria \<pregunta concreta\>"
3. **Trade-off real**: "descartamos \<alternativa concreta\> por \<razon concreta\>"

Mostrar el borrador completo del ADR y esperar el OK explicito del usuario antes de escribir el archivo. Formato y ejemplos (positivos y negativos) en [ADR-FORMAT.md](./ADR-FORMAT.md).

Al revertir o reemplazar una decision que tiene ADR, marcar el viejo como `superseded by ADR-NNNN`; un ADR superado sin marcar empuja a los agentes futuros hacia atras.
