---
name: coding-policies
description: Genera en el proyecto un archivo Markdown autocontenido con una baseline transversal de Clean Code y SOLID más tus buenas prácticas por stack (contenido para Go, TypeScript, Node.js, React, Next.js, React Native y Kotlin Multiplatform) y lo engancha en CLAUDE.md, AGENTS.md o .sdd/project.md para que toda sesión las siga. Usar cuando el usuario pida "coding policies", "buenas prácticas", "políticas de código", "mis prácticas de Go", "mis prácticas de TypeScript", "mis prácticas de Node", "mis prácticas de React", "mis prácticas de Next.js", "mis prácticas de React Native", "mis prácticas de Kotlin Multiplatform", "mis prácticas de KMP", "mis prácticas de KMM", que el agente siga sus prácticas en este repo, o que genere o regenere .sdd/coding-policies.md. También cuando sdd-init lo encadene al terminar el contrato.
---

Genera en el proyecto un archivo Markdown **autocontenido** con una baseline transversal de Clean Code y SOLID más las buenas prácticas del usuario por stack — reglas cortas MUST/SHOULD con su porqué y su gate — copiadas desde las referencias de este skill (`references/<id>.md`), y lo engancha en los archivos de contexto existentes para que toda sesión lo cargue. Las prácticas viven una sola vez en el skill; cada proyecto recibe un snapshot versionado que puede afinar en una sección propia que la regeneración preserva. Los argumentos pueden traer stacks explícitos, el destino y flags, o ir vacíos.

Tres ideas fuerza:

1. **Las prácticas viven en el skill, no en cada proyecto.** Agregar o cambiar una regla se hace en `references/<id>.md` y se propaga regenerando; el proyecto nunca es la fuente de verdad de la práctica, solo de sus ajustes.
2. **El archivo generado es autocontenido.** Quien lo lee (agente o humano) tiene las reglas completas sin abrir el skill; los links a las guías base son lectura ampliada, no la regla.
3. **El skill no inventa reglas.** Un stack sin referencia se informa como "sin prácticas definidas todavía" y no genera sección: mejor un hueco visible que una regla que nadie eligió.

En Codex, usar `request_user_input` solo cuando esté disponible y la decisión tenga 2-4 opciones mutuamente excluyentes. Para selección múltiple (stacks, archivos de enganche), preguntar en texto plano listando todas las opciones, terminar el turno y continuar tras la respuesta.

<!-- coding-policies-doctrine:start -->
## Argumentos

```text
$coding-policies [go|typescript|node|react|next|react-native|kotlin-multiplatform|kmp|kmm|kotlin-android ...] [--out <ruta>] [--no-link]
```

- Stacks posicionales (`go`, `typescript`, `node`, `react`, `next`, `react-native`, `kotlin-multiplatform`, `kmp`, `kmm`, `kotlin-android`) — saltean la confirmación de stacks de la Fase 0: se toman como selección explícita aunque el marcador no se detecte (el usuario sabe más que el marcador), y después se normalizan aliases y dependencias. Un id desconocido frena con la lista de ids válidos y aliases.
- Los aliases `kmp` y `kmm` se normalizan a `kotlin-multiplatform` antes de comprobar cobertura, escribir markers y reportar.
- `next` incorpora `react` antes de comprobar cobertura, generar y reportar, tanto si se detectó como si llegó como stack posicional.
- `--out <ruta>` — destino del archivo; saltea la pregunta de destino. Default: `.sdd/coding-policies.md`.
- `--no-link` — saltea el enganche de la Fase 4: genera el archivo y no toca ningún archivo de contexto.

## Fase 0 — Lanzador (pregunta solo lo que los argumentos no fijan)

Con argumentos vacíos dispara completo. Con argumentos, pregunta solo lo que no fijaron: los stacks posicionales saltean la confirmación de stacks, `--out` saltea la pregunta de destino, y `--no-link` no afecta a esta fase (saltea solo la Fase 4). Con stacks y `--out` a la vez, la fase no dispara.

Correr primero la detección de la Fase 1 y mostrar el resultado como texto visible: cada stack detectado con la ruta donde se vio y si tiene referencia en el skill (con su versión) o queda "sin prácticas definidas todavía".

```text
$coding-policies genera en este repo un archivo con tus buenas practicas por stack,
listo para referenciar desde CLAUDE.md, AGENTS.md o .sdd/project.md. Todo salvo la
seccion "Ajustes de este proyecto" se regenera desde el skill; esa seccion es tuya.

Baseline transversal:
  • clean-code     — siempre incluida            · con referencia (clean-code@<version>)

Stacks detectados:
  • go             — go.mod (raiz)              · con referencia (go@<version>)
  • typescript     — tsconfig.json (raiz)       · con referencia (typescript@<version>)
  • node           — package.json (tools/cli)   · con referencia (node@<version>)

Destino default: .sdd/coding-policies.md

Atajo: $coding-policies [stacks...] [--out <ruta>] fija stacks y destino y saltea este
menu; --no-link solo saltea el enganche.
```

Luego preguntar en texto plano con todas las opciones y terminar el turno — "¿Qué stacks entran?": una opción por stack detectado, los cubiertos primero y marcados `(Recomendado)`, los no cubiertos con la nota "sin prácticas definidas todavía". Y una segunda pregunta — "¿Dónde lo genero?": `.sdd/coding-policies.md (Recomendado)` / `docs/coding-policies.md` / otra ruta vía custom.

## Fase 1 — Detección de stacks

Buscar marcadores en la raíz y hasta profundidad 2, excluyendo `node_modules`, `vendor`, `.git`, `dist` y `build`. En `package.json` mirar las claves exactas de `dependencies` y `devDependencies`, no substrings. Cada stack detectado registra dónde se vio (ruta del marcador), para mostrarlo en la confirmación y en el reporte.

| Stack | id | Marcador |
|---|---|---|
| Go | `go` | `go.mod` |
| TypeScript | `typescript` | `tsconfig*.json` |
| React web | `react` | `package.json` con `react-dom` |
| Next.js | `next` | `package.json` con la clave exacta `next` en sus dependencias |
| React Native | `react-native` | `package.json` con la clave exacta `react-native` o `expo` en sus dependencias (`react-native-web` no cuenta) |
| Node | `node` | `package.json` sin `react-native`, `expo`, `react-dom` ni `next` |
| Kotlin Multiplatform | `kotlin-multiplatform` | `build.gradle`, `build.gradle.kts` o `gradle/libs.versions.toml` que declare `org.jetbrains.kotlin.multiplatform` o `kotlin("multiplatform")` |
| Kotlin Android | `kotlin-android` | `build.gradle`, `build.gradle.kts` o `gradle/libs.versions.toml` que declare `com.android.application` o `com.android.library` |

TypeScript se detecta de forma independiente y puede coexistir con Node, React, Next.js o React Native en el mismo proyecto. Next.js se detecta de forma independiente por su marcador y `next` incorpora `react` para que la salida también incluya las políticas React core, incluso con selección posicional; puede coexistir con TypeScript. `next` no incorpora `node`: la referencia Next.js representa y cubre la capa servidor del framework. Entre React Native, React y Node, un mismo `package.json` clasifica en uno solo: `react-native` gana sobre `react`, y `react` sobre `node`.

En un mismo marcador Gradle, `kotlin-multiplatform` prevalece sobre `kotlin-android`; distintos manifests pueden aportar ambos. En general, distintos manifests pueden aportar distintos stacks (un monorepo con API en Go y web en Next.js detecta todos los que correspondan).

## Fase 2 — Cobertura

`references/clean-code.md` es la baseline transversal obligatoria: se incluye exactamente una vez en todo archivo generado, antes de las secciones por stack, y no se detecta ni se ofrece como stack. Si falta o su frontmatter es inválido, frenar sin escribir. Un stack está cubierto si existe `references/<id>.md` en el directorio de este skill. Los stacks confirmados sin referencia se informan en la confirmación y en el reporte como "sin prácticas definidas todavía" y no generan sección: el skill no inventa reglas. Si ningún stack confirmado está cubierto, no se genera archivo y se informa; el skill termina ahí, sin enganche.

## Fase 3 — Generación

Escribir el destino con EXACTAMENTE este template (crea `.sdd/` — o el directorio de `--out` — si no existe):

```markdown
# Coding policies — <proyecto>
<!-- Generado por $coding-policies el <YYYY-MM-DD>. Regenerar con $coding-policies; "Ajustes de este proyecto" se preserva. -->
<!-- coding-policies: generated=<YYYY-MM-DD>; baseline=clean-code@<YYYY-MM-DD>; stacks=<id>@<YYYY-MM-DD>[,<id>@<YYYY-MM-DD>...] -->

## <Nombre de la baseline>
<!-- coding-policies:baseline=clean-code; version=<YYYY-MM-DD> -->
<cuerpo de references/clean-code.md sin su frontmatter, copiado verbatim: temas, reglas y lectura ampliada>

## <Nombre del stack>
<!-- coding-policies:stack=<id>; version=<YYYY-MM-DD> -->
<cuerpo de references/<id>.md sin su frontmatter, copiado verbatim: temas, reglas y lectura ampliada>

## Ajustes de este proyecto
<!-- coding-policies:ajustes:start -->
<!-- coding-policies:ajustes:end -->
```

- `<proyecto>`: nombre del directorio raíz (o el `name`/`module` del manifest principal si es más claro).
- `baseline=` registra `clean-code@<version>` y su sección `## <Nombre>` va primero y exactamente una vez; `<Nombre>` y `<version>` salen del frontmatter de `references/clean-code.md`.
- Una sección `## <Nombre>` por stack cubierto, en el orden de la tabla de la Fase 1; `<Nombre>` y `<version>` salen del frontmatter de la referencia (`name`, `version`), y `stacks=` lista solo esos pares `<id>@<version>` en el mismo orden.
- El cuerpo de cada referencia se copia verbatim: mismos temas `###`, mismas reglas, misma "Lectura ampliada". No se resume, no se reordena, no se traduce.
- `## Ajustes de este proyecto` nace vacía entre sus markers: es el único lugar donde el proyecto agrega, afina o desactiva reglas.

### Regeneración (el destino ya existe)

1. Leer el marker de cabecera del archivo existente y comparar `baseline=` y `stacks=` con las referencias actuales: listar como texto visible la baseline o stacks desactualizados (`<id>: <version vieja|ausente> → <version nueva>`), y los stacks que entran o salen.
2. Avisar que todo salvo `## Ajustes de este proyecto` se reescribe, y usar `request_user_input` (o el mismo gate en texto plano, terminando el turno): `Regenerar (Recomendado)` / `Cancelar`.
3. Preservar verbatim el bloque entre `<!-- coding-policies:ajustes:start -->` y `<!-- coding-policies:ajustes:end -->`, byte a byte. El skill nunca interpreta el contenido de Ajustes: no lo valida, no lo reformatea, no lo "mejora".
4. Si el archivo existe pero no tiene los dos markers de ajustes, no lo pisa: lo dice, termina ahí sin enganche, y sugiere otra ruta con `--out` o agregar los markers a mano antes de regenerar.

## Fase 4 — Enganche (saltear con `--no-link`)

Detectar en la raíz `CLAUDE.md`, `AGENTS.md` y `.sdd/project.md`. Solo se ofrecen los que existen: el skill nunca crea archivos de contexto; si no existe ninguno, lo informa y termina. Luego preguntar en texto plano con todas las opciones y terminar el turno — "¿Dónde agrego la referencia?": una opción por archivo existente. Editar únicamente los confirmados, de forma idempotente: en `CLAUDE.md` y `AGENTS.md`, verificando antes que `<ruta>` no esté ya presente (si ya está, se reporta `ya estaba` y no se toca); en `.sdd/project.md`, comparando la fila entera (igual → `ya estaba`; distinta, por ejemplo por otros stacks → `actualizado`):

1. **CLAUDE.md** — agregar al final una línea `@<ruta>` (Claude Code expande imports `@`).
<!-- coding-policies-agents-link:start -->
2. **AGENTS.md** — agregar al final este bloque (Pi y Codex no expanden imports `@`):

   ```markdown
   <!-- coding-policies -->
   Antes de escribir o modificar código en este proyecto, leer `<ruta>` y respetar sus reglas y la sección "Ajustes de este proyecto".
   ```
<!-- coding-policies-agents-link:end -->
3. **.sdd/project.md** — en la tabla de `## Politicas de generacion`, la fila `| coding-policies | <ruta> (<stacks>) | guia — sin gate: $sdd-run la sigue al generar, la juzga el reviewer |`, reemplazando el sentinel "Sin politicas activas" por la tabla (`| Politica | Valor | Gate |`) si está, actualizando la fila en su lugar si ya existe, y sin tocar nada si la sección no existe: lo informa y sugiere `$sdd-init --update`.

## Fase 5 — Reporte

```text
Coding policies listas: <ruta> (<generado|regenerado>)
- baseline: clean-code@<version> (incluida)
- stacks: <id>@<version> (cubierto) · <id> (sin practicas definidas todavia)
- ajustes de este proyecto: <preservados, N lineas|vacios, primera generacion>
- enganche: <no intentado> | CLAUDE.md <agregado|ya estaba|omitido|no existe> · AGENTS.md <agregado|ya estaba|omitido|no existe> · .sdd/project.md <agregado|actualizado|ya estaba|omitido|sin seccion|no existe>
- desactualizados antes de regenerar: <id: <vieja|ausente> → <nueva>, ... | ninguno>
```

`omitido` es el archivo que existía y el usuario no eligió; `no intentado` cubre `--no-link` y las corridas que terminaron antes del enganche (ningún stack cubierto, destino sin markers de ajustes).

## MUST DO

- Detectar y confirmar los stacks antes de generar; con stacks posicionales, usarlos sin confirmar.
- Copiar primero y una sola vez la baseline `clean-code`, luego el cuerpo de cada referencia por stack, todo verbatim; escribir `baseline=clean-code@<version>` y `stacks=<id>@<version>` en el marker de cabecera.
- Preservar byte a byte el bloque de "Ajustes de este proyecto" al regenerar, y avisar antes de reescribir el resto.
- Enganchar solo en archivos de contexto existentes y confirmados, de forma idempotente.
- Reportar la baseline, cada stack (cubierto o sin prácticas definidas todavía), cada archivo del enganche y la baseline o stacks desactualizados.

## MUST NOT DO

- No tocar configuración global de ningún harness (`~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.pi`): el skill escribe solo dentro del proyecto.
- No crear archivos de contexto (`CLAUDE.md`, `AGENTS.md`, `.sdd/project.md`); solo editar los existentes que el usuario confirmó.
- No editar sin confirmación: ni el destino existente ni los archivos de contexto.
- No inventar reglas para stacks sin referencia, ni resumir o reescribir las de una referencia.
- No omitir, repetir ni ofrecer como stack seleccionable la baseline `clean-code`.
- No interpretar, validar ni reformatear el contenido de "Ajustes de este proyecto".
- No pisar un destino existente que no tenga los dos markers de ajustes.
<!-- coding-policies-doctrine:end -->

## Referencias

- `references/clean-code.md` — baseline transversal siempre incluida, con responsabilidad única, tamaños saludables, SOLID y protección contra el sobre-split. Fuentes: criterios confirmados por el usuario, Google, ESLint, Detekt, golangci-lint, React, Martin Fowler y Robert C. Martin.
- `references/go.md` — Go. Fuentes: prácticas del usuario observadas en sus repos, Uber Go Style Guide, Effective Go, Go Code Review Comments y Package Oriented Design.
- `references/typescript.md` — TypeScript general y transversal al runtime o framework. Fuentes: criterios provistos por el usuario, documentación de TypeScript, typescript-eslint, Node.js, Zod y la guía de rendimiento del compilador.
- `references/node.md` — Node.js. Fuentes: criterios provistos por el usuario y documentación oficial de Node.js y npm.
- `references/react.md` — React web. Fuentes: criterios provistos por el usuario y documentación oficial de React.
- `references/next.md` — Next.js, como capa adicional a React. Fuentes: criterios provistos por el usuario y documentación oficial de Next.js.
- `references/react-native.md` — React Native, con React core y reglas condicionales para Expo. Fuentes: criterios provistos por el usuario y documentación oficial de React, React Native y Expo.
- `references/kotlin-multiplatform.md` — Kotlin Multiplatform, con reglas condicionales para Compose Multiplatform. Fuentes: criterios provistos por el usuario y documentación oficial de Kotlin y JetBrains.

Las referencias bajo cada harness son mirrors generados: la única fuente editable vive en `shared/coding-policies/references/`. No modificar directamente `claude/coding-policies/references/`, `codex/coding-policies/references/`, `opencode/coding-policies/references/` ni `pi/coding-policies/references/`.

Para cambiar la baseline transversal: editar `shared/coding-policies/references/clean-code.md`, subir su `version` y sincronizar los mirrors.

Para agregar un stack: crear `shared/coding-policies/references/<id>.md` con frontmatter `stack: <id>`, `name: <Nombre>`, `version: <YYYY-MM-DD>`; el cuerpo en temas `###` con reglas `- **MUST|SHOULD** <regla>. Porqué: <texto>. Gate: <herramienta y regla | —>` y un tema final `### Lectura ampliada` con los links. Subir `version` en cada cambio de reglas y ejecutar `node scripts/sync-coding-policies-references.mjs`; `node scripts/sync-coding-policies-references.mjs --check` valida que los cuatro mirrors estén sincronizados.
