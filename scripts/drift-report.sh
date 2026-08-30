#!/usr/bin/env bash
#
# Reporte informativo de drift entre las copias de un mismo skill en los
# distintos harnesses (claude/, codex/, opencode/, pi/).
#
# Imprime Markdown por stdout, pensado para volcarse en $GITHUB_STEP_SUMMARY.
# Es SOLO informativo: nunca falla, siempre termina con exit 0.
#
# Compatible con bash 3.2 (macOS).

set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESSES=(claude codex opencode pi)

# Todos los nombres de skill presentes en al menos un harness.
names="$(
  for harness in "${HARNESSES[@]}"; do
    [ -d "$REPO_DIR/$harness" ] || continue
    for d in "$REPO_DIR/$harness"/*/; do
      [ -d "$d" ] && basename "$d"
    done
  done | sort -u
)"

echo "## Drift entre harnesses"
echo
echo "Skills presentes en más de un harness, con el tamaño del diff entre cada par de copias (directorio completo del skill, recursivo)."
echo
echo "| Skill | Par | Líneas de diff | Archivos solo en un lado |"
echo "|---|---|---:|---:|"

printf '%s\n' "$names" | while IFS= read -r name; do
  [ -n "$name" ] || continue

  present=()
  for harness in "${HARNESSES[@]}"; do
    [ -f "$REPO_DIR/$harness/$name/SKILL.md" ] && present+=("$harness")
  done
  count=${#present[@]}
  [ "$count" -ge 2 ] || continue

  i=0
  while [ "$i" -lt "$count" ]; do
    j=$((i + 1))
    while [ "$j" -lt "$count" ]; do
      a="${present[$i]}"
      b="${present[$j]}"
      out="$(diff -r "$REPO_DIR/$a/$name" "$REPO_DIR/$b/$name" 2>/dev/null || true)"
      lines="$(printf '%s\n' "$out" | grep -c '^[<>]')" || true
      only="$(printf '%s\n' "$out" | grep -c '^Only in ')" || true
      echo "| \`$name\` | \`$a\` ↔ \`$b\` | $lines | $only |"
      j=$((j + 1))
    done
    i=$((i + 1))
  done
done

echo
echo "> **Nota:** la divergencia esperada entre copias es la capa de interacción de cada harness — tools y forma de invocación (AskUserQuestion / request_user_input / ask_user_question + ask_user_questions / gates en texto plano; \`/nombre\`, \`\$nombre\`, \`/skill:nombre\`). Una divergencia grande en la doctrina del skill (el qué y el flujo) amerita revisión manual."

exit 0
