# App Mac do StepByStep (SwiftPM, sem Xcode). Rodar no Mac com Command Line Tools (Swift 5.9+).

.PHONY: build test app run clean

build:
	sh scripts/build.sh

test:
	mkdir -p build
	swift test 2>&1 | tee build/test.log

app:
	sh scripts/empacotar.sh

run: app
	open build/StepByStep.app

clean:
	rm -rf .build build
