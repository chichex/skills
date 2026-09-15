---
# Mantenimiento: editar solo shared/coding-policies/references/go.md y ejecutar `node scripts/sync-coding-policies-references.mjs`.
stack: go
name: Go
version: 2026-09-14
---

### Layout de paquetes

- **MUST** `main` vive en `cmd/<binario>/main.go` (o en la raíz si el módulo tiene un solo binario) y solo hace wiring: lee la configuración, construye las dependencias y arranca. Porqué: lo que vale la pena testear vive en paquetes; un `main` gordo es lógica sin tests. Gate: —
- **MUST** Todo lo que no debe importarse desde afuera va bajo `internal/`; no crear `pkg/`. Porqué: el compilador hace cumplir el límite de API, y `pkg/` invita a exportar sin criterio. Gate: `go build ./...` (el compilador rechaza imports ajenos de `internal/`)
- **MUST** Nombrar cada paquete por lo que provee, en una palabra, minúscula y sin guiones; nunca `util`, `common`, `helpers`, `shared`, `base` ni `models`. Porqué: un paquete es una unidad de propósito; los cajones de sastre crecen sin límite y acoplan todo con todo. Gate: `find . -type d` (con nombres `util`, `common`, `helpers` o `shared` da vacío)
- **SHOULD** Separar kits reutilizables sin conocimiento del negocio (`internal/foundation/*`) de las features (`internal/business/*`); ninguna feature importa a otra, y los adapters entre features viven en `cmd/`. Porqué: la dependencia cruzada entre features es el primer paso al monolito enredado; el adapter en `cmd/` la hace visible y revisable. Gate: `golangci-lint` (depguard con las reglas foundation ∤ business y business ∤ business)

### Errores

- **MUST** Envolver con `fmt.Errorf("<paquete>: <operación>: %w", err)` al cruzar una frontera; nunca `%v` ni `err.Error()` para envolver. Porqué: `%w` conserva la cadena para `errors.Is` y `errors.As`, y el prefijo dice dónde falló sin stack trace. Gate: `golangci-lint` (errorlint)
- **MUST** Manejar todo error devuelto: se retorna, o se maneja y se sigue con el motivo escrito en el sitio; nunca `_ = f()` sin comentario. Porqué: un error ignorado es un bug diferido que aparece lejos de su causa. Gate: `golangci-lint` (errcheck)
- **MUST** Un error se maneja una sola vez: o se loggea o se retorna, nunca ambos; el log vive en el borde (middleware, `main`). Porqué: el doble manejo duplica logs y confunde quién es dueño del error. Gate: —
- **MUST** Sentinels `var ErrX = errors.New("...")` para condiciones que el caller decide con `errors.Is`; tipos de error propios solo cuando el caller necesita datos (`errors.As`); jamás comparar strings de error. Porqué: el matching por string se rompe con cualquier cambio de mensaje. Gate: `golangci-lint` (errorlint)
- **SHOULD** Mensajes de error en minúscula, sin puntuación final y accionables: dicen qué pasó y qué hacer. Porqué: se concatenan en cadenas `a: b: c`, y quien los lee tiene que poder actuar. Gate: `golangci-lint` (staticcheck: ST1005)
- **SHOULD** Mapear errores a códigos HTTP o exit codes en la frontera (handler o `main`) con una tabla explícita por sentinel y un fallback genérico que no exponga el error crudo. Porqué: el service no sabe de HTTP, y un 500 con el error interno filtra detalles al cliente. Gate: —
- **SHOULD** Modelar "no encontrado" que no es falla con `(valor, ok bool, err error)` o un sentinel `ErrNotFound`; nunca `nil, nil` sin documentar. Porqué: el caller necesita distinguir ausencia de fallo, y un 401 silenciado como "no existe" esconde un problema de credenciales. Gate: —
- **MUST** No usar `panic` para errores esperables fuera de `main`; `recover` solo en el borde de una goroutine que no puede tirar el proceso. Porqué: un panic en un paquete mata al proceso ajeno que lo importa. Gate: `golangci-lint` (forbidigo: `panic(` fuera de `main`)

### Naming

- **MUST** Receivers de una o dos letras, consistentes en todos los métodos del tipo (`s *service`, `r *repo`); nunca `this` ni `self`. Porqué: el receiver se lee cientos de veces y su nombre no aporta información. Gate: `golangci-lint` (revive: receiver-naming)
- **MUST** Acrónimos en mayúscula sostenida en identificadores: `ID`, `URL`, `HTTP`, `API`, `DNI` (`userID`, `PhotoURL`, nunca `userId`). Porqué: es la convención del ecosistema y lo que los linters esperan. Gate: `golangci-lint` (revive: var-naming)
- **MUST** Getters sin prefijo `Get`: `Slug()`, no `GetSlug()`; `Get*` se reserva para operaciones con I/O (`GetByID`). Porqué: el prefijo no agrega información y ensucia el API. Gate: —
- **MUST** Evitar el stutter paquete.Tipo: `registry.Client`, no `registry.RegistryClient`. Porqué: el nombre siempre se lee calificado por el paquete. Gate: `golangci-lint` (revive: exported)
- **SHOULD** Interfaces de un método con sufijo `-er` (`TagLister`, `Mailer`); los puertos principales con el sustantivo del rol (`Repository`, `Service`, `Driver`). Porqué: el nombre dice el rol sin abrir la definición. Gate: —
- **SHOULD** Variables cortas en scopes cortos (`i`, `ctx`, `dev`, `fs`) y nombres más largos cuanto más lejos se usan; constantes agrupadas por familia con prefijo común (`LabelProject`, `LabelService`). Porqué: la longitud del nombre es proporcional a la distancia entre declaración y uso. Gate: —

### Interfaces y tipos

- **MUST** Interfaces chicas (1 a 3 métodos) declaradas del lado del consumidor cuando cruzan paquetes, con su propio DTO de proyección; el puerto grande de un paquete (`Repository`, `Service`, `Driver`) vive junto a su implementación, documentado por grupos de métodos. Porqué: el consumidor depende solo de lo que usa, y el fake queda trivial. Gate: —
- **MUST** Constructores `New...` que reciben las dependencias por parámetro; sin `init()` con efectos ni estado global mutable. Porqué: las dependencias explícitas se testean y se reemplazan; los globals esconden el grafo. Gate: `golangci-lint` (gochecknoinits, gochecknoglobals)
- **SHOULD** Lo opcional se expresa con campos exportados nil-ables documentados (`// optional; nil disables`) o constructores alternativos explícitos (`NewTo`, `NewServiceWithClock`); sin functional options. Porqué: las options esconden qué combinaciones son válidas y agregan código; un campo `nil` documentado se lee en el struct. Gate: —
- **MUST** Receiver puntero para tipos con estado o mutables; receiver de valor solo para tipos-valor chicos e inmutables (`LocalDate`, `Device`); nunca mezclar en un mismo tipo. Porqué: mezclar produce copias inesperadas y métodos que no ven mutaciones. Gate: `golangci-lint` (recvcheck)
- **MUST** Mutex como campo nombrado `mu`, primero en el struct, nunca embebido ni exportado; el lock cubre exactamente los campos que protege. Porqué: embeberlo exporta `Lock` y `Unlock` en el API público del tipo. Gate: —

### Concurrencia

- **MUST** `ctx context.Context` es el primer parámetro de toda función que hace I/O; se propaga, no se guarda en structs, y se nombra `_` si no se usa. Porqué: la cancelación y los deadlines viajan por el ctx; guardarlo en un struct lo desacopla del request. Gate: `golangci-lint` (contextcheck, containedctx)
- **MUST** Toda goroutine tiene dueño y salida: `sync.WaitGroup` o `errgroup` en el mismo scope, o un `select` sobre `ctx.Done()` y un canal de stop; un proceso deliberadamente long-lived se documenta en el sitio. Porqué: una goroutine sin dueño es un leak y un panic invisible. Gate: —
- **MUST** Pasar las variables del loop como parámetros a la goroutine (`go func(i int, d Driver) {...}(i, d)`), y transportar valor y error por índice en un slice pre-dimensionado antes que por canal. Porqué: la captura del iterador se lee ambigua aunque Go 1.22 la haya corregido, y el slice por índice evita mutex y conserva el orden. Gate: `go vet` (loopclosure)
- **MUST** Timeouts explícitos en cada frontera de I/O: `context.WithTimeout` por operación de repositorio o cliente, `http.Client{Timeout: ...}`, `ReadHeaderTimeout` en servidores, y `cancel()` siempre invocado. Porqué: sin timeout, un socket colgado bloquea la request y drena el pool. Gate: `go vet` (lostcancel) y `golangci-lint` (noctx, bodyclose)
- **MUST** Shutdown ordenado en `main`: `signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)` y `srv.Shutdown` con un timeout acotado. Porqué: perder requests en vuelo en cada deploy es un bug reproducible. Gate: —
- **SHOULD** Reloj inyectable (`now func() time.Time`, default `time.Now`) en servicios que dependen del tiempo, y `time.Now().UTC()` al persistir. Porqué: sin seam de reloj los tests de fechas son frágiles; sin UTC, la hora depende del host. Gate: —

### Testing

- **MUST** Tests table-driven con `t.Run(tc.name, ...)`, nombres de caso en prosa que describan el escenario, y `TestFunc_Escenario` como nombre del test. Porqué: el nombre es la spec; un fallo se entiende sin abrir el código. Gate: —
- **MUST** Aserciones con la stdlib (`t.Fatalf("x = %q, want %q", got, want)`) o `testify/require`; nunca `assert` que deje seguir un test ya roto. Porqué: un assert que no frena produce cascadas de fallos falsos. Gate: `golangci-lint` (testifylint)
- **MUST** Dobles escritos a mano que implementan la interfaz, con contadores de llamadas y errores inyectables, extendidos por embedding para cada escenario; sin gomock ni mockery. Porqué: el fake se lee, se adapta en el mismo archivo y no regenera código. Gate: —
- **MUST** Aislar con recursos reales baratos antes que con mocks: `httptest`, `t.TempDir()` con SQLite, el binario real; mocks solo en límites de sistema. Porqué: el test que habla con lo real detecta el bug que el mock oculta. Gate: —
- **MUST** `t.Helper()` en todo helper compartido y `t.Cleanup()` para liberar recursos. Porqué: sin `Helper` el fallo apunta al helper y no al test; `Cleanup` corre aunque el test haga `Fatal`. Gate: `golangci-lint` (thelper)
- **SHOULD** Extraer el núcleo puro de toda función que toca el mundo (dispositivo, red, base) a una función sin I/O y testearla directo; `export_test.go` como único seam white-box. Porqué: el test unitario corre en milisegundos y sin fixtures, y el resto se cubre con integración. Gate: —

### Dependencias y configuración

- **MUST** Preferir la stdlib; cada dependencia directa nueva se justifica en el PR (qué no resuelve `net/http`, `flag`, `log/slog`, `database/sql`) y se revisa su árbol transitivo. Porqué: cada dependencia es superficie de ataque, tiempo de build y deuda de upgrade. Gate: `go mod why` (revisar el diff de `go.mod` en el PR)
- **MUST** `go.mod` limpio: `go mod tidy` sin diff, sin `replace` a rutas locales, y la directiva `go` alineada con la versión que corre CI. Porqué: un `go.sum` con drift rompe builds reproducibles. Gate: `go mod tidy` (`git diff --exit-code go.mod go.sum`)
- **MUST** Configuración por variables de entorno leídas en `main` o en un paquete `config` con `Validate()` fail-closed, y pasadas como valores; nunca `os.Getenv` disperso en la lógica. Porqué: la configuración dispersa no se testea ni se documenta. Gate: `golangci-lint` (forbidigo: `os.Getenv` fuera de `main` y `config`)
- **MUST** `gofmt` y `go vet` limpios en CI; imports en tres grupos: stdlib, terceros, módulo propio. Porqué: es el mínimo que todo el ecosistema asume y lo que evita diffs de formato. Gate: `gofmt -l .` (vacío) y `go vet ./...`
- **SHOULD** `golangci-lint` con lista explícita de linters (`default: none` más `errcheck`, `govet`, `staticcheck`, `gosec`, `errorlint`, `revive`) y versión pineada en CI. Porqué: el set default cambia entre versiones y rompe CI sin tocar código. Gate: `golangci-lint run`

### Lectura ampliada

- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) — la guía base de estilo: errores, interfaces, concurrencia, tests.
- [Effective Go](https://go.dev/doc/effective_go) — idioms del lenguaje: nombres, getters, interfaces, embedding.
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) — checklist de review: receivers, acrónimos, contexts, error strings.
- [Package Oriented Design](https://www.ardanlabs.com/blog/2017/02/package-oriented-design.html) — layout `cmd/` e `internal/`, kits y business; el porqué de no tener `util`.
