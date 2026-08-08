# Contrato de autonomia — skills
<!-- Generado por /sdd-init el 2026-08-08. Refrescar con /sdd-init --update. -->
<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-08 -->

## Stack
Repositorio de skills Markdown para cuatro harnesses — Claude Code (`claude/`), Codex (`codex/`), opencode (`opencode/`) y Pi (`pi/`) — mas extensiones TypeScript que Pi carga directamente con jiti; no hay `package.json`, lockfile, build ni dependencias locales (`README.md`, `install.sh`). Las extensiones usan APIs de `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` y `typebox` provistas por la instalacion global de Pi; `pi-extensions/sdd-artifacts/` es una libreria TypeScript pura (sin I/O ni APIs de Pi) que implementa el contrato normativo `docs/sdd-tracking-v1.md`. Los tests usan `node:test` sobre TypeScript nativo. Scripts de chequeo en `scripts/` y CI en `.github/workflows/ci.yml`. Verificado localmente con Node `v26.4.0`, Pi `0.84.1`, Bash `3.2.57` y GitHub CLI `2.96.0`.

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| tests de extensiones | `node --test pi-extensions/*/*.test.ts` | raiz | verificado 2026-08-08 | 0.13s | 41/41 tests pasan; cubren `inline-skill-autocomplete` y `sdd-artifacts` (34 tests, leen los vectores de conformance de `docs/sdd-tracking-v1.md`) |
| lint de frontmatter | `bash scripts/lint-frontmatter.sh` | raiz | verificado 2026-08-08 | 0.4s | 44 skills OK; exit 1 ante frontmatter invalido — bloqueante en CI |
| reporte de drift | `bash scripts/drift-report.sh` | raiz | verificado 2026-08-08 | 0.5s | SOLO informativo: siempre exit 0; imprime Markdown pensado para `$GITHUB_STEP_SUMMARY` |
| sintaxis de shell | `bash -n install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` | raiz | verificado 2026-08-08 | <0.01s | valida sintaxis sin ejecutar |
| whitespace del diff | `git diff --check` | raiz | verificado 2026-08-08 | <0.1s | sin errores en el arbol actual |
| shellcheck | `shellcheck install.sh scripts/lint-frontmatter.sh scripts/drift-report.sh` | raiz | no probado (shellcheck no instalado localmente) | — | corre en el job `shell` de CI; instalar con `brew install shellcheck` para verificarlo local |
| smoke de extensiones | `args=(); for extension in pi-extensions/*.ts pi-extensions/*/index.ts; do [ -f "$extension" ] && args+=(--extension "$extension"); done; pi "${args[@]}" --list-models` | raiz (Bash) | verificado 2026-08-08 | 1.1s | carga 10 entrypoints (incluida la libreria `sdd-artifacts`, que no rompe como `--extension`) y Pi lista los modelos; no inicia sesion ni ejecuta tools |
| instalar/actualizar Pi | `./install.sh pi` | raiz | no probado (muta configuracion global y ejecuta `git pull`) | — | copia skills, extensiones y themes a los destinos globales; correr solo con autorizacion explicita |
| build | — | raiz | no disponible | — | las extensiones TypeScript son interpretadas por Pi; el repo no define build |
| typecheck/lint | — | raiz | no disponible | — | no hay `tsconfig`, linter ni scripts declarados |

## Ambientes
Solo hay ambiente local: archivos fuente en este checkout y recursos instalados en `~/.agents/skills`, `~/.pi/agent/extensions` y `~/.pi/agent/themes`. No hay staging, produccion, servicios, base de datos ni `.env`. `install.sh` admite `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR` y `PI_THEMES_DIR` para cambiar destinos; son rutas, no secretos. Para probar autonomamente usar carga temporal con `pi --extension ... --list-models` y tests locales; no ejecutar el instalador global salvo autorizacion.

CI: GitHub Actions (`.github/workflows/ci.yml`) corre en push a `main` y en todo PR, con cuatro jobs: `shell` (`bash -n` + `shellcheck`, bloqueante), `frontmatter` (`lint-frontmatter.sh`, bloqueante), `tests` (`node --test` con Node 26, bloqueante) y `drift` (`drift-report.sh`, informativo con `continue-on-error: true`). Lo que CI exige es reproducible localmente salvo `shellcheck` (no instalado).

Git: branch default `main`, remote `origin` configurado en `ssh://git@github.com/chichex/skills.git`. GitHub CLI esta autenticado con capacidad de PR (verificado 2026-08-08: `gh issue edit`, `gh pr list` operativos). `/sdd-run` debe crear su worktree desde `origin/main`, pushear solo su branch de trabajo y nunca mergear.

## Verificacion autonoma
1. **Estatica basica:** `bash -n`, `git diff --check` y `bash scripts/lint-frontmatter.sh` detectan errores de shell, whitespace y frontmatter invalido de los 44 skills.
2. **Unitaria determinista:** `node --test pi-extensions/*/*.test.ts`; agregar tests de logica pura en `pi-extensions/<extension>/*.test.ts` permite TDD confiable (el glob de CI los captura automaticamente). `sdd-artifacts` ademas provee fixtures y parser reutilizables para validar artefactos SDD (specs, handoffs, contratos) en tests nuevos.
3. **Carga integrada de extensiones:** cargar todos los entrypoints con `--extension` y ejecutar `--list-models`; observa imports, inicializacion y colisiones de registro sin abrir TUI.
4. **CI remota:** los jobs bloqueantes replican los escalones 1-2 y agregan `shellcheck`; la señal llega en el PR, no localmente.
5. **Prueba interactiva:** despues de `./install.sh pi` y `/reload`, los flujos TUI, cambios reales de modelo, fallback ante errores de proveedor, compactacion y la conducta real de los agentes al seguir un SKILL.md requieren una sesion interactiva humana. No existe harness e2e automatizado para esas conductas.

El techo autonomo actual es carga integrada mas tests unitarios mas estatica. La experiencia TUI, un fallo real de proveedor, la calidad relativa de los modelos y la ejecucion fiel de un skill por un agente necesitan prueba humana o un futuro harness con proveedor falso.

## Limites
- No ejecutar deploy, publish, migraciones sobre datos compartidos ni tocar servicios pagos sin confirmacion humana.
- No hacer `git push` a `main`, force-push ni mergear PRs.
- No correr `./install.sh` sin autorizacion: hace `git pull` y reemplaza las copias globales de los recursos de este repo.
- No modificar ni borrar otros skills/extensiones globales fuera de los nombres administrados por este repo.
- No descartar, pisar ni incluir cambios locales preexistentes del usuario.
- No provocar consumos deliberados de contexto o errores pagos de proveedores solo para probar fallback sin confirmacion.

## Gaps
- [NEEDS-INPUT] El repo no declara una version minima de Node; los tests fueron verificados con Node `v26.4.0`.
- No hay typecheck, lint ni build automatizado para las extensiones TypeScript.
- No hay e2e automatizado para TUI, cambio de modelo, compactacion, fallback de proveedor ni conducta de agentes siguiendo skills.
- `shellcheck` no esta instalado localmente: ese chequeo solo se observa en CI.
