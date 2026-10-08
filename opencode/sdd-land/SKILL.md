---
name: sdd-land
description: Cierra el ciclo SDD después del PR. Mergea un stack de PRs (o un PR suelto) tras mostrar el plan y recibir la confirmación del humano, borra los branches remotos y locales ya mergeados, remueve los worktrees limpios y deja el checkout principal igual a origin/<default>. Usar SIEMPRE que el usuario quiera "cerrar el stack", "mergear el stack", "landear" un PR o un stack, "dejar el repo limpio y al día", hacer "repo clean", o limpiar branches y worktrees ya mergeados. Su invocación explícita es la autorización de merge, pero siempre muestra el plan y pide confirmación antes de mergear, y nunca saltea la protección de branches.
---

Cierra el ciclo SDD después del PR: mergea un stack de PRs (el que `/sdd-run` produce para una spec con Plan de entrega de 2 o más capas) o un PR suelto, con el plan mostrado y confirmado por el humano, y deja el repo limpio y al día: remotos y locales ya mergeados borrados, worktrees removidos y el checkout principal igual a `origin/<default>`. Es el único skill del repo que mergea, y solo porque se lo invoca de forma explícita. Reemplaza a `repo-clean`: absorbe su sincronización del checkout principal.

<!-- sdd-land-doctrine:start -->
Tres ideas fuerza:

1. **Invocar es autorizar, pero el plan se confirma.** Escribir `/sdd-land` es el pedido humano de mergear; aun así, nada se muta antes de mostrar el plan y recibir la confirmación. No existe un modo desatendido.
2. **GitHub es la fuente de verdad.** El stack, el estado de cada PR y el método de merge se leen de GitHub; el estado local de `gh stack` ayuda, no manda.
3. **Nunca se pierde trabajo ni se saltea una protección.** Sin bypass de branch protection, sin force, sin stash, sin `-D`. Lo que no se puede resolver con seguridad se reporta con la ruta y el comando exacto.

## Argumentos

```text
/sdd-land [<stack#> | <PR#> | <URL de PR> ...] [--method merge|squash|rebase] [--wait N] [--dry-run]
```

- Cada target es un stack, un PR o la URL de un PR. Un PR sin stack es un stack de uno. Varios targets se procesan en secuencia, cada uno con su propio gate: un fallo no bloquea a los demás targets independientes. Los PRs de fork (`isCrossRepository`) se rechazan con diagnóstico.
- `--method merge|squash|rebase` — método de merge. Sin el flag manda el default del repo (`viewerDefaultMergeMethod`), mostrado en el plan.
- `--wait N` — minutos de espera máxima por checks pendientes o por la cola de merge. Default 20.
- `--dry-run` — imprime el plan y termina sin mutar nada.
- No existen `--yes` ni `--assume`: la confirmación del plan es siempre humana.

Los gates usan la tool de preguntas del harness (`question`). Donde la tool no cubre la forma del gate —más opciones de las que admite, selección múltiple— o no existe, formular el mismo gate en texto plano, terminar el turno y esperar la respuesta.

## Fase 0 — Lanzador (solo con `/sdd-land` pelado)

Pelado, lista los PRs abiertos del repo agrupados por stack (`gh pr list --state open --json number,title,headRefName,baseRefName,isDraft,isCrossRepository`, recorriendo `baseRefName`) y pregunta cuál con la tool de preguntas del harness (`question`; texto plano donde no hay): una opción por stack o PR suelto, el más reciente primero, con número, branch y título. Con args, salta directo a la Fase 1.

## Fase 1 — Preflight (bloqueante)

1. Raíz Git (`git rev-parse --show-toplevel`), `gh auth status`, repo resuelto (`gh repo view --json nameWithOwner,defaultBranchRef,viewerDefaultMergeMethod`) y branch default leído del remote: nunca asumir `main`. Un fallo frena con diagnóstico, sin mutar nada.
2. Leer `.sdd/project.md` si existe. Si su `## Limites` prohíbe mergear sin una excepción para `/sdd-land`, frena antes de tocar nada y lo dice: el contrato del repo manda por encima de este skill.
3. `gh stack` exigido solo si algún target es un stack. Si falta la extensión, frenar con el comando exacto (`gh extension install github/gh-stack`).
4. Resolver los targets desde GitHub. La pertenencia a un stack no se asume del estado local: se recorre `baseRefName` hasta el branch default para armar la cadena de PRs y se consulta `gh stack view --json`. Una cadena de PRs no vinculada se ofrece vincular con `gh stack link` antes de seguir. Si `gh stack view --json` no devuelve el stack porque el checkout principal no tiene su estado local, el fallback es pedir el número de stack.

## Fase 2 — Plan y confirmación

Se imprime, antes de cualquier mutación, una tabla por target con las columnas `orden | PR | branch | base | método | checks | threads sin resolver | draft`, más los worktrees, branches locales y remotos que va a borrar. Después se pregunta: `Mergear (Recomendado)` / `Cancelar`. `--dry-run` imprime el plan y termina. Sin confirmación no hay merge. La tabla va como texto visible en el mismo mensaje que la pregunta.

## Fase 3 — Gate de merge, merge y espera

Gate por PR: abierto, no draft, `mergeable` distinto de `CONFLICTING` (si es `UNKNOWN`, reconsultar), `reviewDecision` distinto de `CHANGES_REQUESTED`, `statusCheckRollup` sin `FAILURE`/`ERROR` ni checks pendientes, y cero review threads sin resolver (GraphQL `reviewThreads`, paginando hasta agotar). Con checks pendientes hace polling en primer plano cada 60 s hasta `--wait` (default 20 min), cancelable, sin `&` ni `nohup`. Rojo, `CHANGES_REQUESTED`, thread abierto o timeout dejan ese target `DETENIDO` con diagnóstico y sin merge parcial; los demás targets independientes siguen.

Ejecución, después de la confirmación y con el gate verde en todos los PRs del target:

- Stack → `gh stack merge <PR top> --merge-method <m> --yes` (ese `--yes` solo saltea el prompt propio de gh-stack, después de la confirmación de la Fase 2). El merge de un stack es todo-o-nada hasta el PR elegido.
- PR suelto → `gh pr merge <n> --<m>` sin `--delete-branch` ni `--admin`.
- El método es `--method` o el default del repo (`viewerDefaultMergeMethod`), tal como lo mostró el plan.
- Con merge queue el target queda `en cola` y se espera hasta `--wait`; un target que sigue en cola al vencer queda `DETENIDO`, sin borrar nada.
- El éxito se verifica releyendo `state == MERGED` de cada PR, nunca por exit code.

## Fase 4 — Remotos

Los remotos se borran solo cuando todos los PRs del target están `MERGED`: con `gh api -X DELETE` sobre `repos/<owner>/<repo>/git/refs/heads/<branch>` se borra `refs/heads/<branch>` de cada uno (idempotente: si ya no existe, sigue). Después lista los demás remotos ya mergeados en el default y sin PR abierto, y los borra tras UNA confirmación que nombra cada branch. Nunca borra un branch con PR abierto o sin mergear.

## Fase 5 — Limpieza local automática

Solo para lo que el run mergeó: `git fetch --prune`; por cada branch mergeado del target, `git worktree remove` solo si ese worktree está limpio (si no, reporta la ruta), después `git branch -d` (nunca `-D`); si se niega, por ejemplo tras un squash, reportar el branch y el comando para que decida el humano; al final, `gh stack unstack --local` del stack cerrado y `git worktree prune`. Si el checkout principal está parado en uno de esos branches no cambia de branch: lo reporta con el comando.

## Fase 6 — Barrido del ruido previo

Lista los branches locales ya mergeados en `origin/<default>` (excluyendo el default y el actual) y los worktrees cuyo branch está mergeado o ya no existe, y pregunta: `Borrar todo lo listado` / `Elegir cuáles` (selección múltiple) / `No borrar`. Worktrees sucios y branches sin mergear solo se reportan con ruta y comando exacto.

## Fase 7 — Checkout principal

Solo si está parado en el default; en otro branch no se cambia (se reporta y se omite).

- **Limpio**: `git merge --ff-only origin/<default>`.
- **Sucio**: mostrar `git status --short --branch --untracked-files=all`, `git diff --stat`, los untracked y la preview de `git clean -nd`, y preguntar: `Conservar en wip/<fecha>-<slug>, sin push (Recomendado)` / `Descartar` / `Tratar por path` / `Dejar como está`.
  - **Conservar**: `git switch -c wip/<YYYY-MM-DD>-<slug>` (el slug sale del primer path modificado), commits por paths revisados (sin secrets, sin `--no-verify`), volver al default y fast-forward.
  - **Descartar**: `git reset --hard HEAD` más `git clean -fd`, coincidiendo con la preview que se mostró (nunca `-x`).
  - **Tratar por path**: selección múltiple por path (`conservar / descartar / ignorar`); `ignorar` agrega el patrón a `.gitignore` y lo commitea, como commit aparte, en el mismo branch `wip/`.
  - **Dejar como está**: no se toca nada y el estado queda en el reporte.
- Con commits locales adelante del remote o en otro branch: se reporta, sin switch. Nunca stash.

## Fase 8 — Reporte

`SDD-LAND TERMINADO` solo con todos los targets mergeados y verificados, remotos y locales resueltos y el checkout principal con `HEAD == origin/<default>` y status limpio (o el estado que el usuario eligió dejar):

```text
SDD-LAND TERMINADO
- repo: <owner/repo> · default <branch> · método <m>
- targets: <N> mergeados y verificados
  - <stack|PR>: <#PR → sha de merge, uno por PR>
- remotos borrados: <branches | ninguno>
- worktrees removidos: <rutas | ninguno>
- branches borrados: <locales | ninguno>
- ruido podado: <branches y worktrees del barrido | ninguno | omitido>
- checkout principal: <default> @ <sha corto> · HEAD == origin/<default> · status limpio | <estado elegido>
```

En cualquier otro caso, `SDD-LAND DETENIDO`, con lo hecho, lo pendiente y el comando para reanudar:

```text
SDD-LAND DETENIDO
- motivo: <fallo, gate rojo, cancelación o límite del contrato>
- hecho: <merges, remotos, worktrees y branches ya resueltos>
- pendiente: <targets o pasos sin completar, con ruta y comando exacto>
- reanudar: <comando exacto, por ejemplo /sdd-land <PR>>
```

## MUST DO

- Mostrar el plan completo y recibir la confirmación antes de cualquier mutación; `--dry-run` no muta nada.
- Leer el branch default del remote y el estado de cada PR de GitHub; verificar el merge releyendo `state == MERGED`.
- Respetar los `## Limites` del contrato por encima de cualquier instrucción de este skill.
- Borrar remotos solo con todo el target `MERGED`, y locales solo lo mergeado y limpio.
- Reportar con ruta y comando exacto todo lo que no se pudo resolver con seguridad.

## MUST NOT DO

- No bypass de protección ni `--admin`.
- No `git push --force*`.
- No push al default.
- No reset, stash ni clean del checkout principal fuera del flujo de la Fase 7.
- No borrar branches con PR abierto o sin mergear.
- No cambiar settings del repo (`deleteBranchOnMerge`, protecciones).
- No polling en background.
- No mergear sin la confirmación de la Fase 2.
<!-- sdd-land-doctrine:end -->

En opencode, usar `question` (disponible en los clientes app, cli y desktop) con `multiple` para `Elegir cuáles` y la selección por path. Sin la tool, formular el gate en texto plano con opciones numeradas, la recomendada primera marcada `(Recomendado)`, terminar el turno y esperar la respuesta.
