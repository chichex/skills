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
| tool-preguntas | `AskUserQuestion` | `request_user_input` | — | `ask_user_question` |
| extras | — | `agents/openai.yaml` | — | `compatibility` |
<!-- interaction-differences:end -->

## Qué normaliza el gate

Sobre los templates de artefactos (bloques de código con marker
`SDD-Tracking` y el template de `## Resultado de ejecucion`), la única
transformación permitida antes de exigir igualdad byte a byte entre
harnesses es la fila `invocacion`: cada referencia a un skill del repo con
el prefijo del harness (`/sdd-spec`, `$sdd-spec`, `/skill:sdd-spec`) se
reduce a un token común. Todo otro byte divergente en un template es drift
y hace fallar CI.

Las filas `tool-preguntas` y `extras` documentan por qué el gate NO compara
los cuerpos completos de los SKILL.md: la conducción de la entrevista, los
gates interactivos y los sidecars difieren legítimamente por harness. Esas
diferencias viven fuera de los templates de artefactos; dentro de un
template no hay tools ni sidecars.
