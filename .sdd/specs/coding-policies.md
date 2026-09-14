# Spec — coding-policies: skill agnóstico que genera las buenas prácticas por stack en cada proyecto
<!-- Generada por /sdd-spec el 2026-09-14. Fuente: grill 2026-09-13-coding-policies. Estado: aprobada -->
<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=2026-09-13-coding-policies; superseded-by=none -->

## Contexto

El usuario mantiene buenas prácticas propias por lenguaje (Go, React web, Node, Kotlin mobile, React Native) y hoy las tiene que redefinir proyecto por proyecto. El handoff `.sdd/grills/2026-09-13-coding-policies.md` (finalized) cierra la solución: un único skill agnóstico `coding-policies` que, invocado en un proyecto, detecta sus stacks y genera un archivo Markdown autocontenido con las reglas del usuario, referenciable desde `CLAUDE.md`, `AGENTS.md` o `.sdd/project.md`. Las prácticas por lenguaje viven como archivos de referencia dentro del skill. La v1 construye toda la infraestructura y llena contenido real solo para Go.

Qué hay en el código hoy:

- Skills por harness en `claude/`, `codex/`, `opencode/` y `pi/`, con doctrina idéntica y capa de interacción propia (`docs/harness-interaction-differences.md:16-21`). `tdd` es el modelo de skill con referencias (`claude/tdd/{SKILL.md,mocking.md,tests.md}`; Codex agrega `codex/tdd/agents/openai.yaml`).
- `sdd-init` Fase 3.5 ya contempla "políticas de la tecnología" como filas `guia` en `## Politicas de generacion` (`claude/sdd-init/SKILL.md:114-136`), tiene una checklist de upgrade para contratos viejos (`:138-148`) y una Fase 5 que cablea el contrato en `CLAUDE.md`/`AGENTS.md` con un mecanismo distinto por harness: import `@ruta` en Claude Code (`claude/sdd-init/SKILL.md:208-210`), bloque de instrucción en Pi y Codex porque no expanden imports (`pi/sdd-init/SKILL.md:185-189`, `codex/sdd-init/SKILL.md:187-191`), `@ruta` en `AGENTS.md` de opencode (`opencode/sdd-init/SKILL.md:205-207`).
- `sdd-run` ya consume las filas `guia` al generar código y las lista en el PR (`claude/sdd-run/SKILL.md:69,86`); no requiere cambios.
- El gate del Pi Package censa los skills contra la lista hardcodeada `EXPECTED_SKILLS` (`pi-extensions/pi-package/pi-package.test.ts:71-85`); el lint exige `name` igual a la carpeta y `description` no vacía (`scripts/lint-frontmatter.sh`); `harness-gate` compara byte a byte los templates con marker SDD entre harnesses tras normalizar la invocación (`pi-extensions/harness-gate/harness-gate.test.ts:408`) y tiene tests de doctrina por harness (`:454-472`). Los directorios solo de tests en `pi-extensions/` son convención aceptada (`harness-gate/`, `pi-package/`, `sdd-review-loop/`).
- READMEs con tabla de skills fundacionales (`README.md:32`, `README.en.md:34`); `.claude-plugin/plugin.json` y `.claude-plugin/marketplace.json` describen el plugin.

## Comportamiento esperado

### Artefactos del skill

- **CA-1 (ALTA)** — Existen `claude/coding-policies/SKILL.md`, `codex/coding-policies/SKILL.md`, `opencode/coding-policies/SKILL.md` y `pi/coding-policies/SKILL.md`, cada uno con frontmatter `name: coding-policies` y una `description` en español que dispare cuando el usuario pida coding policies, buenas prácticas, políticas de código o que el agente siga sus prácticas en el repo. Existe `codex/coding-policies/agents/openai.yaml` con `display_name`, `short_description` y `default_prompt`. `bash scripts/lint-frontmatter.sh` termina en 0 incluyendo las cuatro copias.
- **CA-2 (ALTA)** — Las cuatro copias son equivalentes en doctrina: tras normalizar la sintaxis de invocación (`/coding-policies`, `$coding-policies`, `/skill:coding-policies`) y el nombre de la tool de preguntas de cada harness, cada enunciado de doctrina de la lista del test aparece en las cuatro, y cada copia usa la tool de preguntas de su harness (`AskUserQuestion`, `request_user_input` con fallback a texto, gate en texto plano terminando el turno, `ask_user_question`/`ask_user_questions`).
- **CA-3 (ALTA)** — `EXPECTED_SKILLS` en `pi-extensions/pi-package/pi-package.test.ts` incluye `./pi/coding-policies/SKILL.md` y `node --test pi-extensions/pi-package/pi-package.test.ts` pasa; con `pi` en PATH, el probe RPC lista `skill:coding-policies`.
- **CA-4 (ALTA)** — Existe `<harness>/coding-policies/references/go.md` en los cuatro harnesses, byte a byte idéntico, con frontmatter `stack: go`, `name: Go`, `version: YYYY-MM-DD`; exactamente estas secciones `###` en este orden: `Layout de paquetes`, `Errores`, `Naming`, `Interfaces y tipos`, `Concurrencia`, `Testing`, `Dependencias y configuración`, `Lectura ampliada`; entre 25 y 45 reglas en total; cada regla es una línea `- **MUST** <regla>. Porqué: <texto>. Gate: <texto>` o igual con `**SHOULD**`, donde `Gate:` nombra una herramienta y regla (`golangci-lint: errcheck`, `go vet`, `gofmt -l`, un comando) o `—`; `Lectura ampliada` contiene los links a Uber Go Style Guide (`https://github.com/uber-go/guide/blob/master/style.md`), Effective Go (`https://go.dev/doc/effective_go`), Go Code Review Comments (`https://go.dev/wiki/CodeReviewComments`) y Package Oriented Design (`https://www.ardanlabs.com/blog/2017/02/package-oriented-design.html`).
- **CA-5 (NULA)** — El contenido de `references/go.md` refleja las prácticas del usuario: sale de patrones observados en `~/Sync/workspace/cpanel`, `~/Sync/workspace/medicine/medicine-backend` y `~/Sync/workspace/mobctl` cruzados con las tres guías base, y el usuario aprueba explícitamente cada regla antes del merge. Ver protocolo humano.

### Procedimiento del skill (lo que cada SKILL.md instruye)

- **CA-6 (ALTA)** — Cada SKILL.md declara, con el mismo texto normalizado, el procedimiento completo:
  1. **Argumentos:** `coding-policies [go|node|react|react-native|kotlin-android ...] [--out <ruta>] [--no-link]` en la sintaxis del harness. Stacks posicionales saltean la confirmación de stacks; `--out` saltea la pregunta de destino; `--no-link` saltea el enganche.
  2. **Lanzador (invocado pelado):** corre la detección, muestra los stacks detectados con su ruta y si tienen referencia en el skill, y pregunta con la tool del harness qué stacks entran (selección múltiple donde el harness la soporte) y el destino, default `.sdd/coding-policies.md`.
  3. **Detección:** tabla de marcadores — `go` por `go.mod`; `react` por `package.json` con `react-dom`; `react-native` por `package.json` con `react-native` o `expo`; `node` por `package.json` sin ninguno de esos; `kotlin-android` por `build.gradle` o `build.gradle.kts` que declare `com.android.application` o `com.android.library`. Mira `dependencies` y `devDependencies`. Busca en la raíz y hasta profundidad 2, excluyendo `node_modules`, `vendor`, `.git`, `dist` y `build`. Cada stack detectado registra dónde se vio.
  4. **Cobertura:** un stack está cubierto si existe `references/<id>.md` en el skill. Los detectados sin referencia se informan en la confirmación y en el reporte como "sin prácticas definidas todavía" y no generan sección. Si ningún stack confirmado está cubierto, no se genera archivo y se informa.
  5. **Generación:** el archivo sigue el template del SKILL.md (CA-8): título, marker con fecha y `stack@version` por stack, una sección `## <Nombre>` por stack cubierto con el marker de stack y el cuerpo de `references/<id>.md` copiado verbatim (temas, reglas y lectura ampliada), y al final `## Ajustes de este proyecto` delimitada por `<!-- coding-policies:ajustes:start -->` y `<!-- coding-policies:ajustes:end -->`, vacía al generar por primera vez. Crea `.sdd/` si el destino default no existe.
  6. **Regeneración:** si el destino existe, muestra qué stacks cambian de versión y avisa que todo salvo Ajustes se reescribe; confirma con la tool del harness; preserva verbatim el bloque entre los markers de ajustes; si el archivo existe pero no tiene los dos markers de ajustes, no lo pisa y lo dice. El skill nunca interpreta el contenido de Ajustes.
  7. **Enganche (salvo `--no-link`):** detecta en la raíz `CLAUDE.md`, `AGENTS.md` y `.sdd/project.md` existentes, ofrece agregar la referencia solo en esos (nunca crea archivos; si no existe ninguno, lo informa) y edita únicamente los confirmados. Mecanismo, idempotente y verificando antes que la ruta no esté ya presente: en `CLAUDE.md` una línea `@<ruta>`; en `AGENTS.md` un bloque `<!-- coding-policies -->` seguido de la instrucción de leer `<ruta>` y respetar sus reglas y ajustes antes de escribir o modificar código (en la copia de opencode, una línea `@<ruta>`, como su `sdd-init`); en `.sdd/project.md` una fila `| coding-policies | <ruta> (<stacks>) | guia — sin gate: <sdd-run del harness> la sigue al generar, la juzga el reviewer |` en la tabla de `## Politicas de generacion`, reemplazando el sentinel "Sin politicas activas" si está, actualizando la fila en su lugar si ya existe, y sin tocar nada si la sección no existe (lo informa y sugiere `sdd-init --update`).
  8. **Reporte final:** ruta y si fue generado o regenerado; stacks con versión y cobertura; ajustes preservados; resultado del enganche por archivo (agregado, ya estaba, omitido, sin sección); stacks desactualizados antes de regenerar.
  9. **Límites:** no toca configuración global de ningún harness; no crea archivos de contexto; no edita sin confirmación; no inventa reglas para stacks sin referencia.
- **CA-7 (NULA)** — En un repo Go real, el skill hace lo que CA-6 describe: detecta Go, genera el archivo con el layout, ofrece el enganche en los archivos existentes y, al re-correr con ajustes escritos, los preserva verbatim. Ver protocolo humano.
- **CA-8 (ALTA)** — Cada SKILL.md contiene un fence con el template del archivo generado, byte a byte idéntico entre los cuatro harnesses tras normalizar la invocación, y el template incluye la línea `<!-- coding-policies: generated=<YYYY-MM-DD>; stacks=<id>@<YYYY-MM-DD>[,<id>@<YYYY-MM-DD>...] -->`, un marker `<!-- coding-policies:stack=<id>; version=<YYYY-MM-DD> -->` por sección de stack, y los markers `<!-- coding-policies:ajustes:start -->` y `<!-- coding-policies:ajustes:end -->`.

### Integración con sdd-init

- **CA-9 (ALTA)** — En los cuatro `<harness>/sdd-init/SKILL.md`: la Fase 3.5 declara que si existe `.sdd/coding-policies.md` se escribe la fila `guia` `coding-policies` sin preguntar, también con `--assume` (el archivo ya es una decisión humana en el repo), y que si no existe se ofrece en el menú generarlo invocando `coding-policies` al terminar el contrato, nunca con `--assume`; la checklist de "Upgrade de contrato" gana la fila `coding-policies` (existe `.sdd/coding-policies.md` pero `## Politicas de generacion` no tiene su fila); el reporte gana una línea `coding-policies: <referenciado|generado|no existe (ofrecido)|--assume: no ofrecido>`. El fence del template del contrato (`type=project`) no cambia y `node --test pi-extensions/harness-gate/harness-gate.test.ts` sigue en verde.

### Documentación y suite

- **CA-10 (ALTA)** — `README.md` y `README.en.md` tienen una fila `coding-policies` en la tabla de skills fundacionales que describe qué genera, dónde, la preservación de ajustes y que la v1 cubre Go; `.claude-plugin/plugin.json` y `.claude-plugin/marketplace.json` mencionan `coding-policies` en `description` y lo agregan a `keywords`.
- **CA-11 (ALTA)** — Sin regresión: `node --test pi-extensions/*/*.test.ts`, `bash scripts/lint-frontmatter.sh`, `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` y `git diff --check` terminan en 0. El test nuevo `pi-extensions/coding-policies-gate/coding-policies-gate.test.ts` entra al glob y pasa.

## Fuera de alcance

- Contenido de React web, Node, Kotlin mobile y React Native: la v1 solo trae `references/go.md`; los demás stacks se detectan pero no generan sección.
- Subagentes, skills por stack, o cambios en configuración global de los harnesses.
- Gates duros por regla en `sdd-init`; la integración escribe solo una fila `guia`.
- Cambios en `sdd-run`, `code-review`, `install.sh` o el manifest del Pi Package fuera de `EXPECTED_SKILLS`.
- Verificar soporte de import `@ruta` en Pi, Codex u opencode más allá de lo que `sdd-init` ya encodea por harness.
- Un generador scripteado: el skill es un procedimiento en Markdown ejecutado por el agente, como el resto del repo.

## Inferencias

| # | Inferencia | Elección | Alternativa razonable | Confianza | Resolución |
|---|---|---|---|---|---|
| 1 | Layout del archivo generado | Título, marker con versión por stack y fecha, sección `## <Stack>` por stack con reglas y links, `## Ajustes de este proyecto` al final vacía | Links globales; ajustes al principio | media | confirmada |
| 2 | Formato de cada regla | Bullet `**MUST/SHOULD** regla. Porqué: una línea. Gate: herramienta o —` | Tabla Regla / Porqué / Gate | media | confirmada |
| 3 | Versionado de prácticas | `version: YYYY-MM-DD` en cada referencia; el marker guarda `stack@version`; la regeneración informa desactualizados | Hash de commit; versión global | media | confirmada |
| 4 | Enganche en `.sdd/project.md` | Fila `guia` en la tabla de Políticas, reemplazando el sentinel | Bullet en Decisiones humanas | media | confirmada |
| 5 | Enganche en `AGENTS.md` y `CLAUDE.md` | Mismo mecanismo por harness que `sdd-init` Fase 5 | Inlinear el contenido | alta | confirmada |
| 6 | Archivos de contexto inexistentes | Solo se ofrecen los que existen; nunca se crean | Crearlos como `sdd-init` | alta | confirmada |
| 7 | Alcance de la detección | Raíz y profundidad 2, exclusiones, deps y devDeps, ruta registrada | Solo raíz | media | confirmada |
| 8 | Stacks sin referencia | Sin sección; se informan como "sin prácticas definidas todavía" | Placeholder con links | media | confirmada |
| 9 | Sintaxis de argumentos | Stacks posicionales, `--out <ruta>`, `--no-link` | `--stacks=` | media | confirmada |
| 10 | Gates en las reglas Go | Nombran herramienta y regla sin afirmar que estén configuradas | Todas con — | media | confirmada |
| 11 | Tamaño y organización Go | 25 a 45 reglas en 7 temas; evidencia de repos en el borrador, no en el archivo | Sin tope | media | confirmada |
| 12 | Piezas por convención del repo | Copias por harness, sidecar Codex, `EXPECTED_SKILLS`, READMEs, plugin | Omitir docs y plugin | alta | confirmada |
| 13 | Cambio en `sdd-init` | Fase 3.5 más checklist de upgrade; template del contrato intacto | Solo Fase 3.5 | media | confirmada |
| 14 | Prueba del contenido Go | Estructural automatizable más revisión humana | Solo humana | alta | confirmada |
| 15 | Sección de ajustes | Markers HTML de inicio y fin; preservada verbatim, no interpretada | Solo encabezado | alta | confirmada |
| 16 | Ningún stack confirmado cubierto | No se genera archivo y se informa | Generar solo con la sección de ajustes | alta | [ASSUMED] — surgió al escribir; sesgo mínimo |
| 17 | Destino default sin `.sdd/` | El skill crea `.sdd/` | Caer a `docs/` | alta | [ASSUMED] — surgió al escribir; sesgo mínimo |
| 18 | Archivo existente sin markers de ajustes | No se pisa; se informa | Regenerar igual | alta | [ASSUMED] — surgió al escribir; sesgo mínimo y reversible |

## Verificabilidad

Mixto. CA-1, CA-2, CA-3, CA-4, CA-6, CA-8, CA-9, CA-10 y CA-11 son ALTA: el contrato tiene verificados `bash scripts/lint-frontmatter.sh`, `node --test pi-extensions/pi-package/pi-package.test.ts`, `node --test pi-extensions/harness-gate/harness-gate.test.ts` y la suite `node --test pi-extensions/*/*.test.ts`, y el test nuevo entra a ese glob. CA-5 y CA-7 son NULA: el contenido Go es criterio del usuario, y el contrato declara en Gaps que no hay e2e de conducta emergente de agentes siguiendo skills y en Límites que no se consume provider para probar. Aclaración: ALTA cubre artefactos y texto de doctrina, no la conducta del agente al ejecutar el skill.

Políticas de generación del contrato: ninguna activa. Blast-radius estimado: unos 20 archivos; sin límite de tamaño de PR, no hace falta partir.

## Plan de verificacion

Mecanismo elegido por el usuario: test determinista nuevo más gates existentes más protocolo humano.

| CA | Cómo |
|---|---|
| CA-1 | `bash scripts/lint-frontmatter.sh` en 0; `test -f codex/coding-policies/agents/openai.yaml` |
| CA-2 | `node --test pi-extensions/coding-policies-gate/coding-policies-gate.test.ts`: lee las cuatro copias, normaliza invocación y tool de preguntas, exige cada regex de doctrina y el estilo de pregunta propio del harness (patrón de `harness-gate.test.ts:454-472`) |
| CA-3 | `node --test pi-extensions/pi-package/pi-package.test.ts` en verde con `./pi/coding-policies/SKILL.md` en `EXPECTED_SKILLS` |
| CA-4 | El mismo test parsea `references/go.md` de cada harness: frontmatter, orden de secciones, 25 ≤ reglas ≤ 45, regex por regla, cuatro URLs, igualdad byte a byte entre copias; incluye autotests negativos (regla sin `Gate:`, sección faltante, fuera de rango) |
| CA-6 | El mismo test exige en las cuatro copias las regex de: tabla de marcadores (`go.mod`, `react-dom`, `react-native`/`expo`, `com.android`), profundidad 2 y exclusiones, `--out`, `--no-link`, markers de ajustes, "nunca crea" archivos de contexto, fila `guia` en `.sdd/project.md`, reporte final |
| CA-8 | El mismo test extrae el fence del template de cada copia, exige igualdad tras normalizar y valida con regex el marker de cabecera, el de stack y los de ajustes |
| CA-9 | El mismo test exige en los cuatro `sdd-init/SKILL.md` las regex de: existe → fila `guia` también con `--assume`; no existe → ofrecer; nunca con `--assume`; fila de upgrade; línea de reporte. Además `node --test pi-extensions/harness-gate/harness-gate.test.ts` en verde |
| CA-10 | El mismo test exige `coding-policies` en la tabla de ambos READMEs y en `description` y `keywords` de ambos JSON |
| CA-11 | `node --test pi-extensions/*/*.test.ts`, `bash scripts/lint-frontmatter.sh`, `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh`, `git diff --check` |

Protocolo de prueba humana — CA-5 (contenido Go):

1. El implementador presenta el borrador de `references/go.md` con, por cada regla, la evidencia: guía de origen (Uber, Effective Go, Code Review Comments, Package Oriented Design) o patrón observado en cpanel, medicine-backend o mobctl con archivo de ejemplo.
2. Marcás cada regla como conservar, editar o sacar, y agregás las que falten.
3. Se aplica la poda y confirmás con un "aprobado" explícito antes del merge. Sin esa aprobación el PR queda en draft.

Protocolo de prueba humana — CA-7 (comportamiento real):

1. Copiá un repo Go a un directorio descartable (por ejemplo `cp -R ~/Sync/workspace/mobctl /tmp/cp-test`) e instalá el branch del PR en el harness a probar (Claude Code: plugin o `./install.sh claude` con `CLAUDE_SKILLS_DIR` temporal; Pi: `pi -e <ruta-del-checkout>` con configuración temporal).
2. Invocá el skill pelado. Esperado: detecta `go` en la raíz, lo muestra como cubierto, pregunta stacks y destino.
3. Confirmá. Esperado: existe `.sdd/coding-policies.md` con el marker de cabecera, la sección `## Go` con las reglas y la sección de ajustes vacía entre sus markers.
4. Aceptá el enganche solo en `AGENTS.md`. Esperado: `AGENTS.md` termina con el bloque `<!-- coding-policies -->` y `CLAUDE.md` no cambia.
5. Escribí dos líneas dentro de los markers de ajustes y volvé a invocar `coding-policies go --out .sdd/coding-policies.md`. Esperado: avisa que regenera, pregunta, y el archivo resultante conserva tus dos líneas verbatim.
6. Repetí el paso 2 en un repo solo Node. Esperado: informa `node` como "sin prácticas definidas todavía" y no genera archivo.

## Riesgos y gaps

- La conducta del agente al seguir el skill no tiene test: CA-7 depende de tu prueba. Un SKILL.md correcto no garantiza que cada modelo lo siga igual.
- El archivo generado es un snapshot: cuando cambien las referencias del skill, los proyectos no se actualizan solos. La regeneración y el marker de versión lo mitigan, no lo eliminan.
- `[ASSUMED]` 16, 17 y 18 surgieron al escribir la spec con sesgo mínimo; si querés otra conducta, se ajustan antes de ejecutar.
- Contratos generados por versiones viejas de `sdd-init` pueden no tener `## Politicas de generacion`; el enganche lo informa y no inventa la sección.
- `harness-gate` compara byte a byte el template del contrato: cualquier edición accidental de ese fence en un solo harness rompe CI. Por eso CA-9 lo deja intacto.
- El probe RPC del gate del package se skipea sin `pi` en PATH; CI lo corre con Pi 0.84.2. Localmente hay Pi 0.85.1, versión no contractual.
- Las cuatro copias de `references/go.md` deben ser byte a byte iguales; editar una sin propagar rompe el test nuevo (es deliberado).
- El contrato fue verificado el 2026-08-15/16, a 29 días: sigue dentro del umbral, pero conviene `sdd-init --update` después de este cambio porque suma un test y un skill al inventario.
