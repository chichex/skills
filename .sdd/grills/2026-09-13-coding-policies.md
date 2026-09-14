# Grill — coding-policies
<!-- Estado: finalized. Proyecto: /Users/ayrtonmarini/Sync/workspace/skills. Fuente: pedido en chat (2026-09-13): skill agnóstico /coding-policies que genere en cada proyecto un archivo Markdown con las buenas prácticas personales por lenguaje, referenciable desde CLAUDE.md, AGENTS.md o .sdd/project.md. -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-09-13-coding-policies; project=%2FUsers%2Fayrtonmarini%2FSync%2Fworkspace%2Fskills -->

## Modo
standard

## Hechos comprobados

- Los cuatro harnesses están instalados: Claude Code 2.1.270, Codex 0.146.0, opencode 1.18.2 y Pi 0.85.1.
- Distribución del repo: plugin `chichex-skills@chichex` para Claude Code (empaqueta `./claude`), Pi Package `git:github.com/chichex/skills` ya registrado en `~/.pi/agent/settings.json`, copias por `install.sh` para Codex (`~/.codex/skills`) y opencode (`~/.config/opencode/skills`).
- Convención del repo: una copia del skill por harness (`claude/`, `codex/`, `opencode/`, `pi/`) con doctrina idéntica y capa de interacción propia. `scripts/drift-report.sh` compara copias (informativo, siempre exit 0) y `scripts/lint-frontmatter.sh` valida frontmatter (bloqueante en CI).
- `tdd` es el modelo de skill con archivos de referencia: `SKILL.md` más `mocking.md` y `tests.md`.
- `sdd-init` Fase 3.5 ("Políticas de generación") ya contempla "políticas de la tecnología": preferencias que quedan como `guia` en `.sdd/project.md`, que `sdd-run` sigue al generar y el reviewer juzga en el PR. `--update` preserva la sección verbatim salvo `Revisar`; `--assume` nunca activa políticas.
- El `CLAUDE.md` de este repo usa el import `@.sdd/project.md`. Ese mecanismo está verificado solo en Claude Code; en Pi, Codex y opencode no se verificó soporte de import.
- Soporte de agents por harness: Claude Code nativo (`~/.claude/agents/*.md`), opencode nativo (`opencode agent create|list`), Codex con feature `multi_agent` estable pero sin formato local verificado, Pi sin nada nativo (solo el ejemplo `subagent/` de pi-mono). Ningún directorio de agents existe hoy en ningún home. Dato de contexto: la decisión final no usa agents.
- Repos Go en el workspace: `~/Sync/workspace/cpanel` (`github.com/pramaestudio/cpanel`, último merge 2026-09-08), `~/Sync/workspace/medicine/medicine-backend` (pramaestudio, template canónico según el CLAUDE.md global del usuario) y `~/Sync/workspace/mobctl` (`github.com/chichex/mobctl`, último commit 2026-06-10). No se detectaron proyectos Kotlin ni React Native.
- No existe ningún documento previo con las prácticas del usuario. El repo no tiene `CONTEXT.md` ni `docs/adr/`.

## Decisiones resueltas

1. **Forma:** un único skill agnóstico `coding-policies` que, invocado en un proyecto, genera un archivo Markdown con las buenas prácticas del usuario para los stacks detectados. Las prácticas por lenguaje viven como referencias dentro del skill. Reemplaza la idea inicial de un skill o subagente por stack.
2. **Dónde vive:** en este repo `chichex/skills`, distribuido por plugin de Claude Code, Pi Package e `install.sh`.
3. **Harnesses:** los cuatro (Claude Code, Codex, opencode, Pi), una copia por harness según la convención del repo.
4. **Stacks v1:** infraestructura completa del skill más contenido real solo para Go. React web, Node, Kotlin mobile y React Native quedan como referencias a agregar después. Si el skill detecta un stack sin referencia, lo informa y no inventa reglas.
5. **Contenido del archivo generado:** autocontenido. Copia las reglas completas de cada stack detectado y agrega links a las guías base como lectura ampliada.
6. **Forma de cada regla:** corta, tipo MUST/SHOULD, con el porqué en una línea y, cuando exista, el mecanismo que la mide (regla de linter, comando). El detalle largo va en la referencia del skill, no en la regla.
7. **Ubicación por defecto del archivo:** `.sdd/coding-policies.md`. Una ruta explícita por argumento manda a cualquier otro destino.
8. **Enganche al contexto:** al terminar, el skill detecta `CLAUDE.md`, `AGENTS.md` y `.sdd/project.md` existentes y ofrece agregar la referencia en los que el usuario elija. Sin confirmación no edita nada. En Claude Code usa import `@ruta`; en el resto una instrucción de lectura.
9. **Regeneración:** si el archivo ya existe, se reescribe con las prácticas actuales preservando verbatim la sección "Ajustes de este proyecto".
10. **Detección de stacks:** automática por marcadores del repo, con confirmación del usuario. Pasar stacks como argumentos saltea la confirmación, como el lanzador (Fase 0) del resto del repo.
11. **Integración con `sdd-init`:** en Fase 3.5, si `.sdd/coding-policies.md` existe lo escribe como `guia` en Políticas de generación, también con `--assume` (el archivo ya es una decisión humana en el repo). Si no existe, ofrece correr `coding-policies`, nunca con `--assume`. Aplica a las cuatro copias de `sdd-init`.
12. **Fuentes del contenido Go:** extracción de patrones de los repos Go del usuario (cpanel, medicine-backend, mobctl, salvo descarte al revisar) más tres guías base: Uber Go Style Guide, Effective Go con Go Code Review Comments, y Package Oriented Design de Ardan Labs.
13. **Momento y autoría del contenido Go:** ahora, en esta misma sesión. El agente propone el borrador leyendo repos y guías; el usuario lo revisa y poda en el chat antes de que se materialice en el skill.

## Restricciones y no-objetivos

- Sin subagentes ni skills por stack.
- El skill nunca toca configuración global de un harness ni edita archivos de contexto del proyecto sin confirmación.
- `sdd-init` referencia el archivo como `guia`; no activa gates por regla.
- Ningún flujo genera el archivo con `--assume`.

## Supuestos explícitos

- Idioma del contenido: español, como el resto del repo.
- Estructura interna: `SKILL.md` con el procedimiento (detección, confirmación, generación, enganche, regeneración) y un archivo de referencia por stack dentro del skill, empezando por Go.
- Invocado pelado abre un lanzador; con argumentos (stacks, ruta de salida) lo saltea.
- El archivo generado lleva un marcador con la versión de las prácticas para saber si está desactualizado y para delimitar la sección preservada.
- Marcadores de detección: `go.mod` para Go; `package.json` con `react-dom` para React web, con `react-native` o `expo` para React Native, sin React para Node; `build.gradle` o `build.gradle.kts` con Android para Kotlin mobile.
- Nombre e invocación: `coding-policies` (`/coding-policies` en Claude Code y opencode, `$coding-policies` en Codex, `/skill:coding-policies` en Pi).

## Riesgos y preguntas diferidas

- El import `@ruta` fuera de Claude Code no está verificado. Una instrucción de lectura depende de que el modelo la obedezca.
- El archivo generado es un snapshot: no se actualiza solo cuando cambien las prácticas. Se mitiga con el marcador de versión y la regeneración.
- Cuatro copias del skill pueden driftear; se acepta la convención actual con reporte informativo.
- Gates por regla activables desde `sdd-init` quedan fuera de la v1.

## Ramas pendientes

- Contenido de React web, Node, Kotlin mobile y React Native, una sesión por stack.
- Verificar soporte de import en Pi, Codex y opencode.
- `code-review` consultando el archivo en su eje de estándares.
- Gates por regla en `sdd-init`, si alguna vez se quieren.

## Handoff

Contexto recomendado para quien escriba la spec: `claude/sdd-init/SKILL.md` Fase 3.5 y sus tres pares (`codex/`, `opencode/`, `pi/`), `claude/tdd/` como modelo de skill con referencias, `.claude/skills/harness-port/SKILL.md`, `scripts/lint-frontmatter.sh`, `.sdd/project.md` y el `CLAUDE.md` de este repo como ejemplo de import `@ruta`.

Las secciones anteriores (hechos comprobados, decisiones resueltas 1 a 13, restricciones y no-objetivos, supuestos explícitos, riesgos y ramas pendientes) constituyen el contrato completo confirmado por el usuario el 2026-09-13.
