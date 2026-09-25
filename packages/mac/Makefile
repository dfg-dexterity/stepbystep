# App Mac do StepByStep (SwiftPM). `make build`/`make app` bastam com os Command Line Tools (Swift 5.9+);
# `make test` precisa do Xcode instalado (o XCTest não vem no CLT). bash + pipefail na própria linha da receita
# (o GNU Make 3.81 do macOS ignora .SHELLFLAGS): `swift … | tee` devolve o status do swift, não o do tee —
# sem isso build/testes quebrados passariam com exit 0.
SHELL := /bin/bash

.PHONY: build test app run clean

build:
	bash scripts/build.sh

test:
	mkdir -p build
	set -o pipefail; swift test 2>&1 | tee build/test.log

app:
	bash scripts/empacotar.sh

run: app
	open build/StepByStep.app

clean:
	rm -rf .build build
