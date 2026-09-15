---
# Mantenimiento: editar solo shared/coding-policies/references/kotlin-multiplatform.md y ejecutar `node scripts/sync-coding-policies-references.mjs`.
stack: kotlin-multiplatform
name: Kotlin Multiplatform
version: 2026-09-14
---

### Alcance y estructura

- **MUST** Antes de editar, identificar versiones de Kotlin y KMP, plugins, Gradle, AGP, JDK y Xcode, los targets efectivos y si el proyecto comparte lógica, UI o ambas. Porqué: estructura, DSL y compatibilidad cambian según las herramientas y la estrategia de producto reales. Gate: —
- **MUST** Tratar compartir UI con Compose Multiplatform como una decisión explícita; KMP por sí solo no obliga a reemplazar interfaces nativas. Porqué: compartir lógica y compartir UI tienen consumidores, dependencias y ciclos de vida distintos. Gate: revisión de módulos y plugins de `Compose Multiplatform`
- **MUST** Mantener separados los entrypoints de cada aplicación y el código compartido, adaptando la estructura al plugin Android y a la versión de AGP instalada. Porqué: cada plataforma conserva su arranque y AGP 9 o posterior exige límites Android distintos. Gate: `build de cada entrypoint soportado`
- **SHOULD** Crear módulos adicionales solo por un límite o consumidor concreto, no por replicar capas de una plantilla. Porqué: una red ceremonial de módulos aumenta configuración y dependencias sin mejorar el aislamiento. Gate: —

### Build, versiones y targets

- **MUST** Consultar la matriz compatible de Kotlin/KMP, Gradle, AGP, JDK y Xcode antes de cambiar el build. Porqué: que cada versión exista no significa que la combinación esté soportada. Gate: `./gradlew --version` más guía de compatibilidad de KMP
- **MUST** Conservar el Gradle wrapper, version catalogs y mecanismo de versiones del repo; no regenerarlos para ocultar una incompatibilidad. Porqué: son parte del build reproducible y coordinan plugins y dependencias. Gate: `git diff -- gradle gradle.properties settings.gradle* build.gradle*`
- **MUST** Adaptar plugins y DSL a las versiones instaladas en vez de copiar un bloque Gradle genérico. Porqué: la configuración Android y multiplataforma evoluciona y ejemplos de otra generación pueden compilar distinto o estar deprecados. Gate: `./gradlew help` y tareas de compilación pertinentes
- **MUST** Revisar targets, simuladores y arquitecturas antes de agregar, retirar o actualizar uno; una migración corresponde al salto solicitado, no a la plantilla más reciente. Porqué: cambiar targets altera artefactos, CI y consumidores reales. Gate: `listado de targets más build de cada arquitectura soportada`

### Source sets y dependencias

- **MUST** Preferir la jerarquía predeterminada que Gradle deriva de los targets. Porqué: mantiene relaciones consistentes entre source sets y evita grafos manuales que desactiven el template común. Gate: `./gradlew tasks` más compilación de los targets
- **MUST** Ubicar código en el source set más amplio cuyos targets soporten todas las APIs utilizadas, usando intermedios como `iosMain` cuando corresponda. Porqué: duplicar implementación por target pierde reutilización, pero subir una API incompatible a `commonMain` rompe otros targets. Gate: `compilación de todos los source sets consumidores`
- **MUST** No agregar relaciones `dependsOn` manuales de rutina; extender la jerarquía mediante el mecanismo recomendado cuando haga falta un grupo nuevo. Porqué: un enlace manual puede impedir que se aplique la jerarquía predeterminada. Gate: revisión de `dependsOn` y reporte de source sets
- **MUST** Declarar en `commonMain` solo dependencias compatibles con todos sus targets y mantener APIs JVM o Android fuera del código común. Porqué: Gradle selecciona variantes por target y una librería específica invalida la promesa multiplataforma. Gate: `compilación de metadata común y de cada target`
- **MUST** Declarar dependencias de tests en sus source sets y preferir el artefacto multiplataforma base cuando Gradle pueda elegir variantes. Porqué: una coordenada específica de plataforma puede hacer pasar un target y dejar otro sin implementación. Gate: `tareas de tests y resolución de dependencias por target`

### Límites de plataforma

- **MUST** Revisar primero las bibliotecas multiplataforma existentes antes de escribir un adapter propio. Porqué: un adapter suma contrato, implementaciones, fakes y mantenimiento para cada target. Gate: `revisión de dependencias y APIs disponibles`
- **SHOULD** Para integraciones complejas, definir una interfaz común e inyectar implementaciones específicas; usar factories o `expect`/`actual` cuando expresen mejor un límite pequeño. Porqué: el contrato queda testeable sin imponer un único mecanismo a toda frontera. Gate: `tests comunes con fake y compilación de implementaciones reales`
- **MUST** Mantener cada declaración `expect` y `actual` en el mismo paquete y con contrato coincidente, y proveer implementación para todo target consumidor. Porqué: una ausencia o divergencia deja el API común sin respaldo ejecutable. Gate: `compilación de todos los targets declarados`
- **MUST** No convertir interfaces rutinarias en clases `expect`/`actual` sin una razón específica; tratarlas como Beta mientras así figure en la versión consultada. Porqué: las clases esperadas siguen teniendo restricciones distintas del mecanismo general de KMP. Gate: `documentación de versión y revisión del API común`

### Coroutines y cancelación

- **MUST** Dar a cada coroutine un scope con dueño y ciclo de vida claros, preservando concurrencia estructurada, errores y cancelación. Porqué: trabajo sin propietario sobrevive a la pantalla o request que lo inició y filtra recursos. Gate: `tests de cancelación y revisión del scope`
- **MUST** No usar `runBlocking` en el hilo de UI para llamar código suspendido. Porqué: bloquea eventos y puede congelar la aplicación o provocar deadlocks. Gate: `detekt` con regla de coroutines o búsqueda revisada de `runBlocking`
- **MUST** Hacer cooperativo todo cálculo prolongado mediante suspensión, `yield` o comprobación de cancelación. Porqué: marcar una función como `suspend` no vuelve interrumpible el trabajo CPU-bound por sí solo. Gate: `test de cancelación bajo carga`
- **MUST** Relanzar `CancellationException` y revisar helpers que capturen excepciones amplias. Porqué: convertir cancelación en éxito o error de negocio rompe el lifecycle y mantiene trabajo que debía terminar. Gate: `detekt` o tests que cancelen dentro del bloque de manejo
- **MUST** Liberar recursos al cancelar y ejecutar trabajo bloqueante en el dispatcher apropiado para cada plataforma. Porqué: cancelación cooperativa no cierra automáticamente handles ni mueve I/O fuera del hilo actual. Gate: `tests de cleanup y verificación por target`

### Swift y Objective-C

- **MUST** Identificar si el módulo se consume mediante Objective-C interop o Swift export antes de diseñar el API público. Porqué: nombres, tipos, errores, genéricos y async se proyectan de forma distinta en cada mecanismo. Gate: `configuración del framework/export y build iOS`
- **MUST** Probar desde Swift los tipos, nombres, errores y operaciones asíncronas que consume la app. Porqué: que el código Kotlin compile no demuestra que el API exportado sea usable ni seguro para su consumidor real. Gate: `tests o compilación del consumidor Swift`
- **MUST** En la ruta Objective-C, declarar y verificar `@Throws` cuando una excepción deba cruzar la frontera; no dejar escapar excepciones no representadas. Porqué: una excepción fuera del contrato exportado puede terminar el proceso. Gate: test Swift del error y revisión de `@Throws`
- **MUST** Tratar Swift export como Alpha mientras así figure en la versión consultada, sin repetir limitaciones antiguas ni cambiar de mecanismo incidentalmente. Porqué: es una ruta distinta, con soporte que evoluciona para `suspend`, `Flow`, genéricos y tipos. Gate: `documentación de la versión instalada y prueba del framework exportado`

### Testing multiplataforma

- **MUST** Usar `kotlin.test` y dependencias compatibles en `commonTest` para el comportamiento realmente compartido. Porqué: el mismo contrato puede ejecutarse en varios targets sin acoplarse a JUnit o XCTest desde código común. Gate: `tareas de tests comunes del repo`
- **MUST** Agregar tests específicos para adapters y APIs de plataforma. Porqué: el fake común no verifica permisos, frameworks ni semántica del runtime nativo. Gate: `runner de tests de cada target afectado`
- **MUST** Ejecutar el código común en los targets relevantes; una ejecución JVM no verifica iOS, Native ni JavaScript. Porqué: compiladores, memory model e interoperabilidad pueden divergir aunque compartan fuentes. Gate: `matriz de tareas Gradle por target`
- **MUST** Distinguir tests Android de host de tests instrumentados y descubrir los nombres de tareas del proyecto antes de ejecutarlos. Porqué: una tarea copiada de otro repo puede no existir o cubrir solo una variante. Gate: `./gradlew tasks` más tareas Android seleccionadas

### Kotlin idiomático

- **SHOULD** Preferir `val`, colecciones de solo lectura, argumentos nombrados cuando aclaren y parámetros por defecto antes que overloads equivalentes. Porqué: comunica intención y reduce superficie sin imponer mutabilidad o firmas redundantes. Gate: `formatter y análisis estático del repo`
- **MUST** No confundir `val` con inmutabilidad profunda ni una interfaz de solo lectura con un objeto que nunca cambia. Porqué: la referencia puede ser estable mientras el contenido mutable sigue modificándose por otro alias. Gate: `tests de mutabilidad y revisión del tipo concreto`
- **MUST** Aplicar el formatter, convenciones y análisis estático ya adoptados; no introducir una configuración paralela por estilo. Porqué: una única fuente de formato evita churn y resultados distintos entre módulos. Gate: `ktlint`, `detekt` o tareas equivalentes del repo

### Compose Multiplatform

- **MUST** Si el proyecto usa Compose Multiplatform, verificar compatibilidad entre Compose, Kotlin, Jetpack Compose, JDK y los targets del producto. Porqué: esos componentes tienen ciclos y mínimos distintos; compatibilidad Android no garantiza iOS, desktop o web. Gate: `matriz oficial más build de cada target Compose`
- **MUST** Si el proyecto usa Compose Multiplatform, mantener el plugin de Compose Compiler en la versión requerida por el plugin Kotlin, sin igualar por intuición todas las librerías Compose. Porqué: el compilador sigue a Kotlin mientras otros artefactos pueden versionarse con otra cadencia. Gate: `configuración de plugins y compilación Compose`
- **MUST** Si el proyecto usa Compose Multiplatform, definir dueño y alcance de cada ViewModel y sus coroutines; en código común usar inicializador o factory, no reflexión JVM. Porqué: lifecycle y construcción deben funcionar en targets donde las capacidades JVM no existen. Gate: `tests de lifecycle y compilación de targets no JVM`
- **MUST** Si el proyecto usa Compose Multiplatform, integrar explícitamente lifecycle y `Dispatchers.Main` por plataforma, incluida SwiftUI si corresponde, sin agregar otro framework DI solo por compartir ViewModels. Porqué: conservar el tipo no transfiere automáticamente ownership ni disponibilidad del dispatcher. Gate: `prueba de creación, cancelación y liberación en cada UI soportada`

### Verificación

- **MUST** Descubrir y ejecutar las tareas Gradle del repo para compilación, análisis estático y tests comunes y de plataforma pertinentes. Porqué: nombres y cobertura varían por plugins, targets y variantes. Gate: `./gradlew tasks` seguido de las tareas seleccionadas
- **MUST** Compilar los targets y consumidores afectados, incluido el consumidor Swift cuando cambie el API exportado. Porqué: metadata común en verde no verifica linking, proyección de tipos ni recursos nativos. Gate: `builds de Android, iOS y demás targets alcanzados por el cambio`
- **MUST** Informar exactamente qué targets se compilaron y probaron y cuáles quedaron sin ejecutar, sin llamar multiplataforma a una verificación solo JVM. Porqué: la evidencia debe mostrar qué plataformas respaldan la conclusión. Gate: `reporte final` con tarea, target y resultado

### Lectura ampliada

- [KMP: Recommended project structure](https://kotlinlang.org/docs/multiplatform/multiplatform-project-recommended-structure.html) — separación de entrypoints, lógica y UI compartidas.
- [KMP: Compatibility guide](https://kotlinlang.org/docs/multiplatform/multiplatform-compatibility-guide.html) — matriz de Kotlin, Gradle, AGP y Xcode.
- [KMP: Hierarchical project structure](https://kotlinlang.org/docs/multiplatform/multiplatform-hierarchy.html) — template de jerarquía y source sets intermedios.
- [KMP: Adding dependencies](https://kotlinlang.org/docs/multiplatform/multiplatform-add-dependencies.html) — variantes y dependencias por source set.
- [KMP: Platform-specific APIs](https://kotlinlang.org/docs/multiplatform/multiplatform-connect-to-apis.html) — interfaces, factories y adapters.
- [KMP: Expected and actual declarations](https://kotlinlang.org/docs/multiplatform/multiplatform-expect-actual.html) — contratos y estabilidad de `expect`/`actual`.
- [Kotlin coroutines: Cancellation and timeouts](https://kotlinlang.org/docs/coroutines-cancellation.html) — cooperación, cleanup y `CancellationException`.
- [Kotlin/Native: Swift and Objective-C interoperability](https://kotlinlang.org/docs/native-objc-interop.html) — mapeo de APIs y excepciones.
- [Kotlin: Swift export](https://kotlinlang.org/docs/native-swift-export.html) — integración y restricciones de la ruta de exportación.
- [KMP: Run tests](https://kotlinlang.org/docs/multiplatform/multiplatform-run-tests.html) — tests comunes y tareas por target.
- [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html) — estilo idiomático y formato.
- [KMP: Compose compatibility](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html) — versiones y mínimos por plataforma.
- [KMP: Multiplatform ViewModel](https://kotlinlang.org/docs/multiplatform/compose-viewmodel.html) — construcción y ownership sin reflexión JVM.
- [KMP: Multiplatform lifecycle](https://kotlinlang.org/docs/multiplatform/compose-lifecycle.html) — lifecycle y dispatchers por target.
