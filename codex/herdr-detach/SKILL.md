---
name: herdr-detach
description: Despacha un pedido a otro agente corriendo en otro pane o workspace de Herdr, en vez de resolverlo en esta sesión. Compila un briefing autosuficiente desde el contexto de la conversación, lo confirma con el usuario, arranca el agente destino y devuelve el handle sin bloquear. Usar cuando el usuario diga "$herdr-detach", "detachá esto", "mandá esto a otro pane", "que lo haga otro agente", "abrilo en otro workspace", "delegá esto a Herdr", o cuando quiera seguir trabajando acá mientras algo largo corre en paralelo dentro de Herdr. Requiere HERDR_ENV=1. No usar para delegación genérica fuera de Herdr — para eso están los subagentes.
---

# Herdr Detach

Despachá el pedido a un agente que corre en otro pane de Herdr y volvé enseguida. La sesión actual queda libre.

Escribir un buen encargo ya lo sabés hacer. Lo que se rompe en un detach es otra cosa: **el trabajo sale de tu control y corre desatendido**. Nadie va a estar mirando ese pane cuando pise un archivo, pida un permiso o se pase de alcance. Las cuatro decisiones de abajo existen por eso, y ninguna se resuelve con buena voluntad en el briefing.

## Precondiciones

```bash
test "${HERDR_ENV:-}" = 1
```

Si falla, decilo y pará: fuera de Herdr los comandos apuntan al pane que el usuario tenga enfocado, que puede ser cualquiera. El contexto de tu pane está en `$HERDR_WORKSPACE_ID`, `$HERDR_TAB_ID`, `$HERDR_PANE_ID` — targeteá siempre explícito con eso, porque los comandos sin target resuelven al pane enfocado de *otro* cliente.

## Las cuatro decisiones que no se delegan

**1. Si escribe código, va a un worktree aislado.** Dos agentes sobre el mismo working tree se pisan: uno guarda mientras el otro lee, un `git add -A` ajeno se lleva puesto el trabajo sin commitear del usuario, y los diffs se mezclan sin forma de saber quién rompió qué. Usá `herdr worktree create`.

Detectar el riesgo y escribirlo en el briefing **no** es mitigarlo. "Hay WIP sin trackear, no lo toques" es una instrucción que el agente destino puede desobedecer por accidente veinte minutos después, cuando ya nadie mira. El worktree lo hace imposible. Y el aislamiento no es una preferencia que haya que consultar: es el default cuando el encargo escribe archivos versionados. Para trabajo de solo lectura —revisar, investigar, explicar, correr tests— es peso muerto y va a un pane hermano con el mismo `cwd`.

**2. No uses `--wait`.** Existe y es tentador, y convierte el detach en una llamada bloqueante: el usuario pidió despegar el trabajo y termina esperando diez minutos igual. Despachás y volvés. Lo mismo con quedarte chequeando el estado "una última vez".

**3. El detach no amplía permisos.** Un agente desatendido con autoridad que nadie le dio es la peor combinación. Frená en commit local: nada de pushear, abrir PR, mergear ni tocar `main` salvo que el usuario lo haya dicho. Si el trabajo va a necesitar aprobaciones interactivas, decilo en la confirmación en vez de pasarle flags para saltearlas — es la máquina del usuario.

**4. El briefing viaja como archivo, no como argumento.** Escribilo en `~/.herdr-detach/<nombre>/briefing.md` y mandá un prompt fino: `"Leé <ruta> y ejecutá lo que dice."` Un texto largo como argumento de shell es un infierno de quoting, el usuario no lo puede editar antes de que salga, y el destino no lo puede releer cuando compacte contexto y se olvide para qué fue creado. Fuera del repo a propósito: dentro ensucia el diff del usuario y termina en un commit.

## El briefing

El agente destino arranca con contexto cero: no vio esta conversación, no sabe qué es "el plan", no conoce el repo. **Si el briefing menciona algo que solo existe acá, pegalo — no lo nombres.** "El punto 1 del plan" no es contexto; el texto del punto 1 sí.

Más allá del encargo y el contexto que haga falta pegar, dos cosas que se olvidan y cuestan caro: **cómo sabe que terminó** (sin eso da vueltas o corta antes — si hay tests, el comando exacto) y **qué no tocar**. Si el repo destino tiene `.sdd/project.md` o `AGENTS.md`, no los transcribas: nombrá la ruta y que los lea.

Leé el repo antes de escribir. Lo que hace útil a un briefing no es la prolijidad sino las minas que encontraste y el destino no va a ver venir.

No le pidas que escriba su respuesta en un archivo: Herdr lee el pane, y pedir eso de entrada distorsiona cómo trabaja. Es el fallback para cuando leer el pane falle.

## Antes de despachar

Un detach cuesta un pane, un agente y tu tiempo de redacción. No se paga si el pedido se resuelve más rápido de lo que tardás en explicarlo, si necesita ida y vuelta constante —el agente va a quedar `blocked` preguntando y nadie lo va a estar mirando— o si el contexto no se puede escribir. Si te encontrás poniendo "seguí con lo que veníamos viendo", el detach no es viable: decilo en vez de despachar algo condenado.

Mostrale al usuario el briefing **completo y verbatim** —no un resumen ni un link—, el destino con su razón en media línea, y el nombre y kind del agente. Ofrecé con `request_user_input` despachar, editar, cambiar destino o cancelar. Usá esa tool solo cuando esté disponible; si no lo está, poné el mismo gate en texto plano con las opciones numeradas, terminá el turno y esperá la respuesta. Es el único momento barato para corregir el rumbo; después son veinte minutos de trabajo en la dirección equivocada.

El nombre sale del pedido, no de un contador: `review-pr-22`, `migrar-auth`. Tiene que matchear `[a-z][a-z0-9_-]{0,31}` y ser único entre los agentes vivos; si un detach muerto ya dejó ese directorio, sufijá (`-2`) para no pisarle el briefing. El kind por defecto es el mismo agente que estás usando vos —un detach desde Codex arranca otro `codex`—; respetá el que pida el usuario y mirá `herdr agent` para los soportados.

## Despachar

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
herdr agent start <nombre> --kind codex --pane <pane-id>
herdr agent prompt <nombre> "Leé ~/.herdr-detach/<nombre>/briefing.md y ejecutá lo que dice."
```

`--no-focus` porque el usuario está trabajando acá. `--cwd` explícito porque sin eso el pane puede no heredar el directorio que asumiste. La dirección sale de `herdr pane layout --pane "$HERDR_PANE_ID"`: pane ancho → `right`, angosto o alto → `down`. Para el camino aislado, `herdr worktree create` con `--no-focus` y el pane sale de la respuesta.

Leé los IDs del JSON de respuesta (`.result.pane.pane_id`), no los predigas. Antes de despachar algo que escribe, mirá `herdr agent list`: si ya hay un detach vivo sobre el mismo `cwd`, avisalo.

Después, escribí `~/.herdr-detach/<nombre>/handle.json` con el pedido original, nombre, `pane_id`, `workspace_id`, `cwd` y kind — es lo que hace posible el modo pelado. Cerrá con tres líneas: qué agente quedó, dónde, y que `$herdr-detach` pelado muestra el estado.

## `$herdr-detach` pelado

Sin argumentos no despacha: lista los registros de `~/.herdr-detach/*/` cruzados contra `herdr agent list` —el registro dice qué se pidió, `agent list` dice si sigue vivo y en qué estado— y ofrece leer un resultado, traerlo al foco, mandarle una corrección o cerrarlo. Un registro sin agente vivo es un detach terminado; no lo borres por tu cuenta, el briefing puede ser lo único que quede de lo que se pidió.

## Consultar y cerrar

```bash
herdr agent get <nombre>
herdr agent read <nombre> --source recent-unwrapped --lines 120
```

`blocked` significa que Herdr reconoció una aprobación o pregunta esperando. `idle` y `done` son el mismo estado —listo para input—, `done` es el nombre que toma cuando el trabajo terminó sin que nadie mirara ese tab. `unknown` no prueba nada.

Si subir `--lines` no revela más, el agente corre en pantalla alternativa y esas filas no entran al scrollback: no hay lectura que las recupere. **Recién ahí** pedile que escriba su respuesta en Markdown en un temporal y responda solo con la ruta.

`herdr agent focus <nombre>` mueve el foco del usuario: solo si lo pidió. Cerrá panes o workspaces únicamente si te lo piden; los que creó un detach son candidatos legítimos, los demás no se tocan.

## La sintaxis la manda el binario

Herdr cambia y este archivo no se entera. Cuando algo no coincida, la autoridad es el binario: `herdr agent`, `herdr pane`, `herdr worktree`, `herdr workspace` imprimen la sintaxis exacta de cada subcomando; `herdr pane split -h` da el detalle (usá `-h`, no `--help`, que en el tercer nivel cae al help global); `herdr --skill` trae la doctrina oficial de Herdr. No corras `herdr` pelado para explorar —lanza la TUI— ni sondees comandos mutantes omitiendo argumentos. Exit 1 es error del server con JSON en stderr; exit 2 es sintaxis, y ahí consultá el grupo antes de reintentar a ciegas.
