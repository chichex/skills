# Spec — Empaquetar los recursos de Pi como paquete Git nativo
<!-- Generada por /skill:sdd-spec el 2026-08-15. Fuente: issue #21. Estado: implementada -->
<!-- SDD-Tracking: version=1; type=spec; state=implemented; issue=#21; grill=none; superseded-by=none -->

## Contexto
Pi 0.84.2 soporta Pi Packages desde Git mediante un manifest `pi` en `package.json`, pero este repo todavía no tiene `package.json` y `pi -e ./` falla intentando cargar la raíz como una extensión. Los recursos destinados a Pi viven en tres seams existentes: 12 skills bajo `pi/`, 10 factories de extensión bajo `pi-extensions/` y el theme `pi-themes/claude-code.json`; `install.sh` hoy los copia a ubicaciones globales. Claude Code ya ofrece una instalación administrada mediante `.claude-plugin/`, por lo que #21 agrega la vía nativa equivalente para Pi sin cambiar el comportamiento de esos recursos.

## Comportamiento esperado

### CA-1 — Manifest Git-only válido y no publicable [ALTA]
Existe un `package.json` en la raíz con JSON válido y metadata determinista: `name=chichex-skills`, `version=0.0.0`, `private=true`, `type=module`, `license=MIT`, repository/homepage de `chichex/skills` y keyword `pi-package`. El paquete no agrega scripts de publicación ni lockfile y `npm publish` queda bloqueado por `private=true`.

### CA-2 — Imports core declarados como peers [ALTA]
El manifest declara exactamente `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` y `typebox` en `peerDependencies` con rango `*`, conforme al contrato oficial de Pi Packages. No agrega esos paquetes a `dependencies`, no usa `bundledDependencies` y no introduce otra dependencia runtime.

### CA-3 — Inventario Pi completo y sin módulos falsos [ALTA]
El bloque `pi` incluye `skills: ["./pi"]`, `themes: ["./pi-themes"]` y exactamente estos 10 entrypoints de extensión:

1. `./pi-extensions/ask-user-question/index.ts`
2. `./pi-extensions/claude-tool-renderer.ts`
3. `./pi-extensions/github-issue-selector.ts`
4. `./pi-extensions/github-issues.ts`
5. `./pi-extensions/github-prs/index.ts`
6. `./pi-extensions/grill-tools/index.ts`
7. `./pi-extensions/inline-skill-autocomplete/index.ts`
8. `./pi-extensions/visual-footer.ts`
9. `./pi-extensions/warp-status.ts`
10. `./pi-extensions/workflow-orchestrator/index.ts`

Helpers, librerías puras, fixtures y `*.test.ts` —incluidos `lib/`, `sdd-artifacts/` y `workflow-resolution/`— no se cargan como extensiones independientes. El paquete descubre los 12 `SKILL.md` actuales y `claude-code.json` sin duplicar o mover archivos.

### CA-4 — Gate bloqueante de inventario [ALTA]
Una suite `node:test`, capturada por `node --test pi-extensions/*/*.test.ts`, deriva el inventario real del árbol y lo compara con el manifest: skills por `pi/**/SKILL.md`, themes por `pi-themes/*.json` y entrypoints de producción por el patrón soportado por Pi más factory `export default`. Agregar, eliminar, renombrar o apuntar fuera de esos recursos hace fallar el test con el path divergente; el mismo gate rechaza tests/helpers declarados como entrypoints, metadata publicable y peers incorrectos.

### CA-5 — Carga temporal del paquete completo [ALTA]
Con `HOME` y `PI_CODING_AGENT_DIR` temporales, `pi -e ./` deja de fallar y carga el paquete sin tocar settings reales. Un probe RPC `get_commands`, sin provider ni sesión persistida, devuelve exactamente los 12 comandos `skill:*` del directorio `pi/` y los ocho comandos de extensión actuales (`issues`, `prs`, `specs`, `grills`, `visual-footer`, `__sdd-dispatch`, `sdd-run`, `llama`), sin eventos `extension_error`. Un smoke separado con `--use-theme claude-code --list-models --offline` termina 0, demostrando que el theme está disponible; instalarlo no cambia automáticamente el theme activo del usuario.

### CA-6 — Lifecycle nativo aislado [ALTA]
Con configuración temporal, `pi install <ruta-local-del-repo>` agrega una única entrada de paquete, `pi list` la muestra, una nueva ejecución descubre sus recursos sin `-e`, y `pi remove <misma-ruta>` la elimina. El test demuestra que ningún archivo bajo la configuración Pi real del usuario cambia. La instalación global sigue siendo el default documentado y `-l` queda documentado como variante project-local opcional.

### CA-7 — Migración segura desde las copias de `install.sh pi` [ALTA core · NULA sobre el home real]
`install.sh` conserva las instalaciones actuales de Claude Code, Codex, OpenCode y Pi, y agrega un modo de limpieza Pi explícito y opt-in. Sin confirmación inequívoca ese modo no borra nada; confirmado, elimina únicamente los nombres de skills, extensiones y themes administrados por este repo en los destinos configurados, respeta `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR` y `PI_THEMES_DIR`, preserva recursos ajenos y no ejecuta `git pull`. Tests sobre directorios temporales prueban no-op sin confirmación, borrado acotado confirmado, idempotencia y preservación de archivos ajenos. Nunca se ejecuta contra el home real durante el run.

### CA-8 — Vía recomendada, actualización y rollback documentados [ALTA]
`README.md` y `README.en.md` presentan Pi Package como vía recomendada y documentan, en ambos idiomas: revisión de seguridad previa; migración de copias manuales; `pi install git:github.com/chichex/skills`; variante `-l`; `pi update --extensions`; pins opcionales por tag/commit y su semántica; `pi remove git:github.com/chichex/skills`; selección manual del theme; y la prohibición de mantener simultáneamente el paquete y las copias de `install.sh pi`. `install.sh pi` permanece como alternativa legacy/manual y la instalación de Claude, Codex y OpenCode no cambia.

La desinstalación nativa no borra `.sdd/specs`, `.sdd/grills`, sesiones, snapshots ni otros datos generados: sólo remueve la fuente del paquete y sus recursos cargados.

### CA-9 — Smoke de la fuente Git publicada [MEDIA]
Después de publicar la branch del PR, `pi -e git:github.com/chichex/skills@<branch>` clona el paquete temporalmente, instala lo necesario y reproduce el inventario observable de CA-5 sin mutar settings persistentes. Un fallo de red o GitHub se reporta como inconcluso, no como verde; máximo tres intentos honestos y sin debilitar assertions.

### CA-10 — Contrato y regresión del repo actualizados [ALTA]
`.sdd/project.md` se refresca después de implementar el manifest: deja de afirmar que no existe `package.json`, documenta los nuevos comandos focalizados y distingue carga temporal/aislada de instalación global. La suite de extensiones, gate anti-drift, lint de frontmatter, sintaxis shell, smoke de entrypoints, shellcheck remoto y `git diff --check` siguen verdes. No cambia el comportamiento funcional de skills, extensiones o themes.

### CA-11 — Validación exacta post-merge antes de cerrar #8 [NULA antes del merge]
Una vez mergeado el PR, se ejecuta el comando exacto sin ref contra `main` en un `PI_CODING_AGENT_DIR` descartable: instalar, listar, iniciar Pi, comprobar inventario/theme, ejecutar `pi update --extensions` y remover. La evidencia se registra en #21 o #8 antes de cerrar el epic. Instalar en la configuración global real o migrar sus copias requiere una autorización humana separada y no forma parte automática de `sdd-run`.

## Fuera de alcance
- Publicar en npm, reservar un nombre npm o diseñar releases/versionado npm.
- Actualizar automáticamente el paquete en cada push; Pi se actualiza mediante `pi update --extensions` y los refs pineados no avanzan solos.
- Activar `claude-code` como theme actual sin elección del usuario.
- Cargar carpetas de Claude Code, Codex u OpenCode desde el Pi Package.
- Borrar datos runtime o artefactos SDD durante migración/desinstalación.
- Instalar o remover recursos en el home real durante CI o ejecución autónoma.
- Cambiar APIs, comandos o conducta interna de los recursos empaquetados.

## Inferencias

| # | Inferencia | Elección | Alternativa razonable | Confianza | Resolución |
|---|---|---|---|---|---|
| 1 | Metadata Git-only del paquete | `chichex-skills`, `0.0.0`, privado, ESM y sin lockfile | Semver real o publicable | media | confirmada |
| 2 | Cómo evitar drift del inventario | Manifest explícito más censo automático del árbol | Allowlist manual solamente | alta | confirmada |
| 3 | Migración desde `install.sh pi` | Limpieza opt-in, confirmada y limitada a recursos administrados | Instrucciones de borrado manual | baja | confirmada |
| 4 | Convivencia de instaladores | Pi Package recomendado; `install.sh pi` legacy/manual y no simultáneo | Soporte equivalente de ambas vías | alta | confirmada |
| 5 | Theme incluido | Disponible sin cambiar selección activa | Activarlo automáticamente | alta | confirmada |
| 6 | Desinstalación | Remover paquete preservando datos runtime y artefactos | Ofrecer purga de datos | alta | confirmada |
| 7 | Compatibilidad Pi | Probado con 0.84.2, peers `*`, sin pin duro | Versión mínima obligatoria | media | confirmada |
| 8 | Scope de instalación | Global por defecto; `-l` opcional | Project-local recomendado | alta | confirmada |

## Verificabilidad
La verificabilidad es mixta. CA-1..CA-8 y CA-10 tienen grado **ALTA** porque son propiedades de archivos, procesos locales finitos y settings redirigidos a temporales; el contrato ya ejecuta TypeScript nativo con `node:test`, shell y smokes de Pi. CA-9 es **MEDIA** porque agrega clon e instalación desde GitHub y puede fallar por red sin indicar un defecto del paquete. CA-11 es **NULA antes del merge**: el source sin ref siempre resuelve `main`, por lo que el commit bajo revisión no puede observarse mediante ese comando exacto hasta ser mergeado.

No hay políticas activas de tamaño, coverage o dependencias nuevas que obliguen a partir esta unidad. El manifest no agrega dependencias runtime externas: los cuatro imports core quedan como peers según la documentación oficial. El contrato está materialmente desactualizado para esta feature —declara ausencia de `package.json`— y CA-10 exige refrescarlo dentro de la ejecución, después de que los comandos existan y puedan verificarse.

## Plan de verificacion
Mecanismo confirmado: **gate determinista + Pi aislado + smoke Git + protocolo post-merge**.

1. **Rojo TDD de CA-1..CA-4:** agregar primero `pi-extensions/pi-package/pi-package.test.ts`; sobre `origin/main` debe fallar porque falta `package.json`. El test valida metadata/peers, censa 12 skills, 10 factories y un theme, compara paths exactos y contiene autotests que inyectan un recurso omitido, un helper falso y metadata publicable.
2. **CA-5:** desde el test o un probe finito, crear `HOME`/`PI_CODING_AGENT_DIR` temporales y enviar `{"type":"get_commands"}` a `pi -e ./ --mode rpc --no-session --offline`; afirmar respuesta exitosa, 20 comandos esperados y cero `extension_error`. Ejecutar además `pi -e ./ --use-theme claude-code --list-models --offline` y exigir status 0.
3. **CA-6:** con los mismos directorios temporales, ejecutar `pi install <ruta-absoluta>`, `pi list`, un probe RPC sin `-e` y `pi remove <ruta-absoluta>`; afirmar una sola entrada antes del remove y ninguna después. Comparar hash/listado de los paths reales de configuración antes y después para demostrar cero mutación.
4. **CA-7:** tests shell o Node con destinos `PI_*_DIR` temporales: sembrar recursos administrados y ajenos, correr el modo sin confirmación y confirmado, repetirlo, y afirmar no-op/borrado/idempotencia/preservación. `bash -n install.sh` y shellcheck remoto cubren la sintaxis/calidad del cambio.
5. **CA-8 y CA-10:** assertions ES/EN sobre README y `.sdd/project.md`, más `bash scripts/lint-frontmatter.sh`, `node --test pi-extensions/*/*.test.ts`, `node --test pi-extensions/harness-gate/harness-gate.test.ts`, el smoke contractual de extensiones, `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` y `git diff --check`. `shellcheck` queda como señal de CI según el contrato.
6. **CA-9:** después de pushear la branch, ejecutar con configuración temporal `pi -e git:github.com/chichex/skills@<branch> --use-theme claude-code --list-models` y el probe RPC equivalente; fijar `PI_SKIP_VERSION_CHECK=1` y `PI_TELEMETRY=0`, sin provider ni sesión, permitiendo únicamente la red necesaria para clonar la fuente Git e instalar sus peers. Registrar comando, ref y salida exacta. Un error de red queda inconcluso y no se reintenta más de tres veces.
7. **CA-11 — protocolo post-merge:** en un directorio descartable, fijar `HOME` y `PI_CODING_AGENT_DIR`; ejecutar `pi install git:github.com/chichex/skills`; comprobar `pi list`; iniciar RPC y validar los 20 comandos; comprobar `--use-theme claude-code`; ejecutar `pi update --extensions`; remover con `pi remove git:github.com/chichex/skills`; comprobar lista vacía. Registrar la evidencia antes de cerrar #8. Para hacer rollout en el home real, pedir autorización separada, migrar primero las copias manuales y luego repetir instalación + `/reload`.

## Riesgos y gaps
- Pi Packages ejecutan extensiones con acceso completo al sistema; README debe conservar la advertencia de revisar el source antes de instalar.
- Instalar el paquete encima de copias de `install.sh pi` puede duplicar skills, tools o comandos; la migración explícita es un gate operativo, no una limpieza automática.
- Un package Git con `package.json` ejecuta `npm install`; los peers y la red sólo se observan de punta a punta en CA-9/CA-11.
- La fuente Git sin ref sigue el branch default y `pi update --extensions` mueve ese checkout; los refs pineados no avanzan automáticamente.
- RPC permite observar skills y comandos, pero no enumera directamente todos los tools; la equivalencia de tools queda respaldada por el inventario exacto de entrypoints y las suites existentes de cada extensión.
- Pi 0.84.2 es la versión observada durante la especificación; el contrato todavía nombra 0.84.1 y debe reconciliarse en CA-10.
- CA-11 queda pendiente hasta después del merge y debe mantenerse visible al decidir el cierre de #8.

## Changelog de desviaciones
- 2026-08-15 — **[DEVIATION] CA-9:** se retiró `--offline` sólo del smoke Git publicado. En Pi 0.84.2, `PI_OFFLINE` hace que una fuente Git temporal ausente se omita antes de clonar (`DefaultPackageManager.resolvePackageSources`); tres probes con configuración nueva salieron 0 pero expusieron únicamente `llama`. El mecanismo corregido mantiene `HOME`/`PI_CODING_AGENT_DIR` descartables, desactiva version check y telemetría, no usa provider ni sesión y conserva las mismas assertions de inventario. No cambia el alcance.

<details><summary>Body original</summary>

<!-- Parent-Epic: chichex/skills#8; unit=pi-package -->

## Contexto

El repo ya ofrece un plugin/marketplace para instalar los skills de Claude Code, pero Pi todavía depende de clonar el repositorio y ejecutar `./install.sh pi`, que copia recursos a ubicaciones globales. Pi soporta paquetes nativos instalables desde Git mediante un manifest `pi` en `package.json`.

## Objetivo

Distribuir los recursos de Pi de este mismo repositorio como un **Pi Package** nativo, instalable y actualizable sin el copiador propio:

```bash
pi install git:github.com/chichex/skills
pi update --extensions
```

## Decisiones confirmadas

- La fuente de distribución es este mismo repositorio Git; no se publica en npm en esta unidad.
- El paquete incluye todos los recursos destinados a Pi: skills de `pi/`, los entrypoints reales de `pi-extensions/` y themes de `pi-themes/`.
- `install.sh` se conserva para los otros harnesses y como vía manual compatible.

## Alcance

- Agregar un manifest raíz válido de Pi Package, marcado para evitar publicación npm accidental.
- Declarar explícitamente los entrypoints de extensiones; no cargar helpers, librerías puras ni archivos `*.test.ts` como extensiones.
- Incluir todos los skills Pi y themes actuales sin copiar recursos a otros directorios.
- Declarar correctamente los paquetes core que las extensiones importan según el contrato de Pi Packages.
- Agregar un gate determinista que detecte recursos Pi faltantes, extra o apuntados incorrectamente en el manifest.
- Verificar el paquete localmente de forma temporal, sin mutar settings globales, mediante `pi -e ./ ...` o el mecanismo equivalente soportado.
- Documentar instalación, actualización, desinstalación/rollback, seguridad y convivencia con `./install.sh pi` en README ES/EN.
- Actualizar `.sdd/project.md` porque el repo dejará de ser un proyecto sin `package.json`.

## Fuera de alcance

- Publicar en npm o diseñar un proceso de releases/versionado npm.
- Instalar el paquete en la configuración global durante CI o verificación autónoma.
- Eliminar el instalador actual o cambiar la distribución de Claude Code, Codex u OpenCode.
- Cambiar el comportamiento funcional de skills, extensiones o themes.

## Resultado observable esperado

Una persona puede instalar el repositorio con `pi install git:github.com/chichex/skills`, iniciar Pi y obtener el mismo inventario de skills, comandos/tools de extensiones y theme que ofrece hoy `./install.sh pi`; las actualizaciones posteriores usan el gestor nativo de paquetes de Pi.

## Relación

Unidad adicional requerida antes de cerrar #8.



</details>

## Resultado de ejecucion (2026-08-15 · HEAD f867731)
| CA | Estado | Evidencia |
|---|---|---|
| CA-1 | verificado | `node --test pi-extensions/pi-package/pi-package.test.ts`: 9/9; rojo inicial 0/2 por `package.json` ausente, luego metadata privada Git-only verde; receipt: manifest nuevo y lockfiles ausentes. |
| CA-2 | verificado | Gate focalizado 9/9: peers exactos `*`, sin `dependencies` ni bundled deps; autotest de peer incorrecto verde. |
| CA-3 | verificado | Gate focalizado 9/9: censo exacto de 12 skills, 10 factories con `export default` y `claude-code.json`; helpers/tests excluidos. |
| CA-4 | verificado | Rojo 2/6 por bloque `pi` ausente y carga de raíz fallida → verde 9/9; autotests diagnostican recurso omitido, factory nueva, helper falso, metadata pública y peer incorrecto. |
| CA-5 | verificado | Gate focalizado: `pi -e ./` aislado devolvió exactamente 20 comandos, cero `extension_error`; smoke `--use-theme claude-code --list-models --offline` terminó 0. |
| CA-6 | verificado | Gate focalizado: dos `pi install <ruta>` dejaron una entrada, `pi list` + RPC descubrieron 20 comandos, `pi remove` dejó lista vacía; digest de configuración real sin cambios. |
| CA-7 | verificado (aislado) | Rojo 6/7 porque `pi-clean` intentaba `git pull` → verde 9/9: rechazo sin `--confirm`, borrado acotado confirmado, idempotencia, overrides `PI_*_DIR` y recursos ajenos preservados; home real no tocado. |
| CA-8 | verificado | Assertions ES/EN rojas 7/9 → verdes 9/9; `workflow-orchestrator/readme-gate.test.ts`: 2/2; lifecycle, seguridad, migración, pins, rollback, theme y prohibición de coexistencia documentados. |
| CA-9 | verificado con desviación documentada | `pi -e git:github.com/chichex/skills@sdd/issue-21-pi-package`: intento 1 del mecanismo corregido, theme status 0, 20 comandos RPC y cero `extension_error`. Tres probes previos con `--offline` devolvieron sólo `llama`; ver changelog. |
| CA-10 | verificado local · pendiente CI | `node --test pi-extensions/*/*.test.ts`: 194/194; harness gate 25/25; frontmatter 47/47; `bash -n`, drift (63 líneas), smoke legacy (13 candidatos), `git diff --check` y diff contra base verdes. `shellcheck` queda pendiente del job remoto declarado. |
| CA-11 | pendiente humano post-merge | Ejecutar el protocolo exacto de esta spec contra `main`, registrar evidencia en #21/#8 y recién entonces decidir el cierre del epic; no se tocó el home real. |

Sin politicas de generacion activas. La primera regresion completa detecto y corrigio dos garantias documentales retiradas accidentalmente; la corrida final sobre `f867731` termino 194/194 verde.
