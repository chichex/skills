#!/usr/bin/env bash
#
# Instala/actualiza los skills de este repo en Codex, Claude Code, opencode y Pi,
# junto con las extensiones de Pi.
# Hace git pull y copia cada skill a su carpeta, SIN borrar los otros skills
# que ya tengas: solo agrega/actualiza los que vienen del repo.
#
# Uso:
#   ./install.sh              # instala los cuatro sets
#   ./install.sh all          # instala los cuatro sets
#   ./install.sh both         # Claude Code + opencode (compatibilidad)
#   ./install.sh claude       # solo los de Claude Code
#   ./install.sh opencode     # solo los de opencode
#   ./install.sh pi           # solo los de Pi
#   ./install.sh pi-clean --confirm  # elimina solo las copias Pi administradas
#   ./install.sh codex        # solo los de Codex
#
# Overrides por variable de entorno (destinos):
#   CLAUDE_SKILLS_DIR    (default: ~/.claude/skills)
#   OPENCODE_SKILLS_DIR  (default: ~/.config/opencode/skills)
#   PI_SKILLS_DIR        (default: ~/.agents/skills)
#   PI_EXTENSIONS_DIR    (default: ~/.pi/agent/extensions)
#   PI_THEMES_DIR        (default: ~/.pi/agent/themes)
#   CODEX_SKILLS_DIR     (default: ${CODEX_HOME:-~/.codex}/skills)
#   CODEX_CONFIG_FILE    (default: ${CODEX_HOME:-~/.codex}/config.toml)
#   CODEX_DEDUPLICATE_PI_SKILLS (default: 1; usar 0 para no tocar config.toml)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
OPENCODE_DEST="${OPENCODE_SKILLS_DIR:-$HOME/.config/opencode/skills}"
PI_DEST="${PI_SKILLS_DIR:-$HOME/.agents/skills}"
PI_EXTENSIONS_DEST="${PI_EXTENSIONS_DIR:-$HOME/.pi/agent/extensions}"
PI_THEMES_DEST="${PI_THEMES_DIR:-$HOME/.pi/agent/themes}"
CODEX_DEST="${CODEX_SKILLS_DIR:-${CODEX_HOME:-$HOME/.codex}/skills}"
CODEX_CONFIG="${CODEX_CONFIG_FILE:-${CODEX_HOME:-$HOME/.codex}/config.toml}"
CODEX_DEDUPLICATE="${CODEX_DEDUPLICATE_PI_SKILLS:-1}"
WHICH="${1:-all}"
CONFIRMATION="${2:-}"

# 1. traer lo último (si es un clon git). La limpieza nunca actualiza el repo.
if [ "$WHICH" != "pi-clean" ] && [ -d "$REPO_DIR/.git" ]; then
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

clean_pi() {
  if [ "$CONFIRMATION" != "--confirm" ]; then
    echo "✗ Limpieza Pi no confirmada; no se borró nada." >&2
    echo "  Para borrar únicamente las copias administradas: ./install.sh pi-clean --confirm" >&2
    return 2
  fi

  echo "→ Limpieza Pi confirmada"
  for skill in "$REPO_DIR/pi"/*/; do
    [ -d "$skill" ] || continue
    local base target; base="$(basename "$skill")"; target="$PI_DEST/$base"
    if [ -e "$target" ] || [ -L "$target" ]; then
      rm -rf "$target"
      echo "   ✓ skill $base"
    fi
  done
  for extension in "$REPO_DIR/pi-extensions"/*; do
    [ -e "$extension" ] || continue
    local base target; base="$(basename "$extension")"; target="$PI_EXTENSIONS_DEST/$base"
    if [ -e "$target" ] || [ -L "$target" ]; then
      rm -rf "$target"
      echo "   ✓ extensión $base"
    fi
  done
  for theme in "$REPO_DIR/pi-themes"/*.json; do
    [ -f "$theme" ] || continue
    local base target; base="$(basename "$theme")"; target="$PI_THEMES_DEST/$base"
    if [ -e "$target" ] || [ -L "$target" ]; then
      rm -f "$target"
      echo "   ✓ theme $base"
    fi
  done
}

configure_codex_skill_precedence() {
  [ "$CODEX_DEDUPLICATE" = "1" ] || {
    echo "→ Codex: deduplicación de skills Pi desactivada"
    return
  }

  local begin_marker="# >>> chichex/skills: prefer Codex over Pi >>>"
  local end_marker="# <<< chichex/skills: prefer Codex over Pi <<<"
  local config_dir config_tmp block_tmp begin_count end_count
  config_dir="$(dirname "$CODEX_CONFIG")"
  mkdir -p "$config_dir"
  config_tmp="$(mktemp "$config_dir/.config.toml.XXXXXX")"
  block_tmp="$(mktemp "$config_dir/.skills-precedence.XXXXXX")"

  {
    printf '%s\n' "$begin_marker"
    printf '# Administrado por install.sh. Codex no fusiona skills con el mismo name.\n'
    for skill in "$REPO_DIR/codex"/*/; do
      [ -d "$skill" ] || continue
      local base pi_skill escaped_path
      base="$(basename "$skill")"
      pi_skill="$PI_DEST/$base/SKILL.md"
      [ -f "$REPO_DIR/pi/$base/SKILL.md" ] || continue
      escaped_path="$(printf '%s' "$pi_skill" | sed 's/\\/\\\\/g; s/"/\\"/g')"
      printf '\n[[skills.config]]\n'
      printf 'path = "%s"\n' "$escaped_path"
      printf 'enabled = false\n'
    done
    printf '%s\n' "$end_marker"
  } > "$block_tmp"

  begin_count=0
  end_count=0
  if [ -f "$CODEX_CONFIG" ]; then
    begin_count="$(grep -Fxc "$begin_marker" "$CODEX_CONFIG" || true)"
    end_count="$(grep -Fxc "$end_marker" "$CODEX_CONFIG" || true)"
  fi

  if [ "$begin_count" -eq 0 ] && [ "$end_count" -eq 0 ]; then
    if [ -s "$CODEX_CONFIG" ]; then
      cp "$CODEX_CONFIG" "$config_tmp"
      printf '\n' >> "$config_tmp"
    fi
    cat "$block_tmp" >> "$config_tmp"
  elif [ "$begin_count" -eq 1 ] && [ "$end_count" -eq 1 ]; then
    awk -v begin="$begin_marker" -v end="$end_marker" -v block="$block_tmp" '
      $0 == begin {
        while ((getline line < block) > 0) print line
        close(block)
        skipping = 1
        next
      }
      skipping && $0 == end { skipping = 0; next }
      !skipping { print }
    ' "$CODEX_CONFIG" > "$config_tmp"
  else
    rm -f "$config_tmp" "$block_tmp"
    echo "✗ Codex: bloque administrado inválido en $CODEX_CONFIG; no se modificó" >&2
    return 1
  fi

  rm -f "$block_tmp"
  if [ -f "$CODEX_CONFIG" ] && cmp -s "$config_tmp" "$CODEX_CONFIG"; then
    rm -f "$config_tmp"
    echo "→ Codex: precedencia sobre skills Pi ya configurada"
    return
  fi

  chmod 600 "$config_tmp"
  mv "$config_tmp" "$CODEX_CONFIG"
  echo "→ Codex: desactivadas las copias Pi duplicadas en $CODEX_CONFIG"
}

install_codex() {
  install_set "Codex" "$REPO_DIR/codex" "$CODEX_DEST"
  configure_codex_skill_precedence
}

case "$WHICH" in
  all)      install_codex
            install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST"
            install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST"
            install_pi ;;
  both)     install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST"
            install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  claude)   install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST" ;;
  opencode) install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  pi)       install_pi ;;
  pi-clean) clean_pi ;;
  codex)    install_codex ;;
  *) echo "Argumento inválido: '$WHICH' (usá: all | both | codex | claude | opencode | pi | pi-clean --confirm)" >&2; exit 2 ;;
esac

echo
echo "Listo."
