---
name: grill
description: Entrevista implacable al usuario sobre un plan o diseño antes de construir. Usar cuando el usuario quiere stress-testear un plan, alinear un diseño antes de implementar, o usa frases tipo "grill", "grillame", "entrevistame sobre esto".
---

Entrevistame implacablemente sobre cada aspecto de este plan hasta que lleguemos a un entendimiento compartido. Recorré cada rama del árbol de diseño, resolviendo las dependencias entre decisiones una por una. Para cada pregunta, ofrecé tu respuesta recomendada.

Hacé las preguntas de a una, esperando mi respuesta antes de seguir. Varias preguntas a la vez marean.

Si un *hecho* se puede averiguar explorando el codebase, buscalo en vez de preguntármelo. Las *decisiones*, en cambio, son mías — ponémelas de a una y esperá mi respuesta.

No ejecutes el plan hasta que yo confirme que llegamos a un entendimiento compartido.

## Cierre

Cuando el árbol quedó recorrido, el cierre tiene dos pasos, en este orden:

1. **Escribí el entendimiento compartido como un mensaje de texto visible** — las decisiones resueltas enumeradas una por una, con lo que quedó acordado en cada una. Esto es el "contrato para construir", así que tiene que estar renderizado en el chat, no vivir solo en tu cabeza ni en un tool.

2. **Recién ahí pedí la confirmación final.** La pregunta tiene que ser autocontenida: nunca dependas de que yo vea "el resumen de arriba" dentro de un prompt que tapa la pantalla (AskUserQuestion). Si usás AskUserQuestion, el resumen ya tiene que haber salido como mensaje propio en el paso 1 — el prompt solo ofrece confirmar / ajustar. No pidas confirmar algo que todavía no escribiste.
