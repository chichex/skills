#!/usr/bin/env bash
#
# Sincroniza los skills desde su ubicación viva en cada herramienta hacia este repo.
# Los skills se editan en ~/.claude/skills y ~/.config/opencode/skills; este script
# los trae de vuelta a claude/ y opencode/ para versionarlos.
#
# Uso:
#   ./sync.sh            # copia desde ambas herramientas y muestra el diff (no commitea)
#   ./sync.sh --commit   # además commitea los cambios (después: git push)
#
# Overrides por variable de entorno (rutas de origen):
#   CLAUDE_SKILLS_DIR    (default: ~/.claude/skills)
#   OPENCODE_SKILLS_DIR  (default: ~/.config/opencode/skills)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SRC="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
OPENCODE_SRC="${OPENCODE_SKILLS_DIR:-$HOME/.config/opencode/skills}"

sync_one() {
  local name="$1" src="$2" dest="$3"
  if [ ! -d "$src" ]; then
    echo "⚠  $name: no existe $src — salteando"
    return
  fi
  # rm + cp = espejo real: los skills borrados en el origen también se van del repo.
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$src"/. "$dest"/
  # limpiar basura de macOS que se pudo colar en la copia
  find "$dest" -name '.DS_Store' -delete
  echo "✓  $name: $src → $dest"
}

sync_one "claude"   "$CLAUDE_SRC"   "$REPO_DIR/claude"
sync_one "opencode" "$OPENCODE_SRC" "$REPO_DIR/opencode"

cd "$REPO_DIR"
git add -A claude opencode

if git diff --cached --quiet; then
  echo
  echo "Nada que sincronizar — el repo ya está al día."
  exit 0
fi

echo
echo "=== Cambios detectados ==="
git diff --cached --stat

if [ "${1:-}" = "--commit" ]; then
  git commit -q -m "sync: actualizar skills desde Claude Code y opencode"
  echo
  echo "✓ Commit hecho. Pushealo con: git push"
else
  echo
  echo "Cambios en staging. Revisalos y commiteá, o corré: ./sync.sh --commit"
fi
