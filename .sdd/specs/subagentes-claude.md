# Spec — Subagentes custom `implementer` y `reviewer` para Claude Code
<!-- Generada por /sdd-spec el 2026-09-17. Fuente: pedido libre. Estado: implementada -->
<!-- SDD-Tracking: version=1; type=spec; state=implemented; issue=none; grill=none; superseded-by=none -->

## Contexto

Los skills de este repo delegan trabajo a subagentes sin fijar el tipo de agente: en
`claude/sdd-review-loop/SKILL.md:66` el revisor y el corrector se lanzan con la tool
`Agent` en background y solo reciben `model`, así que el tipo lo elige el harness (en la
práctica, el agente por defecto). El string `general-purpose` no aparece ni una vez en el
repo: introducir tipos custom es **agregar** un parámetro, no reemplazar uno.

Eso importa porque el corrector escribe código de verdad — test de regresión primero
(`:93`), implementación (`:92`), commits y push (`:97`), resolución de threads (`:98`) — y
hoy nada lo obliga a seguir el contrato de autonomía ni las coding policies del proyecto
donde corre. Un subagente hereda `CLAUDE.md`, pero su prompt lo escribe el orquestador en
el momento y sale distinto cada vez. Un subagente custom reemplaza su system prompt
completo por un body fijo, y ahí la doctrina se escribe una sola vez.

Estado del código hoy:

- El plugin `chichex-skills` declara solo `"skills": ["./claude"]` en
  `.claude-plugin/plugin.json:19-21`. No hay ningún directorio de agentes en el repo ni en
  ningún home; `.sdd/grills/2026-09-13-coding-policies.md:16` relevó el soporte por harness
  y cerró con "la decisión final no usa agents". Esta spec revisita esa decisión para otro
  propósito: gobernar la delegación, no distribuir políticas.
- `agents/` ya significa otra cosa dentro de un skill: el sidecar `agents/openai.yaml` de
  Codex, presente en los 17 skills de `codex/`. `.claude/skills/harness-port/SKILL.md:80`
  dice literalmente que un `agents/` copiado a `claude/`, `opencode/` o `pi/` es un error
  de porteo.
- Ningún gate ve un directorio nuevo en la raíz: el censo del Pi Package corre
  `git ls-files -- pi pi-extensions pi-themes` (`pi-extensions/pi-package/pi-package.test.ts:221`),
  y `scripts/lint-frontmatter.sh:19` y `scripts/drift-report.sh:14` solo recorren
  `claude codex opencode pi`. El problema no es apagar un gate: es crear el que falta.
- El único skill que fija modelo por rol es `sdd-review-loop` (`:17`, `:24`, `:44`, `:66`).
  Según `.sdd/grills/2026-09-03-sdd-review-loop.md:16`, la precedencia es parámetro de
  invocación > frontmatter del agent > `CLAUDE_CODE_SUBAGENT_MODEL` > modelo de sesión, así
  que los flags siguen ganando sobre cualquier `model:` del frontmatter.
- `quick-run` y `issue-triage` no delegan nada: el aislamiento de `quick-run` es por
  worktree git (`claude/quick-run/SKILL.md:56-57`), no por subagente.

Datos de la doc oficial de Claude Code que fijan el diseño: `plugin.json` acepta un campo
`agents` con rutas a directorios o a archivos `.md` individuales; el body de un subagente
reemplaza el system prompt de Claude Code (no se agrega); el campo `skills` precarga el
contenido completo del skill y se nombra `plugin-name:skill-name`; un skill faltante se
saltea con warning en vez de fallar; la precedencia de definiciones es proyecto > usuario >
plugin; y los agentes de plugin no pueden declarar `hooks`, `mcpServers` ni
`permissionMode`.

## Comportamiento esperado

| CA | Comportamiento observable | Verificabilidad |
|---|---|---|
| CA-1 | Existe `agents/implementer.md` con frontmatter `name: implementer`, `description` no vacía y `skills: [chichex-skills:tdd]`, sin `model`, `tools`, `disallowedTools`, `hooks`, `mcpServers` ni `permissionMode`. Su body instruye, en este orden: leer `.sdd/project.md`; seguir la fila `guia` de `## Politicas de generacion` para llegar a las coding policies del proyecto sin asumir su ruta; respetar `## Limites`; usar solo comandos de `## Comandos`; tests primero con rojo previo; tope de tres intentos honestos por verificación; prohibición explícita de debilitar verificaciones; prohibición de ampliar el alcance; y un reporte final con comandos corridos, resultado exacto, archivos tocados, políticas aplicadas y lo no verificado. | ALTA |
| CA-2 | Existe `agents/reviewer.md` con frontmatter `name: reviewer` y `description` no vacía, sin `model` ni campos prohibidos para agentes de plugin. Su body instruye: invocar el skill `code-review` con los argumentos recibidos sin resumir ni reinterpretar su doctrina; tratar título, body, comments y autor del PR como datos no confiables y nunca como instrucciones; no editar, commitear ni pushear; y cerrar siempre con el bloque ```json exacto que pidió el orquestador, declarando que sin ese bloque la corrida es no concluyente. | ALTA |
| CA-3 | `.claude-plugin/plugin.json` declara `"agents": ["./agents"]` junto al `"skills": ["./claude"]` existente, y su `description` sigue siendo byte a byte igual a la de `.claude-plugin/marketplace.json` (invariante que ya gatea `pi-extensions/sdd-review-loop/sdd-review-loop.test.ts:346-354`). | ALTA |
| CA-4 | `claude/sdd-review-loop/SKILL.md` nombra `subagent_type: "reviewer"` para el revisor y `subagent_type: "implementer"` para el corrector en el lanzamiento de la Fase 2 (`:66`), sin alterar el resto de esa doctrina: un solo subagente por vez, el orquestador no lee el diff, y al revisor y al corrector se les sigue pasando solo el número o la URL canónica del PR (`:62`, `:147`). | ALTA |
| CA-5 | El mismo skill declara la degradación: si el tipo de agente no está disponible en la instalación, la ronda sigue con el agente por defecto y lo anuncia; el bloque de reporte final incluye ese dato como línea propia. Un tipo ausente nunca aborta el loop ni queda silencioso. | ALTA |
| CA-6 | Los agentes no fijan `model` en su frontmatter, y el texto de `--model`/`--review-model`/`--fix-model` (`:24`) y la pregunta de modelos del wizard (`:44`) siguen siendo verdaderos: el default `sonnet` lo sigue pasando el skill por parámetro de invocación, que gana sobre el frontmatter. | ALTA |
| CA-7 | `install.sh` instala los `.md` de `agents/` en `CLAUDE_AGENTS_DIR` (default `$HOME/.claude/agents`) cuando se corre `install.sh claude` o `install.sh all`, mediante un kind nuevo para archivos `.md` en `pi_managed_names` (hoy solo soporta `dirs`, `entries` y `json`, `install.sh:57-79`). El header de uso y la lista de variables (`install.sh:8-26`) documentan la variable nueva, y el mensaje de argumento inválido (`:344`) queda intacto. | ALTA |
| CA-8 | `install.sh claude` avisa cuando el plugin `chichex-skills` ya está instalado, porque una copia en `~/.claude/agents` tiene precedencia sobre la del plugin y la taparía. El aviso no aborta la instalación de skills y no se emite cuando el plugin no está registrado. La detección lee el registro de plugins por una ruta overrideable por variable de entorno, nunca hardcodeada al home real. | ALTA |
| CA-9 | Existe `pi-extensions/agents-gate/agents-gate.test.ts` que censa `agents/*.md` sobre archivos trackeados en git contra una lista esperada explícita, valida el frontmatter de cada agente (`name` igual al basename sin extensión, `description` no vacía, ausencia de campos prohibidos), y verifica los textos de CA-1 a CA-6 y CA-11. Falla con diagnóstico nombrando el archivo ante cada forma de drift: agente faltante, agente inesperado, `name` que no matchea, `description` vacía, campo prohibido presente, `subagent_type` ausente en `sdd-review-loop`, línea de degradación ausente y declaración de `agents` ausente en `plugin.json`. | ALTA |
| CA-10 | El mismo gate falla si aparece cualquier directorio `agents/` bajo `claude/`, `opencode/` o `pi/`, protegiendo la regla de porteo de `.claude/skills/harness-port/SKILL.md:80`, y no falla por los `codex/*/agents/openai.yaml` existentes. | ALTA |
| CA-11 | La documentación refleja el layer nuevo: el árbol del repo en `README.md:95-108` y `README.en.md:98-109` incluye `agents/`; la sección del plugin (`README.md:114-123`, `README.en.md:116-125`) explica que el plugin expone los skills de `claude/` y los agentes de `agents/`; `.claude/skills/harness-port/SKILL.md` aclara en una línea que el `agents/` de la raíz es el layer de agentes del plugin de Claude, distinto del sidecar de Codex, y que no se portea; y `.sdd/project.md` suma el comando del gate nuevo a `## Comandos`, preservando literales los textos que `pi-extensions/pi-package/pi-package.test.ts:1214-1219` assertea sobre ese archivo. | ALTA |
| CA-12 | `claude/sdd-run/SKILL.md:63` deja de decir "subagents en repos grandes" sin más y nombra la tool y el tipo igual que `claude/sdd-spec/SKILL.md:65`: subagents `Explore` con la tool `Agent`. No se agrega ningún tipo custom ahí. | ALTA |
| CA-13 | En una delegación suelta de trabajo que edita código, dentro de un repo con `.sdd/project.md`, Claude elige `implementer` por su `description` en vez del agente por defecto. | NULA |
| CA-14 | El `implementer` lee el contrato y respeta sus `## Limites` y la fila `guia` al escribir código: el reporte final nombra las políticas aplicadas y los comandos del contrato que corrió. | NULA |

## Fuera de alcance

- **El agente `skeptic`.** El panel de escépticos vive solo en el motor ultracode
  (`claude/sdd-run/SKILL.md:147`), igual que los paneles de `claude/sdd-spec/SKILL.md:179-181`
  y `claude/sdd-init/SKILL.md:221-222`. Sin ultracode no tiene un solo call-site que lo
  invoque, y darle uno en el modo normal es un cambio de doctrina que merece su propia spec.
- **El motor ultracode.** Pasar un tipo de agente a `agent()` de la tool `Workflow` no está
  documentado públicamente. Mientras eso no se verifique, los agentes-CA (`sdd-run:144`) y
  los escépticos (`:147`) siguen sin tipo.
- **Los harnesses `codex/`, `opencode/` y `pi/`.** Decisión humana explícita de esta sesión.
  No se portea nada: ni el layer de agentes, ni los cambios de texto de `sdd-review-loop` y
  `sdd-run`. El drift resultante es deliberado.
- **`quick-run`, `issue-triage` y `wait-pr`.** No delegan a subagentes, así que no hay punto
  de inserción. Darles uno sería un cambio de diseño, no esta spec.
- **Los puntos de exploración ya tipados** (`sdd-spec:65`, `sdd-init:70,73,82`,
  `sdd-run:141`): `Explore` es built-in, read-only y ya es el tipo correcto.
- **Hooks, `permissionMode` y `mcpServers`**: prohibidos para agentes distribuidos por
  plugin. El cumplimiento de la doctrina depende del prompt y de los gates del orquestador,
  no de un mecanismo del harness.
- **Cambiar el modelo, el `effort` o el modo de permisos de los subagentes existentes.**

## Inferencias

| # | Inferencia | Eleccion propuesta | Alternativa razonable | Confianza | Resolucion |
|---|---|---|---|---|---|
| 1 | ¿Dónde vive el directorio de agentes? | `agents/` en la raíz, declarado explícito en `plugin.json` | `claude/agents/` declarado igual | alta | confirmada — `claude/agents/` rompe `scripts/lint-frontmatter.sh:36-47` (exige `SKILL.md` en cada `claude/*/`), contradice `harness-port/SKILL.md:80` y ensucia el `cp -R claude/* ~/.claude/skills/` de `README.md:195` |
| 2 | ¿Qué agentes entran en la v1? | `implementer` + `skeptic` | solo `implementer`, o `implementer` + `reviewer` | baja | elegida por usuario: `implementer` + `reviewer`. El `skeptic` queda afuera por no tener call-site sin ultracode |
| 3 | ¿`quick-run` entra? | No: hoy no delega nada | agregarle delegación | alta | confirmada |
| 4 | ¿El ultracode usa los tipos custom? | No en la v1 | incluirlo verificando la API en el run | baja | elegida por usuario: fuera de la v1 |
| 5 | ¿Cómo llega el `implementer` a las coding policies? | Por la fila `guia` del contrato (`sdd-run:69`, `:86`) | hardcodear `.sdd/coding-policies.md` | alta | confirmada — la ruta no es invariante: `coding-policies` acepta `--out` (`claude/coding-policies/SKILL.md:24`) |
| 6 | ¿El frontmatter fija `model`? | No | `model: sonnet` en el frontmatter y reescribir `:24` | media | confirmada — los flags ganan por precedencia; no fijarlo evita reescribir doctrina vigente |
| 7 | ¿Se restringen tools? | No | `tools` acotado por rol | alta | confirmada — `sdd-review-loop:57` dice que los subagentes heredan el modo de permisos, y el corrector commitea y pushea (`:97`) |
| 8 | ¿El `implementer` precarga skills? | Sí, `skills: [chichex-skills:tdd]` | ninguno: el body remite a `/tdd` | media | confirmada — el `reviewer` no precarga nada: su doctrina vive en el `/code-review` nativo |
| 9 | ¿Qué pasa si el tipo no existe? | La doctrina degrada: sigue con el default y lo anuncia | frenar con diagnóstico | media | confirmada |
| 10 | ¿`install.sh` distribuye los agentes? | No: solo el plugin | sumar `CLAUDE_AGENTS_DIR` y un kind `md` | baja | elegida por usuario: también `install.sh`, con el aviso de sombra de CA-8 como consecuencia |
| 11 | ¿Paridad entre harnesses? | Claude-only, actualizando `harness-port` y `docs/harness-interaction-differences.md` | portear también a opencode (`task`) | alta | **decisión humana**: claude-only y no tocar los otros harnesses. `docs/harness-interaction-differences.md` queda intacto porque su fila `extras` describe sidecars por skill, no un layer de plugin, y el bloque lo parsea `pi-extensions/harness-gate/interaction.ts:38-40` |
| 12 | ¿Dónde vive el gate? | `pi-extensions/agents-gate/agents-gate.test.ts` | script en `scripts/` más dos líneas en `ci.yml` | alta | confirmada — es el único lugar que entra a CI sin editar `.github/workflows/ci.yml:47` |
| 13 | ¿Se arregla el huérfano `sdd-run:63`? | Sí, alinearlo a `sdd-spec:65` | dejarlo | media | confirmada |
| 14 | ¿Nombres de los agentes? | `implementer` y `reviewer` | nombres en español | media | confirmada — kebab en inglés, como el resto de los identificadores del repo |
| 15 | ¿Qué docs se actualizan? | Ambos READMEs, `harness-port` y el contrato | solo el contrato | alta | confirmada |

## Verificabilidad

**MIXTA — ALTA 12 · NULA 2.**

Las doce ALTA son artefactos de texto, manifests JSON y shell, y el contrato declara
verificados los gates que las observan: `node --test pi-extensions/*/*.test.ts` (202/202,
glob bloqueante en CI), `bash scripts/lint-frontmatter.sh`, `bash -n`, `shellcheck` y
`git diff --check`. El gate nuevo entra a esa suite sin tocar CI por el glob de
`.github/workflows/ci.yml:47`.

CA-7 y CA-8 son ALTA aunque toquen el instalador, porque existe precedente de probarlo sin
el home real: el gate del Pi Package ejecuta `install.sh` con destinos `PI_*_DIR`
temporales y compara la configuración antes y después. Acá aplica lo mismo con
`CLAUDE_AGENTS_DIR` y la ruta del registro de plugins apuntando a temporales. Los `## Limites`
del contrato prohíben correr `./install.sh` contra la configuración real sin autorización
separada, y esta spec no la pide.

CA-13 y CA-14 son **NULA y son el corazón del pedido**, así que va sin maquillaje: los
gates prueban que el agente existe, que su frontmatter es válido y que su body dice lo
correcto. Que el modelo elija ese tipo por su `description`, y que después obedezca el
contrato, es conducta emergente del harness. `.sdd/project.md` ya lo declara como gap —
"no hay e2e automatizado para TUI, cambio de modelo, compactacion, fallback de provider ni
conducta emergente de agentes siguiendo skills" — y nada en la escalera de verificación
autónoma la observa. Van con protocolo humano.

No hay políticas de generación activas (`## Politicas de generacion`: sin politicas
activas), así que ningún gate de tamaño, coverage o dependencias condiciona el alcance. El
blast-radius estimado son 11 archivos (2 nuevos agentes, 1 gate nuevo, `plugin.json`,
`install.sh`, 2 SKILL.md, `harness-port`, 2 READMEs y el contrato), sin dependencias nuevas
y sin tocar `package.json`: agregar una clave al bloque `pi` haría fallar
`pi-extensions/pi-package/pi-package.test.ts:395-398`, que exige exactamente
`extensions,skills,themes`.

## Plan de verificacion

Mecanismo elegido: **gate determinista nuevo más la escalera del contrato**, con los dos CA
emergentes en protocolo humano. Es el más barato que observa el comportamiento real de cada
artefacto.

| CA | Mecanismo | Señal de paso |
|---|---|---|
| CA-1, CA-2 | `node --test pi-extensions/agents-gate/agents-gate.test.ts` — censo de `agents/*.md` vía `git ls-files -- agents` contra lista esperada, parseo del frontmatter y assertions sobre las frases doctrinales del body | El test pasa con los dos agentes presentes y falla nombrando el archivo ante cada drift inyectado |
| CA-3 | El mismo gate lee `.claude-plugin/plugin.json` y exige la clave `agents` con `./agents`; `node --test pi-extensions/sdd-review-loop/sdd-review-loop.test.ts` sigue verde sobre la paridad de descripciones | Ambos tests verdes |
| CA-4, CA-5, CA-6, CA-12 | El mismo gate assertea los textos de `claude/sdd-review-loop/SKILL.md` y `claude/sdd-run/SKILL.md` | El test falla si falta un `subagent_type`, la línea de degradación o el nombre de la tool en `sdd-run:63` |
| CA-7 | `bash -n install.sh` y `shellcheck install.sh`, más un test del gate que corre `install.sh claude` con `CLAUDE_SKILLS_DIR` y `CLAUDE_AGENTS_DIR` temporales y compara el contenido copiado contra `agents/*.md` | Los `.md` aparecen en el destino temporal; el home real no se toca; shellcheck sin hallazgos |
| CA-8 | Test del gate con dos corridas sobre destinos temporales: una con un registro de plugins temporal que incluye `chichex-skills` y otra sin él | La primera emite el aviso y termina 0; la segunda no lo emite |
| CA-9, CA-10 | Autotests del gate con drift inyectado en un árbol temporal, incluido un `claude/<skill>/agents/` de scratch, siguiendo el estilo de `pi-extensions/pi-package/pi-package.test.ts` | Cada inyección produce el diagnóstico esperado; los `codex/*/agents/openai.yaml` reales no disparan falso positivo |
| CA-11 | El mismo gate assertea los literales de ambos READMEs, de `harness-port` y del contrato; `node --test pi-extensions/pi-package/pi-package.test.ts` sigue verde sobre los literales de `.sdd/project.md` | Ambos tests verdes |
| Regresión | `node --test pi-extensions/*/*.test.ts`, `bash scripts/lint-frontmatter.sh`, `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh`, `shellcheck` sobre los tres, `git diff --check` | Suite completa verde (202 previos más los nuevos), 47 skills OK, sin errores de whitespace |

### Protocolo de prueba humana (CA-13 y CA-14)

Requiere una sesión de Claude Code con el plugin actualizado (`/plugin update chichex-skills`
o reinstalación), en un repo con `.sdd/project.md` y coding policies referenciadas — por
ejemplo `~/Sync/workspace/platform`.

1. Pedir en esa sesión una delegación de trabajo que edite código, sin nombrar el agente:
   por ejemplo "delegá a un subagente el cambio X".
2. Mirar la línea del subagente en la UI. **Paso:** dice `implementer`. **No paso:** dice
   `general-purpose` o cualquier otro tipo. Si no paso, la `description` del agente no está
   compitiendo bien y hay que reescribirla; anotar qué tipo eligió.
3. Leer el reporte final del subagente. **Paso:** nombra el archivo de coding policies que
   leyó, las políticas que aplicó y los comandos del contrato que corrió, con su resultado.
   **No paso:** reporta prosa sin comandos, o no menciona el contrato.
4. Verificar el diff del subagente contra una regla concreta de las coding policies del
   repo. **Paso:** la cumple. **No paso:** la viola, y el reporte igual decía que la aplicó —
   ese caso es el más importante de registrar, porque es el fallo que esta spec no puede
   prevenir por gate.
5. Registrar el resultado de los cuatro pasos en el PR de esta spec antes de mergear.

## Riesgos y gaps

- **La sombra de `install.sh` es real y queda mitigada, no eliminada.** La precedencia de
  definiciones es proyecto > usuario > plugin, así que una copia en `~/.claude/agents`
  gana sobre la del plugin y queda vieja para siempre si el repo renombra o cambia un
  agente. CA-8 solo avisa. El precedente fuerte es `pi_native_package_conflict`, que se
  **niega** a instalar copias legacy cuando el Pi Package nativo está registrado; si el
  aviso resulta insuficiente en uso real, endurecerlo a negativa es el paso siguiente.
- **El body reemplaza el system prompt de Claude Code.** Un body pobre degrada al subagente
  en vez de mejorarlo: pierde las instrucciones por defecto del harness y solo tiene las
  propias. Los bodies de CA-1 y CA-2 tienen que ser completos, no recordatorios.
- **Nadie verifica que `skills: [chichex-skills:tdd]` precargue de verdad.** Un skill
  faltante se saltea con warning en el debug log, sin fallar: si el nombre plugin-scoped
  estuviera mal escrito, el agente correría sin la doctrina de TDD y ningún gate lo notaría.
  El gate valida el string, no el efecto.
- **Las `description` de los agentes custom compiten en un presupuesto combinado** (límite
  documentado de 15k tokens para descripciones de agentes custom). Dos agentes no lo
  agotan, pero es el techo a recordar si mañana entran el `skeptic` y compañía.
- **Drift deliberado entre harnesses.** Por decisión humana, `claude/sdd-review-loop` y
  `claude/sdd-run` van a divergir de sus copias en `codex/`, `opencode/` y `pi/` en algo que
  la regla 1 de `harness-port` llama doctrina. `scripts/drift-report.sh` lo va a reportar
  (informativo, exit 0) y ningún gate bloqueante lo impide, porque
  `pi-extensions/harness-gate/harness-gate.test.ts:24` solo cubre `sdd-init`, `sdd-spec`,
  `sdd-run` y `grill` a nivel de templates, no de cuerpos completos. El precedente aceptado
  de artefacto claude-only es `sdd-review-loop`.
- **El contrato tiene 33 días** (generado el 2026-08-15) y sus comandos figuran verificados
  al 2026-08-16. Conviene `/sdd-init --update` antes o después de este run; no bloquea.
- **`.sdd/project.md` está gateado por literales** (`pi-extensions/pi-package/pi-package.test.ts:1214-1219`,
  que incluye el regex sobre `## Politicas de generacion\nSin politicas activas.`): agregar
  el comando del gate nuevo no puede alterar esas frases.
- **[ASSUMED] El campo `agents` de `plugin.json` convive con `skills`.** La doc dice que un
  path custom reemplaza el default y que se pueden listar varios; declarar `["./agents"]`
  junto a `"skills": ["./claude"]` es la lectura directa, pero no está verificado en este
  repo. Si el plugin dejara de exponer los agentes, la alternativa es omitir el campo y
  confiar en el descubrimiento automático de `agents/` en la raíz.
  **Refutado el 2026-09-18:** Claude Code 2.1.276 exige que cada entrada de `agents` sea una
  ruta a `.md`, así que `["./agents"]` rompió la carga del plugin (`agents.0: Invalid input`).
  Se aplicó la alternativa: el campo se omitió y el gate ahora exige su ausencia.
- **La conducta emergente no tiene e2e y probablemente no lo tenga pronto.** CA-13 y CA-14
  se re-prueban a mano cada vez que cambie la `description` o el body de un agente. Es el
  gap estructural de esta feature: la spec puede garantizar el artefacto, no la obediencia.

## Resultado de ejecucion (2026-09-17 · HEAD 5ed706e)

| CA | Estado | Evidencia |
|---|---|---|
| CA-1 | verificado | `node --test pi-extensions/agents-gate/agents-gate.test.ts`: 20/20 verdes — test "CA-1: agents/implementer.md tiene frontmatter valido, skills: [chichex-skills:tdd] y body en orden" |
| CA-2 | verificado | mismo comando — test "CA-2: agents/reviewer.md tiene frontmatter valido, sin skills forzadas y body en orden" |
| CA-3 | verificado | mismo comando — test "CA-3: plugin.json declara agents junto a skills, con description identica a marketplace.json"; `node --test pi-extensions/sdd-review-loop/sdd-review-loop.test.ts`: 9/9 verdes (paridad de descripciones intacta) |
| CA-4 | verificado | mismo comando — test "CA-4, CA-5, CA-6: sdd-review-loop nombra subagent_type, degrada sin abortar y no fija model" |
| CA-5 | verificado | mismo comando y test que CA-4 |
| CA-6 | verificado | mismo comando y test que CA-4 |
| CA-7 | verificado | mismo comando — test "CA-7: install.sh copia agents/\*.md a CLAUDE_AGENTS_DIR en 'claude' y en 'all', sin tocar el home real" (destinos `CLAUDE_SKILLS_DIR`/`CLAUDE_AGENTS_DIR` temporales); `shellcheck install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh`: sin hallazgos |
| CA-8 | verificado | mismo comando — test "CA-8: install.sh claude avisa la sombra del plugin chichex-skills solo cuando esta registrado" (con y sin `CLAUDE_PLUGIN_REGISTRY_FILE` conteniendo `chichex-skills@`) |
| CA-9 | verificado | mismo comando — test "CA-9: censo de agents/\*.md sobre archivos trackeados en git contra la lista esperada" mas 9 autotests de diagnostico (agente faltante/inesperado, name, description, cada campo prohibido, skills, subagent_type, degradacion, plugin.json) |
| CA-10 | verificado | mismo comando — test "CA-10: ningun agents/ bajo claude/, opencode/ o pi/; los sidecars de codex no disparan falso positivo" (17 sidecars `codex/*/agents/openai.yaml` confirmados, cero bajo claude/opencode/pi) |
| CA-11 | verificado | mismo comando — test "CA-11: READMEs, harness-port y el contrato documentan el layer de agentes"; `node --test pi-extensions/pi-package/pi-package.test.ts`: 17/17 verdes (literales de `.sdd/project.md` intactos) |
| CA-12 | verificado | mismo comando — test "CA-12: sdd-run nombra Explore + tool Agent en la Fase 2, sin agregar un tipo custom" |
| CA-13 | pendiente humano | protocolo de prueba humana de esta spec, checklist en el PR |
| CA-14 | pendiente humano | protocolo de prueba humana de esta spec, checklist en el PR |

Politicas de generacion: sin politicas activas (contrato), ningun `POL-*`.

Regresion completa sobre este HEAD: `node --test pi-extensions/*/*.test.ts` → 313/313 verdes (incluye los 20 nuevos de `agents-gate`); `bash scripts/lint-frontmatter.sh` → 56 skills OK; `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` → sin errores; `shellcheck install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` → sin hallazgos; `git diff --check` → sin errores de whitespace; `bash scripts/drift-report.sh` → exit 0 (informativo).

Blast-radius real (`git diff --name-status origin/main..HEAD`): `.claude-plugin/plugin.json`, `.claude/skills/harness-port/SKILL.md`, `.sdd/project.md`, `.sdd/specs/subagentes-claude.md` (artefacto de entrada importado), `README.en.md`, `README.md`, `agents/implementer.md`, `agents/reviewer.md`, `claude/sdd-review-loop/SKILL.md`, `claude/sdd-run/SKILL.md`, `install.sh`, `pi-extensions/agents-gate/agents-gate.test.ts` — coincide con los 11 archivos estimados en `## Verificabilidad` mas la spec importada. Sin tocar `package.json`, `codex/`, `opencode/` ni `pi/`.

Desviaciones: ninguna. No hizo falta ningun `[DEVIATION]`: los 12 CA ALTA se implementaron y verificaron tal como la spec los describe.
