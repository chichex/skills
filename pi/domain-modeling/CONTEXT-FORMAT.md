# Formato de CONTEXT.md

## Estructura

```md
# {Nombre del contexto}

{Una o dos oraciones: qué es este contexto y por qué existe.}

## Language

**Order**:
{Definición del término en una o dos oraciones.}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

## Reglas

- **Ser opinado.** Si varias palabras nombran el mismo concepto, elegir una como canónica y listar las otras bajo `_Avoid_`.
- **Definiciones ajustadas.** Una o dos oraciones como máximo. Definir qué es el concepto, no cómo se implementa.
- **Solo lenguaje específico del dominio.** Conceptos generales de programación no entran aunque el proyecto los use mucho.
- **Agrupar bajo subtítulos** solo cuando emerjan grupos naturales. Si todo pertenece a un área cohesiva, usar una lista plana.
- **Preservar el estilo existente.** En un archivo existente, priorizar su estructura e idioma sobre esta plantilla.

Antes de agregar un término, preguntar: ¿es propio de este dominio o un concepto general de software? Solo el primero pertenece al glosario.

## Contexto único o múltiples contextos

### Contexto único

La mayoría de los repos usan un `CONTEXT.md` en la raíz.

### Múltiples contextos

Un `CONTEXT-MAP.md` en la raíz enumera contextos, ubicación y relaciones:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — recibe y sigue pedidos de clientes
- [Billing](./src/billing/CONTEXT.md) — genera facturas y procesa pagos

## Relationships

- **Ordering → Billing**: Ordering emite `OrderPlaced`; Billing lo consume para facturar
```

Reglas de ubicación:

1. Si existe `CONTEXT-MAP.md`, leerlo y usar el contexto indicado.
2. Si solo existe un `CONTEXT.md` raíz, tratarlo como contexto único.
3. Si no existe ninguno, respetar la regla de contaminación cero de [SKILL.md](./SKILL.md).
4. Si hay múltiples contextos y el destino no es inequívoco, pedir al usuario una única decisión antes de escribir.
