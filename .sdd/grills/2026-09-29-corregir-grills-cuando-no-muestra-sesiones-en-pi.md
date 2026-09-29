# Grill — Corregir `/grills` cuando no muestra sesiones en Pi
<!-- Estado: finalized. Proyecto: /home/chiche/workspace/skills. Fuente: pedido en chat. -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=corregir-grills-cuando-no-muestra-sesiones-en-pi-20260929-cf16d049; project=%2Fhome%2Fchiche%2Fworkspace%2Fskills -->

## Modo
standard

## Hechos comprobados
- `/grills` hoy solo lee `~/.pi/agent/grill-sessions/*.json`.
- Filtra primero por el proyecto actual.
- Ignora JSON corruptos sin avisar.
- No inventaría `.sdd/grills/*.md`.
- Este repo tiene cuatro handoffs finalizados y ningún snapshot global.
- Los tres snapshots globales existentes pertenecen a otros proyectos.
- Los cuatro handoffs locales conservan rutas absolutas de otra máquina.
- Pi y este checkout usan el mismo commit: `a12a925`.
- Ya existe un parser normalizado de artefactos SDD.
- El contrato existente define al snapshot como autoridad runtime activa y al handoff como autoridad persistida para `paused|finalized`.

## Decisiones resueltas
1. `/grills` combina snapshots JSON globales y handoffs Markdown.
2. Ambas fuentes se deduplican por identidad `grill`.
3. Un handoff pausado sin snapshot se puede retomar importando estado runtime.
4. Un handoff finalizado sin snapshot se puede inspeccionar, convertir en spec o duplicar como nueva revisión.
5. La ubicación del handoff en el checkout define el proyecto operativo.
6. Una ruta histórica distinta en el marker no bloquea y se conserva como antecedente diagnosticable.
7. El snapshot importado usa el root actual como `projectPath`.
8. `/grills` abre el repo actual por defecto.
9. Ver todos los proyectos sigue siendo una acción manual; no hay fallback automático.
10. Un repo sin grills muestra un estado vacío explícito y mantiene disponible “Ver todos”.
11. Un snapshot o handoff inválido aparece con advertencia.
12. El error y la ruta del artefacto inválido se pueden inspeccionar.
13. Retomar, duplicar o crear una spec queda bloqueado hasta corregir un artefacto inválido.

## Ramas pendientes
Ninguna dentro de este alcance.

## Handoff
### Tema y alcance
Corregir `/grills` en Pi para que no omita sesiones válidas. El cambio cubre inventario, deduplicación, acciones, portabilidad y diagnóstico del selector.

### Restricciones y no-objetivos
- No cambiar el alcance inicial a todos los proyectos.
- No hacer fallback automático.
- No esconder artefactos inválidos.
- No ejecutar transiciones sobre identidad o estado dudosos.
- No depender de que exista la ruta absoluta histórica.
- No modificar documentación de dominio.
- No tocar configuración global de Pi durante la verificación.

### Dependencias y consecuencias
- Separar el inventario de la TUI y probarlo en forma determinista.
- Respetar la precedencia existente entre snapshot y handoff.
- No fingir que existía un snapshot al importar un handoff.
- Conservar la procedencia y la ruta histórica del handoff importado.
- Permitir que el flujo de spec use la ruta del handoff cuando no exista un ID runtime.
- Actualizar la documentación que hoy dice que Pi solo reanuda desde snapshot.

### Supuestos explícitos
- “Mismas acciones útiles” significa paridad por estado, no igualdad interna de almacenamiento.
- El handoff alcanza para reconstruir contexto semántico.
- Los detalles runtime ausentes se inicializan de forma conservadora.
- La forma exacta de conservar la ruta histórica se decide en la spec.
- Nunca se inventan respuestas o decisiones ausentes del handoff.

### Riesgos y preguntas diferidas
- Algunos handoffs legacy pueden estar incompletos.
- Dos fuentes pueden declarar la misma identidad con contenido incompatible.
- Un handoff pausado puede no conservar el detalle fino del snapshot original.
- El inventario de todos depende de los proyectos conocidos por Pi.
- La representación exacta del estado importado queda para diseño verificable en la spec.
- Los conflictos deben degradar a diagnóstico, nunca resolverse por fecha.

### Contexto recomendado para la spec
- Cambiar `pi-extensions/grill-tools/index.ts`.
- Reutilizar `pi-extensions/workflow-resolution/index.ts`.
- Extraer helpers puros para inventario, deduplicación e importación.
- Agregar tests de snapshot solo, handoff solo, fuentes equivalentes, conflicto, ruta histórica, vacío local, inválido, resume/import y spec desde handoff.
- Correr la suite contractual completa.
- Dejar la validación visual TUI como prueba humana.
