---
# Mantenimiento: editar solo shared/coding-policies/references/typescript.md y ejecutar `node scripts/sync-coding-policies-references.mjs`.
stack: typescript
name: TypeScript
version: 2026-09-14
---

### Alcance y configuración

- **MUST** Antes de editar, identificar la versión de TypeScript, el gestor y lockfile, los `tsconfig` efectivos, la configuración de lint, los scripts de CI, el runtime de producción y el pipeline de compilación. Porqué: la sintaxis válida y el significado de módulos, paths y emisión dependen del entorno real, no de la versión más nueva de la documentación. Gate: —
- **MUST** Respetar los scripts y convenciones existentes; una corrección acotada no migra módulos, dependencias, formatter, linter ni arquitectura como efecto incidental. Porqué: mezclar una migración con un cambio funcional amplía el riesgo y vuelve ambiguo cualquier fallo. Gate: `git diff -- package.json '*lock*' 'tsconfig*.json'`
- **MUST** Consultar documentación compatible con las versiones instaladas antes de adoptar una API, opción de compilador o preset de lint. Porqué: las páginas vivas pueden documentar capacidades o defaults que el proyecto todavía no tiene. Gate: —
- **MUST** Conservar las comprobaciones existentes y corregir sus errores; no desactivar `strict`, una regla type-aware ni una opción adicional para cerrar la tarea. Porqué: bajar el nivel de verificación convierte el error visible en riesgo silencioso para todo el proyecto. Gate: `tsc --showConfig -p <tsconfig>`
- **SHOULD** En proyectos nuevos, declarar `strict: true` aunque la versión instalada ya lo active por defecto. Porqué: explicita la intención y evita que el contrato dependa de un default histórico del compilador. Gate: `tsc --showConfig -p <tsconfig>`
- **SHOULD** En proyectos nuevos, evaluar y decidir explícitamente `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` y `noFallthroughCasesInSwitch`; en proyectos existentes, incorporarlos solo mediante un cambio acotado. Porqué: cubren ausencias y contratos que `strict` no modela por completo, pero habilitarlos incidentalmente puede exigir una migración amplia. Gate: `tsc --showConfig -p <tsconfig>`
- **MUST** Ejecutar el typecheck con el proyecto correcto; no pasar archivos sueltos a `tsc` cuando hay un `tsconfig`, y respetar el flujo de project references si existe. Porqué: invocar el compilador fuera del proyecto puede ignorar opciones y producir una señal falsa. Gate: `tsc --noEmit -p <tsconfig>` o el script de typecheck del repo

### Tipos e inferencia

- **SHOULD** Usar inferencia para valores locales obvios y explicitar contratos exportados o fronteras cuando mejore la revisión. Porqué: repetir tipos locales agrega ruido, mientras una API explícita comunica qué estabilidad promete. Gate: `tsc --noEmit -p <tsconfig>`
- **MUST** No usar `as T`, `!` ni una anotación para inventar garantías sobre JSON, red o valores posiblemente ausentes; demostrar el narrowing o validar en runtime. Porqué: las assertions desaparecen al ejecutar y pueden ocultar exactamente el caso que el tipo advertía. Gate: `typescript-eslint` (`no-non-null-assertion` y reglas `no-unsafe-*`)
- **MUST** Representar valores desconocidos con `unknown` y reducirlos antes de operar; no abrir el contrato con `any`. Porqué: `unknown` conserva la obligación de comprobar el valor, mientras `any` propaga operaciones sin verificar. Gate: `typescript-eslint` (`no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-argument`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`)
- **MUST** Si una integración obliga a usar `any`, aislarlo en la frontera mínima y explicar por qué es inevitable; nunca encubrirlo con `as unknown as T`. Porqué: un escape localizado limita la pérdida de seguridad y deja visible la deuda. Gate: `typescript-eslint` (`no-explicit-any`) y revisión de `as unknown as`
- **SHOULD** Elegir `type` o `interface` por sus necesidades de composición y declaration merging, sin conversiones masivas de estilo. Porqué: ambas construcciones son válidas y una preferencia cosmética no justifica churn ni riesgo. Gate: —

### Modelado y narrowing

- **MUST** Modelar estados con datos distintos como uniones discriminadas en vez de grupos de propiedades opcionales independientes. Porqué: el tipo debe permitir solo combinaciones válidas y llevar los datos propios de cada variante. Gate: `tsc --noEmit -p <tsconfig>`
- **MUST** Reducir tipos mediante comprobaciones reales; todo type predicate manual debe implementar y testear la validación que declara. Porqué: la firma de un predicate puede mentirle al compilador aunque su cuerpo acepte valores inválidos. Gate: `tsc --noEmit -p <tsconfig>` y tests del predicate
- **MUST** Tratar las variantes cerradas de forma exhaustiva con `never` o lint; no esconder casos nuevos detrás de un `default` genérico salvo fallback defensivo exigido por datos de runtime. Porqué: agregar una variante debe señalar cada lugar que necesita una decisión. Gate: `typescript-eslint` (`switch-exhaustiveness-check`)
- **SHOULD** Usar `satisfies` para comprobar mapas de configuración y registros conservando sus literales específicos cuando esa inferencia sea útil. Porqué: valida el contrato sin ensanchar innecesariamente el valor como puede hacerlo una anotación. Gate: `tsc --noEmit -p <tsconfig>`

### Genéricos y APIs

- **MUST** Agregar un genérico solo cuando exprese una relación útil entre dos o más posiciones del contrato; evitar parámetros que aparecen una sola vez o no restringen nada. Porqué: un genérico sin relación agrega abstracción sin aportar información al caller. Gate: `typescript-eslint` (`no-unnecessary-type-parameters`)
- **SHOULD** Preferir una unión a overloads cuando ambas expresen el mismo contrato, y evitar restricciones genéricas más fuertes de lo necesario. Porqué: la firma más simple tiene menos casos divergentes entre declaración e implementación. Gate: `typescript-eslint` (`unified-signatures`)
- **MUST** Conservar en el tipo la relación real entre entrada y salida cuando el API la promete; no devolver un union amplio que obligue al caller a reconstruir una correlación conocida. Porqué: perder esa relación desplaza assertions y branches inseguros a todos los consumidores. Gate: `tsc --noEmit -p <tsconfig>`

### Límites y validación

- **MUST** Validar entradas externas relevantes al cruzar el límite del sistema y usar desde allí el valor validado. Porqué: una interfaz TypeScript no comprueba JSON, variables de entorno, storage ni respuestas de red en runtime. Gate: `runner de tests del repo` con entradas válidas e inválidas
- **MUST** Reutilizar el validador ya adoptado por el proyecto; la necesidad de validar no autoriza instalar Zod u otra dependencia por sí sola. Porqué: duplicar mecanismos aumenta bundle, mantenimiento y semánticas de error. Gate: `git diff -- package.json '*lock*'`
- **SHOULD** Derivar tipos desde el esquema cuando la librería lo soporte y distinguir input de output si hay coerciones o transformaciones. Porqué: un contrato duplicado puede driftear y una transformación hace que el tipo recibido no sea el tipo producido. Gate: `tsc --noEmit -p <tsconfig>`
- **MUST** Elegir deliberadamente qué hacer con campos desconocidos y revisar la semántica de toda coerción; no asumir que strings como `"false"` se convierten según intención humana. Porqué: strip, rechazo, passthrough y coerción cambian el contrato y pueden aceptar datos inesperados. Gate: `runner de tests del repo` con campos extra y coerciones

### Promesas y concurrencia

- **MUST** Toda promesa se espera, se retorna al caller o maneja explícitamente su rechazo. Porqué: una promesa flotante pierde errores y puede dejar efectos incompletos fuera del flujo observable. Gate: `typescript-eslint` (`no-floating-promises`)
- **MUST** No considerar `void tarea()` como manejo de errores; si se desprende trabajo, definir dónde se observa y trata el rechazo. Porqué: `void` puede silenciar al linter pero no cambia la semántica de la promesa. Gate: `typescript-eslint` (`no-floating-promises`) con `ignoreVoid: false`, o revisión equivalente
- **MUST** No pasar callbacks `async` a APIs que ignoran su promesa, como `forEach`; usar un loop secuencial o una agregación de promesas según la semántica. Porqué: el caller no espera esos callbacks y sus fallos quedan desacoplados. Gate: `typescript-eslint` (`no-misused-promises`)
- **MUST** Elegir conscientemente entre ejecución secuencial y concurrente, preservar el orden cuando importe y limitar fan-out contra servicios externos. Porqué: `Promise.all` sin criterio puede romper dependencias, saturar recursos o cambiar el comportamiento observable. Gate: `runner de tests del repo` con orden, fallo parcial y límite de concurrencia

### Módulos y runtime

- **MUST** Alinear `module`, `moduleResolution`, `package.json`, extensiones e imports con quien ejecuta o bundlea el JavaScript final. Porqué: que el dev server resuelva un import no demuestra que Node, el bundler o los consumidores de una librería puedan hacerlo. Gate: `tsc` más build o ejecución del artefacto de producción
- **SHOULD** Usar `import type` para dependencias que solo existen en el sistema de tipos, respetando el pipeline y `verbatimModuleSyntax` del proyecto. Porqué: hace explícita la frontera de runtime y evita emisiones o imports ambiguos. Gate: `typescript-eslint` (`consistent-type-imports`) o `tsc --noEmit -p <tsconfig>`
- **SHOULD** Separar `tsconfig` cuando servidor, navegador, workers y tests necesiten globals o emisión distintos. Porqué: una configuración única demasiado amplia permite APIs que no existen en alguno de los runtimes. Gate: `tsc -b` o scripts de typecheck por entorno
- **MUST** Si Node ejecuta TypeScript nativo, mantener un typecheck independiente y no asumir que el type stripping aplica aliases de `paths` ni transformaciones. Porqué: la ejecución nativa borra tipos pero no usa el `tsconfig` para comprobarlos o resolverlos. Gate: `tsc --noEmit -p <tsconfig>` y ejecución con la versión real de Node

### Linting y supresiones

- **SHOULD** Si el repo usa ESLint, partir de `recommendedTypeChecked` y configurar obtención de tipos con `projectService: true` cuando las versiones instaladas lo soporten. Porqué: las reglas type-aware detectan propagación insegura que el lint sintáctico no ve. Gate: `eslint .`
- **MUST** Adoptar `strictTypeChecked` solo deliberadamente y no habilitar el preset `all` automáticamente. Porqué: los presets opinados pueden cambiar fuera de una major y `all` introduce reglas sin una decisión de equipo. Gate: revisión de la configuración de `typescript-eslint` y `eslint .`
- **MUST** Corregir el problema antes de suprimirlo; una excepción usa `@ts-expect-error` con motivo concreto y alcance mínimo, nunca desactiva chequeos globales para cerrar la tarea. Porqué: `@ts-expect-error` falla cuando la excepción deja de ser necesaria y la explicación conserva el contexto. Gate: `typescript-eslint` (`ban-ts-comment`)
- **MUST** Verificar la matriz soportada de TypeScript, ESLint, parser y Node antes de actualizar cualquiera de ellos. Porqué: que el gestor resuelva versiones no significa que la combinación tenga soporte oficial. Gate: lockfile más documentación de compatibilidad de `typescript-eslint`

### Testing y verificación

- **MUST** Ejecutar los scripts pertinentes del repo para typecheck, lint, tests y build; si no hay typecheck y aplica, usar el compilador local con `--noEmit` y el `tsconfig` correcto. Porqué: cada gate cubre defectos distintos y una herramienta global puede no coincidir con el proyecto. Gate: scripts de CI del repo y `tsc --noEmit -p <tsconfig>`
- **MUST** Probar comportamiento observable y casos de error relevantes, especialmente validación, narrowing manual, cancelación y concurrencia cuando cambien. Porqué: que el código compile no demuestra que el contrato de runtime se cumpla. Gate: `runner de tests del repo`
- **MUST** Informar qué verificaciones se ejecutaron y cuáles no; no presentar un build sin typecheck ni una ejecución con type stripping como evidencia de tipos. Porqué: una señal mal etiquetada crea una confianza que la herramienta no produjo. Gate: `reporte final` con comando y resultado

### Rendimiento del tipado

- **SHOULD** Nombrar cálculos de tipos complejos reutilizados y preferir composición legible; evaluar `interface extends` frente a grandes intersecciones de objetos. Porqué: tipos anónimos e intersecciones profundas pueden repetir trabajo y empeorar diagnósticos. Gate: `tsc --noEmit -p <tsconfig>`
- **MUST** Medir antes de refactorizar por rendimiento del sistema de tipos. Porqué: sin diagnóstico se puede añadir complejidad sin atacar el cuello de botella real. Gate: `tsc --extendedDiagnostics -p <tsconfig>` o trace del compilador
- **MUST** No activar `skipLibCheck` automáticamente para ocultar conflictos entre dependencias; investigar el origen y documentar el compromiso si se adopta. Porqué: acelera el chequeo omitiendo errores en declaraciones y reduce la cobertura del compilador. Gate: `tsc --showConfig -p <tsconfig>` y typecheck con la decisión documentada

### Lectura ampliada

- [TypeScript: strict](https://www.typescriptlang.org/tsconfig/strict.html) — familia base de comprobaciones estrictas.
- [TypeScript: noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) — ausencia posible en accesos indexados.
- [TypeScript: exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html) — diferencia entre propiedad ausente y `undefined` explícito.
- [TypeScript Handbook: Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) — inferencia, annotations, unions y assertions.
- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — guards, predicates, uniones discriminadas y exhaustividad.
- [TypeScript Handbook: More on Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html) — genéricos y overloads simples.
- [TypeScript: `satisfies`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator) — comprobación sin perder inferencia específica.
- [typescript-eslint: typed linting](https://typescript-eslint.io/getting-started/typed-linting/) — configuración de reglas con información de tipos.
- [typescript-eslint: shared configs](https://typescript-eslint.io/users/configs/) — alcance y estabilidad de los presets.
- [typescript-eslint: avoiding `any`](https://typescript-eslint.io/blog/avoiding-anys/) — reglas que limitan `any` explícito y propagado.
- [typescript-eslint: no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) — promesas cuyo resultado no se observa.
- [typescript-eslint: no-misused-promises](https://typescript-eslint.io/rules/no-misused-promises/) — promesas en posiciones que esperan valores síncronos.
- [typescript-eslint: switch-exhaustiveness-check](https://typescript-eslint.io/rules/switch-exhaustiveness-check/) — exhaustividad type-aware.
- [TypeScript: choosing compiler options for modules](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) — configuración según Node, bundler o librería.
- [TypeScript: verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html) — relación explícita entre imports y emisión.
- [Node.js: Modules TypeScript](https://nodejs.org/api/typescript.html) — capacidades y límites de ejecutar TypeScript nativo.
- [TypeScript: erasableSyntaxOnly](https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html) — sintaxis compatible con borrado de tipos.
- [Zod: Basic usage](https://zod.dev/basics) — validación de entradas y derivación de tipos cuando el repo usa Zod.
- [TypeScript Performance](https://github.com/microsoft/TypeScript/wiki/Performance) — diagnóstico y diseño de tipos con mejor desempeño.
- [TypeScript: skipLibCheck](https://www.typescriptlang.org/tsconfig/skipLibCheck.html) — alcance y pérdida de cobertura de la opción.
- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) — cambios de defaults y deprecaciones que requieren revisar versiones.
