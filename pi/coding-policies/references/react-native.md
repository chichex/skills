---
# Mantenimiento: editar solo shared/coding-policies/references/react-native.md y ejecutar `node scripts/sync-coding-policies-references.mjs`.
stack: react-native
name: React Native
version: 2026-09-14
---

### Alcance y versiones

- **MUST** Antes de editar, identificar las versiones de React Native y React, Expo y su SDK si existen, el gestor y lockfile, las herramientas nativas, la arquitectura activa y quién es dueño de `android/` e `ios/`. Porqué: las APIs, el flujo de build y si los proyectos nativos se editan o regeneran dependen de ese conjunto real. Gate: —
- **MUST** Consultar documentación compatible con las versiones instaladas y no convertir una corrección acotada en una actualización de React Native, Expo, Gradle, CocoaPods o arquitectura. Porqué: esos componentes evolucionan coordinados y una migración incidental amplía el riesgo fuera de la tarea. Gate: `git diff -- package.json '*lock*' android ios`
- **MUST** Conservar el framework, navegación, flujo de build y estrategia nativa del repo salvo que la tarea exija cambiarlos. Porqué: Expo y los proyectos sin framework tienen ciclos de vida y responsabilidades distintos que no son intercambiables. Gate: revisión de `package.json`, configuración y diff nativo
- **MUST** Verificar cada biblioteca contra React Native y, si aplica, Expo SDK y la New Architecture; en React Native 0.82 o posterior no intentar desactivar esa arquitectura. Porqué: un flag histórico no resuelve una incompatibilidad cuando el runtime ya no incluye el camino anterior. Gate: `expo-doctor` cuando existe y build nativo del target afectado

### React: pureza, estado y efectos

- **MUST** Mantener puros componentes y reducers: no mutar props, estado ni valores recibidos por Hooks, y dejar efectos secundarios fuera del render. Porqué: React puede renderizar más de una vez y necesita que la misma entrada produzca el mismo resultado. Gate: `eslint-plugin-react-hooks` y tests de comportamiento
- **MUST** Llamar Hooks ordinarios en el nivel superior de componentes o Hooks; no extender a `useState` o `useEffect` las excepciones de la API `use`. Porqué: React asocia el estado al orden estable de llamadas y una condición rompe esa correspondencia. Gate: `eslint-plugin-react-hooks` (`rules-of-hooks`)
- **SHOULD** Mantener el estado mínimo, sin copiar props ni guardar datos derivables; usar reducer solo cuando reúna transiciones complejas y acciones con significado. Porqué: duplicar fuentes de verdad crea estados contradictorios y un reducer ceremonial no simplifica un caso trivial. Gate: —
- **MUST** Usar Effects para sincronización con sistemas externos, no para calcular derivados, encadenar estado interno ni ejecutar una interacción del usuario de forma indirecta. Porqué: esos usos agregan renders, carreras y flujo causal oculto. Gate: `eslint-plugin-react-hooks` y revisión de cada `useEffect`
- **MUST** Declarar las dependencias reactivas reales de cada Effect y no suprimir `exhaustive-deps` para forzar una ejecución única. Porqué: una lista falsa deja closures obsoletos y oculta que la sincronización está mal modelada. Gate: `eslint-plugin-react-hooks` (`exhaustive-deps`)
- **MUST** Limpiar simétricamente suscripciones, conexiones y timers; ante requests manuales, cancelar o ignorar respuestas obsoletas. Porqué: el ciclo setup → cleanup → setup debe sobrevivir Strict Mode sin leaks ni carreras. Gate: tests de cleanup y `eslint-plugin-react-hooks`
- **MUST** Usar identidad y `key` para reiniciar estado cuando cambia la entidad del dominio, y no declarar componentes dentro de otros si deben conservar su estado. Porqué: React preserva estado por tipo y posición, no por parecido visual. Gate: `tests de cambio de identidad`
- **SHOULD** Agregar memoización solo por una necesidad medible y después de comprobar si React Compiler está activo; no quitarla ni aplicarla masivamente. Porqué: `useMemo` y `useCallback` también agregan complejidad y el compilador cambia qué optimizaciones manuales son útiles. Gate: `profiler de React en una build representativa`

### Plataformas y layout

- **SHOULD** Resolver diferencias pequeñas con `Platform` o `Platform.select` y usar archivos `.ios` o `.android` cuando la implementación específica ya merece un módulo propio. Porqué: la separación debe hacer visible la divergencia sin duplicar innecesariamente el flujo común. Gate: `typecheck y tests por plataforma`
- **MUST** Mantener un contrato compartido claro para las variantes de plataforma y no asumir que `Platform.Version` tiene el mismo formato en iOS y Android. Porqué: consumidores comunes necesitan una forma estable aunque la implementación y los identificadores nativos difieran. Gate: `tests iOS y Android del contrato`
- **MUST** Diseñar con componentes y reglas de layout nativos; no trasladar APIs del DOM ni defaults de CSS, recordando que `flexDirection` empieza en `column` y `flexShrink` en `0`. Porqué: React Native no ejecuta el modelo de layout del navegador. Gate: `lint, typecheck y prueba visual en los targets afectados`
- **MUST** Verificar layouts con tamaños de pantalla, orientación y textos representativos del producto. Porqué: una captura en un único simulador no detecta truncado, overflow ni cambios de densidad. Gate: `prueba visual en los dispositivos o simuladores definidos por el repo`

### Accesibilidad

- **MUST** Definir roles, etiquetas, hints y estados según la función real de cada control, sin depender solo de su apariencia. Porqué: las tecnologías asistivas necesitan semántica para anunciar y operar la interfaz. Gate: `queries por rol en tests y prueba humana con lector de pantalla`
- **MUST** Revisar agrupación, orden de foco y anuncios en los flujos modificados, incluidos carga, error y confirmación. Porqué: una etiqueta aislada no demuestra que la interacción completa sea comprensible. Gate: `prueba humana de navegación accesible`
- **MUST** Probar las diferencias relevantes con VoiceOver y TalkBack cuando el flujo sea crítico o cambie accesibilidad. Porqué: iOS y Android exponen comportamientos distintos que un test JavaScript no ejecuta. Gate: `VoiceOver` y `TalkBack` en dispositivo o simulador compatible

### Rendimiento y listas

- **MUST** Medir rendimiento en una build de release o perfilado apropiada y distinguir saturación del hilo JavaScript de problemas del hilo UI. Porqué: el modo desarrollo agrega trabajo y puede atribuir el síntoma al subsistema equivocado. Gate: `profiler de React Native más herramientas nativas del target`
- **MUST** Usar claves estables y filas livianas en listas virtualizadas. Porqué: identidades inestables y renders costosos destruyen reutilización y respuesta al scroll. Gate: `profiler y tests de identidad de filas`
- **MUST** Usar `getItemLayout` solo cuando las dimensiones sean conocidas y correctas. Porqué: offsets falsos producen scroll incorrecto y contenido que aparece en posiciones equivocadas. Gate: `tests de scroll a índices y prueba visual`
- **SHOULD** Ajustar `windowSize`, lotes, cantidad inicial y `removeClippedSubviews` solo con evidencia de memoria, respuesta y huecos visibles. Porqué: no existe una configuración universal y recortar vistas no equivale a liberar toda su memoria. Gate: `medición antes/después en una build representativa`

### Testing

- **MUST** Probar resultados observables por texto, rol e interacción con el runner y las utilidades presentes. Porqué: esos contratos sobreviven refactors mejor que el estado interno o la estructura privada del componente. Gate: `runner de tests del repo`
- **MUST** No actualizar snapshots sin revisar su significado ni usarlos como única prueba de un flujo. Porqué: aceptar un diff grande a ciegas convierte el snapshot en aprobación mecánica, no en verificación. Gate: `revisión del diff de snapshots y assertions de comportamiento`
- **MUST** No presentar tests de componentes ejecutados en Node como prueba de las implementaciones Android o iOS. Porqué: mocks y renderers JavaScript no cargan el código ni el runtime nativo real. Gate: `reporte de verificación con plataforma y tipo de runner`
- **MUST** Complementar flujos críticos y cambios nativos con emulador, simulador o dispositivo y una build real; no crear tests nuevos sobre React Test Renderer deprecado. Porqué: integración, permisos, linking y lifecycle solo aparecen al cruzar el límite nativo. Gate: `build y prueba de integración del target afectado`

### Seguridad y almacenamiento

- **MUST** Mantener secretos de backend fuera del bundle y tratar toda variable compilada en la app, incluida `EXPO_PUBLIC_*`, como pública. Porqué: quien recibe el binario puede inspeccionar esos valores aunque el repositorio sea privado. Gate: `inspección de configuración y búsqueda de secretos en el bundle`
- **MUST** Usar `AsyncStorage` solo para datos no sensibles y reutilizar el almacén seguro nativo del proyecto para credenciales de sesión. Porqué: `AsyncStorage` no cifra y un storage seguro tiene controles de plataforma que el almacenamiento general no ofrece. Gate: `tests de persistencia y revisión del adapter de almacenamiento`
- **MUST** Diseñar pérdida, indisponibilidad y borrado de credenciales, incluido logout; guardar un valor en SecureStore o Keychain no vuelve secreto algo ya embebido en el bundle. Porqué: desinstalación, biometría y políticas de plataforma cambian la disponibilidad de los datos. Gate: `tests de logout, credencial ausente y acceso rechazado`

### Módulos nativos

- **MUST** Comprobar primero las APIs del framework y las bibliotecas existentes antes de crear un módulo nativo. Porqué: una integración propia suma contratos, Codegen, builds y mantenimiento por plataforma. Gate: `revisión de dependencias y APIs instaladas`
- **MUST** Para un Turbo Native Module, definir la especificación tipada, ejecutar Codegen e implementar el contrato generado en cada target soportado. Porqué: el código generado es la frontera verificable entre JavaScript y las implementaciones nativas. Gate: `codegen` y build nativo de Android e iOS aplicables
- **MUST** Reconstruir la app después de modificar código o configuración nativa y usar las APIs correspondientes a la arquitectura instalada, no tutoriales de bridges legacy como receta automática. Porqué: recargar JavaScript no incorpora cambios del binario. Gate: `build limpio del target nativo afectado`

### Expo

- **MUST** Si el proyecto usa Expo, usar una development build compatible cuando una dependencia o configuración requiera código nativo propio, en vez de asumir que Expo Go la incluye. Porqué: Expo Go trae un conjunto fijo de capacidades nativas. Gate: `expo-doctor` y development build del proyecto
- **MUST** Si el proyecto usa Expo, reconstruir la development build después de cambios nativos y reservar la recarga para cambios JavaScript o TypeScript compatibles con el binario actual. Porqué: Metro no puede agregar librerías ni permisos al ejecutable ya instalado. Gate: `build nativo y ejecución del flujo afectado`
- **MUST** Si el proyecto usa Expo, actualizar Expo SDK solo como migración explícita, siguiendo el salto incremental, alineando dependencias y revisando `expo-doctor`. Porqué: el SDK define un conjunto coordinado de React Native y módulos Expo. Gate: `expo install --check`, `expo-doctor` y suite del repo
- **MUST** Si el proyecto usa Expo, determinar si `android/` e `ios/` se mantienen a mano o se regeneran con CNG; no ejecutar `prebuild --clean` hasta demostrar que toda personalización está representada. Porqué: ese comando elimina y recrea ambos proyectos nativos. Gate: revisión de config plugins y `git diff -- android ios` después de una prueba descartable
- **MUST** Si el proyecto usa Expo, mantener cada actualización remota compatible con el código nativo y `runtimeVersion` del binario receptor. Porqué: una OTA no instala capacidades nativas ausentes y compartir una runtime version incorrecta no crea compatibilidad. Gate: prueba de la actualización contra una build con el mismo `runtimeVersion`

### Verificación

- **MUST** Ejecutar lint, typecheck, tests JavaScript, build y pruebas nativas pertinentes según los scripts del repo. Porqué: cada capa detecta defectos distintos y ninguna reemplaza por sí sola la integración móvil. Gate: `scripts de CI y build de los targets afectados`
- **MUST** Probar permisos tanto concedidos como rechazados y los estados de carga, error, reintento y recuperación de los flujos modificados. Porqué: los fallos y decisiones del sistema operativo son comportamiento normal de una app móvil. Gate: `tests de integración y prueba en target nativo`
- **MUST** Informar exactamente qué versiones y plataformas se compilaron, ejecutaron y probaron, y cuáles quedaron sin verificar. Porqué: “los tests pasan” no dice si se ejercitó Android, iOS, Expo Go o una development build. Gate: `reporte final` con comando, target y resultado

### Lectura ampliada

- [React: Rules of React](https://react.dev/reference/rules) — pureza, Hooks y responsabilidades de componentes.
- [React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) — estado mínimo y variantes coherentes.
- [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — Effects reservados para sincronización externa.
- [React: Removing Effect Dependencies](https://react.dev/learn/removing-effect-dependencies) — dependencias reactivas y refactors correctos.
- [React Native: Get Started](https://reactnative.dev/docs/environment-setup) — framework y entorno según la versión instalada.
- [React Native: Platform-Specific Code](https://reactnative.dev/docs/platform-specific-code) — `Platform` y archivos por target.
- [React Native: Flexbox](https://reactnative.dev/docs/flexbox) — defaults y diferencias del layout nativo.
- [React Native: Accessibility](https://reactnative.dev/docs/accessibility) — semántica y APIs por plataforma.
- [React Native: Performance](https://reactnative.dev/docs/performance) — hilos, builds y profiling.
- [React Native: Optimizing FlatList](https://reactnative.dev/docs/optimizing-flatlist-configuration) — trade-offs de virtualización.
- [React Native: Testing](https://reactnative.dev/docs/testing-overview) — alcance de tests JavaScript y nativos.
- [React Native: Security](https://reactnative.dev/docs/security) — secretos y almacenamiento local.
- [React Native: Turbo Native Modules](https://reactnative.dev/docs/turbo-native-modules-introduction) — especificación, Codegen e implementación.
- [Expo: Development builds](https://docs.expo.dev/develop/development-builds/introduction/) — capacidades nativas fuera de Expo Go.
- [Expo: Upgrade SDK](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) — migración coordinada de versiones.
- [Expo: Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/) — propiedad y regeneración de proyectos nativos.
- [Expo: Environment variables](https://docs.expo.dev/guides/environment-variables/) — exposición de `EXPO_PUBLIC_*`.
- [Expo: SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) — persistencia sensible y límites por plataforma.
- [Expo: Permissions](https://docs.expo.dev/guides/permissions/) — configuración y solicitudes en runtime.
- [Expo: Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/) — compatibilidad entre OTA y binario.
