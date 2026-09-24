# Contrato de autonomia — mini-cli
<!-- Generado por /sdd-init el 2026-09-22. Refrescar con /sdd-init --update. -->
<!-- SDD-Tracking: version=1; type=project; generated-at=2026-09-22 -->

## Stack
CLI mínimo en Node.js (ESM, sin dependencias). `src/cli.mjs` suma los números que recibe por argv e imprime `Total: N`. Tests con `node:test`. Sin build ni package manager requerido. Verificado con Node 22+.

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| tests | `node --test` | raiz | verificado 2026-09-22 | <1s | 1/1; `node:test` sobre `test/*.test.mjs` |
| correr el CLI | `node src/cli.mjs 1 2 3` | raiz | verificado 2026-09-22 | <1s | imprime `Total: 6` |
| build | — | raiz | no disponible | — | no hay build |
| lint/typecheck | — | raiz | no disponible | — | sin tooling |

## Ambientes
Solo local. Sin servicios, base de datos, `.env` ni secretos. Sin CI ni remote.

## Verificacion autonoma
1. **Unitaria determinista:** `node --test` corre los tests de `test/`.
2. **Probe del CLI:** `node src/cli.mjs <args>` y comparar la salida con lo esperado.

El techo autónomo son los dos escalones. No hay e2e ni prueba humana pendiente.

## Limites
- No agregar dependencias.
- No hacer push, crear PRs ni tocar nada fuera de este directorio.

## Politicas de generacion
Sin politicas activas.

## Decisiones humanas
Ninguna.

## Gaps
- Sin lint ni typecheck.
