#!/bin/bash
# Compila o app em modo release e guarda a saída em build.log (envie o arquivo se houver erros).
# `pipefail`: sem ele o status do pipeline seria o do `tee` (0) e um erro de compilação passaria em silêncio.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
swift build -c release 2>&1 | tee build/build.log
echo "Binário: $(swift build -c release --show-bin-path)/StepByStep"
