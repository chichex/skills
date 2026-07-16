---
name: github-issue-selector
description: Abre un selector interactivo de issues de GitHub para elegir e inspeccionar un issue antes de trabajar en él. Usar cuando el usuario quiere seleccionar, listar, revisar o trabajar sobre un issue pero no indicó un número concreto.
compatibility: Requiere que el harness exponga la herramienta select_github_issue y que el repositorio sea accesible desde GitHub.
---

# GitHub Issue Selector

Usá la herramienta `select_github_issue` para que el usuario elija un issue de forma interactiva.

## Flujo

1. Determiná los filtros a partir del pedido:
   - `repo`: usá `owner/repo` solo si el usuario especificó otro repositorio; de lo contrario, omitilo para usar el repositorio del directorio actual.
   - `state`: `open` por defecto; usá `closed` o `all` si el pedido lo requiere.
   - `query`: trasladá búsquedas, labels, assignees u otros filtros a una consulta de búsqueda de GitHub.
   - `limit`: usá el valor pedido; si no existe, omitilo.
2. Invocá `select_github_issue` inmediatamente. No reemplaces el selector con una lista generada mediante `gh`, `git` o búsquedas manuales.
3. Tomá como contexto autoritativo los detalles completos devueltos por el issue seleccionado.
4. Continuá con la acción solicitada sobre ese issue. Si el usuario solo pidió elegirlo o inspeccionarlo, resumí brevemente sus datos relevantes y esperá la próxima instrucción.

## Reglas

- Si el usuario ya proporcionó inequívocamente un número de issue, no abras el selector salvo que también pida comparar o elegir entre issues.
- No inventes un issue ni elijas uno en nombre del usuario.
- Si el repositorio no puede inferirse y no fue especificado, pedí `owner/repo` antes de invocar la herramienta.
- Si `select_github_issue` no está disponible, informalo claramente; no simules la interacción.
