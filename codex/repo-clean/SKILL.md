---
name: repo-clean
description: Deja el repositorio Git local sin cambios pendientes y sincronizado con origin en el branch actual. Usar SIEMPRE cuando el usuario pida dejar el repo clean o limpio, sincronizar el branch actual, publicar todo lo pendiente, o quedar exactamente al día con origin. Si hay cambios sin commit, muestra su impacto y pregunta si conservarlos o descartarlos; nunca descarta trabajo ni hace force-push sin confirmación explícita.
---

# Repo Clean

Deja el **checkout actual** limpio y alineado con `origin/<branch-actual>`, sin cambiar de branch. Es un workflow de cierre y sincronización, no una excusa para borrar trabajo: si hay cambios locales, el usuario elige en cada ejecución si se conservan en commits o se descartan.

En Codex, usar `request_user_input` solo cuando esté disponible. Si no, mostrar las mismas opciones en texto plano, terminar el turno y esperar la respuesta. Descartar cambios siempre requiere confirmación explícita, aunque el usuario haya pedido genéricamente "dejar limpio".

## Contrato de salida

Solo reportar `REPO CLEAN` cuando se cumplan TODAS estas postcondiciones:

1. El branch actual es el mismo que al inicio; nunca se hizo `checkout` ni `switch` a otro branch.
2. `git status --porcelain=v1 --untracked-files=all` no devuelve nada.
3. No hay merge, rebase, cherry-pick, revert ni bisect en curso.
4. Tras un `git fetch` final, `HEAD` y `refs/remotes/origin/<branch>` apuntan al mismo commit.
5. No se creó ningún stash y no se usó ninguna variante de force-push.

Los archivos ignorados no son cambios pendientes: dejarlos intactos. El alcance es solo el branch actual y su branch homónimo en `origin`; no sincronizar otros branches.

## Fase 1 — Preflight sin tocar el trabajo local

Ejecutar desde el root detectado por Git y guardar el branch inicial:

```bash
git rev-parse --show-toplevel
git symbolic-ref --quiet --short HEAD
git status --porcelain=v2 --branch --untracked-files=all
git remote get-url origin
git fetch --prune origin
```

Antes de seguir:

- Leer `AGENTS.md`, `CLAUDE.md` y `.sdd/project.md` si existen, en especial límites de commit/push y la política Git del proyecto.
- Si no es un repo, hay detached HEAD, no existe `origin`, el fetch falla, faltan credenciales o una regla del proyecto prohíbe la operación necesaria, frenar **antes** de commitear o descartar nada.
- Detectar operaciones en curso usando `git status` y los paths devueltos por `git rev-parse --git-path` para `MERGE_HEAD`, `rebase-merge`, `rebase-apply`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` y `BISECT_LOG`.
- No asumir que el upstream configurado es el target. El target de este skill es exactamente `refs/remotes/origin/<branch-inicial>`.

### Operación Git en curso

No normalizarla con `reset`. Mostrar el tipo de operación, conflictos y estado, y preguntar con `request_user_input`, de a una pregunta:

1. **Terminar la operación** — inspeccionar y continuar solo si la resolución es inequívoca.
2. **Abortar la operación** — mostrar el comando exacto (`git rebase --abort`, `git merge --abort`, etc.) y advertir que descarta el progreso de esa operación.
3. **Cancelar** — no tocar nada.

La elección de abortar es la confirmación destructiva. Si el comando específico falla, no reemplazarlo por `reset --hard` sin una nueva confirmación. Al terminar o abortar, reiniciar el preflight.

### `origin/<branch>` no existe

Preguntar antes de tocar el working tree si el usuario quiere crear `origin/<branch>` mediante un push al final. Si no confirma, cancelar. Crear un branch remoto es una mutación externa y no se infiere silenciosamente.

## Fase 2 — Mostrar el estado y decidir los cambios locales

Si el status ya está limpio, saltear esta pregunta. Si hay cualquier cambio staged, unstaged, untracked o conflicto ordinario, mostrar antes de preguntar:

- repo, branch y URL de `origin`;
- `git status --short --branch --untracked-files=all`;
- `git diff --stat` y `git diff --cached --stat`;
- lista completa de untracked;
- preview exacta de `git clean -nd`;
- ahead/behind respecto de `origin/<branch>`, si existe.

Luego usar `request_user_input` con estas opciones, en este orden:

1. **Conservar, commitear y sincronizar (Recomendado)** — preserva todo el trabajo intencional en uno o más commits y lo publica.
2. **Descartar solo cambios sin commit y sincronizar** — descarta staged, unstaged y untracked mostrados; conserva todos los commits locales y luego los publica.
3. **Cancelar** — no modifica nada.

La pregunta debe nombrar explícitamente los paths que se perderán al descartar. Nunca interpretar una frase ambigua como permiso destructivo. Hacer una sola pregunta por llamada.

### Si elige conservar

1. Inspeccionar `git diff`, `git diff --cached` y cada untracked relevante antes de stagear. No usar `git add -A` a ciegas.
2. Respetar la intención del index existente. Si hay cambios independientes, separarlos en commits coherentes; si forman una sola unidad, usar un commit. Derivar mensajes concretos del diff y de las convenciones del repo.
3. No modificar, formatear ni “mejorar” archivos para poder cerrar el repo: este skill preserva el trabajo existente, no implementa features.
4. No stagear secrets, `.env`, credenciales, llaves, dumps ni artefactos evidentemente accidentales. Si alguno impide quedar limpio, detenerse y preguntar si se ignora, se descarta o se conserva por otro medio seguro.
5. Stagear por paths ya revisados, ejecutar `git diff --cached --check`, revisar el diff staged y commitear. No usar `--no-verify`; si un hook falla o modifica archivos, inspeccionar el nuevo estado y no declarar éxito hasta resolverlo.
6. No hacer amend, squash ni reescribir commits existentes salvo pedido explícito del usuario.

La opción “conservar” autoriza crear los commits necesarios y hacer el push normal posterior; no autoriza incluir archivos riesgosos no mostrados.

### Si elige descartar

La selección solo autoriza descartar cambios **sin commit** que fueron mostrados. No autoriza borrar commits locales.

```bash
git reset --hard HEAD
git clean -fd
```

- Ejecutar `git clean -nd` antes y comprobar que coincide con la lista confirmada.
- Nunca usar `git clean -x`, `git clean -X` ni `git clean -ff`; no tocar ignorados ni repos anidados.
- Verificar el status inmediatamente después. Si queda algo —por ejemplo un repo anidado o un submódulo dirty— mostrarlo y pedir una confirmación separada antes de una acción más fuerte.

### Submódulos

Un submódulo dirty es otro repositorio. La elección sobre el repo padre no autoriza commits, resets, cleans ni pushes dentro del submódulo. Mostrar cada submódulo afectado y preguntar por separado si se procesa conservando su trabajo, se descarta dentro de él o se cancela. No usar operaciones recursivas destructivas sin esa confirmación.

## Fase 3 — Sincronizar el branch actual

Con el working tree limpio, volver a hacer `git fetch --prune origin`, confirmar que el branch no cambió y calcular:

```bash
git rev-list --left-right --count "origin/<branch>...HEAD"
```

El primer número es commits solo remotos (`behind`) y el segundo commits solo locales (`ahead`). Actuar según el caso:

- **0 / 0:** ya está alineado.
- **behind > 0 / ahead = 0:** avanzar con `git merge --ff-only origin/<branch>`.
- **behind = 0 / ahead > 0:** hacer push normal con `git push origin HEAD:refs/heads/<branch>`.
- **behind > 0 / ahead > 0:** hay divergencia. Respetar la política explícita del repo. Si no existe, preguntar si rebasear los commits locales sobre `origin/<branch>` (recomendado), mergear `origin/<branch>` o cancelar. Mostrar cuántos commits hay de cada lado.
- **branch remoto inexistente y creación ya confirmada:** `git push -u origin HEAD:refs/heads/<branch>`.

Para una divergencia:

- En rebase, usar `git rebase origin/<branch>`. Resolver conflictos solo cuando la intención sea clara; continuar hasta terminar.
- En merge, usar un merge normal de `origin/<branch>` y respetar hooks/políticas del repo.
- Si no se pueden resolver conflictos con confianza, abortar la operación con su comando específico y dejar el repo sin operación a medias. Reportar `REPO NO SINCRONIZADO`.

Si un push es rechazado porque el remoto avanzó, hacer fetch, recalcular e integrar una vez más. Limitar el ciclo a dos intentos; después frenar y reportar la carrera. Nunca usar `--force`, `--force-with-lease`, borrar el branch remoto ni pushear otro branch.

Si no hay upstream configurado, establecer `origin/<branch>` después de un push exitoso. Si el upstream apunta a otro remoto o branch, no cambiarlo silenciosamente: reportarlo y preguntar antes de modificarlo.

## Fase 4 — Verificación final

Hacer una comprobación independiente, no confiar solo en que los comandos anteriores terminaron con exit code 0:

```bash
git fetch --prune origin
git symbolic-ref --quiet --short HEAD
git status --porcelain=v1 --untracked-files=all
git rev-parse HEAD
git rev-parse "refs/remotes/origin/<branch>"
git status --short --branch
```

Volver a comprobar que no haya operación Git en curso. Si el fetch final descubre nuevos commits remotos, recalcular y hacer como máximo el segundo intento permitido; no afirmar que quedó alineado si los SHAs difieren.

## Reporte

Éxito:

```text
REPO CLEAN
- repo: <root>
- branch: <branch> (sin cambiar de branch)
- cambios locales: <no habia | conservados en commits ... | descartados tras confirmacion>
- sincronizacion: <ya alineado | fast-forward | rebase/merge + push | push>
- final: status limpio · HEAD == origin/<branch> @ <sha-corto>
```

Si no se cumplen todas las postcondiciones:

```text
REPO NO SINCRONIZADO
- motivo: <fallo concreto>
- acciones ya realizadas: <commits, descarte confirmado, fetch, etc.>
- estado actual: <branch, status, ahead/behind>
- recuperacion segura: <siguiente comando o decision necesaria>
```

Nunca esconder una ejecución parcial detrás de “casi clean”. Si se confirmó un descarte, recordarlo explícitamente porque los untracked eliminados pueden no ser recuperables por Git.

## MUST DO

- Preguntar **en cada ejecución dirty** si se conserva o descarta; conservar es la opción recomendada.
- Mostrar status, resumen y paths afectados antes de pedir permiso destructivo.
- Preservar siempre los commits locales, aun cuando se descarten cambios sin commit.
- Mantenerse en el branch inicial y sincronizar solo con su branch homónimo en `origin`.
- Respetar instrucciones y límites del repo antes de commit o push.
- Verificar status vacío e igualdad de SHAs después del fetch final.
- Ante un fallo, abortar cualquier rebase/merge iniciado por el skill si no puede completarse con seguridad.

## MUST NOT DO

- No usar force-push bajo ninguna forma.
- No hacer `checkout`/`switch`, ni resetear a `origin/<branch>`: eso podría borrar commits locales.
- No crear stash; un repo visualmente limpio con trabajo escondido no satisface este skill.
- No borrar ignored, repos anidados ni contenido de submódulos sin confirmación específica.
- No stagear archivos sin inspeccionarlos, ni commitear secrets o artefactos accidentales.
- No saltear hooks con `--no-verify`.
- No tocar otros branches, otros remotes ni el contenido funcional del proyecto.
- No reportar éxito si el branch cambió, el status no está vacío, hay una operación en curso o `HEAD != origin/<branch>`.
