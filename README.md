# skills

> 🇬🇧 [Read this in English](./README.en.md)

Este repo gira alrededor de un workflow propio de **Spec-Driven Development (SDD)** — más los skills fundacionales sobre los que se apoya. Todo lo que uso a diario en **[Codex](https://developers.openai.com/codex/)**, **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, **[opencode](https://opencode.ai)** y **[Pi](https://github.com/badlogic/pi-mono)**.

Los skills son piezas de conocimiento reutilizable que un agente carga bajo demanda: cada carpeta es un skill con su `SKILL.md` (frontmatter `name` + `description` que decide cuándo aplica) y, opcionalmente, archivos de referencia que el skill lee cuando los necesita.

## El workflow SDD

El corazón del repo, y su parte propia. Un pipeline de desarrollo con contrato explícito — **contrato → spec → ejecución** — pensado para que "terminado" lo defina algo verificable, no la sensación. Cada etapa es un skill que se encadena con el siguiente:

| Skill | Etapa | Qué hace |
|---|---|---|
| **`sdd-init`** | contrato | Explora el repo a fondo y genera `.sdd/project.md`, el *contrato de autonomía*: cómo se corre / testea / buildea, qué ambientes hay, cuál usar para probar y qué se puede verificar sin un humano. Cada comando se **ejecuta** antes de documentarse; lo no verificado queda marcado. También captura las *políticas de generación* que el usuario active (tamaño máximo de PR, coverage mínimo, dependencias nuevas, convención de commits y políticas propias de la tecnología — guías de estilo, líneas máximas por archivo), que `sdd-run` aplica como gates duros o sigue como guías explícitas. |
| **`sdd-spec`** | spec | Convierte un pedido (texto libre o issue) en una **spec verificable**. Pone todas las inferencias sobre la mesa para desambiguar, las cruza contra el contrato y emite un veredicto de verificabilidad (TDD determinista / e2e flaky / exige prueba humana) con plan concreto por criterio. Con `--from-grill` (los cuatro harnesses; en Pi acepta también el ID de la sesión) parte de un handoff finalizado de `grill` en `.sdd/grills/`: las decisiones ya cerradas entran a la spec como confirmadas y no se vuelven a preguntar; el lanzador pelado ofrece `De un grill cerrado` cuando existen handoffs. |
| **`sdd-run`** | ejecución | Ejecuta una spec de punta a punta: worktree limpio, planifica contra el código real, implementa **con tests primero**, verifica cada criterio con su mecanismo declarado y termina en un **PR** con la spec como body + evidencia. |

Invocados pelados (sin args) abren una **Fase 0 — Lanzador** que expone las opciones; pasarles args/flags saltea el menú.

## Skills fundacionales

Las disciplinas sobre las que SDD se apoya — y que también uso sueltas, fuera del pipeline. Algunas están **basadas en** los skills de [Matt Pocock](https://github.com/mattpocock) (ver [Créditos](#créditos)); otras son propias.

| Skill | Qué hace |
|---|---|
| **`grill`** | Entrevista implacable sobre un plan o diseño **antes** de construir. En los cuatro harnesses arranca con un reconocimiento previo (código, docs de dominio, handoffs anteriores) que arma el árbol de decisiones con sus dependencias y persiste y reanuda sesiones en `.sdd/grills/` (Pi reanuda desde su snapshot runtime global, pero cada pausa o cierre escribe además el handoff interoperable en `.sdd/grills/` del proyecto), puede exportar las decisiones pendientes como cuestionario autocontenido para un stakeholder sin agente (por ejemplo, pegándolo en un Google Doc) y al cierre encadena con `sdd-spec --from-grill`. En Claude Code la entrevista va **por rondas** sobre la frontera de dependencias — cada llamada a `AskUserQuestion` presenta hasta 4 decisiones ya desbloqueadas — o pregunta a pregunta para árboles densos, con un atajo liviano cuando alcanza con 1-3 preguntas. En los cuatro harnesses también puede mantener la documentación de dominio. |
| **`mini-grill`** *(Codex/Claude/opencode)* | Versión express de `grill`: desambigua un pedido puntual en una a tres preguntas (con opción recomendada primero) y confirma la interpretación antes de actuar. Si aparecen muchas decisiones, deriva al `grill` completo. |
| **`grill-with-domain-modeling`** *(Codex/Claude/opencode)* | Un `grill` que además mantiene los docs del dominio (`CONTEXT.md` + ADRs) a medida que las decisiones se resuelven. En los cuatro harnesses esta modalidad también puede elegirse dentro de `grill`; en Claude Code este skill es un wrapper que fija esa elección y saltea la pregunta de configuración. |
| **`domain-modeling`** | Mantiene vivo el modelo de dominio mientras se diseña: desafía términos, afila el lenguaje difuso, y escribe el glosario (`CONTEXT.md`) y las decisiones (`docs/adr/`) cuando cristalizan. Regla de contaminación cero: nunca introduce la práctica en un repo que no la usa. |
| **`tdd`** | Referencia de test-driven development: el loop rojo → verde, qué es un buen test, dónde van (seams), los anti-patrones. Incluye guías de `mocking` y `tests`. Disponible en los cuatro harnesses; `sdd-run` referencia su doctrina en la declaración de seams del plan y en el paso de tests primero. |
| **`code-review`** *(Codex/Pi/opencode)* | Revisa un PR en tres ejes separados —correctness y riesgo, estándares y spec—, ejecuta verificaciones, muestra findings con evidencia y la preview exacta de los comments, y al final pregunta si querés publicarlos en GitHub como un único review COMMENT. Nunca postea sin confirmación explícita. |
| **`github-issue-selector`** *(Codex/Pi)* | Permite elegir o inspeccionar un issue cuando todavía no diste un número concreto. |
| **`issue-triage`** *(Codex/Claude/Pi)* | Analiza uno o varios issues contra código, tests y dependencias; clasifica el próximo stage y emite un handoff estructurado tras la confirmación, pero no lo ejecuta. Para selecciones conjuntas crea un issue canónico y cierra los originales como reemplazados. |
| **`quick-run`** *(Codex/Claude/Pi)* | Consume únicamente un handoff confirmado de `issue-triage` para implementar un cambio pequeño en un worktree aislado, con tests primero cuando corresponde, presupuesto finito y PR o commit local con evidencia exacta. |
| **`repo-clean`** *(Codex/Pi)* | Deja el branch actual sin cambios pendientes y sincronizado con `origin/<branch>`. Si hay trabajo sin commit, muestra el impacto y pregunta si conservarlo o descartarlo; nunca cambia de branch ni hace force-push. |
| **`find-skills`** *(Codex/Pi)* | Busca skills instalables en el ecosistema abierto mediante `npx skills`. Vendorizado desde `vercel-labs/skills`. |
| **`yt-summary`** *(Codex/Claude)* | Descarga con `yt-dlp` un único track de subtítulos de YouTube y guía un resumen con TL;DR, puntos clave y timestamps. |

SDD no reemplaza a estos skills: los orquesta. El diseño previo a una spec se afila con `grill` y `domain-modeling`, y `sdd-run` implementa siguiendo la disciplina de `tdd`.

Aparte, el repo tiene un **skill interno** en `.claude/skills/harness-port/`: guía el porteo y mantenimiento de skills entre los cuatro harnesses (doctrina idéntica, solo cambia la capa de interacción — tool de preguntas, sintaxis de invocación, extras como el sidecar `agents/openai.yaml` en Codex o el campo `compatibility` en Pi), con el par codex/pi de `code-review` como ejemplo canónico. Es un project skill de Claude Code: solo se carga trabajando dentro de este repo, y no se distribuye ni por `install.sh` ni por el plugin.

### Integración con Pi

En Pi, `grill` es el único entry point de entrevista: el usuario elige si quiere solo handoff o también documentación de dominio. El riel actual usa señales estructuradas y skills materializados desde la procedencia canónica de Pi; los entrypoints ya no se limitan a inyectar slash skills como texto.

#### Riel orquestado y fronteras de sesión

Los entrypoints públicos son `/issues` para triage, `/grills` para retomar entrevistas, `/specs` para buscar/inspeccionar specs y `/sdd-run <ruta|#NN>` para autorizar directamente una ejecución.

| Transición | Frontera de sesión |
|---|---|
| `/issues` → Grill/Spec/Quick-run/Run confirmado | **Sesión hija** fresca, ligada mediante `parentSession`; stop, error, rechazo o cancelación conservan la sesión de triage. |
| Grill activo/pausado → resume | **Misma sesión**; el snapshot autoritativo reconstruye el progreso. |
| Grill finalizado → Spec | **Misma sesión**; primero se persiste el handoff y después se materializa `sdd-spec --from-grill`. |
| Spec → Run | **Sesión hija**, sólo después de autorización explícita mediante **Ejecutar ahora**, `/sdd-run` o **Ejecutar** en `/specs`. |
| Triage → Quick-run | **Sesión hija** limpia; `quick-run` conserva su propio preflight, worktree, TDD, presupuesto y PR sin merge. |

En cross-project, el request usa la raíz, repo y artefacto del proyecto destino: la hija se almacena allí, carga sus recursos project-scoped y vuelve a materializar el skill desde el recurso ganador del destino —incluidos overrides del proyecto—, sin copiar el transcript de origen. Encontrar una spec no la ejecuta, inspeccionar/cancelar no cambia sesión y ningún flujo mergea PRs.

Los errores son fail-closed antes del switch. Si el reemplazo ya ocurrió y falla el kickoff o la carga de recursos, se informa honestamente como error `post-switch`, con referencia a la hija y sin fingir rollback del origen.

El repo también conserva todas las extensiones globales de Pi usadas por este workflow:

| Extensión | Qué agrega |
|---|---|
| **`ask-user-question`** | Herramienta `ask_user_question` con selección simple/múltiple, recomendaciones, respuesta libre y envío vacío opcional. |
| **`claude-tool-renderer.ts`** | Presenta las ediciones con encabezado y diff compacto al estilo Claude Code. |
| **`grill-tools`** | Persistencia con `grill_session`, selector `select_grill_session` y comandos `/grills` y `/specs`; resume Grill y Grill → Spec conservan la conversación. |
| **`workflow-orchestrator`** | Consume `WorkflowResolutionV1`, materializa skills canónicos, administra receipts one-shot acotados y abre sesiones hijas same/cross-project. También registra `/sdd-run`; el gate `launch_sdd_run` sólo queda activo cuando la raíz tiene un `.sdd/project.md` canónico. |
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
├── codex/       # versiones para Codex        (~/.codex/skills)
├── claude/      # versiones para Claude Code  (~/.claude/skills)
├── opencode/       # versiones para opencode      (~/.config/opencode/skills)
├── pi/             # skills para Pi               (~/.agents/skills)
├── pi-extensions/  # extensiones de Pi             (~/.pi/agent/extensions)
├── pi-themes/      # themes de Pi                  (~/.pi/agent/themes)
├── .claude/        # project skills internos del repo (harness-port)
├── .claude-plugin/ # marketplace + manifest del plugin de Claude Code
├── .github/        # CI (GitHub Actions)
└── scripts/        # lint de frontmatter y reporte de drift (los usa el CI)
```

El repo corre CI en GitHub Actions (`.github/workflows/ci.yml`): valida sintaxis y estilo de los shells (`bash -n` + shellcheck), el frontmatter de todos los skills (`scripts/lint-frontmatter.sh`, que también corre en macOS local) y los tests de `pi-extensions` con Node 26. Además publica un reporte informativo de drift entre las copias de cada skill por harness (`scripts/drift-report.sh`): la divergencia esperada es solo la capa de interacción de cada harness; una divergencia grande en doctrina amerita revisión manual.

## Instalación

### Claude Code: como plugin (recomendado)

Los skills de `claude/` se pueden instalar como plugin de Claude Code, sin clonar el repo ni correr `install.sh`:

```
/plugin marketplace add chichex/skills
/plugin install chichex-skills@chichex
```

El plugin expone todos los skills de `claude/` y se actualiza solo con cada push al repo (sin versión pineada: Claude Code versiona por commit y cada push llega como update automático).

### Todos los harnesses: con `install.sh`

Cloná el repo y corré `install.sh`. Hace `git pull` y copia cada skill —y las extensiones de Pi, tanto archivos `.ts` como carpetas con `index.ts`— a la carpeta de su herramienta **sin pisar lo demás que ya tengas** (solo agrega/actualiza lo que viene de este repo):

```bash
git clone https://github.com/chichex/skills.git
cd skills
./install.sh            # instala los cuatro sets
./install.sh all        # igual que el anterior
./install.sh both       # Claude Code + opencode
./install.sh codex      # solo los de Codex
./install.sh claude     # solo los de Claude Code
./install.sh opencode   # solo los de opencode
./install.sh pi         # solo los de Pi
```

Destinos por defecto: `${CODEX_HOME:-~/.codex}/skills/`, `~/.claude/skills/`, `~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.pi/agent/extensions/` y `~/.pi/agent/themes/` (overridables con `CODEX_SKILLS_DIR`, `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR` y `PI_THEMES_DIR`).

Como Codex también descubre los skills de Pi en `~/.agents/skills` y no fusiona nombres repetidos, la instalación de Codex agrega un bloque administrado a `${CODEX_HOME:-~/.codex}/config.toml`: desactiva para Codex únicamente las copias Pi que tienen una versión equivalente en `codex/`. Pi sigue usando sus archivos normalmente. El resto de `config.toml` se preserva y las corridas posteriores actualizan el mismo bloque sin duplicarlo. Usá `CODEX_DEDUPLICATE_PI_SKILLS=0` para omitir este cambio o `CODEX_CONFIG_FILE` para apuntar a otro config.

Para **actualizar** más adelante, volvé a correr `./install.sh` — ya hace el `pull` solo.

Si preferís a mano, es un simple copy:

```bash
cp -R codex/*    "${CODEX_HOME:-$HOME/.codex}/skills/"
cp -R claude/*   ~/.claude/skills/
cp -R opencode/* ~/.config/opencode/skills/
cp -R pi/*             ~/.agents/skills/
cp -R pi-extensions/*  ~/.pi/agent/extensions/
cp pi-themes/*.json    ~/.pi/agent/themes/
```

Una vez instalados, Codex los invoca como `$grill`, `$code-review`, `$sdd-spec`, etc., o los carga según su `description` — salvo `sdd-run` y `quick-run`: sus sidecars `agents/openai.yaml` declaran `policy.allow_implicit_invocation: false`, así que sólo se ejecutan al invocarlos explícitamente con `$sdd-run` o `$quick-run`. Claude Code/opencode usan sus comandos habituales. En Pi se usan como `/skill:grill`, `/skill:code-review`, `/skill:sdd-spec` y equivalentes.

**Rollout de Pi:** corré `./install.sh pi` sólo con autorización explícita, porque actualiza el checkout y reemplaza las copias globales administradas; después ejecutá `/reload`. Las sesiones ya abiertas no reciben el código nuevo hasta recargar. Para la prueba interactiva usá una sesión persistida y dos repos descartables; los stages reales requieren un provider local/falso o consumo de proveedor explícitamente autorizado. El smoke autónomo no corre el instalador ni providers.

## Créditos

Cuatro de los **skills fundacionales** están **basados en** los skills de **[Matt Pocock](https://github.com/mattpocock)** — de su repo [mattpocock/skills](https://github.com/mattpocock/skills) (MIT); `mini-grill` es una variante propia reducida de `grill`:

| En este repo | Original de Matt Pocock |
|---|---|
| `grill` | `grilling` |
| `grill-with-domain-modeling` | `grill-with-docs` |
| `domain-modeling` | `domain-modeling` |
| `tdd` | `tdd` |

Además, la **exportación de cuestionario** de `grill` está inspirada en su skill `to-questionnaire`.

La familia **SDD** (`sdd-init`, `sdd-spec`, `sdd-run`) es propia: está inspirada en el mismo enfoque de trabajo (tracer bullets, tests-first, spec → implementación) de sus skills `to-spec` / `to-tickets` / `implement` / `wayfinder`, pero con artefactos distintos — el contrato de autonomía `.sdd/project.md` y el veredicto de verificabilidad.

`find-skills` se conserva tal como fue instalado desde [`vercel-labs/skills`](https://skills.sh/vercel-labs/skills/find-skills); no es un skill propio.

## Licencia

[MIT](./LICENSE) para el material propio y las adaptaciones; `find-skills` conserva las condiciones de su fuente upstream.
