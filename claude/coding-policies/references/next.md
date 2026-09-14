---
stack: next
name: Next.js
version: 2026-09-14
---

### Alcance y versión

- **MUST** Antes de editar, identificar versión de Next.js y React, App Router o Pages Router, runtime por ruta, `cacheComponents`, gestor y lockfile, scripts y pipeline de despliegue. Porqué: APIs, caché, lint y límites de servidor cambian entre versiones, routers y runtimes. Gate: —
- **MUST** Consultar documentación compatible con la versión instalada y, cuando esté disponible, priorizar la documentación incluida en `node_modules/next/dist/docs`. Porqué: la web viva puede describir una versión posterior a la que compila el proyecto. Gate: versión de `next` más índice oficial para coding agents
- **MUST** No migrar router, caché, middleware, runtime ni dependencias como efecto incidental de una corrección acotada. Porqué: cada migración cambia convenciones y comportamiento transversal que requieren alcance propio. Gate: `git diff -- package.json '*lock*' next.config.* app pages middleware.* proxy.*`
- **MUST** Verificar las notas de upgrade antes de copiar APIs nuevas; en Next 16 revisar acceso async a `params`, `searchParams`, `cookies` y `headers`, y la transición de middleware a proxy. Porqué: un rename mecánico o acceso síncrono puede romper runtime y contratos de request. Gate: `build y tests con la versión instalada`

### Servidor y cliente

- **SHOULD** En App Router, mantener pages y layouts como Server Components por defecto e introducir Client Components solo donde haya estado, eventos, Effects o APIs del navegador. Porqué: una frontera cliente innecesariamente alta amplía JavaScript y datos enviados al navegador. Gate: revisión de directivas `'use client'` y bundle
- **MUST** Mantener secretos, credenciales y acceso privilegiado en módulos de servidor. Porqué: todo módulo del grafo cliente puede terminar distribuido al navegador. Gate: `análisis del bundle y reglas server-only del repo`
- **MUST** Pasar por la frontera servidor-cliente solo props serializables por React. Porqué: funciones, handles y objetos de runtime no forman parte del protocolo de render remoto. Gate: `build de producción y tests de render`
- **MUST** Recordar que `'use client'` delimita un grafo de módulos y que pasar un Server Component como `children` no convierte su implementación en cliente. Porqué: ubicar mal la frontera puede filtrar imports de servidor o duplicar bundle por una interpretación incorrecta. Gate: `inspección del grafo y build`
- **SHOULD** Colocar la frontera cliente lo más cerca posible de la interactividad sin fragmentar artificialmente el componente. Porqué: reduce bundle y mantiene acceso a datos en servidor, pero una frontera por cada botón agrega wiring sin valor. Gate: `análisis de bundle y revisión del árbol`

### Datos y concurrencia

- **MUST** Desde Server Components, acceder directamente a la fuente o capa de datos en vez de llamar por HTTP a un Route Handler del mismo proyecto. Porqué: el salto agrega latencia y puede fallar durante build cuando no existe un servidor escuchando. Gate: `búsqueda de fetch al propio host y test de build`
- **MUST** Iniciar en paralelo lecturas independientes y conservar secuencia donde exista una dependencia real. Porqué: waterfalls innecesarios suman latencia, mientras paralelizar pasos dependientes cambia la semántica. Gate: `test de orden y trazas de la carga`
- **SHOULD** Usar `loading.tsx` y Suspense para que una espera no bloquee toda la interfaz cuando el producto admite streaming. Porqué: permite mostrar estructura y partes listas antes de completar la lectura más lenta. Gate: `prueba de navegación con respuesta demorada`
- **MUST** Definir qué ocurre ante fallo parcial de cargas concurrentes. Porqué: agrupar promesas sin contrato puede convertir un dato opcional en caída de toda la página. Gate: `tests de una dependencia fallida`
- **MUST** No presentar `React.cache` como caché persistente entre requests. Porqué: deduplica trabajo dentro del ciclo de render pertinente, pero no reemplaza la política de datos de Next. Gate: `tests entre requests y revisión de la capa de caché`

### Caché y revalidación

- **MUST** Identificar versión y valor de `cacheComponents` antes de editar caché. Porqué: Next mantiene modelos con APIs y defaults distintos que no se pueden mezclar. Gate: inspección de `next.config.*` y documentación de la versión
- **MUST** No habilitar Cache Components incidentalmente para usar una API de una guía. Porqué: cambia el modelo de render y caché del proyecto completo. Gate: `git diff -- next.config.*`
- **MUST** Distinguir caché de datos, deduplicación de requests y reutilización de UI. Porqué: que una lectura se deduplique no define vigencia ni que una ruta se prerenderice. Gate: `tests que crucen requests y revalidación`
- **MUST** Sin Cache Components, no asumir que `fetch` se cachea por defecto; usar `force-cache` solo cuando el contrato de vigencia lo permita. Porqué: defaults históricos y ejemplos viejos pueden servir datos con una política equivocada. Gate: `test de dos requests y origen instrumentado`
- **MUST** Elegir invalidación específica: usar `revalidateTag(tag, 'max')` para stale-while-revalidate y `updateTag` solo desde Server Actions cuando haga falta expiración inmediata, comprobando disponibilidad por versión. Porqué: ambas experiencias son distintas y `updateTag` no es una API de Route Handlers. Gate: `tests de mutación seguida de lectura`
- **MUST** Incluir autorización y variación relevante en la identidad de toda caché personalizada. Porqué: una key incompleta puede servir datos de un usuario a otro. Gate: `tests con dos identidades y entradas distintas`

### Autenticación y límites

- **MUST** Tratar Server Actions y Route Handlers como endpoints accesibles: validar inputs, autenticar y autorizar cada operación y recurso. Porqué: invocarlos desde UI propia no los vuelve confiables ni privados. Gate: `tests de input inválido, anónimo y usuario sin permiso`
- **MUST** Comprobar autorización cerca del acceso a datos después de recibir cualquier ID del cliente. Porqué: una sesión válida no demuestra ownership del recurso solicitado. Gate: `tests de acceso cruzado entre usuarios`
- **MUST** No considerar ocultar un botón, validar en un layout o ejecutar proxy como protección suficiente de todas las entradas. Porqué: otras rutas y llamadas directas pueden evitar esa capa visual o anticipada. Gate: `tests directos de Actions y Route Handlers`
- **MUST** Devolver al cliente solo los campos necesarios y mapear errores internos a un contrato público. Porqué: serializar entidades completas o excepciones filtra información sin utilidad para la interfaz. Gate: `tests del payload y snapshot explícito del contrato público`

### Entrega de interfaz

- **MUST** Definir metadata estática o `generateMetadata` según el contenido y mantener esas exportaciones en Server Components. Porqué: metadata forma parte de la respuesta de servidor y no necesita convertir la ruta a cliente. Gate: `build y test de metadata renderizada`
- **MUST** Para imágenes responsivas, configurar dimensiones o `fill`, un `sizes` coherente con el layout y `remotePatterns` acotado. Porqué: esos datos evitan layout shift, descargas sobredimensionadas y orígenes no previstos. Gate: build y prueba responsive de `next/image`
- **MUST** Escribir `alt` según el propósito de la imagen y no copiar configuración de imágenes deprecada de tutoriales viejos. Porqué: accesibilidad y seguridad del loader dependen del contrato actual, no de sintaxis histórica. Gate: `linter de accesibilidad y documentación de la versión`

### Testing y producción

- **MUST** Para E2E, probar contra build y servidor de producción cuando el flujo dependa de render, rutas o assets. Porqué: el dev server tiene compilación, errores y rendimiento distintos del artefacto desplegable. Gate: `next build` más servidor de producción y runner E2E
- **MUST** Ejecutar lint como gate independiente cuando la versión no lo incluye en build; en Next 16 ni `next build` ni el removido `next lint` lo reemplazan. Porqué: un build verde no demuestra que reglas React, accesibilidad o estándares pasen. Gate: script `lint` del repo
- **MUST** Verificar el runtime real de cada ruta antes de usar APIs de Node o Edge. Porqué: compilar una importación no garantiza que la plataforma elegida exponga esa API. Gate: `build y prueba desplegable del runtime afectado`
- **MUST** Cubrir navegación, carga, error, autorización, accesibilidad y recursos de los flujos modificados. Porqué: la página inicial feliz no verifica transiciones ni fallos del sistema. Gate: `tests de integración o E2E del repo`

### Verificación

- **MUST** Ejecutar lint, typecheck, tests y build mediante los scripts existentes. Porqué: Next ya no combina necesariamente esos controles y cada uno encuentra una clase distinta de defecto. Gate: scripts de CI declarados en `package.json`
- **MUST** Verificar explícitamente la política de caché y autorización de cada lectura o mutación modificada. Porqué: ambos comportamientos pueden parecer correctos para un único usuario y fallar entre requests. Gate: `tests multiusuario y de revalidación`
- **MUST** Informar versión, router, modelo de caché, runtime y comandos ejecutados, junto con cualquier prueba de producción pendiente. Porqué: la evidencia solo es interpretable si nombra el entorno al que aplica. Gate: `reporte final` con configuración, comando y resultado

### Lectura ampliada

- [Next.js: AI Coding Agents](https://nextjs.org/docs/app/guides/ai-agents) — documentación versionada e índices para agentes.
- [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — fronteras, serialización y grafo cliente.
- [Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data) — lecturas de servidor, streaming y concurrencia.
- [Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) — cuándo usar Route Handlers y por qué evitar el salto interno.
- [Caching with Cache Components](https://nextjs.org/docs/app/getting-started/caching) — modelo opt-in y APIs relacionadas.
- [Caching without Cache Components](https://nextjs.org/docs/app/guides/caching-without-cache-components) — defaults y caché explícita de `fetch`.
- [Revalidating](https://nextjs.org/docs/app/getting-started/revalidating) — tags, stale-while-revalidate e invalidación inmediata.
- [Authentication](https://nextjs.org/docs/app/guides/authentication) — controles en Actions, handlers y capa de datos.
- [Metadata and OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) — metadata desde servidor.
- [Next Image](https://nextjs.org/docs/app/api-reference/components/image) — dimensiones, `sizes`, origins y `alt`.
- [Production checklist](https://nextjs.org/docs/app/guides/production-checklist) — controles antes de desplegar.
- [Playwright](https://nextjs.org/docs/app/guides/testing/playwright) — E2E contra producción.
- [Upgrading to Next 16](https://nextjs.org/docs/app/guides/upgrading/version-16) — lint, request APIs y proxy.
