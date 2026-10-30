#!/usr/bin/env bash
# Versionado del repo. VERSION (raiz) es la unica fuente; package.json y
# .codex-plugin/plugin.json la repiten y deben coincidir. CI lo usa en cada PR
# (salto semver desde el branch base) y en cada push a main (release v<VERSION>).
#
# Uso:
#   scripts/version.sh check                  valida VERSION y manifests; imprime la version
#   scripts/version.sh check --next-of X      ademas exige el siguiente patch, minor o major de X
#   scripts/version.sh check --newer-than X   ademas exige una version mayor que X
#   scripts/version.sh base <ref>             VERSION en <ref>; sin archivo, el ultimo tag vX.Y.Z
#   scripts/version.sh latest                 ultimo tag vX.Y.Z sin la v; nada si no hay
#
# Ejemplo: con VERSION 1.4.0, `check --next-of 1.3.1` pasa; con 1.5.0 falla.
# Salida: 0 ok, 1 version invalida o desincronizada, 2 uso incorrecto.

set -euo pipefail

SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
MANIFESTS=(package.json .codex-plugin/plugin.json)

usage() {
	echo "uso: scripts/version.sh check [--next-of X | --newer-than X] | base <ref> | latest" >&2
	exit 2
}

is_semver() {
	[[ $1 =~ $SEMVER ]]
}

# Ordena versiones semver de mayor a menor (una por linea).
sort_desc() {
	sort -t. -k1,1nr -k2,2nr -k3,3nr
}

latest_tag() {
	git tag --list 'v*' | sed 's/^v//' | while IFS= read -r v; do
		if is_semver "$v"; then echo "$v"; fi
	done | sort_desc | sed -n 1p
}

manifest_version() {
	node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version ?? ""))' "$1"
}

# 0 si $1 > $2.
newer_than() {
	[[ $1 != "$2" && $(printf '%s\n%s\n' "$1" "$2" | sort_desc | sed -n 1p) == "$1" ]]
}

cmd_check() {
	local mode="" base=""
	if [[ $# -gt 0 ]]; then
		case $1 in
			--next-of | --newer-than)
				[[ $# -eq 2 ]] || usage
				mode=$1 base=$2
				;;
			*)
				echo "opcion desconocida: $1" >&2
				usage
				;;
		esac
		if ! is_semver "$base"; then
			echo "version base invalida: '$base'" >&2
			exit 2
		fi
	fi

	if [[ ! -f VERSION ]]; then
		echo "VERSION no existe en la raiz del repo" >&2
		exit 1
	fi
	local v
	v=$(tr -d '\n' < VERSION)
	if ! is_semver "$v"; then
		echo "VERSION invalida: '$v' (se espera MAJOR.MINOR.PATCH, por ejemplo 2.0.0)" >&2
		exit 1
	fi

	local failed=0 manifest found
	for manifest in "${MANIFESTS[@]}"; do
		found=$(manifest_version "$manifest")
		if [[ $found != "$v" ]]; then
			echo "$manifest tiene version '$found' y VERSION dice '$v'" >&2
			failed=1
		fi
	done
	[[ $failed -eq 0 ]] || exit 1

	if [[ $mode == --next-of ]]; then
		local major minor patch
		IFS=. read -r major minor patch <<< "$base"
		local next_patch="$major.$minor.$((patch + 1))"
		local next_minor="$major.$((minor + 1)).0"
		local next_major="$((major + 1)).0.0"
		if [[ $v != "$next_patch" && $v != "$next_minor" && $v != "$next_major" ]]; then
			echo "VERSION '$v' no es el siguiente de '$base': usá $next_patch, $next_minor o $next_major" >&2
			exit 1
		fi
	elif [[ $mode == --newer-than ]]; then
		if ! newer_than "$v" "$base"; then
			echo "VERSION '$v' no es mayor que '$base'" >&2
			exit 1
		fi
	fi

	echo "$v"
}

cmd_base() {
	[[ $# -eq 1 ]] || usage
	local ref=$1 v
	if v=$(git show "$ref:VERSION" 2> /dev/null); then
		echo "$v"
		return
	fi
	v=$(latest_tag)
	if [[ -z $v ]]; then
		echo "no hay version base: $ref no tiene VERSION y no hay tags vX.Y.Z" >&2
		exit 1
	fi
	echo "$v"
}

cmd_latest() {
	[[ $# -eq 0 ]] || usage
	latest_tag
}

[[ $# -gt 0 ]] || usage
command=$1
shift
case $command in
	check) cmd_check "$@" ;;
	base) cmd_base "$@" ;;
	latest) cmd_latest "$@" ;;
	*) usage ;;
esac
