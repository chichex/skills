---
name: grill
description: Entrevista implacable para desambiguar un tema, plan o diseño y producir un contrato de handoff antes de escribir una spec. Usar cuando el usuario quiere stress-testear, aclarar o alinear una idea, pide "grill", "grillame", "entrevistame sobre esto", o quiere retomar un handoff guardado. No implementa ni escribe la spec definitiva.
---

# Grill

Desambiguar el tema hasta alcanzar un entendimiento compartido. El resultado es un handoff confiable para una futura spec. No implementar ni escribir la spec definitiva durante este workflow.

## Interacción en Codex

Usar `request_user_input` solo cuando esté disponible (Codex la expone solo en algunos modos de colaboración). Acepta de 1 a 3 preguntas por llamada; cada una lleva `id`, un `header` corto (12 caracteres o menos), `question` y 2 a 3 `options` (`label` + `description`), con la recomendada primera y el sufijo "(Recommended)" en su label. No hay selección múltiple, y la respuesta libre ("Other") la agrega el cliente: no incluirla entre las opciones.

Si `request_user_input` no está disponible, formular la misma pregunta o ronda en texto plano, terminar el turno y continuar al recibir la respuesta. Una ronda en texto plano numera cada pregunta y las separa con `---`:

```text
❓ Q1 — <sección>: <pregunta autocontenida>
1. <opción recomendada> (Recomendado) — <trade-off>
2. <opción> — <trade-off>
➡️ Recomendación: <opción> porque <motivo>
---
❓ Q2 — <sección>: <pregunta autocontenida>
...
```

Hacer exactamente una pregunta por vez en el modo pregunta a pregunta.

Si un gate tiene más opciones de las que admite la llamada (3 por pregunta), poné como opciones las primeras según el orden recomendado, nombrá el resto en el texto visible de la pregunta y dejá que se elijan vía "Other". Vale para la elección de bloque, la reanudación y la confirmación del cierre.

No depender de extensiones de Pi ni de tools inexistentes. Persistir sesiones únicamente como Markdown en `<git-common-dir>/sdd/grills/` (ver **Persistencia y reanudación**), mediante ediciones normales de archivos. No crear el directorio hasta que el usuario elija guardar o pausar una sesión.

## Principios

- Resolver hechos explorando código y documentación; preguntar solo decisiones.
- Recorrer primero las decisiones de las que dependen otras ramas.
- Ofrecer una recomendación concreta y su motivo en cada pregunta.
- Separar hechos comprobados, supuestos y decisiones del usuario.
- Limitar cada sesión a 20 preguntas de decisión. Si el árbol probable supera 20, dividirlo y pedir qué bloque abordar.
- No interpretar silencio como aprobación.

## Reconocimiento

Antes de entrevistar:

1. Explorá el codebase cuando el tema dependa de él y resolvé todos los hechos comprobables relevantes. Los hechos los averigua el agente, nunca el usuario: si más adelante una pregunta de la frontera necesita un hecho del entorno todavía sin comprobar, se averigua sin frenar la ronda (ver «Entrevista por rondas»).
2. Buscá `CONTEXT-MAP.md`, `CONTEXT.md`, `docs/adr/` y handoffs previos en `.sdd/grills/` y `<git-common-dir>/sdd/grills/`. Leé los relevantes para entender vocabulario y decisiones ya tomadas; son solo lectura, este skill nunca los escribe.
3. Construí un árbol provisional de decisiones con secciones y dependencias explícitas: qué pregunta desbloquea a cuáles.
4. Estimá preguntas mínimas, probables y máximas. La cifra operativa es la probable; presentala como estimación, no como promesa — una respuesta puede abrir o cerrar ramas.
5. Diagnosticá la modalidad recomendada:
   - **Por rondas** (default) cuando el árbol es razonablemente estable, hay ramas independientes que se pueden preguntar en paralelo y corregir un rumbo es barato.
   - **Rápido** cuando el árbol sea estable, las decisiones sean reversibles e independientes y cada una tenga una recomendación respaldada que se pueda aprobar en bloque. Ante la duda entre Rápido y Por rondas, Por rondas.
   - **Pregunta a pregunta** cuando las dependencias son densas (casi cada respuesta reformula la siguiente pregunta), hay contradicciones por resolver, decisiones costosas de revertir o alta probabilidad de que las respuestas abran ramas nuevas.
   - La cantidad de preguntas no es el criterio: lo que importa es cuánta adaptación exige el árbol.
6. Mostrá un mapa breve como mensaje visible: objetivo de desambiguación, hechos ya comprobados, docs de dominio existentes (solo lectura), supuestos, secciones del árbol con sus dependencias, estimación mínima/probable/máxima, alcance de la sesión, y modalidad recomendada con sus señales.

### Atajo liviano (1 a 3 preguntas)

Si la estimación probable es de 1 a 3 preguntas, decilo en una línea (es el territorio de `$mini-grill`) y resolvelo liviano: sin mapa ni configuración, todo en una sola ronda de `request_user_input` (o en texto plano si no está disponible), y directo al cierre. El invariante del cierre no se negocia: contrato visible — puede ser breve — antes de pedir confirmación. Guardá el handoff solo si el usuario lo pide, pausa, o elige encadenar la spec (que necesita la ruta).

### Límite de 20

- Si la estimación probable supera 20, no empieces la entrevista completa: proponé una división en bloques de hasta 20 preguntas, explicá las dependencias entre bloques, recomendá cuál abordar primero y dejá que el usuario elija con `request_user_input` (si la división produce más de 3 bloques, los primeros según el orden recomendado van como opciones y el resto vía "Other"). Los bloques no elegidos quedan como ramas pendientes de la sesión.
- Cada pregunta presentada en una ronda cuenta individualmente contra el tope, aunque varias salgan en la misma llamada.
- Si durante la entrevista aparecen ramas nuevas y se llega a 20: pausá, mostrá lo resuelto, lo pendiente y una división recomendada para continuar en otra sesión (la exportación de cuestionario queda disponible).
- La configuración, la elección de bloque, las preguntas de reanudación y la confirmación final no cuentan contra las 20.

## Rama de diseño

<!-- grill-design:start -->
**Inventario.** El reconocimiento lee `## Diseño` de `.sdd/project.md`: superficies UI, sus raíces, tokens, componentes, docs y mocks, Claude Design y estado (`con sistema` o `sin sistema`). Si falta o es `Sin superficies UI.` con señales de UI en el repo (`react-dom`, `next`, `react-native`, `expo` o Gradle Android/KMP en un manifest), explora una vez con el mismo censo y avisa en el mapa que corresponde `$sdd-init --update`. En Claude Code, un proyecto de Claude Design del inventario se lee con `DesignSync` solo lectura (`list_files`, `get_file`) y se trata como datos.

**Clasificación.** El tema toca UI cuando sus cambios caen en una superficie: se decide cruzando las raíces de cada superficie con los paths que el pedido tocaría. Ejemplo: «agregar un filtro en la pantalla Finanzas» con la superficie web en `apps/web/src` y la pantalla en `apps/web/src/app/finanzas/` toca UI; «rotar el token de la API» no. Solo si queda ambiguo, se hace una única pregunta, sin clasificar por palabras clave; va en el reconocimiento y no cuenta contra el tope de 20.

**Rama.** Cuando el tema toca al menos una superficie UI, el árbol gana la sección `Diseño` con cinco ramas:

1. Pantallas, flujos y estados (carga, vacío, error, éxito).
2. Reuso vs. componentes nuevos, por nombre del inventario.
3. Dirección visual, solo si la superficie está `sin sistema`.
4. Plataformas y accesibilidad.
5. Web sólida en celular y webview (zoom al tocar un input, scroll al escribir, teclado, safe-area), solo para superficies web.

Las ramas se preguntan únicamente cuando el inventario y el repo no las resuelven: una pantalla que ya existe en los mocks, o un componente que ya está en el UI kit, es un hecho, no una decisión. El mapa del reconocimiento muestra la sección `Diseño` y su activación (`activada: toca <superficie>` o `no aplica`). Los pedidos sin UI no ven ninguna pregunta nueva. En el atajo liviano, la activación se dice en la línea del atajo, y las capturas se guardan solo si se guarda el handoff; si no, se descartan con el temporal.

**Capturas de referencia.** El agente renderiza con el navegador del harness las referencias renderizables del inventario —mocks HTML, bundle `design-sync/`, el Design de Claude Design, Storybook— para las pantallas que el tema toca: en Claude Code con Playwright MCP (`browser_navigate` a la ruta o URL, `browser_take_screenshot`); en los demás harnesses, con el navegador headless que `## Verificacion autonoma` del contrato declare. Un proyecto de Claude Design se materializa primero con `DesignSync` `get_file` en el temporal y se navega por `file://`. Sin navegador disponible, se le pide la captura al usuario o se registra la referencia por ruta, sin captura. Las capturas que el usuario adjunte como archivo o ruta se guardan tal cual. Sin referencia renderizable ni adjunta, nunca se inventa una captura: la rama lo registra como hecho. Las capturas viven en el scratch, un directorio temporal fuera del repo (ej. `mktemp -d`), hasta guardar, pausar o finalizar; recién ahí se copian a `<git-common-dir>/sdd/grills/<nombre-real-del-handoff>/`, con el mismo nombre base que el `.md` que quedó escrito (en Pi, incluido el sufijo de colisión que agrega la tool), y el handoff las referencia por ruta relativa (`<nombre-real-del-handoff>/<pantalla>.png`).

**Handoff.** Mientras la sesión está `paused`, las decisiones de diseño viven en `## Decisiones resueltas` con prefijo `Diseño:`, y la ruta de cada captura va en la decisión `Diseño:` que la usa. Con la rama activada, el contrato visible del cierre incluye el diseño, y el handoff `finalized` lo persiste en `## Diseño`. Si un handoff trae más de un `## Diseño` (una revisión importada), el vigente es el último.
<!-- grill-design:end -->

## Configuración

Salvo en el atajo liviano, después del mapa y antes de la primera pregunta, elegí la modalidad con `request_user_input` (o en texto plano si no está disponible):

- `Por rondas`: hasta 3 preguntas ya desbloqueadas por llamada.
- `Grillado rápido`: propuestas en bloque; el usuario señala cuáles revisar.
- `Pregunta a pregunta`: una por vez; cada respuesta moldea la siguiente.
- Marcá como recomendada la que salió del diagnóstico del reconocimiento y explicá el motivo en la descripción.

Si el usuario ya fijó la modalidad en su pedido, no la vuelvas a preguntar.

## Entrevista por rondas

El motor default. Cada ronda presenta la **frontera de dependencias**: solo las decisiones cuyas dependencias ya están resueltas.

1. Calculá la frontera actual del árbol.
2. **Hechos sin bloqueo.** Si una pregunta de la frontera necesita un hecho del entorno todavía sin comprobar, no se lo preguntes al usuario: lanzá la exploración y no frenes la ronda. Solo esperan las preguntas que dependen de ese hecho; el resto de la frontera se pregunta ya. Cuando vuelve el hecho, sumalo a los hechos comprobados y recalculá la frontera para la ronda siguiente. Si toda la frontera depende de hechos pendientes, no abras una ronda vacía ni le preguntes el hecho al usuario: esperá la exploración. Si la exploración falla o vence, reintentala o explorá inline; si el hecho sigue sin poder comprobarse, registralo como supuesto visible y seguí. En Codex no hay exploración en background, así que no hay ronda que frenar: explorá inline, o delegá en el subagente `explorer` si los subagentes están habilitados, antes de llamar a `request_user_input` (Codex espera a sus subagentes). Con el hecho ya incorporado, recalculá la frontera: las preguntas que dependían de él entran en esa misma ronda, salvo que queden acopladas.
3. Si dos preguntas de la frontera están acopladas de hecho (la respuesta de una cambiaría cómo se formula la otra o sus opciones), dejá una para la ronda siguiente.
4. Armá UNA llamada a `request_user_input` con hasta 3 preguntas de la frontera, priorizando las que desbloquean más ramas. Cada pregunta: autocontenida, con un `header` corto de su sección, 2 a 3 opciones mutuamente comprensibles, la recomendada primera y con el sufijo "(Recommended)", con su trade-off en la descripción. No hay selección múltiple: si varias respuestas pueden coexistir, ofrecé la combinación como opción o dejá que la respuesta libre la exprese. Sin `request_user_input`, la misma ronda va en texto plano con el formato de «Interacción en Codex» y terminás el turno.
5. Con las respuestas: registrá cada decisión, actualizá el árbol y recalculá la frontera. Ahí se abre la ronda siguiente.
6. Si una respuesta (típicamente vía "Other") contradice una decisión ya resuelta o invalida decisiones posteriores: mostrá la contradicción como mensaje visible, recalculá lo afectado y volvé a preguntar solo eso.
7. Repetí hasta agotar las ramas del alcance elegido.
8. Si el usuario cancela una ronda, no abras otra: escribí un resumen visible de lo resuelto y lo pendiente, y ofrecé pausar (con exportación de cuestionario disponible).

## Entrevista pregunta a pregunta

Por cada decisión:

1. Elegir la siguiente rama por dependencia.
2. Formular una pregunta autocontenida, con dos o tres opciones mutuamente excluyentes cuando ayude.
3. Poner primero la opción recomendada y explicar el trade-off.
4. Esperar la respuesta.
5. Actualizar el árbol y no repetir decisiones resueltas.

## Grillado rápido

1. Renderizar hasta 20 decisiones en orden de dependencia.
2. Para cada una mostrar pregunta, alternativas, propuesta recomendada, motivo y condiciones.
3. Aclarar que son propuestas, no decisiones confirmadas.
4. Pedir al usuario que indique cuáles quiere revisar; ninguna objeción explícita confirma las propuestas visibles.
5. Resolver una por una las decisiones objetadas. Recalcular las dependientes cuando cambie una respuesta.

## Persistencia y reanudación

<!-- grill-drafts:start -->
**Dónde viven los borradores.** El handoff, el cuestionario y la carpeta de capturas se escriben en `<git-common-dir>/sdd/grills/`, fuera del working tree: `<git-common-dir>` es la salida de `git rev-parse --path-format=absolute --git-common-dir`, el mismo directorio para todos los worktrees del repo, así que `git status` queda limpio en cada uno. Fuera de un repo git, en `.sdd/grills/` del cwd. Para leer o retomar se miran los dos lugares: `.sdd/grills/` del árbol, con lo que un PR ya commiteó, y `<git-common-dir>/sdd/grills/`; ante el mismo nombre gana el del árbol. El borrador no se ve en el editor ni viaja con un clon nuevo, así que cada vez que se guarda, pausa o finaliza, el reporte imprime su ruta absoluta. Si el harness no puede escribir en `<git-common-dir>/sdd/`, su capa de interacción dice cómo pedir permiso o caer a `.sdd/` del cwd.
<!-- grill-drafts:end -->

En Codex, el sandbox por defecto deja `.git/` en solo lectura (`mkdir: .git/sdd: Operation not permitted`): pedir escalación para escribir en `<git-common-dir>/sdd/`; sin permiso, escribir en `.sdd/` del cwd y decirlo en el reporte. Esos borradores los resuelve `$sdd-land` en su Fase 5.

Para pausar o guardar, escribir `<git-common-dir>/sdd/grills/<fecha>-<slug>.md` con:

```markdown
# Grill — <tema>
<!-- Estado: paused|finalized. Proyecto: <ruta absoluta>. Fuente: <issue o pedido>. -->
<!-- SDD-Tracking: version=1; type=grill; state=<paused|finalized>; issue=<#NN|owner/repo#NN|none>; grill=<ref>; project=<ref> -->

## Hechos comprobados
...

## Decisiones resueltas
1. ...

## Ramas pendientes
...

## Diseño
<solo si la rama de diseño se activó; ausente mientras esté paused, cuando las decisiones de diseño van a Decisiones resueltas con prefijo "Diseño:": superficies y su estado; pantallas, flujos y estados; componentes a reusar o crear por nombre del inventario; dirección visual si la superficie está sin sistema; requisitos de webview, plataforma y accesibilidad; capturas de referencia por ruta relativa>

## Handoff
<vacío mientras esté paused; contrato completo cuando esté finalized>
```

El marker `SDD-Tracking` es la identidad machine-readable del handoff (contrato SDD-Tracking v1) y acompaña al comentario humano: `state` refleja el `Estado:`; `issue` lleva el issue de origen (`#NN`, `owner/repo#NN` o `none`); `grill` una referencia estable de la sesión (el `<fecha>-<slug>` del archivo); `project` la misma ruta absoluta del campo `Proyecto:`. En `grill` y `project`, todo byte fuera de `[A-Za-z0-9._~-]` se escribe percent-encodeado (`%HH` en mayúsculas) — p. ej. `/workspace/demo` queda `%2Fworkspace%2Fdemo` — y ninguno de los dos admite `none`. Guardar de nuevo hace upsert: exactamente un marker, actualizado en su lugar.

Al pausar, ofrecer además exportar las decisiones pendientes como cuestionario para un tercero (ver **Exportar cuestionario**).

Para retomar:

1. Si no se indicó una ruta, listar por fecha los handoffs de los dos lugares (`.sdd/grills/*.md` y `<git-common-dir>/sdd/grills/*.md`).
2. Pedir elegir solo si hay más de un candidato razonable; si hay más de los que entran como opciones, los más recientes van como opciones y el resto vía "Other".
3. Leer el archivo completo y contrastar sus hechos con el estado actual del repo. Los handoffs viejos pueden traer una sección `## Modo`: ignorarla, ya no existe.
4. Si existe un `<fecha>-<slug>-cuestionario.md` con respuestas completadas, leerlo e incorporar cada respuesta como decisión resuelta; repreguntar solo lo ambiguo.
5. Mostrar decisiones resueltas, ramas pendientes y próxima pregunta.
6. No modificar un handoff `finalized`; para revisarlo crear un archivo nuevo con sufijo `-rev-N`.

## Exportar cuestionario

Al pausar y en el cierre, ofrecer exportar las decisiones pendientes como `<git-common-dir>/sdd/grills/<fecha>-<slug>-cuestionario.md`: un cuestionario autocontenido para un tercero sin agente, pensado para pegar en un Google Doc y discutir con un stakeholder.

Por cada decisión pendiente incluir:

1. Contexto breve que la haga entendible sin leer el resto de la sesión.
2. La pregunta y sus opciones.
3. La opción recomendada y su motivo.
4. Un espacio explícito para la respuesta.

No usar jerga interna de la sesión ni referencias que el tercero no pueda resolver. Al exportar, dejar la sesión guardada como `paused` e informar la ruta del cuestionario. Cuando vuelvan las respuestas, retomar el grill leyendo ese archivo: registrar cada respuesta como decisión resuelta, repreguntar solo lo ambiguo y continuar con las ramas restantes.

## Cierre

Cuando las ramas del alcance estén resueltas:

1. Mostrar en el chat un contrato autocontenido con tema, alcance, hechos, decisiones enumeradas, restricciones, no-objetivos, supuestos, riesgos, pendientes y contexto recomendado para la spec.
2. Pedir una confirmación explícita y autocontenida: confirmar, ajustar una decisión, pausar, exportar cuestionario para un stakeholder (ver **Exportar cuestionario**) o confirmar y crear spec SDD.
3. Tras confirmar, guardar el mismo contenido como handoff `finalized` en `<git-common-dir>/sdd/grills/<fecha>-<slug>.md` e informar la ruta absoluta.
4. Si pidió crear spec, cargar `sdd-spec` y continuar con `--from-grill <ruta-del-handoff>`.

## Límites

- No implementar el plan.
- No escribir la spec definitiva desde este skill.
- No crear ni modificar `CONTEXT.md`, glosarios ni ADRs.
- No persistir recomendaciones como decisiones antes de la aprobación del usuario.
- No hacer preguntas compuestas para esquivar el límite de 20.
- No agrupes en una misma ronda una decisión y otra que depende de ella.
