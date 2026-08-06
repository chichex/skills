---
name: harness-port
description: Portea y mantiene skills de este repo entre sus cuatro harnesses — Claude Code (claude/), Codex (codex/), opencode (opencode/) y Pi (pi/) — manteniendo la doctrina idéntica y cambiando solo la capa de interacción. Usar cuando el usuario quiera portear un skill a otro harness, crear la versión codex/opencode/pi/claude de un skill existente, propagar un cambio de un skill a sus otras versiones, o revisar consistencia entre harnesses.
---

Este repo mantiene una versión por harness de cada skill: una carpeta por skill dentro de `claude/`, `codex/`, `opencode/` y `pi/`, cada una con su `SKILL.md` y, opcionalmente, archivos de referencia. Las versiones comparten la doctrina y difieren SOLO en la capa de interacción. Este skill define qué se traduce, qué se copia intacto y cómo se verifica el resultado.

## Regla central

**La doctrina se portea idéntica; solo cambia la capa de interacción.** Doctrina es todo lo que define el comportamiento del skill: fases, principios, formatos de reporte, tablas, severidades, gates y sus opciones, secciones MUST DO / MUST NOT DO. Capa de interacción es únicamente: la tool de preguntas, la sintaxis de invocación (incluidas las referencias cruzadas a otros skills), los extras propios del harness y las menciones del harness en description y prosa.

Si al portear aparece una mejora de doctrina, no se aplica solo en la versión nueva: se propaga a TODAS las versiones existentes del skill, cada una con su capa de interacción.

## Ejemplo canónico

El par `codex/code-review/SKILL.md` ↔ `pi/code-review/SKILL.md` es el modelo a imitar. Ante la duda, diffearlos. Sus únicas diferencias son:

1. Pi agrega `compatibility` al frontmatter (declara `gh`, repo git y la tool de preguntas).
2. `$code-review` → `/skill:code-review` en el bloque `## Argumentos`.
3. `request_user_input` → `ask_user_question` en cada mención (gates, `## MUST DO`).
4. Codex tiene un párrafo propio de fallback ("usar `request_user_input` solo cuando esté disponible; si no, mostrar el mismo gate en texto plano…") que la versión Pi omite: en Pi el requisito de la tool vive en `compatibility`.
5. Codex lleva el sidecar `agents/openai.yaml`; Pi no.

Todo el resto del cuerpo es byte a byte idéntico.

## Mapeo por harness

| | Claude Code | Codex | opencode | Pi |
|---|---|---|---|---|
| Carpeta | `claude/` | `codex/` | `opencode/` | `pi/` |
| Invocación | `/nombre` | `$nombre` | `/nombre` | `/skill:nombre` |
| Tool de preguntas | `AskUserQuestion` | `request_user_input`, con fallback a texto plano | ninguna: gate en texto plano terminando el turno | `ask_user_question` |
| Extras | — | sidecar `agents/openai.yaml` | — | campo `compatibility` en el frontmatter cuando hay requisitos |
| Destino de instalación | `~/.claude/skills` | `${CODEX_HOME:-~/.codex}/skills` | `~/.config/opencode/skills` | `~/.agents/skills` |

### Tool de preguntas: detalle por harness

- **Claude Code — `AskUserQuestion`**: hasta 4 preguntas por llamada, 2 a 4 opciones cada una, la recomendada primera y marcada `(Recomendado)`, `multiSelect` opcional para selección múltiple, opción "Other" automática para respuesta libre. Regla del texto visible: lo que el usuario tiene que leer para decidir (tablas, resúmenes, previews) se imprime como texto en el MISMO mensaje que hace el tool call — el diálogo tapa la pantalla y no arrastra contexto.
- **Codex — `request_user_input`**: usarla solo cuando esté disponible. Si no está, formular el mismo gate en texto plano, terminar el turno y esperar la respuesta. Un gate que protege un side effect externo (publicar, pushear) nunca se resuelve en el mismo turno en que se mostró la preview por primera vez.
- **opencode — sin tool**: el gate se formula en texto plano, con opciones numeradas y la recomendada primera marcada `(Recomendado)`, y se termina el turno esperando la respuesta. No hay selección múltiple nativa: de a una pregunta por turno. Si la fuente usa un rótulo genérico tipo `question` para el gate, en opencode eso se rinde como gate de texto plano — no existe una tool con ese nombre.
- **Pi — `ask_user_question`**: la provee la extensión `ask-user-question` de este repo; soporta selección simple/múltiple, recomendaciones y respuesta libre. Si el skill depende de ella (o de cualquier otra tool o CLI), declararlo en `compatibility`.

### Invocación y referencias cruzadas

Toda invocación de skill dentro del texto se traduce a la sintaxis del harness destino, **incluso dentro de backticks**: `$sdd-init --assume` (codex) ⇄ `/skill:sdd-init --assume` (pi) ⇄ `/sdd-init --assume` (claude y opencode). Aplica al bloque `## Argumentos`, a la Fase 0 — Lanzador, a la description del frontmatter y a cada referencia cruzada a otro skill del repo. Es la ÚNICA traducción permitida dentro de backticks.

## Extras por harness

### Codex — sidecar `agents/openai.yaml`

Cada skill de `codex/` lleva `agents/openai.yaml` con el bloque `interface`:

```yaml
interface:
  display_name: "Code Review"
  short_description: "Revisá PRs con evidencia y gates seguros"
  default_prompt: "Usá $code-review para revisar este PR sin publicar comentarios todavía."
```

- `display_name`: nombre corto de presentación.
- `short_description`: una línea en voseo, sin punto final.
- `default_prompt`: una oración que usa la invocación `$nombre`.

La invocación implícita en Codex la habilita la `description` del frontmatter: Codex también carga el skill según ella aunque el usuario no lo invoque explícitamente, así que la description debe conservar sus triggers completos.

### Pi — `compatibility`

Campo del frontmatter, presente SOLO cuando el skill tiene requisitos: CLIs (`gh`, `yt-dlp`), tools específicas (`ask_user_question`, `select_github_issue`), otros skills instalados o permisos. Ejemplo real:

```yaml
compatibility: Requiere un repositorio git, GitHub CLI (gh) autenticado y acceso de lectura al PR. Publicar comments requiere permiso de escritura en el repositorio.
```

Un skill sin requisitos no lleva el campo.

### Claude Code y opencode

Nada extra: solo `SKILL.md` más los archivos de referencia del skill. Un `agents/` copiado a `claude/`, `opencode/` o `pi/` es un error de porteo.

## Reglas de porteo

1. **Doctrina idéntica.** El diff entre la versión nueva y la fuente tiene que mostrar SOLO capa de interacción. Nada de "aprovechar" el porteo para reescribir prosa, reordenar fases o cambiar formatos.
2. **Ortografía completa siempre.** Todo texto que se escribe o portea va en español rioplatense con ortografía completa (tildes, ñ). Los términos técnicos e identificadores quedan como están.
3. **Backticks intocables.** Dentro de backticks, bloques de código, nombres de archivo, flags y headers citados de artefactos generados (ej. `## Politicas de generacion`, `## Verificacion autonoma`, `[NEEDS-INPUT]`, `.sdd/project.md`) no se cambia NADA, ni tildes: son strings que deben matchear artefactos ya generados en repos de usuarios. Única excepción: las invocaciones de skills (regla de sintaxis de arriba).
4. **Menciones del harness se adaptan.** La description y la prosa nombran al harness destino ("que le dice a Claude Code…" → "que le dice a OpenCode…"), incluidas frases de trigger tipo "quiero que opencode pueda trabajar solo aca".
5. **Los párrafos específicos de un harness no viajan.** El fallback de Codex, las notas de `multiSelect` de Claude Code o las referencias a extensiones de Pi se reemplazan por el equivalente del destino o se omiten; no se copian a un harness donde no aplican.
6. **La description conserva los triggers.** Solo se traducen invocaciones y menciones de harness; las frases de disparo ("Usar SIEMPRE que…", citas del usuario) quedan.

## Procedimiento

1. **Elegir la fuente**: la versión más completa y actualizada del skill, o la que originó el cambio a propagar. Si no es obvio cuál está más al día, diffear las versiones existentes primero.
2. **Crear la carpeta destino** `<harness>/<nombre>/` y copiar `SKILL.md` junto con TODOS los archivos de referencia del skill (ej. `mocking.md` y `tests.md` en `tdd`; `CONTEXT-FORMAT.md` y `ADR-FORMAT.md` en `domain-modeling`).
3. **Aplicar la capa de interacción del destino** según el mapeo: tool de preguntas, invocaciones, extras, menciones del harness.
4. **Si es propagación de un cambio**, aplicar el mismo delta doctrinal a cada versión existente, adaptando solo la capa de interacción de cada una.
5. **Actualizar el README** cuando cambia la disponibilidad por harness: las tablas de `README.md` y `README.en.md` anotan en qué harnesses vive cada skill (ej. *(Codex/Pi)*).
6. `install.sh` no requiere cambios: copia por glob las carpetas de cada harness, y la deduplicación Codex/Pi del `config.toml` se deriva de los nombres de carpeta.

Si el pedido no fija skill de origen o harnesses destino, preguntarlo con `AskUserQuestion` antes de tocar archivos (una sola llamada: qué skill y hacia qué harnesses).

## Checklist final de porteo

- [ ] `name` del frontmatter == nombre de la carpeta.
- [ ] description adaptada al destino: invocaciones, menciones del harness; triggers intactos.
- [ ] Referencias de tools correctas para el harness destino: la tool de preguntas es la del destino y no quedó ninguna mención colgada de la tool de otro harness.
- [ ] Todas las invocaciones de skills (`## Argumentos`, Fase 0, referencias cruzadas, description) usan la sintaxis del destino.
- [ ] Extras del destino presentes: `agents/openai.yaml` en codex, `compatibility` en pi si hay requisitos; sin extras ajenos al destino.
- [ ] Archivos de referencia copiados y sus links relativos funcionando.
- [ ] Diff contra la fuente muestra SOLO capa de interacción; la doctrina quedó idéntica.
- [ ] Strings de artefactos generados intactos (headers citados, flags, formatos, paths), sin "correcciones" de tildes dentro de backticks ni bloques de código.
- [ ] `README.md` y `README.en.md` reflejan la disponibilidad actual del skill por harness.
- [ ] Ortografía completa en todo el texto porteado.
