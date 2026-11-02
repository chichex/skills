#!/usr/bin/env bash
#
# Instala/actualiza los skills de este repo en Codex, Claude Code, opencode, Pi y Antigravity,
# junto con las extensiones de Pi.
# Hace git pull y copia cada skill a su carpeta, SIN borrar los otros skills
# que ya tengas: agrega/actualiza los que vienen del repo y solo poda los que
# este mismo repo instaló antes (figuran en el manifest del destino) y retiró,
# sean skills, extensiones o themes de Pi.
#
# Uso:
#   ./install.sh              # instala los cinco sets
#   ./install.sh all          # instala los cinco sets
#   ./install.sh both         # Claude Code + opencode (compatibilidad)
#   ./install.sh claude       # solo los de Claude Code
#   ./install.sh opencode     # solo los de opencode
#   ./install.sh pi           # solo los de Pi
#   ./install.sh pi-clean --confirm  # elimina solo las copias Pi administradas
#   ./install.sh antigravity  # solo los de Antigravity
#   ./install.sh codex        # solo los de Codex
#
# Overrides por variable de entorno (destinos):
#   ANTIGRAVITY_SKILLS_DIR (default: ~/.gemini/config/skills)
#   CLAUDE_SKILLS_DIR    (default: ~/.claude/skills)
#   CLAUDE_AGENTS_DIR    (default: ~/.claude/agents)
#   CLAUDE_PLUGIN_REGISTRY_FILE (default: ~/.claude/plugins/installed_plugins.json)
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
ANTIGRAVITY_DEST="${ANTIGRAVITY_SKILLS_DIR:-$HOME/.gemini/config/skills}"
CLAUDE_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
CLAUDE_AGENTS_DEST="${CLAUDE_AGENTS_DIR:-$HOME/.claude/agents}"
CLAUDE_PLUGIN_REGISTRY="${CLAUDE_PLUGIN_REGISTRY_FILE:-$HOME/.claude/plugins/installed_plugins.json}"
OPENCODE_DEST="${OPENCODE_SKILLS_DIR:-$HOME/.config/opencode/skills}"
PI_DEST="${PI_SKILLS_DIR:-$HOME/.agents/skills}"
PI_EXTENSIONS_DEST="${PI_EXTENSIONS_DIR:-$HOME/.pi/agent/extensions}"
PI_THEMES_DEST="${PI_THEMES_DIR:-$HOME/.pi/agent/themes}"
CODEX_DEST="${CODEX_SKILLS_DIR:-${CODEX_HOME:-$HOME/.codex}/skills}"
CODEX_CONFIG="${CODEX_CONFIG_FILE:-${CODEX_HOME:-$HOME/.codex}/config.toml}"
CODEX_DEDUPLICATE="${CODEX_DEDUPLICATE_PI_SKILLS:-1}"
CODEX_MANAGED_BEGIN="# >>> chichex/chiche: prefer Codex over Pi >>>"
CODEX_MANAGED_END="# <<< chichex/chiche: prefer Codex over Pi <<<"
# Rotulo del bloque antes del renombre a chiche (issue #103): se reconoce y se
# reemplaza por el nuevo, nunca se duplica.
CODEX_LEGACY_BEGIN="# >>> chichex/skills: prefer Codex over Pi >>>"
CODEX_LEGACY_END="# <<< chichex/skills: prefer Codex over Pi <<<"
WHICH="${1:-all}"
CONFIRMATION="${2:-}"

# 1. traer lo último (si es un clon git). La limpieza nunca actualiza el repo.
if [ "$WHICH" != "pi-clean" ] && [ -d "$REPO_DIR/.git" ]; then
  if git -C "$REPO_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    echo "→ git pull"
    git -C "$REPO_DIR" pull --ff-only
  else
    echo "→ git pull omitido (rama local sin upstream configurado)"
  fi
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
    md)
      for entry in "$src"/*.md; do
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
# (hallazgo F2 del review de PR #22). El manifest es `.chiche-managed`; antes
# del renombre a chiche (issue #103) era `.chichex-skills-managed`, que se
# sigue leyendo y se migra al nuevo en la próxima instalación.
pi_manifest_path() {
  printf '%s/.chiche-managed' "$1"
}

pi_legacy_manifest_path() {
  printf '%s/.chichex-skills-managed' "$1"
}

# Nombres que recuerdan el manifest nuevo y el viejo, sin repetidos y en
# orden de aparición. Que falte alguno (o los dos) no es un error. Descarta
# los nombres inválidos (vacíos, con '/', '.' o '..') para que un manifest
# corrupto no pueda hacer borrar fuera del destino a `clean_managed`.
pi_manifest_names() {
  local manifest legacy
  manifest="$(pi_manifest_path "$1")"
  legacy="$(pi_legacy_manifest_path "$1")"
  [ -f "$manifest" ] || manifest=/dev/null
  [ -f "$legacy" ] || legacy=/dev/null
  awk '$0 != "" && $0 != "." && $0 != ".." && index($0, "/") == 0 && !seen[$0]++' "$manifest" "$legacy"
}

# Funde el manifest viejo en `.chiche-managed` y lo borra: desde acá solo se
# escribe uno, sin los nombres inválidos.
pi_migrate_manifest() {
  local dest="$1" merged
  [ -f "$(pi_legacy_manifest_path "$dest")" ] || return 0
  merged="$(mktemp "$dest/.chiche-managed.XXXXXX")"
  pi_manifest_names "$dest" > "$merged"
  mv "$merged" "$(pi_manifest_path "$dest")"
  rm -f "$(pi_legacy_manifest_path "$dest")"
}

pi_record_managed() {
  local dest="$1" name="$2" manifest
  manifest="$(pi_manifest_path "$dest")"
  mkdir -p "$dest"
  if [ ! -f "$manifest" ] || ! grep -Fxq -e "$name" "$manifest" 2>/dev/null; then
    printf '%s\n' "$name" >> "$manifest"
  fi
}

# Unión de lo que el checkout actual instalaría y lo que el manifest recuerda
# de instalaciones anteriores. Es lo que `clean_pi` debe borrar.
pi_dest_names() {
  local src="$1" dest="$2" glob_kind="$3"
  {
    pi_managed_names "$src" "$glob_kind"
    # Los manifests suelen no existir todavía (primera instalación, o justo
    # despues de una limpieza que los olvidó): que falten no es un error.
    pi_manifest_names "$dest"
  } | sort -u
}

pi_forget_manifest() {
  rm -f "$(pi_manifest_path "$1")" "$(pi_legacy_manifest_path "$1")"
}

# Poda en $dest los recursos de un tipo (skills `dirs`, extensiones `entries`,
# themes `json`: el mismo glob_kind de pi_managed_names) que este repo instaló
# alguna vez (figuran en el manifest del destino) y que el checkout ACTUAL ya
# no tiene. Solo toca nombres administrados: un recurso ajeno, que nunca pasó
# por el manifest, sobrevive. Los nombres inválidos (vacíos, con '/', '.' o
# '..') se descartan sin resolverse, para que un manifest corrupto no pueda
# borrar fuera del destino. Un theme es un archivo (`rm -f`); skills y
# extensiones pueden ser carpetas enteras (`rm -rf`), así no queda ningún
# archivo viejo anidado que el discovery de Pi vuelva a levantar.
# Reescribe el manifest sin lo podado. Espera el manifest ya migrado (ver
# pi_migrate_manifest): así una copia vieja (un `sdd-*` que el checkout ya no
# trae, porque desde 4.0.0 ningún alias lo reemplaza, o la carpeta
# `sdd-artifacts` de una extensión renombrada) se poda aunque solo figure en
# `.chichex-skills-managed`.
prune_retired() {
  local src="$1" dest="$2" glob_kind="$3" manifest current kept name
  manifest="$(pi_manifest_path "$dest")"
  [ -f "$manifest" ] || return 0
  current="$(pi_managed_names "$src" "$glob_kind")"
  kept="$(mktemp "$dest/.chiche-managed.XXXXXX")"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    case "$name" in
      */*|.|..) continue ;;
    esac
    # `-e`: un nombre que empieza con '-' no es una opcion de grep.
    if printf '%s\n' "$current" | grep -Fxq -e "$name"; then
      printf '%s\n' "$name" >> "$kept"
    elif [ "$glob_kind" = "json" ]; then
      # Un theme es un archivo: una carpeta con ese nombre no es nuestra y
      # `rm -f` sobre ella abortaria la instalacion por set -e.
      if [ -f "$dest/$name" ] || [ -L "$dest/$name" ]; then
        rm -f "${dest:?}/$name"
        echo "   ✗ $name (retirado del repo, podado)"
      fi
    elif [ -e "$dest/$name" ] || [ -L "$dest/$name" ]; then
      rm -rf "${dest:?}/$name"
      echo "   ✗ $name (retirado del repo, podado)"
    fi
  done < "$manifest"
  mv "$kept" "$manifest"
}

install_set() {
  local name="$1" src="$2" dest="$3" base
  if [ ! -d "$src" ]; then
    echo "⚠  $name: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ $name → $dest"
  pi_migrate_manifest "$dest"
  prune_retired "$src" "$dest" dirs
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    # reemplaza solo ESTE skill (limpio, sin dejar archivos viejos);
    # el resto de tu carpeta queda intacto. Una copia vieja de sdd-<x> no
    # llega acá: el checkout ya no la trae y la poda prune_retired.
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
  pi_migrate_manifest "$dest"
  # Una extensión renombrada o retirada (p. ej. sdd-artifacts → chiche-artifacts)
  # no puede quedar al lado de la nueva: Pi descubre su index.ts en cada arranque.
  prune_retired "$src" "$dest" entries
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
  pi_migrate_manifest "$dest"
  prune_retired "$src" "$dest" json
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    rm -f "$dest/$base"
    cp "$src/$base" "$dest/$base"
    pi_record_managed "$dest" "$base"
    echo "   ✓ $base"
  done < <(pi_managed_names "$src" json)
}

# Los agentes de plugin de Claude Code (agents/*.md en la raíz) son un layer
# aparte de los skills de claude/: se copian planos (sin subcarpeta), igual
# que los themes de Pi. A diferencia de install_set/install_extensions/
# install_themes, NO llama a pi_record_managed: clean_managed (ver mas abajo)
# solo se invoca desde clean_pi para los tres destinos de Pi y no tiene rama
# para el kind 'md', así que nada lee ese manifest para CLAUDE_AGENTS_DEST —
# escribirlo dejaría un archivo sin lector (hallazgo #3 del review de PR #43).
install_agents() {
  local src="$1" dest="$2" base
  if [ ! -d "$src" ]; then
    echo "⚠  Claude agents: no existe $src en el repo — salteando"
    return
  fi
  mkdir -p "$dest"
  echo "→ Claude agents → $dest"
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    rm -f "$dest/$base"
    cp "$src/$base" "$dest/$base"
    echo "   ✓ $base"
  done < <(pi_managed_names "$src" md)
}

# Detecta si el plugin "chiche" (antes "chichex-skills") ya está registrado
# en el registro de plugins de Claude Code. Una copia en $CLAUDE_AGENTS_DEST tiene precedencia
# (proyecto > usuario > plugin) sobre los agentes que expone el plugin, así
# que la taparía y quedaría vieja para siempre. Solo LEE el registro (nunca
# lo muta) y usa una ruta overrideable por variable de entorno en vez de
# hardcodear el home real, para poder probarse con destinos temporales — el
# mismo patrón que pi_native_package_conflict usa para 'pi list'. Si el
# registro no existe o no se puede leer, asumimos que NO hay conflicto.
# El formato exacto de installed_plugins.json no está documentado ni
# verificado contra una instalación real; por eso el patrón matchea solo el
# nombre del plugin, sin comillas ni '@', en vez de asumir una forma puntual
# como `"chichex-skills@<marketplace>"` (hallazgo #2 del review de PR #43).
# "chiche" es demasiado corto para buscarlo suelto (aparece en cualquier ruta
# bajo /home/chiche): se exige un string JSON que sea exactamente `chiche` o
# `chiche@<marketplace>`, para no confundirlo con `chiche-foo@x` ni con
# `otro@chiche` (issue #103).
claude_plugin_shadow_conflict() {
  [ -f "$CLAUDE_PLUGIN_REGISTRY" ] || return 1
  grep -E -q -e 'chichex-skills' -e '"chiche(@[^"]*)?"' "$CLAUDE_PLUGIN_REGISTRY" 2>/dev/null
}

install_claude() {
  install_set "Claude Code" "$REPO_DIR/claude" "$CLAUDE_DEST"
  # Si el plugin ya está instalado, una copia en $CLAUDE_AGENTS_DEST tendría
  # precedencia sobre los agentes que expone el plugin y los taparía para
  # siempre. En vez de avisarlo y copiar igual (lo que efectivamente sigue
  # tapando el plugin cada vez que se corre este instalador), se saltea
  # install_agents: el aviso pasa a describir lo que realmente pasa
  # (hallazgo #1 del review de PR #43). Los skills de claude/ ya se
  # instalaron arriba, así que este salteo no los afecta.
  if claude_plugin_shadow_conflict; then
    echo "⚠  El plugin chiche ya está instalado (según $CLAUDE_PLUGIN_REGISTRY)." >&2
    echo "  Una copia en $CLAUDE_AGENTS_DEST tendría precedencia sobre los agentes del plugin y los taparía." >&2
    echo "  No se instalan agents/ desde acá: usá /plugin update chiche para actualizarlos." >&2
    # Desde la 3.0.0 el plugin se llama chiche: update no migra el viejo.
    if grep -F -q 'chichex-skills' "$CLAUDE_PLUGIN_REGISTRY" 2>/dev/null; then
      echo "  Tenés el plugin con su nombre viejo: migralo con /plugin uninstall chichex-skills@chichex y /plugin install chiche@chichex." >&2
    fi
    echo "  Los skills de claude/ se instalaron igual." >&2
    return
  fi
  install_agents "$REPO_DIR/agents" "$CLAUDE_AGENTS_DEST"
}

# Detecta si el Pi Package nativo de este repo (`pi install git:github.com/chichex/chiche`,
# o su variante -l local) ya está registrado en la config de Pi. `pi list` no muta nada.
# Si no hay `pi` en PATH, o la detección falla por cualquier motivo, asumimos que NO hay
# conflicto: instalar via copias legacy debe seguir funcionando para quien no usa Pi Package.
pi_native_package_conflict() {
  command -v pi >/dev/null 2>&1 || return 1
  local listing
  listing="$(cd "$REPO_DIR" && PI_OFFLINE=1 pi list 2>/dev/null)" || return 1
  # Cubre `pi install git:github.com/chichex/chiche` (el nombre actual del repo)
  # y también la fuente vieja `git:github.com/chichex/skills`: `pi list` muestra
  # la fuente tal como el usuario la tipeó, así que quien instaló antes del
  # renombre del issue #103 sigue viendo el literal viejo. Cubre además
  # `pi install <ruta-local>` / `-l` de ESTE mismo checkout (pi list resuelve y
  # muestra el path absoluto == $REPO_DIR).
  printf '%s\n' "$listing" | grep -F -q -e 'chichex/skills' -e 'chichex/chiche' -e "$REPO_DIR"
}

install_pi() {
  if pi_native_package_conflict; then
    echo "✗ El Pi Package nativo (chichex/chiche) ya está instalado — 'pi list' lo muestra." >&2
    echo "  No instales también las copias legacy encima: duplicarías skills, extensiones y comandos de Pi." >&2
    echo "  Usá 'pi update --extensions' para actualizar el package, o 'pi remove git:github.com/chichex/chiche'" >&2
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
  local item="$1" src="$2" dest="$3" glob_kind="$4" names base target
  if [ ! -d "$src" ] && [ ! -f "$(pi_manifest_path "$dest")" ] && \
     [ ! -f "$(pi_legacy_manifest_path "$dest")" ]; then
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
  # (hallazgo F8 del review de PR #22). Si nunca se escribió ese bloque (con el
  # rótulo nuevo o el viejo), no tocamos la config de Codex — evita crearla de
  # la nada para quien no usa Codex.
  if [ "$CODEX_DEDUPLICATE" = "1" ] && [ -f "$CODEX_CONFIG" ] && \
     grep -Fq -e "$CODEX_MANAGED_BEGIN" -e "$CODEX_LEGACY_BEGIN" "$CODEX_CONFIG" 2>/dev/null; then
    configure_codex_skill_precedence "$PI_DEST"
  fi
}

# Copias Pi que este repo instaló alguna vez (figuran en el manifest de $PI_DEST),
# que el checkout ya no trae y que siguen en disco: los `sdd-*` de una 2.x o 3.x.
# `install.sh codex` no poda $PI_DEST, así que Codex las vería habilitadas y
# repetidas contra `chiche-*`. Un nombre por línea, ordenados. Migra el manifest
# viejo de $PI_DEST si hace falta, pero nunca crea uno que no existe.
codex_stale_pi_skills() {
  local name
  pi_migrate_manifest "$PI_DEST"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    [ ! -f "$REPO_DIR/pi/$name/SKILL.md" ] || continue
    [ -f "$PI_DEST/$name/SKILL.md" ] || continue
    printf '%s\n' "$name"
  done < <(pi_manifest_names "$PI_DEST" | sort)
}

codex_report_stale_pi_skills() {
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    echo "   ↳ $name: copia Pi retirada; corré ./install.sh pi o ./install.sh pi-clean --confirm para podarla"
  done <<EOF
$1
EOF
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
  local legacy_begin="$CODEX_LEGACY_BEGIN"
  local legacy_end="$CODEX_LEGACY_END"
  local config_dir config_tmp block_tmp begin_count end_count legacy_begin_count legacy_end_count
  local emitted="" stale_skills name escaped_path
  stale_skills="$(codex_stale_pi_skills)"
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
      emitted="$emitted$base"$'\n'
    done
    # Después de los skills vigentes: las copias Pi retiradas que siguen en
    # $PI_DEST (ver codex_stale_pi_skills), sin repetir una ya emitida.
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      ! printf '%s' "$emitted" | grep -Fxq -e "$name" || continue
      escaped_path="$(printf '%s' "$PI_DEST/$name/SKILL.md" | sed 's/\\/\\\\/g; s/"/\\"/g')"
      printf '\n[[skills.config]]\n'
      printf 'path = "%s"\n' "$escaped_path"
      printf 'enabled = false\n'
    done <<EOF
$stale_skills
EOF
    printf '%s\n' "$end_marker"
  } > "$block_tmp"

  begin_count=0
  end_count=0
  legacy_begin_count=0
  legacy_end_count=0
  if [ -f "$CODEX_CONFIG" ]; then
    begin_count="$(grep -Fxc "$begin_marker" "$CODEX_CONFIG" || true)"
    end_count="$(grep -Fxc "$end_marker" "$CODEX_CONFIG" || true)"
    legacy_begin_count="$(grep -Fxc "$legacy_begin" "$CODEX_CONFIG" || true)"
    legacy_end_count="$(grep -Fxc "$legacy_end" "$CODEX_CONFIG" || true)"
  fi

  if [ "$begin_count" -eq 0 ] && [ "$end_count" -eq 0 ] && \
     [ "$legacy_begin_count" -eq 0 ] && [ "$legacy_end_count" -eq 0 ]; then
    if [ -s "$CODEX_CONFIG" ]; then
      cp "$CODEX_CONFIG" "$config_tmp"
      printf '\n' >> "$config_tmp"
    fi
    cat "$block_tmp" >> "$config_tmp"
  elif [ "$begin_count" -le 1 ] && [ "$begin_count" -eq "$end_count" ] && \
       [ "$legacy_begin_count" -le 1 ] && [ "$legacy_begin_count" -eq "$legacy_end_count" ]; then
    # El primer bloque (nuevo o viejo) se reemplaza por el bloque nuevo; si
    # conviven los dos, el segundo se descarta: queda un solo bloque.
    awk -v begin="$begin_marker" -v end="$end_marker" \
        -v legacy_begin="$legacy_begin" -v legacy_end="$legacy_end" -v block="$block_tmp" '
      !skipping && ($0 == begin || $0 == legacy_begin) {
        if (!written) {
          while ((getline line < block) > 0) print line
          close(block)
          written = 1
        }
        closing = ($0 == begin) ? end : legacy_end
        skipping = 1
        next
      }
      skipping && $0 == closing { skipping = 0; next }
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
    codex_report_stale_pi_skills "$stale_skills"
    return
  fi

  chmod 600 "$config_tmp"
  mv "$config_tmp" "$CODEX_CONFIG"
  echo "→ Codex: desactivadas las copias Pi duplicadas en $CODEX_CONFIG"
  codex_report_stale_pi_skills "$stale_skills"
}

install_codex() {
  install_set "Codex" "$REPO_DIR/codex" "$CODEX_DEST"
  configure_codex_skill_precedence
}

install_antigravity() {
  install_set "Antigravity" "$REPO_DIR/antigravity" "$ANTIGRAVITY_DEST"
}

case "$WHICH" in
  all)      # install_pi poda $PI_DEST antes de que Codex lo mire: el bloque de
            # precedencia no lista copias Pi que esta misma corrida retira. Con el
            # Pi Package nativo instalado install_pi falla; se difiere al final
            # (como siempre) para que no corte los demás sets.
            pi_blocked=0
            if pi_native_package_conflict; then pi_blocked=1; else install_pi; fi
            install_codex
            install_claude
            install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST"
            install_antigravity
            if [ "$pi_blocked" = 1 ]; then install_pi; fi ;;
  both)     install_claude
            install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  claude)   install_claude ;;
  opencode) install_set "opencode"    "$REPO_DIR/opencode" "$OPENCODE_DEST" ;;
  pi)       install_pi ;;
  pi-clean) clean_pi ;;
  codex)    install_codex ;;
  antigravity) install_antigravity ;;
  *) echo "Argumento inválido: '$WHICH' (usá: all | both | codex | claude | opencode | pi | pi-clean --confirm | antigravity)" >&2; exit 2 ;;
esac

echo
echo "Listo."
