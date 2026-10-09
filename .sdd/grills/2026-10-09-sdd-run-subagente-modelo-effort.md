# Grill — sdd-run con subagente: modelo y effort elegibles con recomendado
<!-- Estado: finalized. Proyecto: /Users/ayrtonmarini/workspace/skills. Fuente: pedido libre en chat (2026-10-09): "quiero que el skill de sdd-run en claude me deje elegir el modelo y el effort si es con subagente. Dandome un recomendado". -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-10-09-sdd-run-subagente-modelo-effort; project=%2FUsers%2Fayrtonmarini%2Fworkspace%2Fskills -->

## Hechos comprobados

- `sdd-run con subagente` hoy existe solo en el menú final de `sdd-spec`: lanza `Agent` con `subagent_type: "implementer"`, `run_in_background: true`, prompt `/sdd-run <target> --assume`, sin `model` ni `effort`, con fallback a `general-purpose` anunciado (`claude/sdd-spec/SKILL.md:204`).
- `sdd-run` no tiene modo subagente propio; flags actuales `--assume`, `--no-pr`, `--base`. Su doctrina de ownership ya nombra "el `implementer` lanzado por `sdd-run con subagente`" (`claude/sdd-run/SKILL.md:22,111`). `subagent_type` aparece solo para el `reviewer` de la Fase 6 (`:189`).
- La tool `Agent` de Claude Code acepta `model` (`sonnet`, `opus`, `haiku`, `fable`) y `effort` (`low`, `medium`, `high`, `xhigh`, `max`). Su schema pide pasar `effort` solo cuando el usuario, CLAUDE.md o un skill lo piden explícitamente (schema de la tool en la sesión del grill).
- Antecedente de flags `--model`, wizard con `(Recomendado)` y opción "modelo de la sesión" en `sdd-review-loop` (`claude/sdd-review-loop/SKILL.md:17,24,44,66`).
- Precedencia de modelo en subagentes: invocación > frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > sesión. Los agentes no fijan `model` (CA-6 de `.sdd/specs/subagentes-claude.md:37,59`; `pi-extensions/agents-gate/agents-gate.test.ts:101` prohíbe `model`, no `effort`). Esa spec dejó fuera de alcance cambiar modelo y effort (`:88`).
- Gates que acotan dónde escribir: `harness-gate` exige en `claude/sdd-spec` el `subagent_type: "implementer"`, `run_in_background`, fallback `general-purpose` anunciado y `--assume`; exige los bloques `sdd-spec-flow`, `sdd-run-flow`, `sdd-run-stack` y `sdd-run-dirty-checkout` idénticos en los 4 harnesses; y prohíbe `subagent_type` en codex/opencode (`pi-extensions/harness-gate/harness-gate.test.ts:589-612,646`). `agents-gate` CA-12 prohíbe nombrar `implementer`/`reviewer` en la Fase 2 de `sdd-run` (`agents-gate.test.ts:517-525`). Ningún gate menciona `effort`.
- Toda spec trae `## Comportamiento esperado` con CAs (`### CA-N — … (GRADO)` en el template), `## Plan de entrega` con tabla `| Capa | Etapa | CAs | Justificacion |` y `## Verificabilidad` en prosa libre (`claude/sdd-spec/SKILL.md:124-152`).
- Specs reales (43 con CAs en `waica`, `brik` y `dale-que-sale/.sdd/specs/*.md`, contadas el 2026-10-09): CAs mínimo 1, cuartil inferior 10, mediana 12, cuartil superior 14, máximo 26. Con el corte elegido (hasta 10 / 11 a 16 / 17 o más): sonnet 15, opus 21, fable 7. 40 de 44 mencionan CAs MEDIA o BAJA en `## Verificabilidad`; solo 2 tienen `## Plan de entrega`.
- Grill previo #45 (`.sdd/grills/2026-09-22-sdd-menos-friccion.md:28,36`): el subagente corre `sdd-run --assume` completo; la opción no aparece fuera de Claude.
- Pi: la tool `subagent` acepta `model` (provider/id) pero no thinking ni effort (`pi-extensions/subagent/index.ts:68-70`). `pi/sdd-spec/SKILL.md:236` lanza `agent: "implementer"` en background.
- No hay `CONTEXT.md`, `CONTEXT-MAP.md` ni `docs/adr/` en este repo.

## Decisiones resueltas

1. **Entrada doble.** `sdd-run` gana el flag `--subagent`, que pregunta modelo y effort y lanza el `implementer` en background con `/sdd-run <target> --assume`. El menú `sdd-run con subagente` de `sdd-spec` hace exactamente lo mismo. La doctrina se escribe una vez en `claude/sdd-run` y `sdd-spec` la referencia.
2. **Recomendado derivado de la spec**, no fijo.
3. **Flags.** `--model M` y `--effort E` fijan cada valor sin preguntar. Lo que falte se pregunta (interactivo) o se deriva (`--assume`).
4. **Flags sueltos implican `--subagent`.** `--model` o `--effort` sin `--subagent` equivalen a pasarlo.
5. **Señales de derivación:** cantidad de CAs y capas del `## Plan de entrega` mueven el escalón. La verificabilidad no lo mueve (ver 7).
6. **Umbrales del modelo.** Escalón = el mayor que proponga cualquier señal. CAs hasta 10 → `sonnet`; 11 a 16 → `opus`; 17 o más → `fable`. 2 o más capas → al menos `opus`.
7. **Verificabilidad solo avisa.** Junto al recomendado el skill imprime cuántos CAs son MEDIA, BAJA o NULA, para subir a mano. No pone piso.
8. **Effort recomendado: `xhigh` siempre.** No depende del escalón. Reemplaza la escalera medium/high/xhigh elegida en una ronda anterior.
9. **Effort se elige aparte del modelo.** Una sola llamada a `AskUserQuestion` con dos preguntas: modelo (`sonnet` / `opus` / `fable` / modelo de la sesión, el recomendado primero y marcado `(Recomendado)`) y effort (`medium` / `high` / `xhigh` / `max`, con `xhigh` primero). "Other" cubre `haiku` o `low`.
10. **"Modelo de la sesión"** es la cuarta opción de modelo: no se pasa `model` al `Agent`; `effort` sí se pasa siempre.
11. **Desatendido.** `--subagent --assume` sin flags usa el recomendado derivado sin preguntar e imprime el escalón y la señal que lo decidió.
12. **Traza.** La sesión imprime modelo, effort, escalón y señal al lanzar y al relevar el PR. El prompt del `implementer` le pide incluir la línea `subagente: <modelo> · <effort>` en su reporte `Run completo`. El body del PR no cambia.
13. **Solo Claude.** Pi, Codex y opencode no cambian.

## Ramas pendientes

- Pi: elegir modelo al correr con subagente (la tool ya acepta `model`); thinking exigiría extender la extensión `subagent`.
- Línea de traza en el body del PR (descartada por ahora).

## Handoff

### Tema y alcance

En Claude Code, correr una spec con el subagente `implementer` permite elegir modelo y effort, con un recomendado derivado de la spec. Entra `claude/sdd-run/SKILL.md`, la sección Claude de `claude/sdd-spec/SKILL.md`, sus gates (`harness-gate`, `agents-gate`) y docs (README, descripciones del plugin si corresponde). No entran Pi, Codex ni opencode.

### Hechos comprobados

Ver la sección homónima de arriba.

### Decisiones resueltas

Ver la sección homónima de arriba (1 a 13).

### Restricciones y no-objetivos

- La doctrina nueva va fuera de los bloques compartidos entre harnesses (`sdd-spec-flow`, `sdd-run-flow`, `sdd-run-stack`, `sdd-run-dirty-checkout`) y fuera de la Fase 2 de `sdd-run`, para no romper `harness-gate` ni `agents-gate` CA-12. En `sdd-spec` va en el párrafo específico de Claude (hoy `claude/sdd-spec/SKILL.md:204`), que debe seguir cumpliendo el gate actual (`subagent_type: "implementer"`, `run_in_background`, fallback `general-purpose` anunciado, `--assume`).
- Los agentes siguen sin `model` ni `effort` en frontmatter: todo por parámetro de invocación.
- La sesión que lanza con `--subagent` es lanzadora, no corredora: no ejecuta fases, no abre worktree. El ownership del run es del `implementer`, como ya dice `claude/sdd-run/SKILL.md:111`. La redacción tiene que evitar contradecir "NO delegar completar toda la spec", que aplica al agente que corre, no al lanzador.
- Con `--subagent` no hay oferta post-PR en la sesión lanzadora: el `implementer` corre con `--assume`. Al llegar la notificación del subagente, la sesión releva PR y reporte, con la traza de la decisión 12.
- No se implementan subagentes nuevos ni se tocan `agents/*.md`, Pi, Codex, opencode ni el body del PR.
- codex/opencode `sdd-run` y `sdd-spec` no deben ganar `subagent_type` (gate `harness-gate:646`).

### Supuestos explícitos

- `effort` pasado al `Agent` rige al subagente sin otro default que lo pise. Verificable con la doc de Claude Code (subagente `claude-code-guide`).
- Dentro del `implementer` en background, `sdd-run` quizás no puede lanzar `Explore` y explora inline. Inferencia heredada del grill #45, sin smoke.
- Los CAs se cuentan por ids únicos `CA-N` en los headings de `## Comportamiento esperado`, con fallback a las filas `| CA-N |` de `## Plan de verificacion` en specs viejas. Las capas se cuentan como filas numeradas de la tabla de `## Plan de entrega` (ausente = 1 capa). La verificabilidad se lee buscando MEDIA, BAJA y NULA en `## Verificabilidad`.

### Riesgos y preguntas diferidas

- El conteo de CAs depende del formato de la spec; una spec con formato libre puede derivar mal. Mitigación: imprimir el conteo y la señal junto al recomendado, siempre.
- `--model` toma los alias de la tool `Agent` (`sonnet`, `opus`, `fable`, `haiku`). Alinear el formato `M` con el de `sdd-review-loop` (`--model M`) queda para la spec.
- La disponibilidad de `effort` en la tool `Agent` depende de la versión de Claude Code; es doctrina, sin gate de runtime. Si la tool no acepta `effort` en una instalación, anunciarlo y lanzar sin él.
- El schema de `Agent` pide pasar `effort` solo si un skill lo pide explícitamente: el SKILL.md tiene que decirlo con esas palabras.

### Bloques pendientes para futuras sesiones

- Pi: elegir modelo con `sdd-run con subagente` (la tool acepta `model`); thinking exigiría extender `pi-extensions/subagent/`.
- Traza en el body del PR.

### Contexto recomendado para la sesión que escriba la spec

- `claude/sdd-run/SKILL.md`: `## Argumentos` (`:20-26`), Fase 0 (`:48-66`), `### Ownership y tareas` (`:109-115`), Fase 6 paso 2 (`:188-189`), `## MUST DO` / `## MUST NOT DO`.
- `claude/sdd-spec/SKILL.md:193-204` (menú final y párrafo Claude) y `pi/sdd-spec/SKILL.md:231-239` como contraste de la capa Pi.
- `claude/sdd-review-loop/SKILL.md:17-45,66` como modelo de flags, wizard con `(Recomendado)` y "modelo de la sesión".
- `pi-extensions/harness-gate/harness-gate.test.ts:95-130,589-650` y `pi-extensions/agents-gate/agents-gate.test.ts:449-470,517-525` (gates que hay que mantener verdes y extender).
- `.sdd/specs/subagentes-claude.md` (CA-6, no-objetivo `:88`) y `.sdd/grills/2026-09-22-sdd-menos-friccion.md` (decisiones 9 y 17).
- README fila de `sdd-run` y `sdd-spec`; `docs/harness-interaction-differences.md`; `evals/` si se agrega un caso de triggering para `--subagent`.
- `.sdd/project.md`: fila `gate anti-drift SDD`, `gate anti-drift de agentes de plugin` y `lint de frontmatter` como comandos de verificación.
