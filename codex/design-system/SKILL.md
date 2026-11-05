---
name: design-system
description: "Genera DESIGN_SYSTEM.md para una superficie UI sin sistema de diseño: una ronda de dirección visual y un doc con tokens de diseño, componentes base y reglas, enganchado en el contrato. No escribe código. Usar cuando el usuario pida un design system, un sistema de diseño, tokens de diseño, definir la dirección visual o generar DESIGN_SYSTEM.md, y cuando chiche-init lo encadene al terminar el contrato."
---

Escribe el documento de diseño de una superficie UI que todavía no tiene sistema: dirección visual, tokens con valores, componentes base, estados y reglas. El doc es la fuente que siguen `$grill`, `$chiche-spec` y `$chiche-run` cuando un pedido toca esa superficie; el código (tokens en código, componentes, temas) nace en el primer run que toque UI, siguiendo el doc.

Tres ideas fuerza:

1. **Inventario antes que invención.** Si la superficie ya tiene sistema, se registra y no se genera otro.
2. **La dirección visual es del humano.** Una sola ronda de preguntas con recomendación primera; el skill no tiene modo desatendido.
3. **El skill escribe un doc, nunca código.** Lo que materializa el doc es un run posterior.

<!-- design-system-doctrine:start -->
## Argumentos

```text
$design-system [<raíz de la superficie>] [--no-link] [--autonomy <level>]
```

- `<raíz de la superficie>` — directorio de la superficie a documentar (el del manifest que la detecta); saltea la elección de superficie de la Fase 1.
- `--no-link` — saltea el enganche de la Fase 5: escribe el doc y no toca ningún otro archivo.
- `--autonomy <level>` — se acepta por uniformidad y aborta con cualquier valor distinto de `supervised`/`A1`: la dirección visual es del humano y este skill no tiene modo desatendido (no tiene fila en `## Autonomy`). Ver «Niveles de autonomía» y «Nivel efectivo».

`$chiche-init` lo invoca sin flags al terminar el contrato, y nunca con `--autonomy` ≥ A2: este skill no tiene modo desatendido.

<!-- autonomy-levels:start -->
**Niveles de autonomía.** La escala es `manual (A0)`, `supervised (A1)`, `plan-approved (A2)`, `unattended (A3)`, `auto-land (A4)` y `auto-deploy (A5)`. `--autonomy <level>` acepta el código o la palabra, sin distinguir mayúsculas (`A2`, `a2` y `plan-approved` son el mismo nivel). Esta versión honra A1 a A3: con A0, A4 o A5 el skill aborta antes de cualquier mutación con el diagnóstico literal `--autonomy <nivel>: no soportado todavía (v1 honra A1–A3)`, y cualquier otro token aborta listando los valores válidos. `--autonomy` sin valor (no hay token siguiente, o el siguiente empieza con `--`) aborta listando los valores válidos: un token que empieza con `--` nunca se lee como valor. Sin flag rige lo que resuelve «Nivel efectivo»; el default es `supervised (A1)`.
<!-- autonomy-levels:end -->

<!-- autonomy-resolve:start -->
**Nivel efectivo.** El nivel efectivo es el del flag `--autonomy` si vino; si no, la fila del `Stage` en `## Autonomy` del contrato leído del branch default, nunca del branch de trabajo: un PR no puede subirse la autonomía a sí mismo. `grill` lee la fila `grill`, `chiche-spec` la fila `spec`, `chiche-run` la fila `run` y `chiche-land` la fila `land` (que solo acepta `supervised`: otro nivel en esa fila cae a `supervised (A1)` con el aviso `fila land solo acepta supervised`); `chiche-init`, `issue-triage` y `design-system` no tienen fila: flag o `supervised (A1)`. La lectura valida el flag primero y, si existe el remote `origin`, hace `git fetch` best-effort, resuelve el branch default (`git symbolic-ref refs/remotes/origin/HEAD`, descartado si apunta a una ref que ya no existe, y si falla o quedó colgado, `git ls-remote --symref origin HEAD`) y lee `git show origin/<default>:.chiche/project.md`, con fallback a `.sdd/project.md` para un repo que mantuvo `.sdd/`; con `origin` y un default que no se resuelve rige `supervised (A1)`, también con `--autonomy`, con el aviso `origin sin branch default resoluble`, sin leer el working tree; solo sin `origin` lee el working tree en ese mismo orden y avisa `nivel leído del working tree: sin remote`. Si el contrato no tiene `## Autonomy`, o la fila está `unrehearsed` o `FAILED`, rige `supervised (A1)` con aviso. Si el contrato no tiene `## Autonomy` pero sí `## Limites`, esa prosa sigue rigiendo como restricción, el nivel es `supervised (A1)` y el aviso es literal: `contrato sin ## Autonomy: rigen sus ## Limites; corré chiche-init --update`. La stop list (segunda tabla de `## Autonomy`, con el header `| Action | Pattern | Reason |` y hasta la primera línea que no empieza con `|`) se lee de la misma fuente y frena en todo nivel (las únicas excepciones son la de merge de `chiche-land`, que la invocación y el plan confirmado autorizan, y el comando exacto del ensayo de `chiche-init`, que la pregunta de costo autoriza): antes de correr un comando o tocar una ruta que matchee un `Pattern`, el skill frena y lo reporta citando la fila. Un `## Autonomy` sin stop list legible (sin ese header o con 0 filas) avisa `## Autonomy sin stop list legible` y el nivel que sale del contrato cae a `supervised (A1)`; con `--autonomy` el flag sigue mandando y solo se avisa. La traza imprime `nivel efectivo: <nombre> (<código>), leído de <fuente>`. Lo imprime este comando, con `<stage>` y `<flag>` reemplazados (`<flag>` vacío sin el flag; `<stage>` es `none` en los skills sin fila), sin parámetros posicionales ni variables de argumentos del harness, que se sustituyen al cargar el skill con argumentos (`<flag>` se sustituye solo si cumple `^[A-Za-z0-9-]+$`; si no, el skill aborta como valor inválido sin correr el comando):

```bash
(
  stage='<stage>' flag='<flag>'
  export LC_ALL=C
  pick=$(printf %s "$flag" | tr A-Z a-z); aviso=''; stop=''; contract=''; legible=1
  case $pick in
    ''|a1|supervised|a2|plan-approved|a3|unattended) ;;
    a0|manual|a4|auto-land|a5|auto-deploy) echo "--autonomy $flag: no soportado todavía (v1 honra A1–A3)" >&2; exit 2 ;;
    *) echo "--autonomy $flag: valor inválido; válidos: supervised (A1), plan-approved (A2), unattended (A3)" >&2; exit 2 ;;
  esac
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root=.
  if git remote get-url origin >/dev/null 2>&1; then
    git fetch -q origin >/dev/null 2>&1 || aviso="$aviso aviso: fetch de origin falló, se usa la ref local;"
    ref=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
    if [ -n "$ref" ] && ! git rev-parse -q --verify "refs/remotes/$ref" >/dev/null 2>&1; then ref=''; fi
    if [ -z "$ref" ]; then
      def=$(git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's|^ref: refs/heads/\(.*\)[[:space:]]HEAD$|\1|p' | head -n 1)
      if [ -n "$def" ] && git rev-parse -q --verify "refs/remotes/origin/$def" >/dev/null 2>&1; then ref="origin/$def"; fi
    fi
    if [ -n "$ref" ]; then
      contract=$(git show "$ref:.chiche/project.md" 2>/dev/null) || contract=$(git show "$ref:.sdd/project.md" 2>/dev/null) || contract=''
      fuente=$ref
    else
      fuente='origin (default sin resolver)'; aviso="$aviso aviso: origin sin branch default resoluble: rige supervised (A1) y no se lee el working tree;"
    fi
  else
    contract=$(cat "$root/.chiche/project.md" 2>/dev/null) || contract=$(cat "$root/.sdd/project.md" 2>/dev/null) || contract=''
    fuente='working tree'; aviso="$aviso aviso: nivel leído del working tree: sin remote;"
  fi
  contract=$(printf '%s\n' "$contract" | tr -d '\r')
  section=$(printf '%s\n' "$contract" | sed -n '/^## Autonomy$/,$p' | sed -n '2,${/^## /q;p;}')
  if [ -z "$section" ]; then
    if printf '%s\n' "$contract" | grep -q '^## Limites$'; then aviso="$aviso aviso: contrato sin ## Autonomy: rigen sus ## Limites; corré chiche-init --update;"
    elif [ -z "$contract" ] && [ -n "$flag" ] && [ "$fuente" != 'origin (default sin resolver)' ]; then aviso="$aviso aviso: sin contrato: rige --autonomy, sin stop list;"
    elif [ -z "$contract" ]; then aviso="$aviso aviso: sin contrato: rige supervised (A1);"
    else aviso="$aviso aviso: contrato sin ## Autonomy: rige supervised (A1); corré chiche-init --update;"; fi
    [ -n "$pick" ] || pick=a1
  else
    stop=$(printf '%s\n' "$section" | sed -n '/^| *Action *| *Pattern *| *Reason *|/,$p' | sed -n '3,$p' | sed -n '/^|/!q;p')
    if [ -z "$stop" ]; then legible=0; aviso="$aviso aviso: ## Autonomy sin stop list legible (sin el header | Action | Pattern | Reason | o sin filas);"; fi
    if [ -z "$pick" ] && [ "$stage" = none ]; then pick=a1
    elif [ -z "$pick" ]; then
      row=$(printf '%s\n' "$section" | grep -E "^\|[[:space:]]*$stage[[:space:]]*\|" | head -n 1)
      if [ -z "$row" ]; then pick=a1; aviso="$aviso aviso: ## Autonomy sin fila $stage: rige supervised (A1);"
      else
        pick=$(printf '%s\n' "$row" | cut -d'|' -f3 | sed 's/^[[:space:]]*//; s/[[:space:]].*$//' | tr A-Z a-z)
        reh=$(printf '%s\n' "$row" | cut -d'|' -f5 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        case $pick in a1|supervised) pick=a1 ;; a2|plan-approved|a3|unattended) case $reh in rehearsed\ *) ;; *) aviso="$aviso aviso: fila $stage sin ensayo ($reh): rige supervised (A1);"; pick=a1 ;; esac ;; *) aviso="$aviso aviso: fila $stage con nivel desconocido ($pick): rige supervised (A1);"; pick=a1 ;; esac
      fi
      if [ "$stage" = land ] && [ "$pick" != a1 ]; then aviso="$aviso aviso: fila land solo acepta supervised: rige supervised (A1);"; pick=a1; fi
      if [ "$legible" -eq 0 ] && [ "$pick" != a1 ]; then aviso="$aviso aviso: sin stop list legible el nivel del contrato cae a supervised (A1);"; pick=a1; fi
    fi
  fi
  if [ "$fuente" = 'origin (default sin resolver)' ]; then pick=a1; src=$fuente; elif [ -n "$flag" ]; then src='--autonomy'; else src=$fuente; fi
  case $pick in
    a1|supervised) nivel='supervised (A1)' ;;
    a2|plan-approved) nivel='plan-approved (A2)' ;;
    a3|unattended) nivel='unattended (A3)' ;;
  esac
  [ -n "$aviso" ] && printf '%s\n' "${aviso# }" | sed 's/;$//' >&2
  echo "nivel efectivo: $nivel, leído de $src"
  [ -z "$stop" ] || printf '%s\n' "$stop" | while IFS= read -r fila; do
    pat=$(printf '%s\n' "$fila" | cut -d'|' -f3 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    if [ -z "$pat" ]; then printf 'aviso: fila de la stop list sin Pattern, ignorada: %s\n' "$fila" >&2; else printf 'parada: %s\n' "$fila"; fi
  done
)
```

El comando termina con exit 2 ante un nivel no soportado o inválido, antes de tocar la red, y el skill aborta ahí; con exit 0 imprime la traza y una línea `parada:` por cada fila de la stop list, e ignora con aviso una fila sin `Pattern`.
<!-- autonomy-resolve:end -->

## Fase 1 — Detección de superficies y elementos existentes

Una superficie UI es un manifest con marcador front o mobile, con la detección de $coding-policies: buscado en la raíz y hasta profundidad 2, excluyendo `node_modules`, `vendor`, `.git`, `dist` y `build`. En `package.json` se miran las claves exactas de `dependencies` y `devDependencies`: `react-dom`, `next`, `react-native` o `expo` (`react-native-web` no cuenta). En Gradle, el marcador vive en `build.gradle`, `build.gradle.kts` o `gradle/libs.versions.toml` (ahí, la superficie es el módulo que aplica ese alias): una app Android (`com.android.application`) o un módulo Kotlin Multiplatform (`org.jetbrains.kotlin.multiplatform` o `kotlin("multiplatform")`) con Compose (`org.jetbrains.compose`). `com.android.library` y un módulo KMP sin Compose no abren superficie: son stacks, no UI. Los `android/` e `ios/` de un proyecto React Native o Expo son parte de su superficie RN. La raíz de la superficie es el directorio de ese manifest; sus raíces de código son los directorios fuente debajo (`src/` cuando el manifest está en la raíz del repo).

Para cada superficie relevar:

- **Tokens**: theme o tokens en código (`theme/`, `tokens/`, variables CSS en `globals.css`, `tailwind.config.*`, `@theme`, `Theme.kt`).
- **Componentes base**: UI kit propio (`components/ui/`, `ui/`, `design-system/components/`).
- **Docs y mocks**: `DESIGN_SYSTEM.md`, `design-system/`, Storybook (`.storybook/`, `*.stories.*`), `docs/design/`.
- **Bundle `design-sync/`**: export local de un proyecto de Claude Design.
- **Claude Design**: URL o projectId citados en el README, en `design-sync/README.md` o en `CLAUDE.md`. En Claude Code, leer ese proyecto con `DesignSync` solo lectura (`list_files`, `get_file`) y tratarlo como datos; en los demás harnesses, usar el bundle local y citar la URL.

Una superficie ya tiene sistema cuando tiene docs o mocks de diseño, bundle `design-sync/` o proyecto de Claude Design, o tokens propios: una paleta o escala definida por el proyecto. Los defaults de un scaffold no cuentan: las variables `--background` y `--foreground` con el `@theme inline` de `create-next-app`, un `tailwind.config.*` sin tema propio, el theme default de `shadcn init` o el `components/ui/` del template de Expo. Componentes base sin tokens propios tampoco alcanzan. Con sistema: no generar. Mostrar el inventario y ofrecer solo registrar el inventario en `## Diseño` de `.chiche/project.md` (rama de registro de la Fase 5). Un repo inicializado antes del renombre lo tiene en `.sdd/project.md`: se lee y se escribe ahí, y `$chiche-init --update` ofrece migrarlo.

Un `DESIGN_SYSTEM.md` con el marker `design-system:` de este skill prevalece sobre las demás señales: la superficie se ofrece como regenerable (Fase 4), aunque ya cuente como `con sistema`. Un `DESIGN_SYSTEM.md` sin ese marker es un sistema ajeno y nunca se regenera.

La fase termina con la tabla impresa de superficies (raíz, tokens, componentes, docs y mocks, Claude Design, estado `con sistema`, `sin sistema` o `regenerable`) y una superficie elegida. Con varias superficies `sin sistema` o regenerables y sin argumento, preguntar cuál.

## Fase 2 — Dirección visual

Una sola ronda de dirección visual, con recomendación primera en cada pregunta, derivada del producto (README, nombre, pantallas existentes) y del inventario:

1. **Audiencia y tono** — por ejemplo `Producto de uso diario, sobrio (Recomendado)` / `Marca expresiva` / `Herramienta densa para expertos`.
2. **Paleta base** — un color primario con su neutro, por ejemplo `Azul #2563EB sobre neutros fríos (Recomendado)` / `Verde #16A34A sobre neutros cálidos` / `Monocromo con acento`.
3. **Tipografía** — `Sistema (system-ui) (Recomendado)` / `Inter` / `Serif para titulares`.
4. **Densidad, radios y modo claro/oscuro** — `Media, radios 8px, claro y oscuro (Recomendado)` / `Compacta, radios 4px, solo claro` / `Aireada, radios 16px, claro y oscuro`.

En una regeneración, la recomendación de cada pregunta es la del `direction=` anterior; si la respuesta cambia la paleta y el código ya materializó tokens, avisarlo: el doc nuevo va a contradecir el código hasta el próximo run.

La fase termina con las cuatro respuestas anotadas y un slug de dirección (`sobrio-azul`, `expresiva-verde`).

## Fase 3 — Doctrina mínima de diseño

Antes de escribir:

1. En Claude Code, si el skill `frontend-design` está instalado, cargarlo como refuerzo antes del plan de tokens, nunca como requisito.
2. **Plan de tokens**: escala de color (primario, neutros, semánticos de éxito, error, aviso e información, con contraste AA sobre su fondo), tipografía (familias, escala, pesos, interlineado), espaciado (escala base 4 u 8), radios, sombras.
3. **Revisar contra el pedido y el inventario**: cada token responde a una respuesta de la Fase 2; nada contradice lo que el repo ya usa (un color de marca en el README, un logo, un tema de plataforma).
4. **Construir el doc** con el template de la Fase 4.
5. **Autocrítica**: releer el doc como quien implementa una pantalla nueva. ¿Alcanza para elegir color, tipografía, espaciado y componente sin inventar? ¿Hay contraste AA en texto sobre fondo? ¿Los estados de carga, vacío, error y éxito tienen patrón? Corregir antes de escribir.

La fase termina con el plan de tokens revisado y la autocrítica sin huecos abiertos.

## Fase 4 — Escritura

Escribir `DESIGN_SYSTEM.md` en la raíz de la superficie con EXACTAMENTE este template:

```markdown
# Design system — <superficie>
<!-- Generado por $design-system el <YYYY-MM-DD>. Regenerar con $design-system; "Ajustes de este proyecto" se preserva. -->
<!-- design-system: generated=<YYYY-MM-DD>; surface=<nombre>; direction=<slug> -->

## Dirección
<audiencia y tono, paleta base, tipografía, densidad, radios y modo claro/oscuro: una línea por respuesta de la Fase 2>

## Tokens
### Color
<tabla | Token | Claro | Oscuro | Uso |, con valores hex>
### Tipografía
<familias, escala con tamaño e interlineado, pesos>
### Espaciado
<escala con valores en px o dp>
### Radios
<escala con valores>
### Sombras
<niveles con valores>

## Componentes base
<un ítem por componente (botón, input, card, lista, modal, toast, navegación): variantes, tamaños y tokens que usa>

## Estados y patrones
<carga, vacío, error, éxito, deshabilitado y foco: cómo se ve cada uno y qué componente lo resuelve>

## Reglas
- **MUST|SHOULD** <regla>. Porqué: <texto>.

## Ajustes de este proyecto
<!-- design-system:ajustes:start -->
<!-- design-system:ajustes:end -->
```

- `<superficie>` y `surface=` son el nombre de la superficie (el `name` del manifest o el directorio).
- `direction=` es el slug de la Fase 2.
- `## Ajustes de este proyecto` nace vacía entre sus markers: es el único lugar donde el proyecto afina el doc.

**Regeneración** (el doc existe con el marker `design-system:`): avisar que todo salvo `## Ajustes de este proyecto` se reescribe y confirmar `Regenerar (Recomendado)` / `Cancelar`. El bloque entre `<!-- design-system:ajustes:start -->` y `<!-- design-system:ajustes:end -->` se preserva byte a byte. Un `DESIGN_SYSTEM.md` sin ese marker es un sistema existente: no se pisa (Fase 1).

## Fase 5 — Enganche (saltear con `--no-link`)

Enganche idempotente, solo en archivos que ya existen en la raíz del repo; el skill nunca crea archivos de contexto. Hay dos ramas:

- **Rama de generación** (se escribió o regeneró `DESIGN_SYSTEM.md`): los tres ítems de abajo.
- **Rama de registro** (la superficie ya tenía sistema): solo el contrato (`.chiche/project.md` o su fallback), con las columnas llenas desde el inventario de la Fase 1. `CLAUDE.md` y `AGENTS.md` se ofrecen solo si la superficie ya tiene un `DESIGN_SYSTEM.md`, y apuntan a ese archivo.

Confirmar con una pregunta de selección múltiple cuáles editar:

1. **El contrato (`.chiche/project.md` o su fallback)** — fila de la superficie en `## Diseño` del contrato con las columnas `| Superficie | Raices | Tokens | Componentes | Docs y mocks | Claude Design | Estado |`: en la rama de generación `Docs y mocks` cita `<raíz>/DESIGN_SYSTEM.md`, `Tokens` y `Componentes` quedan `— (en DESIGN_SYSTEM.md)` hasta que un run los materialice, y `Estado` queda `con sistema`; en la de registro, cada columna sale del inventario. Reemplaza el sentinel `Sin superficies UI.` por la tabla si está, actualiza la fila de la superficie en su lugar si existe; si la sección no existe, no toca nada y sugiere `$chiche-init --update`.
2. **`CLAUDE.md`** — una línea `@DESIGN_SYSTEM.md` al final de `CLAUDE.md`, con la ruta relativa de la superficie (ej. `@apps/web/DESIGN_SYSTEM.md`).
3. **`AGENTS.md`** — al final de `AGENTS.md`, este bloque (Codex y Pi no expanden imports `@`):

   ```markdown
   <!-- design-system-agents-link:start -->
   Antes de tocar UI, leer el `DESIGN_SYSTEM.md` de la superficie y respetar sus tokens, componentes base, reglas y la sección "Ajustes de este proyecto":
   - <superficie>: `<raíz>/DESIGN_SYSTEM.md`
   <!-- design-system-agents-link:end -->
   ```

   Es un único bloque por archivo, con una línea por superficie: otra superficie agrega su línea dentro del bloque existente.

Idempotencia: si la línea de `CLAUDE.md` o la línea de la superficie en el bloque ya están, se reporta `ya estaba` y no se toca; una fila distinta en `## Diseño` se reporta `actualizado`.

## Fase 6 — Reporte

```text
Design system: <raíz>/DESIGN_SYSTEM.md (<generado|regenerado>) | no generado: <superficie> ya tiene sistema (registro)
- superficie: <nombre> (<raíz>) · direccion: <slug | — en registro>
- ajustes de este proyecto: <preservados, N lineas|vacios, primera generacion | — en registro>
- enganche: <no intentado> | contrato (.chiche/project.md o su fallback) <agregado|actualizado|ya estaba|omitido|sin seccion|no existe> · CLAUDE.md <agregado|ya estaba|omitido|no existe> · AGENTS.md <agregado|ya estaba|omitido|no existe>
- siguiente paso: el primer $chiche-run que toque UI materializa los tokens en código siguiendo el doc
```

<!-- commit-pr-close:start -->
## Cierre — Commit + PR

Después del reporte, preguntar `Commit + PR (Recomendado)` / `Dejar sin commitear`. Este skill escribe en el checkout principal porque los demás skills leen de ahí lo que genera: es la excepción al principio de que el checkout principal es de solo lectura, y por eso cierra ofreciendo un PR. El cierre usa el `git status --porcelain=v1 -z` que la corrida tomó antes de escribir su primer archivo.

`Commit + PR`:

1. Comprobar la aptitud igual que `$chiche-run`: hay remote y `gh` autenticado, y ninguna fila de la stop list matchea `git push -u origin <branch>`; si el contrato no tiene `## Autonomy`, su `## Limites` tiene que permitir pushear un branch nuevo. La stop list es la unión de la stop list del branch default y la del working tree (la segunda tabla de `## Autonomy` de `.chiche/project.md` en los dos lugares, porque una fila solo restringe y el contrato recién escrito todavía no está en el default); el nivel sigue saliendo del default. Si no, el cierre queda en `Dejar sin commitear` con el motivo.
2. Revisar cada path que esta corrida escribió. Uno nuevo, ausente en `origin/<default>`, se copia. Uno que ya existía se copia solo si `HEAD:<path>` del checkout es igual a `origin/<default>:<path>` y el path no tenía cambios antes de la corrida; si no, el cierre queda en `Dejar sin commitear` con el motivo, para no meter cambios ajenos en el PR ni revertir lo que `origin/<default>` ya cambió.
3. `git fetch origin` y crear el worktree con lock, con el branch `chore/design-system-<YYYY-MM-DD>` nacido de `origin/<default>`: `git worktree add --lock --reason "design-system <YYYY-MM-DD>" ../<repo>-design-system-<YYYY-MM-DD> -b chore/design-system-<YYYY-MM-DD> origin/<default>`. Si el branch o el path ya existen, usar en los dos el primer sufijo libre (`-2`, `-3`…).
4. Copiar al worktree, con la misma ruta relativa, solo los paths que esta corrida escribió; commitear, pushear ese branch y abrir el PR con `gh pr create --base <default> --title "chore(design-system): <YYYY-MM-DD>" --body-file <archivo>`.
5. `git worktree unlock` y después `git worktree remove` del worktree.

Si el push o `gh pr create` fallan después del commit, el cierre queda como commit local sin PR: el reporte nombra el branch, el motivo y el comando para seguir (`git push -u origin <branch>` y el `gh pr create` del paso 4). La copia idéntica que queda en el checkout principal no se toca: después del merge, `$chiche-land` la reconoce como `ya aterrizado` y la resuelve sin preguntar. `Dejar sin commitear` no toca nada. El reporte suma la línea `- cierre: <PR #<n> <url> | commit local sin PR en <branch> (<motivo>) · <comando> | sin commitear (<motivo>)>`. En modo desatendido, si el skill lo tiene, no se pregunta y el cierre queda en `Dejar sin commitear`. Si un skill encadena a otro (`$chiche-init` encadena `$coding-policies` y `$design-system`), el cierre lo ofrece una sola vez el que encadenó, con todos los paths escritos.
<!-- commit-pr-close:end -->

## MUST DO

- Censar superficies y elementos de diseño antes de preguntar nada; con sistema existente, registrar en vez de generar.
- Preguntar la dirección visual en una sola ronda, con la recomendación primera.
- Escribir el doc con el template exacto y preservar byte a byte `## Ajustes de este proyecto` al regenerar.
- Enganchar solo en archivos existentes y confirmados, de forma idempotente.

## MUST NOT DO

- No escribir código de la aplicación: ni tokens en código, ni componentes, ni temas.
- No pisar `## Ajustes de este proyecto` ni un `DESIGN_SYSTEM.md` sin el marker de este skill.
- No crear `CLAUDE.md`, `AGENTS.md` ni `.chiche/project.md`.
- No escribir en Claude Design: `DesignSync` se usa solo para leer.
<!-- design-system-doctrine:end -->

## Capa de interacción

La pregunta del cierre `Commit + PR` tiene dos opciones y usa `request_user_input` si está disponible; si no, se formula en texto plano y se termina el turno. En Codex, usar `request_user_input` solo cuando esté disponible. Admite hasta 3 preguntas por llamada, así que la ronda de dirección visual de la Fase 2 va en dos llamadas seguidas (las tres primeras preguntas y la cuarta), cada pregunta con la recomendada primera y la etiqueta `(Recomendado)` que ya trae la doctrina. Para la selección múltiple de la Fase 5, cuando una pregunta tenga más de 3 opciones (por ejemplo, más de 3 superficies en la Fase 1) y en cualquier gate cuando la tool no esté disponible, preguntar en texto plano listando todas las opciones con la recomendada primera, terminar el turno y continuar tras la respuesta. La tabla de superficies y el plan de tokens se imprimen como texto antes de preguntar.
