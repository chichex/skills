---
# Mantenimiento: editar solo shared/coding-policies/references/react.md y ejecutar `node scripts/sync-coding-policies-references.mjs`.
stack: react
name: React
version: 2026-10-09
---

### Pureza y Hooks

- **MUST** Mantener puro el render: la misma combinación de props, estado y contexto produce el mismo JSX y no ejecuta efectos secundarios. Porqué: React puede renderizar, pausar o repetir trabajo antes de confirmar una actualización. Gate: `eslint-plugin-react-hooks` y tests de comportamiento
- **MUST** No mutar props, estado ni valores recibidos por Hooks. Porqué: React trata esos valores como snapshots y la mutación rompe detección de cambios y razonamiento entre renders. Gate: `reglas de inmutabilidad del linter o revisión del diff`
- **MUST** Usar componentes mediante JSX en vez de invocarlos como funciones ordinarias. Porqué: React necesita controlar su identidad, Hooks y lifecycle dentro del árbol. Gate: `eslint-plugin-react-hooks` más tests de render
- **MUST** Llamar Hooks ordinarios en el nivel superior de componentes o custom Hooks; la API `use` puede admitir condiciones o loops, pero sigue dentro de un componente o Hook y fuera de `try`/`catch`. Porqué: el orden estable asocia cada llamada con su estado y las excepciones de `use` no se extienden a `useState` o `useEffect`. Gate: `eslint-plugin-react-hooks` (`rules-of-hooks`)
- **MUST** Conservar las reglas recomendadas de `eslint-plugin-react-hooks` compatibles con la versión instalada y no desactivarlas para cerrar la tarea. Porqué: codifican invariantes de React que el typecheck no observa. Gate: `eslint .`

### Estado y reducers

- **MUST** Mantener el estado mínimo y evitar guardar valores que pueden calcularse desde props y estado durante render. Porqué: dos fuentes de verdad se desincronizan y agregan Effects innecesarios. Gate: revisión de `useState` y `useReducer`
- **SHOULD** Guardar la identidad seleccionada cuando el objeto completo ya vive en otra colección. Porqué: conservar una copia del objeto permite que quede obsoleta respecto de la fuente. Gate: `tests de actualización de la colección`
- **MUST** No copiar props a estado salvo que representen deliberadamente un valor inicial y el nombre haga explícita esa semántica. Porqué: el estado copiado deja de seguir cambios del parent sin que el contrato lo diga. Gate: `tests de cambio de props`
- **MUST** Modelar variantes de estado de modo que no permitan combinaciones contradictorias, usando discriminantes cuando cada estado tenga datos distintos. Porqué: booleans y campos opcionales independientes permiten loading, éxito y error al mismo tiempo. Gate: `typecheck y tests de transiciones`
- **SHOULD** Introducir un reducer cuando reúna transiciones complejas o dispersas; sus acciones describen eventos y su implementación permanece pura, mientras casos simples siguen con `useState`. Porqué: el reducer sirve para hacer comprensible un flujo, no como ceremonia universal. Gate: `tests de transiciones del reducer`

### Effects

- **MUST** Usar Effects para sincronizar con sistemas externos, no como mecanismo general de flujo interno. Porqué: un Effect agrega un ciclo posterior al render y puede ejecutarse más veces de las imaginadas. Gate: revisión de cada `useEffect`
- **MUST** Calcular datos derivados durante render y ejecutar interacciones desde sus event handlers, sin Effects que copien listas filtradas, encadenen estado o disparen una compra. Porqué: el lugar causal directo evita renders extra y acciones que ocurren por haber pintado UI. Gate: `tests de interacción y revisión de Effects`
- **SHOULD** Para datos remotos, preferir el mecanismo del framework o la solución existente que gestione cache, deduplicación y concurrencia. Porqué: un fetch manual en un Effect suele reimplementar lifecycle y carreras de red. Gate: `revisión de la capa de datos del repo`
- **MUST** Limpiar simétricamente suscripciones, conexiones y timers creados por un Effect; ante requests manuales, cancelar o ignorar respuestas obsoletas. Porqué: setup → cleanup → setup debe funcionar sin leaks ni resultados fuera de orden. Gate: `tests de cleanup y respuestas tardías`
- **MUST** Declarar como dependencias todos los valores reactivos leídos y no suprimir `exhaustive-deps` para imponer un array vacío. Porqué: una dependencia falsa deja closures viejos y esconde un diseño de sincronización incorrecto. Gate: `eslint-plugin-react-hooks` (`exhaustive-deps`)
- **SHOULD** Si la versión lo soporta, usar `useEffectEvent` solo para lógica no reactiva disparada desde Effects; no usarlo para ocultar dependencias, pasarlo a otros componentes ni llamarlo desde handlers ordinarios. Porqué: separa lecturas recientes de la sincronización sin convertirlo en un escape del modelo reactivo. Gate: `eslint-plugin-react-hooks` y tests del Effect
- **MUST** Corregir los problemas que revela Strict Mode antes de plantear desactivarlo. Porqué: la repetición de setup y cleanup expone Effects no idempotentes que también fallan en navegación real. Gate: tests bajo `StrictMode` o entorno de desarrollo equivalente

### Identidad y componentes

- **MUST** Usar `key` cuando una nueva identidad del dominio deba reiniciar el estado de un subárbol. Porqué: React preserva estado por tipo y posición; una key comunica que ya no es la misma entidad. Gate: `test de cambio de identidad`
- **MUST** No declarar componentes dentro de otros componentes si deben conservar identidad entre renders. Porqué: cada render crea un tipo distinto y React desmonta su estado. Gate: `lint de componentes anidados o revisión del árbol`
- **SHOULD** Mantener el estado en el ancestro común más cercano que realmente coordina a sus consumidores, sin elevarlo por defecto a un store global. Porqué: ownership local reduce acoplamiento y renders ajenos. Gate: `profiler y revisión del flujo de datos`

### Memoización

- **MUST** Comprobar si React Compiler está habilitado antes de diseñar optimizaciones manuales nuevas. Porqué: una versión moderna de React no demuestra que el compilador esté configurado para ese código. Gate: configuración y diagnóstico de `React Compiler`
- **SHOULD** Agregar `useMemo`, `useCallback` o `memo` solo por una necesidad concreta y medible. Porqué: también agregan dependencias y complejidad, y pueden costar más que el cálculo evitado. Gate: `profiler antes y después`
- **MUST** No retirar memoización existente en bloque sin comprobar comportamiento y rendimiento. Porqué: puede formar parte de un contrato de identidad o proteger un hotspot no evidente. Gate: `suite del repo y perfilado del flujo afectado`
- **MUST** No tratar React Compiler ni `useMemo` como una caché general para funciones, red o datos persistentes. Porqué: su alcance es la optimización de componentes y Hooks, no la semántica de almacenamiento de la aplicación. Gate: `revisión de ownership y lifetime de la caché`

### Testing y accesibilidad

- **MUST** Probar resultados observables mediante texto, roles e interacción en vez de estado interno o detalles privados. Porqué: el test debe describir el contrato del usuario y sobrevivir refactors legítimos. Gate: `runner de tests del repo con queries accesibles`
- **MUST** Cubrir los estados de carga, vacío, error, éxito y reintento que cambie el flujo. Porqué: el happy path no verifica cómo se recupera la interfaz ante respuestas normales del sistema. Gate: `tests de componentes o integración`
- **MUST** Usar elementos y atributos semánticos para que teclado y tecnologías asistivas puedan operar los controles. Porqué: un handler de click sobre un elemento visual no hereda rol, foco ni activación de teclado. Gate: `linter de accesibilidad y tests por rol`
- **MUST** No actualizar snapshots sin revisar su significado ni usarlos como única prueba de una interacción. Porqué: aceptar el diff mecánicamente no demuestra que el comportamiento sea correcto. Gate: `revisión de snapshots más assertions observables`

### Web en celular y webview

- **MUST** Declarar el viewport con `<meta name="viewport" content="width=device-width, initial-scale=1">`, sin `user-scalable=no` ni `maximum-scale=1`. Porqué: bloquear el zoom impide ampliar el contenido a quien lo necesita y falla WCAG 1.4.4. Gate: `grep de user-scalable y maximum-scale en el HTML base`
- **MUST** Dar a inputs, selects y textareas un `font-size` computado de al menos 16px en mobile. Porqué: Safari en iOS hace zoom automático al enfocar un campo con texto menor a 16px y desarma el layout. Gate: `prueba en Safari iOS o WebKit con viewport mobile`
- **MUST** Mantener visible el campo enfocado cuando aparece el teclado virtual, sin saltos de scroll al escribir: ajustar el layout al viewport visual (`interactive-widget=resizes-content` o la API `visualViewport`) y usar `scrollIntoView` solo como corrección puntual. Porqué: el teclado achica el viewport visual y un layout fijo puede tapar el input o saltar en cada tecla. Gate: `prueba manual o E2E con teclado virtual en iOS y Android`
- **MUST** Respetar las zonas seguras en barras fijas y contenido a pantalla completa con `viewport-fit=cover` y `env(safe-area-inset-*)`. Porqué: notch, isla dinámica y barra de gestos tapan los controles pegados a los bordes. Gate: `prueba visual en un dispositivo o simulador con notch`
- **SHOULD** Dar a cada control táctil un área de al menos 44pt (44px CSS) con separación entre targets vecinos. Porqué: los targets chicos generan toques errados; 44pt es el mínimo de las guías de Apple y WCAG 2.5.8 exige al menos 24px. Gate: `auditoría de accesibilidad o medición en DevTools`
- **MUST** Ofrecer un camino táctil y de teclado para todo lo que se revela con `:hover` o eventos de mouse. Porqué: en pantallas táctiles no hay hover y la acción o la información quedan inaccesibles. Gate: `prueba con emulación táctil y navegación por teclado`

### Verificación

- **MUST** Ejecutar lint, typecheck, tests y build mediante los scripts existentes del repo. Porqué: Hooks, tipos, comportamiento y bundling fallan por mecanismos distintos. Gate: scripts de CI declarados en `package.json`
- **MUST** Para cambios de interfaz, verificar navegación, foco, estados async y comportamiento accesible en el entorno que integra React. Porqué: un test unitario no ejecuta necesariamente routing, CSS, plataforma ni lector de pantalla. Gate: `tests de integración o prueba humana definida por el proyecto`
- **MUST** Informar versiones relevantes, comandos ejecutados y flujos visuales o accesibles que quedaron sin probar. Porqué: la evidencia debe distinguir comprobación automática de validación pendiente. Gate: `reporte final` con comando y resultado

### Lectura ampliada

- [Rules of React](https://react.dev/reference/rules) — pureza, inmutabilidad y responsabilidades del render.
- [eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks) — reglas recomendadas y diagnósticos del compilador.
- [Rules of Hooks](https://react.dev/reference/eslint-plugin-react-hooks/lints/rules-of-hooks) — orden de Hooks y caso especial de `use`.
- [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) — estado mínimo y fuentes de verdad.
- [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) — cuándo reunir transiciones.
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — derivados, eventos y sincronización externa.
- [Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects) — setup, cleanup y lifecycle.
- [Removing Effect Dependencies](https://react.dev/learn/removing-effect-dependencies) — dependencias reactivas sin supresiones.
- [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) — posición, tipo y keys.
- [React Compiler: Introduction](https://react.dev/learn/react-compiler/introduction) — memoización automática y alcance.
- [useEffectEvent](https://react.dev/reference/react/useEffectEvent) — separar lógica no reactiva sin ocultar dependencias.
- [MDN: viewport meta](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport) — `width`, `initial-scale`, `interactive-widget` y por qué no bloquear el zoom.
- [MDN: env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env) — `safe-area-inset-*` y `viewport-fit=cover`.
- [MDN: VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) — viewport visual con teclado virtual.
- [WebKit: Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) — zonas seguras en Safari.
- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) — tamaño mínimo de 44pt para controles táctiles.
- [WCAG 2.2: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) — mínimo de 24px y separación entre targets.
