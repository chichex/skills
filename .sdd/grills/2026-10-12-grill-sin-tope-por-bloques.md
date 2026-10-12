# Grill — grill sin tope y siempre por bloques
<!-- Estado: finalized. Proyecto: /Users/ayrtonmarini/workspace/skills. Fuente: pedido en chat «quiero sacar el límite de preguntas en un grill». -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-10-12-grill-sin-tope-por-bloques; project=%2FUsers%2Fayrtonmarini%2Fworkspace%2Fskills -->

## Hechos comprobados

- El tope aparece en cuatro lugares de doctrina de cada harness: `## Principios`, `### Límite de 20`, la frase «no cuenta contra el tope de 20» del bloque `grill-design` y `## Límites` (grep en `claude|codex|opencode|pi/grill/SKILL.md`). Codex y opencode suman «Renderizar hasta 20 decisiones» en Grillado rápido. Pi suma `frontierSize` «hasta 20» y tres notas de conteo en las modalidades B y C.
- Pi lo aplica en código: `questionLimit` se persiste en el snapshot con default 20 y el `checkpoint` lanza `Hard question limit reached` al llegar (`pi-extensions/grill-tools/index.ts:1452,1505-1509`; `inventory.ts:11,263-265`). El import de handoffs también lo fija (`runtime-import.ts:66`). El `progress` lo imprime como `(limit N)` (`index.ts:491`).
- `ask_user_question` acota `frontierSize` a 20 por schema (`pi-extensions/ask-user-question/index.ts:121-126`). En modo `rounds`, las fases `configuration` y `closure` admiten `ask_user_question` sin `frontierSize` (`index.ts:289-296`).
- `GRILL_SNAPSHOT_VERSION` solo se escribe, nunca se lee para migrar (`inventory.ts:74,279`). El normalizador arma el snapshot campo por campo, así que un snapshot viejo con `questionLimit` se sigue leyendo (`inventory.ts:277-295`).
- El snapshot ya modela secciones con `id`, `title`, `estimatedQuestions`, `dependsOn` y `status` (`index.ts:111-117`). Las acciones de `grill_session` son `create`, `configure`, `checkpoint`, `pause`, `finalize`, `cancel` y `get`.
- Tests que fijan el 20: cuatro asserts de `questionLimit: 20` en `grill-tools` (`inventory.test.ts:63`, `index.test.ts:310,585`, `runtime-import.test.ts:98`) y el regex `/no cuenta contra el tope de 20/` en `design-gate.test.ts:475`. Ningún test cubre el throw del tope ni el máximo de `frontierSize`.
- README, `mini-grill`, evals, `docs/` y `harness-gate` no mencionan el tope. El tope nació con los ports iniciales (`ca41fa0`, `5aec46d`), sin spec que lo justifique.

## Decisiones resueltas

1. El tope de 20 se elimina por completo: de la doctrina de los cuatro harnesses y de la extensión Pi. `questionLimit` sale del snapshot, del parámetro de `create`, del `progress` y del import; el `checkpoint` nunca frena; `frontierSize` pierde el máximo. No queda forma de fijar un tope por sesión.
2. La entrevista es siempre por bloques. Un bloque es una sección coherente del árbol de decisiones. El mapa del reconocimiento lista los bloques en orden de dependencias, con su estimación. Dentro de un bloque se entrevista como hoy: por rondas sobre la frontera (hasta 4 por llamada) o pregunta a pregunta. En Pi, el Grillado rápido también va bloque a bloque.
3. Una sesión recorre todos los bloques, uno tras otro, con opción de cortar en cada frontera de bloque. Al cerrar un bloque, el agente muestra un resumen corto de lo decidido, anuncia el siguiente y hace una sola pregunta con dos opciones: «Seguir con <bloque>» (recomendada) o «Cortar acá y seguir más tarde». Cortar es pausar, con la exportación de cuestionario disponible.
4. El agente ordena y anuncia los bloques. No hay pregunta de elección de bloque. El orden se cambia con la respuesta libre de la configuración o en cualquier momento.

## Ramas pendientes

Ninguna.

## Handoff

### Tema y alcance

Retirar el tope duro de 20 preguntas de decisión por sesión del skill `grill` y convertir la entrevista en un recorrido por bloques, en los cuatro harnesses (`claude/`, `codex/`, `opencode/`, `pi/`) y en la extensión Pi `grill-tools` y la tool `ask_user_question`, que hoy lo aplican en runtime.

### Decisiones (ver «Decisiones resueltas»)

1. Tope eliminado por completo, en doctrina y en código Pi.
2. Entrevista siempre por bloques; bloque = sección coherente del árbol; rondas o pregunta a pregunta dentro del bloque; Grillado rápido de Pi bloque a bloque.
3. Una sesión recorre todos los bloques, con una pregunta de «seguir / cortar y seguir más tarde» en cada frontera de bloque; cortar es pausar.
4. El agente ordena y anuncia los bloques; sin pregunta de elección de bloque.

### Supuestos explícitos (derivados, corregibles)

- La pregunta de frontera de bloque no es una pregunta de decisión. No aparece después del último bloque, que va directo al cierre, ni en el atajo liviano de 1 a 3 preguntas, que sigue sin bloques. En Pi va por `ask_user_question` con `phase: "configuration"`, que el gate ya admite sin `frontierSize`.
- El cierre ocurre cuando todos los bloques están resueltos. El contrato visible enumera las decisiones agrupadas por bloque.
- Al pausar, «Ramas pendientes» lista lo pendiente del bloque en curso y los bloques no empezados, en orden. Al retomar se muestran bloques cerrados, en curso y pendientes, y se sigue por el bloque en curso.
- «No hagas preguntas compuestas» sigue como límite, sin referencia al tope. La pregunta de clasificación de UI sigue en el reconocimiento y se describe como «no es una pregunta de decisión».
- `GRILL_SNAPSHOT_VERSION` no sube: no hay migración y los snapshots viejos se leen igual.
- La fila `grill` del README pasa a describir bloques y ausencia de tope. `mini-grill`, `docs/` y evals no cambian.
- Tests primero, con rojo previo: el `checkpoint` número 21 no lanza; el schema acepta `frontierSize` mayor a 20; `design-gate` asserta la frase nueva y compara la doctrina de bloques entre harnesses.

### Restricciones y no-objetivos

- No cambia el tope por llamada de las tools: 4 en Claude Code, opencode y Pi, 3 en Codex.
- No cambia el formato del handoff, el marker `SDD-Tracking` ni `mini-grill`.
- La doctrina queda idéntica entre harnesses; solo varía la capa de interacción. Se implementa con el skill `harness-port`.

### Riesgos y preguntas diferidas

- Un árbol grande corre entero salvo que el usuario corte: lo mitiga el corte por bloque.
- Una sección enorme da un bloque enorme. Se difiere si conviene una guía para partir secciones por subtema; hoy queda a criterio del agente.
- Doctrina repetida en cuatro archivos: el gate de equivalencia entre harnesses es la defensa contra drift.

### Bloques pendientes para futuras sesiones

Ninguno.

### Contexto recomendado para la spec

Archivos a tocar: los cuatro `grill/SKILL.md`; `pi-extensions/grill-tools/index.ts`, `inventory.ts`, `runtime-import.ts` y sus tests; `pi-extensions/ask-user-question/index.ts`; `pi-extensions/design-gate/design-gate.test.ts`; `README.md`; la fila `gate de doctrina de diseño` de `.sdd/project.md` si cambia el conteo de tests. Verificación: `node --test pi-extensions/*/*.test.ts`, `bash scripts/lint-frontmatter.sh`, `bash scripts/drift-report.sh` y `claude plugin validate .`.
