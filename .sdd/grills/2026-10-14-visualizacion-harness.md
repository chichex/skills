# Grill — Visualización del harness SDD
<!-- Estado: finalized. Proyecto: /home/chiche/workspace/skills. Fuente: pedido libre. -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-10-14-visualizacion-harness; project=%2Fhome%2Fchiche%2Fworkspace%2Fskills -->

## Hechos comprobados
- Los grills viven en `<git-common-dir>/sdd/grills/` (borrador local) y en `.sdd/grills/` (commiteados); estados `paused|finalized`. [verificado: `claude/grill/SKILL.md`]
- Las specs viven en `.sdd/specs/`, en el common-dir o en el body de un issue; estados `draft|approved|implemented|superseded`, con `issue=` y `grill=`. [verificado: `docs/sdd-tracking-v1.md`, `claude/sdd-spec/SKILL.md:189`]
- Los PRs SDD salen de `sdd/<slug>` o del stack `sdd/<slug>/<n>-<etapa>`, con `Closes/Refs #NN`. [verificado: `claude/sdd-run/SKILL.md:45-48,152`]
- `implemented` se escribe antes del merge, así que el estado de la spec no alcanza para saber si algo se mergeó. [verificado: `claude/sdd-run/SKILL.md:47,213`]
- Hoy no hay estado de run ni fechas de transición. [verificado: schemas de `docs/sdd-tracking-v1.md`]
- El parser canónico `parseSddArtifact` existe en `pi-extensions/sdd-artifacts/`. [verificado]
- `gh` está autenticado con capacidad de PR. [verificado: `.sdd/project.md`]

## Decisiones resueltas
1. Propósito: tres usos, bandeja de "qué me toca", panorama por etapa y métricas. Bandeja y panorama van primero; las métricas, en una segunda etapa.
2. Propósito: los repos los agrega el usuario desde la UI.
3. Propósito: la fuente cruza GitHub (issues, PRs y reviews) con los artefactos locales.
4. Propósito: un worktree no es señal de estado. El estado se refuerza desde el harness.
5. Pipeline: etapas `Inbox → Grill paused → Grill finalized → Spec draft → Spec approved → Run → PR → Mergeado`.
6. Pipeline: "pendiente humano" son dos columnas distintas, spec draft para aprobar y PR esperando review.
7. Pipeline: Inbox son los issues abiertos sin grill ni spec.
8. Pipeline: los PRs sin linaje SDD se cuentan en el grupo "fuera de SDD".
9. Pipeline: hay un log local append-only `<git-common-dir>/sdd/events.jsonl` que escriben los skills en cada transición. Cubre los runs (started, failed, pr-opened) y deja historia para las métricas.
10. Pipeline: escriben el log los skills de los 4 harnesses (Claude Code, Codex, opencode y Pi), con paridad y gate anti-drift.
11. Pipeline: reviews solo de GitHub, con el estado actual y la cantidad de rondas. Quedan afuera `claude-review.yml` y las reviews locales.
12. Pipeline: no hay carril `quick-run`.
13. Fuente: GitHub se lee con `gh api graphql`, una query por repo (issues, PRs, reviews y bodies).
14. Fuente: lectura al abrir, refresh manual y polling mientras está abierto.
15. Fuente: el registro es por ruta local, y el `owner/repo` se deriva del remote.
16. Fuente: se guarda el último snapshot por repo, con su antigüedad visible y uso offline.
17. Superficie: web app local (server local más browser).
18. Superficie: vive en un repo nuevo (ej: `chichex/sdd-board`). En `skills/docs/` se especifican `sdd-tracking-v1` (existente) y un nuevo `events-v1`.
19. Superficie: la UI es solo lectura con links a GitHub y rutas o comandos para copiar. La única escritura es agregar repos.
20. Superficie: la vista principal y la dirección visual se definen en una etapa de diseño aparte (`/design-system` y mocks en el repo nuevo), antes de la spec de UI.
21. Superficie: orden de entrega. 1) skills: `events-v1` y su escritura en los 4 harnesses. 2) board: lectura, bandeja y kanban. 3) métricas.

## Ramas pendientes
Ninguna.

## Handoff
**Tema y alcance.** Un board local que muestra, por repo, el pipeline SDD: issues, grills, specs, runs, PRs con sus reviews, y merge. Sirve como bandeja, como panorama y, en una segunda etapa, para métricas. Se divide en dos entregas: skills (formato `events-v1` y escritura de eventos) y un repo nuevo para el board.

**Restricciones y no-objetivos.**
- El board no ejecuta acciones de los skills: no aprueba specs ni dispara runs o reviews.
- No se infiere estado a partir de worktrees.
- No se agrega UI ni build al repo skills.
- No se toca el wire format de `SDD-Tracking v1`.

**Supuestos explícitos.**
- El polling default es de 5 minutos y se puede configurar.
- El board consume `sdd-tracking-v1` copiando o vendorizando el parser, sin depender en runtime del repo skills.
- `gh` (`pr view --json reviews` o GraphQL) alcanza para contar las rondas de review. Se verifica con una query sobre un PR real.

**Riesgos y temas diferidos.**
- Retirar `quick-run` es trabajo aparte. Afecta a `issue-triage`, que lo encadena.
- El stack técnico del board se decide en su spec, después del diseño.
- `events.jsonl` es por máquina: un run hecho en otra máquina no aparece.
- Las métricas dependen de la historia que acumule el log desde su alta. No hay backfill, salvo lo que se pueda derivar de GitHub.

**Contexto para la spec.** La primera spec es la de skills: el formato `events-v1` (eventos, campos, ubicación y concurrencia del append) y su escritura en grill, sdd-spec, sdd-run y sdd-land de los 4 harnesses, con gate anti-drift. Hay que leer `docs/sdd-tracking-v1.md` como modelo de spec de formato, y `pi-extensions/sdd-artifacts/`.
