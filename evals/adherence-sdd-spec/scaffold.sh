#!/usr/bin/env bash
# Scaffold del caso adherence-sdd-spec: copia el fixture mini-cli al workspace
# del run. `claude plugin eval` lo ejecuta con cwd = workspace temporal del agente
# y con $0 = ruta absoluta de este archivo, así que el fixture se ubica relativo
# al script. Solo corre con --scaffold (bash del autor, corre como vos).
set -euo pipefail
cp -R "$(dirname "$0")/fixtures/mini-cli/." .
