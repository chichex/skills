# Grill — Stacks de PRs por spec + sdd-land
<!-- Estado: finalized. Proyecto: /Users/ayrtonmarini/workspace/skills. Fuente: pedido libre en chat. -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-10-08-stacks-sdd-land; project=%2FUsers%2Fayrtonmarini%2Fworkspace%2Fskills -->

## Modo
standard

## Hechos comprobados
- GitHub tiene stacked PRs nativos (GA 2026-10-06) con la extensión oficial `gh stack` (`init/add/submit/sync/rebase/merge/link/unstack/view --json`). El merge es todo-o-nada hasta el PR elegido; tras mergear el de abajo, GitHub retargetea solo el siguiente a la base del stack. Un PR mergea solo si él y todos los de abajo cumplen requisitos (reviews, checks, historial lineal). Auto-merge no es compatible con stacks. Un stack completado no se extiende. Cross-fork no soportado. Con merge queue el stack se encola junto y la cola elige el método. Fuentes: docs.github.com (quickstart, `reference/stacked-prs-cli-commands`, `creating-stacked-pull-requests`, `merging-stacked-pull-requests`, `troubleshooting-stacked-pull-requests`).
- `gh stack push/sync` usan `--force-with-lease` por branch; `sync` hace fetch, ff del trunk, rebase en cascada, push y `--prune` borra branches locales de PRs mergeados. gh-stack "never automatically stashes changes, creates/removes worktrees, or steals another checkout"; `rebase`/`sync` actualizan solo el worktree limpio dueño de cada branch y frenan si está sucio. Estado local en `.git/gh-stack` (JSON no commiteado). `gh stack link` arma un stack desde branches o PRs sin estado local. Fuente: README de github/gh-stack.
- Local: `gh 2.101.0`, `git 2.54.0`, ninguna extensión de `gh` instalada, ningún tool de stacks (gs, gt, av, spr, jj) en PATH.
- Los 4 repos consultados (`chichex/skills`, `chichex/che`, `pramaestudio/medicine`, `pramaestudio/dale-que-sale`): `deleteBranchOnMerge=false`, merge/squash/rebase habilitados, `viewerDefaultMergeMethod=MERGE`. `main` de skills usa merge commits.
- Al inicio de la sesión: 5 worktrees hermanos `../skills-*` (4 con PRs independientes #61-#64, 1 en branch que trackea `origin/main` con 3 archivos sin commit), 6 branches locales y 7 remotos ya mergeados en `main` sin borrar. Al cierre: #61-#64 mergeados a mano, queda 1 worktree y 1 PR abierto (#65). Las cifras iniciales son la evidencia del problema.
- Git no permite que `sdd/<slug>` y `sdd/<slug>/1` coexistan: mismo namespace de refs (inferencia por semántica de refs; se verifica con `git branch sdd/x && git branch sdd/x/1`).
- `sdd-run`: una spec → un worktree `../<repo>-sdd-<slug>` → un branch `sdd/<slug>` → un PR contra `--base`; nunca mergea ni hace force-push; al `Terminar` remueve el worktree si está limpio y el branch queda. Doctrina idéntica en `claude|codex|opencode|pi/sdd-run/SKILL.md`.
- `sdd-spec` (`claude/sdd-spec/SKILL.md:104`) propone ante "tamaño máximo de PR" una partición en "2+ specs encadenadas" sin campo de linaje. `SDD-Tracking v1` (`docs/sdd-tracking-v1.md`) solo tiene `issue`, `grill`, `superseded-by` y es inmutable.
- `sdd-review-loop` corrige en `../<repo>-review-loop-<PR>` detached sobre `origin/<headRef>` con push normal, nunca force. `quick-run` usa worktree hermano y branch `quick/issue-<N>-<slug>`.
- `repo-clean` existe solo en `pi/` y `codex/`: sincroniza el branch actual con `origin/<branch>`, no cambia de branch, no borra branches ni worktrees, maneja checkout sucio con conservar/descartar.
- `install.sh` poda en cada destino los skills administrados que el checkout ya no tiene (manifest `.chichex-skills-managed`, PR #60).
- Contrato de este repo (`.sdd/project.md` Limites): prohíbe push a main, force-push y mergear PRs. CI con 6 jobs tras PR #62 (`plugin-validate` incluido).
- Gates a tocar ante alta/baja de skills: `EXPECTED_SKILLS` y conteo de comandos RPC en `pi-extensions/pi-package/pi-package.test.ts`, `scripts/lint-frontmatter.sh`, `pi-extensions/harness-gate/`, `pi-extensions/agents-gate/`, README/README.en, `.claude-plugin/plugin.json`, manifest de `install.sh`.
- `domain-modeling` retirado el 2026-10-08: la sesión corrió en modo `standard` sin preguntarlo.

## Decisiones resueltas
1. Harnesses: los 4 (Claude, Codex, opencode, Pi) con doctrina idéntica vía `harness-port`. `sdd-land` reemplaza a `repo-clean` en Pi.
2. `repo-clean` en Codex: también se retira. `repo-clean` desaparece del repo.
3. Herramienta: stacks nativos de GitHub con la extensión oficial `gh stack`.
4. Dónde se parte la spec: en la spec. `sdd-spec` agrega una sección `Plan de entrega` con capas ordenadas y los CAs de cada una. `sdd-run` la sigue.
5. Criterio de corte: cada capa es un grupo coherente de CAs cuyos tests dan verde solos más la regresión; si el contrato tiene "tamaño máximo de PR" activo, cada capa tiene que entrar. `sdd-spec` propone el corte en la spec y el usuario lo ajusta sobre el artefacto, sin pregunta extra.
6. Naming: branches `sdd/<slug>/<n>-<etapa>` en un único worktree `../<repo>-sdd-<slug>`, subiendo con `gh stack add`. Para stacks no existe `sdd/<slug>` pelado; una spec de una sola capa sigue usando `sdd/<slug>`.
7. Verificación por capa: antes de `gh stack add` de la capa siguiente, CAs de la capa verdes + regresión + escalera del contrato. La spec acumula sus filas en `Resultado de ejecucion` (con columna de capa) en el branch de cada capa y pasa a `implementada` recién en la capa top. El PR de abajo lleva la spec completa y `Closes #NN`; los de arriba, su sección de capa y "capa n/N".
8. Force-push: permitido únicamente a través de `gh stack push/sync/rebase` sobre `sdd/<slug>/*` del run o del stack que se está corrigiendo. Nunca `git push --force`, nunca a main, nunca a branches ajenos. Si `sdd-review-loop` corrige una capa baja, restackea con `gh stack sync`.
9. Forma del cierre: skill nuevo `sdd-land`. Su invocación explícita es la autorización humana de merge. `sdd-run` solo lo sugiere en su reporte; no lo encadena.
10. Targets de `sdd-land`: cualquier PR o stack del repo (número de stack, número de PR o varios PRs). Un PR suelto es un stack de uno. GitHub es la fuente de verdad del stack.
11. Gate de merge: por cada PR del stack, mergeable + checks verdes + sin review threads sin resolver + no draft. Con checks pendientes, polling en primer plano cada 60 s hasta `--wait` (default 20 min), cancelable. Rojo o timeout frena con diagnóstico, sin merge parcial del stack. Nunca saltea branch protection.
12. Método de merge: el default que GitHub declara para el repo (hoy merge commit en los 4), mostrado en la confirmación; `--method merge|squash|rebase` lo pisa por invocación. Con merge queue manda la cola.
13. Branches remotos: cuando todo el stack aterrizó, borra `origin/<branch>` de cada PR mergeado. Después lista los demás remotos ya mergeados en main y los borra tras una confirmación. Nunca toca branches con PR abierto o sin mergear.
14. Limpieza local: automático para lo del stack (worktree solo si está limpio, `git branch -d`, estado de gh-stack, `git fetch --prune`, `git worktree prune`). El ruido previo (branches locales ya mergeados en main, worktrees con branch mergeado o borrado) se lista y se borra tras UNA confirmación. Worktrees sucios y branches sin mergear: solo se reportan con ruta y comando.
15. Checkout principal sucio: `sdd-land` absorbe el flujo de `repo-clean`: muestra el impacto (status, diff stat, untracked, preview de `git clean -nd`) y pregunta.
16. Opciones ante el checkout principal sucio: `Conservar en branch nuevo wip/<fecha>-<slug>, sin push` (recomendada: main queda limpio y se fast-forwardea; el branch queda local para decidir después) / `Descartar` (nombrando los paths, confirmación explícita) / `Agregar al .gitignore` (para untracked que son ruido). Nunca stash.

## Ramas pendientes
Ninguna dentro del alcance.

## Handoff
**Tema y alcance**
Dos cambios encadenados en la familia SDD, en los cuatro harnesses: (1) una spec con más de una capa produce un stack nativo de GitHub con un PR atómico por capa, generado en un solo `sdd-run`; (2) skill nuevo `sdd-land` que mergea un stack o PR, sincroniza el checkout principal y limpia el ruido local y remoto, reemplazando a `repo-clean` en Pi y Codex.

**Restricciones y no-objetivos**
- No se debilita nada de `sdd-run`: CAs, regresión, receipt Git y tres intentos siguen igual por capa.
- Un stack sale de UN run de UNA spec; no se coordinan N runs.
- `SDD-Tracking v1` no cambia ni nace v2: el linaje spec↔stack vive en `Plan de entrega` y en los bodies de PR.
- `sdd-land` nunca mergea sin mostrar y confirmar el plan (PRs, orden, método), nunca hace bypass de protección, nunca pushea a main, nunca resetea ni stashea el checkout principal fuera del flujo de la decisión 16.
- No se activa `deleteBranchOnMerge` ni se cambia ningún setting de repo.
- Stacks cross-fork: rechazados con diagnóstico.
- Specs históricas no se tocan.

**Supuestos explícitos**
- Spec de una sola capa → PR normal `sdd/<slug>`, sin stack de uno.
- La Fase 6 de `sdd-run` (feedback y `Code review`) opera sobre todos los PRs del stack de abajo hacia arriba; `Code review` dispara `claude-review.yml` por cada PR.
- `sdd-run` termina su reporte sugiriendo `/sdd-land <stack>`.
- `sdd-land` pelado lista stacks y PRs abiertos del repo y pregunta; con args va directo; acepta `--dry-run`, `--wait N`, `--method`.
- Preflight de stack: si falta `gh stack`, interactivo ofrece `gh extension install github/gh-stack` ahí mismo; con `--assume` frena honesto antes de ramificar.
- Sync final del checkout principal: `git fetch --prune` + `git merge --ff-only origin/<default>`; main con commits locales adelante se reporta y no se toca.
- `sdd-review-loop` sobre un PR de stack: el corrector trabaja sobre el branch de la capa (no detached) y restackea con `gh stack sync`; el modelo detached queda para PRs sin stack.
- La identidad del stack se lee de GitHub (`gh stack view --json`, `gh pr view`); el body de cada PR lleva "capa n/N del stack de <spec>" como ayuda humana, no como tracking machine-readable.
- El contrato de este repo se ajusta para reconocer `sdd-land` como merge autorizado por el humano. En otros repos, si el contrato prohíbe merge sin esa excepción, `sdd-land` frena y lo dice.

**Riesgos**
- `gh stack` llegó a GA el 2026-10-06: CLI y flags pueden moverse; el contrato pinea la versión verificada.
- Borrado de branch remoto vs. retarget automático del stack: no documentado oficialmente. Por eso se borra solo cuando TODO el stack aterrizó.
- Squash o rebase con stacks: reportes no oficiales de problemas de tracking; el default es merge commit.
- Un fix en una capa baja rebasea las de arriba e invalida aprobaciones si el diff cambió.
- Verificación autónoma de `sdd-land`: exige repos descartables con stacks reales en GitHub (red): señal MEDIA; parte queda como prueba humana.
- Hay que actualizar `pi-package` gate (`EXPECTED_SKILLS`, comandos RPC), `harness-gate`, `agents-gate`, lint de frontmatter, README, `plugin.json`, manifest de `install.sh` y `.sdd/project.md`.

**Diferido**
- Evals de triggering para `sdd-land`.
- Activar `deleteBranchOnMerge` por repo (decisión por repo, fuera de esta spec).
- Soporte probado de merge queue con stacks.

**Contexto para la spec**
`claude|codex|opencode|pi/{sdd-spec,sdd-run,sdd-review-loop}/SKILL.md`; `pi/repo-clean/SKILL.md` y `codex/repo-clean/SKILL.md` (baja); `pi-extensions/pi-package/pi-package.test.ts` (`EXPECTED_SKILLS`, conteo RPC); `pi-extensions/harness-gate/`; `pi-extensions/agents-gate/`; `scripts/lint-frontmatter.sh`; `install.sh` y su manifest de administrados; `README.md`/`README.en.md`; `.claude-plugin/plugin.json`; `.sdd/project.md` (Limites y tabla de comandos); skill `harness-port`; docs oficiales de stacked PRs en docs.github.com y README de `github/gh-stack`.
