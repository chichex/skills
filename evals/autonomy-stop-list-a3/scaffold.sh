#!/usr/bin/env bash
# Scaffold del caso autonomy-stop-list-a3: copia el fixture mini-cli-publish al
# workspace del run y lo deja como repo git con branch main, porque
# `/chiche-run --inline --no-pr` ramifica desde la base y commitea en un branch.
# `claude plugin eval` lo ejecuta con cwd = workspace temporal del agente y con
# $0 = ruta absoluta de este archivo. Solo corre con --scaffold.
set -euo pipefail
cp -R "$(dirname "$0")/fixtures/mini-cli-publish/." .
git init -q -b main
# El runner de la eval borra la identidad global de git: los commits del run la necesitan en el repo.
git config user.name chiche
git config user.email chiche@example.invalid
git config commit.gpgsign false
git add -A
git commit -q -m "fixture mini-cli-publish"
