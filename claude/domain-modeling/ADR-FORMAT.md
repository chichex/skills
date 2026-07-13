# Formato de ADR

Los ADRs viven en `docs/adr/` con numeración secuencial: `0001-slug.md`, `0002-slug.md`, etc. Crear el directorio de forma lazy — solo cuando el primer ADR es necesario (y respetando la regla de contaminación cero de [SKILL.md](./SKILL.md)).

## Template

```md
# {Título corto de la decisión}

{1-3 oraciones: cuál es el contexto, qué decidimos y por qué.}
```

Eso es todo. Un ADR puede ser un solo párrafo. El valor está en registrar *que* se tomó una decisión y *por qué* — no en llenar secciones.

## Secciones opcionales

Solo cuando aportan valor genuino. La mayoría de los ADRs no las necesitan.

- **Status** en frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — útil cuando las decisiones se revisitan.
- **Considered Options** — solo cuando las alternativas rechazadas merecen recordarse.
- **Consequences** — solo cuando hay efectos downstream no obvios.

## Numeración

Escanear `docs/adr/` por el número más alto existente e incrementar en uno.

## Cuándo ofrecer un ADR

Las tres condiciones a la vez (con evidencia concreta para cada una — ver SKILL.md):

1. **Difícil de revertir** — cambiar de opinión después tiene un costo real.
2. **Sorprendente sin contexto** — un lector futuro miraría el código y se preguntaría "¿por qué lo hicieron así?"
3. **Trade-off real** — había alternativas genuinas y se eligió una por razones específicas.

Si falta una, no hay ADR. Si es fácil de revertir, se revierte y listo. Si no sorprende, nadie va a preguntarse por qué. Si no había alternativa real, no hay nada que registrar más allá de "hicimos lo obvio".

### Qué califica

- **Forma arquitectónica.** "Monorepo." "Write model event-sourced, read model proyectado a Postgres."
- **Patrones de integración entre contextos.** "Ordering y Billing se comunican por eventos de dominio, no HTTP sincrónico."
- **Elecciones de tecnología con lock-in.** Base de datos, message bus, proveedor de auth, target de deploy. No cada librería — solo las que llevaría un trimestre cambiar.
- **Decisiones de límites y alcance.** "Los datos de Customer los posee el contexto Customer; los demás referencian por ID." Los "no" explícitos valen tanto como los "sí".
- **Desvíos deliberados del camino obvio.** "SQL a mano en vez de ORM porque X." Cualquier cosa donde un lector razonable asumiría lo contrario — evita que el próximo dev lo "arregle".
- **Restricciones invisibles en el código.** "No podemos usar AWS por compliance." "Respuestas bajo 200ms por contrato con el partner."
- **Alternativas rechazadas por razones no obvias.** Si se consideró GraphQL y se eligió REST por razones sutiles, registrarlo — o alguien lo vuelve a proponer en seis meses.

### Qué NO califica

- **Elección de librería sin lock-in.** "axios vs fetch", "zod para validación" — reversible en una tarde.
- **Convenciones de código o estilo.** Van en el linter o en CLAUDE.md, no en ADRs.
- **Decisiones que siguen el camino obvio.** Nadie va a preguntarse por qué.
- **El registro de qué se hizo.** Para eso está el git log.
- **Decisiones de implementación local.** Cómo se estructura una función o un módulo interno — eso lo cuenta el propio código.
