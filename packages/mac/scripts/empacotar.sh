#!/bin/bash
# Monta build/StepByStep.app a partir do binário release e assina com a identidade estável
# (certificado autoassinado "StepByStep Dev" — ver README). Com assinatura estável o TCC mantém
# as permissões entre builds; ad-hoc ("-") muda o cdhash e pede tudo de novo.
# `pipefail`: um erro do `swift build` interrompe aqui — nunca empacota o binário de um build anterior.
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTIDADE="${IDENTIDADE:-StepByStep Dev}"
APP="build/StepByStep.app"

mkdir -p build
swift build -c release 2>&1 | tee build/build.log
BIN="$(swift build -c release --show-bin-path)/StepByStep"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/StepByStep"
cp Recursos/Info.plist "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

if security find-identity -v -p codesigning | grep -q "$IDENTIDADE"; then
  codesign --force --deep --sign "$IDENTIDADE" --identifier br.com.dexterity.stepbystep "$APP"
  echo "Assinado com \"$IDENTIDADE\"."
else
  echo "AVISO: identidade \"$IDENTIDADE\" não encontrada no Acesso às Chaves; assinando ad-hoc (o TCC vai pedir as permissões a cada build)." >&2
  codesign --force --deep --sign - --identifier br.com.dexterity.stepbystep "$APP"
fi

echo "Pronto: $APP — abra com: open $APP"
