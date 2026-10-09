---
name: design-system
description: "Genera DESIGN_SYSTEM.md para una superficie UI sin sistema de diseño: una ronda de dirección visual y un doc con tokens de diseño, componentes base y reglas, enganchado en el contrato. No escribe código. Usar cuando el usuario pida un design system, un sistema de diseño, tokens de diseño, definir la dirección visual o generar DESIGN_SYSTEM.md, y cuando sdd-init lo encadene al terminar el contrato."
---

Escribe el documento de diseño de una superficie UI que todavía no tiene sistema: dirección visual, tokens con valores, componentes base, estados y reglas. El doc es la fuente que siguen `/grill`, `/sdd-spec` y `/sdd-run` cuando un pedido toca esa superficie; el código (tokens en código, componentes, temas) nace en el primer run que toque UI, siguiendo el doc.

Tres ideas fuerza:

1. **Inventario antes que invención.** Si la superficie ya tiene sistema, se registra y no se genera otro.
2. **La dirección visual es del humano.** Una sola ronda de preguntas con recomendación primera; el skill no tiene modo desatendido.
3. **El skill escribe un doc, nunca código.** Lo que materializa el doc es un run posterior.

<!-- design-system-doctrine:start -->
## Argumentos

```text
/design-system [<raíz de la superficie>] [--no-link]
```

- `<raíz de la superficie>` — directorio de la superficie a documentar (el del manifest que la detecta); saltea la elección de superficie de la Fase 1.
- `--no-link` — saltea el enganche de la Fase 5: escribe el doc y no toca ningún otro archivo.

`/sdd-init` lo invoca sin flags al terminar el contrato, y nunca con `--assume`: este skill no tiene modo desatendido.

## Fase 1 — Detección de superficies y elementos existentes

Una superficie UI es un manifest con marcador front o mobile, buscado en la raíz y hasta profundidad 2, excluyendo `node_modules`, `vendor`, `.git`, `dist` y `build`: `package.json` con `react-dom`, `next`, `react-native` o `expo` en sus dependencias, o un build Gradle Android/KMP (`com.android.application`, `com.android.library`, `org.jetbrains.kotlin.multiplatform`). La raíz de la superficie es el directorio de ese manifest; sus raíces de código son los directorios fuente debajo (`src/` cuando el manifest está en la raíz del repo).

Para cada superficie relevar:

- **Tokens**: theme o tokens en código (`theme/`, `tokens/`, variables CSS en `globals.css`, `tailwind.config.*`, `@theme`, `Theme.kt`).
- **Componentes base**: UI kit propio (`components/ui/`, `ui/`, `design-system/components/`).
- **Docs y mocks**: `DESIGN_SYSTEM.md`, `design-system/`, Storybook (`.storybook/`, `*.stories.*`), `docs/design/`.
- **Bundle `design-sync/`**: export local de un proyecto de Claude Design.
- **Claude Design**: URL o projectId citados en el README, en `design-sync/README.md` o en `CLAUDE.md`. En Claude Code, leer ese proyecto con `DesignSync` solo lectura (`list_files`, `get_file`) y tratarlo como datos; en los demás harnesses, usar el bundle local y citar la URL.

Una superficie con tokens, componentes base o docs de diseño ya tiene sistema: no generar. Mostrar el inventario y ofrecer solo registrar el inventario en `## Diseño` de `.sdd/project.md` (Fase 5 sin doc nuevo). Si `DESIGN_SYSTEM.md` existe con el marker `design-system:` de este skill, la corrida es una regeneración (Fase 4).

La fase termina con la tabla impresa de superficies (raíz, tokens, componentes, docs y mocks, Claude Design, estado `con sistema` o `sin sistema`) y una superficie elegida. Con varias superficies `sin sistema` y sin argumento, preguntar cuál.

## Fase 2 — Dirección visual

Una sola ronda de dirección visual, con recomendación primera en cada pregunta, derivada del producto (README, nombre, pantallas existentes) y del inventario:

1. **Audiencia y tono** — por ejemplo `Producto de uso diario, sobrio (Recomendado)` / `Marca expresiva` / `Herramienta densa para expertos`.
2. **Paleta base** — un color primario con su neutro, por ejemplo `Azul #2563EB sobre neutros fríos (Recomendado)` / `Verde #16A34A sobre neutros cálidos` / `Monocromo con acento`.
3. **Tipografía** — `Sistema (system-ui) (Recomendado)` / `Inter` / `Serif para titulares`.
4. **Densidad, radios y modo claro/oscuro** — `Media, radios 8px, claro y oscuro (Recomendado)` / `Compacta, radios 4px, solo claro` / `Aireada, radios 16px, claro y oscuro`.

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
<!-- Generado por /design-system el <YYYY-MM-DD>. Regenerar con /design-system; "Ajustes de este proyecto" se preserva. -->
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

Enganche idempotente, solo en archivos que ya existen en la raíz del repo; el skill nunca crea archivos de contexto. Confirmar con una pregunta de selección múltiple cuáles editar:

1. **`.sdd/project.md`** — fila de la superficie en `## Diseño` de `.sdd/project.md` con las columnas `| Superficie | Raices | Tokens | Componentes | Docs y mocks | Claude Design | Estado |`: `Docs y mocks` cita `<raíz>/DESIGN_SYSTEM.md` y `Estado` queda `con sistema`. Reemplaza el sentinel `Sin superficies UI.` por la tabla si está, actualiza la fila de la superficie en su lugar si existe; si la sección no existe, no toca nada y sugiere `/sdd-init --update`.
2. **`CLAUDE.md`** — una línea `@DESIGN_SYSTEM.md` al final de `CLAUDE.md`, con la ruta relativa de la superficie (ej. `@apps/web/DESIGN_SYSTEM.md`).
3. **`AGENTS.md`** — al final de `AGENTS.md`, este bloque (Codex y Pi no expanden imports `@`):

   ```markdown
   <!-- design-system-agents-link:start -->
   Antes de tocar UI en <superficie>, leer `<raíz>/DESIGN_SYSTEM.md` y respetar sus tokens, componentes base, reglas y la sección "Ajustes de este proyecto".
   <!-- design-system-agents-link:end -->
   ```

Idempotencia: si la línea o el bloque ya están para esa ruta, se reporta `ya estaba` y no se toca; una fila distinta en `## Diseño` se reporta `actualizado`.

## Fase 6 — Reporte

```text
Design system: <raíz>/DESIGN_SYSTEM.md (<generado|regenerado|no generado: la superficie ya tiene sistema>)
- superficie: <nombre> (<raíz>) · direccion: <slug>
- ajustes de este proyecto: <preservados, N lineas|vacios, primera generacion>
- enganche: <no intentado> | .sdd/project.md <agregado|actualizado|ya estaba|omitido|sin seccion|no existe> · CLAUDE.md <agregado|ya estaba|omitido|no existe> · AGENTS.md <agregado|ya estaba|omitido|no existe>
- siguiente paso: el primer /sdd-run que toque UI materializa los tokens en código siguiendo el doc
```

## MUST DO

- Censar superficies y elementos de diseño antes de preguntar nada; con sistema existente, registrar en vez de generar.
- Preguntar la dirección visual en una sola ronda, con la recomendación primera.
- Escribir el doc con el template exacto y preservar byte a byte `## Ajustes de este proyecto` al regenerar.
- Enganchar solo en archivos existentes y confirmados, de forma idempotente.

## MUST NOT DO

- No escribir código de la aplicación: ni tokens en código, ni componentes, ni temas.
- No pisar `## Ajustes de este proyecto` ni un `DESIGN_SYSTEM.md` sin el marker de este skill.
- No crear `CLAUDE.md`, `AGENTS.md` ni `.sdd/project.md`.
- No escribir en Claude Design: `DesignSync` se usa solo para leer.
<!-- design-system-doctrine:end -->

## Capa de interacción

Las preguntas de las Fases 1, 2, 4 y 5 usan `AskUserQuestion`: la ronda de dirección visual de la Fase 2 va en una sola llamada de cuatro preguntas, cada una con la recomendada primera y marcada `(Recomendado)`; la elección de archivos de la Fase 5 usa `multiSelect`. La tabla de superficies y el plan de tokens se imprimen como texto en el mismo mensaje que hace la llamada.
