# Spec — Resolver linaje y próximo stage de artefactos SDD
<!-- Generada por /skill:sdd-spec el 2026-08-08. Fuente: issue #11. Estado: aprobada -->
<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#11; grill=none; superseded-by=none -->

## Contexto
El contrato y normalizador canónicos ya existen en `docs/sdd-tracking-v1.md` y `pi-extensions/sdd-artifacts/index.ts:726`, pero `pi-extensions/github-issues.ts:102-113` y `pi-extensions/grill-tools/index.ts:396-414` todavía leen estado e identidad con regex parciales. Los tres `issue-triage` existentes detectan artefactos (`pi/issue-triage/SKILL.md:61`) pero sólo definen rutas para trabajo nuevo (`:27-40`), por lo que no resuelven linaje, vigencia ni próximo stage. Las dependencias #9 y #10 están cerradas y mergeadas en `main`.

**Ejemplo de impacto:** hoy una spec canónica con `state=implemented` pero sin campo humano `Estado:` puede mostrarse como `sin estado`; después se resolverá como `already-implemented` y el triage se detendrá sin reejecutarla.

## Comportamiento esperado

### CA-1 — Inventario normalizado e identidad segura [ALTA]
Todo Markdown candidato se parsea mediante `parseSddArtifact`; ningún consumidor decide estado con un parser paralelo. El resolver recibe inputs explícitos y no consulta filesystem, red, reloj ni APIs Pi. Para el repo actual, `#11` y `chichex/skills#11` representan la misma identidad; una identidad canónica válida es autoritativa, mientras `Fuente`/`Source` y el nombre `issue-N-*` sólo pueden recuperar identidad legacy o ausente y deben dejar provenance/diagnóstico. Un artefacto asociado a otro issue o de tipo incompatible nunca se reasigna silenciosamente.

Paso/no-paso: fixtures canonical y legacy producen una única identidad normalizada, conservan format/provenance/diagnósticos y rechazan mismatches de tipo o issue.

### CA-2 — Equivalencia y conflicto entre copia local e issue [ALTA]
Dos ubicaciones son una sola spec lógica únicamente cuando tienen identidad equivalente y el mismo contenido normativo después de: (a) normalizar `CRLF`/`LF` y un único newline final; (b) normalizar la forma relativa/fully-qualified del issue dentro del marker para la comparación; y (c) quitar de la copia GitHub sólo un bloque terminal `<details><summary>Body original</summary>…</details>` usado como envoltorio de transporte. No se ignoran diferencias en estado, headings, criterios, resultados, prose ni metadata restante.

Copias equivalentes se deduplican y la local queda como `primary` para un eventual run. Cualquier otra divergencia devuelve `artifact-conflict`, conserva referencias y diagnóstico de ambas copias y no selecciona una por fecha.

### CA-3 — Linaje de specs y `superseded-by` [ALTA]
Las specs del mismo issue forman un grafo explícito por `superseded-by`. Sólo puede avanzar un linaje con una única hoja viva. Una referencia se sigue automáticamente sólo cuando resuelve de forma unívoca a un artefacto dentro del mismo proyecto o a un issue del mismo repo; rutas fuera de la raíz y repos externos no se siguen.

Una sucesora válida se vuelve a evaluar conforme a CA-4/CA-5. Un destino ausente, externo o no soportado produce el stop explícito `superseded-artifact`; ciclos, referencias ambiguas, hojas vivas paralelas o specs no enlazadas que compiten por el mismo issue producen `artifact-conflict`. El timestamp nunca desempata linajes.

### CA-4 — Vigencia trivaluada y conservadora [ALTA]
La vigencia de una spec es exactamente `fresh`, `stale` o `unknown`. El adapter construye evidencia temporal separando cambios materiales —título, body o comments— de cambios administrativos —labels, assignees o milestone—. Para una spec local, el baseline es la revisión/mtime del archivo; para una spec alojada en el issue, es la revisión del body que contiene la spec. Un evento material demostrablemente posterior produce `stale`; una cronología completa sin eventos posteriores produce `fresh`; timestamps faltantes, incomparables o historia insuficiente producen `unknown`.

El core recibe esa evidencia como datos y no infiere frescura desde la hora actual. `unknown` nunca habilita un run. Esta unidad no cambia SDD-Tracking v1 ni agrega digest/timestamp a sus productores.

### CA-5 — Matriz determinista del próximo stage [ALTA]
Luego de reconciliar identidad, copias, linaje y vigencia, se aplica exactamente esta tabla:

| Situación resuelta | Ruta recomendada | Resultado |
|---|---|---|
| Sin grill/spec asociado | clasificación normal existente | no inventar continuación |
| Grill único activo o pausado, sin spec downstream | `resume-grill` | `start`, stage `grill`, mode `resume` |
| Grill único finalizado, sin spec downstream | `spec-from-grill` | `start`, stage `spec`, mode `from-grill` |
| Spec `draft` | `update-existing-spec` | `start`, stage `spec`, mode `update` |
| Spec `approved` o legacy `pendiente de ejecución`, `fresh` | `run-existing-spec` | `start`, stage `run-existing-spec` |
| Spec `approved`, `stale` o `unknown` | `audit-existing-spec` | `start`, stage `spec`, mode `update` |
| Spec `implemented`, `fresh` | `already-implemented` | `stop`; nunca ejecutar |
| Spec `implemented`, `stale` o `unknown` | `audit-existing-spec` | `start`, stage `spec`, mode `update`; nunca reejecutar la spec vieja |
| Spec `superseded` con sucesora unívoca | ruta de la sucesora | reevaluar recursivamente |
| Spec `superseded` sin sucesora utilizable | `superseded-artifact` | `stop` explícito |
| Estado único desconocido/ausente pero asociable | `audit-existing-spec` | `start`, stage `spec`, mode `update` |
| Conflicto de identidad, markers, copias o linaje | `artifact-conflict` | `stop`; no elegir |

Una spec `draft` nunca salta a run. `implemented`/`already-implemented` nunca producen `run-existing-spec`, aun cuando el usuario haya elegido un fallback de la clasificación original.

### CA-6 — Linaje y precedencia de grills [ALTA]
El snapshot JSON es la autoridad runtime para `active`; el handoff Markdown es el artefacto interoperable para `paused|finalized`. Un snapshot `active` y su handoff previo `paused`, con el mismo grill id, son una sola sesión reanudada y no un conflicto. Para estados persistidos, identidad/estado compatibles se deduplican; desacuerdos no explicables quedan diagnosticados y bloquean.

`parentId`/`revision` forman el linaje runtime: una única revisión hoja puede avanzar y revisiones paralelas activas generan `artifact-conflict`. Una spec cuyo `grill` enlaza la hoja finalizada es downstream y toma precedencia; una spec y un grill no enlazados que compiten por el mismo issue son linajes paralelos y no se ordenan por timestamp.

### CA-7 — Metadata desconocida, inválida y conflictiva [ALTA]
Un único artefacto con forma/ubicación de spec y estado legacy desconocido, estado canónico inválido o metadata ausente se conserva con sus diagnósticos y toma `audit-existing-spec` sólo si puede asociarse de forma segura al issue. Un `ParseResult.kind=conflict`, markers divergentes, tipo incompatible, identidad contradictoria o varias copias/hojas no equivalentes toma `artifact-conflict`. Ningún error canónico cae silenciosamente a legacy ni desaparece de la evidencia.

### CA-8 — Selecciones `join-*` sólo desde la fuente canónica [ALTA]
Con varias fuentes, si todavía no existe un issue combinado recuperado/creado y utilizable, el resultado es `outcome=error`, `code=canonicalization`; no se inspeccionan artefactos de las fuentes para decidir una continuación. Una vez disponible, sólo los artefactos del issue canónico alimentan CA-1..CA-7. Las fuentes originales permanecen en `sources`/evidencia, pero sus specs o grills nunca se fusionan ni se usan como fallback.

### CA-9 — Recomendación y elección efectiva independientes [ALTA]
El resultado conserva por separado la clasificación recomendada, su fallback, la ruta recomendada tras resolver artefactos y la ruta elegida. Antes del gate humano, `selectedRoute=null`; confirmar la primaria copia exactamente la recomendada; elegir fallback registra el fallback sin sobrescribir la recomendación; cancelar produce `outcome=stop`, `code=cancelled` y conserva `selectedRoute=null`. Una revisión posterior puede comparar ambas decisiones sin reconstruirlas desde prose.

### CA-10 — Resultado estructurado y serializable v1 [ALTA]
El core devuelve una unión discriminada serializable a JSON, sin funciones, clases ni valores dependientes del proceso. Su forma mínima estable es:

```ts
type WorkflowResolutionV1 = {
  version: 1;
  outcome: "start" | "stop" | "error";
  code: string; // enum estable de ruta, stop o error
  recommendedClassification: NewWorkRoute | null;
  fallbackClassification: NewWorkRoute | null;
  recommendedRoute: WorkflowRoute | null;
  selectedRoute: WorkflowRoute | null;
  stage: "grill" | "spec" | "quick-run" | "run-existing-spec" | null;
  mode: "new" | "resume" | "update" | "from-grill" | null;
  repo: string;
  cwd: string;
  sources: IssueRef[];
  canonicalIssue: IssueRef | null;
  summary: string;
  impactExample: string;
  scope: string[];
  checklist: string[];
  evidence: EvidenceRef[];
  risks: string[];
  artifacts: ArtifactRef[];
};
```

`NewWorkRoute` conserva las rutas single/join y rechazos ya definidos por `issue-triage`; `WorkflowRoute` agrega `resume-grill`, `spec-from-grill`, `update-existing-spec`, `run-existing-spec`, `already-implemented`, `superseded-artifact`, `audit-existing-spec` y `artifact-conflict`. Los `ArtifactRef` exponen ubicación, identidad, tipo, estado, format/provenance, vigencia y diagnósticos. Todos los campos de dispatch son enums/códigos; `summary`, `impactExample`, evidencia y riesgos siguen siendo payload, no protocolo. `JSON.parse(JSON.stringify(result))` preserva el valor completo.

### CA-11 — Adopción por consumidores Pi [ALTA]
`github-issues` y el selector `/specs` de `grill-tools` obtienen estado, identidad y diagnósticos desde adapters del normalizador/resolver. Una spec canónica `draft|approved|implemented|superseded`, una legacy en inglés/español y una inválida se muestran/clasifican conforme al resultado normalizado; desaparecen los lectores duplicados `specState`/`specMetadata` basados sólo en `Estado:`. La acción de negocio no inicia ningún stage en esta unidad.

### CA-12 — Doctrina artifact-aware consistente [ALTA doctrina · NULA conducta emergente]
`claude/issue-triage/SKILL.md`, `codex/issue-triage/SKILL.md` y `pi/issue-triage/SKILL.md` resuelven artefactos antes de clasificar trabajo nuevo, contienen la matriz de CA-5, las reglas de CA-2/3/4/6/8 y el contrato de CA-9/10, y terminan tras confirmar/emitir el resultado sin ejecutar el stage. Un gate compara el bloque normativo entre los tres harnesses tolerando sólo diferencias documentadas de invocación/interacción. No se crea `opencode/issue-triage`.

Paso/no-paso autónomo: el gate falla ante una ruta/schema divergente y pasa sobre los tres archivos. Que los agentes sigan la doctrina y que la TUI la presente correctamente se valida con el protocolo humano del plan.

### CA-13 — Límite de integración preservado [ALTA]
El diff no crea/cambia sesiones Pi, no agrega dispatch ni tool terminal de orquestación, no ejecuta grill/spec/run, no extrae quick-run, no fusiona specs fuente, no modifica el contrato v1 ni sus productores y no instala recursos globales. #13 consumirá el tipo estructurado y #14 conectará los comandos de negocio; esta unidad sólo deja core, adapters, doctrina y tests utilizables.

## Fuera de alcance
- Crear, reemplazar o nombrar sesiones Pi; materializar skills; registrar `parentSession`; resolver cwd cross-project o manejar cancelación de un switch (#13).
- Conectar `/issues`, `/specs` o grill con ejecución real de stages, o despachar el resultado estructurado mediante una tool terminal (#14).
- Extraer el quick-run protegido a un skill dedicado (#12) o cambiar sus garantías.
- Cambiar `docs/sdd-tracking-v1.md`, agregar digest/timestamps al marker, mutar productores SDD o migrar artefactos de repos de usuarios.
- Fusionar specs/grills de issues fuente en una selección conjunta, seguir referencias superseded fuera del proyecto/repo o elegir conflictos por timestamp.
- Crear una versión nueva de `issue-triage` para OpenCode, ejecutar `./install.sh` o probar proveedores pagos.

## Inferencias

| # | Inferencia | Elección | Alternativa razonable | Confianza | Resolución |
|---|---|---|---|---|---|
| 1 | Modelo de vigencia sin digest/timestamp en metadata v1 | `fresh|stale|unknown`; sólo evidencia suficiente da `fresh`, cambios materiales posteriores dan `stale` y evidencia incompleta da `unknown` | Comparar sólo `updatedAt`/mtime; ampliar metadata con digest | baja | confirmada |
| 2 | Precedencia de staleness | Aplicar vigencia antes del routing: draft actualiza; approved/unknown/implemented stale o unknown auditan; implemented vieja nunca corre | `implemented` siempre termina como already-implemented | baja | confirmada |
| 3 | Equivalencia local/GitHub | Igualdad normativa tras normalizar EOL, issue ref y archive terminal; toda otra diferencia es conflicto | Bytes exactos; comparar sólo metadata | media | confirmada |
| 4 | Identidad del issue | Normalizar referencia relativa/full contra el repo; canonical manda y filename/Fuente sólo recuperan legacy | Strings exactos; filename prioritario | alta | confirmada |
| 5 | Linaje y superseded | Única hoja viva; seguir sólo referencias unívocas same-project/same-repo; ciclos/ramas frenan | Elegir por timestamp; detener siempre | media | confirmada |
| 6 | Reconciliación de grills | Snapshot gobierna runtime active, handoff lo persistido; deduplicación/revisiones y precedencia downstream explícitas | Elegir siempre el artefacto más reciente | baja | confirmada |
| 7 | Metadata defectuosa | Unknown/ausente asociable audita; divergencia, tipo o identidad incompatible bloquean | Auditar todo; ignorar inválidos | media | confirmada |
| 8 | Canonicalización join | No avanzar sin issue canónico; luego ignorar artefactos fuente para routing | Usar fuentes como fallback | alta | confirmada |
| 9 | Schema serializable | Unión versionada `start|stop|error` con recomendación y elección separadas | Objeto plano con un único route | media | confirmada |
| 10 | Límite de integración | Core/adapters/doctrina ahora; dispatch, tool terminal y sesiones en #13/#14; sin OpenCode nuevo | Integrar tool Pi u OpenCode ahora | media | confirmada |

## Verificabilidad
La verificabilidad es **mixta, mayormente ALTA**, anclada en `.sdd/project.md`:

- **ALTA — CA-1..CA-11 y CA-13:** son transformaciones puras, adapters aislables, propiedades de archivos o límites de diff. El contrato declara `node --test pi-extensions/*/*.test.ts` verificado y captura automáticamente tests bajo `pi-extensions/<módulo>/*.test.ts`; durante el triage `node --test pi-extensions/sdd-artifacts/*.test.ts` pasó 34/34.
- **ALTA doctrina / NULA conducta emergente — CA-12:** `node:test` puede comparar los tres SKILL.md y validar sus bloques; el contrato dice que la conducta real de agentes siguiendo un skill y los flujos TUI requieren sesión humana.
- **Integración local:** el smoke `pi ... --list-models` observa imports/inicialización sin abrir TUI ni tocar configuración global.
- **Gap de type-safety:** no hay `tsconfig`, typecheck ni lint TypeScript; los tests prueban ejecución real bajo Node, no una garantía estática global.
- El contrato no declara tamaño máximo de PR, coverage mínimo ni prohibición de dependencias. El alcance es transversal pero una sola unidad cohesiva; no exige partición. La implementación no necesita dependencias nuevas.

## Plan de verificacion
Mecanismo confirmado: **TDD focalizado + adapters + regresión**, sin ejecutar `./install.sh`.

1. **CA-1, CA-3..CA-10 — resolver puro:** crear una suite capturada por `node --test pi-extensions/*/*.test.ts`. Empezar con tests rojos table-driven para todos los estados/rutas, staleness `fresh|stale|unknown`, fallback/cancelación, serialización round-trip, canonicalización join, superseded válido/ausente/cíclico/paralelo e identidad relativa/full. El core recibe fixtures y timestamps; cero I/O.
2. **CA-2 — reconciliación:** fixtures pareados local/issue para bytes idénticos, EOL distinto, marker relativo/full, archive terminal permitido, diferencia de estado y diferencia de body. Assertions: dedup + local primary o `artifact-conflict` con ambas refs.
3. **CA-6 — grills:** fixtures de snapshot/handoff para active+paused legítimo, paused/finalized, falta de handoff, revisión lineal, hojas paralelas, spec enlazada y spec no enlazada.
4. **CA-7 — parser/adapters:** reutilizar fixtures de `sdd-artifacts` para canonical, legacy ES/EN, unsupported version, invalid, duplicate-identical y duplicate-divergent; comprobar provenance/diagnósticos y que no hay fallback inseguro.
5. **CA-11 — consumidores:** tests de helpers/adapters puros usados por `github-issues` y `grill-tools`; una canonical implemented sin `Estado:` debe producir `implemented`, y `rg`/revisión del diff confirma que los parsers regex duplicados desaparecieron.
6. **CA-12 — gate cross-harness:** test que extrae un bloque normativo delimitado de los tres `issue-triage`, compara rutas, matriz y shape v1 tras normalizar diferencias de interacción, falla ante drift inyectado y pasa sobre el árbol final.
7. **CA-13 — límites:** `git diff --name-status origin/main...HEAD` y búsqueda focalizada verifican que no hay orquestador/session switch, tool terminal, nuevo `opencode/issue-triage`, cambios a `docs/sdd-tracking-v1.md`/productores ni extracción de quick-run.
8. **Regresión/estática:** `node --test pi-extensions/*/*.test.ts`; `bash scripts/lint-frontmatter.sh`; `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh`; `git diff --check`.
9. **Smoke de carga:** `args=(); for extension in pi-extensions/*.ts pi-extensions/*/index.ts; do [ -f "$extension" ] && args+=(--extension "$extension"); done; pi "${args[@]}" --list-models`.

**Protocolo humano para la cara NULA de CA-12** — después de autorizar por separado una instalación en un entorno descartable: (1) abrir `/issues` con una spec canónica `implemented` sin `Estado:` y comprobar que se presenta/resuelve como `already-implemented`; (2) agregar un comentario material posterior a una spec approved local y comprobar `audit-existing-spec`, nunca run; (3) elegir el fallback de un triage sin artefactos y comprobar que recomendación y elección aparecen distintas en el resultado; (4) confirmar que la session id no cambia y que no se inicia ningún skill, branch, worktree ni stage.

## Riesgos y gaps
- GitHub no siempre entrega historia temporal suficiente con la consulta actual. El adapter debe degradar a `unknown` y auditar; esto puede producir auditorías conservadoras, nunca runs falsamente seguros.
- La normalización de equivalencia ignora sólo un archive terminal bien formado. Cualquier edición manual adicional entre la copia local y GitHub bloqueará hasta auditar/reconciliar.
- Referencias `superseded-by` son strings libres en v1; sólo el subconjunto same-project/same-repo resoluble avanza automáticamente. Lo demás se detiene de forma explícita.
- El snapshot global puede estar disponible sin handoff de repo si una escritura previa falló; la evidencia debe conservar el diagnóstico y nunca inventar contenido interoperable.
- No hay typecheck/lint TypeScript ni e2e automatizado de TUI/agentes. CI y el protocolo humano son las únicas señales adicionales al runtime unitario.
- #13 y #14 dependen de la estabilidad de `WorkflowResolutionV1`; cambios incompatibles posteriores deberán versionar el schema, no reinterpretar v1.
- Las dependencias declaradas #9 y #10 están cumplidas; #12, #13 y #14 quedan deliberadamente fuera de esta ejecución.
