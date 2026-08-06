---
name: grill-with-domain-modeling
description: Sesión de /grill que además mantiene los docs del dominio (glosario CONTEXT.md y ADRs) a medida que las decisiones cristalizan. Usar SOLO cuando el usuario lo invoca explícitamente; nunca activarlo por iniciativa propia.
---

Corré una sesión de `/grill` usando el skill `/domain-modeling`.

Invocar este skill cuenta como el pedido explícito que exige la regla de contaminación cero de `/domain-modeling`: se pueden crear `CONTEXT.md` y `docs/adr/` aunque todavía no existan en el repo. Los ADRs siguen bajo default-deny: 3 criterios con evidencia concreta + OK explícito del usuario por cada uno.
