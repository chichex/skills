# Escribir para agentes

Guía de escritura para todo documento que un agente consume en este repo. El alcance lo fija `SKILL.md`. Adaptada de `writing-for-agents` de Matt Pocock (MIT).

## 1. Puntero de contexto

La `description` está cargada en cada turno. Decide cuándo el agente llega al cuerpo. Cada palabra cuesta en cada turno.

- Un trigger por rama. Cinco sinónimos de una misma rama son un trigger escrito cinco veces.
- Sacá lo que el cuerpo ya dice. La description señala cuándo usar el skill; el cómo vive en el cuerpo.
- Topes, como dato y no como regla propia: el estándar Agent Skills fija `description` entre 1 y 1024 caracteres (agentskills.io/specification, citado por el review del PR #68 el 2026-10-08, sin re-verificar), y Claude Code trunca `description` + `when_to_use` en 1536 en el listado (code.claude.com/docs/en/skills, misma fuente). Apuntá a menos de 500.
- La palabra que dispara va primera.

Test: tachá cada frase de la description. ¿El agente igual elegiría el skill en el caso correcto? Si sí, sobraba.

## 2. Las dos cargas

- Carga de contexto: lo que está siempre en la ventana (descripciones, líneas de `CLAUDE.md`).
- Carga cognitiva: lo que la persona tiene que recordar para saber qué skill existe.

Un skill user-invoked cuesta cero contexto y sube la carga cognitiva. Uno model-invoked paga contexto en cada turno. Gastá contexto solo si el agente tiene que llegar solo.

El mecanismo depende del harness: `disable-model-invocation: true` en Claude Code, `policy.allow_implicit_invocation: false` en `agents/openai.yaml` de Codex. En Claude Code ese flag también bloquea la tool `Skill` y la precarga vía `skills:` de un agente.

Test: ¿lo invoca solo la persona? Ningún skill lo llama con `Skill`, ningún agente lo lista en `skills:` y nadie pierde nada al escribirlo a mano. Si algo lo encadena, queda model-invoked.

## 3. Disclosure progresiva

Lo que toda rama necesita va adentro. Lo que solo algunas ramas usan va en un archivo aparte, con un puntero que dice cuándo abrirlo. Una referencia larga enterrada entre pasos hace que atender a los pasos sea una moneda al aire.

Test: para cada bloque, listá las ramas que lo leen. Si no son todas, sale del archivo principal y queda un puntero.

## 4. Criterio de terminado por paso

Cada paso termina en una condición que el agente puede observar. Un criterio difuso ("entendido el problema") invita a cerrar antes de tiempo. Uno exigente ("cada modelo modificado nombrado") fuerza el trabajo a fondo.

Test: ¿dos agentes distintos coincidirían en si el paso terminó? ¿Exige exhaustividad, no solo "producir una lista"?

## 5. Leading words

Una palabra que el modelo ya conoce ancla una conducta entera con pocos tokens: implacable, tracer bullet, rojo, seam. Repetila como token, nunca como oración. Una palabra inventada no recluta nada y hay que definirla.

Test: buscá tríadas o frases que gesticulan una sola idea ("rápido, determinista y barato"). ¿Una palabra existente las reemplaza ("tight")?

## 6. Negación

Prohibir mete la conducta en el contexto y la vuelve más disponible. Escribí lo positivo: "comentarios de una línea" en lugar de "no escribas comentarios largos". Un `MUST NOT` se queda como guardrail duro sin forma positiva, junto al objetivo positivo. Las secciones `## MUST DO` / `## MUST NOT DO` existentes son doctrina con gates: se respetan como formato y no se reescriben al editar.

Test: buscá "no", "nunca", "evitá". ¿La oración se puede decir sin la conducta prohibida?

## 7. Poda de no-ops

- Una oración que el modelo ya cumple por defecto paga carga y no cambia nada. Sacala entera, corré el skill y mirá si algo cambia. Si dos personas discrepan, corré el skill: no se debate.
- Cada significado tiene una sola fuente. Lo que ya dicen `package.json`, un script o `--help` se consulta ahí. Repetirlo en un documento es un caché que se vence.
- Cacheá lo que el agente no encuentra mirando: la convención no escrita, el porqué, la trampa.

Test: ¿esta línea cambia la conducta respecto del default? ¿Un comando la responde en un paso?

## Higiene de redacción

Dos errores que aparecieron en reviews: una lista de un solo ítem (va en prosa) y una oración sin verbo (el agente completa el sentido por su cuenta). Reescribilos al verlos.

## Checklist para review de un diff que toque skills

En un porteo, lo que marque el checklist no se corrige solo en el destino: se reporta, o se aplica como mejora de doctrina a todas las versiones (regla central de `SKILL.md`).

- [ ] La description tiene un trigger por rama y ningún sinónimo repetido.
- [ ] La description no repite lo que dice el cuerpo y apunta a menos de 500 caracteres.
- [ ] La invocación (flag de Claude Code o `allow_implicit_invocation` de Codex) coincide con quién llega al skill.
- [ ] Lo que usan solo algunas ramas vive en un archivo aparte con puntero.
- [ ] Cada paso termina en un criterio observable y exigente.
- [ ] Las tríadas y frases que gesticulan una idea se colapsaron en una leading word existente.
- [ ] Las prohibiciones tienen su versión positiva al lado; las secciones `## MUST NOT DO` existentes quedan como están.
- [ ] Cada oración nueva nombra la conducta que cambia respecto del default; las discutidas se prueban corriendo el skill sin ellas.
- [ ] Ningún umbral, conteo o comando repite lo que el entorno ya responde.
- [ ] Ninguna lista tiene un solo ítem y toda oración tiene verbo.
