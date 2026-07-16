# skills

> 🇬🇧 [Read this in English](./README.en.md)

Este repo gira alrededor de un workflow propio de **Spec-Driven Development (SDD)** — más los skills fundacionales sobre los que se apoya. Todo lo que uso a diario en **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, **[opencode](https://opencode.ai)** y **[Pi](https://github.com/badlogic/pi-mono)**.

Los skills son piezas de conocimiento reutilizable que un agente carga bajo demanda: cada carpeta es un skill con su `SKILL.md` (frontmatter `name` + `description` que decide cuándo aplica) y, opcionalmente, archivos de referencia que el skill lee cuando los necesita.

## El workflow SDD

El corazón del repo, y su parte propia. Un pipeline de desarrollo con contrato explícito — **contrato → spec → ejecución** — pensado para que "terminado" lo defina algo verificable, no la sensación. Cada etapa es un skill que se encadena con el siguiente:

| Skill | Etapa | Qué hace |
|---|---|---|
| **`sdd-init`** | contrato | Explora el repo a fondo y genera `.sdd/project.md`, el *contrato de autonomía*: cómo se corre / testea / buildea, qué ambientes hay, cuál usar para probar y qué se puede verificar sin un humano. Cada comando se **ejecuta** antes de documentarse; lo no verificado queda marcado. |
| **`sdd-spec`** | spec | Convierte un pedido (texto libre o issue) en una **spec verificable**. Pone todas las inferencias sobre la mesa para desambiguar, las cruza contra el contrato y emite un veredicto de verificabilidad (TDD determinista / e2e flaky / exige prueba humana) con plan concreto por criterio. |
| **`sdd-run`** | ejecución | Ejecuta una spec de punta a punta: worktree limpio, planifica contra el código real, implementa **con tests primero**, verifica cada criterio con su mecanismo declarado y termina en un **PR** con la spec como body + evidencia. |

Invocados pelados (sin args) abren una **Fase 0 — Lanzador** que expone las opciones; pasarles args/flags saltea el menú.

## Skills fundacionales

Las disciplinas sobre las que SDD se apoya — y que también uso sueltas, fuera del pipeline. Están **basadas en** los skills de [Matt Pocock](https://github.com/mattpocock) (ver [Créditos](#créditos)).

| Skill | Qué hace |
|---|---|
| **`grill`** | Entrevista implacable sobre un plan o diseño **antes** de construir. Recorre cada rama del árbol de decisiones, una pregunta a la vez, con respuesta recomendada, hasta llegar a un entendimiento compartido. |
| **`mini-grill`** | Versión express de `grill`: desambigua un pedido puntual en una a tres preguntas (con opción recomendada primero) y confirma la interpretación antes de actuar. Si aparecen muchas decisiones, deriva al `grill` completo. |
| **`grill-with-domain-modeling`** | Un `grill` que además mantiene los docs del dominio (`CONTEXT.md` + ADRs) a medida que las decisiones se resuelven. |
| **`domain-modeling`** | Mantiene vivo el modelo de dominio mientras se diseña: desafía términos, afila el lenguaje difuso, y escribe el glosario (`CONTEXT.md`) y las decisiones (`docs/adr/`) cuando cristalizan. Regla de contaminación cero: nunca introduce la práctica en un repo que no la usa. |
| **`tdd`** | Referencia de test-driven development: el loop rojo → verde, qué es un buen test, dónde van (seams), los anti-patrones. Incluye guías de `mocking` y `tests`. |

SDD no reemplaza a estos skills: los orquesta. El diseño previo a una spec se afila con `grill` y `domain-modeling`, y `sdd-run` implementa siguiendo la disciplina de `tdd`.

En Pi, `sdd-spec` acepta `--from-grill`: consume el handoff confirmado sin volver a preguntar decisiones ya cerradas. La versión Pi de `grill` puede encadenarlo al confirmar, y la extensión `grill-tools` agrega persistencia y la opción de generar una spec desde una sesión finalizada.

## Estructura del repo

Está partido por herramienta porque las versiones no son idénticas: las de opencode y Pi van en ASCII puro (sin diacríticos) y hay diferencias de tools/comandos entre harnesses. Elegí la carpeta según dónde los quieras usar.

```
skills/
├── claude/      # versiones para Claude Code  (~/.claude/skills)
├── opencode/       # versiones para opencode      (~/.config/opencode/skills)
├── pi/             # skills para Pi               (~/.agents/skills)
└── pi-extensions/  # extensiones requeridas de Pi  (~/.pi/agent/extensions)
```

## Instalación

Cloná el repo y corré `install.sh`. Hace `git pull` y copia cada skill —y las extensiones de Pi— a la carpeta de su herramienta **sin pisar lo demás que ya tengas** (solo agrega/actualiza lo que viene de este repo):

```bash
git clone https://github.com/chichex/skills.git
cd skills
./install.sh            # instala los tres sets
./install.sh all        # igual que el anterior
./install.sh both       # Claude Code + opencode
./install.sh claude     # solo los de Claude Code
./install.sh opencode   # solo los de opencode
./install.sh pi         # solo los de Pi
```

Destinos por defecto: `~/.claude/skills/`, `~/.config/opencode/skills/`, `~/.agents/skills/` y `~/.pi/agent/extensions/` (overridables con `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR` y `PI_EXTENSIONS_DIR`).

Para **actualizar** más adelante, volvé a correr `./install.sh` — ya hace el `pull` solo.

Si preferís a mano, es un simple copy:

```bash
cp -R claude/*   ~/.claude/skills/
cp -R opencode/* ~/.config/opencode/skills/
cp -R pi/*             ~/.agents/skills/
cp -R pi-extensions/*  ~/.pi/agent/extensions/
```

Una vez instalados, Claude Code/opencode los invocan con sus comandos habituales. En Pi se usan como `/skill:grill`, `/skill:sdd-init`, `/skill:sdd-spec` y `/skill:sdd-run`, o el agente los carga según su `description`. Ejecutá `/reload` en una sesión de Pi abierta después de instalarlos.

## Créditos

Cuatro de los **skills fundacionales** están **basados en** los skills de **[Matt Pocock](https://github.com/mattpocock)** — de su repo [mattpocock/skills](https://github.com/mattpocock/skills) (MIT); `mini-grill` es una variante propia reducida de `grill`:

| En este repo | Original de Matt Pocock |
|---|---|
| `grill` | `grilling` |
| `grill-with-domain-modeling` | `grill-with-docs` |
| `domain-modeling` | `domain-modeling` |
| `tdd` | `tdd` |

La familia **SDD** (`sdd-init`, `sdd-spec`, `sdd-run`) es propia: está inspirada en el mismo enfoque de trabajo (tracer bullets, tests-first, spec → implementación) de sus skills `to-spec` / `to-tickets` / `implement` / `wayfinder`, pero con artefactos distintos — el contrato de autonomía `.sdd/project.md` y el veredicto de verificabilidad.

## Licencia

[MIT](./LICENSE) — usalos, adaptalos, lo que quieras.
