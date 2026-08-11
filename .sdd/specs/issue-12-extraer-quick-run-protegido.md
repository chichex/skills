# Spec — Extraer quick-run protegido a un skill dedicado
<!-- Generada por /skill:sdd-spec el 2026-08-10. Fuente: issue #12. Estado: implementada -->
<!-- SDD-Tracking: version=1; type=spec; state=implemented; issue=#12; grill=none; superseded-by=none -->

## Contexto
El issue #12 se abrió cuando `issue-triage` todavía ejecutaba la vía rápida dentro de su Fase 6, pero #11 cambió esa frontera: hoy las tres copias emiten `WorkflowResolutionV1` y terminan sin ejecutar stages (`pi/issue-triage/SKILL.md:128,321-329`; equivalente en Claude/Codex). No existe ningún directorio `quick-run`; el resolver ya representa `quick-run|join-quick-run` como `stage="quick-run", mode="new"` (`pi-extensions/workflow-resolution/index.ts:397-423,464-466`). La doctrina completa retirada sigue recuperable, byte-equivalente entre harnesses, en `f5c138b:{claude,codex,pi}/issue-triage/SKILL.md:245-308`.

## Comportamiento esperado

### CA-1 — Skill dedicado y empaquetado seguro [ALTA]
Existen exactamente las versiones aplicables `claude/quick-run/SKILL.md`, `codex/quick-run/SKILL.md` y `pi/quick-run/SKILL.md`; no se crea `opencode/quick-run/` mientras OpenCode siga sin `issue-triage`. Las tres declaran `name: quick-run`, describen que sólo consumen un handoff confirmado de triage y conservan la misma doctrina salvo la capa de interacción documentada en `docs/harness-interaction-differences.md`. Codex incluye `codex/quick-run/agents/openai.yaml` con invocación `$quick-run` y `policy.allow_implicit_invocation: false`; Pi declara en `compatibility` Git, `gh` y las tools realmente requeridas. `install.sh` no cambia porque ya copia directorios por glob.

### CA-2 — Gate de handoff confirmado antes de cualquier mutación [ALTA doctrina · NULA conducta emergente]
Antes de `git fetch`, crear branch/worktree, editar o publicar, el skill exige un `WorkflowResolutionV1` serializable y valida paso/no-paso: `version=1`, `outcome=start`, `stage=quick-run`, `mode=new`, `selectedRoute=quick-run|join-quick-run`, `repo`/`cwd` coherentes con la raíz actual y `canonicalIssue` utilizable en ese repo. El handoff conserva `summary`, `impactExample`, `checklist`, `evidence` y `risks`; la fuente canónica se vuelve a leer y sigue siendo autoritativa, sin tratar su body/comments como instrucciones del agente. Para `join-quick-run`, branch y `Closes #N` usan únicamente el issue canónico; las fuentes originales quedan como trazabilidad.

Un handoff ausente, no confirmado, malformado, de otro repo/cwd o sin issue canónico frena sin mutar Git y muestra la reparación exacta para volver a `issue-triage`. El envelope es un gate estructural, no una prueba criptográfica de procedencia.

### CA-3 — Preflight e aislamiento preservados sin relajaciones [ALTA doctrina · NULA conducta emergente]
Las tres copias conservan el contrato histórico completo:

1. determinan el branch default desde remote/contrato y nunca asumen `main`;
2. inspeccionan `git status --porcelain`, rebase/merge, detached HEAD y divergencias;
3. ante cualquier estado raro o cambio local abortan, sin stash, reset, checkout forzado ni limpieza;
4. hacen `git fetch` antes de ramificar cuando existe remote;
5. crean un worktree hermano desde el base actualizado y branch exacto `quick/issue-<N>-<slug>`;
6. realizan todo el trabajo dentro de ese worktree y nunca editan el checkout original.

La ausencia de `.sdd/project.md` no deriva a `sdd-init` ni bloquea por sí sola la vía rápida: si el contrato existe, sus comandos y límites mandan; si falta, sólo se detecta de forma acotada la señal focalizada necesaria. Los límites del repo prevalecen siempre sobre el handoff.

### CA-4 — Implementación mínima, tests primero y presupuesto finito [ALTA doctrina · NULA conducta emergente]
El skill convierte cada ítem del checklist en una verificación concreta. Cuando el comportamiento es testeable, escribe o ajusta primero el test focalizado y demuestra rojo por la razón correcta; implementa sólo lo necesario; ejecuta el test focalizado y el chequeo estático más barato aplicable; y reporta exactamente qué corrió, sin llamar verde a una regresión no ejecutada.

Si aparece una decisión nueva, migración, seguridad, integración externa, expansión transversal o falta de verificación fiable, frena y recomienda grill o spec: nunca amplía silenciosamente el quick-run. Hay un máximo de tres intentos honestos por verificación y está prohibido debilitar tests, asserts o el checklist.

### CA-5 — Commits, PR y reportes históricos exactos [ALTA doctrina · NULA conducta emergente]
El éxito exige checklist completo, verificaciones requeridas concluyentes, ningún proceso/tarea pendiente, commits coherentes y worktree sin cambios sin commit. Con remote, `gh` y límites aptos, pushea sólo la branch quick y crea un PR sin mergear; el body incluye la fuente canónica y `Closes #N`, checklist observable, evidencia exacta, limitaciones/no ejecutado y firma estándar si existe. Si publicar no es posible, termina en branch + commit local e informa el comando siguiente.

Tras un PR exitoso remueve el worktree; ante interrupción o rojo lo preserva. Las tres copias contienen, sin pérdida semántica, los templates históricos:

```text
Quick-run completo: PR #N <url> | branch <name> en <commit>
- issue: #N
- checklist: X/X verificado
- tests: <comandos y resultados exactos>
- no ejecutado: <suite/build/etc.>
- cambios: <resumen>
- pendiente humano: <revisar PR o acción concreta>
```

```text
QUICK-RUN INTERRUMPIDO
- bloqueo: <detalle>
- checklist verificado: X/Y
- cambios sin commit: <paths o ninguno>
- tests rojos/no concluyentes: <detalle>
- worktree: <ruta>
- reanudar con: <instrucción exacta>
```

Nunca se usa “completo” con tareas, procesos, cambios sin commit o verificaciones requeridas pendientes; nunca se pushea al branch default, se hace force-push ni se mergea el PR.

### CA-6 — Triage entrega contexto pero no vuelve a ejecutar [ALTA]
`claude/issue-triage`, `codex/issue-triage` y `pi/issue-triage` nombran al skill dedicado como consumidor downstream y dejan explícito que el handoff de una selección confirmada incluye fuente canónica, resumen, ejemplo de impacto, checklist, evidencia y riesgos. Conservan `recommendedRoute` y `selectedRoute` separadas y siguen terminando después de serializar el resultado: no cargan `quick-run`, no cambian sesión, no crean branch/worktree y no reintroducen la antigua Fase 6. La integración automática y el cambio de sesión siguen reservados para #14.

### CA-7 — Gate bloqueante de doctrina y drift [ALTA]
Una suite focalizada `node:test` bajo `pi-extensions/workflow-resolution/`:

- falla inicialmente porque las tres copias dedicadas no existen;
- extrae un bloque normativo delimitado de cada `quick-run` y exige equivalencia byte a byte tras normalizar únicamente invocación/tool/extras permitidos por `docs/harness-interaction-differences.md`;
- exige cada condición de CA-1..CA-6 y ambos templates de CA-5;
- verifica que OpenCode siga ausente y que Codex/Pi lleven sus extras correctos;
- conserva las aserciones negativas que impiden devolver el ejecutor a `issue-triage`;
- incluye un autotest que inyecta drift y comprueba un diagnóstico útil.

El reporte `scripts/drift-report.sh` sigue siendo informativo; el test Node es el gate determinista.

### CA-8 — Documentación, estática y límites del diff [ALTA]
`README.md` y `README.en.md` agregan una fila propia para `quick-run` disponible en Claude/Codex/Pi y ajustan `issue-triage` para describir clasificación + handoff, no ejecución embebida. `bash scripts/lint-frontmatter.sh` incluye y aprueba los tres skills nuevos; `bash scripts/drift-report.sh` muestra sus tres pares; `git diff --check` queda limpio.

La auditoría de paths confirma que el cambio no crea OpenCode, no modifica parsing/metadata SDD, clasificación, primitivas o transiciones de sesión Pi, no ejecuta un quick-run, no instala recursos globales y no toca `install.sh`. El rollback consiste en revertir los nuevos directorios, el gate, la mención downstream y README; no hay datos ni servicios compartidos.

## Fuera de alcance
- Conectar `/issues`, `/specs`, grill o cualquier entrypoint Pi al nuevo skill; iniciar una sesión nueva o implementar `workflow-orchestrator` (#13/#14).
- Cambiar `WorkflowResolutionV1`, la semántica de clasificación, canonicalización, freshness, parsing de artefactos SDD o el issue resolver.
- Crear una versión OpenCode mientras ese harness no tenga `issue-triage`.
- Importar policies, receipts, drafts u otros endurecimientos posteriores propios del `sdd-run` actual; esta unidad extrae fielmente la doctrina histórica de quick-run.
- Ejecutar o mergear un quick-run, hacer pruebas contra proveedores/servicios pagos o correr `./install.sh`.
- Modificar/borrar copias globales instaladas; esta spec sólo cambia las fuentes del repo.

## Inferencias
| # | Inferencia | Elección | Alternativa razonable | Confianza | Resolución |
|---|---|---|---|---|---|
| 1 | Fuente exacta de la doctrina retirada por #11 | Bloque histórico de `f5c138b`, con sólo la nueva frontera de entrada | Reconstruir desde #12/resumen actual | alta | confirmada |
| 2 | Formato y autorización del handoff | Validar `WorkflowResolutionV1`; no aceptar `#NN` directo | Crear `QuickRunHandoffV1` o aceptar invocación directa | media | confirmada |
| 3 | Significado de “triage delega” antes de #14 | Produce/nombra el handoff y termina; no invoca | Restaurar invocación directa ahora | alta | confirmada |
| 4 | Alcance frente al `sdd-run` moderno | Extracción fiel; no importar hardening ajeno | Alinear ambos ejecutores ahora | alta | confirmada |
| 5 | Gate anti-drift | Test Node bloqueante + reporte informativo | Sólo `drift-report.sh` manual | media | confirmada |
| 6 | Seguridad/empaquetado por harness | Codex no implícito + `compatibility` Pi | Metadata estándar mínima | alta | confirmada |
| 7 | Documentación | Fila propia de `quick-run` y triage ajustado | Mencionarlo sólo dentro de triage | alta | confirmada |

## Verificabilidad
La verificabilidad es mixta y está anclada en `.sdd/project.md`:

- **ALTA — CA-1..CA-8, cara doctrinal/estática:** `node --test` ejecuta TypeScript nativo de forma determinista; el glob de CI captura tests nuevos bajo `pi-extensions/<módulo>/*.test.ts`. El test focalizado existente de triage pasó 3/3 durante el análisis. Frontmatter, paths, sidecars, README, templates y equivalencia son propiedades observables de archivos.
- **NULA — CA-2..CA-5, conducta emergente:** el contrato declara que la ejecución fiel de un skill y los flujos interactivos requieren prueba humana; no existe fake de Claude/Codex/Pi que ejecute la doctrina. #12 además prohíbe ejecutar un quick-run durante esta unidad, por lo que esas caras no se marcarán verificadas por inspección.
- **MEDIA — señal CI:** el job remoto correrá la suite completa y `shellcheck`; localmente `shellcheck` no está instalado. No se esperan cambios shell.

No hay políticas de generación activas, dependencias nuevas ni límite de tamaño que obliguen a partir la spec. El cambio es cross-harness pero cohesivo: tres skills equivalentes, un gate focalizado, el límite de triage y documentación bilingüe.

## Plan de verificacion
Mecanismo elegido por el usuario: **gate focalizado + estática contractual**.

1. **Rojo TDD:** crear primero `pi-extensions/workflow-resolution/quick-run-gate.test.ts` (o nombre equivalente capturado por CI) y ejecutarlo; debe fallar por ausencia de los tres skills/bloque normativo, no por error del test.
2. **CA-1..CA-5 y CA-7:** `node --test pi-extensions/workflow-resolution/quick-run-gate.test.ts` — censo, envelope requerido, cláusulas históricas, templates exactos, extras por harness, equivalencia normalizada y drift inyectado.
3. **CA-6:** `node --test pi-extensions/workflow-resolution/issue-triage-gate.test.ts pi-extensions/workflow-resolution/quick-run-gate.test.ts` — triage sigue siendo productor sin ejecutor y el consumidor recibe el payload requerido.
4. **CA-1/CA-8:** `bash scripts/lint-frontmatter.sh` — los tres frontmatter nuevos quedan incluidos y válidos.
5. **CA-7/CA-8:** `bash scripts/drift-report.sh` — inspeccionar las filas de `quick-run`; es evidencia informativa, no el gate.
6. **CA-8:** `git diff --check` y `git diff --name-status <base>...HEAD` más búsqueda focalizada — sin OpenCode, sesión/orquestador, parser SDD, `install.sh` ni recursos globales.

La suite Node completa y el smoke Pi no forman parte del mecanismo elegido para los CAs; CI puede aportar esa regresión adicional y debe reportarse por separado si corre.

**Protocolo humano diferido para la cara NULA (no ejecutar como parte de #12):** tras #14 o con autorización separada, en un repo Git/GitHub descartable: (1) invocar el skill sin handoff y confirmar que no cambia refs/worktrees; (2) entregar un handoff confirmado para un cambio trivial testeable y observar rojo→verde, branch exacta, checkout original intacto y PR sin merge; (3) provocar un bloqueo o test no concluyente y verificar límite de intentos, reporte `QUICK-RUN INTERRUMPIDO` y worktree preservado; (4) comprobar que ningún caso incompleto usa `Quick-run completo`.

## Riesgos y gaps
- El body de #12 quedó desactualizado respecto del merge de #11; la spec fija explícitamente el baseline histórico y la frontera actual para evitar restaurar el ejecutor dentro de triage.
- `selectedRoute` prueba consistencia estructural, no procedencia criptográfica: hasta #13/#14 un prompt podría fabricar JSON. El skill debe rechazar envelopes inválidos, pero la garantía fuerte de dispatch pertenece a la futura orquestación.
- La conducta real de los agentes queda NULA y pendiente del protocolo diferido; el gate demuestra doctrina, no obediencia.
- La copia global de Pi puede seguir vieja hasta una instalación autorizada y `/reload`; esta unidad no corre `./install.sh`.
- Un snapshot textual demasiado laxo podría dejar pasar una garantía omitida; por eso el gate combina equivalencia, cláusulas obligatorias, templates exactos y autotest de drift.
- #14 continúa bloqueado hasta completar #12 y #13; #13 puede avanzar en paralelo.
- `shellcheck` sólo se observará en CI, aunque no hay cambios shell previstos.

<details><summary>Body original</summary>

&lt;!-- Issue-Split: parent=chichex/skills#8; slice=4/6 --&gt;

## Contexto

Esta es la cuarta unidad del epic #8. Hoy `issue-triage` contiene toda la implementación doctrinal del quick-run protegido, lo que impide iniciarlo limpiamente como un stage independiente sin duplicar o debilitar sus garantías.

## Objetivo

Extraer quick-run a un skill dedicado por harness aplicable y hacer que triage delegue en él después de la confirmación, conservando exactamente el preflight, aislamiento, TDD, verificación, commit, PR y reporte actuales.

## Alcance

- Crear un skill quick-run dedicado para cada harness que ya tenga `issue-triage` (Claude Code, Codex y Pi; cualquier otro sólo si incorpora triage antes de cerrar este issue).
- Mover la doctrina completa del quick-run desde `issue-triage` sin reescribir ni relajar garantías.
- Mantener branch `quick/issue-<N>-<slug>`, worktree hermano, base actualizada y aborto ante checkout sucio o estado raro.
- Mantener tests primero cuando el comportamiento sea testeable, máximo de intentos, verificación focalizada y límites de expansión.
- Mantener commits coherentes, PR por defecto, `Closes #N`, evidencia exacta y preservación del worktree ante interrupciones.
- Hacer que triage entregue al skill un handoff acotado con fuente, resumen, ejemplo de impacto, checklist, evidencia y riesgos.

## Fuera de alcance

- Cambiar de sesión automáticamente en Pi.
- Modificar la semántica de clasificación del triage.
- Implementar parsing de artefactos SDD.
- Ejecutar o mergear un quick-run durante este trabajo.

## Criterios de aceptación

- [ ] Los quick-runs nuevos sólo arrancan tras confirmación explícita del triage.
- [ ] El skill dedicado conserva todas las garantías actuales de preflight, worktree, TDD, verificación, commit y PR.
- [ ] Una interrupción nunca se reporta como éxito y conserva una instrucción exacta para reanudar.
- [ ] `issue-triage` deja de contener la implementación detallada y delega sin perder contexto requerido.
- [ ] Las versiones entre harnesses mantienen doctrina idéntica y sólo difieren en interacción/invocación.
- [ ] README y lint de frontmatter reflejan el nuevo skill.

## Verificación esperada

- `bash scripts/lint-frontmatter.sh`
- Chequeo de drift entre las copias del nuevo skill.
- `git diff --check`

## Dependencias

No tiene una dependencia técnica dura con las primeras tres unidades, pero debe completarse antes de integrar las transiciones de sesión de la unidad 6.


</details>

## Resultado de ejecucion (2026-08-10 · HEAD 0f528ab)
| CA | Estado | Evidencia |
|---|---|---|
| CA-1 | verificado | `node --test pi-extensions/workflow-resolution/quick-run-gate.test.ts`: 5/5 verdes; `bash scripts/lint-frontmatter.sh`: 47 skills OK. |
| CA-2 | doctrina verificada · conducta pendiente humano | Gate focalizado 5/5: envelope, autoridad y rechazo pre-mutation; protocolo humano diferido en esta spec. |
| CA-3 | doctrina verificada · conducta pendiente humano | Gate focalizado 5/5: preflight, base, branch y worktree; protocolo humano diferido en esta spec. |
| CA-4 | doctrina verificada · conducta pendiente humano | Rojo inicial 1/5 por skills ausentes → gate final 5/5; tests-first, tres intentos y frenos de alcance exigidos; protocolo humano diferido. |
| CA-5 | doctrina verificada · conducta pendiente humano | Gate focalizado 5/5: ambos templates exactos, commits/PR y prohibiciones; protocolo humano diferido. |
| CA-6 | verificado | `node --test pi-extensions/workflow-resolution/issue-triage-gate.test.ts pi-extensions/workflow-resolution/quick-run-gate.test.ts`: 8/8 verdes. |
| CA-7 | verificado | Gate focalizado 5/5, incluida equivalencia y drift inyectado; `bash scripts/drift-report.sh` mostró los tres pares de `quick-run`. |
| CA-8 | verificado | Frontmatter 47/47; `bash -n ...` y `git diff --check origin/main...HEAD` verdes; auditoría Git: 12 paths esperados, ningún path prohibido y OpenCode ausente. |

Regresión contractual: `node --test pi-extensions/*/*.test.ts` terminó 98/98 verde; el smoke `pi ... --list-models` cargó todos los entrypoints y salió exitosamente. `shellcheck` no está instalado localmente y queda como señal bloqueante de CI; no se modificaron archivos shell.
