# Escribir para agentes

Leé esto antes de crear o editar un `SKILL.md`, un `agents/openai.yaml` o un `CLAUDE.md`/`AGENTS.md` de este repo. Vale para cualquier documento que un agente consume. El empaquetado cambia; la escritura no. Adaptado de `writing-for-agents` de Matt Pocock (MIT).

## 1. Puntero de contexto

La `description` está cargada en cada turno. Decide cuándo el agente llega al cuerpo. Cada palabra cuesta en cada turno.

- Un trigger por rama. Cinco sinónimos de una misma rama son un trigger escrito cinco veces.
- Sacá lo que el cuerpo ya dice. La description señala cuándo usar el skill; el cómo vive en el cuerpo.
- Tope duro: 1024 caracteres en Claude Code. Apuntá a menos de 500.
- La palabra que dispara va primera.

Test: tachá cada frase de la description. ¿El agente igual elegiría el skill en el caso correcto? Si sí, sobraba.

## 2. Las dos cargas

- Carga de contexto: lo que está siempre en la ventana (descripciones, líneas de `CLAUDE.md`).
- Carga cognitiva: lo que la persona tiene que recordar para saber qué skill existe.

Un skill user-invoked con `disable-model-invocation: true` cuesta cero contexto y sube la carga cognitiva. Uno model-invoked paga contexto en cada turno. Gastá contexto solo si el agente tiene que llegar solo.

Test: ¿alguien lo invocaría a mano sin perder nada? Entonces `disable-model-invocation: true`.

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

Prohibir mete la conducta en el contexto y la vuelve más disponible. Escribí lo positivo: "comentarios de una línea" en lugar de "no escribas comentarios largos". Un `MUST NOT` se queda solo como guardrail duro sin forma positiva, y va junto al objetivo positivo.

Test: buscá "no", "nunca", "evitá". ¿La oración se puede decir sin la conducta prohibida?

## 7. Poda de no-ops

- Una oración que el modelo ya cumple por defecto paga carga y no cambia nada. Sacala entera, corré el skill y mirá si algo cambia. Si dos personas discrepan, corré el skill: no se debate.
- Cada significado tiene una sola fuente. Lo que ya dicen `package.json`, un script o `--help` se consulta ahí. Repetirlo en un documento es un caché que se vence.
- Cacheá lo que el agente no encuentra mirando: la convención no escrita, el porqué, la trampa.

Test: ¿esta línea cambia la conducta respecto del default? ¿Un comando la responde en menos de un paso?

## Checklist para review de un diff que toca skills

- [ ] La description tiene un trigger por rama y ningún sinónimo repetido.
- [ ] La description no repite lo que ya dice el cuerpo y mide menos de 1024 caracteres (meta: menos de 500).
- [ ] La invocación (`disable-model-invocation`) coincide con quién tiene que llegar al skill.
- [ ] Lo que usan solo algunas ramas vive en un archivo aparte con puntero.
- [ ] Cada paso termina en un criterio observable y exigente.
- [ ] Cada lista tiene dos ítems o más; un ítem solo va en prosa.
- [ ] Cada oración tiene verbo y sujeto recuperable.
- [ ] Las prohibiciones tienen su versión positiva al lado; un `MUST NOT` suelto es guardrail duro.
- [ ] Ningún umbral, conteo o comando repite lo que el entorno ya responde.
- [ ] Cada oración cambia la conducta respecto del default: se probó corriendo el skill sin ella.
