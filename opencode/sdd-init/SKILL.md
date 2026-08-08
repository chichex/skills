---
name: sdd-init
description: Explora el proyecto a fondo y genera .sdd/project.md — el "contrato de autonomía" que le dice a OpenCode cómo correr, testear y buildear la app, qué ambientes hay, cuál usar para probar, y qué puede verificar sin un humano. Usar SIEMPRE que el usuario quiera inicializar SDD, preparar un repo para trabajo autónomo, documentar el harness del proyecto (cómo se corre/testea/buildea), o cuando otro skill sdd-* necesite un .sdd/project.md que no existe o está desactualizado. También cuando el usuario diga "quiero que opencode pueda trabajar solo acá", "documenta cómo se testea esto" o similar.
---

Explora el proyecto y genera `.sdd/project.md`: el **contrato de autonomía** que los demás skills `sdd-*` (spec, run) consumen para trabajar sin humano. No es documentación aspiracional: cada comando documentado se EJECUTA antes de escribirse, y lo que no se pudo verificar queda marcado como tal. Los argumentos pueden traer pistas libres ("es un monorepo, ignora apps/legacy", "el ambiente de prueba es staging") o ir vacío.

Skill operativo con una fase interactiva acotada: explora solo, verifica solo, y pregunta ÚNICAMENTE lo que el código no puede responder.

## Qué es el contrato de autonomía

`.sdd/project.md` responde, con evidencia, las preguntas que un agente autónomo necesita antes de tocar código:

1. **Cómo se corre / testea / buildea** — comandos exactos, cwd, duración, y si fueron verificados ejecutándolos.
2. **Qué ambientes existen y cuál puedo usar para probar** — local, staging, prod; env vars y de dónde salen.
3. **Qué puedo verificar sin humano** — la escalera de verificación: typecheck < unit < build < levantar la app y probarla < e2e. Hasta qué escalón llega este repo y cómo se sube cada uno.
4. **Qué NO debo hacer sin humano** — deploy, migraciones, push, tocar servicios pagos.
5. **Bajo qué políticas genero código** — preferencias que el usuario ELIGE (tamaño máximo de PR, coverage mínimo, dependencias nuevas, convención de commits, políticas propias de la tecnología) y que `/sdd-run` aplica como gates duros — o sigue como `guia` explícita cuando no hay gate medible. Solo son activables como gate las políticas cuyo mecanismo de medición esté verificado en este repo.

Se referencia desde el `AGENTS.md` del proyecto (línea `@.sdd/project.md`) para que TODA sesión lo cargue, no solo las sdd; `CLAUDE.md` encadena vía `@AGENTS.md` para que Claude Code también lo herede.

## Argumentos

```text
/sdd-init [pistas libres] [--assume] [--no-verify] [--update] [--no-import]
```

- `--assume` — cero preguntas: los gaps se resuelven con la assumption más conservadora y quedan marcados `[NEEDS-INPUT]` en el doc. Para correr desatendido.
- `--no-verify` — no ejecutar comandos: documenta lo detectado como `no probado`. Útil en repos con builds carísimos.
- `--update` — refresco de un `.sdd/project.md` existente: re-explora, re-verifica, pero PRESERVA la sección `## Decisiones humanas` y las respuestas previas. Además ofrece las capacidades que el skill ganó desde que el contrato se generó (ver "## Upgrade de contrato").
- `--no-import` — no tocar `AGENTS.md` ni `CLAUDE.md`.

## Fase 0 — Lanzador (solo con `/sdd-init` pelado)

Dispara SOLO cuando los argumentos vienen vacíos. Si trajo pistas o flags, saltear: el usuario ya dijo por dónde va.

Si `.sdd/project.md` ya existe, decirlo primero (`Ya hay un contrato del <fecha>. Esto lo actualiza.`) y tratar toda elección como `--update` — incluida la oferta de mejoras de "## Upgrade de contrato" si el contrato es de una versión anterior del skill.

```text
/sdd-init explora el repo y genera .sdd/project.md: el contrato de autonomia que guia a
OpenCode cuando trabaja solo. Hay dos perillas: si EJECUTO los comandos que encuentre
(test/build/dev server) para probar que de verdad funcionan, y si te PREGUNTO las dudas
que el codigo no responde o las asumo solo. En modo interactivo tambien te ofrezco
activar politicas de generacion (tamaño maximo de PR, coverage minimo, dependencias,
commits, politicas de tu tecnologia) que /sdd-run aplica como gates duros.

  • Verificar y preguntar — ejecuta los comandos para probarlos, y pregunta
                            solo lo que no pueda deducir del codigo. (default)
  • Sin ejecutar nada     — documenta lo que detecta sin correr ningun comando;
                            quedan como "no probado". Para builds/tests muy
                            caros o lentos.                          (--no-verify)
  • Sin preguntar nada    — ejecuta y verifica, pero no te interrumpe: cada duda
                            se asume conservadora y queda [NEEDS-INPUT] en el doc
                            para revisar despues.                    (--assume)

Atajo: /sdd-init <pistas> [--assume] [--no-verify] saltea este menu.
```

Luego usar `question` — una pregunta, "¿Ejecuto los comandos para verificarlos, y te pregunto las dudas?":

1. `Verificar y preguntar (Recomendado)` — ejecuta test/build para probar que funcionan; pregunta solo los gaps que el código no responde.
2. `Sin ejecutar nada` — solo explora y documenta; los comandos quedan `no probado` (`--no-verify`).
3. `Sin preguntar nada` — corre desatendido; las dudas se asumen conservadoras y quedan `[NEEDS-INPUT]` (`--assume`).

## Fase 1 — Exploración

Lanzar subagents `explore` con la herramienta `task` en paralelo (en repos chicos, <30 archivos, hacerlo inline):

```text
task(subagent_type: "explore", description: "harness del proyecto", prompt: |
  Releva el harness de este proyecto para un agente autonomo. Devolve texto plano:
  1. STACK: lenguajes, frameworks, package manager (segun lockfile), estructura (monorepo?).
  2. COMANDOS: como correr / testear / buildear / lint / typecheck. Fuente exacta
     (package.json scripts, Makefile, justfile, Cargo.toml, go.mod, pyproject...).
     Por comando: cwd y que hace de verdad (leer el script, no adivinar del nombre).
  3. TESTS: framework, cuantos archivos de test hay, unit vs integration vs e2e.
  Busqueda breadth: medium.)

task(subagent_type: "explore", description: "ambientes y verificabilidad", prompt: |
  Releva ambientes y verificabilidad de este proyecto. Devolve texto plano:
  1. AMBIENTES: .env*, docker-compose, configs por ambiente, URLs de staging/prod.
  2. ENV VARS: cuales necesita la app para arrancar (leer donde se consumen), cuales
     ya estan resueltas (archivo .env presente, defaults) y cuales faltan.
  3. CI: que corre el CI (.github/workflows, etc.) — eso define que "tiene que pasar".
  4. SERVICIOS EXTERNOS: DBs, APIs, colas de las que depende la app para correr local.
  5. GIT: cual es el branch default del repo (main/master/otro — `git symbolic-ref refs/remotes/origin/HEAD`
     o el branch actual si no hay remote), remotes configurados (git remote -v) y si `gh auth status`
     responde ok — esto determina desde donde se ramifica y si un agente puede crear PRs.
  Busqueda breadth: medium.)
```

Integrar las pistas de los argumentos como prioridad sobre lo detectado.

## Fase 2 — Verificación empírica (saltear con `--no-verify`)

La razón de ser del skill: un contrato con comandos no probados vale poco, porque el agente autónomo que lo lea va a fallar en su primer paso. Ejecutar y registrar:

1. **Deps**: si faltan (`node_modules`, venv, etc.), correr el install del package manager del repo y documentarlo como prerequisito.
2. **Comandos finitos** (test, build, lint, typecheck, coverage si el repo tiene tooling): correrlos con timeout de 120s c/u. Registrar: `verificado <fecha>` + duración + resumen (ej. "84 tests pasan"), o `FALLA` + el error resumido (una falla NO aborta el skill: se documenta y sigue — saber que el build está roto es exactamente el tipo de cosa que el contrato debe decir). Para coverage, registrar además el **% actual en las Notas: es el baseline** que la Fase 3.5 usa para anclar el gate.
3. **Procesos largos** (dev server, app): arrancar en background, esperar la señal de vida (puerto abierto, línea de log), registrar cómo se reconoce el "está arriba" (ej. `curl -sf localhost:5173` responde), y MATARLO. Si no levanta en 60s, anotar `no levanta: <motivo>`.
4. Lo que exceda timeout o requiera credenciales ausentes: `no probado (<motivo>)`. Nunca inventar el estado.

## Fase 3 — Gaps: preguntar solo lo no inferible

Listar las preguntas que el código NO respondió. Típicas: ¿cuál ambiente uso para probar?, ¿de dónde saco las env vars que faltan?, ¿hay datos de prueba / seeds?, ¿qué cosas requieren confirmación humana además de los defaults (deploy, migraciones, push)?

- Preguntar con `question`, de a UNA, opciones concretas derivadas de la exploración, la recomendada primera y marcada `(Recomendado)`. Máximo 5 preguntas; si hay más gaps, priorizar por impacto en autonomía y el resto va a `## Gaps`.
- Lo ya claro NO se pregunta: preguntar lo inferible erosiona la confianza en el skill.
- Con `--assume` (o si el usuario no responde): assumption más conservadora (ej. "solo local, nunca staging"), documentada en el doc con `[NEEDS-INPUT]`.

## Fase 3.5 — Políticas de generación

Ofrecer las políticas de generación: preferencias que el usuario ELIGE — nunca se infieren — y que `/sdd-run` aplica como **gates duros**: una política incumplida es FALLA visible (PR en draft), jamás se maquilla. Regla de oro: **solo es activable como gate la política cuyo gate se puede medir en ESTE repo hoy** — por eso esta fase corre después de la verificación empírica, que ya estableció qué tooling hay. Una preferencia sin gate medible puede entrar únicamente como **`guia`** explícita (ver Políticas de la tecnología): orienta la generación, no gatea.

Menú v1 (cada política con su gate — el mecanismo con el que `/sdd-run` la va a medir):

| Politica | Valor | Gate |
|---|---|---|
| Tamaño máximo de PR | N líneas de diff y/o M archivos (sugerido: 400 / 15) | `git diff --stat <base>...HEAD`, excluyendo lockfiles y archivos generados |
| Coverage mínimo | umbral anclado al baseline actual | correr el comando y comparar contra el umbral; activable SOLO si el comando figura `verificado` en `## Comandos` con su baseline medido |
| Dependencias nuevas | prohibido / preguntar / libre | diff sobre manifest + lockfile contra el base |
| Commits convencionales | patrón (ej. `tipo(scope): resumen`) | cada mensaje del branch matchea el patrón |
| Políticas de la tecnología (custom) | preferencia libre del stack: guía de estilo (ej. Uber para Go), max líneas por archivo, naming, constructos prohibidos | el más barato que la observe: regla de linter con config verificada, script del contrato o grep; sin gate medible queda como `guia` |

Reglas:

- Usar `question` — "¿Activás alguna política de generación?": una opción por política ACTIVABLE (selección múltiple si el harness la soporta; si no, de a una política por pregunta). Si el usuario no elige ninguna, la sección queda vacía. Por cada elegida, UNA pregunta de valor con defaults sugeridos como opciones.
- Política no medible = no ofrecida. Coverage sin comando de coverage verificado no aparece en el menú: se anota en `## Gaps` ("coverage no activable: no hay tooling de coverage verificado") y se ofrece activarla cuando el tooling exista.
- **Baseline primero (coverage)**: el umbral se elige mirando el % actual medido en Fase 2, nunca en el aire. Ofrecer: `No bajar del baseline (X%) (Recomendado)` — ratchet, cumplible desde el día uno — / un % fijo que el repo YA cumple / custom. Un umbral por encima del baseline nace en FALLA (pedir 90% con un repo en 10% = todos los PRs en draft para siempre): decirlo con los dos números sobre la mesa y aceptarlo SOLO si el usuario lo confirma viendo el baseline; queda anotado `aspiracional` junto al baseline.
- **Políticas de la tecnología (custom)**: el usuario describe la preferencia en texto libre ("seguir la guía de estilo de Uber en Go", "max 300 líneas por archivo", "prohibir panic() fuera de main"). Por cada una, proponer el gate MÁS BARATO que la observe — regla de un linter ya configurado > config nueva de un linter que el repo ya tiene > script corto del contrato (ej. `wc -l` sobre los archivos del diff) > grep — y VERIFICARLO ejecutándolo antes de escribirlo, como cualquier comando. Sin gate medible, ofrecer escribirla como **`guia`**: `/sdd-run` la sigue al GENERAR el código y el reviewer la juzga en el PR — una `guia` nunca se reporta verificada ni gatea. Si un linter la haría medible pero falta configurarlo, anotarlo en `## Gaps` ("sería gate si golangci-lint tuviera config").
- Pistas de los argumentos que fijen políticas ("coverage 80", "PRs de max 300 líneas") cuentan como elección del usuario: se activan sin preguntar (verificando igual que el gate sea medible). Única excepción: un umbral de coverage por encima del baseline se confirma igual — regla del baseline.
- Con `--assume`: ninguna política se activa — son elecciones humanas, no se asumen.
- Con `--update` y políticas ya activas: preguntar `Mantener (Recomendado)` / `Revisar` — mantener preserva la sección verbatim; revisar re-abre el menú con los valores actuales como default. Si el menú ganó políticas que el contrato no conocía (ej. las de tecnología), decirlo en esa misma pregunta.

## Upgrade de contrato (corridas sobre contrato existente)

El skill evoluciona; los contratos generados por versiones anteriores no. En TODA corrida sobre un `.sdd/project.md` existente (`--update` explícito o lanzador que lo detectó), antes de escribir: cruzar el contrato viejo contra esta **checklist de capacidades** y detectar cuáles le faltan. La detección es estructural — se mira el doc, no hace falta versionado:

| Capacidad | Cómo detectar que falta en el contrato viejo |
|---|---|
| Políticas de generación | no existe la sección `## Politicas de generacion` |
| Baseline de coverage | hay política de coverage activa sin baseline anotado junto al umbral |
| Políticas de la tecnología | `## Politicas de generacion` existe pero sin filas custom ni `guia` (el menú que la generó no las ofrecía) |
| Capacidad de Git/PR | `## Ambientes` no declara branch default, remote o estado de `gh` |
| Señal de vida de procesos largos | comandos `run` sin el "cómo se reconoce que está arriba" |

Con faltantes: listarlos como texto visible (una línea por capacidad, con qué aporta) y usar `question` — "El contrato es de una versión anterior del skill; ¿qué mejoras le agrego?". SOLO lo elegido se releva, pregunta y escribe, cada capacidad con el mecanismo de su fase (ej. elegir `Politicas de generacion` se resuelve con el menú de la Fase 3.5); lo no elegido no se anota como gap — es una elección, no una deuda. Con `--assume`: no se agrega ninguna (varias exigen elección humana); quedan en el reporte como `mejoras disponibles`.

**Regla de mantenimiento del skill**: al agregarle una capacidad nueva a este skill, sumar SIEMPRE su fila a esta checklist. Es lo que hace que los contratos viejos se pongan al día preguntando, en vez de quedar silenciosamente desactualizados.

## Fase 4 — Escribir el contrato

Escribir `.sdd/project.md` con EXACTAMENTE esta estructura:

```markdown
# Contrato de autonomia — <proyecto>
<!-- Generado por /sdd-init el <fecha>. Refrescar con /sdd-init --update. -->
<!-- SDD-Tracking: version=1; type=project; generated-at=<YYYY-MM-DD> -->

## Stack
<lenguajes, frameworks, package manager, estructura; 3-6 lineas>

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| test | pnpm test | . | verificado 2026-07-02 | 12s | 84 tests pasan |
| build | pnpm build | . | FALLA | 40s | TS2345 en src/x.ts — ver Gaps |
| run | pnpm dev | . | verificado 2026-07-02 | — | listo cuando responde curl -sf localhost:5173 |

## Ambientes
<cuales hay, CUAL usar para probar, env vars: resueltas vs faltantes y de donde salen.
Git: branch default del repo (main/master/otro) — /sdd-run ramifica desde ahi.
Capacidad de PR: remote configurado + gh autenticado, o "sin remote — /sdd-run termina
en commit local". /sdd-run lee estas lineas antes de ramificar o pushear.>

## Verificacion autonoma
<la escalera para ESTE repo, en orden de confianza creciente, con el como concreto de
cada escalon. Y explicitamente que NO se puede verificar sin humano, con el motivo.>

## Limites
<que NO hacer sin confirmacion humana. Defaults siempre presentes: deploy, migraciones
sobre datos compartidos, git push a main, tocar servicios pagos. Mas lo que sumo el usuario.>

## Politicas de generacion
<gates duros que /sdd-run verifica antes de abrir el PR. Elegidas por el usuario en
Fase 3.5, nunca inferidas; si no activo ninguna: "Sin politicas activas. Configurar
con /sdd-init --update." Formato tabla, cada fila con su gate concreto:
| Politica | Valor | Gate |
| tamaño-pr | max 400 lineas / 15 archivos | git diff --stat vs base, sin lockfiles |
| coverage | no bajar del baseline (82%, 2026-07-20) | pnpm test -- --coverage (verificado en Comandos) |
| max-lineas-archivo | 300 por archivo tocado | script: wc -l sobre los archivos del diff |
| estilo-go | guia de estilo de Uber | guia — sin gate medible: /sdd-run la sigue al generar, la juzga el reviewer |>

## Decisiones humanas
<respuestas de la Fase 3, una bullet por decision con fecha. INTOCABLE en --update.>

## Gaps
<[NEEDS-INPUT] pendientes + comandos FALLA/no probados que un humano deberia mirar.>
```

La línea `SDD-Tracking` es el marker canónico de tracking (contrato SDD-Tracking v1): `version` y `type` son fijos, y `generated-at` lleva la fecha de ESTA corrida en `YYYY-MM-DD`. Mantenerlo como upsert idempotente: exactamente un marker por contrato — en `--update` se actualiza la fecha en la línea existente (o se inserta si el contrato viejo no la tenía), nunca se duplica ni se mueve. El H1 y los headers de sección quedan intactos.

En `--update`: regenerar todo salvo `## Decisiones humanas` y `## Politicas de generacion` (preservar verbatim — las políticas solo cambian si el usuario eligió `Revisar` en Fase 3.5) y los `[NEEDS-INPUT]` aún sin respuesta (mantenerlos, no duplicarlos).

## Fase 5 — Import en AGENTS.md + encadenado de CLAUDE.md (saltear con `--no-import`)

Cablear el contrato en dos eslabones, para que lo carguen tanto OpenCode (lee `AGENTS.md`) como Claude Code (lee `CLAUDE.md`):

1. **AGENTS.md** — si existe y no contiene `@.sdd/project.md`: agregar al final una línea `@.sdd/project.md`. Si no existe: crearlo con solo esa línea. Si ya está: no tocar nada.
2. **CLAUDE.md** — si existe y no contiene `@AGENTS.md` ni `@.sdd/project.md`: agregar al final una línea `@AGENTS.md` (encadena al eslabón 1 sin duplicar contenido). Si no existe: crearlo con solo `@AGENTS.md`. Si ya tiene cualquiera de los dos imports: no tocar nada.

## Reporte

```text
Contrato de autonomia listo: .sdd/project.md
- comandos: <N> documentados (<K> verificados, <F> fallan, <P> no probados)
- escalera de verificacion: llega hasta <escalon mas alto>
- politicas de generacion: <lista con valores | ninguna activa>
- preguntas hechas: <K> · gaps abiertos: <G>
- import en AGENTS.md: <agregado|ya estaba|--no-import> · CLAUDE.md: <encadenado|ya estaba|--no-import>
<en corridas sobre contrato existente: mejoras de version agregadas, u ofrecidas y no
tomadas ("mejoras disponibles" con --assume), una linea>
<si hay FALLAs o gaps criticos, una linea por cada uno>
```

## MUST DO

- Ejecutar los comandos antes de documentarlos como verificados (salvo `--no-verify`); distinguir siempre `verificado` / `FALLA` / `no probado (<motivo>)`.
- Matar todo proceso largo que se haya arrancado para verificar.
- Preguntar solo gaps reales, de a una pregunta, con recomendación.
- Ofrecer como gate SOLO lo que tiene gate medible en este repo, y escribir cada política activa con su gate concreto; una preferencia sin gate medible entra únicamente como `guia` explícita. El umbral de coverage se elige siempre contra el baseline medido, nunca en el aire.
- En corridas sobre un contrato existente, cruzarlo contra la checklist de "## Upgrade de contrato" y OFRECER los faltantes — nunca agregarlos sin preguntar, nunca callarlos.
- Preservar `## Decisiones humanas` y `## Politicas de generacion` en `--update`.
- Ser idempotente: re-correr sobre un repo ya inicializado actualiza, no duplica (ni el doc ni los imports de AGENTS.md/CLAUDE.md).

## MUST NOT DO

- No correr NADA que mute estado externo o compartido: deploy, publish, migraciones contra DBs remotas, git push. La verificación es local y read-only hacia afuera.
- No documentar comandos adivinados por el nombre del script sin leer qué hacen.
- No preguntar lo que la exploración ya respondió.
- No escribir secrets ni valores de env vars en el contrato — solo el NOMBRE de la var y de dónde sale.
- No inferir ni asumir políticas de generación: si el usuario no las eligió (o corrió `--assume`), la sección queda vacía. Y no activar una cuyo gate no se pueda medir hoy (coverage sin comando verificado va a Gaps, no al contrato). Una preferencia sin gate medible jamás se disfraza de gate: o es `guia` explícita o no entra.
- No pisar un `.sdd/project.md` editado a mano sin preservar `## Decisiones humanas`.
- No commitear nada.
