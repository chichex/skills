# Formato de ADR

Los ADRs viven en `docs/adr/` con numeracion secuencial: `0001-slug.md`, `0002-slug.md`, etc. Crear el directorio de forma lazy: solo cuando el primer ADR es necesario (y respetando la regla de contaminacion cero de [SKILL.md](./SKILL.md)).

## Template

```md
# {Titulo corto de la decision}

{1-3 oraciones: cual es el contexto, que decidimos y por que.}
```

Eso es todo. Un ADR puede ser un solo parrafo. El valor esta en registrar *que* se tomo una decision y *por que*; no en llenar secciones.

## Secciones opcionales

Solo cuando aportan valor genuino. La mayoria de los ADRs no las necesitan.

- **Status** en frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`): util cuando las decisiones se revisitan.
- **Considered Options**: solo cuando las alternativas rechazadas merecen recordarse.
- **Consequences**: solo cuando hay efectos downstream no obvios.

## Numeracion

Escanear `docs/adr/` por el numero mas alto existente e incrementar en uno.

## Cuando ofrecer un ADR

Las tres condiciones a la vez (con evidencia concreta para cada una; ver SKILL.md):

1. **Dificil de revertir**: cambiar de opinion despues tiene un costo real.
2. **Sorprendente sin contexto**: un lector futuro miraria el codigo y se preguntaria "por que lo hicieron asi?"
3. **Trade-off real**: habia alternativas genuinas y se eligio una por razones especificas.

Si falta una, no hay ADR. Si es facil de revertir, se revierte y listo. Si no sorprende, nadie va a preguntarse por que. Si no habia alternativa real, no hay nada que registrar mas alla de "hicimos lo obvio".

### Que califica

- **Forma arquitectonica.** "Monorepo." "Write model event-sourced, read model proyectado a Postgres."
- **Patrones de integracion entre contextos.** "Ordering y Billing se comunican por eventos de dominio, no HTTP sincronico."
- **Elecciones de tecnologia con lock-in.** Base de datos, message bus, proveedor de auth, target de deploy. No cada libreria; solo las que llevaria un trimestre cambiar.
- **Decisiones de limites y alcance.** "Los datos de Customer los posee el contexto Customer; los demas referencian por ID." Los "no" explicitos valen tanto como los "si".
- **Desvios deliberados del camino obvio.** "SQL a mano en vez de ORM porque X." Cualquier cosa donde un lector razonable asumiria lo contrario; evita que el proximo dev lo "arregle".
- **Restricciones invisibles en el codigo.** "No podemos usar AWS por compliance." "Respuestas bajo 200ms por contrato con el partner."
- **Alternativas rechazadas por razones no obvias.** Si se considero GraphQL y se eligio REST por razones sutiles, registrarlo; o alguien lo vuelve a proponer en seis meses.

### Que NO califica

- **Eleccion de libreria sin lock-in.** "axios vs fetch", "zod para validacion"; reversible en una tarde.
- **Convenciones de codigo o estilo.** Van en el linter o en AGENTS.md, no en ADRs.
- **Decisiones que siguen el camino obvio.** Nadie va a preguntarse por que.
- **El registro de que se hizo.** Para eso esta el git log.
- **Decisiones de implementacion local.** Como se estructura una funcion o un modulo interno; eso lo cuenta el propio codigo.
