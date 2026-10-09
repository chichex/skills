---
name: sdd-land
description: Cierra el ciclo SDD después del PR. Mergea un stack de PRs (o un PR suelto) tras mostrar el plan y recibir la confirmación del humano, borra los branches remotos y locales ya mergeados, remueve los worktrees limpios y deja el checkout principal igual a origin/<default>. Usar SIEMPRE que el usuario quiera "cerrar el stack", "mergear el stack", "landear" un PR o un stack, "dejar el repo limpio y al día", hacer "repo clean", o limpiar branches y worktrees ya mergeados. Su invocación explícita es la autorización de merge, pero siempre muestra el plan y pide confirmación antes de mergear, y nunca saltea la protección de branches.
---

Cierra el ciclo SDD después del PR: mergea un stack de PRs (el que `$sdd-run` produce para una spec con Plan de entrega de 2 o más capas) o un PR suelto, con el plan mostrado y confirmado por el humano, y deja el repo limpio y al día: remotos y locales ya mergeados borrados, worktrees removidos y el checkout principal igual a `origin/<default>`. Es el único skill del repo que mergea, y solo porque se lo invoca de forma explícita. Reemplaza a `repo-clean`, que existía en Codex y Pi: absorbe su sincronización del checkout principal.

<!-- sdd-land-doctrine:start -->
Tres ideas fuerza:

1. **Invocar es autorizar, pero el plan se confirma.** Escribir `$sdd-land` es el pedido humano de mergear; aun así, nada se muta antes de mostrar el plan y recibir la confirmación. No existe un modo desatendido.
2. **GitHub es la fuente de verdad.** El stack, el estado de cada PR y el método de merge se leen de GitHub; el estado local de `gh stack` ayuda, no manda.
3. **Nunca se pierde trabajo ni se saltea una protección.** Sin bypass de branch protection, sin force, sin stash, sin `-D`. Borrar exige prueba, nunca ancestría: un PR `MERGED` o un blob idéntico en `origin/<default>`. Lo que está en uso —un worktree, un lock, un PR abierto— se bloquea. Lo que no se puede resolver con seguridad se reporta con la ruta y el comando exacto.

## Argumentos

```text
$sdd-land [<stack#> | <PR#> | <URL de PR> ...] [--method merge|squash|rebase] [--wait N] [--dry-run] [--clean-only]
```

- Cada target es un stack, un PR o la URL de un PR. Un PR sin stack es un stack de uno. Un `<PR#>` dentro de un stack significa «hasta ese PR inclusive» (lo que hace `gh stack merge <PR>`): aterrizan ese PR y los de abajo, y el plan lista exactamente qué PRs aterrizan. Varios targets se procesan en secuencia, cada uno con su propio gate: un fallo no bloquea a los demás targets independientes. Los PRs de fork (`isCrossRepository`) se rechazan con diagnóstico.
- `--method merge|squash|rebase` — método de merge. Sin el flag manda el default del repo (`viewerDefaultMergeMethod`), mostrado en el plan.
- `--wait N` — minutos de espera máxima por checks pendientes o por la cola de merge. Default 20.
- `--dry-run` — imprime el plan y termina sin mutar nada.
- `--clean-only` (sin targets) — salta el merge y va directo a checkout principal → limpieza local → barrido → reporte (Fases 5 a 8). Es incompatible con targets, `--method` y `--wait`; con `--dry-run` imprime qué limpiaría y termina.
- No existen `--yes` ni `--assume`: la confirmación del plan es siempre humana.

Los gates usan la tool de preguntas del harness (`request_user_input`). Donde la tool no cubre la forma del gate —más opciones de las que admite, selección múltiple— o no existe, formular el mismo gate en texto plano, terminar el turno y esperar la respuesta.

## Fase 0 — Lanzador (solo con `$sdd-land` pelado)

Pelado, lista los PRs abiertos del repo agrupados por stack (`gh pr list --state open --json number,title,headRefName,baseRefName,isDraft,isCrossRepository`, recorriendo `baseRefName`) y pregunta cuál con la tool de preguntas del harness (`request_user_input`; texto plano donde no hay): una opción por stack o PR suelto, el más reciente primero, con número, branch y título, más una última opción fija `Solo limpiar y sincronizar` (equivale a `--clean-only`). Antes de preguntar detecta los PRs `MERGED` cuyo branch local o worktree sigue vivo (`gh pr list --state merged --limit 200 --json number,headRefName` cruzado con `git for-each-ref refs/heads` y `git worktree list --porcelain`). Si hay, `Solo limpiar y sincronizar` va primera, marcada `(Recomendado)` y con el conteo: `Solo limpiar y sincronizar (Recomendado) — <N> branches mergeados siguen vivos`. Con args, salta directo a la Fase 1.

## Fase 1 — Preflight (bloqueante)

1. Raíz Git (`git rev-parse --show-toplevel`), `gh auth status`, repo resuelto (`gh repo view --json nameWithOwner,defaultBranchRef,viewerDefaultMergeMethod`) y branch default leído del remote: nunca asumir `main`. Un fallo frena con diagnóstico, sin mutar nada.
2. Leer `.sdd/project.md` si existe. Si su `## Limites` prohíbe mergear sin una excepción para `$sdd-land`, frena antes de tocar nada y lo dice: el contrato del repo manda por encima de este skill.
3. `gh stack` exigido solo si algún target es un stack. Si falta la extensión, frenar con el comando exacto (`gh extension install github/gh-stack`).
4. Resolver los targets desde GitHub. La pertenencia a un stack no se asume del estado local: un PR pertenece a un stack si su `baseRefName` no es el default o si existe algún PR abierto cuyo `baseRefName` es su `headRefName`; se recorre `baseRefName` hasta el branch default para armar la cadena hacia abajo, se suman los PRs apilados encima y se confirma con `gh stack view --json`. Una cadena de PRs no vinculada se ofrece vincular con `gh stack link` antes de seguir. Si `gh stack view --json` no devuelve el stack porque el checkout principal no tiene su estado local, el fallback es pedir el número de stack. Con `--clean-only` no hay targets: se omiten los puntos 3 y 4. Con varios targets, el preflight predice los conflictos cruzados entre sus branches con `git merge-tree --write-tree origin/<a> origin/<b>` por pares (solo lectura, sin tocar el working tree) y guarda qué pares chocan y en qué archivos, para mostrarlos en el plan.

## Fase 2 — Plan y confirmación

Antes de preguntar, evalúa el gate de la Fase 3 en cada PR: checks deduplicados, `mergeable`, `reviewDecision`, threads y draft. Se imprime, antes de cualquier mutación, una tabla por target con las columnas `orden | PR | branch | base | método | checks | threads sin resolver | draft | gate`, más los worktrees, branches locales y remotos que va a borrar. La columna `checks` da el `estado` del filtro de la Fase 3 y muestra los checks reemplazados por un run posterior como `N supersedidos`, sin bloquear; la columna `gate` dice `verde`, `pendiente` o `DETENIDO: <motivo>`. Un target con algún PR en rojo no pendiente aparece en la tabla como `DETENIDO`, con el motivo, y la pregunta no le ofrece `Mergear`. En un stack la tabla lista exactamente qué PRs aterrizan (hasta el `<PR#>` pedido inclusive) y marca como `quedan abiertos` los de arriba, cuyos branches no se borran. Con `--clean-only` no hay tabla ni pregunta de merge: se imprime el estado del checkout principal y lo que la limpieza borraría, y cada mutación pasa por los gates de las Fases 5 a 7. Después se pregunta: `Mergear (Recomendado)` / `Cancelar`; `Mergear` nombra los targets en verde o pendientes, que son los únicos que cubre. Si ningún target queda en verde ni pendiente, no hay pregunta: el run termina en `SDD-LAND DETENIDO`, con el motivo de cada target. `--dry-run` imprime el plan y termina. Sin confirmación no hay merge. La tabla va como texto visible en el mismo mensaje que la pregunta.

Si dos targets independientes chocan entre sí, el plan lo dice con los archivos en conflicto y ofrece, como pregunta aparte de `Mergear` / `Cancelar`, actualizar el branch del target siguiente cuando el anterior aterrice: `Actualizar el branch con <default> (Recomendado)` / `Dejarlo detenido`. Actualizar significa un `git merge origin/<default>` normal en el worktree de ese branch (nunca rebase, nunca force), resolver el conflicto mostrando el diff resultante, verificar con los comandos del contrato, pushear al branch del PR y repetir su gate de la Fase 3 con los checks frescos. Sin esa autorización, el target que quede `CONFLICTING` se detiene con diagnóstico, como cualquier otro gate rojo.

## Fase 3 — Gate de merge, merge y espera

Antes del primer gate, `git fetch --prune`, para que `origin/<default>` local esté fresco si hay que actualizar un branch; se repite después de cada merge del run. Entre targets, el gate se relee de GitHub, porque un merge cambia el `mergeable` de los demás.

Gate por PR: abierto, no draft, `mergeable` distinto de `CONFLICTING` (si es `UNKNOWN`, reconsultar), `reviewDecision` distinto de `CHANGES_REQUESTED`, `statusCheckRollup` deduplicado y después aprobado por lista de inclusión —cada `CheckRun` con `conclusion` `SUCCESS`, `NEUTRAL` o `SKIPPED` y cada `StatusContext` con `state` `SUCCESS`; un check pendiente espera hasta `--wait`; cualquier otro estado (`FAILURE`, `ERROR`, `TIMED_OUT`, `CANCELLED`, `ACTION_REQUIRED`, `STARTUP_FAILURE`, `STALE`) deja el target `DETENIDO`—, y cero review threads sin resolver (GraphQL `reviewThreads`, paginando hasta agotar). Con un check pendiente hace polling en primer plano cada 60 s hasta `--wait` (default 20 min), cancelable, sin `&` ni `nohup`. Rojo, `CHANGES_REQUESTED`, thread abierto o timeout dejan ese target `DETENIDO` con diagnóstico y sin merge parcial; los demás targets independientes siguen.

La concurrency de CI cancela un run y lo reemplaza por otro sobre el mismo SHA, así que un mismo check aparece varias veces en el rollup. Por eso el gate deduplica antes de aplicar la lista de inclusión. La identidad de un check es `workflowName` + `name` en un `CheckRun` y `context` en un `StatusContext`; de cada identidad cuenta solo el más reciente, por `startedAt` (fallback `completedAt`). Un check sin ninguno de los dos, o con `0001-01-01T00:00:00Z`, es el más reciente porque todavía no arrancó. Los anteriores quedan supersedidos: el plan los cuenta y no bloquean. El gate corre este filtro canónico con `gh pr view <n> --json statusCheckRollup --jq '<filtro>'`, y su salida es `{"estado": "verde"|"pendiente"|"detenido", "detenidos": [...], "supersedidos": N}`:

```jq
def tiempo: [.startedAt, .completedAt] | map(select(type == "string" and . != "" and (startswith("0001-") | not))) | first // "9999";
def identidad: if .__typename == "StatusContext" then .context else "\(.workflowName // "") / \(.name)" end;
def veredicto:
  if .__typename == "StatusContext" then
    (if .state == "SUCCESS" then "verde" elif .state == "PENDING" or .state == "EXPECTED" then "pendiente" else "detenido" end)
  elif .status != "COMPLETED" then "pendiente"
  elif .conclusion == "SUCCESS" or .conclusion == "NEUTRAL" or .conclusion == "SKIPPED" then "verde"
  else "detenido" end;
[.statusCheckRollup[] | {id: identidad, t: tiempo, v: veredicto, r: (.conclusion // .state)}]
| group_by(.id)
| {vigentes: map(sort_by(.t) | last), supersedidos: (map(length - 1) | add // 0)}
| {
    estado: (if any(.vigentes[]; .v == "detenido") then "detenido" elif any(.vigentes[]; .v == "pendiente") then "pendiente" else "verde" end),
    detenidos: [.vigentes[] | select(.v == "detenido") | "\(.id): \(.r)"],
    supersedidos
  }
```

`estado` `verde` aprueba los checks, `pendiente` espera hasta `--wait` y `detenido` deja el target `DETENIDO` con `detenidos` como motivo.

Ejecución, después de la confirmación y con el gate verde en todos los PRs del target:

- Stack → `gh stack merge <PR objetivo> --merge-method <m> --yes` (ese `--yes` solo saltea el prompt propio de gh-stack, después de la confirmación de la Fase 2). `<PR objetivo>` es el top del stack o el `<PR#>` pedido: aterrizan ese PR y todos los de abajo, nunca los de arriba. El merge de un stack es todo-o-nada hasta ese PR. Con aterrizaje parcial (quedan capas abiertas arriba) no se borra ningún branch del stack, ni remoto ni local, y el reporte lo deja pendiente con el comando para seguir.
- PR suelto → `gh pr merge <n> --<m>` sin `--delete-branch` ni `--admin`.
- El método es `--method` o el default del repo (`viewerDefaultMergeMethod`), tal como lo mostró el plan.
- Con merge queue el target queda `en cola` y se espera hasta `--wait`; un target que sigue en cola al vencer queda `DETENIDO`, sin borrar nada.
- El éxito se verifica releyendo `state == MERGED` de cada PR, nunca por exit code.

## Fase 4 — Remotos

Los remotos se borran solo cuando todos los PRs del target están `MERGED` y el aterrizaje no es parcial: con `gh api -X DELETE` sobre `repos/<owner>/<repo>/git/refs/heads/<branch>` se borra `refs/heads/<branch>` de cada uno (idempotente: si ya no existe, sigue). Después barre los demás remotos: solo branches remotos cuyo PR está `MERGED` (`gh pr list --state merged --json headRefName`) y que no tienen PR abierto, excluyendo el default y los branches protegidos, además de los de cualquier stack que aún tenga capas abiertas; nunca por mera ancestría. Los borra tras UNA confirmación que nombra cada branch. Nunca borra un branch con PR abierto o sin mergear. Con `--clean-only` esta fase se omite.

## Fase 5 — Checkout principal

Va antes de la limpieza local porque `git branch -d` compara contra el upstream o, sin upstream tras `git fetch --prune`, contra `HEAD`: con el checkout principal al día, lo mergeado se reconoce. Primero `git fetch --prune`. Solo si está parado en el default; en otro branch no se cambia (se reporta y se omite).

- **Limpio**: `git merge --ff-only origin/<default>`.
- **Sucio**: antes de preguntar, clasifica cada path de `git status --porcelain=v1 -z --untracked-files=all`:
  - **ya aterrizado**: un path sin trackear o modificado cuyo `git hash-object <path>` es igual a `git rev-parse origin/<default>:<path>`. Es un borrador que ya llegó a `origin/<default>` por otro PR: se resuelve sin preguntar antes del fast-forward (`rm -- <path>` si no está trackeado, `git restore --source=HEAD --staged --worktree -- <path>` si está modificado; el fast-forward lo vuelve a escribir igual) y va al reporte como `ya aterrizados`.
  - **en otro branch**: el mismo blob, en el mismo path, existe en otro branch local o worktree; se conserva, se reporta y nunca entra en `Descartar`. Se detecta con `git rev-parse <branch>:<path>` por cada branch local y con `git hash-object` del path en cada worktree de `git worktree list --porcelain`.
  - **sin dueño**: el resto; sigue la pregunta.

  Si no queda ningún path sin dueño, no hay pregunta: se resuelven los ya aterrizados y se hace el fast-forward. Si quedan, mostrar `git status --short --branch --untracked-files=all`, `git diff --stat`, la clasificación y la lista exacta de paths sin dueño que `Descartar` tocaría, y preguntar: `Conservar en wip/<fecha>-<slug>, sin push (Recomendado)` / `Descartar` / `Tratar por path` / `Dejar como está`. Las cuatro opciones actúan solo sobre los paths sin dueño.
  - **Conservar**: `git switch -c wip/<YYYY-MM-DD>-<slug>` (el slug sale del primer path modificado), commits por paths revisados (sin secrets, sin `--no-verify`), volver al default y fast-forward.
  - **Descartar**: `Descartar` actúa solo sobre los paths sin dueño mostrados en la preview: `git restore --source=HEAD --staged --worktree -- <paths trackeados>` y `rm -- <paths sin trackear>`, sin `git reset --hard` ni `git clean`.
  - **Tratar por path**: una pregunta por path (`conservar / descartar / ignorar`). `descartar` usa el mismo `git restore` o `rm` que `Descartar`. `ignorar` solo se ofrece para paths untracked —un path trackeado y modificado solo puede conservarse o descartarse— y escribe el patrón en `.git/info/exclude` (local, sin commit); solo se crea el branch `wip/` si algún path eligió `conservar`.
  - **Dejar como está**: no se toca nada y el estado queda en el reporte.
  - Se hace el fast-forward a `origin/<default>` después de `Conservar`, `Descartar` y `Tratar por path`; `Dejar como está` es el único que no lo hace. Si el fast-forward choca con un path conservado, no se fuerza: se reporta con el path y el comando.
- Con commits locales adelante del remote o en otro branch: se reporta, sin switch. Nunca stash.

## Fase 6 — Limpieza local automática

Solo para lo que el run mergeó, con el `git fetch --prune` de la Fase 5 ya hecho: por cada branch mergeado del target, `git worktree remove` solo si ese worktree está limpio y sin lock (si no, reporta la ruta), después `git branch -d` (nunca `-D`); si se niega, por ejemplo tras un squash, reportar el branch y el comando para que decida el humano; al final, `gh stack unstack --local` del stack cerrado y `git worktree prune`. Si el checkout principal está parado en uno de esos branches no cambia de branch: lo reporta con el comando. Si el checkout principal no pudo sincronizarse (sucio y `Dejar como está`, otro branch, commits adelante), `git branch -d` puede negarse porque compara contra `HEAD`: se reporta con el comando, sin `-D`. Con aterrizaje parcial no borra ningún branch ni worktree del stack y no hace `unstack`. Con `--clean-only` el run no mergeó nada y no hay qué limpiar acá: la limpieza es el barrido.

Las Fases 6 y 7 nunca remueven un worktree bloqueado (línea `locked` en `git worktree list --porcelain`). La única excepción es de esta fase: si el lock dice `sdd-run <slug>` o `quick-run <slug>` y su branch es del target recién mergeado, `git worktree unlock` y después `git worktree remove`, solo si el worktree está limpio. Cualquier otro lock se reporta con su motivo y con el comando `git worktree unlock <ruta> && git worktree remove <ruta>`.

## Fase 7 — Barrido del ruido previo

Borrar exige prueba, nunca ancestría. Lista los branches locales en dos grupos:

- **mergeados con PR**: su PR por `headRefName` está `MERGED`, no hay ningún PR abierto con ese head y el tip local es el `headRefOid` de ese PR o un ancestro. Se comprueba con `gh pr list --head <branch> --state all --json number,state,headRefOid` y `git merge-base --is-ancestor <tip> <headRefOid>`; si el objeto no está local, antes `git fetch origin refs/pull/<n>/head`. Van preseleccionados.
- **sin PR, contenidos en `origin/<default>`**: nunca tuvieron PR, no tienen worktree y no tienen lock, y su tip es ancestro de `origin/<default>`. Van sin preselección.

Nunca se ofrecen el default, el branch actual, un branch con worktree (salvo que esté en el grupo «mergeados con PR» y su worktree esté limpio y sin lock) ni los branches de un stack con capas abiertas. Los worktrees de los branches «mergeados con PR» que están limpios y sin lock se ofrecen junto con su branch: primero `git worktree remove`, después `git branch -d`. Además ofrece los worktrees detached limpios y sin lock en un grupo propio, con su SHA y diciendo si algún branch lo alcanza (`git branch --contains <sha>`), sin preselección.

La pregunta es `Borrar los mergeados (Recomendado)` / `Elegir cuáles` (selección múltiple, incluye el grupo sin PR) / `No borrar`. `Borrar los mergeados` borra solo el grupo «mergeados con PR» con sus worktrees; `Elegir cuáles` muestra todos los grupos, incluidos los detached. Worktrees sucios y branches sin mergear solo se reportan con ruta y comando exacto.

## Fase 8 — Reporte

`SDD-LAND TERMINADO` solo con todos los targets mergeados y verificados, remotos y locales resueltos y el checkout principal con `HEAD == origin/<default>` y status limpio (o el estado que el usuario eligió dejar). Con `--clean-only` no hay targets y alcanza con la limpieza resuelta; un aterrizaje parcial es `TERMINADO` para el PR pedido y deja el resto en `pendiente`. Cada target lleva su sha de merge: un merge atómico de stack se lista como `stack #<n> → <sha> (#a, #b, …)`, con los PRs que aterrizaron, y un PR suelto como `#<n> → <sha>`:

```text
SDD-LAND TERMINADO
- repo: <owner/repo> · default <branch> · método <m>
- targets: <N> mergeados y verificados (con `--clean-only`: targets: ninguno (--clean-only))
  - stack #<n> → <sha> (#a, #b, …)
  - #<n> → <sha>
- remotos borrados: <branches | ninguno>
- ya aterrizados: <paths | ninguno>
- worktrees removidos: <rutas | ninguno>
- worktrees bloqueados: <ruta (motivo del lock) · git worktree unlock <ruta> && git worktree remove <ruta> | ninguno>
- branches borrados: <locales | ninguno>
- ruido podado: <branches y worktrees del barrido | ninguno | omitido>
- checkout principal: <default> @ <sha corto> · HEAD == origin/<default> · status limpio | <estado elegido>
- pendiente: <capas abiertas encima del PR elegido y branches conservados, con el comando para seguir | ninguno>
```

En cualquier otro caso, `SDD-LAND DETENIDO`, con lo hecho, lo pendiente y el comando para reanudar:

```text
SDD-LAND DETENIDO
- motivo: <fallo, gate rojo, cancelación o límite del contrato>
- hecho: <merges, remotos, worktrees y branches ya resueltos>
- pendiente: <targets o pasos sin completar, con ruta y comando exacto>
- reanudar: <comando exacto, por ejemplo $sdd-land <PR>>
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
- No reset, stash ni clean del checkout principal: `Descartar` usa `git restore` y `rm` solo sobre los paths sin dueño de la preview.
- No remover un worktree bloqueado, salvo el lock `sdd-run`/`quick-run` del target recién mergeado en la Fase 6.
- No borrar branches con PR abierto o sin mergear.
- No cambiar settings del repo (`deleteBranchOnMerge`, protecciones).
- No polling en background.
- No mergear sin la confirmación de la Fase 2.
- No actualizar el branch de un PR sin la pregunta del plan, ni con rebase.
<!-- sdd-land-doctrine:end -->

En Codex, usar `request_user_input` solo cuando esté disponible y el gate tenga 2-3 opciones mutuamente excluyentes. Los gates con más de tres opciones (`Conservar`, `Descartar`, `Tratar por path` y `Dejar como está`) o con selección múltiple (`Elegir cuáles`) se formulan en texto plano: terminar el turno y continuar tras la respuesta. `Tratar por path` hace una pregunta por path, de tres opciones mutuamente excluyentes, y cabe en `request_user_input`. El gate que protege el merge nunca se resuelve en el mismo turno en que se mostró el plan por primera vez.
