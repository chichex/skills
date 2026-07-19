# Contrato de autonomia — skills
<!-- Generado por /skill:sdd-init el 2026-07-18. Refrescar con /skill:sdd-init --update. -->

## Stack
Repositorio de skills Markdown para Claude Code, opencode y Pi, mas extensiones TypeScript que Pi carga directamente con jiti; no hay `package.json`, lockfile, build ni dependencias locales (`README.md`, `install.sh`). Las extensiones usan APIs de `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` y `typebox` provistas por la instalacion global de Pi. Los tests existentes usan `node:test` sobre TypeScript nativo. Verificado localmente con Node `v26.4.0`, Pi `0.80.10`, Bash `3.2.57` y GitHub CLI `2.96.0`.

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| tests de extensiones | `node --test pi-extensions/*/*.test.ts` | raiz | verificado 2026-07-18 | 0.14s | 7/7 tests pasan; hoy solo cubren `inline-skill-autocomplete` |
| sintaxis del instalador | `bash -n install.sh` | raiz | verificado 2026-07-18 | <0.01s | valida sintaxis sin ejecutar el `git pull` ni copiar archivos globales |
| whitespace del diff | `git diff --check` | raiz | verificado 2026-07-18 | 0.01s | sin errores de whitespace en el diff actual |
| smoke de extensiones | `args=(); for extension in pi-extensions/*.ts pi-extensions/*/index.ts; do [ -f "$extension" ] && args+=(--extension "$extension"); done; pi "${args[@]}" --list-models` | raiz (Bash) | verificado 2026-07-18 | 0.76s | cargaron 9 entrypoints y Pi listo 57 modelos; no inicia una sesion ni ejecuta tools |
| instalar/actualizar Pi | `./install.sh pi` | raiz | no probado (muta configuracion global y ejecuta `git pull`) | — | copia skills, extensiones y themes a los destinos globales; correr solo con autorizacion explicita |
| build | — | raiz | no disponible | — | las extensiones TypeScript son interpretadas por Pi; el repo no define build |
| typecheck/lint | — | raiz | no disponible | — | no hay `tsconfig`, linter ni scripts declarados |

## Ambientes
Solo hay ambiente local: archivos fuente en este checkout y recursos instalados en `~/.agents/skills`, `~/.pi/agent/extensions` y `~/.pi/agent/themes`. No hay staging, produccion, servicios, base de datos ni `.env`. `install.sh` admite `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR` y `PI_THEMES_DIR` para cambiar destinos; son rutas, no secretos. Para probar autonomamente usar carga temporal con `pi --extension ... --list-models` y tests locales; no ejecutar el instalador global salvo autorizacion.

Git: branch default `main`, remote `origin` configurado en `ssh://git@github.com/chichex/skills.git`. GitHub CLI esta autenticado con capacidad de PR. `/skill:sdd-run` debe crear su worktree desde `origin/main`, pushear solo su branch de trabajo y nunca mergear.

## Verificacion autonoma
1. **Estatica basica:** `bash -n install.sh` y `git diff --check` detectan errores de shell y whitespace.
2. **Unitaria determinista:** `node --test pi-extensions/*/*.test.ts`; agregar tests de logica pura en `pi-extensions/<extension>/*.test.ts` permite TDD confiable.
3. **Carga integrada de extensiones:** cargar todos los entrypoints con `--extension` y ejecutar `--list-models`; observa imports, inicializacion y colisiones de registro sin abrir TUI.
4. **Prueba interactiva:** despues de `./install.sh pi` y `/reload`, los flujos TUI, cambios reales de modelo, fallback ante errores de proveedor y compactacion requieren una sesion Pi interactiva. No existe un harness e2e automatizado en este repo para esas conductas.

El techo autonomo actual es carga integrada mas tests unitarios. La experiencia TUI, un fallo real de proveedor y la calidad relativa de los modelos necesitan prueba humana o un futuro harness con proveedor falso.

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
- No hay e2e automatizado para TUI, cambio de modelo, compactacion o fallback de proveedor.
- El checkout estaba sucio al generar este contrato: `pi/issue-triage/SKILL.md` contiene cambios locales preexistentes. `/skill:sdd-run` abortara hasta que el usuario los preserve en un commit o deje el repo limpio.
