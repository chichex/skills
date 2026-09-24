# Grill — Suite de evals de `claude plugin eval` para `chichex-skills`
<!-- Estado: finalized. Proyecto: /Users/ayrtonmarini/workspace/skills. Fuente: pedido en chat del 2026-09-22 ("podemos usar el claude plugin eval para ver si resiste nuestro set de skills?"). -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-09-22-plugin-evals; project=%2FUsers%2Fayrtonmarini%2Fworkspace%2Fskills -->

## Modo
standard

## Hechos comprobados
- No existe suite ni `experimental.evals` en `.claude-plugin/plugin.json` (`git ls-files`; `.claude-plugin/plugin.json`).
- Un `evals/` en la raíz no choca con ningún gate ni linter: `scripts/lint-frontmatter.sh:19-36` y `scripts/drift-report.sh:18-20` recorren solo `claude/`, `codex/`, `opencode/` y `pi/`; el censo del package usa `git ls-files -- pi pi-extensions pi-themes` (`pi-extensions/pi-package/pi-package.test.ts:221`). Ningún gate lista la raíz.
- `claude plugin eval` (Claude Code 2.1.280) busca `evals/**/case.yaml` o `prompt.md` + `graders/*.md` bajo el plugin; el eval dir sale de `experimental.evals` del manifest o es `evals/` (`claude plugin eval --help`).
- `prompt.md` solo admite en frontmatter `max_turns`, `timeout_seconds`, `allowed_tools`, `model` y `runs`. `context.add_dirs`, `scaffold_script` e `history_file` existen solo en `case.yaml` (`schema_version: "1.1"`). Sin `--scaffold` el caso corre en un workspace vacío (strings del binario `~/.local/share/claude/versions/2.1.280`).
- Tipos de grader: `regex`, `tool_order`, `tool_used`, `file_exists`, `llm`, `baseline`. `tool_used` acepta `tool`, `input_match`, `min`, `max` y `arm: with-only|both`. Targets: `trace`, `last_message`, `files`, `mock_calls`. El juez `llm` toma muestras independientes y decide por mayoría; default `--judge-model haiku`. Solo `llm` y `baseline` son pagos (binario y `--help`).
- Bajo `--ablation with-without`, los graders `with-only` (incluido `tool_used: Skill`) no puntúan: son indicador de "plugin disparado". Default: `with-without` cuando resuelve un plugin, `none` si no (`--help`).
- Defaults del comando: `runs` = `case.runs ?? 3`; `--threshold 1.0`; resultados en `<eval dir>/results/<timestamp>/` con `aggregate-result.json` y reporte HTML; el reporte se publica a claude.ai salvo `--no-publish`; `--max-cost-usd` aborta con exit 2 y resultados parciales (`--help`).
- `claude plugin eval init --bare <name>` genera `evals/<name>/prompt.md` (frontmatter `max_turns: 10`, `allowed_tools: [Read, Glob, Grep, Skill]`) y `evals/<name>/graders/criteria.md` (`type: llm`, `weight: 1`) (corrido en el scratchpad de la sesión).
- El tool `Skill` de Claude Code recibe `{"skill": "chichex-skills:<nombre>", "args": ...}` (schema del tool en la sesión). Un `input_match` sobre ese JSON detecta el disparo sin modelo.
- `.gitignore` no cubre `evals/results/` (solo `.DS_Store`, `node_modules/`, `package-lock.json`).
- `.github/workflows/claude-review.yml` corre en `ubuntu-latest` por `workflow_dispatch` (inputs `pr`, `model`, `effort`) con el secret `CLAUDE_CODE_OAUTH_TOKEN` (`:24-68`, `:96`). El binario del CLI referencia `CLAUDE_CODE_OAUTH_TOKEN` (strings). `ci.yml` no tiene auth de Anthropic.
- `claude/` tiene 14 skills. `grill-with-domain-modeling` declara `disable-model-invocation: true` (`claude/grill-with-domain-modeling/SKILL.md:4`): el modelo no puede dispararlo. `mini-grill` y `domain-modeling` declaran disparo solo explícito en su `description`.
- Modelo default de la sesión del usuario: `claude-fable-5-1[1m]` (`~/.claude/settings.json:22`). Sin `--model`, las corridas lo usan.
- No hay `CONTEXT.md`, `CONTEXT-MAP.md` ni `docs/adr/`. Grills previos en `.sdd/grills/`: ninguno trata evals; `2026-09-22-sdd-menos-friccion.md` define la doctrina de `sdd-spec` que la rúbrica de adherencia juzga.

## Decisiones resueltas
1. **Objetivo.** Triggering determinista más un único caso de adherencia de `sdd-spec`.
2. **Cobertura de triggering.** Seis skills: `sdd-init`, `sdd-spec`, `sdd-run`, `sdd-review-loop`, `grill`, `mini-grill`. Fuera: `coding-policies`, `domain-modeling`, `issue-triage`, `quick-run`, `tdd`, `wait-pr`, `yt-summary` y `grill-with-domain-modeling`.
3. **Modelo.** Cada caso declara `model: claude-sonnet-5`. `--model` lo pisa a demanda.
4. **Sin gate determinista** sobre la suite. Se valida solo al correrla.
5. **Fixture de adherencia.** Un mini repo versionado en `evals/fixtures/` con `.sdd/project.md` mínimo, montado con `context.add_dirs` desde un `case.yaml`. El prompt apunta al path del fixture.
6. **Graders de adherencia.** Deterministas: `tool_used Read` sobre `.sdd/project.md`, `tool_used AskUserQuestion` con `max: 0`, `file_exists` sobre la spec escrita, `regex` sobre la sección de inferencias. Más una rúbrica `llm` juzgada por Haiku que evalúa que las inferencias estén expuestas y correspondan al pedido.
7. **Runs.** `runs: 1` en cada caso. Comando documentado con `--ablation none`. Repetición con `--runs 3 --ablation with-without` a demanda cuando un caso falla o cambia un skill.
8. **Presupuesto.** `--max-cost-usd 5` por corrida completa. Se calibra con el costo real del primer reporte y se actualiza en la doc.
9. **Reporte.** `--no-publish`. HTML y JSON quedan en `evals/results/`, ignorado por git.
10. **CI.** Workflow `plugin-eval.yml` por `workflow_dispatch`, runner `ubuntu-latest`, auth con el secret `CLAUDE_CODE_OAUTH_TOKEN` existente, corre `claude plugin eval . --trust-plugin --json --no-publish --max-cost-usd 5`.
11. **Umbral.** `--threshold 1.0`. Cualquier grader que falle pone el caso y el job en rojo.
12. **Verificación paga.** `sdd-run` puede ejecutar exactamente una corrida local completa con `--max-cost-usd 5 --no-publish` como verificación. Toda repetición pide OK aparte.

## Ramas pendientes
Ninguna dentro del alcance. Bloques futuros: casos de triggering para los siete skills excluidos; adherencia de `sdd-run` y `sdd-review-loop` (fixtures con git y PR); gate determinista sobre la suite; job automático en PRs que toquen `claude/`, `agents/` o `evals/`.

## Handoff
**Tema y alcance**
Primera suite de evals del plugin de Claude Code `chichex-skills`. Mide dos cosas: que los skills de la familia SDD, `grill` y `mini-grill` se disparen ante el prompt correcto y no ante el ajeno, y que `sdd-spec` siga su doctrina una vez disparado. Vive en `evals/` en la raíz del repo. Corre local y por un workflow manual de GitHub Actions. Las 12 decisiones de "Decisiones resueltas" son autoritativas.

**Restricciones y no-objetivos**
- Solo el plugin de Claude Code (`claude/` y `agents/`). `codex/`, `opencode/` y `pi/` quedan fuera: `plugin eval` no los conoce.
- La suite mide, no corrige. Esta spec no modifica ningún `SKILL.md` ni `agents/*.md`. Un caso que falle abre issue o spec aparte.
- Sin gate anti-drift, sin job en cada PR, sin publicación de reportes.
- Límites del contrato de autonomía: sin push a `main`, sin merge, sin tocar configuración real más allá de la corrida autorizada en la decisión 12.

**Supuestos explícitos**
- Casos de triggering en formato `prompt.md` + `graders/*.md`, el de `init --bare`. Solo el caso de adherencia usa `case.yaml`.
- Cada caso de triggering lleva `max_turns` bajo (3) y `allowed_tools: [Read, Glob, Grep, Skill]`. El caso de adherencia suma `Write`.
- Un caso positivo por skill, con graders `tool_used` sobre el tool `Skill` por `input_match` contra `"skill":"chichex-skills:<nombre>"` (aceptando el nombre con o sin prefijo de plugin). Donde hay confusión, el mismo caso agrega un grader negativo (`max: 0`). Un caso extra con un pedido ambiguo donde ningún skill debe dispararse. Total estimado: 8 casos.
- Pares negativos: "hagamos la spec de X" dispara `sdd-spec` y no `grill`; "grillame este plan" dispara `grill` y no `sdd-spec`; un pedido ambiguo sin la frase "mini grill" no dispara `mini-grill` ni `grill`; "corré la spec de X" sin spec en el workspace dispara `sdd-run` y no `sdd-spec`.
- El workflow copia la estructura de `claude-review.yml` y expone inputs `case`, `runs`, `model` y `ablation` con los defaults de la suite.
- Documentación: fila nueva en la tabla de comandos de `.sdd/project.md`, sección en `README.md` y `README.en.md`, y `evals/results/` en `.gitignore`.
- La verificación autónoma de la spec es la corrida de la decisión 12 más la carga sintáctica del workflow.

**Riesgos y preguntas diferidas**
- `context.add_dirs` monta el fixture como directorio adicional, no como cwd. Si `sdd-spec` no encuentra el contrato aunque el prompt apunte al path, el fallback es `scaffold_script` con `--scaffold`. Se resuelve en el smoke, no acá.
- No hay cifra verificada de costo por caso. El techo de 5 USD es una estimación hasta el primer reporte.
- La rúbrica `llm` es ruidosa por diseño. Con umbral 1.0 puede poner en rojo un caso correcto; la respuesta acordada es repetir con `--runs 3`.
- No se sabe si `AskUserQuestion` existe en el hijo `-p`. El grader `max: 0` sigue siendo válido: si no existe, nunca se usa.

**Bloques pendientes para futuras sesiones**
- Casos de triggering para los siete skills excluidos.
- Adherencia de `sdd-run` y `sdd-review-loop`, que exigen fixtures con git y PR.
- Gate determinista sobre la suite, si la cobertura crece.
- Job automático en PRs que toquen `claude/`, `agents/` o `evals/`.

**Contexto recomendado para la sesión que escriba la spec**
- Este handoff y `.sdd/project.md`.
- Las `description` de los seis skills en `claude/*/SKILL.md` para redactar prompts positivos y negativos.
- `.claude-plugin/plugin.json` y `.github/workflows/claude-review.yml` como plantilla del workflow.
- La salida de `claude plugin eval --help` y la plantilla de `claude plugin eval init --bare`.
- El grill `.sdd/grills/2026-09-22-sdd-menos-friccion.md` para la doctrina de `sdd-spec` que juzga la rúbrica.
