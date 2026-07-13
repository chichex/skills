---
name: sdd-init
description: Explora el proyecto a fondo y genera .sdd/project.md — el "contrato de autonomia" que le dice a OpenCode como correr, testear y buildear la app, que ambientes hay, cual usar para probar, y que puede verificar sin un humano. Usar SIEMPRE que el usuario quiera inicializar SDD, preparar un repo para trabajo autonomo, documentar el harness del proyecto (como se corre/testea/buildea), o cuando otro skill sdd-* necesite un .sdd/project.md que no existe o esta desactualizado. Tambien cuando el usuario diga "quiero que opencode pueda trabajar solo aca", "documenta como se testea esto" o similar.
---

Explora el proyecto y genera `.sdd/project.md`: el **contrato de autonomia** que los demas skills `sdd-*` (spec, run) consumen para trabajar sin humano. No es documentacion aspiracional: cada comando documentado se EJECUTA antes de escribirse, y lo que no se pudo verificar queda marcado como tal. Los argumentos pueden traer pistas libres ("es un monorepo, ignora apps/legacy", "el ambiente de prueba es staging") o ir vacio.

Skill operativo con una fase interactiva acotada: explora solo, verifica solo, y pregunta UNICAMENTE lo que el codigo no puede responder.

## Que es el contrato de autonomia

`.sdd/project.md` responde, con evidencia, las preguntas que un agente autonomo necesita antes de tocar codigo:

1. **Como se corre / testea / buildea** — comandos exactos, cwd, duracion, y si fueron verificados ejecutandolos.
2. **Que ambientes existen y cual puedo usar para probar** — local, staging, prod; env vars y de donde salen.
3. **Que puedo verificar sin humano** — la escalera de verificacion: typecheck < unit < build < levantar la app y probarla < e2e. Hasta que escalon llega este repo y como se sube cada uno.
4. **Que NO debo hacer sin humano** — deploy, migraciones, push, tocar servicios pagos.

Se referencia desde el `AGENTS.md` del proyecto (linea `@.sdd/project.md`) para que TODA sesion lo cargue, no solo las sdd; `CLAUDE.md` encadena via `@AGENTS.md` para que Claude Code tambien lo herede.

## Argumentos

```text
/sdd-init [pistas libres] [--assume] [--no-verify] [--update] [--no-import]
```

- `--assume` — cero preguntas: los gaps se resuelven con la assumption mas conservadora y quedan marcados `[NEEDS-INPUT]` en el doc. Para correr desatendido.
- `--no-verify` — no ejecutar comandos: documenta lo detectado como `no probado`. Util en repos con builds carisimos.
- `--update` — refresco de un `.sdd/project.md` existente: re-explora, re-verifica, pero PRESERVA la seccion `## Decisiones humanas` y las respuestas previas.
- `--no-import` — no tocar `AGENTS.md` ni `CLAUDE.md`.

## Fase 0 — Lanzador (solo con `/sdd-init` pelado)

Dispara SOLO cuando los argumentos vienen vacios. Si trajo pistas o flags, saltear: el usuario ya dijo por donde va.

Si `.sdd/project.md` ya existe, decirlo primero (`Ya hay un contrato del <fecha>. Esto lo actualiza.`) y tratar toda eleccion como `--update`.

```text
/sdd-init explora el repo y genera .sdd/project.md: el contrato de autonomia que guia a
OpenCode cuando trabaja solo. Hay dos perillas: si EJECUTO los comandos que encuentre
(test/build/dev server) para probar que de verdad funcionan, y si te PREGUNTO las dudas
que el codigo no responde o las asumo solo.

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

1. `Verificar y preguntar (Recomendado)` — ejecuta test/build para probar que funcionan; pregunta solo los gaps que el codigo no responde.
2. `Sin ejecutar nada` — solo explora y documenta; los comandos quedan `no probado` (`--no-verify`).
3. `Sin preguntar nada` — corre desatendido; las dudas se asumen conservadoras y quedan `[NEEDS-INPUT]` (`--assume`).

## Fase 1 — Exploracion

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

## Fase 2 — Verificacion empirica (saltear con `--no-verify`)

La razon de ser del skill: un contrato con comandos no probados vale poco, porque el agente autonomo que lo lea va a fallar en su primer paso. Ejecutar y registrar:

1. **Deps**: si faltan (`node_modules`, venv, etc.), correr el install del package manager del repo y documentarlo como prerequisito.
2. **Comandos finitos** (test, build, lint, typecheck): correrlos con timeout de 120s c/u. Registrar: `verificado <fecha>` + duracion + resumen (ej. "84 tests pasan"), o `FALLA` + el error resumido (una falla NO aborta el skill: se documenta y sigue — saber que el build esta roto es exactamente el tipo de cosa que el contrato debe decir).
3. **Procesos largos** (dev server, app): arrancar en background, esperar la señal de vida (puerto abierto, linea de log), registrar como se reconoce el "esta arriba" (ej. `curl -sf localhost:5173` responde), y MATARLO. Si no levanta en 60s, anotar `no levanta: <motivo>`.
4. Lo que exceda timeout o requiera credenciales ausentes: `no probado (<motivo>)`. Nunca inventar el estado.

## Fase 3 — Gaps: preguntar solo lo no inferible

Listar las preguntas que el codigo NO respondio. Tipicas: ¿cual ambiente uso para probar?, ¿de donde saco las env vars que faltan?, ¿hay datos de prueba / seeds?, ¿que cosas requieren confirmacion humana ademas de los defaults (deploy, migraciones, push)?

- Preguntar con `question`, de a UNA, opciones concretas derivadas de la exploracion, la recomendada primera y marcada `(Recomendado)`. Maximo 5 preguntas; si hay mas gaps, priorizar por impacto en autonomia y el resto va a `## Gaps`.
- Lo ya claro NO se pregunta: preguntar lo inferible erosiona la confianza en el skill.
- Con `--assume` (o si el usuario no responde): assumption mas conservadora (ej. "solo local, nunca staging"), documentada en el doc con `[NEEDS-INPUT]`.

## Fase 4 — Escribir el contrato

Escribir `.sdd/project.md` con EXACTAMENTE esta estructura:

```markdown
# Contrato de autonomia — <proyecto>
<!-- Generado por /sdd-init el <fecha>. Refrescar con /sdd-init --update. -->

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

## Decisiones humanas
<respuestas de la Fase 3, una bullet por decision con fecha. INTOCABLE en --update.>

## Gaps
<[NEEDS-INPUT] pendientes + comandos FALLA/no probados que un humano deberia mirar.>
```

En `--update`: regenerar todo salvo `## Decisiones humanas` (preservar verbatim) y los `[NEEDS-INPUT]` aun sin respuesta (mantenerlos, no duplicarlos).

## Fase 5 — Import en AGENTS.md + encadenado de CLAUDE.md (saltear con `--no-import`)

Cablear el contrato en dos eslabones, para que lo carguen tanto OpenCode (lee `AGENTS.md`) como Claude Code (lee `CLAUDE.md`):

1. **AGENTS.md** — si existe y no contiene `@.sdd/project.md`: agregar al final una linea `@.sdd/project.md`. Si no existe: crearlo con solo esa linea. Si ya esta: no tocar nada.
2. **CLAUDE.md** — si existe y no contiene `@AGENTS.md` ni `@.sdd/project.md`: agregar al final una linea `@AGENTS.md` (encadena al eslabon 1 sin duplicar contenido). Si no existe: crearlo con solo `@AGENTS.md`. Si ya tiene cualquiera de los dos imports: no tocar nada.

## Reporte

```text
Contrato de autonomia listo: .sdd/project.md
- comandos: <N> documentados (<K> verificados, <F> fallan, <P> no probados)
- escalera de verificacion: llega hasta <escalon mas alto>
- preguntas hechas: <K> · gaps abiertos: <G>
- import en AGENTS.md: <agregado|ya estaba|--no-import> · CLAUDE.md: <encadenado|ya estaba|--no-import>
<si hay FALLAs o gaps criticos, una linea por cada uno>
```

## MUST DO

- Ejecutar los comandos antes de documentarlos como verificados (salvo `--no-verify`); distinguir siempre `verificado` / `FALLA` / `no probado (<motivo>)`.
- Matar todo proceso largo que se haya arrancado para verificar.
- Preguntar solo gaps reales, de a una pregunta, con recomendacion.
- Preservar `## Decisiones humanas` en `--update`.
- Ser idempotente: re-correr sobre un repo ya inicializado actualiza, no duplica (ni el doc ni los imports de AGENTS.md/CLAUDE.md).

## MUST NOT DO

- No correr NADA que mute estado externo o compartido: deploy, publish, migraciones contra DBs remotas, git push. La verificacion es local y read-only hacia afuera.
- No documentar comandos adivinados por el nombre del script sin leer que hacen.
- No preguntar lo que la exploracion ya respondio.
- No escribir secrets ni valores de env vars en el contrato — solo el NOMBRE de la var y de donde sale.
- No pisar un `.sdd/project.md` editado a mano sin preservar `## Decisiones humanas`.
- No commitear nada.
