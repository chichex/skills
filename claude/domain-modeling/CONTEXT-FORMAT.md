# Formato de CONTEXT.md

## Estructura

```md
# {Nombre del contexto}

{Una o dos oraciones: qué es este contexto y por qué existe.}

## Language

**Order**:
{Descripción del término en una o dos oraciones}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

## Reglas

- **Ser opinado.** Cuando existen varias palabras para el mismo concepto, elegir la mejor y listar las otras bajo `_Avoid_`.
- **Definiciones apretadas.** Una o dos oraciones máximo. Definir qué ES, no qué hace.
- **Solo términos específicos del dominio de este proyecto.** Conceptos generales de programación (timeouts, tipos de error, patrones utilitarios) no van, aunque el proyecto los use mucho. Antes de agregar un término, preguntarse: ¿es un concepto único de este contexto, o un concepto general de programación? Solo el primero entra.
- **Agrupar bajo subheadings** cuando emergen clusters naturales. Si todo pertenece a un área cohesiva, lista plana.

## Repos de contexto único vs múltiple

**Contexto único (la mayoría):** un `CONTEXT.md` en la raíz del repo.

**Múltiples contextos:** un `CONTEXT-MAP.md` en la raíz lista los contextos, dónde viven y cómo se relacionan:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — recibe y trackea pedidos de clientes
- [Billing](./src/billing/CONTEXT.md) — genera facturas y procesa pagos

## Relationships

- **Ordering → Billing**: Ordering emite eventos `OrderPlaced`; Billing los consume para facturar
```

Inferir cuál estructura aplica:

- Si existe `CONTEXT-MAP.md`, leerlo para encontrar los contextos.
- Si solo existe un `CONTEXT.md` en la raíz, contexto único.
- Si no existe ninguno, aplicar la regla de contaminación cero de [SKILL.md](./SKILL.md) antes de crear nada.

Con múltiples contextos, inferir a cuál pertenece el tema actual. Si no está claro, preguntar.
