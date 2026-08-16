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
CODEX_MANAGED_BEGIN="# >>> chichex/skills: prefer Codex over Pi >>>"
CODEX_MANAGED_END="# <<< chichex/skills: prefer Codex over Pi <<<"
WHICH="${1:-all}"
CONFIRMATION="${2:-}"

# 1. traer lo último (si es un clon git). La limpieza nunca actualiza el repo.
if [ "$WHICH" != "pi-clean" ] && [ -d "$REPO_DIR/.git" ]; then
  echo "→ git pull"
  git -C "$REPO_DIR" pull --ff-only
fi

# --- Registro de nombres administrados por este repo (skills/extensiones/themes de Pi) ---
#
# `pi_managed_names` enumera los nombres base de un tipo de recurso a partir del
# árbol fuente ACTUAL del checkout, con el mismo glob que usan los install_*.
# install_set/install_extensions/install_themes y clean_pi comparten esta función
# a propósito: si el glob de qué-es-un-recurso cambia, cambia para instalar Y para
# limpiar, no pueden driftear por separado (ver hallazgo F12 del review de PR #22).
pi_managed_names() {
  local src="$1" glob_kind="$2" entry
  case "$glob_kind" in
    dirs)
      for entry in "$src"/*/; do
        [ -d "$entry" ] || continue
        basename "$entry"
      done
      ;;
    entries)
      for entry in "$src"/*; do
        [ -e "$entry" ] || continue
        basename "$entry"
      done
      ;;
    json)
      for entry in "$src"/*.json; do
        [ -f "$entry" ] || continue
        basename "$entry"
      done
      ;;
  esac
}

# Cada destino administrado lleva un manifest oculto con los nombres que este
# repo instaló ahí alguna vez. Sin esto, `clean_pi` solo podría borrar lo que
# el checkout ACTUAL todavía tiene, y un skill/extensión/theme renombrado o
# eliminado upstream quedaría huérfano en el destino tras una limpieza
# (hallazgo F2 del review de PR #22).
pi_manifest_path() {
  printf '%s/.chichex-skills-managed' "$1"
}

pi_record_managed() {
  local dest="$1" name="$2" manifest
  manifest="$(pi_manifest_path "$dest")"
  mkdir -p "$dest"
  if [ ! -f "$manifest" ] || ! grep -Fxq "$name" "$manifest" 2>/dev/null; then
    printf '%s\n' "$name" >> "$manifest"
  fi
}

# Unión de lo que el checkout actual instalaría y lo que el manifest recuerda
# de instalaciones anteriores. Es lo que `clean_pi` debe borrar.
pi_dest_names() {
  local src="$1" dest="$2" glob_kind="$3" manifest
  manifest="$(pi_manifest_path "$dest")"
  {
    pi_managed_names "$src" "$glob_kind"
    # El manifest suele no existir todavía (primera instalación, o justo
    # despues de una limpieza que lo olvidó): que falte no es un error.
    [ -f "$manifest" ] && cat "$manifest"
    true
  } | sort -u
}

pi_forget_manifest() {
  rm -f "$(pi_manifest_path "$1")"
}

install_set() {
  local name="$1" src="$2" dest="$3" base
  if [ ! -d "$src" ]; then
    echo "⚠  $name: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ $name → $dest"
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    # reemplaza solo ESTE skill (limpio, sin dejar archivos viejos);
    # el resto de tu carpeta queda intacto.
    rm -rf "${dest:?}/$base"
    cp -R "$src/$base" "$dest/$base"
    pi_record_managed "$dest" "$base"
    echo "   ✓ $base"
  done < <(pi_managed_names "$src" dirs)
}

install_extensions() {
  local src="$1" dest="$2" base
  if [ ! -d "$src" ]; then
    echo "⚠  Pi extensions: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ Pi extensions → $dest"
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    # Pi descubre tanto archivos .ts como carpetas con index.ts.
    rm -rf "${dest:?}/$base"
    cp -R "$src/$base" "$dest/$base"
    pi_record_managed "$dest" "$base"
    echo "   ✓ $base"
  done < <(pi_managed_names "$src" entries)
}

install_themes() {
  local src="$1" dest="$2" base
  if [ ! -d "$src" ]; then
    echo "⚠  Pi themes: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ Pi themes → $dest"
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    rm -f "$dest/$base"
    cp "$src/$base" "$dest/$base"
    pi_record_managed "$dest" "$base"
    echo "   ✓ $base"
  done < <(pi_managed_names "$src" json)
}

# Detecta si el Pi Package nativo de este repo (`pi install git:github.com/chichex/skills`,
# o su variante -l local) ya está registrado en la config de Pi. `pi list` no muta nada.
# Si no hay `pi` en PATH, o la detección falla por cualquier motivo, asumimos que NO hay
# conflicto: instalar via copias legacy debe seguir funcionando para quien no usa Pi Package.
pi_native_package_conflict() {
  command -v pi >/dev/null 2>&1 || return 1
  local listing
  listing="$(cd "$REPO_DIR" && PI_OFFLINE=1 pi list 2>/dev/null)" || return 1
  # Cubre tanto `pi install git:github.com/chichex/skills` (la fuente cruda
  # incluye ese literal) como `pi install <ruta-local>` / `-l` de ESTE mismo
  # checkout (pi list resuelve y muestra el path absoluto == $REPO_DIR).
  printf '%s\n' "$listing" | grep -F -q -e 'chichex/skills' -e "$REPO_DIR"
}

install_pi() {
  if pi_native_package_conflict; then
    echo "✗ El Pi Package nativo (chichex/skills) ya está instalado — 'pi list' lo muestra." >&2
    echo "  No instales también las copias legacy encima: duplicarías skills, extensiones y comandos de Pi." >&2
    echo "  Usá 'pi update --extensions' para actualizar el package, o 'pi remove git:github.com/chichex/skills'" >&2
    echo "  (agregá -l si lo instalaste local) si preferís volver a las copias legacy." >&2
    return 1
  fi
  install_set "Pi skills" "$REPO_DIR/pi" "$PI_DEST"
  install_extensions "$REPO_DIR/pi-extensions" "$PI_EXTENSIONS_DEST"
  install_themes "$REPO_DIR/pi-themes" "$PI_THEMES_DEST"
}

# Borra en $dest los nombres administrados de un tipo de recurso (ver pi_dest_names)
# y olvida el manifest: tras una limpieza completa no queda nada "administrado" ahí.
clean_managed() {
  local item="$1" src="$2" dest="$3" glob_kind="$4" manifest names base target
  manifest="$(pi_manifest_path "$dest")"
  if [ ! -d "$src" ] && [ ! -f "$manifest" ]; then
    echo "⚠  $item: no existe $src en el repo y no hay registro de instalaciones previas — nada que limpiar con seguridad, salteando" >&2
    return
  fi
  names="$(pi_dest_names "$src" "$dest" "$glob_kind")"
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    target="$dest/$base"
    if [ -e "$target" ] || [ -L "$target" ]; then
      if [ "$glob_kind" = "json" ]; then
        rm -f "${target:?}"
      else
        rm -rf "${target:?}"
      fi
      echo "   ✓ $item $base"
    fi
  done <<EOF
$names
EOF
  pi_forget_manifest "$dest"
}

clean_pi() {
  if [ "$CONFIRMATION" != "--confirm" ]; then
    echo "✗ Limpieza Pi no confirmada; no se borró nada." >&2
    echo "  Para borrar únicamente las copias administradas: ./install.sh pi-clean --confirm" >&2
    return 2
  fi

  echo "→ Limpieza Pi confirmada"
  clean_managed "skill"     "$REPO_DIR/pi"            "$PI_DEST"             dirs
  clean_managed "extensión" "$REPO_DIR/pi-extensions"  "$PI_EXTENSIONS_DEST" entries
  clean_managed "theme"     "$REPO_DIR/pi-themes"      "$PI_THEMES_DEST"     json

  # Si install.sh ya había escrito el bloque administrado de Codex (config.toml
  # apuntando a $PI_DEST/<skill>/SKILL.md con enabled=false), reconciliarlo ahora
  # evita que sobrevivan entradas apuntando a paths que acabamos de borrar
  # (hallazgo F8 del review de PR #22). Si nunca se escribió ese bloque, no
  # tocamos la config de Codex — evita crearla de la nada para quien no usa Codex.
  if [ "$CODEX_DEDUPLICATE" = "1" ] && [ -f "$CODEX_CONFIG" ] && \
     grep -Fq "$CODEX_MANAGED_BEGIN" "$CODEX_CONFIG" 2>/dev/null; then
    configure_codex_skill_precedence "$PI_DEST"
  fi
}

configure_codex_skill_precedence() {
  # check_root: contra qué comprobar si un skill de Pi "existe" para generar su
  # entrada de precedencia. Por defecto el checkout ($REPO_DIR/pi), que es lo
  # correcto durante install (el skill se está por copiar recién). clean_pi lo
  # llama con $PI_DEST para reconciliar contra lo que quedó REALMENTE instalado
  # después de borrar (hallazgo F8 del review de PR #22).
  local check_root="${1:-$REPO_DIR/pi}"
  [ "$CODEX_DEDUPLICATE" = "1" ] || {
    echo "→ Codex: deduplicación de skills Pi desactivada"
    return
  }

  local begin_marker="$CODEX_MANAGED_BEGIN"
  local end_marker="$CODEX_MANAGED_END"
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
      [ -f "$check_root/$base/SKILL.md" ] || continue
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
