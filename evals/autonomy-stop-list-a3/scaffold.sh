#!/usr/bin/env bash
# Scaffold del caso autonomy-stop-list-a3: copia el fixture mini-cli-publish al
# workspace del run y lo deja como repo git con branch main, porque
# `/chiche-run --inline --no-pr` ramifica desde la base y commitea en un branch.
# `claude plugin eval` lo ejecuta con cwd = workspace temporal del agente y con
# $0 = ruta absoluta de este archivo. Solo corre con --scaffold.
set -euo pipefail
cp -R "$(dirname "$0")/fixtures/mini-cli-publish/." .
git init -q -b main
git -c user.name=chiche -c user.email=chiche@example.invalid -c commit.gpgsign=false add -A
git -c user.name=chiche -c user.email=chiche@example.invalid -c commit.gpgsign=false commit -q -m "fixture mini-cli-publish"
