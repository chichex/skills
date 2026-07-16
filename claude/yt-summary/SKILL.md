---
name: yt-summary
description: Resume un video de YouTube bajando sus subtitulos. Usar cuando el usuario pasa una URL de YouTube y pide un resumen, un TL;DR, los puntos clave, de que habla, o quiere el transcript crudo. Requiere yt-dlp; no sirve para videos sin subtitulos.
---

# yt-summary

Baja los subtitulos de un video de YouTube y los resumis vos. El script solo consigue
el texto — no hay ningun LLM en la cadena, el resumen lo escribis con lo que leas.

## Flujo

1. Corre el script, siempre con `-o` a un archivo (nunca a stdout: un video de 2h son
   ~30k palabras y no queres volcarlas de una).

   ```bash
   python3 ~/.claude/skills/yt-summary/yt2txt.py "<url>" -o /tmp/yt-<id>.txt
   ```

   Imprime titulo, duracion, palabras y el path. Si el video es corto (< 5k palabras)
   podes correrlo sin `-o` y leer la salida directo.

2. Lee el archivo con Read y resumi.

Flags: `--langs` es la preferencia de idioma **solo para los subtitulos del autor**
(default `es,en`), `--force-lang <code>` baja un track exacto salteando la
autodeteccion, `--plain` saca las marcas de tiempo.

El script elige un solo track y **nunca** pide una traduccion automatica de YouTube: si
el video solo tiene autogenerados, baja el ASR en el idioma original aunque no sea el
tuyo. El ASR ya mete bastante error como para apilarle encima el del traductor, y pedir
una traduccion la genera al vuelo — es lento y se come un 429.

**La traduccion la hacés vos.** El transcript puede venir en cualquier idioma; el
resumen va siempre en el del usuario. Es parte del trabajo: no lo aclares ni te
disculpes, traducilo y ya.

## El resumen

Salvo que el usuario pida otra cosa, devolve:

- Un TL;DR de dos o tres frases: que sostiene el video, no de que trata.
- Los puntos principales, cada uno anclado a su timestamp `[MM:SS]` para que pueda
  saltar al momento.
- Si el video tiene una conclusion o recomendacion concreta, decila explicita.

El transcript viene con timestamps cada ~700 caracteres: usalos, son la parte que hace
util al resumen. No inventes un timestamp que no este en el texto.

## Modo puntos destacables

Si el pedido trae un numero — `--puntos 10`, "dame 10 aprendizajes", "5 cosas
destacables" — devolve hasta esa cantidad, numerados y con timestamp, en vez del
resumen narrativo.

Un punto destacable es algo que el usuario se lleva y aplica en otro lado. "Habla de
context management" no es un punto: es un indice. "Podar el contexto en cada turno te
mata el prompt cache" si lo es. Priorizá lo transferible y lo contraintuitivo sobre lo
que el video dedica mas minutos.

**Si el video no da para el numero pedido, devolve los que haya y deci cuantos son.**
Nunca completes con obviedades, con cosas que cualquiera ya sabe, ni con inferencias
tuyas que el video no sostiene. Cuatro puntos buenos valen mas que diez flojos, y el
numero que te pidieron es un techo, no una cuota.

Los subtitulos autogenerados no tienen puntuacion confiable y equivocan nombres propios
y terminos tecnicos. Si algo se lee raro, es el ASR — marcalo como incierto en vez de
afirmarlo, y no cites textual de un autogenerado sin aclarar que es aproximado.

## Cuando falla

- **Sin subtitulos**: el script sale con error y lista lo que yt-dlp si encontro. Si hay
  otro idioma disponible, reintenta con `--langs`. Si no hay ninguno, deci que el video
  no tiene captions y que la unica salida es transcribir el audio con Whisper — no lo
  hagas por tu cuenta sin preguntar, es otro orden de trabajo.
- **HTTP 429**: YouTube rate-limitea. Espera un rato y reintenta; no lo martilles.
- **yt-dlp desactualizado**: si falla la extraccion en videos que antes andaban, YouTube
  suele haber cambiado algo. `brew upgrade yt-dlp` lo arregla casi siempre.
