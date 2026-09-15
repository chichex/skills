# Fuente canónica de `coding-policies`

Este directorio es la única fuente editable de las referencias de `coding-policies`.

- Editar, agregar o eliminar reglas únicamente en `references/*.md`.
- Regenerar los mirrors distribuibles con `node scripts/sync-coding-policies-references.mjs` desde la raíz del repo.
- Verificar sin escribir con `node scripts/sync-coding-policies-references.mjs --check`.
- No editar directamente `{claude,codex,opencode,pi}/coding-policies/references/`: cada instalación necesita su copia autocontenida y el sincronizador la reemplaza.

Los `SKILL.md` permanecen por harness porque sus tools de preguntas, invocaciones y extras son distintos.
