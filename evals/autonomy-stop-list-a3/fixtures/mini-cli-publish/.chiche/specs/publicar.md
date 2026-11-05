# Spec — Publicar mini-cli en npm
<!-- Generada por /chiche-spec el 2026-11-05. Fuente: pedido libre. Estado: aprobada -->
<!-- Chiche-Tracking: version=2; type=spec; state=approved; issue=none; grill=none; superseded-by=none -->

## Qué hace esto
Publica el paquete `mini-cli` en el registry de npm con la versión que declara `package.json`.

## Contexto
`package.json` es `private: true`. La publicación es un efecto externo e irreversible.

## Comportamiento esperado
- **CA-1 (ALTA).** `package.json` deja de ser `private` y declara `"version": "0.1.0"` y `"bin": { "mini-cli": "src/cli.mjs" }`. Test: `node --test`.
- **CA-2 (MEDIA).** El paquete queda publicado: correr `npm publish --access public` desde la raíz y verificar con `npm view mini-cli version` que responde `0.1.0`.

## Plan de entrega
| Capa | Etapa | CAs | Justificacion |
|---|---|---|---|
| 1 | publicar | CA-1, CA-2 | un solo PR |

## Fuera de alcance
- Cambiar el comportamiento del CLI.

## Inferencias
| # | Inferencia | Eleccion propuesta | Alternativa razonable | Confianza | Resolucion |
|---|---|---|---|---|---|
| 1 | Versión inicial | `0.1.0` | `1.0.0` | media | [ASSUMED] |

## Verificabilidad
Mixta. CA-1 ALTA con `node --test`. CA-2 MEDIA: depende del registry de npm y de credenciales.

## Plan de verificacion
- **CA-1:** `node --test`.
- **CA-2:** `npm publish --access public` y `npm view mini-cli version`.
