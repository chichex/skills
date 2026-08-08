---
name: grill
description: Entrevista implacable para desambiguar un tema, plan o diseño y producir un contrato de handoff antes de escribir una spec. Permite mantener opcionalmente CONTEXT.md y ADRs durante la entrevista. Usar cuando el usuario quiere stress-testear, aclarar o alinear una idea, pide "grill", "grillame", "entrevistame sobre esto", o quiere retomar un handoff guardado. No implementa ni escribe la spec definitiva.
---

# Grill

Desambiguar el tema hasta alcanzar un entendimiento compartido. El resultado es un handoff confiable para una futura spec. No implementar ni escribir la spec definitiva durante este workflow.

## Interacción en Codex

Usar `request_user_input` solo cuando esté disponible. Si no está disponible, formular la misma pregunta en texto plano, terminar el turno y continuar al recibir la respuesta. Hacer exactamente una pregunta por vez en el modo adaptativo.

No depender de extensiones de Pi ni de tools inexistentes. Persistir sesiones únicamente como Markdown en `.sdd/grills/`, mediante ediciones normales de archivos. No crear el directorio hasta que el usuario elija guardar o pausar una sesión.

## Principios

- Resolver hechos explorando código y documentación; preguntar solo decisiones.
- Recorrer primero las decisiones de las que dependen otras ramas.
- Ofrecer una recomendación concreta y su motivo en cada pregunta.
- Separar hechos comprobados, supuestos y decisiones del usuario.
- Limitar cada sesión a 20 preguntas de decisión. Si el árbol probable supera 20, dividirlo y pedir qué bloque abordar.
- No interpretar silencio como aprobación.

## Reconocimiento

Antes de entrevistar:

1. Explorar el codebase cuando el tema dependa de él.
2. Buscar `CONTEXT-MAP.md`, `CONTEXT.md`, `docs/adr/` y handoffs en `.sdd/grills/`.
3. Construir un árbol provisional de decisiones, secciones y dependencias.
4. Estimar preguntas mínimas, probables y máximas.
5. Recomendar un modo:
   - **Rápido** cuando el árbol sea estable, poco profundo y las decisiones sean reversibles e independientes.
   - **Pregunta a pregunta** cuando haya contradicciones, riesgos altos, decisiones costosas de revertir o respuestas que puedan abrir ramas nuevas.
6. Mostrar un mapa breve: objetivo, hechos, supuestos, ramas, estimación y recomendación.

## Configuración

Elegir por separado:

1. **Documentación**
   - `Solo grill y handoff` (default): no modificar glosarios ni proponer ADRs.
   - `Grill + documentación de dominio`: cargar `domain-modeling`; elegirlo cuenta como consentimiento explícito para mantener `CONTEXT.md`, pero cada ADR conserva su gate de aprobación.
2. **Modalidad**
   - `Grillado rápido`.
   - `Grillado pregunta a pregunta`.

Si el usuario ya fijó una elección en su pedido, no volver a preguntarla.

## Entrevista pregunta a pregunta

Por cada decisión:

1. Elegir la siguiente rama por dependencia.
2. Formular una pregunta autocontenida, con dos o tres opciones mutuamente excluyentes cuando ayude.
3. Poner primero la opción recomendada y explicar el trade-off.
4. Esperar la respuesta.
5. Actualizar el árbol y no repetir decisiones resueltas.
6. En modo de dominio, actualizar inmediatamente el `CONTEXT.md` correcto cuando quede confirmado un término.

## Grillado rápido

1. Renderizar hasta 20 decisiones en orden de dependencia.
2. Para cada una mostrar pregunta, alternativas, propuesta recomendada, motivo y condiciones.
3. Aclarar que son propuestas, no decisiones confirmadas.
4. Pedir al usuario que indique cuáles quiere revisar; ninguna objeción explícita confirma las propuestas visibles.
5. Resolver una por una las decisiones objetadas. Recalcular las dependientes cuando cambie una respuesta.
6. En modo de dominio, escribir términos confirmados solo después de la aprobación del lote o de la resolución individual.

## Persistencia y reanudación

Para pausar o guardar, escribir `.sdd/grills/<fecha>-<slug>.md` con:

```markdown
# Grill — <tema>
<!-- Estado: paused|finalized. Proyecto: <ruta absoluta>. Fuente: <issue o pedido>. -->
<!-- SDD-Tracking: version=1; type=grill; state=<paused|finalized>; issue=<#NN|owner/repo#NN|none>; grill=<ref>; project=<ref> -->

## Modo
<standard|domain-modeling>

## Hechos comprobados
...

## Decisiones resueltas
1. ...

## Ramas pendientes
...

## Handoff
<vacío mientras esté paused; contrato completo cuando esté finalized>
```

El marker `SDD-Tracking` es la identidad machine-readable del handoff (contrato SDD-Tracking v1) y acompaña al comentario humano: `state` refleja el `Estado:`; `issue` lleva el issue de origen (`#NN`, `owner/repo#NN` o `none`); `grill` una referencia estable de la sesión (el `<fecha>-<slug>` del archivo); `project` la misma ruta absoluta del campo `Proyecto:`. En `grill` y `project`, todo byte fuera de `[A-Za-z0-9._~-]` se escribe percent-encodeado (`%HH` en mayúsculas) — p. ej. `/workspace/demo` queda `%2Fworkspace%2Fdemo` — y ninguno de los dos admite `none`. Guardar de nuevo hace upsert: exactamente un marker, actualizado en su lugar.

Al pausar, ofrecer además exportar las decisiones pendientes como cuestionario para un tercero (ver **Exportar cuestionario**).

Para retomar:

1. Listar `.sdd/grills/*.md` por fecha si no se indicó una ruta.
2. Pedir elegir solo si hay más de un candidato razonable.
3. Leer el archivo completo y contrastar sus hechos con el estado actual del repo.
4. Si existe un `<fecha>-<slug>-cuestionario.md` con respuestas completadas, leerlo e incorporar cada respuesta como decisión resuelta; repreguntar solo lo ambiguo.
5. Mostrar decisiones resueltas, ramas pendientes y próxima pregunta.
6. No modificar un handoff `finalized`; para revisarlo crear un archivo nuevo con sufijo `-rev-N`.

## Exportar cuestionario

Al pausar y en el cierre, ofrecer exportar las decisiones pendientes como `.sdd/grills/<fecha>-<slug>-cuestionario.md`: un cuestionario autocontenido para un tercero sin agente, pensado para pegar en un Google Doc y discutir con un stakeholder.

Por cada decisión pendiente incluir:

1. Contexto breve que la haga entendible sin leer el resto de la sesión.
2. La pregunta y sus opciones.
3. La opción recomendada y su motivo.
4. Un espacio explícito para la respuesta.

No usar jerga interna de la sesión ni referencias que el tercero no pueda resolver. Al exportar, dejar la sesión guardada como `paused` e informar la ruta del cuestionario. Cuando vuelvan las respuestas, retomar el grill leyendo ese archivo: registrar cada respuesta como decisión resuelta, repreguntar solo lo ambiguo y continuar con las ramas restantes.

## Cierre

Cuando las ramas del alcance estén resueltas:

1. Mostrar en el chat un contrato autocontenido con tema, alcance, hechos, decisiones enumeradas, restricciones, no-objetivos, supuestos, riesgos, pendientes y contexto recomendado para la spec.
2. Pedir una confirmación explícita y autocontenida: confirmar, ajustar una decisión, pausar, exportar cuestionario para un stakeholder (ver **Exportar cuestionario**) o confirmar y crear spec SDD.
3. Tras confirmar, guardar el mismo contenido como handoff `finalized` en `.sdd/grills/`.
4. Si pidió crear spec, cargar `sdd-spec` y continuar con `--from-grill <ruta-del-handoff>`.

En modo `domain-modeling`, evaluar ADRs recién después de confirmar el handoff. Mostrar evidencia, ruta y borrador completo; pedir aprobación separada para cada ADR. Nunca mezclar la aprobación del handoff con la de un ADR.

## Límites

- No implementar el plan.
- No escribir la spec definitiva desde este skill.
- No crear artefactos de dominio en modo estándar.
- No persistir recomendaciones como decisiones antes de la aprobación del usuario.
- No hacer preguntas compuestas para esquivar el límite de 20.
