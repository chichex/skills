---
name: grill
description: Entrevista implacable al usuario para desambiguar un tema, plan o diseño y producir un contrato de handoff antes de construir. Usar cuando el usuario quiere stress-testear un plan, alinear un diseño antes de implementar, usa frases tipo "grill", "grillame", "entrevistame sobre esto", o quiere retomar un grill guardado. No implementa ni escribe la spec definitiva.
---

# Grill

Desambiguá el tema implacablemente hasta alcanzar un entendimiento compartido. El resultado es un contrato de handoff confiable para una futura spec. Nunca implementes el plan ni escribas la spec definitiva desde este skill; después de congelar el handoff podés encadenar `/sdd-spec` si el usuario elige esa acción.

## Interacción en Claude Code

- Toda elección pasa por `AskUserQuestion`: hasta 4 preguntas por llamada, 2 a 4 opciones por pregunta, la recomendada primera y marcada "(Recommended)", `multiSelect` solo cuando las respuestas pueden coexistir. "Other" es automático: siempre hay respuesta libre.
- El diálogo de `AskUserQuestion` no arrastra contexto: cada pregunta tiene que poder responderse leyendo solo la pantalla actual. Lo que la pregunta referencia (mapa, propuesta, contrato) tiene que estar ya renderizado como mensaje visible en el chat — nunca pidas confirmar algo que todavía no escribiste.
- Persistí sesiones únicamente como Markdown en `.sdd/grills/`, con ediciones normales de archivos. No crees el directorio hasta que el usuario guarde, pause o exporte.

## Principios

- Los hechos se investigan; las decisiones se preguntan. Si algo se puede averiguar explorando el codebase o la documentación local, buscalo en vez de preguntarlo. Las decisiones son del usuario: no las infieras en silencio.
- Cada pregunta ofrece una recomendación concreta y su motivo.
- Separá siempre hechos comprobados, supuestos y decisiones del usuario.
- Recorré las dependencias en orden: primero las decisiones de las que dependen otras ramas.
- Tope duro de 20 preguntas de decisión por sesión. No lo esquives con preguntas compuestas; si el árbol supera 20, dividilo en bloques.
- Cada decisión se responde explícitamente: no hay aprobación por silencio, y ninguna recomendación se persiste como decisión antes del OK del usuario.

## Reconocimiento

Antes de entrevistar:

1. Explorá el codebase cuando el tema dependa de él y resolvé todos los hechos comprobables relevantes.
2. Buscá `CONTEXT-MAP.md`, `CONTEXT.md`, `docs/adr/` y handoffs previos en `.sdd/grills/`. Leé los relevantes para entender vocabulario y decisiones ya tomadas, sin modificarlos todavía.
3. Construí un árbol provisional de decisiones con secciones y dependencias explícitas: qué pregunta desbloquea a cuáles.
4. Estimá preguntas mínimas, probables y máximas. La cifra operativa es la probable; presentala como estimación, no como promesa — una respuesta puede abrir o cerrar ramas.
5. Diagnosticá la modalidad recomendada:
   - **Por rondas** (default) cuando el árbol es razonablemente estable, hay ramas independientes que se pueden preguntar en paralelo y corregir un rumbo es barato.
   - **Pregunta a pregunta** cuando las dependencias son densas (casi cada respuesta reformula la siguiente pregunta), hay contradicciones por resolver, decisiones costosas de revertir o alta probabilidad de que las respuestas abran ramas nuevas.
   - La cantidad de preguntas no es el criterio: lo que importa es cuánta adaptación exige el árbol.
6. Mostrá un mapa breve como mensaje visible: objetivo de desambiguación, hechos ya comprobados, artefactos de dominio encontrados, supuestos, secciones del árbol con sus dependencias, estimación mínima/probable/máxima, alcance de la sesión, y modalidad recomendada con sus señales.

### Atajo liviano (1 a 3 preguntas)

Si la estimación probable es de 1 a 3 preguntas, decilo en una línea (es el territorio de `/mini-grill`) y resolvelo liviano: sin mapa ni configuración (modo `standard`, salvo pedido explícito de documentación de dominio), todo en una sola ronda de `AskUserQuestion`, y directo al cierre. El invariante del cierre no se negocia: contrato visible — puede ser breve — antes de pedir confirmación. Guardá el handoff solo si el usuario lo pide, pausa, o elige encadenar la spec (que necesita la ruta).

### Límite de 20

- Si la estimación probable supera 20, no empieces la entrevista completa: proponé una división en bloques de hasta 20 preguntas, explicá las dependencias entre bloques, recomendá cuál abordar primero y dejá que el usuario elija con `AskUserQuestion` (si la división produce más de 4 bloques, los primeros según el orden recomendado van como opciones y el resto vía "Other"). Los bloques no elegidos quedan como ramas pendientes de la sesión.
- Cada pregunta presentada en una ronda cuenta individualmente contra el tope, aunque varias salgan en la misma llamada.
- Si durante la entrevista aparecen ramas nuevas y se llega a 20: pausá, mostrá lo resuelto, lo pendiente y una división recomendada para continuar en otra sesión (la exportación de cuestionario queda disponible).
- La configuración, la elección de bloque, las preguntas de reanudación y la confirmación final no cuentan contra las 20.

## Configuración

Salvo en el atajo liviano, después del mapa y antes de la primera pregunta, elegí con UNA llamada a `AskUserQuestion` que trae dos preguntas:

1. **Documentación**
   - `Solo grill y handoff`: no modifica glosarios ni propone ADRs.
   - `Grill + documentación de dominio`: cargá el skill `/domain-modeling` y mantené el `CONTEXT.md` correcto a medida que se confirman términos; después del handoff se evalúan ADRs uno por uno. Elegirla cuenta como el pedido explícito que exige la regla de contaminación cero (se pueden crear `CONTEXT.md` o `docs/adr/` aunque el repo no los use todavía), pero cada ADR conserva su gate de aprobación individual.
   - Recomendá según la evidencia del reconocimiento: dominio si el repo ya mantiene esos artefactos y el tema los toca, o si el usuario pidió documentar; `Solo grill y handoff` en el resto de los casos.
2. **Modalidad**
   - `Por rondas`: hasta 4 preguntas ya desbloqueadas por llamada.
   - `Pregunta a pregunta`: una por vez; cada respuesta moldea la siguiente.
   - Marcá como recomendada la que salió del diagnóstico del reconocimiento y explicá el motivo en la descripción.

Si el usuario ya fijó una elección en su pedido — o llegó vía `/grill-with-domain-modeling`, que fija la documentación — no la vuelvas a preguntar.

## Entrevista por rondas

El motor default. Cada ronda presenta la **frontera de dependencias**: solo las decisiones cuyas dependencias ya están resueltas.

1. Calculá la frontera actual del árbol.
2. Si dos preguntas de la frontera están acopladas de hecho (la respuesta de una cambiaría cómo se formula la otra o sus opciones), dejá una para la ronda siguiente.
3. Armá UNA llamada a `AskUserQuestion` con hasta 4 preguntas de la frontera, priorizando las que desbloquean más ramas. Cada pregunta: autocontenida, con un encabezado corto de su sección, 2 a 4 opciones mutuamente comprensibles, la recomendada primera y marcada "(Recommended)" con su trade-off en la descripción, y `multiSelect` solo si las respuestas pueden coexistir.
4. Con las respuestas: registrá cada decisión, actualizá el árbol y recalculá la frontera. Ahí se abre la ronda siguiente.
5. Si una respuesta (típicamente vía "Other") contradice una decisión ya resuelta o invalida decisiones posteriores: mostrá la contradicción como mensaje visible, recalculá lo afectado y volvé a preguntar solo eso.
6. Repetí hasta agotar las ramas del alcance elegido.
7. En modo de dominio, actualizá el `CONTEXT.md` correcto apenas quede confirmado un término, antes de la ronda siguiente.
8. Si el usuario cancela una ronda, no abras otra: escribí un resumen visible de lo resuelto y lo pendiente, y ofrecé pausar (con exportación de cuestionario disponible).

## Entrevista pregunta a pregunta

Mismo ciclo, pero con exactamente una pregunta por llamada a `AskUserQuestion`, eligiendo cada vez la rama que corresponde por dependencia, y dejando que cada respuesta moldee la siguiente pregunta. No prepares un cuestionario rígido completo: la gracia de esta modalidad es la adaptación. Usala cuando el reconocimiento la recomendó o el usuario la pidió.

## Persistencia y reanudación

Para pausar o guardar, escribí `.sdd/grills/<fecha>-<slug>.md` con:

```markdown
# Grill — <tema>
<!-- Estado: paused|finalized. Proyecto: <ruta absoluta>. Fuente: <issue o pedido>. -->

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

Al pausar, informá la ruta y ofrecé exportar el cuestionario de pendientes (ver "Exportar cuestionario").

Para retomar:

1. Si no se indicó una ruta, listá `.sdd/grills/*.md` por fecha.
2. Pedí elegir con `AskUserQuestion` solo si hay más de un candidato razonable; si hay más de 4, ofrecé los más recientes como opciones y el resto vía "Other".
3. Leé el archivo completo y contrastá sus hechos con el estado actual del repo; si difieren, mostrá la contradicción y resolvela antes de avanzar.
4. Mostrá tema, decisiones resueltas, ramas pendientes y la próxima frontera.
5. Reevaluá la modalidad para lo pendiente si cambió el panorama; no repitas decisiones ya resueltas salvo que el usuario quiera revisarlas.
6. No modifiques un handoff `finalized`; para revisarlo creá un archivo nuevo con sufijo `-rev-N`.
7. Si lo que llega es un cuestionario respondido (archivo `-cuestionario.md` editado, o su texto pegado en el chat): localizá la sesión de origen por el encabezado, registrá cada respuesta como decisión resuelta, mostrá qué quedó cerrado y qué sigue abierto, recalculá el árbol (una respuesta libre puede invalidar ramas) y continuá la entrevista o pasá al cierre.

## Exportar cuestionario

Disponible al pausar y como acción del cierre. Sirve cuando las decisiones pendientes las tiene que responder un tercero sin agente (un PM, un cliente, otro equipo): el formato está pensado para copiar y pegar en un Google Doc.

Escribí `.sdd/grills/<fecha>-<slug>-cuestionario.md`:

```markdown
# Cuestionario — <tema>
<!-- Generado por grill. Sesión de origen: .sdd/grills/<fecha>-<slug>.md -->

Cómo responder: escribí tu respuesta debajo de cada "Respuesta:". Si una opción te
sirve tal cual, alcanza con nombrarla; si no, respondé con tus palabras.

## 1. <pregunta autocontenida>

Contexto: <2-3 líneas entendibles sin acceso al repo ni a esta conversación>

Opciones:
- <opción A> — recomendada: <motivo en una línea>
- <opción B> — <trade-off>

Respuesta:
```

Reglas:

- Incluí solo las decisiones pendientes; las resueltas viven en la sesión, no en el cuestionario.
- Cada pregunta es autocontenida: contexto breve, opciones con trade-offs y la recomendación con su motivo. Nada de jerga interna sin explicar ni referencias a "lo que hablamos".
- Si hay dependencias entre pendientes, anotalas en el contexto ("si en la 3 elegiste X, esta no aplica").
- Exportar no finaliza nada: la sesión queda `paused` y se retoma cuando vuelven las respuestas (ver "Persistencia y reanudación").

## Cierre

Cerrá solo cuando las ramas dentro del alcance elegido estén resueltas.

1. **Contrato visible.** Escribí en el chat el entendimiento compartido completo como mensaje propio: tema y alcance; hechos comprobados; decisiones resueltas enumeradas una por una con lo acordado en cada una; restricciones y no-objetivos; supuestos explícitos; riesgos y preguntas deliberadamente diferidas; bloques pendientes para futuras sesiones; contexto recomendado para la sesión que escriba la spec. Este texto es el contrato de handoff: tiene que estar renderizado en el chat, no vivir solo en tu razonamiento ni en un archivo.

2. **Confirmación autocontenida.** Recién después del contrato, UNA llamada a `AskUserQuestion` con estas opciones (sin acciones de implementar o construir):
   - `Confirmar`: finaliza y congela el handoff.
   - `Confirmar y crear spec SDD`: congela el handoff y recién después encadena `/sdd-spec`.
   - `Ajustar una decisión`: el usuario indica cuál y se retoma esa rama.
   - `Pausar o exportar cuestionario`: guarda el progreso sin finalizar; un follow-up pregunta si además genera el cuestionario para un tercero.
   Si elige ajustar: retomá solo la rama elegida con el ciclo de entrevista, recalculá las decisiones dependientes si el cambio las invalida, y volvé a renderizar el contrato actualizado antes de pedir confirmación otra vez.

3. **Persistencia final.** Tras confirmar (con o sin encadenado), guardá el mismo contenido del contrato como handoff `finalized` en `.sdd/grills/<fecha>-<slug>.md` con el formato de "Persistencia y reanudación", e informá la ruta.

4. **ADRs separados** (solo en modo de dominio). Recién después de congelar el handoff — y antes de encadenar la spec, si el usuario eligió crearla —, evaluá cada decisión contra los 3 criterios de `/domain-modeling` (costo concreto de revertir, pregunta concreta de un lector sin contexto, alternativa concreta descartada con su motivo). Si ninguna califica, informá que el cierre produce cero ADRs. Por cada candidato que sí: mostrá la evidencia, la ruta y el borrador completo como mensaje visible, y abrí un `AskUserQuestion` dedicado únicamente a ese ADR. Nunca mezcles la confirmación del handoff con la aprobación de un ADR.

5. **Encadenar la spec.** Si eligió crear la spec, cargá el skill `sdd-spec` y continuá con `--from-grill <ruta-del-handoff>`. Este es el último paso del cierre: en modo de dominio va recién después de resolver los ADRs. El handoff confirmado es fuente autoritativa: la spec no vuelve a preguntar decisiones ya cerradas, y sigue exigiendo `.sdd/project.md`.

## Límites

- No implementes el plan ni escribas la spec definitiva desde este skill.
- No crees artefactos de dominio en modo `Solo grill y handoff`.
- No persistas recomendaciones como decisiones antes de la aprobación del usuario.
- No hagas preguntas compuestas para esquivar el límite de 20.
- No agrupes en una misma ronda una decisión y otra que depende de ella.
- No pidas confirmar por `AskUserQuestion` nada que no esté ya renderizado como mensaje visible.
- No modifiques un handoff `finalized`; las revisiones van en un archivo `-rev-N`.
