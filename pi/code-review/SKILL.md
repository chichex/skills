---
name: code-review
description: Revisa un Pull Request de GitHub contra el codigo real en tres ejes separados — Correctness & Risk, Standards y Spec — con evidencia por archivo/linea, severidad, confianza y verificaciones ejecutadas. Al terminar muestra exactamente que comments publicaria y pregunta si el usuario quiere postearlos; nunca publica, aprueba ni pide cambios sin confirmacion explicita. Usar SIEMPRE que el usuario pida revisar, auditar o comentar un PR de GitHub.
compatibility: Requiere un repositorio git, GitHub CLI (gh) autenticado y acceso de lectura al PR. Publicar comments requiere permiso de escritura en el repositorio.
---

Revisa un PR de GitHub sin modificar codigo ni cambiar el checkout del usuario. La review responde tres preguntas por separado:

1. **Correctness & Risk** — ¿el cambio funciona y es seguro en el contexto real del codigo?
2. **Standards** — ¿respeta las instrucciones y convenciones documentadas por el repo?
3. **Spec** — ¿implementa lo pedido, completo y sin scope creep?

La review termina primero en pantalla. Despues muestra una preview exacta y usa `ask_user_question` para decidir si publicar los comments en GitHub. La opcion segura por default es no publicar.

## Argumentos

```text
/skill:code-review [<numero de PR | URL de PR>]
```

- Con numero o URL: revisar ese PR.
- Sin argumento: intentar resolver el PR abierto de la branch actual con `gh pr view`. Si no hay uno inequivoco, pedir numero o URL con `ask_user_question`.
- Solo revisar PRs del repositorio GitHub correspondiente al cwd. Si la URL apunta a otro repo, frenar y pedir ejecutar el skill dentro de ese checkout.

## Fase 1 — Preflight y change set

1. Confirmar que el cwd esta dentro de un repo git y que `gh auth status` funciona. No ejecutar login ni cambiar credenciales.
2. Resolver el PR y guardar metadata con `gh pr view`: `number`, `title`, `body`, `url`, `baseRefName`, `headRefName`, `headRefOid`, `author`, `isDraft`, `files`, `commits`, `comments`, `reviews` y `closingIssuesReferences`.
3. Confirmar que el remote del checkout corresponde al repo del PR. No revisar una URL externa contra el codigo equivocado.
4. Capturar `git status --porcelain`. Los cambios locales, staged, unstaged y untracked NO forman parte del PR: no mezclarlos con la review y declararlos en Limitaciones. Nunca hacer stash, reset, checkout ni commit.
5. Traer objetos sin cambiar branches:
   - fetch de la branch base y guardar su SHA;
   - fetch de `pull/<numero>/head` y guardar el SHA;
   - confirmar que el head obtenido coincide con `headRefOid`;
   - calcular `merge-base` y revisar `git diff --find-renames <merge-base> <head-sha>`.
6. Capturar antes de analizar:
   - lista de commits;
   - `--stat` y lista de archivos;
   - diff completo;
   - diff `--unified=0`, que define que lineas admiten comments inline.

Una referencia invalida, un PR cerrado que no se pueda obtener, un head inconsistente o un diff vacio frenan la review con diagnostico concreto. No improvisar otra base.

Para leer el codigo completo en el estado del PR sin tocar el checkout, preferir un worktree temporal detached en `<head-sha>`. Eliminarlo al terminar. Si no se puede crear, usar `git show <head-sha>:<path>` y declarar la limitacion.

## Fase 2 — Fuentes autoritativas

### Instrucciones del repo

Buscar y leer las fuentes aplicables al archivo cambiado, incluyendo cuando existan:

- `AGENTS.md` y `CLAUDE.md` (tambien los anidados; gana el mas cercano al archivo);
- `.sdd/project.md`;
- `CONTRIBUTING.md`, `CODING_STANDARDS.md`, `STYLEGUIDE.md`;
- README y documentacion de arquitectura relevante;
- configuracion de formatter, linter, typechecker, tests y CI.

Una regla documentada del repo gana sobre cualquier heuristica de este skill. Citar archivo y regla al reportar una violacion.

### Spec

Buscar la fuente funcional en este orden:

1. body, titulo, discussion y metadata del PR;
2. issues cerrados/referenciados por el PR;
3. issue/spec mencionado en commits;
4. `.sdd/specs/`, `specs/`, `docs/`, `prd/` u otra ruta explicita del repo que coincida con el PR;
5. ruta que haya dado el usuario.

El PR body por si solo puede ser spec si declara comportamiento esperado. Si hay fuentes en conflicto, reportar el conflicto: no elegir silenciosamente. Si no hay spec, la seccion Spec dice `No hay spec verificable disponible`; no inventar requisitos.

## Fase 3 — Contexto y verificaciones

No revisar hunks aislados. Por cada zona relevante leer, desde el estado del head del PR:

- archivo completo;
- callers y callees;
- tipos, contratos y configuracion asociados;
- tests existentes y nuevos;
- implementaciones analogas;
- migraciones y compatibilidad cuando aplique.

Ejecutar checks seguros que el repo documente y que puedan correr sobre el head exacto del PR: primero focalizados, despues una escalera razonable de tests, typecheck, lint y build. Usar `.sdd/project.md` como fuente principal si existe. No instalar dependencias, levantar servicios pagos, desplegar, migrar datos compartidos ni escribir fuera de un worktree temporal solo para completar una review.

Cada comando queda como `PASS`, `FAIL` o `NO EJECUTADO`, con motivo. Un timeout o proceso interrumpido es no concluyente, nunca PASS. Una falla preexistente solo se atribuye al PR si hay evidencia causal.

## Fase 4 — Tres pasadas separadas

### Correctness & Risk

Buscar problemas introducidos por el diff, no defectos historicos sin relacion. Evaluar segun aplique:

- logica, estados invalidos, errores y casos borde;
- autorizacion, privacidad, secretos e injection;
- concurrencia, idempotencia y orden de eventos;
- integridad de datos, migraciones, rollback y compatibilidad;
- contratos publicos, API, schemas y consumidores existentes;
- performance, recursos, retries y failure modes;
- observabilidad y operacion;
- cobertura real de tests y tests que pasan sin observar el comportamiento.

### Standards

Comparar con las fuentes documentadas. Ademas, usar como heuristicas — nunca como violaciones automaticas — nombres misteriosos, duplicacion, feature envy, data clumps, primitive obsession, switches repetidos, shotgun surgery, divergent change, speculative generality, message chains, middle man y herencia rechazada.

No recomendar una abstraccion solo porque aparece un smell. Explicar el costo concreto en este PR; si no hay impacto demostrable, omitirlo. No repetir findings que formatter/linter/typechecker ya reportan mejor: incluir el resultado de la herramienta.

### Spec

Comparar requisito por requisito y citar la fuente. Buscar:

- requisitos faltantes o parciales;
- comportamiento incorrecto aunque "parezca implementado";
- scope creep y generalidad especulativa;
- cambios no documentados en comportamiento, datos o UX;
- criterios que no se pueden verificar con la evidencia disponible.

Mantener las tres listas separadas. Un eje no compensa a otro.

## Findings

Reportar solo problemas accionables introducidos por el PR. Omitir gustos personales y nits sin impacto. Para cada finding usar:

```markdown
- **[MAJOR · confianza alta] Titulo corto** — `path/file.ts:42`
  - Problema: <que esta mal + evidencia concreta>
  - Impacto: <que puede romper o por que importa>
  - Sugerencia: <direccion de arreglo, sin imponer una refactorizacion innecesaria>
  - Fuente: <regla o requisito citado, si aplica>
```

Severidades:

- **BLOCKING** — riesgo de seguridad/integridad, comportamiento central incorrecto, perdida de datos o PR no desplegable.
- **MAJOR** — bug, requisito importante faltante, regresion o riesgo significativo que deberia resolverse antes del merge.
- **MINOR** — problema real y acotado que conviene corregir, sin bloquear por si solo.

Confianza: `alta`, `media` o `baja`. No publicar findings de confianza baja como afirmaciones: presentarlos en Limitaciones/preguntas, no como comments inline.

Cuando no haya findings, decirlo explicitamente; no inventar uno para justificar la review.

## Reporte previo a publicar

Mostrar siempre, antes de preguntar:

```markdown
# Review de PR #<n> — <titulo>

## Correctness & Risk
<findings o "Sin findings accionables">

## Standards
<findings o "Sin findings accionables">

## Spec
<findings, conflicto de fuentes o "No hay spec verificable disponible">

## Verificacion
- PASS: <comandos>
- FAIL: <comandos + diagnostico>
- NO EJECUTADO: <comandos + motivo>

## Limitaciones
<working tree ignorado, contexto inaccesible, checks no ejecutados, dudas de confianza baja>

## Resumen
- findings: BLOCKING <n> · MAJOR <n> · MINOR <n>
- por eje: Correctness & Risk <n> · Standards <n> · Spec <n>
- head revisado: `<sha>`
```

Despues mostrar `## Preview de publicacion` con el body del review y cada comment exactamente como se enviaria. Un finding sobre una linea agregada/modificada del diff va inline (`RIGHT`); uno sobre una linea eliminada va inline (`LEFT`). Si la ubicacion no pertenece al diff, incluirlo en el body general y no inventar una coordenada.

## Gate obligatorio de publicacion

Luego de mostrar reporte y preview, usar `ask_user_question` exactamente una vez:

- Pregunta: `Review terminada para el PR #<n>. ¿Queres publicar estos comments en GitHub?`
- `No publicar (Recomendado)` — termina dejando todo solo en la conversacion.
- `Publicar comments` — crea un unico review de tipo `COMMENT` con el resumen y los comments inline.

`No publicar` es la opcion recomendada porque escribir en GitHub es un side effect externo. Nunca interpretar silencio, un pedido previo de "revisar" ni una autorizacion generica como permiso para publicar.

## Publicacion

Solo si el usuario elige `Publicar comments`:

1. Volver a consultar `headRefOid` inmediatamente antes del POST. Si cambio respecto del SHA revisado, NO publicar: la review quedo stale y hay que correrla de nuevo.
2. Construir un JSON temporal para `POST /repos/{owner}/{repo}/pulls/{number}/reviews` con:
   - `commit_id`: SHA revisado;
   - `event`: `COMMENT`;
   - `body`: resumen, verificaciones y findings no-inline;
   - `comments`: `{path, line, side, body}` solo para coordenadas validas del diff.
3. Hacer una sola llamada con `gh api --method POST ... --input <payload>`. No usar ademas `gh pr comment`, para no duplicar contenido.
4. Si el POST da resultado ambiguo o timeout, inspeccionar reviews/comments existentes antes de reintentar. Nunca duplicar una review automaticamente.
5. Reportar URL/ID del review publicado y cantidad de comments inline. Borrar payloads y worktrees temporales.

La publicacion siempre usa `COMMENT`: este skill nunca `APPROVE`, nunca `REQUEST_CHANGES`, nunca mergea y nunca modifica codigo.

## MUST DO

- Revisar el merge-base contra el head SHA exacto del PR.
- Leer contexto completo y reglas del repo, no solo el patch.
- Mantener Correctness & Risk, Standards y Spec separados.
- Citar evidencia, severidad, confianza, impacto y ubicacion por finding.
- Mostrar reporte y preview antes del gate final.
- Pedir confirmacion explicita con `ask_user_question` antes de cualquier escritura en GitHub.
- Revalidar el head SHA antes de publicar y usar un unico review `COMMENT`.
- Limpiar worktrees y archivos temporales.

## MUST NOT DO

- No cambiar checkout, stash, reset, archivos, commits ni branches del usuario.
- No incluir cambios locales en una review del PR.
- No inventar spec, reglas, evidencia, resultados de checks ni coordenadas inline.
- No confundir smells con reglas duras ni pedir abstracciones sin impacto concreto.
- No publicar findings de confianza baja como acusaciones.
- No postear, aprobar, pedir cambios, pushear, mergear ni cerrar el PR sin permiso explicito; incluso con permiso, este skill solo puede postear un review `COMMENT`.
