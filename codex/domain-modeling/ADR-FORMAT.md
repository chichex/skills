# Formato de ADR

Los ADRs viven en `docs/adr/` y usan numeración secuencial: `0001-slug.md`, `0002-slug.md`, etc. Creá el directorio solo al aprobarse el primer ADR y respetá la regla de contaminación cero de [SKILL.md](./SKILL.md).

## Plantilla mínima

```md
# {Título corto de la decisión}

{Una a tres oraciones: contexto, decisión y motivo.}
```

Eso suele ser suficiente. El valor está en registrar qué se decidió y por qué, no en completar secciones ceremoniales.

## Secciones opcionales

Agregalas solo cuando aporten valor real:

- frontmatter `status: proposed | accepted | deprecated | superseded by ADR-NNNN`;
- **Considered Options**, si las alternativas rechazadas merecen preservarse;
- **Consequences**, si existen efectos downstream no obvios.

## Numeración y escritura

1. Escaneá `docs/adr/` por el número más alto.
2. Proponé el siguiente número y un slug breve.
3. Mostrá ruta, criterios y borrador completo antes de pedir aprobación.
4. Después del OK, volvé a escanear para evitar colisiones y escribí el archivo.

## Cuándo ofrecer un ADR

Las tres condiciones son obligatorias:

1. **Difícil de revertir**: cambiar de opinión tiene costo real.
2. **Sorprendente sin contexto**: un lector futuro preguntaría por qué se hizo así.
3. **Trade-off real**: había alternativas genuinas y una fue descartada por motivos específicos.

Ejemplos que suelen calificar:

- forma arquitectónica o límites entre contextos;
- integración asincrónica versus sincrónica;
- tecnología con lock-in y migración costosa;
- ownership de datos;
- desvíos deliberados del camino obvio;
- restricciones relevantes invisibles en el código;
- alternativas rechazadas por razones no obvias.

Ejemplos que normalmente no califican:

- librería reemplazable en poco tiempo;
- estilo o convención de código;
- decisiones obvias sin alternativa real;
- registro de lo implementado;
- estructura local de una función o módulo.
