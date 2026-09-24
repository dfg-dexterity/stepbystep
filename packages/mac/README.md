# StepByStep — app Mac

App de menu bar (Swift, SwiftPM, sem Xcode) que grava o que você faz em qualquer app do Mac e produz uma pasta
no formato do guia (`guide.json` + `imagens/*.png`), pronta para importar no editor web
(https://stepbystep-dexterity.vercel.app/editor/#/importar). O app **não gera frases**: grava `titulo: ""` +
`tituloAuto: true` e o editor escreve "Clique em «Salvar»" etc. (regras só em `packages/core`).

Alvo: macOS 14+ (ScreenCaptureKit `SCScreenshotManager`), Swift 5.9+, sem dependências externas.

## Toolchain

```
xcode-select --install          # Command Line Tools (trazem swift, swiftpm e o SDK)
swift --version                 # 5.9 ou mais novo
cd packages/mac
make build                      # swift build -c release  → build/build.log
make test                       # swift test (GuiaTests, CoordenadasTests)
make app                        # scripts/empacotar.sh → build/StepByStep.app assinado
open build/StepByStep.app       # SEMPRE por `open`, nunca o binário no Terminal
```

O código foi escrito sem compilador (Linux). O **único guarda-corpo real é o `swift build` no Mac** (ou o job
`macos-latest` do CI). Na primeira compilação, espere uma ou duas rodadas de correção:

```
swift build 2>&1 | tee build.log      # ou simplesmente `make build` (grava build/build.log)
```

**O que fazer com o `build.log`:** envie o arquivo inteiro (ou cole os trechos `error:`) para quem mantém o
código — cada erro traz arquivo, linha e coluna. Não "corrija" apagando funcionalidades: quase sempre é rótulo
de argumento, tipo opcional ou API que mudou de nome. Warnings podem ser ignorados na primeira rodada.

## Estrutura

```
Package.swift                         tools 5.9; macOS 14; alvos StepByStepNucleo (lib), StepByStep (exec), StepByStepNucleoTests
Sources/StepByStepNucleo/Guia.swift   structs Codable do formato v1 (chaves em português), JSONEncoder configurado
Sources/StepByStepNucleo/Ids.swift    gerarId(prefixo) no padrão do JS
Sources/StepByStepNucleo/Coordenadas.swift  Quartz (pontos) → px da imagem; display sob o ponto
Sources/StepByStep/*.swift            app: menu bar, permissões, tap, captura, AX, OCR, teclado, gravador, persistência
Tests/StepByStepNucleoTests/          swift test (fixture: ../../../../tests/fixtures/guia-mac)
Recursos/Info.plist                   br.com.dexterity.stepbystep, LSUIElement, NSHighResolutionCapable
scripts/build.sh · scripts/empacotar.sh · Makefile
```

## Certificado "StepByStep Dev" (assinatura estável)

O TCC (Privacidade e Segurança) associa as permissões ao **código assinado**. Com assinatura ad-hoc (`-`) o
cdhash muda a cada build e o macOS pede Acessibilidade/Gravação de Tela de novo. Crie **uma vez** um
certificado autoassinado de assinatura de código:

1. Abra **Acesso às Chaves** › menu **Acesso às Chaves › Assistente de Certificado › Criar um Certificado…**
2. Nome: `StepByStep Dev` · Tipo de identidade: **Autoassinado (raiz)** · Tipo de certificado: **Assinatura de código**.
3. Conclua. Se aparecer em "login" como não confiável, abra o certificado › Confiar › "Assinatura de código: Confiar sempre".
4. `security find-identity -v -p codesigning` deve listar `"StepByStep Dev"`.

`scripts/empacotar.sh` usa essa identidade (`IDENTIDADE=... make app` para outra); sem ela, assina ad-hoc e avisa.

## Permissões

Ao abrir, o app confere e mostra o painel **Permissões…** (também no menu):

| Permissão | Obrigatória | Sem ela |
|---|---|---|
| Acessibilidade | sim | `CGEvent.tapCreate` devolve nil (nenhum clique/tecla é visto) e a AX não descreve os elementos |
| Gravação de Tela | sim | a captura sai preta ou só com o papel de parede |
| Monitoramento de Entrada | não | pedida automaticamente só se o tap receber `flagsChanged` mas nunca `keyDown` por 10 s |

Em Ajustes do Sistema › Privacidade e Segurança, adicione **build/StepByStep.app** (o painel abre a seção certa).
Depois de conceder, **feche e reabra o app**. Não existem chaves de Info.plist para esses prompts.

## Uso

- Menu: **Iniciar gravação (⌥⇧R)** → grava o app frontal; o título do item vira `● n` (passos).
- **Pausar/Retomar**, **Parar e revelar no Finder** (compacta `<pasta>.stepbystep.zip`, seleciona no Finder e abre o editor em `#/importar`).
- **Abrir pasta de gravações**: `~/Documents/StepByStep/`.
- **Recuperar gravação…**: aparece quando há pasta com `eventos.ndjson` cujo `guide.json` ficou em `gravando` (crash/reinício); reconstrói o `guide.json` do journal e compacta.
- Atalho global ⌥⇧R alterna iniciar/parar (detectado no próprio tap; não funciona pausado).

Pasta gravada (contrato com o editor, seção 6.3 da especificação):

```
2026-09-24_1412_sap-gui/
├── guide.json            # v1; titulo "" + tituloAuto true; origem.tipo "mac"; contexto {app,bundleId,janela,tela}; alvo.janelaBbox; anotacoes [recorte auto]; imagens {id → imagens/<id>.png}
├── imagens/img_<id>.png  # display inteiro em pixels reais (Retina 2x)
└── eventos.ndjson        # journal (ignorado pelo editor)
```

O que cada ação vira: clique → `clicar` (checkbox/radio/switch → `marcar`); digitação → `digitar` confirmado por
Enter, Tab, mudança de foco, próximo clique, 1,5 s sem teclas, troca de app ou Parar (valor lido do AX na
confirmação; campo seguro → `valor: null`, `sensivel: true`); Enter, F1–F12 e atalhos com ⌘/⌃/⌥ → `tecla`;
troca de app sem clique nos 2 s anteriores → `navegar` com `evento.app`. Duplo clique atualiza `evento.vezes`.
Sem rótulo pela AX, um OCR (Vision) no entorno do clique preenche `rotulo` com `fonteRotulo: "ocr"` depois.

## Roteiro de teste manual (12 pontos)

Rode com `open build/StepByStep.app`, grave, pare, importe a pasta/zip no editor e confira o `guide.json`
(`validarGuia` no editor não pode acusar erro).

1. **Permissões** — primeira abertura sem permissões: painel aparece; conceda Acessibilidade e Gravação de Tela, reabra: painel não volta; "Iniciar gravação" funciona. Rebuild com o certificado estável: as permissões permanecem.
2. **Retina** — num display 2x, clique num botão: `captura.largura/altura` são o dobro do `viewport`, `escala: 2`, `alvo.bbox = rectCss × 2` e `ponto` cai dentro do `bbox`.
3. **Dois monitores com origem negativa** — monitor secundário à esquerda/acima do principal: clique nele; a imagem é do display certo, `contexto.tela.id` muda e `bbox` fica dentro da imagem (nunca negativo).
4. **Menu suspenso na foto** — abra um menu e clique num item: a imagem mostra o menu aberto; `alvo.menu = "Arquivo › Salvar"`, `papel: "menuitem"`, recorte auto começa em `y: 0` (inclui a barra de menus).
5. **Popover/sheet na foto** — clique num botão dentro de um popover ou sheet: ele aparece na imagem (captura do display inteiro).
6. **Campo seguro** — digite numa senha (ex.: Ajustes, login web no Safari): passo `digitar` com `valor: null`, `sensivel: true`, `motivo: "AXSecureTextField"`; nada do valor no `guide.json` nem no `eventos.ndjson`.
7. **⌘S** — pressione ⌘S num app: passo `tecla` `{ tecla: "S", modificadores: ["Meta"], atalho: "⌘S" }` com captura própria; digitação pendente antes dele vira `digitar` (`confirmadoPor: "enter"`) com a imagem compartilhada pela tecla.
8. **App Chromium** (Chrome/Electron/VS Code) — clique num botão: `alvo.rotulo` vem da AX (`AXManualAccessibility` ligado ao iniciar/trocar de app). Sem AX, o OCR preenche o rótulo em segundos (`fonteRotulo: "ocr"`).
9. **SAP GUI / OCR** — clique num botão da toolbar do SAP GUI (ou app Java): rótulo pelo OCR; `campo` de um input pela label vinculada (`AXTitleUIElement`) quando existir.
10. **Pausa** — Pausar: cliques e teclas não geram passos, `●` some; Retomar: volta a gravar; contador continua de onde parou.
11. **Crash-safety** — durante a gravação, `kill -9` o app: reabra; "Recuperar gravação…" lista a pasta; recuperar produz `guide.json` `concluido` com todos os passos do `eventos.ndjson` e um `.stepbystep.zip`.
12. **Importação e recorte pela janela** — importe o zip no editor: títulos gerados em pt-BR, cada passo com imagem, `recorte` auto igual à janela clicada (anotação não destrutiva; "Remover recorte" mostra a tela inteira).

## Limites conhecidos (v1)

- Tap listen-only: o efeito do clique acontece no mouseUp (≥ 80 ms depois); a foto é do mouseDown. v1.1 prevê `SCStream` a 10 fps com o último frame.
- Rótulo por OCR chega depois e só atualiza o `guide.json` (não o journal).
- Uma gravação de cada vez (não use a extensão Chrome gravando ao mesmo tempo).
- Sem Xcode não há debugger visual; use `log stream --process StepByStep` e o `build.log`.
