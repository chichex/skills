# Spec — Router de modelos por skill para Pi
<!-- Generada por /skill:sdd-spec el 2026-07-18. Fuente: pedido libre confirmado en conversación. Estado: implementada -->
<!-- SDD-Tracking: issue=none; grill=none -->

## Contexto
Pi carga las skills como instrucciones dentro del agente actual y no expone eventos `skill_start`/`skill_end`. Las invocaciones explícitas sí atraviesan el evento `input` antes de expandirse, mientras que una skill elegida automáticamente se vuelve observable cuando el modelo lee su `SKILL.md`. El repo ya distribuye extensiones Pi desde `pi-extensions/` mediante `install.sh`; `pi-extensions/inline-skill-autocomplete/` demuestra el patrón de extensión con lógica pura testeable y adaptador de eventos.

La instalación global usa siete modelos preseleccionados. El catálogo nativo vigente declara 372K para GPT-5.6 mediante `openai-codex`, 1.048.576 para Kimi K3 y 1M para GLM/Qwen. El contrato `.sdd/project.md` verifica tests unitarios y carga integrada, pero no dispone de un harness e2e para TUI, errores reales de proveedor o compactación durante un run.

## Comportamiento esperado

### CA-1 — Configuración versionada y validada — ALTA

Crear `pi-extensions/skill-model-router/` con `index.ts`, `logic.ts`, `config.json` y `logic.test.ts`. `config.json` es la fuente canónica versionada y solo puede referenciar modelos de esta lista preseleccionada:

- `openai-codex/gpt-5.6-sol`
- `openai-codex/gpt-5.6-terra`
- `openai-codex/gpt-5.6-luna`
- `kimi-coding/k3`
- `opencode-go/glm-5.2`
- `opencode-go/kimi-k3`
- `opencode-go/qwen3.7-max`

Cada candidato declara `provider`, `id` y `thinkingLevel` por separado; no se parsean IDs ambiguos desde un string. Al cargar una sesión, la extensión valida modelos, niveles y perfiles contra `ctx.modelRegistry` y, cuando exista `enabledModels` en `~/.pi/agent/settings.json`, advierte si el archivo dejó de ser subconjunto de esa preselección. Un candidato inexistente o sin credenciales se salta. Una skill sin entrada o con política `inherit` no cambia el modelo actual.

La matriz inicial es:

| Perfil | Prioridad | Cadena ordenada |
|---|---:|---|
| `critical` | 100 | Sol `max` → Kimi Coding K3 `max` → Qwen3.7 Max `high` |
| `discovery` | 80 | Kimi Coding K3 `max` → Sol `max` |
| `standard` | 60 | Terra `max` → Kimi Coding K3 `max` |
| `safe-ops` | 50 | Terra `high` → Kimi Coding K3 `max` → GLM-5.2 `high` |
| `light` | 40 | Qwen3.7 Max `high` → Terra `max` → Kimi Coding K3 `max` |
| `utility` | 20 | Luna `high` → GLM-5.2 `high` |

| Skill | Política inicial |
|---|---|
| `code-review` | `critical` |
| `grill` | `critical` |
| `issue-triage` | `critical` |
| `sdd-init` | `discovery` |
| `sdd-spec` | `standard`, con override `light|standard|critical` |
| `sdd-run` | `standard`, con override desde la spec |
| `repo-clean` | `safe-ops` |
| `find-skills` | `utility` |
| `domain-modeling` | hereda dentro de otra ruta; standalone `standard` |
| `github-issue-selector` | siempre hereda |

`opencode-go/kimi-k3` no forma parte de la cadena cognitiva inicial: es la misma familia K3 por otra ruta y queda disponible para una futura política explícita de redundancia de infraestructura.

### CA-2 — Invocación explícita y automática — ALTA para lógica; NULA para integración real

- Ante `/skill:<nombre>` enviado con el agente idle, seleccionar el primer candidato utilizable antes de la primera request del agente.
- Detectar también una invocación inline que después será promovida por `inline-skill-autocomplete`, sin depender del orden de carga entre extensiones.
- Si el mensaje se encola mientras el agente trabaja, no cambiar el modelo del trabajo actual: guardar la intención y aplicarla cuando empiece el mensaje expandido correspondiente.
- Reconocer bloques expandidos mediante `parseSkillBlock`/contenido equivalente en `message_start`.
- Para selección automática, construir el mapa de paths desde `pi.getCommands()` y detectar un `read` cuyo path canónico coincide exactamente con el `SKILL.md`. La primera respuesta sigue usando el modelo previo; el nuevo modelo se aplica a la siguiente request.
- Una lectura desconocida, un path parecido o una skill sin configuración no cambia el modelo.

### CA-3 — Estado del run, nesting y control manual — ALTA para lógica; NULA para integración real

La primera ruta aplicada guarda modelo y thinking originales y se vuelve propietaria del run. Las detecciones automáticas anidadas solo pueden reemplazarla por un perfil de prioridad superior; nunca degradan ni hacen sidegrade. `domain-modeling` hereda cuando ya existe una ruta. Una llamada confirmada a la tool `route_skill` puede reemplazar explícitamente la ruta sin respetar esa restricción de prioridad.

Los cambios internos se marcan para distinguirlos de `model_select`. Si el usuario usa `/model` o Ctrl+P durante el run, su elección gana: se suspende routing, fallback y restauración automática hasta el próximo run. Sin override manual, `agent_settled` restaura exactamente modelo y thinking originales. No existe estado activo después de `agent_settled`.

### CA-4 — Perfil downstream decidido por triage — ALTA para contrato textual y lógica; NULA para conducta del modelo

Registrar una tool `route_skill` que acepte exclusivamente:

```text
targetSkill: nombre de skill instalada
profile: light | standard | critical
reason: explicación breve y visible
```

No acepta provider/model IDs arbitrarios. Modificar `pi/issue-triage/SKILL.md` para clasificar el perfil downstream con gates auditables:

- `light`: outcome claro, confianza alta, patrones existentes, bajo riesgo y verificación determinista; puede haber varios criterios/seams que justifiquen spec aunque no quick-run.
- `critical`: seguridad/auth/privacidad, datos o migraciones, concurrencia, contratos públicos, blast radius transversal o verificación débil/nula.
- `standard`: todo caso intermedio cuyo outcome está claro.

El diagnóstico visible agrega `Perfil downstream`, `Modelo resultante` y `Motivo`. La confirmación existente de la ruta confirma también ese perfil; no se agrega una segunda pregunta. Recién después de confirmar, triage llama `route_skill` antes de cargar `sdd-spec` o `grill`. Si la tool no está disponible, avisa y continúa con el modelo actual; nunca simula que el cambio ocurrió.

Invocaciones directas de `sdd-spec` usan `standard`; `--assume` usa `critical`; `--from-grill` usa `standard` salvo override explícito ya confirmado.

### CA-5 — Perfil persistente de ejecución SDD — ALTA para marker y lógica; NULA para conducta del modelo

Modificar `pi/sdd-spec/SKILL.md` para decidir y mostrar un perfil de ejecución junto al veredicto de verificabilidad:

- `light`: alcance acotado, sin riesgos duros y CAs mayormente ALTA con mecanismos deterministas.
- `critical`: cualquier riesgo duro del gate de triage, alcance transversal o CAs materiales BAJA/NULA.
- `standard`: resto de las specs ejecutables.
- Con `--assume`, ante duda se elige `critical`.

El perfil se confirma junto con el mecanismo de verificación y se persiste en la spec mediante:

```html
<!-- SDD-Execution-Profile: light|standard|critical -->
```

Modificar `pi/sdd-run/SKILL.md` para leer el marker después de resolver la spec y llamar `route_skill` antes de planificar o editar. Si falta el marker, usa `standard`. Un test rojo, timeout o CA fallido no escala modelos automáticamente; la escalación solo proviene del marker confirmado, `route_skill` o un cambio manual del usuario.

### CA-6 — Fallback técnico acotado y compatible — ALTA para lógica; NULA para error real de proveedor

Ante `message_end` de assistant con error técnico elegible, avanzar una sola vez al siguiente candidato utilizable antes del retry siguiente. Son elegibles los errores transitorios reconocidos por Pi y errores inequívocos de autenticación/cuota que pueden resolverse cambiando de proveedor. Para estos últimos se permite exactamente una continuación explícita con el fallback porque Pi no los reintenta nativamente.

No disparan fallback:

- `aborted` por el usuario;
- context overflow, que se deriva a compactación de Pi;
- tool errors;
- `length`;
- tests rojos;
- una respuesta subjetivamente mediocre;
- errores de request no clasificados con seguridad.

Cada candidato se intenta como máximo una vez por incidente. Antes de seleccionar Qwen o GLM, inspeccionar el branch activo: si contiene imágenes, saltarlos porque son text-only. Si se agota la cadena, intentar restaurar el modelo original solo cuando sea distinto de los fallidos y tenga credenciales; permitir una única continuación. Si tampoco es utilizable, dejar el error visible y terminar sin loops.

### CA-7 — Protección de contexto al rutear — ALTA para umbrales/lógica; NULA para compactación real

No modificar nuevamente los `contextWindow` nativos. Mientras exista una ruta activa, calcular el mínimo contexto de sus candidatos utilizables. Con la configuración inicial es 372.000; usando `reserveTokens: 32768`, el soft-cap es 339.232 tokens.

- En `turn_end`, si se cruza el soft-cap y no hay compactación ya solicitada, llamar `ctx.compact()` una vez.
- Antes de cambiar a un target cuyo `contextWindow - 32768` sea menor que el uso actual, diferir el cambio, compactar y aplicarlo solo desde `onComplete`.
- Con input idle, preservar y reenviar exactamente texto e imágenes después de compactar.
- Durante un run, no ejecutar simultáneamente cambio, retry y compactación: la máquina de estados debe serializar esas acciones.
- Si compactación falla o se aborta, conservar el modelo actual, limpiar el pending switch y avisar; no forzar una request que no entra.

No se generan cientos de miles de tokens para probar este criterio.

### CA-8 — Observabilidad sin contaminar el contexto — ALTA para lógica/render; NULA para TUI real

Registrar `/skill-models` para mostrar como mínimo:

- modelo y thinking actuales;
- skill propietaria y perfil;
- cadena y candidato activo;
- modelo original;
- uso de contexto, target y soft-cap;
- pending switch/compaction/fallback;
- warnings de configuración.

Mostrar un status compacto mientras haya ruta activa. Persistir eventos `route`, `switch`, `fallback`, `manual-override`, `restore`, `compaction-request` y `chain-exhausted` con `pi.appendEntry`; son auditoría TUI/session y nunca entran al contexto del LLM. No persistir secretos, API keys, prompts ni contenido de errores que pueda incluir datos sensibles; guardar solo categoría y modelo.

### CA-9 — Distribución, documentación y compatibilidad — ALTA para archivos; BAJA para instalación

`install.sh` no necesita lógica nueva: ya copia directorios completos desde `pi-extensions/`. Actualizar `README.md` y `README.en.md` con la nueva extensión, perfiles, `/skill-models`, regla de fallback y necesidad de `/reload`. La extensión debe cargar junto a los nueve entrypoints actuales sin colisiones ni errores.

No modificar las versiones Claude/opencode de las skills; este router y los cambios de workflow son exclusivos de Pi.

### CA-10 — Protocolo humano de integración — NULA

Después de implementar, una persona debe validar en una sesión Pi nueva:

1. Elegir manualmente un modelo distinto y ejecutar una skill explícita configurada; comprobar que cambia antes de responder y que `/skill-models` muestra owner/perfil.
2. Pedir una tarea en lenguaje natural que active una skill; comprobar que la primera respuesta usa el modelo previo y la siguiente, después del `read SKILL.md`, usa la ruta.
3. Ejecutar `github-issue-selector` o una skill no configurada y comprobar que hereda.
4. Durante una skill routeada, cambiar modelo manualmente y comprobar que el router no lo revierte al terminar.
5. En una copia temporal del config instalado, poner un ID inexistente como primer candidato, `/reload`, ejecutar la skill y comprobar que salta al fallback sin request al ID inválido; restaurar el config inmediatamente.
6. Ejecutar `/skill-models` sin ruta activa y con ruta activa; comprobar estado y auditoría.
7. Confirmar desde un triage de prueba que el perfil downstream aparece antes del gate y que la ruta confirmada cambia al modelo correspondiente.

No se prueba provocando 429/5xx reales ni inflando el contexto a 339K.

## Fuera de alcance

- Router equivalente para Claude Code u opencode.
- Benchmark de calidad, costo o latencia de los modelos.
- Detectar automáticamente que una respuesta fue “mala”.
- Escalar por tests fallidos o por cantidad de intentos de implementación.
- Cambiar límites nativos de contexto o reintroducir overrides en `models.json`.
- E2E automatizado con proveedor falso en esta primera versión.
- Provocar errores reales de proveedor o consumo masivo de tokens para verificar.
- Selector visual para editar perfiles/configuración desde TUI.
- File watcher del config; se recarga con una nueva sesión o `/reload`.
- Persistir una ruta activa entre runs ya asentados.

## Inferencias

| # | Inferencia | Elección propuesta | Alternativa razonable | Confianza | Resolución |
|---|---|---|---|---|---|
| 1 | Ubicación de la matriz | `config.json` versionado junto a la extensión | Archivo global fuera del repo | alta | confirmada por usuario |
| 2 | Skills anidadas | Ruta sticky; solo upgrades automáticos | Última skill siempre gana | media | confirmada por usuario |
| 3 | Cambio manual de modelo | El usuario suspende router/restauración | El router vuelve a imponer la ruta | alta | confirmada por usuario |
| 4 | Protección 1M → 372K | Soft-cap 339.232 durante rutas activas | Compactar solo al cambiar | media | confirmada por usuario |
| 5 | Errores de fallback | Técnicos + una continuación para auth/cuota | Solo retryables nativos | media | confirmada por usuario |
| 6 | Cadena agotada | Probar modelo original si todavía sirve | Bloquear siempre | media | confirmada por usuario |
| 7 | Perfil para `sdd-run` | Marker dentro de la spec | Estado efímero | alta | confirmada por usuario |
| 8 | Escalación por tests | Nunca automática | Escalar tras varios intentos | alta | confirmada por usuario |
| 9 | Observabilidad | Comando, status y auditoría fuera de contexto | Solo notificaciones | media | confirmada por usuario |
| 10 | Alcance inicial | Solo Pi; sin e2e real de proveedor | Otros harnesses/harness falso | alta | confirmada por usuario |

## Verificabilidad

Verificabilidad **MIXTA**:

- CA-1 y las máquinas de estado de CA-2, CA-3, CA-4, CA-5, CA-6, CA-7 y CA-8: **ALTA** mediante tests unitarios deterministas.
- CA-9: **BAJA**; el smoke prueba imports/registro, no orden real de eventos.
- Integración real contenida en CA-2..CA-8 y protocolo CA-10: **NULA** con el harness actual; requiere prueba humana.

Sería posible elevar la integración a ALTA/MEDIA agregando un harness SDK con proveedor falso, pero quedó explícitamente fuera de alcance para esta versión.

## Plan de verificacion

Mecanismo confirmado: **unitarios + smoke + protocolo humano**.

### Unitarios deterministas

Implementar primero tests rojos en `pi-extensions/skill-model-router/logic.test.ts` y, si conviene separar parsing/config, archivos `*.test.ts` hermanos. Ejecutar:

```bash
node --test pi-extensions/*/*.test.ts
```

Cubrir como mínimo:

- config válida/inválida, modelos no preseleccionados y candidatos no disponibles;
- skill explícita idle, inline y encolada;
- skill automática por path exacto/canónico;
- skill no configurada e `inherit`;
- prioridades, nesting, override explícito y override manual;
- captura/restauración de modelo y thinking;
- perfiles directos de `sdd-spec` y marker de `sdd-run`;
- clasificación de errores, máximo un intento, agotamiento y modelo original;
- imágenes que excluyen Qwen/GLM;
- cálculo 372000 − 32768, cruce único, switch diferido, éxito/falla de compaction;
- sanitización de auditoría.

Agregar tests estáticos que lean `config.json`, `pi/issue-triage/SKILL.md`, `pi/sdd-spec/SKILL.md` y `pi/sdd-run/SKILL.md` para comprobar perfiles/markers/tool contract sin depender del modelo.

### Smoke integrado

```bash
args=()
for extension in pi-extensions/*.ts pi-extensions/*/index.ts; do
  [ -f "$extension" ] && args+=(--extension "$extension")
done
pi "${args[@]}" --list-models
```

Debe terminar con exit code 0 y cargar todos los entrypoints. Completar con:

```bash
bash -n install.sh
git diff --check
```

### Prueba humana

Ejecutar el protocolo de CA-10 después de `./install.sh pi` y `/reload`, sin provocar fallos pagos ni consumir contexto artificialmente. Registrar cada paso como PASS/FAIL/NO EJECUTADO en el Resultado de ejecución de esta spec.

## Riesgos y gaps

- Pi no ofrece lifecycle de skill; la detección automática depende de que el modelo lea el `SKILL.md` publicado por `pi.getCommands()`.
- `ctx.compact()` es asíncrono y puede interactuar con retry/turn lifecycle; el reducer debe impedir carreras, pero el orden real queda pendiente de prueba humana.
- `pi.setModel()` persiste cambios de modelo/default; una falla durante restauración puede dejar el modelo routeado activo y debe quedar visible.
- `model_select` con source `set` sirve tanto para extensión como para `/model`; hace falta una guarda interna precisa para distinguirlos.
- Qwen3.7 Max y GLM-5.2 son text-only y deben excluirse ante cualquier imagen activa.
- Los IDs y capacidades dependen del catálogo de Pi; `/skill-models` debe advertir drift sin bloquear skills no configuradas.
- La continuación explícita tras auth/cuota es deliberadamente única para evitar loops o duplicación de tool side effects.
- No existe e2e automático para el orden real de eventos; CA-10 requiere humano.
- El checkout tenía cambios locales preexistentes en `pi/issue-triage/SKILL.md` antes de esta spec. Además, `.sdd/project.md`, esta spec, `AGENTS.md` y `CLAUDE.md` son nuevos. `/skill:sdd-run` abortará hasta que todo trabajo que deba conservarse esté commiteado y el checkout quede limpio; no descartar nada para forzarlo.

## Resultado de ejecucion (2026-07-18)

| CA | Estado | Evidencia |
|---|---|---|
| CA-1 | verificado | `node --test pi-extensions/*/*.test.ts`: 28/28 verdes; matriz, preselección, perfiles, niveles, `enabledModels`, credenciales e `inherit` cubiertos. |
| CA-2 | lógica verificada; pendiente humano | Unitarios verdes para invocación idle/inline/encolada, bloque expandido y read por path canónico exacto. Orden real de eventos Pi: NO EJECUTADO (protocolo 1–3). |
| CA-3 | lógica verificada; pendiente humano | Unitarios verdes para owner, prioridades, nesting, `route_skill`, override manual y restauración exacta. Interacción `/model`/Ctrl+P real: NO EJECUTADO (protocolo 4). |
| CA-4 | contrato/lógica verificados; pendiente humano | Tests estáticos verdes sobre `pi/issue-triage/SKILL.md` y schema cerrado de `route_skill`; override de prioridad cubierto. Conducta del modelo en triage: NO EJECUTADO (protocolo 7). |
| CA-5 | marker/lógica verificados; pendiente humano | Parser default `standard`, persistencia textual del marker y llamada previa de `sdd-run` cubiertos por unitarios/estáticos. Cambio real de modelo desde una spec: NO EJECUTADO. |
| CA-6 | lógica verificada; pendiente humano | Clasificación, un candidato por error, máximo un intento, auth/cuota, imágenes, agotamiento y original cubiertos; continuación tras compactación serializada. No se provocaron errores pagos reales, por diseño. |
| CA-7 | umbrales/lógica verificados; pendiente humano | Unitarios verdes para `372000 - 32768 = 339232`, mínimo de cadena, cruce único, switch diferido, replay exacto y falla de compactación. No se infló contexto ni se ejecutó compactación real. |
| CA-8 | lógica/render verificados; pendiente humano | Unitarios verdes para diagnóstico, status y sanitización; smoke carga comando/tool/renderer. TUI y auditoría visibles: NO EJECUTADO (protocolo 6). |
| CA-9 | verificado | Smoke conjunto: 10 entrypoints, 57 modelos y exit 0; `README.md`/`README.en.md` cubiertos; `bash -n install.sh` y ambos diff checks verdes. No se ejecutó instalación global, según el contrato. |
| CA-10 | pendiente humano | Los siete pasos quedan NO EJECUTADOS; no se corrió `./install.sh pi` sin autorización. |

### Protocolo humano CA-10

| Paso | Estado |
|---:|---|
| 1. Skill explícita cambia antes de responder y `/skill-models` muestra owner/perfil | NO EJECUTADO |
| 2. Selección automática conserva la primera respuesta y cambia después del read | NO EJECUTADO |
| 3. `github-issue-selector` o skill no configurada hereda | NO EJECUTADO |
| 4. Override manual durante una ruta no se revierte al terminar | NO EJECUTADO |
| 5. Candidato inexistente se salta y luego se restaura el config | NO EJECUTADO |
| 6. `/skill-models` y auditoría se ven sin ruta y con ruta | NO EJECUTADO |
| 7. Triage muestra/confirma perfil y cambia al modelo correspondiente | NO EJECUTADO |
