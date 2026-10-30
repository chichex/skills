# Diferencias de interacción entre harnesses

Este documento es la definición normativa de las ÚNICAS diferencias toleradas
entre las copias de un mismo skill en los cinco harnesses. La doctrina —
fases, principios, formatos de artefactos, templates de marker, gates,
MUST DO / MUST NOT DO — se portea idéntica; solo la capa de interacción
listada acá puede divergir. La regla completa de porteo vive en
`.claude/skills/harness-port/SKILL.md`; esta tabla es el subconjunto
machine-readable que consume el gate anti-drift
(`pi-extensions/harness-gate/harness-gate.test.ts`).

El gate lee el bloque delimitado directamente. Las filas son estables: no
renombrar `Campo` ni las columnas sin actualizar el gate.

<!-- interaction-differences:start -->
| Campo | claude | codex | opencode | pi | antigravity |
|---|---|---|---|---|---|
| carpeta | `claude/` | `codex/` | `opencode/` | `pi/` | `antigravity/` |
| invocacion | `/nombre` | `$nombre` | `/nombre` | `/skill:nombre` | `/nombre` |
| tool-preguntas | `AskUserQuestion` | `request_user_input` | `question` | `ask_user_question` | `ask_question` |
| extras | — | `agents/openai.yaml` | — | `compatibility` | — |
<!-- interaction-differences:end -->

En Google Antigravity, la tool nativa de interacción es `ask_question`, que renderiza un modal interactivo con preguntas (`questions`), opciones estructuradas con la recomendada primera marcada con `(Recommended)` y soporte para selección múltiple vía `is_multi_select`. Para tareas delegadas en paralelo se usa `invoke_subagent` (`TypeName`, `Role`, `Prompt`, `Model` con opciones `inherit`, `flash_lite`, `flash` y `pro`), con subagentes built-in como `research` (solo lectura) y `self`. La ruta canónica de discovery global es `~/.gemini/config/skills/` y la de workspace `.agents/skills/`.

En Pi, la misma extensión agrega además `ask_user_questions` como variante batch para rondas de 2 a 4 decisiones independientes. La fila machine-readable conserva `ask_user_question` como token canónico porque los gates que normalizan doctrina de a una decisión lo reemplazan literalmente.

En opencode, `question` es una tool built-in registrada solo para los clientes `app`, `cli` y `desktop` (o con `OPENCODE_ENABLE_QUESTION_TOOL`); en cualquier otro cliente no existe y el gate se formula en texto plano. Acepta un array `questions` (cada una con `header`, `question`, `options` y `multiple` opcional) sin tope declarado de preguntas ni de opciones, agrega sola la respuesta libre y pide la recomendada primera con `(Recommended)`. En Codex, `request_user_input` acepta de 1 a 3 preguntas por llamada, de 2 a 3 opciones cada una, sin selección múltiple, y solo está disponible en algunos modos de colaboración.

En Codex, el sandbox por defecto (`codex sandbox -P :workspace`, verificado en Codex 0.146.0) puede escribir en el working tree pero no en `.git/`: da `mkdir: .git/sdd: Operation not permitted`. Los skills que escriben borradores en `<git-common-dir>/chiche/` (`grill`, `sdd-spec`, y `sdd-run` al borrar las copias de `<git-common-dir>/chiche/` y `<git-common-dir>/sdd/`) piden escalación en Codex; sin permiso, escriben en `.chiche/` del cwd y lo dicen en el reporte, y esos borradores los resuelve `sdd-land` en su Fase 5. Es capa de interacción: la doctrina compartida solo dice que el harness que no puede escribir ahí sigue la suya. El append del log de eventos (`<git-common-dir>/chiche/events.jsonl`) de `grill`, `sdd-spec`, `sdd-run` y `sdd-land` también pide escalación en Codex, desde el primer intento porque el comando canónico termina con exit 0 aunque el append falle y Codex no ve un comando denegado que reintentar; sin permiso, el evento se saltea con el aviso y nunca cae a `.sdd/`.

## Qué normaliza el gate

Sobre los templates de artefactos (bloques de código con marker
`SDD-Tracking` y el template de `## Resultado de ejecucion`), la única
transformación permitida antes de exigir igualdad byte a byte entre
harnesses es la fila `invocacion`: cada referencia a un skill del repo con
el prefijo del harness (`/sdd-spec`, `$sdd-spec`, `/skill:sdd-spec`) se
reduce a un token común. Todo otro byte divergente en un template es drift
y hace fallar CI.

La fila `tool-preguntas` también es machine-readable: el harness-gate
(`parseInteractionTable` en `pi-extensions/harness-gate/interaction.ts`) exige
que cada `grill` instruya usar la tool de su harness y no la niegue, y los
gates de `pi-extensions/workflow-resolution/` la leen para normalizar la tool
de preguntas. Cambiar una celda rompe CI hasta portear los skills.

Las filas `tool-preguntas` y `extras` documentan además por qué el gate NO compara
los cuerpos completos de los SKILL.md: la conducción de la entrevista, los
gates interactivos y los sidecars difieren legítimamente por harness. Esas
diferencias viven fuera de los templates de artefactos; dentro de un
template no hay tools ni sidecars.
