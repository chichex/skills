# Contrato de autonomia — skills
<!-- Generado por /skill:sdd-init el 2026-08-15. Refrescar con /skill:sdd-init --update. -->
<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-15 -->

## Stack
Repositorio de skills Markdown para cuatro harnesses — Claude Code (`claude/`), Codex (`codex/`), opencode (`opencode/`) y Pi (`pi/`) — mas extensiones TypeScript interpretadas por jiti y un Pi Package Git nativo declarado en el `package.json` raiz. El manifest es privado, ESM, sin scripts de publicacion, lockfile ni dependencias runtime; declara como peers las APIs core que Pi ya provee. Los tests usan `node:test` sobre TypeScript nativo y el gate `pi-extensions/pi-package/pi-package.test.ts` prueba inventario, carga RPC/theme, lifecycle y limpieza con configuracion descartable. Scripts de chequeo en `scripts/` y CI en `.github/workflows/ci.yml`; no hay build, `tsconfig` ni package manager local requerido. Verificado localmente con Node `v26.4.0`, Pi `0.84.2`, Bash `3.2.57`, Git `2.50.1` y GitHub CLI `2.96.0`.

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| gate focalizado de Pi Package | `node --test pi-extensions/pi-package/pi-package.test.ts` | raiz | verificado 2026-08-15 | 4.72s | 9/9: metadata/peers, censo anti-drift, RPC con 20 comandos, theme, install/list/remove, limpieza y docs; usa `HOME` y `PI_CODING_AGENT_DIR` temporales |
| tests de extensiones | `node --test pi-extensions/*/*.test.ts` | raiz | verificado 2026-08-15 | 4.93s | 194/194; glob bloqueante de CI, incluye el gate de Pi Package y los gates SDD |
| gate anti-drift SDD | `node --test pi-extensions/harness-gate/harness-gate.test.ts` | raiz | verificado 2026-08-15 | 0.30s | 25/25; incluido tambien en la suite completa, valida templates y marker del contrato |
| lint de frontmatter | `bash scripts/lint-frontmatter.sh` | raiz | verificado 2026-08-15 | <1s | 47 skills OK; bloqueante en CI |
| reporte de drift | `bash scripts/drift-report.sh` | raiz | verificado 2026-08-15 | <1s | 63 lineas; informativo, siempre exit 0 y publica Markdown en el summary de CI |
| sintaxis de shell | `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` | raiz | verificado 2026-08-15 | <0.1s | valida sintaxis sin ejecutar instaladores |
| whitespace del diff | `git diff --check` | raiz | verificado 2026-08-15 | <0.1s | sin errores en el working tree |
| smoke legacy de entrypoints | `args=(); for extension in pi-extensions/*.ts pi-extensions/*/index.ts; do [ -f "$extension" ] && args+=(--extension "$extension"); done; pi "${args[@]}" --list-models --offline` | raiz (Bash) | verificado 2026-08-15 | <2s | carga los 13 candidatos del glob legacy sin sesion/provider; el gate del package selecciona y prueba exactamente 10 factories de produccion |
| shellcheck | `shellcheck install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` | raiz | no probado (shellcheck no instalado localmente) | — | corre como gate bloqueante en el job `shell` de CI |
| instalar copias Pi legacy | `./install.sh pi` | raiz | no probado (muta configuracion global y puede ejecutar `git pull`) | — | alternativa manual; requiere autorizacion explicita y no debe coexistir con el Pi Package |
| limpiar copias Pi legacy | `./install.sh pi-clean --confirm` | raiz | no probado sobre home real (por limite) | — | el gate focalizado lo verifica con destinos `PI_*_DIR` temporales y confirma que no hace `git pull` |
| build | — | raiz | no disponible | — | TypeScript se interpreta; el repo no define build |
| typecheck/lint TypeScript | — | raiz | no disponible | — | no hay `tsconfig`, linter ni scripts declarados |

## Ambientes
Solo hay ambiente local: fuentes en el checkout y, si el humano las instala, recursos bajo la configuracion de Pi o los destinos legacy. No hay staging, produccion, servicios, base de datos, `.env` ni secretos del proyecto. La instalacion nativa es global por defecto (`~/.pi/agent/settings.json`) y `-l` usa `.pi/settings.json`; no ejecutar ninguna contra configuracion real durante verificacion autonoma. El gate crea `HOME` y `PI_CODING_AGENT_DIR` temporales para `pi -e ./`, RPC, theme y `pi install/list/remove`, y compara la configuracion real antes/despues. `install.sh` admite `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR`, `PI_THEMES_DIR`, `CODEX_SKILLS_DIR` y `CODEX_CONFIG_FILE`; son rutas, no secretos.

CI: GitHub Actions (`.github/workflows/ci.yml`) corre en push a `main` y en todo PR, con cinco jobs: `shell` (`bash -n` + `shellcheck`, bloqueante), `frontmatter` (bloqueante), `tests` (Node 26 + Pi 0.84.2 + suite completa, bloqueante), `harness-gate` (bloqueante) y `drift` (informativo). Todo es reproducible localmente salvo `shellcheck`, que no esta instalado.

Git: branch default `main`, remote `origin` en `ssh://git@github.com/chichex/skills.git`. GitHub CLI esta autenticado con capacidad de PR (verificado 2026-08-15). `/skill:sdd-run` ramifica desde `origin/main`, pushea solo su branch de trabajo y nunca mergea.

## Verificacion autonoma
1. **Estatica basica:** `bash -n`, `git diff --check` y `bash scripts/lint-frontmatter.sh` detectan shell invalido, whitespace y frontmatter incorrecto.
2. **Unitaria determinista:** `node --test pi-extensions/*/*.test.ts`; el glob captura toda logica pura y los gates de doctrina/artefactos.
3. **Gate determinista del package:** `node --test pi-extensions/pi-package/pi-package.test.ts` compara el manifest contra el arbol real y prueba metadata no publicable, peers, 12 skills, 10 factories y un theme. Sus autotests demuestran diagnosticos ante drift y metadata debilitada.
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
- [NEEDS-INPUT] El repo no declara una version minima de Node; los tests fueron verificados con Node `v26.4.0`.
- Pi 0.84.2 es la version contractual probada, no una version minima declarada del package.
- No hay typecheck, lint TypeScript, coverage ni build automatizado.
- No hay e2e automatizado para TUI, cambio de modelo, compactacion, fallback de provider ni conducta emergente de agentes siguiendo skills.
- `shellcheck` no esta instalado localmente: ese gate solo se observa en CI.
- Los smokes Git dependen de red/GitHub; un fallo de infraestructura no prueba un defecto del package.
