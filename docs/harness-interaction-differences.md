# Diferencias de interacción entre harnesses

Este documento es la definición normativa de las ÚNICAS diferencias toleradas
entre las copias de un mismo skill en los cuatro harnesses. La doctrina —
fases, principios, formatos de artefactos, templates de marker, gates,
MUST DO / MUST NOT DO — se portea idéntica; solo la capa de interacción
listada acá puede divergir. La regla completa de porteo vive en
`.claude/skills/harness-port/SKILL.md`; esta tabla es el subconjunto
machine-readable que consume el gate anti-drift
(`pi-extensions/harness-gate/harness-gate.test.ts`).

El gate lee el bloque delimitado directamente. Las filas son estables: no
renombrar `Campo` ni las columnas sin actualizar el gate.

<!-- interaction-differences:start -->
| Campo | claude | codex | opencode | pi |
|---|---|---|---|---|
| carpeta | `claude/` | `codex/` | `opencode/` | `pi/` |
| invocacion | `/nombre` | `$nombre` | `/nombre` | `/skill:nombre` |
| tool-preguntas | `AskUserQuestion` | `request_user_input` | `question` | `ask_user_question` |
| extras | — | `agents/openai.yaml` | — | `compatibility` |
<!-- interaction-differences:end -->

En Pi, la misma extensión agrega además `ask_user_questions` como variante batch para rondas de 2 a 4 decisiones independientes. La fila machine-readable conserva `ask_user_question` como token canónico porque los gates que normalizan doctrina de a una decisión lo reemplazan literalmente.

En opencode, `question` es una tool built-in registrada solo para los clientes `app`, `cli` y `desktop` (o con `OPENCODE_ENABLE_QUESTION_TOOL`); en cualquier otro cliente no existe y el gate se formula en texto plano. Acepta un array `questions` (cada una con `header`, `question`, `options` y `multiple` opcional) sin tope declarado de preguntas ni de opciones, agrega sola la respuesta libre y pide la recomendada primera con `(Recommended)`. En Codex, `request_user_input` acepta de 1 a 3 preguntas por llamada, de 2 a 3 opciones cada una, sin selección múltiple, y solo está disponible en algunos modos de colaboración.

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
