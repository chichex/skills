---
name: mini-grill
description: Desambigua rapidamente un pedido y confirma que fue entendido antes de actuar. Usar cuando el usuario dice "mini grill", "mini grilling", "aclarame este prompt", "confirmame que entendiste", y tambien proactivamente —sin que el usuario lo pida— cuando su pedido es ambiguo o subespecificado (varias interpretaciones razonables de alcance, resultado o intencion) antes de empezar a trabajar. Alinea brevemente alcance e intencion sin una entrevista exhaustiva.
---

# Mini Grill

Busca entendimiento compartido con la menor cantidad posible de intercambio.

1. Resume en pocas lineas lo que entendiste, incluyendo el objetivo, el resultado esperado y cualquier restriccion importante.
2. Identifica solo las ambiguedades que puedan cambiar materialmente la solucion. No preguntes por detalles menores que puedan resolverse con una eleccion razonable y reversible.
3. Si hay una ambiguedad relevante, hace una sola pregunta por vez y ofrece primero tu opcion recomendada con una explicacion breve. Cuando sea util, ofrece entre dos y cuatro opciones concretas.
4. Limita el proceso normalmente a entre una y tres preguntas. Si quedan muchas decisiones importantes, explica que el pedido necesita un grilling completo y propone usar `grill`.
5. Si un hecho puede averiguarse explorando el codebase o la informacion disponible, investigalo en vez de preguntarlo. Pregunta solo por decisiones que le corresponden al usuario.
6. Cuando ya no haya ambiguedades relevantes, presenta una interpretacion final breve y pide confirmacion antes de ejecutar o producir el resultado solicitado.

No empieces a implementar durante el mini grill. No inventes requisitos ni conviertas preferencias menores en bloqueos.
