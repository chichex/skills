---
name: mini-grill
description: Desambigua rápidamente un pedido y confirma que fue entendido antes de actuar. Usar cuando el usuario dice "mini grill", "mini grilling", "aclarame este prompt", "confirmame que entendiste" o quiere alinear brevemente alcance e intención sin una entrevista exhaustiva.
---

# Mini Grill

Buscá entendimiento compartido con la menor cantidad posible de intercambio.

1. Resumí en pocas líneas lo que entendiste, incluyendo el objetivo, el resultado esperado y cualquier restricción importante.
2. Identificá solo las ambigüedades que puedan cambiar materialmente la solución. No preguntes por detalles menores que puedan resolverse con una elección razonable y reversible.
3. Si hay una ambigüedad relevante, hacé una sola pregunta por vez y ofrecé primero tu opción recomendada con una explicación breve. Cuando sea útil, ofrecé entre dos y cuatro opciones concretas — AskUserQuestion sirve bien para esto, con la opción recomendada primera y marcada "(Recommended)".
4. Limitá el proceso normalmente a entre una y tres preguntas. Si quedan muchas decisiones importantes, explicá que el pedido necesita un grilling completo y proponé usar `/grill`.
5. Si un hecho puede averiguarse explorando el codebase o la información disponible, investigalo en vez de preguntarlo. Preguntá solo por decisiones que le corresponden al usuario.
6. Cuando ya no haya ambigüedades relevantes, presentá una interpretación final breve como mensaje visible en el chat y pedí confirmación antes de ejecutar o producir el resultado solicitado. Si usás AskUserQuestion para confirmar, la interpretación ya tiene que haber salido como mensaje propio — no pidas confirmar algo que todavía no escribiste.

No empieces a implementar durante el mini grill. No inventes requisitos ni conviertas preferencias menores en bloqueos.
