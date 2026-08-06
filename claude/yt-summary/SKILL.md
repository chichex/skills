---
name: yt-summary
description: Resume un video de YouTube bajando sus subtítulos. Usar cuando el usuario pasa una URL de YouTube y pide un resumen, un TL;DR, los puntos clave, de qué habla, o quiere el transcript crudo. Requiere yt-dlp; no sirve para videos sin subtítulos.
---

# yt-summary

Baja los subtítulos de un video de YouTube y los resumís vos. El script solo consigue
el texto — no hay ningún LLM en la cadena, el resumen lo escribís con lo que leas.

## Flujo

1. Corré el script, siempre con `-o` a un archivo (nunca a stdout: un video de 2h son
   ~30k palabras y no querés volcarlas de una).

   ```bash
   python3 ~/.claude/skills/yt-summary/yt2txt.py "<url>" -o /tmp/yt-<id>.txt
   ```

   Imprime título, duración, palabras y el path. Si el video es corto (< 5k palabras)
   podés correrlo sin `-o` y leer la salida directo.

2. Leé el archivo con Read y resumí.

Flags: `--langs` es la preferencia de idioma **solo para los subtítulos del autor**
(default `es,en`), `--force-lang <code>` baja un track exacto salteando la
autodetección, `--plain` saca las marcas de tiempo.

El script elige un solo track y **nunca** pide una traducción automática de YouTube: si
el video solo tiene autogenerados, baja el ASR en el idioma original aunque no sea el
tuyo. El ASR ya mete bastante error como para apilarle encima el del traductor, y pedir
una traducción la genera al vuelo — es lento y se come un 429.

**La traducción la hacés vos.** El transcript puede venir en cualquier idioma; el
resumen va siempre en el del usuario. Es parte del trabajo: no lo aclares ni te
disculpes, traducilo y ya.

## El resumen

Salvo que el usuario pida otra cosa, devolvé:

- Un TL;DR de dos o tres frases: qué sostiene el video, no de qué trata.
- Los puntos principales, cada uno anclado a su timestamp `[MM:SS]` para que pueda
  saltar al momento.
- Si el video tiene una conclusión o recomendación concreta, decila explícita.

El transcript viene con timestamps cada ~700 caracteres: usalos, son la parte que hace
útil al resumen. No inventes un timestamp que no esté en el texto.

## Modo puntos destacables

Si el pedido trae un número — `--puntos 10`, "dame 10 aprendizajes", "5 cosas
destacables" — devolvé hasta esa cantidad, numerados y con timestamp, en vez del
resumen narrativo.

Un punto destacable es algo que el usuario se lleva y aplica en otro lado. "Habla de
context management" no es un punto: es un índice. "Podar el contexto en cada turno te
mata el prompt cache" sí lo es. Priorizá lo transferible y lo contraintuitivo sobre lo
que el video dedica más minutos.

**Si el video no da para el número pedido, devolvé los que haya y decí cuántos son.**
Nunca completes con obviedades, con cosas que cualquiera ya sabe, ni con inferencias
tuyas que el video no sostiene. Cuatro puntos buenos valen más que diez flojos, y el
número que te pidieron es un techo, no una cuota.

Los subtítulos autogenerados no tienen puntuación confiable y equivocan nombres propios
y términos técnicos. Si algo se lee raro, es el ASR — marcalo como incierto en vez de
afirmarlo, y no cites textual de un autogenerado sin aclarar que es aproximado.

## Cuando falla

- **Sin subtítulos**: el script sale con error y lista lo que yt-dlp sí encontró. Si hay
  otro idioma disponible, reintentá con `--langs`. Si no hay ninguno, decí que el video
  no tiene captions y que la única salida es transcribir el audio con Whisper — no lo
  hagas por tu cuenta sin preguntar, es otro orden de trabajo.
- **HTTP 429**: YouTube rate-limitea. Esperá un rato y reintentá; no lo martilles.
- **yt-dlp desactualizado**: si falla la extracción en videos que antes andaban, YouTube
  suele haber cambiado algo. `brew upgrade yt-dlp` lo arregla casi siempre.
