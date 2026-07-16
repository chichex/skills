#!/usr/bin/env bash
#
# Instala/actualiza los skills de este repo en Claude Code, opencode y Pi,
# junto con las extensiones de Pi.
# Hace git pull y copia cada skill a su carpeta, SIN borrar los otros skills
# que ya tengas: solo agrega/actualiza los que vienen del repo.
#
# Uso:
#   ./install.sh              # instala los tres sets
#   ./install.sh all          # instala los tres sets
#   ./install.sh both         # Claude Code + opencode (compatibilidad)
#   ./install.sh claude       # solo los de Claude Code
#   ./install.sh opencode     # solo los de opencode
#   ./install.sh pi           # solo los de Pi
#
# Overrides por variable de entorno (destinos):
#   CLAUDE_SKILLS_DIR    (default: ~/.claude/skills)
#   OPENCODE_SKILLS_DIR  (default: ~/.config/opencode/skills)
#   PI_SKILLS_DIR        (default: ~/.agents/skills)
#   PI_EXTENSIONS_DIR    (default: ~/.pi/agent/extensions)
#   PI_THEMES_DIR        (default: ~/.pi/agent/themes)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
OPENCODE_DEST="${OPENCODE_SKILLS_DIR:-$HOME/.config/opencode/skills}"
PI_DEST="${PI_SKILLS_DIR:-$HOME/.agents/skills}"
PI_EXTENSIONS_DEST="${PI_EXTENSIONS_DIR:-$HOME/.pi/agent/extensions}"
PI_THEMES_DEST="${PI_THEMES_DIR:-$HOME/.pi/agent/themes}"
WHICH="${1:-all}"

# 1. traer lo último (si es un clon git)
if [ -d "$REPO_DIR/.git" ]; then
  echo "→ git pull"
  git -C "$REPO_DIR" pull --ff-only
fi

install_set() {
  local name="$1" src="$2" dest="$3"
  if [ ! -d "$src" ]; then
    echo "⚠  $name: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ $name → $dest"
  for skill in "$src"/*/; do
    [ -d "$skill" ] || continue
    local base; base="$(basename "$skill")"
    # reemplaza solo ESTE skill (limpio, sin dejar archivos viejos);
    # el resto de tu carpeta queda intacto.
    rm -rf "${dest:?}/$base"
    cp -R "$skill" "$dest/$base"
    echo "   ✓ $base"
  done
}

install_extensions() {
  local src="$1" dest="$2"
  if [ ! -d "$src" ]; then
    echo "⚠  Pi extensions: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ Pi extensions → $dest"
  for extension in "$src"/*; do
    [ -e "$extension" ] || continue
    local base; base="$(basename "$extension")"
    # Pi descubre tanto archivos .ts como carpetas con index.ts.
    rm -rf "${dest:?}/$base"
    cp -R "$extension" "$dest/$base"
    echo "   ✓ $base"
  done
}

install_themes() {
  local src="$1" dest="$2"
  if [ ! -d "$src" ]; then
    echo "⚠  Pi themes: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ Pi themes → $dest"
  for theme in "$src"/*.json; do
    [ -f "$theme" ] || continue
    local base; base="$(basename "$theme")"
    rm -f "$dest/$base"
    cp "$theme" "$dest/$base"
    echo "   ✓ $base"
  done
}

install_pi() {
  install_set "Pi skills" "$REPO_DIR/pi" "$PI_DEST"
  install_extensions "$REPO_DIR/pi-extensions" "$PI_EXTENSIONS_DEST"
  install_themes "$REPO_DIR/pi-themes" "$PI_THEMES_DEST"
}

case "$WHICH" in
  all)      install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST"
            install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST"
            install_pi ;;
  both)     install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST"
            install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  claude)   install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST" ;;
  opencode) install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  pi)       install_pi ;;
  *) echo "Argumento inválido: '$WHICH' (usá: all | both | claude | opencode | pi)" >&2; exit 2 ;;
esac

echo
echo "Listo."
