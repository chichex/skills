---
name: tdd
description: Test-driven development. Usar cuando el usuario quiere construir features o arreglar bugs test-first, menciona "red-green-refactor" o "rojo-verde", o quiere tests de integracion.
---

# Test-Driven Development

TDD es el loop rojo => verde. Este skill es la referencia que hace que ese loop produzca tests que valen la pena conservar: que es un buen test, donde van los tests, los anti-patrones, y las reglas del loop. Cada seccion aplica en cada ciclo; consultarlas antes y durante el loop, no despues.

Al explorar el codebase, leer `CONTEXT.md` (si existe) para que los nombres de tests y el vocabulario de interfaces usen el lenguaje del dominio del proyecto, y respetar los ADRs del area que se toca.

## Que es un buen test

Los tests verifican comportamiento a traves de interfaces publicas, no detalles de implementacion. El codigo puede cambiar por completo; los tests no deberian. Un buen test se lee como una especificacion ("user can checkout with valid cart" dice exactamente que capacidad existe) y sobrevive refactors porque no le importa la estructura interna.

Ver [tests.md](./tests.md) para ejemplos y [mocking.md](./mocking.md) para las reglas de mocking.

## Seams: donde van los tests

Un **seam** es el limite publico donde se testea: la interfaz donde se observa comportamiento sin meter la mano adentro. Los tests viven en seams, nunca contra internals.

**Testear solo en seams pre-acordados.** Antes de escribir cualquier test, anotar los seams bajo prueba y confirmarlos con el usuario. No se escribe ningun test en un seam no confirmado. No se puede testear todo: acordar los seams de antemano es lo que hace que el esfuerzo de testing caiga sobre los caminos criticos y la logica compleja, no sobre cada caso borde.

Preguntar: "Cual es la interfaz publica, y que seams testeamos?"

## Anti-patrones

- **Acoplado a la implementacion**: mockea colaboradores internos, testea metodos privados, o verifica por un canal lateral (consultar la base de datos en vez de usar la interfaz). La senal: el test se rompe al refactorizar aunque el comportamiento no cambio.
- **Tautologico**: la asercion recomputa el valor esperado igual que lo computa el codigo (`expect(add(a, b)).toBe(a + b)`, un snapshot derivado a mano de la misma forma, una constante comparada consigo misma), asi que pasa por construccion y nunca puede estar en desacuerdo con el codigo. Los valores esperados salen de una fuente de verdad independiente: un literal conocido-bueno, un ejemplo trabajado, la spec.
- **Slicing horizontal**: escribir todos los tests primero y toda la implementacion despues. Los tests en bloque verifican comportamiento *imaginado*: testean la *forma* de las cosas en vez del comportamiento observable, se vuelven insensibles a cambios reales, y comprometen la estructura de los tests antes de entender la implementacion. Trabajar en **slices verticales**: un test => una implementacion => repetir, cada test un **tracer bullet** que responde a lo que enseno el ciclo anterior.

## Reglas del loop

- **Rojo antes que verde.** Escribir el test que falla primero, despues solo el codigo suficiente para que pase. No anticipar tests futuros ni agregar features especulativas.
- **Una slice a la vez.** Un seam, un test, una implementacion minima por ciclo.
- **El refactor no es parte del loop.** Pertenece a la etapa de review, no al ciclo rojo => verde de implementacion.
