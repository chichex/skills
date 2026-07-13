# skills

> 🇬🇧 [Read this in English](./README.en.md)

Los skills que uso a diario en **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** y **[opencode](https://opencode.ai)**.

Son piezas de conocimiento reutilizable que un agente carga bajo demanda: cada carpeta es un skill con su `SKILL.md` (frontmatter `name` + `description` que decide cuándo aplica) y, opcionalmente, archivos de referencia que el skill lee cuando los necesita.

El repo está partido por herramienta porque las versiones no son idénticas: las de opencode van en ASCII puro (sin diacríticos) y hay diferencias menores de contenido entre ambas. Elegí la carpeta según dónde los quieras usar.

```
skills/
├── claude/      # versiones para Claude Code  (~/.claude/skills)
└── opencode/    # versiones para opencode      (~/.config/opencode/skills)
```

## Los skills

Dos familias más un par de sueltos.

### SDD — Spec-Driven Development

Pipeline de desarrollo con contrato explícito: **contrato → spec → ejecución**. La idea es que "terminado" lo defina algo verificable, no la sensación.

| Skill | Qué hace |
|---|---|
| **`sdd-init`** | Explora el repo a fondo y genera `.sdd/project.md`, el *contrato de autonomía*: cómo se corre / testea / buildea, qué ambientes hay, cuál usar para probar y qué se puede verificar sin un humano. Cada comando se **ejecuta** antes de documentarse; lo no verificado queda marcado. |
| **`sdd-spec`** | Convierte un pedido (texto libre o issue) en una **spec verificable**. Pone todas las inferencias sobre la mesa para desambiguar, las cruza contra el contrato y emite un veredicto de verificabilidad (TDD determinista / e2e flaky / exige prueba humana) con plan concreto por criterio. |
| **`sdd-run`** | Ejecuta una spec de punta a punta: worktree limpio, planifica contra el código real, implementa **con tests primero**, verifica cada criterio con su mecanismo declarado y termina en un **PR** con la spec como body + evidencia. |

### Domain modeling

| Skill | Qué hace |
|---|---|
| **`domain-modeling`** | Mantiene vivo el modelo de dominio mientras se diseña: desafía términos, afila el lenguaje difuso, y escribe el glosario (`CONTEXT.md`) y las decisiones (`docs/adr/`) en el momento en que cristalizan. Regla de contaminación cero: nunca introduce la práctica en un repo que no la usa. |

### Sueltos

| Skill | Qué hace |
|---|---|
| **`grill`** | Entrevista implacable sobre un plan o diseño **antes** de construir. Recorre cada rama del árbol de decisiones, una pregunta a la vez, con respuesta recomendada, hasta llegar a un entendimiento compartido. |
| **`grill-with-domain-modeling`** | Un `grill` que además mantiene los docs del dominio (`CONTEXT.md` + ADRs) a medida que las decisiones se resuelven. |
| **`tdd`** | Referencia de test-driven development: el loop rojo → verde, qué es un buen test, dónde van (seams), los anti-patrones. Incluye guías de `mocking` y `tests`. |

## Instalación

Los skills viven en un directorio por herramienta. Podés copiar el set que quieras o linkearlo.

**Claude Code** — a `~/.claude/skills/` (o `.claude/skills/` dentro de un proyecto):

```bash
cp -R claude/* ~/.claude/skills/
```

**opencode** — a `~/.config/opencode/skills/`:

```bash
cp -R opencode/* ~/.config/opencode/skills/
```

Se invocan pelados (`/grill`, `/sdd-init`, …) o el agente los carga solo cuando el contexto lo amerita, según su `description`.

## Mantener sincronizado

Los skills viven de verdad en `~/.claude/skills` y `~/.config/opencode/skills`. Cuando los editás ahí, corré `sync.sh` para traer los cambios de vuelta al repo:

```bash
./sync.sh            # copia desde ambas herramientas y muestra el diff
./sync.sh --commit   # además commitea los cambios (después: git push)
```

## Créditos

El skill `grill` (y su variante) sale principalmente de **[Matt Pocock](https://github.com/mattpocock)**.

## Licencia

[MIT](./LICENSE) — usalos, adaptalos, lo que quieras.
