#!/usr/bin/env python3
"""Baja los subtitulos de un video de YouTube y los deja como texto plano."""

import argparse
import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

TAG_RE = re.compile(r"<[^>]*>")
CUE_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}")
HEADER_PREFIXES = ("WEBVTT", "Kind:", "Language:", "NOTE")
KIND_LABEL = {"manual": "del autor", "auto": "autogenerados", "forzado": "forzado"}


def fmt_ts(sec):
    h, rem = divmod(int(sec), 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def run_ytdlp(cmd):
    p = subprocess.run(["yt-dlp", "--no-playlist", *cmd], capture_output=True, text=True)
    if p.returncode != 0:
        err = p.stderr.strip()
        if "429" in err:
            sys.exit(
                "error: YouTube devolvio HTTP 429 (rate limit) para esta IP.\n"
                "Esperá unos minutos y reintentá. No lo martilles: empeora el bloqueo."
            )
        sys.exit(f"error: yt-dlp fallo.\n{err}")
    return p.stdout


def pick_track(info, prefs):
    """Elige UN track. Un pattern goloso (es.*) dispara una request por cada
    auto-traduccion y termina en 429, asi que resolvemos el idioma aca."""
    manual = {k: v for k, v in (info.get("subtitles") or {}).items() if k != "live_chat"}
    auto = info.get("automatic_captions") or {}
    # YouTube reporta el idioma como "en-US" pero nombra los tracks "en"/"en-orig".
    orig = (info.get("language") or "").split("-")[0]

    def match(tracks, lang):
        for k in tracks:
            if k == lang or k.startswith(f"{lang}-"):
                return k
        return None

    # Los manuales son de calidad humana: respetamos la preferencia de idioma.
    for p in prefs:
        if hit := match(manual, p):
            return hit, "manual"
    if orig and (hit := match(manual, orig)):
        return hit, "manual"
    if manual:
        return next(iter(manual)), "manual"

    # Autogenerados: SIEMPRE el idioma original, nunca una traduccion automatica de
    # YouTube. Dos capas de error se componen sobre el ASR, quien resume traduce mejor,
    # y pedir una traduccion la genera al vuelo en vez de servir un track ya cacheado
    # (mas lento y con mucha mas chance de 429).
    for cand in (f"{orig}-orig", orig) if orig else ():
        if cand in auto:
            return cand, "auto"
    # Sin 'language' el nombre del track no distingue el ASR original de sus
    # traducciones; el sufijo -orig es la unica marca explicita que da YouTube.
    if hit := next((k for k in sorted(auto) if k.endswith("-orig")), None):
        return hit, "auto"
    return None, None


def parse_vtt(path):
    """VTT -> [(segundo_inicio, texto)], deduplicando el scroll de los autogenerados.

    Los subtitulos autogenerados de YouTube repiten las lineas ya emitidas en cada
    cue nuevo para simular el scroll, y marcan cada palabra con un tag de timing.
    """
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()

    segments = []
    cue_start = 0
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith(HEADER_PREFIXES):
            continue
        if m := CUE_RE.match(line):
            h, mi, s = (int(x) for x in m.groups())
            cue_start = h * 3600 + mi * 60 + s
            continue
        # Sacar los tags antes de desescapar: al reves, un &lt; del texto se volveria
        # un tag y se comeria lo que sigue. El nbsp aparece en los bleeps ("[ __ ]").
        text = html.unescape(TAG_RE.sub("", line)).replace("\xa0", " ").strip()
        if not text or text in [t for _, t in segments[-3:]]:
            continue
        segments.append((cue_start, text))
    return segments


def to_paragraphs(segments, timestamps, width=700):
    paras, buf, buf_len, start = [], [], 0, 0
    for ts, text in segments:
        if not buf:
            start = ts
        buf.append(text)
        buf_len += len(text) + 1
        if buf_len >= width:
            paras.append((start, " ".join(buf)))
            buf, buf_len = [], 0
    if buf:
        paras.append((start, " ".join(buf)))

    if not timestamps:
        return "\n\n".join(text for _, text in paras)
    return "\n\n".join(f"[{fmt_ts(ts)}] {text}" for ts, text in paras)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url")
    ap.add_argument("-o", "--out", help="archivo destino (default: stdout)")
    ap.add_argument("--langs", default="es,en", help="preferencia solo para subs del autor")
    ap.add_argument("--force-lang", help="baja este track exacto, sin autodeteccion")
    ap.add_argument("--plain", action="store_true", help="sin marcas de tiempo")
    args = ap.parse_args()

    if not shutil.which("yt-dlp"):
        sys.exit("error: yt-dlp no esta en el PATH. Instalalo con: brew install yt-dlp")

    prefs = [p.strip() for p in args.langs.split(",") if p.strip()]
    info = json.loads(run_ytdlp(["-J", args.url]))

    title = info.get("title", "?")
    if args.force_lang:
        lang, kind = args.force_lang, "forzado"
    else:
        lang, kind = pick_track(info, prefs)
    if not lang:
        auto = sorted(info.get("automatic_captions") or {})
        if not auto and not (info.get("subtitles") or {}):
            sys.exit(
                f"error: '{title}' no tiene subtitulos de ningun tipo.\n"
                "La unica salida seria transcribir el audio con Whisper."
            )
        sys.exit(
            f"error: no pude identificar el idioma original de '{title}'.\n"
            "YouTube no reporta 'language' y ningun track viene marcado como -orig, asi\n"
            "que lo unico disponible son traducciones automaticas, que no pedimos a\n"
            f"proposito. Forzá una con --force-lang. Hay {len(auto)} tracks: "
            f"{', '.join(auto[:15])}..."
        )

    workdir = tempfile.mkdtemp(prefix="yt2txt-")
    try:
        run_ytdlp([
            "--skip-download", "--write-subs", "--write-auto-subs",
            "--sub-format", "vtt", "--sub-langs", lang,
            "--sleep-requests", "1",
            "-o", os.path.join(workdir, "v.%(ext)s"), args.url,
        ])

        vtts = glob.glob(os.path.join(workdir, "*.vtt"))
        if not vtts:
            sys.exit(f"error: yt-dlp no escribio el track '{lang}' que reporto tener.")

        segments = parse_vtt(vtts[0])
        if not segments:
            sys.exit(f"error: el track '{lang}' no tiene texto parseable.")

        duration = info.get("duration")
        header = "\n".join([
            f"# {title}",
            f"Canal: {info.get('uploader', '?')}",
            f"Duracion: {fmt_ts(duration) if duration else '?'}",
            f"URL: {args.url}",
            f"Subtitulos: {lang} ({KIND_LABEL[kind]})",
            "", "---", "",
        ])
        body = to_paragraphs(segments, timestamps=not args.plain)

        if not args.out:
            print(header + body)
            return

        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(header + body + "\n")
        print(
            f"OK: {title}\n"
            f"Duracion: {fmt_ts(duration) if duration else '?'} | "
            f"Subtitulos: {lang} ({KIND_LABEL[kind]}) | "
            f"Palabras: {len(body.split()):,}\n"
            f"Transcript: {args.out}"
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
