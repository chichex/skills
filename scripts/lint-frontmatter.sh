#!/usr/bin/env bash
#
# Linter de frontmatter para los skills del repo.
#
# Para cada skill en claude/, codex/, opencode/ y pi/ verifica que:
#   1. exista SKILL.md;
#   2. el archivo abra con frontmatter YAML (--- en la primera línea, cerrado
#      con otro ---);
#   3. el frontmatter tenga `name:` igual al nombre de la carpeta del skill;
#   4. el frontmatter tenga `description:` no vacía (valor inline o bloque
#      `>-`/`|` con al menos una línea de contenido).
#
# Compatible con bash 3.2 (macOS) y con las herramientas BSD/GNU de base.
# Sale con código 1 si encuentra al menos un error.

set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESSES=(claude codex opencode pi)

errors=0
checked=0

fail() {
  echo "✗ $1" >&2
  errors=$((errors + 1))
}

for harness in "${HARNESSES[@]}"; do
  harness_dir="$REPO_DIR/$harness"
  if [ ! -d "$harness_dir" ]; then
    fail "$harness/: no existe el directorio del harness"
    continue
  fi

  for skill_dir in "$harness_dir"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_dir="${skill_dir%/}"
    skill="$(basename "$skill_dir")"
    rel="$harness/$skill"
    file="$skill_dir/SKILL.md"
    checked=$((checked + 1))

    if [ ! -f "$file" ]; then
      fail "$rel: falta SKILL.md"
      continue
    fi

    # Extrae el frontmatter: exige --- exacto en la línea 1 y un --- de cierre.
    fm="$(awk '
      NR == 1 { if ($0 != "---") { bad = 1; exit }; next }
      /^---[[:space:]]*$/ { closed = 1; exit }
      { print }
      END { if (bad) exit 2; if (!closed) exit 3 }
    ' "$file")" && fm_status=0 || fm_status=$?

    if [ "$fm_status" -eq 2 ]; then
      fail "$rel/SKILL.md: no empieza con frontmatter (la primera línea no es ---)"
      continue
    elif [ "$fm_status" -ne 0 ]; then
      fail "$rel/SKILL.md: frontmatter sin cerrar (falta el --- final)"
      continue
    fi

    # name: debe existir y coincidir con el nombre de la carpeta.
    name_val="$(printf '%s\n' "$fm" \
      | sed -n 's/^name:[[:space:]]*//p' \
      | sed -n 1p \
      | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")"
    if [ -z "$name_val" ]; then
      fail "$rel/SKILL.md: falta name: en el frontmatter (o está vacío)"
    elif [ "$name_val" != "$skill" ]; then
      fail "$rel/SKILL.md: name: '$name_val' no coincide con la carpeta '$skill'"
    fi

    # description: debe existir y no estar vacía. Acepta valor inline o
    # bloque escalar (>-, |, etc.) con al menos una línea indentada.
    if printf '%s\n' "$fm" | awk '
      !seen && /^description:/ {
        seen = 1
        val = $0
        sub(/^description:[[:space:]]*/, "", val)
        sub(/[[:space:]]+$/, "", val)
        if (val ~ /^[>|][+-]?$/) { block = 1; next }
        if (val == "" || val == "\"\"") exit 1
        ok = 1
        exit
      }
      block {
        if ($0 ~ /^[[:space:]]+[^[:space:]]/) ok = 1
        exit
      }
      END { exit ok ? 0 : 1 }
    '; then
      :
    else
      fail "$rel/SKILL.md: description: falta o está vacía"
    fi
  done
done

echo
if [ "$errors" -gt 0 ]; then
  echo "Frontmatter: $errors error(es) en $checked skills revisados." >&2
  exit 1
fi
echo "Frontmatter OK: $checked skills revisados."
