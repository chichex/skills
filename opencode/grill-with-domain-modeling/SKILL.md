---
name: grill-with-domain-modeling
description: Sesion de /grill que ademas mantiene los docs del dominio (glosario CONTEXT.md y ADRs) a medida que las decisiones cristalizan. Usar SOLO cuando el usuario lo invoca explicitamente; nunca activarlo por iniciativa propia.
---

Corre una sesion de `/grill` usando el skill `/domain-modeling`.

Invocar este skill cuenta como el pedido explicito que exige la regla de contaminacion cero de `/domain-modeling`: se pueden crear `CONTEXT.md` y `docs/adr/` aunque todavia no existan en el repo. Los ADRs siguen bajo default-deny: 3 criterios con evidencia concreta + OK explicito del usuario por cada uno.
