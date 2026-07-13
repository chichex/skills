#!/usr/bin/env bash
#
# Instala/actualiza los skills de este repo en Claude Code y opencode.
# Hace git pull y copia cada skill a su carpeta, SIN borrar los otros skills
# que ya tengas: solo agrega/actualiza los que vienen del repo.
#
# Uso:
#   ./install.sh              # instala ambos sets (claude + opencode)
#   ./install.sh claude       # solo los de Claude Code
#   ./install.sh opencode     # solo los de opencode
#
# Overrides por variable de entorno (destinos):
#   CLAUDE_SKILLS_DIR    (default: ~/.claude/skills)
#   OPENCODE_SKILLS_DIR  (default: ~/.config/opencode/skills)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
OPENCODE_DEST="${OPENCODE_SKILLS_DIR:-$HOME/.config/opencode/skills}"
WHICH="${1:-both}"

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

case "$WHICH" in
  both)     install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST"
            install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  claude)   install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST" ;;
  opencode) install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  *) echo "Argumento inválido: '$WHICH' (usá: both | claude | opencode)" >&2; exit 2 ;;
esac

echo
echo "Listo."
