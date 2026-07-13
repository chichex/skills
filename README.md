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

Cloná el repo y corré `install.sh`. Hace `git pull` y copia cada skill a la carpeta de su herramienta **sin pisar los otros skills que ya tengas** (solo agrega/actualiza los de este repo):

```bash
git clone https://github.com/chichex/skills.git
cd skills
./install.sh            # instala ambos sets (claude + opencode)
./install.sh claude     # solo los de Claude Code
./install.sh opencode   # solo los de opencode
```

Destinos por defecto: `~/.claude/skills/` y `~/.config/opencode/skills/` (overridables con `CLAUDE_SKILLS_DIR` / `OPENCODE_SKILLS_DIR`).

Para **actualizar** más adelante, volvé a correr `./install.sh` — ya hace el `pull` solo.

Si preferís a mano, es un simple copy:

```bash
cp -R claude/*   ~/.claude/skills/
cp -R opencode/* ~/.config/opencode/skills/
```

Una vez instalados, se invocan pelados (`/grill`, `/sdd-init`, …) o el agente los carga solo cuando el contexto lo amerita, según su `description`.

## Créditos

Cuatro de estos skills están **basados en** los skills de **[Matt Pocock](https://github.com/mattpocock)** — de su repo [mattpocock/skills](https://github.com/mattpocock/skills) (MIT):

| En este repo | Original de Matt Pocock |
|---|---|
| `grill` | `grilling` |
| `grill-with-domain-modeling` | `grill-with-docs` |
| `domain-modeling` | `domain-modeling` |
| `tdd` | `tdd` |

La familia **SDD** (`sdd-init`, `sdd-spec`, `sdd-run`) es propia: está inspirada en el mismo enfoque de trabajo (tracer bullets, tests-first, spec → implementación) de sus skills `to-spec` / `to-tickets` / `implement` / `wayfinder`, pero con artefactos distintos — el contrato de autonomía `.sdd/project.md` y el veredicto de verificabilidad.

## Licencia

[MIT](./LICENSE) — usalos, adaptalos, lo que quieras.
