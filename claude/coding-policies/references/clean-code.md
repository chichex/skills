---
# Mantenimiento: editar solo shared/coding-policies/references/clean-code.md y ejecutar `node scripts/sync-coding-policies-references.mjs`.
stack: clean-code
name: Clean Code y SOLID
version: 2026-09-14
---

### Responsabilidad única y cohesión

- **MUST** Aplicar SRP haciendo que cada función, componente, clase o módulo tenga una sola razón principal para cambiar y responda a un actor o grupo estrechamente relacionado. Porqué: "hacer una sola cosa" sin nombrar quién pide el cambio confunde pasos de una misma responsabilidad con responsabilidades realmente distintas. Gate: `revisión de diseño` que pueda describir responsabilidad y actor en una oración
- **MUST** Mantener juntas las partes que cambian por la misma razón y separar las que cambian por razones distintas. Porqué: SRP busca alta cohesión y bajo acoplamiento, no la mayor cantidad posible de archivos o funciones. Gate: `revisión del diff` y del historial de cambios relacionados
- **MUST** Separar decisiones de dominio, presentación, persistencia e integración cuando tengan actores, ritmos de cambio o contratos distintos; una función de orquestación puede coordinarlas sin implementar todas sus políticas. Porqué: coordinar colaboradores es una responsabilidad válida, mientras absorber sus detalles crea una unidad con múltiples motivos de cambio. Gate: `tests de contratos` en las fronteras identificadas
- **SHOULD** Usar cambios históricos, vocabulario, setup de tests y dependencias como evidencia de responsabilidades mezcladas antes de extraer. Porqué: una división fundada en señales reales conserva mejor la cohesión que una basada únicamente en la forma actual del código. Gate: `git log -- <archivo>` más revisión de imports y fixtures

### Tamaño como señal, no como objetivo

- **MUST** Tratar líneas, complejidad, anidamiento y cantidad de parámetros como detectores de humo, nunca como prueba suficiente de buen o mal diseño. Porqué: una unidad corta puede mezclar responsabilidades y una unidad larga puede ser una tabla declarativa perfectamente cohesionada. Gate: `revisión de responsabilidad y cohesión` junto con las métricas
- **MUST** Medir líneas lógicas con una convención estable que excluya líneas vacías y comentarios, y distinguir código ejecutable de datos o markup declarativo. Porqué: cambiar la forma de contar vuelve incomparables los umbrales y penaliza documentación o formato sin reducir complejidad. Gate: configuración versionada de `ESLint`, `detekt`, `golangci-lint` o herramienta equivalente ya adoptada
- **SHOULD** Considerar hasta 40 líneas lógicas como zona saludable habitual para una función, método o lógica ejecutable de un componente, sin exigir que toda unidad llegue a ese tamaño. Porqué: coincide con el punto de revisión de guías conservadoras y mantiene visible la intención sin promover microfunciones. Gate: `max-lines-per-function`, `LongMethod` o `funlen` configurado como advertencia
- **SHOULD** Tratar entre 41 y 60 líneas lógicas como señal de revisión, no como infracción automática. Porqué: ese rango coincide con defaults comunes de linters, pero todavía puede representar un algoritmo o flujo cohesivo cuya fragmentación empeore la lectura. Gate: `review del PR` asistido por la métrica del stack

### Funciones y métodos

- **MUST** Cuando una función, método o lógica ejecutable de componente tenga más de 60 líneas lógicas, evaluar su responsabilidad, complejidad y posibilidades de extracción; dividirla o documentar por qué mantener cohesión y localidad resulta más claro. Porqué: superar el rango usado por varios linters merece una decisión explícita, no un rechazo mecánico. Gate: `ESLint max-lines-per-function`, `detekt LongMethod` o `golangci-lint funlen` más justificación en el review
- **MUST** Mantener cada función en un nivel de abstracción reconocible y darle un nombre que exprese intención, sin mezclar orquestación de alto nivel con detalles incidentales extensos. Porqué: el lector debe entender primero qué ocurre y profundizar solo donde necesite saber cómo. Gate: `revisión de nombres y flujo` del caller y la función
- **SHOULD** Mantener la complejidad ciclomática en 10 o menos, tratar de 11 a 15 como señal y exigir revisión explícita por encima de 15, eligiendo guard clauses, tablas o extracción solo cuando aclaren el contrato. Porqué: más caminos independientes aumentan combinaciones y costo de prueba, pero reducir el número sin mejorar el modelo solo desplaza la complejidad. Gate: `ESLint complexity`, `detekt CyclomaticComplexMethod` o `golangci-lint cyclop`
- **SHOULD** Mantener el anidamiento en profundidad 3 o menos, tratar profundidad 4 como señal y revisar obligatoriamente cuando supere 4. Porqué: cada nivel agrega contexto simultáneo, aunque extraer bloques triviales puede ocultar el flujo en vez de simplificarlo. Gate: `ESLint max-depth`, `detekt NestedBlockDepth` o equivalente del stack
- **SHOULD** Preferir hasta 3 parámetros, tratar de 4 a 5 como señal y revisar más de 5, sin reemplazarlos mecánicamente por un objeto bolsa con campos no relacionados. Porqué: muchos parámetros suelen revelar responsabilidades o conceptos ausentes, pero agruparlos sin cohesión solo esconde la misma complejidad. Gate: `ESLint max-params`, `detekt LongParameterList` o revisión equivalente

### Componentes y UI

- **MUST** Dar a cada componente una responsabilidad de interfaz identificable y separar regiones que tengan estado, efectos, permisos, ciclos de carga o actores independientes. Porqué: un componente deja de ser cohesivo cuando cambios visuales sin relación pueden romper flujos y dependencias ajenos. Gate: `tests de componente` y revisión del ownership de estado y efectos
- **MUST** Aplicar los umbrales de función a la lógica ejecutable del componente, pero no usar la cantidad de JSX, Compose o markup declarativo como motivo único de extracción. Porqué: el markup puede ser largo y lineal sin agregar caminos ni responsabilidades, mientras pocas líneas con varios efectos pueden ser complejas. Gate: `revisión separada de lógica y markup` más linter del stack
- **SHOULD** Extraer un subcomponente cuando represente una región con nombre de dominio, semántica accesible, contrato de props, comportamiento testeable o reutilización real. Porqué: esas fronteras permiten razonar en aislamiento; cortar fragmentos arbitrarios solo agrega navegación y props. Gate: `tests por comportamiento` y revisión del árbol de componentes
- **MUST** Crear un custom Hook, presenter o componente auxiliar solo cuando encapsule una responsabilidad cohesiva; no mover líneas a un wrapper pasante para cumplir una métrica. Porqué: trasladar código sin reducir conocimiento compartido conserva la complejidad y suma una indirección. Gate: `review del contrato extraído` y de sus dependencias

### Archivos, clases y módulos

- **SHOULD** Considerar hasta 300 líneas lógicas como zona saludable habitual para archivos, clases o módulos escritos a mano. Porqué: coincide con un default extendido de lint y deja espacio para una unidad completa sin convertir cada concepto pequeño en un archivo. Gate: `ESLint max-lines`, `detekt LargeClass` o contador equivalente configurado como advertencia
- **SHOULD** Tratar entre 301 y 600 líneas lógicas como señal para revisar cohesión, superficie pública, dependencias y frecuencia de cambios, no como orden automática de dividir. Porqué: el tamaño intermedio puede indicar responsabilidades acumuladas o simplemente código declarativo que gana claridad al permanecer junto. Gate: `review del PR` con métrica y mapa de exports
- **MUST** Ante más de 600 líneas lógicas escritas a mano, tomar una decisión explícita de descomposición o justificar por qué una unidad cohesionada es más segura; código generado y grandes tablas declarativas se evalúan por su fuente y contrato. Porqué: a esa escala la navegación y el riesgo de mezclar cambios ameritan evidencia, pero una partición artificial también tiene costo. Gate: `revisión de arquitectura` registrada en el PR o excepción versionada del linter
- **MUST** Dividir un archivo o módulo cuando su API pública agrupe conceptos sin relación o cuando cambios de actores distintos lo modifiquen repetidamente, aunque todavía esté debajo del umbral de líneas. Porqué: SRP es una regla de cambio y cohesión, no una recompensa por archivos cortos. Gate: `git log -- <archivo>` más revisión de exports y consumidores

### SOLID sin ceremonia

- **MUST** Aplicar SRP como criterio de cohesión y razón de cambio, no como mandato de que cada unidad ejecute un único paso técnico. Porqué: una operación de negocio puede requerir varios pasos coordinados y seguir respondiendo a un solo actor. Gate: `revisión de responsabilidad` con actor, contrato e invariantes
- **SHOULD** Aplicar OCP creando puntos de extensión solo cuando exista variación observada o exigida por el contrato. Porqué: diseñar para todas las variantes imaginables produce abstracciones especulativas más difíciles de cambiar que el código directo. Gate: `tests de variantes` existentes o requisito que justifique la extensión
- **SHOULD** Aplicar LSP exigiendo que toda implementación sustituible preserve precondiciones, resultados, invariantes, errores y efectos observables del contrato. Porqué: compartir una interfaz o herencia no garantiza que los consumidores puedan reemplazar una implementación sin sorpresas. Gate: `contract tests` ejecutados contra cada implementación
- **SHOULD** Aplicar ISP definiendo interfaces desde las necesidades de sus consumidores y separándolas cuando obliguen a depender de operaciones ajenas. Porqué: contratos amplios aumentan acoplamiento, pero interfaces de un solo método sin consumidores distintos pueden ser ceremonia. Gate: `revisión de consumidores` y fakes de tests
- **SHOULD** Aplicar DIP haciendo que la política de alto nivel dependa de contratos estables e inyectando I/O, tiempo, azar, red y persistencia en sus fronteras volátiles. Porqué: aislar detalles cambiantes mejora pruebas y reemplazo sin invertir cada dependencia interna. Gate: `tests deterministas` con adapters reales cubiertos en integración
- **SHOULD** Evitar una interfaz, factory o capa por cada clase cuando no exista sustitución, frontera volátil ni consumidor que la necesite. Porqué: SOLID reduce acoplamiento útil; aplicado como plantilla multiplica archivos y saltos sin proteger ningún cambio real. Gate: `review de abstracciones` que nombre al menos una variación o frontera concreta

### Extracción sin sobre-split

- **MUST** Nunca extraer una unidad solo para reducir LOC; la extracción debe revelar intención, aislar una responsabilidad, reducir complejidad o establecer un contrato útil. Porqué: satisfacer una cifra sin mejorar comprensión convierte una función larga en una cadena de saltos. Gate: `review del antes y después` con el beneficio nombrado
- **MUST** Dar a toda unidad extraída un nombre específico del dominio o de la intención y entradas, salidas y efectos acotados. Porqué: nombres como `handlePart`, `processData` o `helper` desplazan líneas pero no explican responsabilidades. Gate: `revisión de nombres y firma` más tests del contrato
- **MUST** Preservar localidad cuando varios pasos comparten una invariante, orden o estado y se entienden mejor de forma secuencial. Porqué: dispersar un flujo cohesivo entre muchos archivos obliga al lector a reconstruir contexto sin reducir el conocimiento necesario. Gate: `review de navegación` desde el entry point hasta el resultado
- **SHOULD** Evitar wrappers pasantes, microarchivos y cadenas de funciones de una sola llamada salvo que marquen una frontera estable, mejoren el lenguaje o habiliten sustitución y tests. Porqué: cada indirección tiene costo cognitivo y debe comprar una separación verificable. Gate: `grafo de llamadas` o revisión de callers y contratos

### Adopción y excepciones

- **MUST** Respetar los límites y herramientas que el repositorio ya adoptó y no reconfigurarlos incidentalmente para cerrar una tarea. Porqué: los umbrales son una decisión de equipo y cambiarlos mezcla política global con comportamiento funcional. Gate: `git diff` de configuración de lint y CI
- **SHOULD** En proyectos sin métricas, introducir estos umbrales primero como warnings o revisión sobre código nuevo y endurecerlos solo con una baseline y acuerdo explícitos. Porqué: activar errores globales de una vez genera churn y refactors masivos sin relación con el cambio. Gate: `CI` con baseline o ratchet de archivos modificados
- **MUST** Acotar excepciones de tamaño a código generado, migraciones, fixtures o snapshots extensos, tablas declarativas y adapters mecánicos cuando dividirlos empeore trazabilidad; los tests no quedan exentos por categoría. Porqué: una excepción basada en naturaleza del contenido es revisable, mientras excluir carpetas enteras oculta lógica compleja. Gate: ignore específico en `ESLint`, `detekt`, `golangci-lint` o herramienta equivalente con motivo
- **MUST** Documentar toda supresión con alcance mínimo y razón concreta, y volver a evaluarla cuando cambie la responsabilidad de la unidad. Porqué: una excepción silenciosa se convierte en permiso permanente para acumular complejidad. Gate: `review de suppressions` y configuración versionada

### Lectura ampliada

- [Google C++ Style Guide: Write Short Functions](https://google.github.io/styleguide/cppguide.html#Write_Short_Functions) — recomienda funciones pequeñas y enfocadas, pero rechaza un límite duro y pide no dañar la estructura al dividir.
- [ESLint: max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function) — regla configurable con default de 50 líneas por función.
- [ESLint: max-lines](https://eslint.org/docs/latest/rules/max-lines) — regla configurable con default de 300 líneas por archivo.
- [ESLint: complexity](https://eslint.org/docs/latest/rules/complexity) — medición configurable de complejidad ciclomática.
- [ESLint: max-depth](https://eslint.org/docs/latest/rules/max-depth) — profundidad máxima configurable, con default 4.
- [ESLint: max-params](https://eslint.org/docs/latest/rules/max-params) — cantidad máxima configurable, con default 3.
- [Detekt: Complexity Rule Set](https://detekt.dev/docs/rules/complexity/) — defaults para métodos largos, clases grandes, parámetros y complejidad en Kotlin.
- [golangci-lint: configuración de linters](https://golangci-lint.run/docs/linters/configuration/#funlen) — defaults de `funlen` y `cyclop` para Go.
- [React: Thinking in React](https://react.dev/learn/thinking-in-react) — separación de componentes por responsabilidad y crecimiento.
- [Martin Fowler: Function Length](https://martinfowler.com/bliki/FunctionLength.html) — extracción guiada por intención frente a implementación, no por una cifra aislada.
- [Refactoring: Extract Function](https://refactoring.com/catalog/extractFunction.html) — mecánica y motivación de una extracción con nombre significativo.
- [Robert C. Martin: The Single Responsibility Principle](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html) — razón de cambio, actores, cohesión y separación de responsabilidades.
- [Robert C. Martin: SOLID Relevance](https://blog.cleancoder.com/uncle-bob/2020/10/18/Solid-Relevance.html) — alcance de los cinco principios y su aplicación a diseño y arquitectura.
