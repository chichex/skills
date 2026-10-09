# Grill — Diseño primero en repos front/mobile (reducir drift de UI)
<!-- Estado: finalized. Proyecto: /Users/ayrtonmarini/workspace/skills. Fuente: pedido libre en chat. -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=2026-10-09-diseno-primero-front-mobile; project=%2FUsers%2Fayrtonmarini%2Fworkspace%2Fskills -->

## Hechos comprobados
- Ningún skill del repo tiene doctrina de diseño UI (grep de `diseñ|design|figma|storybook|mockup` en `claude/`, `agents/`, `shared/`, `docs/`: solo la description de `grill`, los grados MEDIA/BAJA de `sdd-spec` y la categoría de inferencia "UX/copys").
- `coding-policies` detecta stacks front/mobile por marcadores: `react-dom`, `next`, `react-native`/`expo`, Gradle Android/KMP (`claude/coding-policies/SKILL.md:58-66`).
- `sdd-spec` clasifica "UI web" como MEDIA y "detalle visual fino, copys, layout" como BAJA; lista "UX/copys" como categoría de inferencia (`claude/sdd-spec/SKILL.md:76,96-97`). No inventaría diseño.
- `sdd-run` Fase 2 planifica contra el código con `Explore` y adopta coding policies al escribir; no hay paso de diseño (`claude/sdd-run/SKILL.md:84-94`). `sdd-init` releva STACK sin inventario de diseño (`claude/sdd-init/SKILL.md:72`).
- El plugin oficial `frontend-design` (`claude-plugins-official`) está instalado y existe solo en Claude Code. Doctrina: plan de tokens (color, tipografía, layout, principios) → revisar contra el brief → construir → autocrítica con capturas; "donde el brief fija dirección visual, seguirla exacta".
- Tool `DesignSync` en Claude Code: lee proyectos Design System de claude.ai/design (`list_projects`, `get_project`, `list_files`, `get_file`); escribir exige `finalize_plan` + `write_files`. Solo se usa vía el skill `/design-sync` iniciado por el usuario. El tipo de Artifact "Design System" existe en la cuenta; no hay artifacts creados desde ese tipo.
- `~/workspace/dale-que-sale` (Expo/RN): `src/theme/` (colors, spacing, radius, shadows, typography), 31 componentes en `src/components/ui/`, `DESIGN_SYSTEM.md` (19 líneas) enlazado desde `CLAUDE.md`, ratchets de hex en `.sdd/project.md` (`hex-mobile`, `tokens-web`), y bundle trackeado `design-sync/` (18 HTML con marker `@dsCard`, commit `cca3a9b`). Su README declara el código como fuente de verdad, no guarda URL ni projectId, y nombra `.claude/skills/design-sync/`, que no existe en el checkout.
- `~/workspace/tracker` (Next.js + Tailwind v4): `design-system/` con 20 HTML (foundations, components, screens) que no referencian `CLAUDE.md`, `AGENTS.md` ni `.sdd/project.md`; el contrato dice "sin e2e, lo visual se prueba a mano con Playwright MCP".
- Pi: `pi-extensions/grill-tools/logic.ts:101-110` arma el handoff desde el snapshot con secciones fijas (`## Hechos comprobados`, `## Decisiones resueltas`, `## Ramas pendientes`, `## Handoff`).
- Gates: `harness-gate` exige regexes de doctrina de `grill` (rondas, hechos sin bloqueo, atajo liviano) y templates de artefactos byte a byte entre harnesses; cualquier cambio de doctrina se portea a 4 harnesses (`harness-port`); los `references/*.md` de `coding-policies` son mirrors de `shared/coding-policies/references/` sincronizados por `scripts/sync-coding-policies-references.mjs`.
- Precedente "menos fricción" (`.sdd/grills/2026-09-22-sdd-menos-friccion.md`): `sdd-spec` no pregunta inferencias; todo va `[ASSUMED]` a la tabla y el usuario revisa sobre el artefacto.

## Decisiones resueltas
1. Drift atacado: ambos — desvío del sistema de diseño existente y dirección visual/UX inventada sin referencia.
2. Elementos de diseño a detectar: tokens/theme en código; componentes base/UI kit; docs y mocks (`DESIGN_SYSTEM.md`, `design-system/*.html`, Storybook, `docs/design/`); Claude Design asociado cuando aplique en Claude Code.
3. Harnesses: los 4 (Claude, Codex, opencode, Pi) con doctrina idéntica. `frontend-design` y `DesignSync` son extras de Claude, capa de interacción.
4. Inventario en el contrato: `sdd-init` escribe una sección `## Diseño` en `.sdd/project.md`. `grill`, `sdd-spec` y `sdd-run` la leen. Si falta, exploran una vez (fallback ad hoc) y avisan que corresponde `sdd-init --update`.
5. Trigger por pedido, no por tipo de repo. En monorepos (backend, web y mobile en el mismo repo), `## Diseño` se organiza por superficie UI (ej. mobile `src/`, `provider-web/`, `landing/`), cada una con raíces, inventario propio y estado con/sin sistema.
6. Clasificación "toca UI": superficies del contrato ∩ paths que el pedido tocaría (reconocimiento de grill, Fase 2 de spec, Fase 2 de run). Si queda ambiguo, una sola pregunta al usuario. No hay pregunta fija "¿toca UI?".
7. Secciones de la rama de diseño del grill, preguntadas solo si inventario y repo no las resuelven: pantallas/flujos/estados (carga, vacío, error, éxito); reuso vs. componentes nuevos; dirección visual solo sin sistema; plataformas y accesibilidad; web sólida en celular/webview (solo superficies web: zoom al tap, scroll al escribir, teclado, safe-area).
8. Superficie front/mobile sin elementos de diseño: el run NO frena; sigue con `[ASSUMED]` y lo declara. El sistema de diseño nace desde `sdd-init` (decisión 9).
9. Skill nuevo `design-system` (nombre tentativo), encadenado desde `sdd-init` al cerrar el contrato, como `coding-policies`: pregunta dirección visual, escribe el doc de diseño (`DESIGN_SYSTEM.md`: paleta, tipografía, espaciado, radios, reglas; tokens como valores) y lo registra en `## Diseño`. No escribe código: los tokens en código nacen en el primer run que toque UI, siguiendo el doc. Opcional, nunca bloqueante.
10. Handoff del grill: sección `## Diseño` con decisiones y referencias (pantallas/flujos/estados; componentes a reusar o crear por nombre del inventario; dirección visual si aplica; webview/plataforma/a11y) más capturas de pantalla de referencia. Sin wireframes ni mocks: el grill no construye.
11. Capturas de referencia: el agente renderiza con Playwright las referencias renderizables del inventario (mocks HTML, bundle `design-sync/`, Design de Claude, Storybook); las que el usuario adjunte se guardan tal cual. Nunca se inventan. El "antes" de la app actual no se captura en el grill.
12. Guardado de capturas: `.sdd/grills/<fecha>-<slug>/*.png`, commiteadas, referenciadas por ruta relativa desde handoff y spec; en issue, por URL raw del repo.
13. Spec: sección nueva `## Diseño` (inventario citado con rutas, pantallas y estados, componentes reusados o nuevos, wireframe ASCII por pantalla nueva, capturas de referencia) y CAs de UI que citan componente o token concreto.
14. Verificación de fidelidad, tres mecanismos combinados: capturas implementación vs. referencia en el PR (grado MEDIA); CAs por grep o test sobre componentes y tokens (ALTA); gates ratchet propuestos por `sdd-init` en `## Politicas de generacion` (hex fuera de theme, estilos inline, componentes duplicados). La prueba humana no se suma como mecanismo nuevo: `sdd-spec` ya exige protocolo para CA NULA.
15. `sdd-run`: en Fase 2 imprime junto al plan efímero el plan de diseño (pantalla → componentes/tokens del inventario, qué se crea nuevo); en Claude carga `frontend-design` solo si la superficie no tiene sistema; al cerrar adjunta en el PR las capturas implementación vs. referencia. No persiste nada fuera del PR ni actualiza la spec o el inventario.
16. Diseñar sin sistema en los 4 harnesses: doctrina propia mínima e idéntica (plan de tokens → revisar contra pedido e inventario → construir → autocrítica con captura) en `design-system` y en el paso de diseño de `sdd-run`. En Claude, si `frontend-design` está instalado, se carga como refuerzo.
17. Claude Design: `sdd-init` registra en `## Diseño` la URL o projectId del proyecto Design System si la encuentra en el repo (README de `design-sync/`, `CLAUDE.md`) o la pregunta, y el bundle local `design-sync/` si existe. En Claude, los skills leen el proyecto remoto con `DesignSync` solo lectura (`list_files`/`get_file`) y lo tratan como datos; en Codex/opencode/Pi usan el bundle local y citan la URL.
18. Checklist webview en coding-policies: bloques nuevos "Web en celular y webview" en `shared/coding-policies/references/react.md` y `next.md` (viewport, inputs ≥ 16px en iOS, teclado y scroll, safe-area, targets táctiles, nada solo-hover) y en `react-native.md` para el lado host de `WebView` embebida. Se sincronizan a los mirrors con `node scripts/sync-coding-policies-references.mjs`.

## Ramas pendientes
Ninguna dentro del alcance.

## Handoff
**Tema y alcance**
Reducir el drift de UI en el flujo SDD: `sdd-init` inventaría los elementos de diseño por superficie, `grill` abre una rama de diseño cuando el pedido toca UI, `sdd-spec` fija el diseño en la spec y `sdd-run` planifica contra el inventario y prueba fidelidad con capturas. Nace un skill `design-system` para repos sin sistema. Todo en los 4 harnesses de este repo. Las 18 decisiones de arriba son confirmadas.

**Restricciones y no-objetivos**
- Cero fricción nueva para pedidos sin UI: la rama de diseño no aparece.
- No se pregunta lo que el inventario resuelve.
- `grill` no construye (ni wireframes ni mocks); `sdd-init` no escribe código de la app; `design-system` solo escribe el doc.
- `DesignSync` es solo lectura desde los skills: nunca `finalize_plan` ni `write_files`.
- No se tocan `dale-que-sale` ni `tracker` desde esta spec.
- No se debilita la verificación existente ni el precedente "menos fricción" (`sdd-spec` no pregunta inferencias).
- El run nunca se bloquea por falta de diseño.

**Supuestos explícitos**
- La detección de superficies UI reutiliza los marcadores de `coding-policies` (`react-dom`, `next`, `react-native`/`expo`, Gradle), extendidos a sub-paquetes del monorepo.
- Sin eval pago nuevo: la doctrina se protege con gates deterministas (`harness-gate` con bloque nuevo, lint de frontmatter, `sync-coding-policies-references.mjs --check`, `agents-gate` si cambia `implementer`).
- Capturas PNG, pocas y chicas (una por pantalla o estado relevante). En Claude, Playwright MCP; en otros harnesses, el navegador headless que el contrato declare o adjuntas del usuario.
- `DESIGN_SYSTEM.md` vive en la raíz de la superficie (o del repo si hay una sola), como en `dale-que-sale`.
- `## Diseño` del handoff y de la spec se agregan como sección nueva sin tocar los markers `SDD-Tracking`.

**Riesgos**
- Pi: el handoff se arma desde el snapshot con secciones fijas (`grill-tools/logic.ts:101-110`); `## Diseño` y capturas exigen extender el esquema de `grill_session` o anidarlas dentro de `## Handoff`.
- Tamaño: 5 skills tocados (`sdd-init`, `grill`, `sdd-spec`, `sdd-run`, `coding-policies`) más 1 nuevo (`design-system`), por 4 harnesses, más gates, README y `plugin.json`. Casi seguro excede un PR: la spec debería proponer capas (contrato e inventario; grill y capturas; spec y run; skill `design-system`; coding-policies webview).
- Mobile: las capturas dependen de simulador y suelen ser NULA; ahí la fidelidad queda en CAs por grep/test más prueba humana.
- Binarios en git bajo `.sdd/grills/`; `pi remove` no los borra.
- `DesignSync` puede pedir scopes de diseño en el primer uso; `frontend-design` es un plugin externo con licencia propia: se carga, no se copia.
- `harness-gate` compara templates byte a byte: `## Diseño` en spec y handoff debe agregarse idéntico en los 8 archivos.

**Diferido**
- Aplicar a `dale-que-sale` y `tracker` (`sdd-init --update`, ratchets, link al Design) como prueba humana post-merge.
- Eval de adherencia para la rama de diseño.
- Clasificación de "toca UI" por palabras clave como respaldo.
- Mocks tipo Design (Artifact) desde grill o spec.

**Contexto recomendado para la spec**
`{claude,codex,opencode,pi}/{sdd-init,grill,sdd-spec,sdd-run,coding-policies}/SKILL.md`, `shared/coding-policies/references/{react,next,react-native}.md`, `pi-extensions/harness-gate/harness-gate.test.ts`, `pi-extensions/grill-tools/logic.ts`, `.claude/skills/harness-port/SKILL.md` y `references/escritura.md`, `docs/harness-interaction-differences.md`, `.sdd/grills/2026-09-22-sdd-menos-friccion.md`, `.sdd/grills/2026-09-13-coding-policies.md`, el plugin `frontend-design` (`~/.claude/plugins/cache/claude-plugins-official/frontend-design/`) como referencia de doctrina, y como ejemplos reales `~/workspace/dale-que-sale/{DESIGN_SYSTEM.md,design-sync/README.md,.sdd/project.md}` y `~/workspace/tracker/design-system/`.
