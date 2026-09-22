# Grill — Menos fricción en sdd-spec/sdd-run + implementer visible
<!-- Estado: finalized. Proyecto: /Users/ayrtonmarini/workspace/skills. Fuente: pedido libre en chat. -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-09-22-sdd-menos-friccion; project=%2FUsers%2Fayrtonmarini%2Fworkspace%2Fskills -->

## Modo
standard

## Hechos comprobados
- El plugin instalado (`~/.claude/plugins/installed_plugins.json`) está en `98a194d` (PR #42), anterior a `agents/` (PR #43 y `d7e381d`): el subagente `implementer` no está instalado.
- Solo `claude/sdd-review-loop/SKILL.md` menciona `implementer`; `sdd-run` y `sdd-spec` no.
- `sdd-spec` puede frenar 5 veces (origen, intensidad, inferencias, mecanismo, destino); `sdd-run` otras 5 (spec, intensidad, spec en draft, gate del plan, feedback post-PR).
- Ultracode existe solo en `claude/sdd-spec`, `claude/sdd-run` y `claude/sdd-init` (más la spec histórica `.sdd/specs/subagentes-claude.md`).
- 9 de 10 issues del repo traen marker `SDD-Tracking`.
- `opencode/sdd-run/SKILL.md:230` prohíbe delegar a un subagente la responsabilidad integral de completar y cerrar la spec.
- Los 4 harnesses tienen un skill `code-review` propio.
- Pi trae una extensión de ejemplo `examples/extensions/subagent/` (no activa por default; lanza procesos `pi --mode json -p --no-session`; modos single/parallel/chain; agentes `.md`).
- `pi-extensions/agents-gate/agents-gate.test.ts` valida frontmatter de `agents/implementer.md` (incluida `description` entre comillas dobles) y doctrina de `claude/sdd-review-loop` y `claude/sdd-run`.

## Decisiones resueltas
1. Alcance: los 4 harnesses (claude, codex, opencode, pi) con doctrina idéntica; lo que depende de subagentes queda solo en Claude.
2. Problema 1: reescribir la `description` de `agents/implementer.md` para que Claude lo elija solo ante cualquier tarea de implementación. Los skills no cambian por esto. Actualizar el plugin instalado es un paso operativo del usuario, fuera del código.
3. `sdd-spec` nunca pregunta inferencias (con o sin grill): quedan en la tabla de la spec marcadas `[ASSUMED]` y el usuario las revisa sobre el artefacto.
4. Mecanismo de verificación por CA: se toma la propuesta sin preguntar; las alternativas quedan escritas en la spec.
5. Estado: la spec queda `draft`. Elegir run (opción del menú) o correr `sdd-run` sobre ella la aprueba implícitamente, sin preguntar. `sdd-run` deja de preguntar "¿spec en draft, sigo?".
6. Destino automático sin preguntar: viene de issue → actualiza ese issue; si no, y el repo tiene ≥1 issue con `SDD-Tracking` → crea issue; si no → `.sdd/specs/<slug>.md`.
7. Menú final dinámico con link/ruta: en `.md` → `Llevar a issue` / `sdd-run` / `sdd-run con subagente` / `Solicitar cambios`; en issue → `sdd-run` / `sdd-run con subagente` / `Solicitar cambios`.
8. `Solicitar cambios`: por chat o por comments en el issue; al elegir la opción relee los comments nuevos, reescribe la spec y vuelve al menú.
9. `sdd-run con subagente`: lanza el subagente `implementer` en background que corre `sdd-run --assume` completo; si `implementer` no está instalado, cae a `general-purpose` y lo avisa. La sesión queda libre y avisa con el PR.
10. Gate del plan de `sdd-run`: imprime el plan y sigue; frena solo si el plan choca con la spec o con una política (tamaño de PR, dependencia nueva `preguntar`).
11. Desviaciones en `sdd-run`: sin cambio de alcance → `[DEVIATION]` en la spec y sigue; con cambio de alcance → pregunta.
12. Ultracode se elimina por completo (flag, lanzador, sección, límites) de `sdd-spec`, `sdd-run` y `sdd-init`. Las specs históricas no se tocan.
13. Post-PR de `sdd-run`: tres opciones `Resolver feedback` / `Code review` / `Terminar`. `Code review` lanza el review y encadena la Fase 6 (resolver feedback).
14. Sin `.sdd/project.md`: se mantiene la pregunta de correr `sdd-init`.
15. `Code review` en Claude: GHA `.github/workflows/claude-review.yml` con `workflow_dispatch` si existe (`gh workflow run claude-review.yml -f pr=<N>`); si no, subagente `reviewer` con `/code-review --comment`.
16. `Code review` fuera de Claude (codex/opencode/pi): solo GHA; sin GHA la opción no aparece.
17. `sdd-run con subagente` fuera de Claude: la opción no aparece.
18. Subagentes en Pi: issue aparte (adaptar la extensión `subagent` al Pi Package); fuera de esta spec.

## Ramas pendientes
Ninguna dentro del alcance.

## Handoff
**Restricciones y no-objetivos**
- No se debilita la verificación: CAs, regresión y receipt Git quedan igual.
- `--assume` sigue existiendo.
- No se tocan specs históricas ni se mergea nada.
- `sdd-run` normal no delega la implementación al `implementer`.
- No se implementan subagentes en Pi ni se cambia la regla de `opencode/sdd-run/SKILL.md:230`.

**Supuestos explícitos**
- Los lanzadores que piden un dato faltante (origen de la spec, cuál spec correr) se mantienen; si hay una sola spec candidata se usa directo.
- La GHA se detecta leyendo `.github/workflows/claude-review.yml` y buscando `workflow_dispatch`.

**Riesgos**
- Dentro de un subagente, `sdd-run` quizás no puede lanzar sus `Explore` y explora inline (inferencia; verificable con smoke).
- Una `description` agresiva del `implementer` puede hacer que Claude delegue tareas triviales.
- Hay que actualizar `agents-gate`, `harness-gate` y el lint de frontmatter.

**Diferido**
- Issue aparte: subagentes en Pi (implementer/reviewer vía extensión `subagent`).

**Contexto para la spec**
- `claude|codex|opencode|pi/{sdd-spec,sdd-run,sdd-init}/SKILL.md`, `agents/implementer.md`, `pi-extensions/agents-gate/`, `pi-extensions/harness-gate/`, skill `harness-port`.
