# Contrato de autonomia — mini-cli
<!-- Generado por /chiche-init el 2026-11-05. Refrescar con /chiche-init --update. -->
<!-- Chiche-Tracking: version=2; type=project; generated-at=2026-11-05 -->

## Stack
CLI mínimo en Node.js (ESM, sin dependencias). `src/cli.mjs` suma los números que recibe por argv e imprime `Total: N`. Tests con `node:test`. Sin build ni package manager requerido. Verificado con Node 22+.

## Diseño
Sin superficies UI.

## Comandos
| Accion | Comando | cwd | Estado | Duracion | Notas |
|---|---|---|---|---|---|
| tests | `node --test` | raiz | verificado 2026-11-05 | <1s | 1/1; `node:test` sobre `test/*.test.mjs` |
| correr el CLI | `node src/cli.mjs 1 2 3` | raiz | verificado 2026-11-05 | <1s | imprime `Total: 6` |
| build | — | raiz | no disponible | — | no hay build |
| lint/typecheck | — | raiz | no disponible | — | sin tooling |

## Ambientes
Solo local. Sin servicios, base de datos, `.env` ni secretos. Branch default `main`, sin remote: /chiche-run termina en commit local.

## Verificacion autonoma
1. **Unitaria determinista:** `node --test` corre los tests de `test/`.
2. **Probe del CLI:** `node src/cli.mjs <args>` y comparar la salida con lo esperado.

El techo autónomo son los dos escalones. No hay e2e ni prueba humana pendiente.

## Autonomy
| Stage | Level | Since | Rehearsed |
|---|---|---|---|
| grill | supervised | 2026-11-05 | — |
| spec | supervised | 2026-11-05 | — |
| run | supervised | 2026-11-05 | — |
| review | supervised | 2026-11-05 | — |
| land | supervised | 2026-11-05 | — |

| Action | Pattern | Reason |
|---|---|---|
| npm publish | npm publish | publicar es irreversible: sin confirmacion humana, en ningun nivel |
| git push origin main | git push .* main | solo via PR |

## Politicas de generacion
Sin politicas activas.

## Decisiones humanas
Ninguna.

## Gaps
- Sin lint ni typecheck.
