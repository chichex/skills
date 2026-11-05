---
name: chiche-init
description: Explora el proyecto a fondo y genera .chiche/project.md — el "contrato de autonomía" que le dice a Pi cómo correr, testear y buildear la app, qué ambientes hay, cuál usar para probar, y qué puede verificar sin un humano. Usar SIEMPRE que el usuario quiera inicializar SDD, preparar un repo para trabajo autónomo, documentar el harness del proyecto (cómo se corre/testea/buildea), o cuando otro skill sdd-* necesite un .chiche/project.md que no existe o está desactualizado. También cuando el usuario diga "quiero que Pi pueda trabajar solo acá", "documenta cómo se testea esto" o similar.
---

Explora el proyecto y genera `.chiche/project.md`: el **contrato de autonomía** que los demás skills `sdd-*` (spec, run) consumen para trabajar sin humano. No es documentación aspiracional: cada comando documentado se EJECUTA antes de escribirse, y lo que no se pudo verificar queda marcado como tal. Los argumentos pueden traer pistas libres ("es un monorepo, ignora apps/legacy", "el ambiente de prueba es staging") o ir vacío.

Skill operativo con una fase interactiva acotada: explora solo, verifica solo, y pregunta ÚNICAMENTE lo que el código no puede responder.

## Que es el contrato de autonomía

`.chiche/project.md` responde, con evidencia, las preguntas que un agente autónomo necesita antes de tocar código:

1. **Cómo se corre / testea / buildea** — comandos exactos, cwd, duración, y si fueron verificados ejecutándolos.
2. **Qué ambientes existen y cuál puedo usar para probar** — local, staging, prod; env vars y de dónde salen.
3. **Qué puedo verificar sin humano** — la escalera de verificación: typecheck < unit < build < levantar la app y probarla < e2e. Hasta qué escalón llega este repo y cómo se sube cada uno.
4. **Qué NO debo hacer sin humano** — deploy, migraciones, push, tocar servicios pagos.
5. **Bajo qué políticas genero código** — preferencias que el usuario ELIGE (tamaño máximo de PR, coverage mínimo, dependencias nuevas, convención de commits, políticas propias de la tecnología) y que `/skill:chiche-run` aplica como gates duros — o sigue como `guia` explícita cuando no hay gate medible. Solo son activables como gate las políticas cuyo mecanismo de medición esté verificado en este repo.

Se referencia desde el `AGENTS.md` del proyecto con una instrucción explícita para que Pi lo lea antes de trabajar en el repo. `CLAUDE.md` conserva el import `@.chiche/project.md` para Claude Code.

Un repo inicializado antes del renombre guarda el contrato en `.sdd/project.md` y las coding policies en `.sdd/coding-policies.md`: este skill los lee de ahí (abajo, `.chiche/` es la ruta en uso) y `--update` ofrece la migración (`## Migración a .chiche/`).

## Argumentos

```text
/skill:chiche-init [pistas libres] [--no-verify] [--update] [--no-import] [--autonomy <level>]
```

- `--no-verify` — no ejecutar comandos: documenta lo detectado como `no probado`. Útil en repos con builds carísimos.
- `--update` — refresco de un `.chiche/project.md` existente: re-explora, re-verifica, pero PRESERVA la sección `## Decisiones humanas` y las respuestas previas. Además ofrece las capacidades que el skill ganó desde que el contrato se generó (ver "## Upgrade de contrato").
- `--no-import` — no tocar `AGENTS.md` ni `CLAUDE.md`.
- `--autonomy <level>` — nivel de autonomía de esta corrida (este skill no tiene fila en `## Autonomy`: flag o `supervised`). Con `plan-approved` o `unattended` corre sin preguntar: cada duda se asume conservadora y queda `[NEEDS-INPUT]`, los niveles del contrato quedan `supervised` y la stop list en prosa no se migra. Ver «Niveles de autonomía» y «Nivel efectivo».

<!-- autonomy-levels:start -->
**Niveles de autonomía.** La escala es `manual (A0)`, `supervised (A1)`, `plan-approved (A2)`, `unattended (A3)`, `auto-land (A4)` y `auto-deploy (A5)`. `--autonomy <level>` acepta el código o la palabra, sin distinguir mayúsculas (`A2`, `a2` y `plan-approved` son el mismo nivel). Esta versión honra A1 a A3: con A0, A4 o A5 el skill aborta antes de cualquier mutación con el diagnóstico literal `--autonomy <nivel>: no soportado todavía (v1 honra A1–A3)`, y cualquier otro token aborta listando los valores válidos. Sin flag rige lo que resuelve «Nivel efectivo»; el default es `supervised (A1)`.
<!-- autonomy-levels:end -->

<!-- autonomy-resolve:start -->
**Nivel efectivo.** El nivel efectivo es el del flag `--autonomy` si vino; si no, la fila del `Stage` en `## Autonomy` del contrato leído del branch default, nunca del branch de trabajo: un PR no puede subirse la autonomía a sí mismo. `grill` lee la fila `grill`, `chiche-spec` la fila `spec`, `chiche-run` la fila `run` y `chiche-land` la fila `land`; `chiche-init`, `issue-triage` y `design-system` no tienen fila: flag o `supervised (A1)`. La lectura hace `git fetch` best-effort de `origin` y `git show origin/<default>:.chiche/project.md`, con fallback a `.sdd/project.md` para un repo que mantuvo `.sdd/`; sin remote lee el working tree en ese mismo orden y avisa `nivel leído del working tree: sin remote`. Si el contrato no tiene `## Autonomy`, o la fila está `unrehearsed` o `FAILED`, rige `supervised (A1)` con aviso. Si el contrato no tiene `## Autonomy` pero sí `## Limites`, esa prosa sigue rigiendo como restricción, el nivel es `supervised (A1)` y el aviso es literal: `contrato sin ## Autonomy: rigen sus ## Limites; corré chiche-init --update`. La stop list (segunda tabla de `## Autonomy`) se lee de la misma fuente y frena en todo nivel: antes de correr un comando o tocar una ruta que matchee un `Pattern`, el skill frena y lo reporta citando la fila. La traza imprime `nivel efectivo: <nombre> (<código>), leído de <fuente>`. Lo imprime este comando, con `<stage>` y `<flag>` reemplazados (`<flag>` vacío sin el flag; `<stage>` es `none` en los skills sin fila), sin parámetros posicionales ni variables de argumentos del harness, que se sustituyen al cargar el skill con argumentos:

```bash
(
  stage='<stage>' flag='<flag>'
  export LC_ALL=C
  pick=$(printf %s "$flag" | tr A-Z a-z); src='--autonomy'; aviso=''; stop=''; contract=''
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root=.
  ref=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
  if [ -z "$ref" ]; then for b in main master; do if git rev-parse -q --verify "refs/remotes/origin/$b" >/dev/null 2>&1; then ref="origin/$b"; break; fi; done; fi
  if [ -n "$ref" ]; then
    git fetch -q origin >/dev/null 2>&1 || aviso="$aviso aviso: fetch de origin falló, se usa la ref local;"
    contract=$(git show "$ref:.chiche/project.md" 2>/dev/null) || contract=$(git show "$ref:.sdd/project.md" 2>/dev/null) || contract=''
    fuente=$ref
  else
    contract=$(cat "$root/.chiche/project.md" 2>/dev/null) || contract=$(cat "$root/.sdd/project.md" 2>/dev/null) || contract=''
    fuente='working tree'; aviso="$aviso aviso: nivel leído del working tree: sin remote;"
  fi
  section=$(printf '%s\n' "$contract" | sed -n '/^## Autonomy$/,$p' | sed -n '2,${/^## /q;p;}')
  if [ -z "$section" ]; then
    if printf '%s\n' "$contract" | grep -q '^## Limites$'; then aviso="$aviso aviso: contrato sin ## Autonomy: rigen sus ## Limites; corré chiche-init --update;"
    elif [ -z "$contract" ]; then aviso="$aviso aviso: sin contrato: rige supervised (A1);"
    else aviso="$aviso aviso: contrato sin ## Autonomy: rige supervised (A1); corré chiche-init --update;"; fi
    [ -n "$pick" ] || pick=a1
  else
    stop=$(printf '%s\n' "$section" | sed -n '/^| *Action *| *Pattern *| *Reason *|/,$p' | sed -n '3,$p' | grep '^|')
    if [ -z "$pick" ] && [ "$stage" = none ]; then pick=a1
    elif [ -z "$pick" ]; then
      row=$(printf '%s\n' "$section" | grep -E "^\|[[:space:]]*$stage[[:space:]]*\|" | head -n 1)
      if [ -z "$row" ]; then pick=a1; aviso="$aviso aviso: ## Autonomy sin fila $stage: rige supervised (A1);"
      else
        pick=$(printf '%s\n' "$row" | cut -d'|' -f3 | sed 's/^[[:space:]]*//; s/[[:space:]].*$//' | tr A-Z a-z)
        reh=$(printf '%s\n' "$row" | cut -d'|' -f5 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        case $pick in a1|supervised) ;; a2|plan-approved|a3|unattended) case $reh in rehearsed\ *) ;; *) aviso="$aviso aviso: fila $stage sin ensayo ($reh): rige supervised (A1);"; pick=a1 ;; esac ;; *) aviso="$aviso aviso: fila $stage con nivel desconocido ($pick): rige supervised (A1);"; pick=a1 ;; esac
      fi
    fi
  fi
  [ "$src" = '--autonomy' ] && [ -z "$flag" ] && src=$fuente
  case $pick in
    a1|supervised) nivel='supervised (A1)' ;;
    a2|plan-approved) nivel='plan-approved (A2)' ;;
    a3|unattended) nivel='unattended (A3)' ;;
    a0|manual|a4|auto-land|a5|auto-deploy) echo "--autonomy $flag: no soportado todavía (v1 honra A1–A3)" >&2; exit 2 ;;
    *) echo "--autonomy $flag: valor inválido; válidos: supervised (A1), plan-approved (A2), unattended (A3)" >&2; exit 2 ;;
  esac
  [ -n "$aviso" ] && echo "${aviso# }" | sed 's/;$//' >&2
  echo "nivel efectivo: $nivel, leído de $src"
  [ -z "$stop" ] || printf '%s\n' "$stop" | while IFS= read -r fila; do
    pat=$(printf '%s\n' "$fila" | cut -d'|' -f3 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    if [ -z "$pat" ]; then echo "aviso: fila de la stop list sin Pattern, ignorada: $fila" >&2; else echo "parada: $fila"; fi
  done
)
```

El comando termina con exit 2 ante un nivel no soportado o inválido y el skill aborta ahí; con exit 0 imprime la traza y una línea `parada:` por cada fila de la stop list, e ignora con aviso una fila sin `Pattern`.
<!-- autonomy-resolve:end -->


## Fase 0 — Lanzador (solo con `/skill:chiche-init` pelado)

Dispara SOLO cuando los argumentos vienen vacíos. Si trajo pistas o flags, saltear: el usuario ya dijo por dónde va.

Si `.chiche/project.md` ya existe, decirlo primero (`Ya hay un contrato del <fecha>. Esto lo actualiza.`) y tratar toda elección como `--update` — incluida la oferta de mejoras de "## Upgrade de contrato" si el contrato es de una versión anterior del skill.

```text
/skill:chiche-init explora el repo y genera .chiche/project.md: el contrato de autonomia que guia a
Pi cuando trabaja solo. Hay dos perillas: si EJECUTO los comandos que encuentre
(test/build/dev server) para probar que de verdad funcionan, y si te PREGUNTO las dudas
que el codigo no responde o las asumo solo. En modo interactivo tambien te ofrezco
activar politicas de generacion (tamaño maximo de PR, coverage minimo, dependencias,
commits, politicas de tu tecnologia) que /skill:chiche-run aplica como gates duros.

  • Verificar y preguntar — ejecuta los comandos para probarlos, y pregunta
                            solo lo que no pueda deducir del codigo. (default)
  • Sin ejecutar nada     — documenta lo que detecta sin correr ningun comando;
                            quedan como "no probado". Para builds/tests muy
                            caros o lentos.                          (--no-verify)
  • Sin preguntar nada    — ejecuta y verifica, pero no te interrumpe: cada duda
                            se asume conservadora y queda [NEEDS-INPUT] en el doc
                            para revisar despues.                    (--autonomy A2)

Atajo: /skill:chiche-init <pistas> [--no-verify] [--autonomy <level>] saltea este menu.
```

Luego usar `ask_user_question` — una pregunta, "¿Ejecuto los comandos para verificarlos, y te pregunto las dudas?":

1. `Verificar y preguntar (Recomendado)` — ejecuta test/build para probar que funcionan; pregunta solo los gaps que el código no responde.
2. `Sin ejecutar nada` — solo explora y documenta; los comandos quedan `no probado` (`--no-verify`).
3. `Sin preguntar nada` — corre desatendido; las dudas se asumen conservadoras y quedan `[NEEDS-INPUT]` (`--autonomy A2`).

## Fase 1 — Exploración

Explorar con `read` y `bash`. Agrupar con `multi_tool_use.parallel` solo las lecturas y comprobaciones independientes; mantener el ownership en el agente principal. Relevar dos lentes y luego integrarlos:

1. **Harness**: stack, lenguajes, frameworks, package manager según lockfile, estructura/monorepo; comandos de run, test, build, lint y typecheck con su fuente exacta (`package.json`, Makefile, justfile, Cargo.toml, go.mod, pyproject, etc.); leer cada script antes de describirlo; framework y distribución de tests unit/integration/e2e; DISEÑO por superficie UI con el censo de diseño de abajo.
2. **Ambientes y verificabilidad**: `.env*`, compose y configs por ambiente; nombres de env vars consumidas (nunca sus secretos), defaults y faltantes; CI; servicios externos; branch default (`git symbolic-ref refs/remotes/origin/HEAD` o branch actual), remotes y `gh auth status`.

Integrar las pistas de los argumentos como prioridad sobre lo detectado. Toda conclusión debe citar su archivo o comando fuente.

<!-- chiche-init-design-census:start -->
**Censo de diseño (`DISEÑO`).** Una superficie UI es un manifest con marcador front o mobile, con la detección de /skill:coding-policies: buscado en la raíz y hasta profundidad 2, excluyendo `node_modules`, `vendor`, `.git`, `dist` y `build`. En `package.json` se miran las claves exactas de `dependencies` y `devDependencies`: `react-dom`, `next`, `react-native` o `expo` (`react-native-web` no cuenta). En Gradle, el marcador vive en `build.gradle`, `build.gradle.kts` o `gradle/libs.versions.toml` (ahí, la superficie es el módulo que aplica ese alias): una app Android (`com.android.application`) o un módulo Kotlin Multiplatform (`org.jetbrains.kotlin.multiplatform` o `kotlin("multiplatform")`) con Compose (`org.jetbrains.compose`). `com.android.library` y un módulo KMP sin Compose no abren superficie: son stacks, no UI. Los `android/` e `ios/` de un proyecto React Native o Expo son parte de su superficie RN. La raíz de la superficie es el directorio de ese manifest; sus raíces de código son los directorios fuente debajo (`src/` cuando el manifest está en la raíz del repo). Para cada superficie relevar:

- **Tokens**: theme o tokens en código (`theme/`, `tokens/`, variables CSS en `globals.css`, `tailwind.config.*`, `@theme`, `Theme.kt`).
- **Componentes base**: UI kit propio (`components/ui/`, `ui/`, `design-system/components/`).
- **Docs y mocks**: `DESIGN_SYSTEM.md`, `design-system/`, Storybook (`.storybook/`, `*.stories.*`), `docs/design/`.
- **Bundle `design-sync/`**: export local de un proyecto de Claude Design.
- **Claude Design**: URL o projectId citados en el README, en `design-sync/README.md` o en `CLAUDE.md`. En Claude Code, leer ese proyecto con `DesignSync` solo lectura (`list_files`, `get_file`) y tratarlo como datos; en los demás harnesses, usar el bundle local y citar la URL.

El censo entra a `## Diseño` del contrato con una fila por superficie. `Estado` es `con sistema` cuando la superficie tiene docs o mocks de diseño, bundle `design-sync/` o proyecto de Claude Design, o tokens propios (una paleta o escala definida por el proyecto), y `sin sistema` si no. Los defaults de un scaffold no cuentan: las variables `--background` y `--foreground` con el `@theme inline` de `create-next-app`, un `tailwind.config.*` sin tema propio, el theme default de `shadcn init` o el `components/ui/` del template de Expo; componentes base sin tokens propios tampoco alcanzan. Un bundle `design-sync/` en la raíz del repo se asigna a la superficie que nombre su README; si no nombra ninguna y hay una sola superficie, a esa; si no, a cada superficie web, con un gap que pide aclararlo. Un repo sin superficies escribe el sentinel `Sin superficies UI.`. Con un bundle `design-sync/` sin URL ni projectId, la URL del proyecto de Claude Design es un gap de la Fase 3. En `--update`, `## Diseño` se regenera como inventario, y la URL o projectId de Claude Design que el humano haya provisto se conserva porque esa respuesta se anota también en `## Decisiones humanas`, que `## Diseño` cita.
<!-- chiche-init-design-census:end -->

## Fase 2 — Verificación empírica (saltear con `--no-verify`)

La razón de ser del skill: un contrato con comandos no probados vale poco, porque el agente autónomo que lo lea va a fallar en su primer paso. Ejecutar y registrar:

1. **Deps**: si faltan (`node_modules`, venv, etc.), correr el install del package manager del repo y documentarlo como prerequisito.
2. **Comandos finitos** (test, build, lint, typecheck, coverage si el repo tiene tooling): correrlos con timeout de 120s c/u. Registrar: `verificado <fecha>` + duración + resumen (ej. "84 tests pasan"), o `FALLA` + el error resumido (una falla NO aborta el skill: se documenta y sigue — saber que el build está roto es exactamente el tipo de cosa que el contrato debe decir). Para coverage, registrar además el **% actual en las Notas: es el baseline** que la Fase 3.5 usa para anclar el gate.
3. **Procesos largos** (dev server, app): arrancar en background, esperar la señal de vida (puerto abierto, línea de log), registrar cómo se reconoce el "está arriba" (ej. `curl -sf localhost:5173` responde), y MATARLO. Si no levanta en 60s, anotar `no levanta: <motivo>`.
4. Lo que exceda timeout o requiera credenciales ausentes: `no probado (<motivo>)`. Nunca inventar el estado.
5. **Stop list**: correr el comando canónico de «`## Autonomy`» (abajo, en «Ensayo de la stop list») sobre el contrato que se va a escribir; una fila `FAILED` conserva su `Pattern`, lleva el motivo al frente de su `Reason` y se lista en `## Gaps` para que el humano la corrija.
6. **Recetas de deploy**: cada receta de deploy encontrada es una fila `deploy <ambiente>` de `## Comandos`, con el mismo `verificado | FALLA | no probado` que cualquier comando. Como muta un ambiente y suele estar en la stop list, se ejecuta solo si el humano lo confirma en esta fase; si no, queda `no probado (deploy: sin confirmación humana)`. Una fila de ambiente en `## Autonomy` cuyo `deploy <ambiente>` no está `verificado` queda `unrehearsed`.

## Fase 3 — Gaps: preguntar solo lo no inferible

Listar las preguntas que el código NO respondió. Típicas: ¿cuál ambiente uso para probar?, ¿de dónde saco las env vars que faltan?, ¿hay datos de prueba / seeds?, ¿qué cosas requieren confirmación humana además de los defaults (deploy, migraciones, push)?

- Preguntar con `ask_user_question`, de a UNA, opciones concretas derivadas de la exploración, la recomendada primera y marcada `(Recomendado)`. Máximo 5 preguntas; si hay más gaps, priorizar por impacto en autonomía y el resto va a `## Gaps`.
- Lo ya claro NO se pregunta: preguntar lo inferible erosiona la confianza en el skill.
- Con `--autonomy` ≥ A2 (o si el usuario no responde): assumption más conservadora (ej. "solo local, nunca staging"), documentada en el doc con `[NEEDS-INPUT]`.

**Nivel de autonomía por etapa.** Después de los gaps, preguntar el nivel con `ask_user_question`, una pregunta por fila — "¿Hasta dónde llega el agente solo en <stage>?", con `supervised (Recomendado)` primera y después `plan-approved` y `unattended` —: filas fijas `grill`, `spec`, `run`, `review` y `land`, más una por ambiente de `## Ambientes`. `land`, `review` y los ambientes solo aceptan `supervised` en esta versión: no se preguntan, se escriben. Cada respuesta va a la tabla de niveles de `## Autonomy` con `Since` de hoy; `Rehearsed` queda `—` en una fila `supervised` y `unrehearsed` en toda fila ≥ A2, con el aviso literal `ensayo disponible desde Claude Code: corré chiche-init --update ahí`, porque el ensayo de niveles vive en el skill de Claude Code y sin ensayo rige `supervised`; con `--no-verify` queda `unrehearsed` en todas. Con `--autonomy` ≥ A2 no se pregunta: asume `supervised` en todas las filas y marca `[NEEDS-INPUT]`.

**Stop list.** La pregunta de qué requiere confirmación humana además de los defaults se responde como filas de la stop list de `## Autonomy`: por cada respuesta, proponer la fila con `Action`, el `Pattern` inferido (regex POSIX extendida sobre el comando o la ruta, sin `|`) y `Reason`, y confirmarla con `ask_user_question`; una respuesta sin patrón honesto se ofrece como regla fechada para `## Decisiones humanas`, nunca como fila con `Pattern` vacío. Los defaults (deploy, migraciones sobre datos compartidos, push a `main`, force-push, merge de PRs y servicios pagos) se escriben sin preguntar, con el patrón que el repo sugiere. En `--update` sobre un contrato con límites en prosa, la fila `Stop list` de «Upgrade de contrato» propone una fila por bullet con este mismo mecanismo. Corre después de «Migración a .chiche/» y funciona igual sobre un repo que eligió `Mantener .sdd/`: lee y escribe el contrato donde esté.

## Fase 3.5 — Políticas de generación

Ofrecer las políticas de generación: preferencias que el usuario ELIGE — nunca se infieren — y que `/skill:chiche-run` aplica como **gates duros**: una política incumplida es FALLA visible (PR en draft), jamás se maquilla. Regla de oro: **solo es activable como gate la política cuyo gate se puede medir en ESTE repo hoy** — por eso esta fase corre después de la verificación empírica, que ya estableció qué tooling hay. Una preferencia sin gate medible puede entrar únicamente como **`guia`** explícita (ver Políticas de la tecnología): orienta la generación, no gatea.

Menú v1 (cada política con su gate — el mecanismo con el que `/skill:chiche-run` la va a medir):

| Politica | Valor | Gate |
|---|---|---|
| Tamaño máximo de PR | N líneas de diff y/o M archivos (sugerido: 400 / 15) | `git diff --stat <base>...HEAD`, excluyendo lockfiles y archivos generados |
| Coverage mínimo | umbral anclado al baseline actual | correr el comando y comparar contra el umbral; activable SOLO si el comando figura `verificado` en `## Comandos` con su baseline medido |
| Dependencias nuevas | prohibido / preguntar / libre | diff sobre manifest + lockfile contra el base |
| Commits convencionales | patrón (ej. `tipo(scope): resumen`) | cada mensaje del branch matchea el patrón |
| Políticas de la tecnología (custom) | preferencia libre del stack: guía de estilo (ej. Uber para Go), max líneas por archivo, naming, constructos prohibidos | el más barato que la observe: regla de linter con config verificada, script del contrato o grep; sin gate medible queda como `guia` |

Reglas:

- Usar `ask_user_question` con `selectionMode: "multiple"` y `allowEmptySelection: true` — "¿Activás alguna política de generación?": una opción por política ACTIVABLE; cero seleccionadas = ninguna política y la sección queda vacía. Por cada elegida, UNA pregunta de valor posterior con defaults sugeridos como opciones.
- Política no medible = no ofrecida. Coverage sin comando de coverage verificado no aparece en el menú: se anota en `## Gaps` ("coverage no activable: no hay tooling de coverage verificado") y se ofrece activarla cuando el tooling exista.
- **Baseline primero (coverage)**: el umbral se elige mirando el % actual medido en Fase 2, nunca en el aire. Ofrecer: `No bajar del baseline (X%) (Recomendado)` — ratchet, cumplible desde el día uno — / un % fijo que el repo YA cumple / custom. Un umbral por encima del baseline nace en FALLA (pedir 90% con un repo en 10% = todos los PRs en draft para siempre): decirlo con los dos números sobre la mesa y aceptarlo SOLO si el usuario lo confirma viendo el baseline; queda anotado `aspiracional` junto al baseline.
- **Políticas de la tecnología (custom)**: el usuario describe la preferencia en texto libre ("seguir la guía de estilo de Uber en Go", "max 300 líneas por archivo", "prohibir panic() fuera de main"). Por cada una, proponer el gate MÁS BARATO que la observe — regla de un linter ya configurado > config nueva de un linter que el repo ya tiene > script corto del contrato (ej. `wc -l` sobre los archivos del diff) > grep — y VERIFICARLO ejecutándolo antes de escribirlo, como cualquier comando. Sin gate medible, ofrecer escribirla como **`guia`**: `/skill:chiche-run` la sigue al GENERAR el código y el reviewer la juzga en el PR — una `guia` nunca se reporta verificada ni gatea. Si un linter la haría medible pero falta configurarlo, anotarlo en `## Gaps` ("sería gate si golangci-lint tuviera config").
- **Coding policies del proyecto**: si existe `.chiche/coding-policies.md` (generado por `/skill:coding-policies`) — o si la fila `coding-policies` ya presente en `## Politicas de generacion` apunta a un archivo existente, porque el skill acepta `--out` —, escribir sin preguntar la fila `guia` `| coding-policies | <ruta> (<stacks del marker>) | guia — sin gate: /skill:chiche-run la sigue al generar, la juzga el reviewer |` — también con `--autonomy` ≥ A2, y en `--update` aunque se elija `Mantener` (si la fila ya existe se actualiza en su lugar): el archivo ya es una decisión humana en el repo y la fila solo la refleja. Si no existe, sumar al menú la opción `Generar coding policies` que, al terminar el contrato, invoca `/skill:coding-policies`; nunca con `--autonomy` ≥ A2: generar el archivo es una elección humana.
<!-- chiche-init-design-policies:start -->
- **Gates de diseño**: solo para superficies `con sistema` con tokens detectados, sumar al menú gates ratchet de diseño medibles con grep y baseline. `git grep` mira solo archivos trackeados (sin `node_modules` ni builds), y `:!` excluye tanto archivos como directorios. `<raíces>` son los globs de código de la superficie (ej. `'apps/web/src/**/*.tsx'`), `<tokens>` el archivo o directorio de tokens y `<ui kit>` el de los componentes base:
  - hex fuera del directorio de tokens: `git grep -IhoE '#([0-9a-fA-F]{3}){1,2}' -- <raíces> ':!<tokens>' | wc -l`;
  - estilos inline: `git grep -h 'style={{' -- <raíces> ':!<ui kit>' | wc -l`;
  - componentes duplicados por nombre: `git grep -hoE '(function|const|class) [A-Z][A-Za-z0-9]+' -- <raíces> ':!<ui kit>' | sort | uniq -d | wc -l`.

  Cada gate se verifica ejecutándolo como cualquier comando, y su conteo actual es el baseline: la política queda `no superar el baseline (<N>, <fecha>)`. Sin tokens detectados no se ofrecen: no hay contra qué medir.
- **Design system**: sumar al menú la opción `Generar design system` solo si hay al menos una superficie `sin sistema`, también en `--update` aunque se elija `Mantener`; al terminar el contrato invoca `/skill:design-system` sin flags, nunca con `--autonomy` ≥ A2: la dirección visual es una elección humana. Con todas las superficies `con sistema` y ningún `DESIGN_SYSTEM.md` que referenciar, el reporte dice `con sistema (no ofrecido)`.
<!-- chiche-init-design-policies:end -->
- Pistas de los argumentos que fijen políticas ("coverage 80", "PRs de max 300 líneas") cuentan como elección del usuario: se activan sin preguntar (verificando igual que el gate sea medible). Única excepción: un umbral de coverage por encima del baseline se confirma igual — regla del baseline.
- Con `--autonomy` ≥ A2: ninguna política se activa — son elecciones humanas, no se asumen.
- Con `--update` y políticas ya activas: preguntar `Mantener (Recomendado)` / `Revisar` — mantener preserva la sección verbatim; revisar re-abre el menú con los valores actuales como default. Si el menú ganó políticas que el contrato no conocía (ej. las de tecnología), decirlo en esa misma pregunta.

## Upgrade de contrato (corridas sobre contrato existente)

El skill evoluciona; los contratos generados por versiones anteriores no. En TODA corrida sobre un `.chiche/project.md` existente (`--update` explícito o lanzador que lo detectó), antes de escribir: cruzar el contrato viejo contra esta **checklist de capacidades** y detectar cuáles le faltan. La detección es estructural — se mira el doc, no hace falta versionado:

| Capacidad | Cómo detectar que falta en el contrato viejo |
|---|---|
| Políticas de generación | no existe la sección `## Politicas de generacion` |
| Baseline de coverage | hay política de coverage activa sin baseline anotado junto al umbral |
| Políticas de la tecnología | `## Politicas de generacion` existe pero sin filas custom ni `guia` (el menú que la generó no las ofrecía) |
| Capacidad de Git/PR | `## Ambientes` no declara branch default, remote o estado de `gh` |
| Señal de vida de procesos largos | comandos `run` sin el "cómo se reconoce que está arriba" |
| Coding policies | existe `.chiche/coding-policies.md` pero `## Politicas de generacion` no tiene la fila `coding-policies` — no entra al menú: la Fase 3.5 la escribe sin preguntar y el reporte la lista como `referenciado` |
| Diseño | no existe la sección `## Diseño` — no entra al menú: el censo de la Fase 1 corre siempre y la Fase 4 la escribe sin preguntar, también con `--autonomy` ≥ A2; el reporte la lista como mejora aplicada |
| Directorio .chiche/ | existe .sdd/project.md, trackeado o no — no entra al menú: lo ofrece la pregunta propia de "## Migración a .chiche/", antes que todo lo demás |
| Autonomy | no existe la sección `## Autonomy` — la Fase 3 pregunta el nivel por fila y la Fase 4 la escribe; con `--autonomy` ≥ A2, `supervised` en todas las filas con `[NEEDS-INPUT]` |
| Stop list | existe `## Limites` en prosa — `--update` propone una fila de la stop list por bullet, con el `Pattern` inferido, y pide confirmación fila por fila; lo que no tiene un patrón honesto se ofrece como regla fechada para `## Decisiones humanas`; al escribir `## Autonomy` esa prosa se retira; con `--autonomy` ≥ A2 no migra y queda como `mejora disponible` |

Con faltantes: listarlos como texto visible (una línea por capacidad, con qué aporta) y usar `ask_user_question` con `selectionMode: "multiple"` y `allowEmptySelection: true` — "El contrato es de una versión anterior del skill; ¿qué mejoras le agrego?". SOLO lo elegido se releva, pregunta y escribe, cada capacidad con el mecanismo de su fase (ej. elegir `Politicas de generacion` se resuelve con el menú de la Fase 3.5); lo no elegido no se anota como gap — es una elección, no una deuda. Con `--autonomy` ≥ A2: no se agrega ninguna (varias exigen elección humana); quedan en el reporte como `mejoras disponibles`.

**Regla de mantenimiento del skill**: al agregarle una capacidad nueva a este skill, sumar SIEMPRE su fila a esta checklist. Es lo que hace que los contratos viejos se pongan al día preguntando, en vez de quedar silenciosamente desactualizados.

## Migración a .chiche/ (corridas sobre un repo con .sdd/)

En Pi, la pregunta de esta sección usa `ask_user_question`.

<!-- chiche-init-migrate:start -->
**Cuándo.** En toda corrida sobre un repo con `.sdd/project.md` (trackeado o no): `--update` explícito, o el lanzador que detectó un contrato existente. Es lo PRIMERO que hace la corrida, antes de re-explorar, de la checklist de "## Upgrade de contrato" y de escribir nada. Sin `.sdd/project.md`, esta sección no aplica.

**La pregunta.** Una sola, "¿Migro el contrato y los artefactos a .chiche/?", con la recomendada primera:

1. `Migrar a .chiche/ (Recomendado)` — ejecuta la secuencia canónica de abajo.
2. `Mantener .sdd/` — no cambia nada.

**Qué hace `Migrar a .chiche/`.**

- `git mv .sdd .chiche`: el contrato, las specs y los grills trackeados pasan a `.chiche/` como renames.
- Reescribe a `.chiche/` toda referencia `.sdd/` dentro de lo que ESTA corrida movió a `.chiche/` (también lo que `git mv` arrastró sin trackear y no está ignorado) y la de `CLAUDE.md`, `AGENTS.md` (`@.sdd/project.md`, el bloque `sdd-contract`) y `.gitignore` (`.sdd/evidence/` pasa a `.chiche/evidence/`: lo ignorado sigue ignorado).
- Reescribe el marker de cada artefacto a `Chiche-Tracking: version=2`, con los demás campos intactos (contrato `docs/chiche-tracking-v2.md`). Solo cambia el primero de cada archivo, el del preámbulo: un ejemplo de marker dentro de un fence del cuerpo queda como estaba.
- Mueve `<git-common-dir>/sdd/` a `<git-common-dir>/chiche/`, incluido `events.jsonl`: el log viejo va primero, el nuevo después.
- Anota la migración, con fecha, en `## Decisiones humanas` de `.chiche/project.md`, una sola vez: si la nota ya está, una nueva corrida de la secuencia no la repite. Dice que `<git-common-dir>/sdd/` pasó a `<git-common-dir>/chiche/` solo si esa corrida lo movió. Sin la sección `## Decisiones humanas`, la secuencia avisa `chiche-init: .chiche/project.md sin seccion '## Decisiones humanas'; anota la migracion a mano` y sigue.

**Secuencia canónica.** Se ejecuta tal cual con `bash`, desde el repo o desde uno de sus worktrees. No se reordena ni se reescribe a mano:

```bash
set -eu
cd "$(git rev-parse --show-toplevel)"
common=$(git rev-parse --path-format=absolute --git-common-dir)
if [ -z "$(git ls-files -- .sdd)" ]; then echo "chiche-init: .sdd/ sin trackear; commitealo o movelo a mano, no se migra"; exit 0; fi
moved=$(mktemp)
trap 'rm -f "$moved"' EXIT
if [ ! -e .chiche ]; then git mv .sdd .chiche; { git ls-files -z -- .chiche; git ls-files -z --others --exclude-standard -- .chiche; } > "$moved"; else
  git ls-files -z -- .sdd | while IFS= read -r -d '' f; do t=".chiche/${f#.sdd/}"
    if [ -e "$t" ]; then echo "chiche-init: conservado $t; queda $f"; else mkdir -p "${t%/*}" && git mv "$f" "$t"; printf '%s\0' "$t" >> "$moved"; fi; done
  find .sdd -type d -empty -delete 2>/dev/null || true; fi
{ cat "$moved"; for f in CLAUDE.md AGENTS.md .gitignore; do if [ -f "$f" ]; then printf '%s\0' "$f"; fi; done; } | while IFS= read -r -d '' f; do
  [ -L "$f" ] && continue
  grep -Iq -e '\.sdd/' -e 'SDD-Tracking: version=1;' "$f" || continue
  awk 'BEGIN{done=0} { if (!done && index($0,"<!-- SDD-Tracking: version=1;")==1) { sub(/<!-- SDD-Tracking: version=1;/,"<!-- Chiche-Tracking: version=2;"); done=1 } gsub(/\.sdd\//,".chiche/"); print }' "$f" > "$f.chiche-migrate" && cat "$f.chiche-migrate" > "$f" && rm "$f.chiche-migrate"; done
common_note=
if [ -d "$common/sdd" ] && mkdir -p "$common/chiche" 2>/dev/null && [ -w "$common/chiche" ]; then
  common_note=" y <git-common-dir>/sdd/ paso a <git-common-dir>/chiche/"
  if [ -f "$common/sdd/events.jsonl" ]; then { awk 1 "$common/sdd/events.jsonl"; if [ -f "$common/chiche/events.jsonl" ]; then awk 1 "$common/chiche/events.jsonl"; fi; } > "$common/chiche/events.jsonl.chiche-migrate"
    mv "$common/chiche/events.jsonl.chiche-migrate" "$common/chiche/events.jsonl" && rm "$common/sdd/events.jsonl"; fi
  (cd "$common/sdd" && find . -type f -print0) | while IFS= read -r -d '' f; do f=${f#./}; t="$common/chiche/$f"
    if [ -e "$t" ]; then echo "chiche-init: conservado $t; queda $common/sdd/$f"; else mkdir -p "${t%/*}" && mv "$common/sdd/$f" "$t"; fi; done
  find "$common/sdd" -type d -empty -delete 2>/dev/null || true
elif [ -d "$common/sdd" ]; then echo "chiche-init: no se pudo escribir en $common/chiche; $common/sdd queda como está"; fi
if [ -f .chiche/project.md ] && ! grep -q 'migracion a .chiche/ con chiche-init --update' .chiche/project.md; then
  if grep -q '^## Decisiones humanas' .chiche/project.md; then
    today=$(date -u +%Y-%m-%d)
    awk -v line="- $today: migracion a .chiche/ con chiche-init --update (antes .sdd); los artefactos llevan Chiche-Tracking: version=2$common_note." '{ print } /^## Decisiones humanas/ { print line }' .chiche/project.md > .chiche/project.md.chiche-migrate && cat .chiche/project.md.chiche-migrate > .chiche/project.md && rm .chiche/project.md.chiche-migrate
  else echo "chiche-init: .chiche/project.md sin seccion '## Decisiones humanas'; anota la migracion a mano"; fi
fi
```

**Reglas.**

- Con `.chiche/` ya presente, la secuencia mueve lo que falta y conserva lo que ya está en `.chiche/`: por cada archivo repetido imprime `chiche-init: conservado <ruta>; queda <ruta vieja>` y deja el de `.sdd/` donde estaba, para que lo resuelva el humano. Lo mismo vale para `<git-common-dir>/chiche/`. La reescritura de una re-corrida alcanza solo a lo que esa corrida movió (más `CLAUDE.md`, `AGENTS.md` y `.gitignore`): una mención histórica de `.sdd/` restaurada a mano en `.chiche/` no se vuelve a reescribir.
- Si `.sdd/` no tiene ningún archivo trackeado (`git ls-files -- .sdd` vacío), no se migra: la secuencia imprime `chiche-init: .sdd/ sin trackear; commitealo o movelo a mano, no se migra`, sale con 0 sin tocar nada y el reporte dice `mantenida .sdd/` con ese motivo. Con al menos un archivo trackeado, `git mv` mueve el directorio entero y la reescritura alcanza también al contrato sin trackear que viaja con él.
- La reescritura saltea los symlinks: `CLAUDE.md -> AGENTS.md` queda como link y `AGENTS.md` se reescribe por su propio nombre; un link trackeado bajo `.chiche/` que apunta fuera nunca toca su destino.
- Si el harness no puede escribir en `<git-common-dir>/chiche/`, el paso del common-dir se saltea con el aviso `chiche-init: no se pudo escribir en <git-common-dir>/chiche` y el resto de la migración sigue: es la misma política que el append del log de eventos.
- `Mantener .sdd/` no cambia nada: el contrato sigue en `.sdd/project.md`, la corrida lo lee de ahí y la oferta se repite en el próximo `--update`.
- Con `--autonomy` ≥ A2 no se migra ni se pregunta: el reporte lo lista como `mejora disponible`.
- Tras migrar, el resto de la corrida lee y escribe `.chiche/project.md`.
- Si la corrida migró, el cierre `Commit + PR` queda en `Dejar sin commitear` con el motivo `migración: los renames viven en el checkout principal`: ese cierre copia solo los paths que la corrida escribió y no reproduce los renames de `git mv`. El reporte nombra el commit sugerido para el humano: `git add -u -- .chiche $(ls CLAUDE.md AGENTS.md .gitignore 2>/dev/null) && git commit -m "chore(chiche-init): migracion a .chiche/"` (los `git mv` ya están en el índice; `git add -u` toma las reescrituras de `.chiche/**`, `CLAUDE.md`, `AGENTS.md` y `.gitignore`, también lo que el grupo (a) ya tenía cambiado en esos paths, y nunca agrega archivos sin trackear).
- El reporte de la migración separa tres grupos con el `git status --porcelain=v1 -z` que `commit-pr-close` ya tomó antes de la primera escritura: (a) los paths que ya tenían cambios antes de migrar, que el humano saca del commit con `git restore --staged -- <ruta>` o commitea aparte; (b) lo que escribió esta corrida: los artefactos reescritos, los imports, `.gitignore` y lo que crearon `coding-policies` o `design-system` encadenados (`.chiche/coding-policies.md`, `DESIGN_SYSTEM.md`), que el commit sugerido no toma y el reporte nombra con `git add -- <ruta>`; (c) lo que `git mv` arrastró a `.chiche/` sin trackear (`git ls-files --others --exclude-standard .chiche`) o ignorado (`git ls-files --others -i --exclude-standard .chiche`), que el commit sugerido tampoco toma y decide el humano.
<!-- chiche-init-migrate:end -->

## Fase 4 — Escribir el contrato

Escribir `.chiche/project.md` con EXACTAMENTE esta estructura:

```markdown
# Contrato de autonomia — <proyecto>
<!-- Generado por /skill:chiche-init el <fecha>. Refrescar con /skill:chiche-init --update. -->
<!-- Chiche-Tracking: version=2; type=project; generated-at=<YYYY-MM-DD> -->

## Stack
<lenguajes, frameworks, package manager, estructura; 3-6 lineas>

## Diseño
<inventario de diseño por superficie UI (Fase 1). Sin front ni mobile: "Sin superficies UI."
Con superficies, una fila por superficie; Estado es `con sistema` o `sin sistema`:
| Superficie | Raices | Tokens | Componentes | Docs y mocks | Claude Design | Estado |
| web | apps/web/src | apps/web/src/app/globals.css | apps/web/src/components/ui | apps/web/DESIGN_SYSTEM.md | design-sync/ · <URL o projectId> (Decisiones humanas <fecha>) | con sistema |
| mobile | src | — | — | — | — | sin sistema |>

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| test | pnpm test | . | verificado 2026-07-02 | 12s | 84 tests pasan |
| build | pnpm build | . | FALLA | 40s | TS2345 en src/x.ts — ver Gaps |
| run | pnpm dev | . | verificado 2026-07-02 | — | listo cuando responde curl -sf localhost:5173 |
| deploy staging | ./deploy.sh staging | . | no probado (deploy: sin confirmacion humana) | — | receta; muta staging, se ejecuta solo con confirmacion |

## Ambientes
<cuales hay, CUAL usar para probar, env vars: resueltas vs faltantes y de donde salen.
Git: branch default del repo (main/master/otro) — /skill:chiche-run ramifica desde ahi.
Capacidad de PR: remote configurado + gh autenticado, o "sin remote — /skill:chiche-run termina
en commit local". /skill:chiche-run lee estas lineas antes de ramificar o pushear.>

## Verificacion autonoma
<la escalera para ESTE repo, en orden de confianza creciente, con el como concreto de
cada escalon. Y explicitamente que NO se puede verificar sin humano, con el motivo.>

## Autonomy
<nivel por etapa y paradas obligatorias (Fase 3; la forma exacta, abajo en "## Autonomy"). Niveles:
supervised (A1), plan-approved (A2), unattended (A3); land, review y ambientes solo supervised.
Una fila de ambiente cuyo deploy <ambiente> no esta verificado queda unrehearsed.
| Stage | Level | Since | Rehearsed |
|---|---|---|---|
| grill | supervised | 2026-07-02 | — |
| spec | plan-approved | 2026-07-02 | rehearsed 2026-07-02 |
| run | supervised | 2026-07-02 | — |
| review | supervised | 2026-07-02 | — |
| land | supervised | 2026-07-02 | — |
| staging | supervised | 2026-07-02 | — |

Stop list: lo que el agente nunca hace solo, en ningun nivel. Pattern es una regex POSIX extendida
(grep -E) sobre el comando completo o la ruta tocada, una por fila y sin "|". Defaults siempre
presentes: deploy, migraciones sobre datos compartidos, push a main, force-push, merge y servicios
pagos. Mas lo que sumo el usuario.
| Action | Pattern | Reason |
|---|---|---|
| pnpm run deploy | pnpm run deploy | sin confirmacion humana |
| prisma migrate deploy | prisma migrate deploy | datos compartidos |
| git push origin main | git push .* main | solo via PR |
| git push --force | git push .*--force | nunca |
| gh pr merge | gh pr merge | solo chiche-land, con el plan confirmado |
| gh stack merge | gh stack merge | solo chiche-land, con el plan confirmado |
| <comando que consume cuota> | <patron> | sin confirmacion humana |>

## Politicas de generacion
<gates duros que /skill:chiche-run verifica antes de abrir el PR. Elegidas por el usuario en
Fase 3.5, nunca inferidas; si no activo ninguna: "Sin politicas activas. Configurar
con /skill:chiche-init --update." Formato tabla, cada fila con su gate concreto:
| Politica | Valor | Gate |
| tamaño-pr | max 400 lineas / 15 archivos | git diff --stat vs base, sin lockfiles |
| coverage | no bajar del baseline (82%, 2026-07-20) | pnpm test -- --coverage (verificado en Comandos) |
| max-lineas-archivo | 300 por archivo tocado | script: wc -l sobre los archivos del diff |
| estilo-go | guia de estilo de Uber | guia — sin gate medible: /skill:chiche-run la sigue al generar, la juzga el reviewer |>

## Decisiones humanas
<respuestas de la Fase 3, una bullet por decision con fecha. INTOCABLE en --update.>

## Gaps
<[NEEDS-INPUT] pendientes + comandos FALLA/no probados que un humano deberia mirar.>
```

La línea `Chiche-Tracking` es el marker canónico de tracking (contrato `docs/chiche-tracking-v2.md`): `version` y `type` son fijos, y `generated-at` lleva la fecha de ESTA corrida en `YYYY-MM-DD`. Mantenerlo como upsert idempotente: exactamente un marker por contrato — en `--update` se actualiza la fecha en la línea existente (o se inserta si el contrato viejo no la tenía), nunca se duplica ni se mueve. El marker de un artefacto existente es `SDD-Tracking: version=1` o `Chiche-Tracking: version=2`: al reescribirlo se reemplaza en su lugar por `Chiche-Tracking: version=2` conservando los demás campos, y nunca se agrega otro al lado. El H1 y los headers de sección quedan intactos.

<!-- autonomy-contract:start -->
**`## Autonomy`.** Reemplaza a `## Limites`: dice hasta dónde llega el agente solo en cada etapa y qué no hace nunca. Dos tablas:

1. **Niveles**, `| Stage | Level | Since | Rehearsed |`: filas fijas `grill`, `spec`, `run`, `review` y `land`, más una por ambiente de `## Ambientes` (con `Stage` el nombre del ambiente). `Level` es `supervised`, `plan-approved` o `unattended`; `land`, `review` y los ambientes solo aceptan `supervised` en esta versión, y ningún skill lee `review` hasta que exista esa etapa. `Since` es la fecha `YYYY-MM-DD` en que se fijó el nivel. `Rehearsed` es `rehearsed <YYYY-MM-DD>` si la fila pasó el ensayo, `unrehearsed` si nunca se ensayó y `FAILED (<motivo>)` si no pasó; una fila `supervised` lleva `—`. Un nivel ≥ A2 solo rige si está `rehearsed`: `unrehearsed` o `FAILED` equivalen a `supervised` para quien lo lee. Una fila de ambiente cuyo `deploy <ambiente>` de `## Comandos` no está `verificado` queda `unrehearsed`.
2. **Stop list**, `| Action | Pattern | Reason |`: lo que el agente nunca hace solo, en ningún nivel. `Action` es un comando representativo de lo prohibido (`git push origin main`, `pnpm run deploy`): es el rótulo de la fila y el comando de prueba de su ensayo. `Pattern` es una regex POSIX extendida (`grep -E`) sobre el comando completo o la ruta tocada, una por fila y sin `|` (una alternativa por fila, porque `|` es el separador de la tabla). Una fila con `Pattern` vacío es inválida: este skill la rechaza y la ofrece como regla fechada para `## Decisiones humanas`; los skills la ignoran con aviso. Defaults siempre presentes: deploy, migraciones sobre datos compartidos, push a `main`, force-push, merge de PRs (que solo `chiche-land` pisa al confirmar su plan) y servicios pagos; más lo que sume el usuario.

**Ensayo de la stop list.** No necesita agente: cada `Pattern` se corre contra su propio `Action` (tiene que matchear) y contra el comando neutro `echo ok` (no tiene que matchear). Un patrón vacío, inválido, que no matchea su acción o que matchea el neutro deja la fila `FAILED`. Este comando lo hace sobre el contrato que se le indica, sin parámetros posicionales: imprime `ok: <Action>` o `FAILED: <Action> (<motivo>)` por fila y termina con exit 1 si alguna falló.

```bash
(
  contract='<contrato>'
  export LC_ALL=C
  section=$(sed -n '/^## Autonomy$/,$p' "$contract" | sed -n '2,${/^## /q;p;}')
  rows=$(printf '%s\n' "$section" | sed -n '/^| *Action *| *Pattern *| *Reason *|/,$p' | sed -n '3,$p' | grep '^|')
  out=$(printf '%s\n' "$rows" | while IFS= read -r fila; do
    [ -n "$fila" ] || continue
    action=$(printf '%s\n' "$fila" | cut -d'|' -f2 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    pattern=$(printf '%s\n' "$fila" | cut -d'|' -f3 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    if [ -z "$pattern" ]; then echo "FAILED: $action (Pattern vacío)"; continue; fi
    printf '%s\n' "$action" | grep -Eq -- "$pattern" 2>/dev/null; rc=$?
    if [ "$rc" -eq 2 ]; then echo "FAILED: $action (Pattern inválido para grep -E)"
    elif [ "$rc" -ne 0 ]; then echo "FAILED: $action (el Pattern no matchea su Action)"
    elif printf '%s\n' 'echo ok' | grep -Eq -- "$pattern" 2>/dev/null; then echo "FAILED: $action (el Pattern matchea el comando neutro echo ok)"
    else echo "ok: $action"; fi
  done)
  printf '%s\n' "$out"
  printf '%s\n' "$out" | grep -q '^FAILED: ' && exit 1
  exit 0
)
```
<!-- autonomy-contract:end -->

En `--update`: regenerar todo salvo `## Decisiones humanas`, `## Politicas de generacion` y `## Autonomy` (preservar verbatim — las políticas solo cambian si el usuario eligió `Revisar` en Fase 3.5) y los `[NEEDS-INPUT]` aún sin respuesta (mantenerlos, no duplicarlos).

## Fase 5 — Referencia en AGENTS.md y CLAUDE.md (saltear con `--no-import`)

Cablear el contrato de forma idempotente para ambos harnesses:

1. **AGENTS.md / Pi** — Pi no expande imports `@archivo` como Claude. Si `AGENTS.md` no contiene `.chiche/project.md`, agregar este bloque (o crearlo con el bloque):

   ```markdown
   <!-- sdd-contract -->
   Antes de planificar o modificar este proyecto, leer `.chiche/project.md` y respetar sus comandos, verificacion autonoma y limites.
   ```

   Si ya contiene una referencia equivalente, no duplicarla.
2. **CLAUDE.md** — si no contiene `@.chiche/project.md`, agregar esa línea; si no existe, crearlo con solo esa línea. Si ya está, no tocar nada.

En un repo que mantuvo `.sdd/` (`Mantener .sdd/`), la línea o el bloque nombra la ruta del contrato en uso (`@.sdd/project.md` / "leer `.sdd/project.md`"), y una referencia que ya apunta a la ruta en uso nunca se duplica.

## Reporte

```text
Contrato de autonomia listo: .chiche/project.md
- comandos: <N> documentados (<K> verificados, <F> fallan, <P> no probados)
- escalera de verificacion: llega hasta <escalon mas alto>
- politicas de generacion: <lista con valores | ninguna activa>
- preguntas hechas: <K> · gaps abiertos: <G>
- coding-policies: <referenciado|generado|no existe (ofrecido)|--autonomy ≥ A2: no ofrecido>
- design-system: <referenciado|generado|no existe (ofrecido)|con sistema (no ofrecido)|--autonomy ≥ A2: no ofrecido|sin superficies UI>
- referencia en AGENTS.md: <agregada|ya estaba|--no-import> · CLAUDE.md: <import agregado|ya estaba|--no-import>
- migracion: <.sdd/ → .chiche/ (<N> artefactos; <git-common-dir>/sdd/ movido|conservado: <motivo>; con cambios previos: <lista|ninguno>; escritos fuera del commit sugerido: <lista|ninguno>; sin trackear o ignorado en .chiche/: <lista|ninguno>) | mantenida .sdd/ | mejora disponible (--autonomy ≥ A2) | no aplica>
<en corridas sobre contrato existente: mejoras de version agregadas, u ofrecidas y no
tomadas ("mejoras disponibles" con --autonomy ≥ A2), una linea>
<si hay FALLAs o gaps criticos, una linea por cada uno>
```

<!-- commit-pr-close:start -->
## Cierre — Commit + PR

Después del reporte, preguntar `Commit + PR (Recomendado)` / `Dejar sin commitear`. Este skill escribe en el checkout principal porque los demás skills leen de ahí lo que genera: es la excepción al principio de que el checkout principal es de solo lectura, y por eso cierra ofreciendo un PR. El cierre usa el `git status --porcelain=v1 -z` que la corrida tomó antes de escribir su primer archivo.

`Commit + PR`:

1. Comprobar la aptitud igual que `/skill:chiche-run`: hay remote y `gh` autenticado, y ninguna fila de la stop list matchea `git push -u origin <branch>` (la segunda tabla de `## Autonomy` de `.chiche/project.md`, leída del branch default). Si no, el cierre queda en `Dejar sin commitear` con el motivo.
2. Revisar cada path que esta corrida escribió. Uno nuevo, ausente en `origin/<default>`, se copia. Uno que ya existía se copia solo si `HEAD:<path>` del checkout es igual a `origin/<default>:<path>` y el path no tenía cambios antes de la corrida; si no, el cierre queda en `Dejar sin commitear` con el motivo, para no meter cambios ajenos en el PR ni revertir lo que `origin/<default>` ya cambió.
3. `git fetch origin` y crear el worktree con lock, con el branch `chore/chiche-init-<YYYY-MM-DD>` nacido de `origin/<default>`: `git worktree add --lock --reason "chiche-init <YYYY-MM-DD>" ../<repo>-chiche-init-<YYYY-MM-DD> -b chore/chiche-init-<YYYY-MM-DD> origin/<default>`. Si el branch o el path ya existen, usar en los dos el primer sufijo libre (`-2`, `-3`…).
4. Copiar al worktree, con la misma ruta relativa, solo los paths que esta corrida escribió; commitear, pushear ese branch y abrir el PR con `gh pr create --base <default> --title "chore(chiche-init): <YYYY-MM-DD>" --body-file <archivo>`.
5. `git worktree unlock` y después `git worktree remove` del worktree.

Si el push o `gh pr create` fallan después del commit, el cierre queda como commit local sin PR: el reporte nombra el branch, el motivo y el comando para seguir (`git push -u origin <branch>` y el `gh pr create` del paso 4). La copia idéntica que queda en el checkout principal no se toca: después del merge, `/skill:chiche-land` la reconoce como `ya aterrizado` y la resuelve sin preguntar. `Dejar sin commitear` no toca nada. El reporte suma la línea `- cierre: <PR #<n> <url> | commit local sin PR en <branch> (<motivo>) · <comando> | sin commitear (<motivo>)>`. En modo desatendido, si el skill lo tiene, no se pregunta y el cierre queda en `Dejar sin commitear`. Si un skill encadena a otro (`/skill:chiche-init` encadena `/skill:coding-policies` y `/skill:design-system`), el cierre lo ofrece una sola vez el que encadenó, con todos los paths escritos.
<!-- commit-pr-close:end -->

La pregunta del cierre `Commit + PR` usa `ask_user_question`, con la recomendada primera.

## MUST DO

- Ejecutar los comandos antes de documentarlos como verificados (salvo `--no-verify`); distinguir siempre `verificado` / `FALLA` / `no probado (<motivo>)`.
- Matar todo proceso largo que se haya arrancado para verificar.
- Preguntar solo gaps reales, de a una pregunta, con recomendación.
- Ofrecer como gate SOLO lo que tiene gate medible en este repo, y escribir cada política activa con su gate concreto; una preferencia sin gate medible entra únicamente como `guia` explícita. El umbral de coverage se elige siempre contra el baseline medido, nunca en el aire.
- En corridas sobre un contrato existente, cruzarlo contra la checklist de "## Upgrade de contrato" y OFRECER los faltantes — nunca agregarlos sin preguntar, nunca callarlos.
- Preservar `## Decisiones humanas`, `## Politicas de generacion` y `## Autonomy` en `--update`.
- Ser idempotente: re-correr sobre un repo ya inicializado actualiza, no duplica (ni el doc ni las referencias de AGENTS.md/CLAUDE.md).

## MUST NOT DO

- No correr NADA que mute estado externo o compartido: deploy, publish, migraciones contra DBs remotas, git push. La verificación es local y read-only hacia afuera. La única excepción es el `Commit + PR` del cierre, cuando el usuario lo elige: pushea solo `chore/chiche-init-<YYYY-MM-DD>` y abre su PR.
- No documentar comandos adivinados por el nombre del script sin leer qué hacen.
- No preguntar lo que la exploración ya respondió.
- No escribir secrets ni valores de env vars en el contrato — solo el NOMBRE de la var y de dónde sale.
- No inferir ni asumir políticas de generación: si el usuario no las eligió (o corrió con `--autonomy` ≥ A2), la sección queda vacía. Y no activar una cuyo gate no se pueda medir hoy (coverage sin comando verificado va a Gaps, no al contrato). Una preferencia sin gate medible jamás se disfraza de gate: o es `guia` explícita o no entra.
- No pisar un `.chiche/project.md` editado a mano sin preservar `## Decisiones humanas`.
- No commitear en el checkout principal: el único commit es el de `Commit + PR`, en su worktree, cuando el usuario lo elige.
