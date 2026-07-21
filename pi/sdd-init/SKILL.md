---
name: sdd-init
description: Explora el proyecto a fondo y genera .sdd/project.md — el "contrato de autonomia" que le dice a Pi como correr, testear y buildear la app, que ambientes hay, cual usar para probar, y que puede verificar sin un humano. Usar SIEMPRE que el usuario quiera inicializar SDD, preparar un repo para trabajo autonomo, documentar el harness del proyecto (como se corre/testea/buildea), o cuando otro skill sdd-* necesite un .sdd/project.md que no existe o esta desactualizado. Tambien cuando el usuario diga "quiero que Pi pueda trabajar solo aca", "documenta como se testea esto" o similar.
---

Explora el proyecto y genera `.sdd/project.md`: el **contrato de autonomia** que los demas skills `sdd-*` (spec, run) consumen para trabajar sin humano. No es documentacion aspiracional: cada comando documentado se EJECUTA antes de escribirse, y lo que no se pudo verificar queda marcado como tal. Los argumentos pueden traer pistas libres ("es un monorepo, ignora apps/legacy", "el ambiente de prueba es staging") o ir vacio.

Skill operativo con una fase interactiva acotada: explora solo, verifica solo, y pregunta UNICAMENTE lo que el codigo no puede responder.

## Que es el contrato de autonomia

`.sdd/project.md` responde, con evidencia, las preguntas que un agente autonomo necesita antes de tocar codigo:

1. **Como se corre / testea / buildea** — comandos exactos, cwd, duracion, y si fueron verificados ejecutandolos.
2. **Que ambientes existen y cual puedo usar para probar** — local, staging, prod; env vars y de donde salen.
3. **Que puedo verificar sin humano** — la escalera de verificacion: typecheck < unit < build < levantar la app y probarla < e2e. Hasta que escalon llega este repo y como se sube cada uno.
4. **Que NO debo hacer sin humano** — deploy, migraciones, push, tocar servicios pagos.
5. **Bajo que politicas genero codigo** — preferencias que el usuario ELIGE (tamaño maximo de PR, coverage minimo, dependencias nuevas, convencion de commits) y que `/skill:sdd-run` aplica como gates duros. Solo son activables las politicas cuyo mecanismo de medicion este verificado en este repo.

Se referencia desde el `AGENTS.md` del proyecto con una instruccion explicita para que Pi lo lea antes de trabajar en el repo. `CLAUDE.md` conserva el import `@.sdd/project.md` para Claude Code.

## Argumentos

```text
/skill:sdd-init [pistas libres] [--assume] [--no-verify] [--update] [--no-import]
```

- `--assume` — cero preguntas: los gaps se resuelven con la assumption mas conservadora y quedan marcados `[NEEDS-INPUT]` en el doc. Para correr desatendido.
- `--no-verify` — no ejecutar comandos: documenta lo detectado como `no probado`. Util en repos con builds carisimos.
- `--update` — refresco de un `.sdd/project.md` existente: re-explora, re-verifica, pero PRESERVA la seccion `## Decisiones humanas` y las respuestas previas. Ademas ofrece las capacidades que el skill gano desde que el contrato se genero (ver "## Upgrade de contrato").
- `--no-import` — no tocar `AGENTS.md` ni `CLAUDE.md`.

## Fase 0 — Lanzador (solo con `/skill:sdd-init` pelado)

Dispara SOLO cuando los argumentos vienen vacios. Si trajo pistas o flags, saltear: el usuario ya dijo por donde va.

Si `.sdd/project.md` ya existe, decirlo primero (`Ya hay un contrato del <fecha>. Esto lo actualiza.`) y tratar toda eleccion como `--update` — incluida la oferta de mejoras de "## Upgrade de contrato" si el contrato es de una version anterior del skill.

```text
/skill:sdd-init explora el repo y genera .sdd/project.md: el contrato de autonomia que guia a
Pi cuando trabaja solo. Hay dos perillas: si EJECUTO los comandos que encuentre
(test/build/dev server) para probar que de verdad funcionan, y si te PREGUNTO las dudas
que el codigo no responde o las asumo solo. En modo interactivo tambien te ofrezco
activar politicas de generacion (tamaño maximo de PR, coverage minimo, dependencias,
commits) que /skill:sdd-run aplica como gates duros.

  • Verificar y preguntar — ejecuta los comandos para probarlos, y pregunta
                            solo lo que no pueda deducir del codigo. (default)
  • Sin ejecutar nada     — documenta lo que detecta sin correr ningun comando;
                            quedan como "no probado". Para builds/tests muy
                            caros o lentos.                          (--no-verify)
  • Sin preguntar nada    — ejecuta y verifica, pero no te interrumpe: cada duda
                            se asume conservadora y queda [NEEDS-INPUT] en el doc
                            para revisar despues.                    (--assume)

Atajo: /skill:sdd-init <pistas> [--assume] [--no-verify] saltea este menu.
```

Luego usar `ask_user_question` — una pregunta, "¿Ejecuto los comandos para verificarlos, y te pregunto las dudas?":

1. `Verificar y preguntar (Recomendado)` — ejecuta test/build para probar que funcionan; pregunta solo los gaps que el codigo no responde.
2. `Sin ejecutar nada` — solo explora y documenta; los comandos quedan `no probado` (`--no-verify`).
3. `Sin preguntar nada` — corre desatendido; las dudas se asumen conservadoras y quedan `[NEEDS-INPUT]` (`--assume`).

## Fase 1 — Exploracion

Explorar con `read` y `bash`. Agrupar con `multi_tool_use.parallel` solo las lecturas y comprobaciones independientes; mantener el ownership en el agente principal. Relevar dos lentes y luego integrarlos:

1. **Harness**: stack, lenguajes, frameworks, package manager segun lockfile, estructura/monorepo; comandos de run, test, build, lint y typecheck con su fuente exacta (`package.json`, Makefile, justfile, Cargo.toml, go.mod, pyproject, etc.); leer cada script antes de describirlo; framework y distribucion de tests unit/integration/e2e.
2. **Ambientes y verificabilidad**: `.env*`, compose y configs por ambiente; nombres de env vars consumidas (nunca sus secretos), defaults y faltantes; CI; servicios externos; branch default (`git symbolic-ref refs/remotes/origin/HEAD` o branch actual), remotes y `gh auth status`.

Integrar las pistas de los argumentos como prioridad sobre lo detectado. Toda conclusion debe citar su archivo o comando fuente.

## Fase 2 — Verificacion empirica (saltear con `--no-verify`)

La razon de ser del skill: un contrato con comandos no probados vale poco, porque el agente autonomo que lo lea va a fallar en su primer paso. Ejecutar y registrar:

1. **Deps**: si faltan (`node_modules`, venv, etc.), correr el install del package manager del repo y documentarlo como prerequisito.
2. **Comandos finitos** (test, build, lint, typecheck, coverage si el repo tiene tooling): correrlos con timeout de 120s c/u. Registrar: `verificado <fecha>` + duracion + resumen (ej. "84 tests pasan"), o `FALLA` + el error resumido (una falla NO aborta el skill: se documenta y sigue — saber que el build esta roto es exactamente el tipo de cosa que el contrato debe decir). Para coverage, registrar ademas el **% actual en las Notas: es el baseline** que la Fase 3.5 usa para anclar el gate.
3. **Procesos largos** (dev server, app): arrancar en background, esperar la señal de vida (puerto abierto, linea de log), registrar como se reconoce el "esta arriba" (ej. `curl -sf localhost:5173` responde), y MATARLO. Si no levanta en 60s, anotar `no levanta: <motivo>`.
4. Lo que exceda timeout o requiera credenciales ausentes: `no probado (<motivo>)`. Nunca inventar el estado.

## Fase 3 — Gaps: preguntar solo lo no inferible

Listar las preguntas que el codigo NO respondio. Tipicas: ¿cual ambiente uso para probar?, ¿de donde saco las env vars que faltan?, ¿hay datos de prueba / seeds?, ¿que cosas requieren confirmacion humana ademas de los defaults (deploy, migraciones, push)?

- Preguntar con `ask_user_question`, de a UNA, opciones concretas derivadas de la exploracion, la recomendada primera y marcada `(Recomendado)`. Maximo 5 preguntas; si hay mas gaps, priorizar por impacto en autonomia y el resto va a `## Gaps`.
- Lo ya claro NO se pregunta: preguntar lo inferible erosiona la confianza en el skill.
- Con `--assume` (o si el usuario no responde): assumption mas conservadora (ej. "solo local, nunca staging"), documentada en el doc con `[NEEDS-INPUT]`.

## Fase 3.5 — Politicas de generacion

Ofrecer las politicas de generacion: preferencias que el usuario ELIGE — nunca se infieren — y que `/skill:sdd-run` aplica como **gates duros**: una politica incumplida es FALLA visible (PR en draft), jamas se maquilla. Regla de oro: **solo es activable la politica cuyo gate se puede medir en ESTE repo hoy** — por eso esta fase corre despues de la verificacion empirica, que ya establecio que tooling hay.

Menu v1 (cada politica con su gate — el mecanismo con el que `/skill:sdd-run` la va a medir):

| Politica | Valor | Gate |
|---|---|---|
| Tamaño maximo de PR | N lineas de diff y/o M archivos (sugerido: 400 / 15) | `git diff --stat <base>...HEAD`, excluyendo lockfiles y archivos generados |
| Coverage minimo | umbral anclado al baseline actual | correr el comando y comparar contra el umbral; activable SOLO si el comando figura `verificado` en `## Comandos` con su baseline medido |
| Dependencias nuevas | prohibido / preguntar / libre | diff sobre manifest + lockfile contra el base |
| Commits convencionales | patron (ej. `tipo(scope): resumen`) | cada mensaje del branch matchea el patron |

Reglas:

- Usar `ask_user_question` con `selectionMode: "multiple"` y `allowEmptySelection: true` — "¿Activas alguna politica de generacion?": una opcion por politica ACTIVABLE; cero seleccionadas = ninguna politica y la seccion queda vacia. Por cada elegida, UNA pregunta de valor posterior con defaults sugeridos como opciones.
- Politica no medible = no ofrecida. Coverage sin comando de coverage verificado no aparece en el menu: se anota en `## Gaps` ("coverage no activable: no hay tooling de coverage verificado") y se ofrece activarla cuando el tooling exista.
- **Baseline primero (coverage)**: el umbral se elige mirando el % actual medido en Fase 2, nunca en el aire. Ofrecer: `No bajar del baseline (X%) (Recomendado)` — ratchet, cumplible desde el dia uno — / un % fijo que el repo YA cumple / custom. Un umbral por encima del baseline nace en FALLA (pedir 90% con un repo en 10% = todos los PRs en draft para siempre): decirlo con los dos numeros sobre la mesa y aceptarlo SOLO si el usuario lo confirma viendo el baseline; queda anotado `aspiracional` junto al baseline.
- Pistas de los argumentos que fijen politicas ("coverage 80", "PRs de max 300 lineas") cuentan como eleccion del usuario: se activan sin preguntar (verificando igual que el gate sea medible). Unica excepcion: un umbral de coverage por encima del baseline se confirma igual — regla del baseline.
- Con `--assume`: ninguna politica se activa — son elecciones humanas, no se asumen.
- Con `--update` y politicas ya activas: preguntar `Mantener (Recomendado)` / `Revisar` — mantener preserva la seccion verbatim; revisar re-abre el menu con los valores actuales como default.

## Upgrade de contrato (corridas sobre contrato existente)

El skill evoluciona; los contratos generados por versiones anteriores no. En TODA corrida sobre un `.sdd/project.md` existente (`--update` explicito o lanzador que lo detecto), antes de escribir: cruzar el contrato viejo contra esta **checklist de capacidades** y detectar cuales le faltan. La deteccion es estructural — se mira el doc, no hace falta versionado:

| Capacidad | Como detectar que falta en el contrato viejo |
|---|---|
| Politicas de generacion | no existe la seccion `## Politicas de generacion` |
| Baseline de coverage | hay politica de coverage activa sin baseline anotado junto al umbral |
| Capacidad de Git/PR | `## Ambientes` no declara branch default, remote o estado de `gh` |
| Señal de vida de procesos largos | comandos `run` sin el "como se reconoce que esta arriba" |

Con faltantes: listarlos como texto visible (una linea por capacidad, con que aporta) y usar `ask_user_question` con `selectionMode: "multiple"` y `allowEmptySelection: true` — "El contrato es de una version anterior del skill; ¿que mejoras le agrego?". SOLO lo elegido se releva, pregunta y escribe, cada capacidad con el mecanismo de su fase (ej. elegir `Politicas de generacion` se resuelve con el menu de la Fase 3.5); lo no elegido no se anota como gap — es una eleccion, no una deuda. Con `--assume`: no se agrega ninguna (varias exigen eleccion humana); quedan en el reporte como `mejoras disponibles`.

**Regla de mantenimiento del skill**: al agregarle una capacidad nueva a este skill, sumar SIEMPRE su fila a esta checklist. Es lo que hace que los contratos viejos se pongan al dia preguntando, en vez de quedar silenciosamente desactualizados.

## Fase 4 — Escribir el contrato

Escribir `.sdd/project.md` con EXACTAMENTE esta estructura:

```markdown
# Contrato de autonomia — <proyecto>
<!-- Generado por /skill:sdd-init el <fecha>. Refrescar con /skill:sdd-init --update. -->

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
Git: branch default del repo (main/master/otro) — /skill:sdd-run ramifica desde ahi.
Capacidad de PR: remote configurado + gh autenticado, o "sin remote — /skill:sdd-run termina
en commit local". /skill:sdd-run lee estas lineas antes de ramificar o pushear.>

## Verificacion autonoma
<la escalera para ESTE repo, en orden de confianza creciente, con el como concreto de
cada escalon. Y explicitamente que NO se puede verificar sin humano, con el motivo.>

## Limites
<que NO hacer sin confirmacion humana. Defaults siempre presentes: deploy, migraciones
sobre datos compartidos, git push a main, tocar servicios pagos. Mas lo que sumo el usuario.>

## Politicas de generacion
<gates duros que /skill:sdd-run verifica antes de abrir el PR. Elegidas por el usuario en
Fase 3.5, nunca inferidas; si no activo ninguna: "Sin politicas activas. Configurar
con /skill:sdd-init --update." Formato tabla, cada fila con su gate concreto:
| Politica | Valor | Gate |
| tamaño-pr | max 400 lineas / 15 archivos | git diff --stat vs base, sin lockfiles |
| coverage | no bajar del baseline (82%, 2026-07-20) | pnpm test -- --coverage (verificado en Comandos) |>

## Decisiones humanas
<respuestas de la Fase 3, una bullet por decision con fecha. INTOCABLE en --update.>

## Gaps
<[NEEDS-INPUT] pendientes + comandos FALLA/no probados que un humano deberia mirar.>
```

En `--update`: regenerar todo salvo `## Decisiones humanas` y `## Politicas de generacion` (preservar verbatim — las politicas solo cambian si el usuario eligio `Revisar` en Fase 3.5) y los `[NEEDS-INPUT]` aun sin respuesta (mantenerlos, no duplicarlos).

## Fase 5 — Referencia en AGENTS.md y CLAUDE.md (saltear con `--no-import`)

Cablear el contrato de forma idempotente para ambos harnesses:

1. **AGENTS.md / Pi** — Pi no expande imports `@archivo` como Claude. Si `AGENTS.md` no contiene `.sdd/project.md`, agregar este bloque (o crearlo con el bloque):

   ```markdown
   <!-- sdd-contract -->
   Antes de planificar o modificar este proyecto, leer `.sdd/project.md` y respetar sus comandos, verificacion autonoma y limites.
   ```

   Si ya contiene una referencia equivalente, no duplicarla.
2. **CLAUDE.md** — si no contiene `@.sdd/project.md`, agregar esa linea; si no existe, crearlo con solo esa linea. Si ya esta, no tocar nada.

## Reporte

```text
Contrato de autonomia listo: .sdd/project.md
- comandos: <N> documentados (<K> verificados, <F> fallan, <P> no probados)
- escalera de verificacion: llega hasta <escalon mas alto>
- politicas de generacion: <lista con valores | ninguna activa>
- preguntas hechas: <K> · gaps abiertos: <G>
- referencia en AGENTS.md: <agregada|ya estaba|--no-import> · CLAUDE.md: <import agregado|ya estaba|--no-import>
<en corridas sobre contrato existente: mejoras de version agregadas, u ofrecidas y no
tomadas ("mejoras disponibles" con --assume), una linea>
<si hay FALLAs o gaps criticos, una linea por cada uno>
```

## MUST DO

- Ejecutar los comandos antes de documentarlos como verificados (salvo `--no-verify`); distinguir siempre `verificado` / `FALLA` / `no probado (<motivo>)`.
- Matar todo proceso largo que se haya arrancado para verificar.
- Preguntar solo gaps reales, de a una pregunta, con recomendacion.
- Ofrecer como politica de generacion activable SOLO lo que tiene gate medible en este repo, y escribir cada politica activa con su gate concreto. El umbral de coverage se elige siempre contra el baseline medido, nunca en el aire.
- En corridas sobre un contrato existente, cruzarlo contra la checklist de "## Upgrade de contrato" y OFRECER los faltantes — nunca agregarlos sin preguntar, nunca callarlos.
- Preservar `## Decisiones humanas` y `## Politicas de generacion` en `--update`.
- Ser idempotente: re-correr sobre un repo ya inicializado actualiza, no duplica (ni el doc ni las referencias de AGENTS.md/CLAUDE.md).

## MUST NOT DO

- No correr NADA que mute estado externo o compartido: deploy, publish, migraciones contra DBs remotas, git push. La verificacion es local y read-only hacia afuera.
- No documentar comandos adivinados por el nombre del script sin leer que hacen.
- No preguntar lo que la exploracion ya respondio.
- No escribir secrets ni valores de env vars en el contrato — solo el NOMBRE de la var y de donde sale.
- No inferir ni asumir politicas de generacion: si el usuario no las eligio (o corrio `--assume`), la seccion queda vacia. Y no activar una cuyo gate no se pueda medir hoy (coverage sin comando verificado va a Gaps, no al contrato).
- No pisar un `.sdd/project.md` editado a mano sin preservar `## Decisiones humanas`.
- No commitear nada.
