---
name: github-issue-selector
description: Lista e inspecciona issues de GitHub para que el usuario elija uno antes de trabajar. Usar cuando el usuario quiere seleccionar, listar, revisar o trabajar sobre un issue pero no indicó un número concreto.
---

# GitHub Issue Selector

Listar y permitir inspeccionar issues sin depender de una extensión TUI.

## Flujo

1. Confirmar el repositorio desde el cwd con `gh repo view`.
2. Consultar issues abiertos con `gh issue list --limit 30 --json number,title,labels,updatedAt,url`.
3. Mostrar una tabla compacta ordenada por actualización, sin ocultar número, título ni labels.
4. Si no hay un candidato inequívoco, preguntar qué número quiere usar. Usar `request_user_input` cuando esté disponible; si no, preguntar en texto plano y terminar el turno.
5. Antes de continuar, cargar el detalle con `gh issue view <n> --json number,title,body,comments,labels,state,url`.
6. Si el usuario pidió analizar, cargar `issue-triage`. Si pidió trabajar directamente y ya existe una spec SDD, cargar `sdd-run`; si no existe, cargar `issue-triage`.

No elegir un issue por el usuario, no cerrar ni eliminar issues desde este skill y no ejecutar login ni cambiar credenciales.
