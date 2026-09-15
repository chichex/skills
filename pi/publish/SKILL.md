---
name: publish
description: Publica una nueva versión de Waica en npm — el CLI (@waica/cli) y cinco librerías @waica que salen juntas con un único número. Actualiza las ocho versiones del repo, ejecuta la escalera de verificación, entrega el bump mediante PR, etiqueta el merge para publicar por npm Trusted Publishing y verifica los paquetes como usuario real. Usar SIEMPRE que el usuario quiera publicar, liberar o sacar una nueva versión de Waica, subir su versión, publicar el CLI o diga "publicá", "sacá una versión", "release the CLI" o "ship X.Y.Z".
compatibility: Requiere el repo chichex/waica, Git, Node, npm, pnpm, GitHub CLI (gh) autenticado, acceso de escritura al repo y la tool ask_user_question. La publicación usa npm Trusted Publishing configurado para .github/workflows/publish.yml.
---

# Publicar una nueva versión de Waica

## Argumentos

`/skill:publish [patch|minor|major|x.y.z]`

Si no se indicó versión, inspeccionar los cambios desde el último tag y usar `ask_user_question` para elegir `patch`, `minor`, `major` o una versión explícita. Marcar como recomendada la opción que corresponda al impacto semántico observado. No iniciar el bump ni ningún side effect de publicación hasta recibir esa respuesta.

Publica seis paquetes con un mismo número de versión: `@waica/cli` (`packages/cli`) y las cinco librerías que instalan los proyectos generados —`@waica/engine`, `@waica/behaviors`, `@waica/archetype-platformer`, `@waica/archetype-topdown`, `@waica/archetype-isometric`. El CLI incorpora el editor precompilado (`dist/editor`), el servidor MCP (`dist/mcp`) y copias vendorizadas de esas mismas librerías, por lo que un release entrega `waica`, `waica mcp` y los paquetes que resuelve `npm install` dentro de un proyecto generado por el editor.

**Se mueven en lockstep: un número, un tag, siempre los seis.** Un proyecto generado depende de `^<esa versión>` y las copias vendorizadas del CLI también la declaran; publicar un subconjunto deja en npm un CLI que contradice al registry. `packages/cli/src/package.test.ts` falla si las ocho versiones de paquetes del workspace divergen.

La publicación npm ocurre en CI: pushear un tag `vX.Y.Z` dispara `.github/workflows/publish.yml`, que publica mediante npm Trusted Publishing (OIDC), sin login de npm, prompt de 2FA ni token. El flujo completo pertenece al agente; ningún paso necesita la terminal humana salvo el bootstrap excepcional de §0.

Prerrequisito de una sola vez, relevante ante un 404 de publicación: **cada uno** de los seis paquetes públicos debe tener configurado en npmjs.com un Trusted Publisher de GitHub Actions con repo `chichex/waica` y workflow `publish.yml`. Se configura por paquete, no por scope; toda librería nueva que entre al release necesita el suyo.

## 0. Bootstrap de un paquete nunca publicado

Saltear esta sección salvo que un paquete del release todavía no tenga página en npm. El Trusted Publisher se configura en settings de un paquete y esa página no existe antes de la primera publicación. La primera versión de un paquete completamente nuevo debe publicarla el humano desde su terminal, con su 2FA. Es el único paso del flujo que no pertenece al agente.

Publicarlo en **la versión que ya está en `main`**, no en la versión que se está preparando. Quemar el número actual durante el bootstrap mantiene limpio el siguiente release: CI se niega a publicar sobre una versión existente, por lo que publicar a mano la versión objetivo abortaría el workflow antes de llegar al CLI.

Entregarle al humano un paquete por vez y en orden de dependencias: engine, behaviors, archetype-platformer, archetype-topdown, archetype-isometric y finalmente el CLI. Cada publicación abre su propia autorización en el navegador; un loop hace más difícil saber cuál falló:

```sh
cd packages/<name> && pnpm publish --access public --no-git-checks
```

Usar `pnpm publish`, no `npm publish`, porque pnpm reescribe `workspace:^` y aplica `publishConfig` sin modificar el checkout. No pasar `--otp`: esta cuenta autoriza escrituras mediante navegador y pnpm necesita una TTY real, por lo que no puede ejecutarse desde una tool call.

Verificar que cada paquete llegó (`npm view <pkg> version`) antes de seguir con el próximo. Saltear una librería a mitad de secuencia publica un dependiente que apunta a algo inexistente; ya ocurrió con `@waica/behaviors`, y `@waica/archetype-platformer` permaneció varios minutos en npm declarando una dependencia que no existía.

**Ese chequeo prueba que la versión llegó, no que el paquete funciona.** Un bootstrap fija sus siblings en la versión de `main`: los que ya estaban en npm antes de este ciclo. Si el paquete nuevo importa algo agregado a un sibling durante el mismo ciclo, el bootstrap queda roto al nacer: la dependencia resuelve, pero su contenido es anterior al importador. `@waica/archetype-isometric@0.7.0` se publicó así el 2026-08-22 y arrojaba `does not provide an export named 'ISO_PLAYER_ROLE'` al importarlo, porque el `@waica/behaviors@0.7.0` resuelto era anterior a `IsoMotor`. Verificar que la dependencia existe no alcanza; hay que comprobar que exporta lo que importa el paquete nuevo.

Es una condición estructural, no un error evitable: el sibling recién llega a npm en el siguiente release. Hacer el bootstrap de todos modos —crear la página del paquete es el objetivo y habilita configurar el Trusted Publisher— y luego ejecutar `npm deprecate <pkg>@<version>` apuntando al release que lo arreglará. Nunca hacer unpublish para ordenar: eso borra la página junto con el Trusted Publisher. La prueba de que el conjunto realmente funciona es el proyecto generado de §5, después del release.

Esto ya está resuelto para los seis paquetes públicos: los primeros cuatro desde 2026-08-05, `@waica/archetype-topdown` desde 2026-08-21 y `@waica/archetype-isometric` desde 2026-08-22. **No hay nada pendiente: saltear §0 por completo salvo que el release set incorpore un paquete sin página npm.** La organización `@waica` existe y controla el scope, por lo que ninguna otra cuenta puede publicar `@waica/*`; no hace falta reservar nombres.

## 1. Precondiciones

- Estar en `main`, con árbol limpio y sincronizado (`git fetch origin && git status`). Un release nunca debe incluir estado sin mergear o solo local. Si el checkout original contiene trabajo del usuario, preservarlo intacto y usar un worktree limpio basado en `origin/main`; no descartar ni incorporar esos cambios.
- Comparar la versión de `packages/cli/package.json` con la publicada (`npm view @waica/cli version`). Deben coincidir antes del bump. Si la versión local ya está adelantada, un release anterior quedó a mitad de camino —mergeado pero nunca etiquetado/publicado—: ir directamente a «Tag y seguimiento» y publicar **ESA** versión en lugar de volver a incrementarla.
- Confirmar que el repo es `chichex/waica`, que el tag objetivo y el branch `release-vX.Y.Z` no existen y que los seis paquetes públicos ya tienen página npm. Fallar cerrado ante cualquier discrepancia.

## 2. Elegir la versión

Argumento: `patch` | `minor` | `major` | una versión explícita `x.y.z`. Si se invocó sin argumento, preguntar cuál usar mediante `ask_user_question`. Actualizar siempre los seis paquetes públicos al mismo número, aunque alguno no haya cambiado; lockstep significa exactamente eso:

```sh
for dir in cli engine behaviors archetype-platformer archetype-topdown archetype-isometric editor mcp; do
  (cd "packages/$dir" && npm version X.Y.Z --no-git-tag-version)
done
```

Eso incluye `@waica/editor` y `@waica/mcp`, que son privados y nunca llegan directamente a npm. Viajan dentro del CLI y el servidor MCP informa la versión de su propio manifest durante el handshake; un número viejo ahí le diría al host que controla otro release. Un número para todo el repo, sin excepciones.

No hace falta editar nada más: el rango `@waica/*` del proyecto generado se lee desde `packages/engine/package.json` en build time; no está escrito en otro lugar.

Antes de seguir, comprobar que el diff contiene exactamente los ocho `package.json`, que todos declaran la versión objetivo y que `git diff --check` pasa.

## 3. Escalera y PR

El contrato (`.sdd/project.md`) exige la escalera local completa antes de cualquier PR y prohíbe pushear directamente a `main`:

1. Si un worktree limpio no tiene dependencias, ejecutar `pnpm install --frozen-lockfile`. Después correr `pnpm typecheck && pnpm test && pnpm test:dist`; todo debe quedar verde o el release se detiene. `test:dist` construye desde dists limpios y es el único rung que prueba que el CLI empaquetado todavía inicia `waica mcp` sobre stdio real con sus copias `@waica` vendorizadas; un simple `pnpm build` no lo demuestra.
2. Crear branch `release-vX.Y.Z`, commitear el bump, pushearlo y abrir un PR `release: vX.Y.Z`. El body debe enumerar las ocho versiones y la evidencia exacta de la escalera, y cerrar con `🤖 Generated with [Pi](https://github.com/badlogic/pi-mono)`.
3. Ejecutar `gh pr merge --merge --delete-branch`, actualizar la referencia de `origin/main` y verificar que el merge commit contiene las ocho versiones objetivo. No etiquetar el commit del branch.

## 4. Tag y seguimiento

Nunca ejecutar `pnpm release`: publica todos los paquetes públicos del monorepo sin aplicar este protocolo. Nunca etiquetar un branch sin mergear: el tag debe apuntar al merge commit de `main`.

```sh
git tag vX.Y.Z && git push origin vX.Y.Z
gh run watch --exit-status $(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Si `gh run list` no devuelve nada, el run puede no haberse creado todavía; reintentar después de unos segundos. No asumir que el run más reciente corresponde al release: seleccionar el que tenga `headBranch == "vX.Y.Z"`, comprobar que su `headSha` coincide con el merge commit y recién entonces observarlo hasta estado terminal.

El workflow repite la escalera, construye desde cero, comprueba que el tag coincide con la versión, reduce los manifests de las librerías con `scripts/prepare-publish.mjs` y publica las cinco librerías antes que el CLI. Ese orden evita que el CLI quede en npm apuntando a versiones todavía inexistentes.

Decodificador de errores:

| Síntoma | Significado |
| --- | --- |
| `E404 Not Found - PUT …` desde CI | NO significa paquete inexistente: la configuración de Trusted Publisher en npmjs.com no coincide con este repo/workflow. Revisar QUÉ paquete falló; cada uno de los seis se configura por separado. |
| `tag vX.Y.Z does not match packages/cli@…` | El tag apunta a un commit cuyo `package.json` tiene otra versión, normalmente por no actualizar `main` después del merge. Borrar el tag (`git push origin :refs/tags/vX.Y.Z`), sincronizar y volver a etiquetar. |
| `403 … too similar to existing packages` | Solo puede ocurrir con nombres de paquetes NUEVOS; por eso el CLI usa scope. Las publicaciones existentes no lo sufren. |
| `You cannot publish over the previously published versions` | Un run anterior publicó parte del conjunto. npm nunca acepta dos veces la misma versión, así que ese número es irrecuperable: incrementar el patch de los seis, repetir desde §2 y liberar el número nuevo. |

Si el workflow falla **antes de que alguna publicación tenga éxito**, borrar y volver a pushear el tag para dispararlo otra vez; nunca hacer rerun del job contra un commit obsoleto. Si falla **después** de que algún paquete salió, no reintentar el tag: incrementar el patch y publicar un release nuevo.

## 5. Verificar como usuario real

No declarar éxito solo porque GitHub Actions terminó verde. npm puede tardar varios minutos en procesar cada paquete aun después de responder `+ @waica/pkg@X.Y.Z`; esperar hasta que los seis expongan tanto la versión exacta como el dist-tag esperado.

- Comprobar los seis paquetes en el registry:

  ```sh
  for pkg in @waica/cli @waica/engine @waica/behaviors @waica/archetype-platformer @waica/archetype-topdown @waica/archetype-isometric; do
    echo "$pkg $(npm view "$pkg" version)"
  done
  ```

- Smoke del editor desde un directorio temporal, nunca desde el repo: ejecutar `npx -y @waica/cli@latest --no-open --port 5401 &` y luego `curl http://127.0.0.1:5401/__waica.json`. El JSON debe informar la versión nueva.
- Limpiar por puerto, no por PID de npx: `lsof -ti tcp:5401 | xargs kill`. Matar el wrapper de npx deja huérfano el servidor real; uno sobrevivió cuatro días de esa manera.
- Smoke de MCP desde el mismo directorio temporal. Este handshake no requiere el SDK de MCP y además demuestra que nada contamina stdout; cualquier banner extra rompe el parseo:

  ```sh
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    | npx -y @waica/cli@latest mcp 2>/dev/null | head -2
  ```

  Esperar dos respuestas JSON-RPC: `serverInfo` para id 1 y la lista completa de tools para id 2 (hoy son 15; `packages/mcp/README.md` es la autoridad). Un CLI publicado sin su servidor incorporado responde por stderr (`bundled MCP server is missing`) y no imprime nada ahí.

- **La prueba importante: un proyecto generado instala desde npm.** Ese es el objetivo de publicar las librerías y nada anterior lo demuestra: la escalera local siempre resuelve `@waica/*` desde el workspace. Hacerlo en un directorio temporal fuera del repo; un proyecto dentro del monorepo resolvería por workspace y podría pasar aunque npm estuviera roto:

  ```sh
  cd "$(mktemp -d)" && npx -y @waica/cli@latest mcp <<'EOF' >/dev/null
  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}
  {"jsonrpc":"2.0","method":"notifications/initialized"}
  {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_project","arguments":{"project_path":"REPLACE_WITH_ABSOLUTE_PATH/smoke-game"}}}
  EOF
  cd smoke-game && npm install && npm run build
  ```

  `npm install` debe resolver en la versión nueva las tres dependencias `@waica/*` del proyecto —engine, behaviors y su archetype—; `npm run build` prueba luego que los dists publicados realmente compilan un proyecto. Un 404 aquí significa que una librería no salió: consultar el decodificador de §4.

Limpiar todos los servidores por puerto y eliminar los directorios temporales. Si se usó un worktree de release, removerlo solo cuando esté limpio; conservar el tag y el merge commit publicados.

## 6. Reporte

Informar:

- versión anterior → nueva;
- URL del PR y merge commit;
- tag y URL del workflow;
- versiones observadas de los seis paquetes en npm;
- evidencia de typecheck, tests y `test:dist` local/CI;
- respuesta del editor publicado;
- versión y cantidad de tools del MCP publicado, incluida la ausencia de basura en stdout;
- versiones realmente instaladas y resultado de build del proyecto generado;
- cualquier warning no bloqueante y el estado final del checkout original.
