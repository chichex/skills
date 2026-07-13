---
name: grill-with-domain-modeling
description: Sesión de /grill que además mantiene los docs del dominio (glosario CONTEXT.md y ADRs) a medida que las decisiones cristalizan.
disable-model-invocation: true
---

Corré una sesión de `/grill` usando el skill `/domain-modeling`.

Invocar este skill cuenta como el pedido explícito que exige la regla de contaminación cero de `/domain-modeling`: se pueden crear `CONTEXT.md` y `docs/adr/` aunque todavía no existan en el repo. Los ADRs siguen bajo default-deny: 3 criterios con evidencia concreta + OK explícito del usuario por cada uno.

## Cierre: plan y ADR van separados

El cierre tiene dos decisiones distintas, y **nunca se bundlean en el mismo prompt**. Van como pasos secuenciales:

1. **Confirmar el plan** — el cierre de `/grill`: escribí el entendimiento compartido como mensaje visible y pedí la confirmación final (contrato para construir). Terminá este paso antes de tocar el siguiente.

2. **Decidir el/los ADR** — recién con el plan confirmado, evaluá si alguna decisión de la sesión amerita un ADR según los 3 criterios de `/domain-modeling`. Si amerita, mostrá el borrador completo y pedí el OK explícito — como su propio prompt, uno por ADR.

Un solo AskUserQuestion que mezcle "¿confirmás el plan?" con "¿creo el ADR?" fuerza a decidir dos cosas de distinta naturaleza a la vez y arrastra el problema de referenciar contenido que el modal tapa. Mantenelas aparte.
