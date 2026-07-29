---
name: tdd
description: Test-driven development. Usar cuando el usuario quiere construir features o arreglar bugs test-first, menciona "red-green-refactor" o "rojo-verde", o quiere tests de integración.
---

# Test-Driven Development

TDD es el loop rojo → verde. Este skill es la referencia que hace que ese loop produzca tests que valen la pena conservar: qué es un buen test, dónde van los tests, los anti-patrones, y las reglas del loop. Cada sección aplica en cada ciclo — consultarlas antes y durante el loop, no después.

Al explorar el codebase, leer `CONTEXT.md` (si existe) para que los nombres de tests y el vocabulario de interfaces usen el lenguaje del dominio del proyecto, y respetar los ADRs del área que se toca.

## Qué es un buen test

Los tests verifican comportamiento a través de interfaces públicas, no detalles de implementación. El código puede cambiar por completo; los tests no deberían. Un buen test se lee como una especificación — "user can checkout with valid cart" dice exactamente qué capacidad existe — y sobrevive refactors porque no le importa la estructura interna.

Ver [tests.md](./tests.md) para ejemplos y [mocking.md](./mocking.md) para las reglas de mocking.

## Seams — dónde van los tests

Un **seam** es el límite público donde se testea: la interfaz donde se observa comportamiento sin meter la mano adentro. Los tests viven en seams, nunca contra internals.

**Testear solo en seams pre-acordados.** Antes de escribir cualquier test, anotar los seams bajo prueba y confirmarlos con el usuario. No se escribe ningún test en un seam no confirmado. No se puede testear todo — acordar los seams de antemano es lo que hace que el esfuerzo de testing caiga sobre los caminos críticos y la lógica compleja, no sobre cada caso borde.

Preguntar: "¿Cuál es la interfaz pública, y qué seams testeamos?"

## Anti-patrones

- **Acoplado a la implementación** — mockea colaboradores internos, testea métodos privados, o verifica por un canal lateral (consultar la base de datos en vez de usar la interfaz). La señal: el test se rompe al refactorizar aunque el comportamiento no cambió.
- **Tautológico** — la aserción recomputa el valor esperado igual que lo computa el código (`expect(add(a, b)).toBe(a + b)`, un snapshot derivado a mano de la misma forma, una constante comparada consigo misma), así que pasa por construcción y nunca puede estar en desacuerdo con el código. Los valores esperados salen de una fuente de verdad independiente — un literal conocido-bueno, un ejemplo trabajado, la spec.
- **Slicing horizontal** — escribir todos los tests primero y toda la implementación después. Los tests en bloque verifican comportamiento *imaginado*: testean la *forma* de las cosas en vez del comportamiento observable, se vuelven insensibles a cambios reales, y comprometen la estructura de los tests antes de entender la implementación. Trabajar en **slices verticales**: un test → una implementación → repetir, cada test un **tracer bullet** que responde a lo que enseñó el ciclo anterior.

## Reglas del loop

- **Rojo antes que verde.** Escribir el test que falla primero, después solo el código suficiente para que pase. No anticipar tests futuros ni agregar features especulativas.
- **Una slice a la vez.** Un seam, un test, una implementación mínima por ciclo.
- **El refactor no es parte del loop.** Pertenece a la etapa de review (ej. `/code-review`, `/simplify`), no al ciclo rojo → verde de implementación.
