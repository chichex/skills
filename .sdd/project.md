# Contrato de autonomia — skills
<!-- Generado por /skill:sdd-init el 2026-08-15. Refrescar con /skill:sdd-init --update. -->
<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-15 -->

## Stack
Repositorio de skills Markdown para cuatro harnesses — Claude Code (`claude/`), Codex (`codex/`), opencode (`opencode/`) y Pi (`pi/`) — mas extensiones TypeScript interpretadas por jiti y un Pi Package Git nativo declarado en el `package.json` raiz. El manifest es privado, ESM, sin scripts de publicacion, lockfile ni dependencias runtime; declara como peers las APIs core que Pi ya provee. Los tests usan `node:test` sobre TypeScript nativo y el gate `pi-extensions/pi-package/pi-package.test.ts` prueba inventario, carga RPC/theme, lifecycle y limpieza con configuracion descartable. Scripts de chequeo en `scripts/` y CI en `.github/workflows/ci.yml`; no hay build, `tsconfig` ni package manager local requerido. Verificado localmente con Node `v26.4.0`, Pi `0.84.2`, Bash `3.2.57`, Git `2.50.1` y GitHub CLI `2.96.0`.

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| gate focalizado de Pi Package | `node --test pi-extensions/pi-package/pi-package.test.ts` | raiz | verificado 2026-08-16 | 5.9s | 17/17: metadata/peers (derivados de los imports reales via parser string-aware, no de una lista hardcodeada ni inyectados en el test), censo anti-drift sobre archivos trackeados en git (con test end-to-end de un scratch file untracked real), RPC con 20 comandos, theme, install/list/remove, limpieza (incluye nombres renombrados/eliminados upstream via manifest, y reconciliacion del bloque Codex), refuerzo de `install.sh pi` ante Pi Package nativo ya instalado, y docs. Los 2 tests que invocan el binario `pi` (RPC/lifecycle) se skipean solos si `pi` no esta en PATH en vez de fallar |
| tests de extensiones | `node --test pi-extensions/*/*.test.ts` | raiz | verificado 2026-09-22 | 4.5s | 323/323; glob bloqueante de CI, incluye el gate de Pi Package y los gates SDD |
| gate anti-drift SDD | `node --test pi-extensions/harness-gate/harness-gate.test.ts` | raiz | verificado 2026-09-22 | 0.30s | 33/33; incluido tambien en la suite completa, valida templates y marker del contrato |
| gate anti-drift de agentes de plugin | `node --test pi-extensions/agents-gate/agents-gate.test.ts` | raiz | verificado 2026-09-22 | <1s | 25/25; incluido tambien en la suite completa; censa `agents/*.md` sobre archivos trackeados en git contra `implementer.md`/`reviewer.md`, valida frontmatter (incluida la exigencia de `description` entre comillas dobles) y doctrina de `claude/sdd-review-loop/SKILL.md` y `claude/sdd-run/SKILL.md`, exige que `plugin.json` no declare `agents` (Claude Code solo acepta rutas `.md` ahi y el campo apaga el autodescubrimiento de `agents/`; `"./agents"` rompia la carga con `agents.0: Invalid input`), prueba `install.sh claude`/`all`/`both` con `CLAUDE_SKILLS_DIR`/`CLAUDE_AGENTS_DIR`/`CLAUDE_PLUGIN_REGISTRY_FILE` temporales (comparando mtime del HOME real antes/despues), y falla si aparece un `agents/` bajo `claude/`, `opencode/` o `pi/` a cualquier profundidad |
| lint de frontmatter | `bash scripts/lint-frontmatter.sh` | raiz | verificado 2026-09-17 | <1s | 56 skills OK; bloqueante en CI |
| reporte de drift | `bash scripts/drift-report.sh` | raiz | verificado 2026-08-15 | <1s | 63 lineas; informativo, siempre exit 0 y publica Markdown en el summary de CI |
| sintaxis de shell | `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` | raiz | verificado 2026-08-15 | <0.1s | valida sintaxis sin ejecutar instaladores |
| whitespace del diff | `git diff --check` | raiz | verificado 2026-08-15 | <0.1s | sin errores en el working tree |
| smoke legacy de entrypoints | `args=(); for extension in pi-extensions/*.ts pi-extensions/*/index.ts; do [ -f "$extension" ] && args+=(--extension "$extension"); done; pi "${args[@]}" --list-models --offline` | raiz (Bash) | verificado 2026-08-15 | <2s | carga los 13 candidatos del glob legacy sin sesion/provider; el gate del package selecciona y prueba exactamente 10 factories de produccion |
| shellcheck | `shellcheck install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` | raiz | verificado 2026-08-16 | <1s | 0 hallazgos; instalado via `brew install shellcheck` (antes solo corria en CI) |
| evals del plugin (Claude Code) | `claude plugin eval . --ablation none --runs 1 --max-cost-usd 5 --no-publish --allow-tools Write --scaffold` | raiz | verificado 2026-09-22 | ≈80s con `-j 3` (8 casos) | 8 casos en `evals/` (7 de triggering con graders `tool_used` gratis, 1 de adherencia de `sdd-spec` con fixture `evals/adherence-sdd-spec/fixtures/mini-cli` y rúbrica `llm`), `model: claude-sonnet-5` en cada caso; corrida única de calibración: 1.15 USD la suite completa (8 casos, Sonnet 5, 1 run) y 0.22 USD el caso de adherencia solo, techo de 5 USD ratificado; sin TTY sumar `--trust-plugin`; a demanda `--case <glob> --runs 3 --ablation with-without`; en CI a pedido con `gh workflow run plugin-eval.yml` (secret `CLAUDE_CODE_OAUTH_TOKEN`). Paga y no determinista: no reemplaza los gates de `node --test` |
| instalar copias Pi legacy | `./install.sh pi` | raiz | no probado sobre home real (muta configuracion global y puede ejecutar `git pull`) | — | alternativa manual; requiere autorizacion explicita; si detecta el Pi Package nativo ya registrado (via `pi list`), se niega a instalar en vez de duplicar — verificado con destinos temporales |
| limpiar copias Pi legacy | `./install.sh pi-clean --confirm` | raiz | no probado sobre home real (por limite) | — | el gate focalizado lo verifica con destinos `PI_*_DIR` temporales; confirma que no hace `git pull`, que limpia nombres renombrados/eliminados upstream (via manifest) y que reconcilia el bloque Codex si existia |
| build | — | raiz | no disponible | — | TypeScript se interpreta; el repo no define build |
| typecheck/lint TypeScript | — | raiz | no disponible | — | no hay `tsconfig`, linter ni scripts declarados |

## Ambientes
Solo hay ambiente local: fuentes en el checkout y, si el humano las instala, recursos bajo la configuracion de Pi o los destinos legacy. No hay staging, produccion, servicios, base de datos, `.env` ni secretos del proyecto. La instalacion nativa es global por defecto (`~/.pi/agent/settings.json`) y `-l` usa `.pi/settings.json`; no ejecutar ninguna contra configuracion real durante verificacion autonoma. El gate crea `HOME` y `PI_CODING_AGENT_DIR` temporales para `pi -e ./`, RPC, theme y `pi install/list/remove`, y compara la configuracion real antes/despues. `install.sh` admite `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR`, `PI_THEMES_DIR`, `CODEX_SKILLS_DIR` y `CODEX_CONFIG_FILE`; son rutas, no secretos.

CI: GitHub Actions (`.github/workflows/ci.yml`) corre en push a `main` y en todo PR, con cinco jobs: `shell` (`bash -n` + `shellcheck`, bloqueante), `frontmatter` (bloqueante), `tests` (Node 26 + Pi 0.84.2 + suite completa, bloqueante), `harness-gate` (bloqueante) y `drift` (informativo). Todo es reproducible localmente, incluido `shellcheck` (instalado con `brew install shellcheck`).

Node: la compatibilidad de versiones se verifico a mano el 2026-08-16 en Node `22.18.0`, `22.23.2` (LTS Jod), `24.19.0` (LTS Krypton) y `26.4.0` (entonces con 202/202 tests; hoy la suite completa da 323/323 tras sumar el gate `agents-gate` (PR #43) y los gates de flujo sin fricción (PR #46) — ver fila `tests de extensiones` — pero no se re-verifico multi-version en cada corrida posterior), usando binarios oficiales descartables de nodejs.org sin tocar el PATH. Node `22.17.1` y `20.20.2` fallan los 23 archivos con `ERR_UNKNOWN_FILE_EXTENSION: ".ts"` — el type stripping nativo sin flag llega recien en 22.18.0. Para repetirlo: bajar `node-vX.Y.Z-darwin-arm64.tar.gz`, descomprimir en un temporal y correr `<tmp>/bin/node --test pi-extensions/*/*.test.ts` desde la raiz.

Git: branch default `main`, remote `origin` en `ssh://git@github.com/chichex/skills.git`. GitHub CLI esta autenticado con capacidad de PR (verificado 2026-08-15). `/skill:sdd-run` ramifica desde `origin/main`, pushea solo su branch de trabajo y nunca mergea.

## Verificacion autonoma
1. **Estatica basica:** `bash -n`, `git diff --check` y `bash scripts/lint-frontmatter.sh` detectan shell invalido, whitespace y frontmatter incorrecto.
2. **Unitaria determinista:** `node --test pi-extensions/*/*.test.ts`; el glob captura toda logica pura y los gates de doctrina/artefactos.
3. **Gate determinista del package:** `node --test pi-extensions/pi-package/pi-package.test.ts` compara el manifest contra el arbol real (via `git ls-files`, no el working tree) y prueba metadata no publicable, peers derivados de los imports reales de codigo trackeado, 12 skills, 10 factories y un theme. Sus autotests demuestran diagnosticos ante drift, metadata debilitada, imports externos sin peer declarado, y estilos de default-export mas alla de `export default function`.
4. **Carga y lifecycle aislados:** el mismo gate ejecuta `pi -e ./`, RPC `get_commands`, smoke del theme y `pi install/list/remove` con `HOME` y `PI_CODING_AGENT_DIR` temporales; no inicia provider ni persiste sesiones. El smoke legacy carga entrypoints explicitamente.
5. **Fuente Git publicada:** una branch publicada puede probarse con `pi -e git:github.com/chichex/skills@<ref>` y configuracion temporal. Es señal MEDIA por depender de red/GitHub; timeout o fallo de clon queda inconcluso.
6. **CI remota:** replica la estatica/suite, instala Pi 0.84.2 para los probes y agrega `shellcheck`.
7. **Prueba humana:** TUI, uso real de tools/comandos, seleccion visual del theme, rollout o limpieza del home real, providers y el lifecycle exacto contra `main` post-merge requieren autorizacion o prueba humana.

El techo autonomo es gate determinista mas carga/lifecycle aislados y, cuando hay red, smoke de la fuente Git publicada. No usar la configuracion Pi real ni providers para alcanzarlo.

## Limites
- No ejecutar deploy, publish, `npm publish`, migraciones sobre datos compartidos ni tocar servicios pagos sin confirmacion humana.
- No hacer `git push` a `main`, force-push ni mergear PRs.
- No ejecutar `./install.sh`, `pi install`, `pi remove` ni `pi-clean --confirm` contra el home/configuracion real sin autorizacion separada; usar siempre destinos temporales para pruebas autonomas.
- No activar un theme ni modificar settings reales del usuario durante smokes.
- No modificar ni borrar recursos globales ajenos; la limpieza legacy solo puede apuntar a nombres administrados por este repo.
- No descartar, pisar ni incluir cambios locales preexistentes del usuario.
- No provocar consumo de providers ni errores pagos solo para probar fallback.

## Politicas de generacion
Sin politicas activas. Configurar con `/skill:sdd-init --update`.

## Decisiones humanas
Sin decisiones humanas registradas en este contrato.

## Gaps
- Pi 0.84.2 es la version contractual probada, no una version minima declarada del package.
- `engines.node` declara `>=22.19.0` alineado con el engine de `@earendil-works/pi-coding-agent`; el piso propio del repo es 22.18.0 (type stripping nativo sin flag). CI corre solo Node 26, asi que la compatibilidad con 22.x/24.x no tiene gate automatizado — se verifico a mano (ver `## Ambientes`) y puede driftear.
- No hay typecheck, lint TypeScript, coverage ni build automatizado.
- No hay e2e automatizado para TUI, cambio de modelo, compactacion ni fallback de provider. La conducta emergente de agentes siguiendo skills la cubre parcialmente la suite `evals/` de `claude plugin eval` (triggering de `sdd-init`, `sdd-spec`, `sdd-run`, `sdd-review-loop`, `grill` y `mini-grill`, y adherencia de `sdd-spec`): es paga, no determinista y corre solo a demanda (local o `plugin-eval.yml`), nunca en el CI de cada PR. Los otros 8 skills de `claude/` y la adherencia de `sdd-run`/`sdd-review-loop` no tienen casos.
- Los smokes Git dependen de red/GitHub; un fallo de infraestructura no prueba un defecto del package.
- El manifest declara `pi.skills`/`pi.themes` a nivel de directorio completo (`./pi`, `./pi-themes`), no archivo por archivo como `pi.extensions`; el gate compensa con `EXPECTED_SKILLS`/`EXPECTED_THEMES` hardcodeados como unico punto de aprobacion explicita para altas/bajas de skills y themes. Colapsar esa capa (como se hizo para extensiones) exigiria cambiar el shape del manifest y no esta confirmado que Pi soporte listas por archivo ahi — queda como propuesta, no implementado.
- La deteccion de "el Pi Package nativo ya esta instalado" en `install.sh` (`pi_native_package_conflict`) usa `pi list` y matchea el literal `chichex/skills` o el path absoluto de este checkout; un fork con otro nombre de repo, o el mismo repo clonado en OTRA ruta e instalado ahi via path local, no se detectan.
