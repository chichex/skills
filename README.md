# skills

> 🇬🇧 [Read this in English](./README.en.md)

Este repo gira alrededor de un workflow propio de **Spec-Driven Development (SDD)** — más los skills fundacionales sobre los que se apoya. Todo lo que uso a diario en **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, **[opencode](https://opencode.ai)** y **[Pi](https://github.com/badlogic/pi-mono)**.

Los skills son piezas de conocimiento reutilizable que un agente carga bajo demanda: cada carpeta es un skill con su `SKILL.md` (frontmatter `name` + `description` que decide cuándo aplica) y, opcionalmente, archivos de referencia que el skill lee cuando los necesita.

## El workflow SDD

El corazón del repo, y su parte propia. Un pipeline de desarrollo con contrato explícito — **contrato → spec → ejecución** — pensado para que "terminado" lo defina algo verificable, no la sensación. Cada etapa es un skill que se encadena con el siguiente:

| Skill | Etapa | Qué hace |
|---|---|---|
| **`sdd-init`** | contrato | Explora el repo a fondo y genera `.sdd/project.md`, el *contrato de autonomía*: cómo se corre / testea / buildea, qué ambientes hay, cuál usar para probar y qué se puede verificar sin un humano. Cada comando se **ejecuta** antes de documentarse; lo no verificado queda marcado. También captura las *políticas de generación* que el usuario active (tamaño máximo de PR, coverage mínimo, dependencias nuevas, convención de commits), que `sdd-run` aplica como gates duros. |
| **`sdd-spec`** | spec | Convierte un pedido (texto libre o issue) en una **spec verificable**. Pone todas las inferencias sobre la mesa para desambiguar, las cruza contra el contrato y emite un veredicto de verificabilidad (TDD determinista / e2e flaky / exige prueba humana) con plan concreto por criterio. |
| **`sdd-run`** | ejecución | Ejecuta una spec de punta a punta: worktree limpio, planifica contra el código real, implementa **con tests primero**, verifica cada criterio con su mecanismo declarado y termina en un **PR** con la spec como body + evidencia. |

Invocados pelados (sin args) abren una **Fase 0 — Lanzador** que expone las opciones; pasarles args/flags saltea el menú.

## Skills fundacionales

Las disciplinas sobre las que SDD se apoya — y que también uso sueltas, fuera del pipeline. Algunas están **basadas en** los skills de [Matt Pocock](https://github.com/mattpocock) (ver [Créditos](#créditos)); otras son propias.

| Skill | Qué hace |
|---|---|
| **`grill`** | Entrevista implacable sobre un plan o diseño **antes** de construir. Permite recorrer el árbol de decisiones de forma rápida o pregunta a pregunta hasta llegar a un entendimiento compartido. En Pi también puede mantener la documentación de dominio. |
| **`mini-grill`** | Versión express de `grill`: desambigua un pedido puntual en una a tres preguntas (con opción recomendada primero) y confirma la interpretación antes de actuar. Si aparecen muchas decisiones, deriva al `grill` completo. |
| **`grill-with-domain-modeling`** *(Claude/opencode)* | Un `grill` que además mantiene los docs del dominio (`CONTEXT.md` + ADRs) a medida que las decisiones se resuelven. En Pi esta modalidad vive dentro de `grill`. |
| **`domain-modeling`** | Mantiene vivo el modelo de dominio mientras se diseña: desafía términos, afila el lenguaje difuso, y escribe el glosario (`CONTEXT.md`) y las decisiones (`docs/adr/`) cuando cristalizan. Regla de contaminación cero: nunca introduce la práctica en un repo que no la usa. |
| **`tdd`** | Referencia de test-driven development: el loop rojo → verde, qué es un buen test, dónde van (seams), los anti-patrones. Incluye guías de `mocking` y `tests`. |
| **`code-review`** *(solo Pi)* | Revisa un PR en tres ejes separados —correctness y riesgo, estándares y spec—, ejecuta verificaciones, muestra findings con evidencia y al final pregunta si querés publicar los comments en GitHub. Nunca postea sin confirmación explícita. |
| **`github-issue-selector`** *(solo Pi)* | Abre un selector interactivo cuando querés elegir o inspeccionar un issue y todavía no diste un número concreto. |
| **`issue-triage`** *(solo Pi)* | Analiza uno o varios issues contra código, tests y dependencias; recomienda grill, spec, quick-run protegido o rechazo accionable. Para selecciones conjuntas crea un issue canónico y cierra los originales como reemplazados. |
| **`repo-clean`** *(solo Pi)* | Deja el branch actual sin cambios pendientes y sincronizado con `origin/<branch>`. Si hay trabajo sin commit, muestra el impacto y pregunta si conservarlo o descartarlo; nunca cambia de branch ni hace force-push. |
| **`find-skills`** *(solo Pi)* | Busca skills instalables en el ecosistema abierto mediante `npx skills`. Vendorizado desde `vercel-labs/skills`. |
| **`yt-summary`** *(solo Claude)* | Descarga con `yt-dlp` un único track de subtítulos de YouTube y guía un resumen con TL;DR, puntos clave y timestamps. |

SDD no reemplaza a estos skills: los orquesta. El diseño previo a una spec se afila con `grill` y `domain-modeling`, y `sdd-run` implementa siguiendo la disciplina de `tdd`.

### Integración con Pi

En Pi, `grill` es el único entry point de entrevista: el usuario elige si quiere solo handoff o también documentación de dominio. `sdd-spec --from-grill` consume el handoff confirmado sin volver a preguntar decisiones ya cerradas.

El repo también conserva todas las extensiones globales de Pi usadas por este workflow:

| Extensión | Qué agrega |
|---|---|
| **`ask-user-question`** | Herramienta `ask_user_question` con selección simple/múltiple, recomendaciones, respuesta libre y envío vacío opcional. |
| **`claude-tool-renderer.ts`** | Presenta las ediciones con encabezado y diff compacto al estilo Claude Code. |
| **`grill-tools`** | Persistencia con `grill_session`, selector `select_grill_session` y comandos `/grills` y `/specs`. |
| **`inline-skill-autocomplete`** | Abre el autocomplete de skills al escribir `/` o `/skill:…` en cualquier punto del borrador. Al enviar, antepone la invocación para que Pi la expanda correctamente. |
| **`github-issue-selector.ts`** + **`github-issues.ts`** | Herramienta `select_github_issue` y comando `/issues` con selección múltiple. El menú unificado permite analizar mediante `issue-triage`, cerrar en bulk o eliminar en bulk. |
| **`github-prs`** | Comando `/prs`; su acción de review invoca `/skill:code-review`. |
| **`visual-footer.ts`** | Footer visual con estado, modelo, tokens y directorio actual; se alterna con `/visual-footer`. |
| **`warp-status.ts`** | Emite el estado de Pi para la integración de terminal de Warp. |


También incluye el theme global **`claude-code`**, con la paleta usada por estas interfaces.

## Estructura del repo

Está partido por herramienta porque las versiones no son idénticas y cada harness expone tools y comandos distintos. Elegí la carpeta según dónde los quieras usar.

```
skills/
├── claude/      # versiones para Claude Code  (~/.claude/skills)
├── opencode/       # versiones para opencode      (~/.config/opencode/skills)
├── pi/             # skills para Pi               (~/.agents/skills)
├── pi-extensions/  # extensiones de Pi             (~/.pi/agent/extensions)
└── pi-themes/      # themes de Pi                  (~/.pi/agent/themes)
```

## Instalación

Cloná el repo y corré `install.sh`. Hace `git pull` y copia cada skill —y las extensiones de Pi, tanto archivos `.ts` como carpetas con `index.ts`— a la carpeta de su herramienta **sin pisar lo demás que ya tengas** (solo agrega/actualiza lo que viene de este repo):

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

Destinos por defecto: `~/.claude/skills/`, `~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.pi/agent/extensions/` y `~/.pi/agent/themes/` (overridables con `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR` y `PI_THEMES_DIR`).

Para **actualizar** más adelante, volvé a correr `./install.sh` — ya hace el `pull` solo.

Si preferís a mano, es un simple copy:

```bash
cp -R claude/*   ~/.claude/skills/
cp -R opencode/* ~/.config/opencode/skills/
cp -R pi/*             ~/.agents/skills/
cp -R pi-extensions/*  ~/.pi/agent/extensions/
cp pi-themes/*.json    ~/.pi/agent/themes/
```

Una vez instalados, Claude Code/opencode los invocan con sus comandos habituales. En Pi se usan como `/skill:grill`, `/skill:code-review`, `/skill:github-issue-selector`, `/skill:issue-triage`, `/skill:repo-clean`, `/skill:sdd-init`, `/skill:sdd-spec` y `/skill:sdd-run`, o el agente los carga según su `description`. Ejecutá `/reload` en una sesión de Pi abierta después de instalarlos.

## Créditos

Cuatro de los **skills fundacionales** están **basados en** los skills de **[Matt Pocock](https://github.com/mattpocock)** — de su repo [mattpocock/skills](https://github.com/mattpocock/skills) (MIT); `mini-grill` es una variante propia reducida de `grill`:

| En este repo | Original de Matt Pocock |
|---|---|
| `grill` | `grilling` |
| `grill-with-domain-modeling` | `grill-with-docs` |
| `domain-modeling` | `domain-modeling` |
| `tdd` | `tdd` |

La familia **SDD** (`sdd-init`, `sdd-spec`, `sdd-run`) es propia: está inspirada en el mismo enfoque de trabajo (tracer bullets, tests-first, spec → implementación) de sus skills `to-spec` / `to-tickets` / `implement` / `wayfinder`, pero con artefactos distintos — el contrato de autonomía `.sdd/project.md` y el veredicto de verificabilidad.

`find-skills` se conserva tal como fue instalado desde [`vercel-labs/skills`](https://skills.sh/vercel-labs/skills/find-skills); no es un skill propio.

## Licencia

[MIT](./LICENSE) para el material propio y las adaptaciones; `find-skills` conserva las condiciones de su fuente upstream.
