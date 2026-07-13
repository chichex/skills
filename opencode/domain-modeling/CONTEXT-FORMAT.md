# Formato de CONTEXT.md

## Estructura

```md
# {Nombre del contexto}

{Una o dos oraciones: que es este contexto y por que existe.}

## Language

**Order**:
{Descripcion del termino en una o dos oraciones}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

## Reglas

- **Ser opinado.** Cuando existen varias palabras para el mismo concepto, elegir la mejor y listar las otras bajo `_Avoid_`.
- **Definiciones apretadas.** Una o dos oraciones maximo. Definir que ES, no que hace.
- **Solo terminos especificos del dominio de este proyecto.** Conceptos generales de programacion (timeouts, tipos de error, patrones utilitarios) no van, aunque el proyecto los use mucho. Antes de agregar un termino, preguntarse: es un concepto unico de este contexto, o un concepto general de programacion? Solo el primero entra.
- **Agrupar bajo subheadings** cuando emergen clusters naturales. Si todo pertenece a un area cohesiva, lista plana.

## Repos de contexto unico vs multiple

**Contexto unico (la mayoria):** un `CONTEXT.md` en la raiz del repo.

**Multiples contextos:** un `CONTEXT-MAP.md` en la raiz lista los contextos, donde viven y como se relacionan:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) - recibe y trackea pedidos de clientes
- [Billing](./src/billing/CONTEXT.md) - genera facturas y procesa pagos

## Relationships

- **Ordering => Billing**: Ordering emite eventos `OrderPlaced`; Billing los consume para facturar
```

Inferir cual estructura aplica:

- Si existe `CONTEXT-MAP.md`, leerlo para encontrar los contextos.
- Si solo existe un `CONTEXT.md` en la raiz, contexto unico.
- Si no existe ninguno, aplicar la regla de contaminacion cero de [SKILL.md](./SKILL.md) antes de crear nada.

Con multiples contextos, inferir a cual pertenece el tema actual. Si no esta claro, preguntar.
