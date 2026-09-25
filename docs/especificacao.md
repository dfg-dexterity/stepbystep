# StepByStep — Especificação Final de Arquitetura (v1)

Repositório `dfg-dexterity/stepbystep` · Dexterity IT Solutions · pt-BR · Node 22 · sem bundler

Este documento é o **contrato** entre os pacotes implementados em paralelo. Tudo o que atravessa a fronteira de um pacote (formato do guia, módulos e assinaturas do núcleo, mensagens da extensão, layout da pasta do Mac, endpoints de `api/`, esquema do IndexedDB) está fechado aqui. Mudanças nesses pontos exigem alterar este documento primeiro. Nomes de arquivos, funções, campos e mensagens são **exatos**; o que não está aqui é decisão interna do pacote.

---

## 1. Visão geral e decisões

StepByStep grava processos passo a passo (no navegador, via extensão Chrome MV3; no Mac, via app de menu bar em Swift), gera anotações polidas em pt-BR, permite editar o resultado num editor web sem build (visual Dexterity) e exporta para Markdown+imagens (zip), HTML autocontido, PDF (impressão) e Notion.

| # | Decisão | Justificativa curta |
|---|---|---|
| D1 | **Um único formato de guia** (JSON v1 + PNGs originais), produzido por extensão, Mac e inserção manual, consumido pelo editor | Sem conversões; o editor não tem ramificações por origem. |
| D2 | **Núcleo JS puro em `packages/core`** (ES modules, sem DOM, sem `chrome.*`) roda igual em Node (`node --test`), no service worker e na página | Uma implementação de modelo, frases, coordenadas, redutor, render, exportadores e Notion. |
| D3 | **Sem build**: a extensão é a pasta `packages/extensao/` com `core/` e `editor/` copiados por script (`npm run sincronizar`); a Vercel serve o repositório com rewrites `/editor/*` → `packages/editor/*`, `/core/*` → `packages/core/*` | Mesmos arquivos e mesmos imports relativos (`../core/x.js`) nos dois lugares; teste de sincronização garante cópias idênticas. |
| D4 | **Captura no `pointerdown`** (fase de captura), barra oculta + 2×`requestAnimationFrame` antes de pedir a captura; imagem de < 500 ms atrás é **reaproveitada** em vez de esperar o slot de `captureVisibleTab` (≤ 2/s); falha → passo salvo com `captura.faltante: true` | A captura precisa acontecer antes da navegação disparada pelo clique; um passo nunca é perdido. |
| D5 | **Escala imagem/viewport medida no bitmap** (`largura / viewport.largura`), nunca no `devicePixelRatio` | Imune a zoom, DPR fracionário e arredondamentos. Todas as coordenadas do guia são em pixels da imagem original. |
| D6 | Content scripts **registrados dinamicamente só durante a gravação** (`chrome.scripting.registerContentScripts`) e, além disso, **inertes até ler `chrome.storage.session`** | Nada é injetado fora da gravação; após navegação ou sono do SW a barra volta sem depender do SW. |
| D7 | **Estado do SW só em `chrome.storage.session` + IndexedDB**; listeners registrados síncronos no topo de `sw.js`; imports estáticos (nunca `import()` dinâmico no SW) | O SW pode ser descartado a qualquer momento. |
| D8 | Iframes: **cadeia de `postMessage`** filho→pai (`contentWindow === event.source`), com atalho `window.frameElement` quando same-origin | Funciona cross-origin e em qualquer profundidade. |
| D9 | Barra flutuante em **shadow root fechado, `adoptedStyleSheets`, DOM via `createElement`** | Imune a CSP `style-src` e Trusted Types. |
| D10 | **Anotações não destrutivas**: lista ordenada de operações em px da imagem original; `recorte` é janela de saída (aplicado por último, não desloca as demais); dados sensíveis usam **pixelização** (irreversível) | Original preservado; export "assa" um novo PNG. |
| D11 | **Undo/redo por snapshots** (`structuredClone` do guia sem imagens), com coalescência de edições de texto | Menos código e sem risco de inverso errado. |
| D12 | Mac: **macOS 14+**, tap `.listenOnly`, `SCScreenshotManager.captureImage` do **display inteiro** sob o cursor + `recorte` automático pela janela; AX + `AXManualAccessibility` + OCR (Vision) como fallback; `.app` assinado com **certificado autoassinado estável** | Menus/popovers/sheets aparecem na foto; TCC não esquece as permissões a cada build; código Swift escrito sem compilador aqui é validado por job `macos-latest` no CI. |
| D13 | Mac grava `titulo: ""` + `tituloAuto: true`; **o editor gera as frases** | Zero duplicação de regras em Swift. |
| D14 | Notion: File Upload API (`/v1/file_uploads` + `/send` multipart, bloco `image` `file_upload`), `Notion-Version: 2022-06-28` fixa, publicação **retomável**; da extensão chama direto (`host_permissions`); do editor hospedado, via `api/notion.js` (assinatura Web, corpo repassado byte a byte, CORS restrito à origem do editor) | A API não aceita CORS de navegador; o token é sempre do usuário e nunca fica no servidor. |
| D15 | Testes: `node --test` para núcleo/API; Playwright 1.56 (`launchPersistentContext` + `channel: 'chromium'` headless novo + `--load-extension`) para extensão e editor | Tudo verificável em Linux, exceto Swift (CI macOS + roteiro manual). |

Fora da v1: Safari (conversor depois; o manifest evita APIs exclusivas do Chrome), Firefox, update incremental de página no Notion, OAuth público do Notion, servidor local/Native Messaging para o Mac.

---

## 2. Layout do monorepo

```
stepbystep/
├── package.json                          # "type":"module"; scripts: test, test:e2e, dev, sincronizar, empacotar, fixtures; engines node>=22; devDependencies: playwright 1.56
├── vercel.json                           # regions gru1; redirects / → /editor/; rewrites /editor/* → packages/editor/*, /core/* → packages/core/*; functions api/**: maxDuration 60; headers
├── .vercelignore                         # packages/extensao packages/mac tests scripts node_modules docs .github
├── .gitignore                            # node_modules/ packages/extensao/core/ packages/extensao/editor/ packages/mac/.build/ packages/mac/build/ dist/ tmp/
├── README.md                             # visão geral, instalar extensão (carregar sem compactação), build do Mac, uso do editor, testes
├── CLAUDE.md                             # regras da casa deste repo (lógica só em packages/core, sem segredos, pt-BR, dexterity.css intocado)
├── docs/
│   ├── especificacao.md                  # ESTE documento (contrato)
│   └── notion.md                         # guia do usuário: criar integração interna, compartilhar página-mãe, colar token
├── packages/
│   ├── core/                             # NÚCLEO — ES modules puros (sem DOM, sem chrome.*)
│   │   ├── modelo.js                     # FORMATO, VERSAO, TIPOS_PASSO, TIPOS_ANOTACAO, CORES, criarGuia, criarPasso, criarAnotacao, validarGuia, migrarGuia, clonarGuia, renumerarMarcadores, numeroDoPasso
│   │   ├── ids.js                        # gerarId(prefixo), validarId(id)
│   │   ├── frases.js                     # gerarTitulo(passo, opcoes), abreviarUrl, formatarAtalho, truncar
│   │   ├── mascara.js                    # classificarCampo(descricao) → {sensivel, motivo}
│   │   ├── coordenadas.js                # cssParaImagem, pontoParaImagem, somarDeslocamentos, limitarAImagem, centro, posicaoMarcador, recorteFocado
│   │   ├── redutor-eventos.js            # criarEstadoRedutor, reduzir(estado, entrada, agora) → {estado, acoes}
│   │   ├── anotacoes.js                  # normalizarAnotacoes, separarRecorte, areaSaida, pontaDaSeta, bboxDaAnotacao, hitTest, moverAnotacao, anotacoesAutomaticas
│   │   ├── render-canvas.js              # medidas(passo), desenharPasso(ctx, imagem, passo, opcoes), assarPasso(bitmap, passo, opcoes)
│   │   ├── exportar-markdown.js          # guiaParaMarkdown(guia, opcoes), nomeImagemExportada(indice)
│   │   ├── exportar-html.js              # guiaParaHtml(guia, opcoes)
│   │   ├── zip.js                        # criarZip(entradas), lerZip(bytes), crc32(bytes)
│   │   ├── pacote.js                     # NOME_GUIDE, PASTA_IMAGENS, caminhoImagem, guiaParaPacote, lerPacote
│   │   ├── notion-blocos.js              # guiaParaBlocos, dividirEmLotes, richText, richTextComDestaque, contarBlocos
│   │   ├── notion-cliente.js             # VERSAO_NOTION, ROTAS_PERMITIDAS, criarClienteNotion({token, base, fetch}), traduzirErroNotion
│   │   ├── armazenamento.js              # IndexedDB "stepbystep" v1: abrirBanco, salvarGuia, carregarGuia, listarGuias, excluirGuia, salvarImagem, carregarImagem, listarImagensDoGuia, excluirImagensOrfas, obterConfig, salvarConfig
│   │   └── redimensionar.js              # reduzirImagem(blob, opcoes) → Blob (OffscreenCanvas; só navegador)
│   ├── editor/                           # EDITOR web sem build (hospedado na Vercel e copiado para a extensão)
│   │   ├── index.html                    # única página: biblioteca (#/) e editor (#/guia/ID)
│   │   ├── app.js                        # bootstrap, roteador por hash, detecção de ambiente (extensão × hospedado), ligação dos módulos
│   │   ├── app.css                       # estilos próprios sobre os tokens --dxt-* (grade 1px, sem raio, sem sombra)
│   │   ├── dexterity.css                 # CÓPIA IDÊNTICA do arquivo canônico dos apps Dexterity (não editar aqui)
│   │   ├── fontes.css                    # @font-face locais (Barlow Condensed, Figtree, IBM Plex Mono) com font-display: swap
│   │   ├── fontes/                       # woff2 (OFL): BarlowCondensed-{Regular,SemiBold}, Figtree-{Regular,SemiBold}, IBMPlexMono-{Regular,Medium}
│   │   ├── impressao.css                 # @page A4 15mm; .passo {break-inside: avoid}; esconde UI
│   │   ├── logo-dexterity.svg            # marca (cópia do arquivo dos demais apps)
│   │   ├── estado.js                     # estado do editor {guia, passoAtualId, ferramenta, selecaoAnotacaoId} + emissor "mudou"
│   │   ├── historico.js                  # undo/redo por snapshots (limite 200), coalescência de texto, atalhos
│   │   ├── biblioteca.js                 # tela inicial: guias salvos, importar, novo guia manual, banner de gravação interrompida
│   │   ├── lista-passos.js               # cartões de passo: reordenar (drag + Alt+↑/↓), editar, excluir, inserir, mesclar, duplicar, seção, regerar título
│   │   ├── canvas-anotacao.js            # painel da imagem: <canvas> de visualização + camada de preview, zoom, ferramentas
│   │   ├── ferramentas.js                # máquina de estados das ferramentas (selecionar, recorte, desfoque, retangulo, seta, marcador, texto)
│   │   ├── painel-passo.js               # título, descrição, tipo, metadados de contexto, lista de anotações do passo
│   │   ├── importar.js                   # .json, .zip/.stepbystep.zip, pasta (webkitdirectory + drag&drop webkitGetAsEntry)
│   │   ├── exportar.js                   # .stepbystep.zip, Markdown+imagens.zip, HTML, Imprimir/PDF
│   │   ├── notion-dialogo.js             # token (Testar), busca da página-mãe, publicar com progresso, retomar
│   │   └── componentes/                  # dialogo.js, aviso.js (toast), menu.js — sem framework
│   ├── extensao/                         # EXTENSÃO Chrome MV3 (raiz carregável após `npm run sincronizar`)
│   │   ├── manifest.json
│   │   ├── _locales/pt_BR/messages.json  # nome, descricao
│   │   ├── sw.js                         # service worker (module): listeners síncronos no topo; importa ./core/*.js e ./sw/*.js
│   │   ├── sw/estado.js                  # lerEstado/gravarEstado/limparEstado sobre chrome.storage.session (injetável para teste)
│   │   ├── sw/captura.js                 # capturar(janelaId, url, agora) com reaproveitamento < 500 ms, retry 120 ms, faltante
│   │   ├── sw/gravacao.js                # iniciar/pausar/retomar/parar; registro dinâmico de content scripts; badge; abrir editor
│   │   ├── sw/navegacao.js               # webNavigation.* → entradas do redutor; adoção de abas novas
│   │   ├── conteudo/barra.js             # script clássico: barra flutuante (frame 0), shadow root fechado, adoptedStyleSheets
│   │   ├── conteudo/gravador.js          # script clássico: sensor (pointerdown/keydown/input/change/focus), descritor, digitação, iframes
│   │   ├── popup/popup.html              # iniciar/pausar/parar, contador, últimos guias, abrir editor
│   │   ├── popup/popup.js
│   │   ├── popup/popup.css               # @import ../editor/dexterity.css + compacto
│   │   ├── icones/16.png 32.png 48.png 128.png
│   │   ├── core/                         # (gerado por scripts/sincronizar-extensao.mjs — gitignored)
│   │   └── editor/                       # (idem)
│   └── mac/                              # APP MAC (SwiftPM, sem Xcode)
│       ├── Package.swift                 # tools 5.9; platforms macOS 14; targets StepByStepNucleo (lib), StepByStep (exec), StepByStepNucleoTests
│       ├── Sources/StepByStepNucleo/Guia.swift          # structs Codable do formato v1 + JSONEncoder configurado
│       ├── Sources/StepByStepNucleo/Ids.swift           # gerarId(prefixo) no mesmo padrão do JS
│       ├── Sources/StepByStepNucleo/Coordenadas.swift   # Quartz (pontos) → px da imagem; display sob o ponto; escala
│       ├── Sources/StepByStep/main.swift                # NSApplication .accessory + AppDelegate
│       ├── Sources/StepByStep/AppDelegate.swift         # ciclo de vida, recuperação de gravação, permissões no início
│       ├── Sources/StepByStep/MenuBar.swift             # NSStatusItem, menu, contador, atalho ⌥⇧R via tap
│       ├── Sources/StepByStep/Permissoes.swift          # Acessibilidade, Gravação de Tela, Monitoramento de Entrada (preflight + painel)
│       ├── Sources/StepByStep/MonitorEventos.swift      # CGEventTap listenOnly; reabilita em tapDisabledByTimeout; despacha p/ fila serial
│       ├── Sources/StepByStep/Captura.swift             # SCShareableContent + SCScreenshotManager por display; janela sob o ponto
│       ├── Sources/StepByStep/Acessibilidade.swift      # AXUIElementCopyElementAtPosition, atributos, app/janela, menu, AXManualAccessibility
│       ├── Sources/StepByStep/OCR.swift                 # VNRecognizeTextRequest num recorte ao redor do clique (fallback de rótulo)
│       ├── Sources/StepByStep/Teclado.swift             # buffer de digitação por elemento focado, Enter/atalhos, campo seguro
│       ├── Sources/StepByStep/Gravador.swift            # máquina de estados: evento → descritor → captura → passo → persistência
│       ├── Sources/StepByStep/Persistencia.swift        # pasta, imagens/*.png, eventos.ndjson (journal), guide.json atômico, zip via ditto
│       ├── Tests/StepByStepNucleoTests/GuiaTests.swift        # codifica/decodifica o fixture guia-mac e compara campo a campo
│       ├── Tests/StepByStepNucleoTests/CoordenadasTests.swift # displays negativos, escalas 1/2 mistas, clamp
│       ├── Recursos/Info.plist           # CFBundleIdentifier br.com.dexterity.stepbystep, LSUIElement, NSHighResolutionCapable
│       ├── scripts/build.sh              # swift build -c release
│       ├── scripts/empacotar.sh          # monta build/StepByStep.app + codesign com identidade estável
│       ├── Makefile                      # build, test, app, run
│       └── README.md                     # toolchain, certificado "StepByStep Dev", permissões, roteiro de teste manual
├── api/
│   ├── notion.js                         # proxy allow-list para api.notion.com (assinatura Web; /api/notion/* chega via rewrite)
│   └── hash.js                           # SHA-256 dos arquivos servidos (padrão da casa; allow-list /editor/* e /core/*)
├── scripts/
│   ├── dev-server.mjs                    # :8080 — estático com os mesmos rewrites da Vercel + /api/notion (Web) + /api/hash (Node) + NOTION_BASE
│   ├── sincronizar-extensao.mjs          # fs.cp packages/core → packages/extensao/core; packages/editor → packages/extensao/editor
│   ├── empacotar-extensao.mjs            # zip de packages/extensao (após sincronizar) em dist/stepbystep-extensao-<versao>.zip
│   ├── notion-falso.mjs                  # servidor Notion falso (node:http) para e2e e testes de API
│   └── gerar-fixtures.mjs                # gera tests/fixtures/guia-exemplo/** e guia-mac/** (PNGs sólidos escritos sem dependências)
├── tests/
│   ├── core/                             # node --test (P1)
│   │   ├── modelo.test.mjs · ids.test.mjs · frases.test.mjs · mascara.test.mjs · coordenadas.test.mjs
│   │   ├── redutor.test.mjs · anotacoes.test.mjs · render-canvas.test.mjs · zip.test.mjs · pacote.test.mjs
│   │   ├── exportar-markdown.test.mjs · exportar-html.test.mjs · notion-blocos.test.mjs · notion-cliente.test.mjs
│   ├── extensao/estado.test.mjs          # sw/estado.js com chrome.storage.session falso (P2)
│   ├── api/notion-proxy.test.mjs         # handler Web com Request apontando NOTION_BASE para o Notion falso (P5)
│   ├── sincronizacao.test.mjs            # packages/extensao/{core,editor} idênticos byte a byte aos originais (P5)
│   ├── e2e/extensao.e2e.mjs              # Playwright: grava formulario.html → passos esperados (P2)
│   ├── e2e/editor.e2e.mjs                # Playwright: importa fixture, edita, anota, desfaz, exporta, Notion falso (P3)
│   └── fixtures/
│       ├── frases.json                   # [{passo, opcoes, esperado}] — fonte única dos testes de frases (P1)
│       ├── guia-exemplo/                 # guide.json v1 (o da seção 3) + imagens/*.png (gerado por scripts/gerar-fixtures.mjs)
│       ├── guia-mac/                     # pasta como o app Mac grava (titulo "", tituloAuto true, recorte auto, eventos.ndjson)
│       └── paginas/                      # formulario.html, pagina2.html (CSP restritivo), iframe-filho.html (P2)
└── .github/workflows/
    ├── testes.yml                        # ubuntu: npm ci, npm test, npm run test:e2e; macos-latest: swift build + swift test em packages/mac
    └── verificar-publicacao.yml          # após deploy: confere /api/hash de /editor/app.js e /core/modelo.js contra o repositório
```

`package.json` (conteúdo fixado):

```json
{
  "name": "stepbystep",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test tests/core/*.test.mjs tests/extensao/*.test.mjs tests/api/*.test.mjs tests/sincronizacao.test.mjs",
    "test:e2e": "npm run sincronizar && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test --test-concurrency=1 tests/e2e/*.e2e.mjs",
    "dev": "node scripts/dev-server.mjs",
    "sincronizar": "node scripts/sincronizar-extensao.mjs",
    "empacotar": "npm run sincronizar && node scripts/empacotar-extensao.mjs",
    "fixtures": "node scripts/gerar-fixtures.mjs"
  },
  "devDependencies": { "playwright": "1.56.0" }
}
```

`vercel.json` (conteúdo fixado):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["gru1"],
  "redirects": [{ "source": "/", "destination": "/editor/", "permanent": false }],
  "rewrites": [
    { "source": "/editor", "destination": "/packages/editor/index.html" },
    { "source": "/editor/", "destination": "/packages/editor/index.html" },
    { "source": "/editor/:caminho*", "destination": "/packages/editor/:caminho*" },
    { "source": "/core/:caminho*", "destination": "/packages/core/:caminho*" }
  ],
  "functions": { "api/**/*.js": { "maxDuration": 60 } },
  "headers": [
    { "source": "/editor/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=300" }] },
    { "source": "/core/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=300" }] }
  ]
}
```

URL de produção: `https://stepbystep-dexterity.vercel.app` (constante `URL_EDITOR` em `packages/core/notion-cliente.js` só para mensagens; o proxy lê a lista de origens de `ORIGENS_PERMITIDAS`, ver seção 8).

---

## 3. Formato do guia (JSON v1)

### 3.1 Regras gerais

- `formato: "stepbystep/guia"`, `versao: 1` (inteiro; só incrementa em mudança incompatível; `migrarGuia` sobe versões antigas; o editor recusa `formato` desconhecido ou `versao` maior).
- **Todas as coordenadas** (`alvo.bbox`, `alvo.ponto`, anotações, `janelaBbox`) são em **pixels da imagem original** do passo. `alvo.rectCss` é só a origem (CSS px do viewport no navegador; pontos da tela no Mac) para recomputar se a imagem for substituída.
- Ids: `gerarId(prefixo)` = `prefixo + "_" + Date.now().toString(36) + 6 chars base36 aleatórios` (`crypto.getRandomValues`). Prefixos: `g` (guia), `p` (passo), `img` (imagem), `a` (anotação). Regex: `/^(g|p|img|a)_[0-9a-z]{8,24}$/`. Swift gera o mesmo padrão.
- Ordem dos passos = ordem do array. Sem campo `ordem`.
- Datas: ISO 8601 UTC.
- `titulo === ""` com `tituloAuto === true` significa "gere para mim" (é assim que o Mac entrega). Quando o usuário edita o título, `tituloAuto` vira `false` e nada mais o sobrescreve.
- `imagens` (mapa `imagemId → {arquivo, largura, altura, mime}`) **só existe na serialização em pasta/zip**. No IndexedDB os bytes ficam no store `imagens` e o campo é removido ao salvar.
- Dois passos podem apontar para a mesma `imagemId` (`captura.fonte: "compartilhada"`).
- Passos sem imagem: `captura: null` (`tecla`, `secao`, `manual` sem imagem). Captura tentada e falha: `captura.faltante: true` com `imagemId: null`.

### 3.2 Tipos

- `tipo` do passo: `navegar` | `clicar` | `digitar` | `selecionar` | `marcar` | `tecla` | `secao` | `manual`.
- `papel` do alvo (vocabulário ARIA nas duas superfícies): `button` | `link` | `textbox` | `combobox` | `checkbox` | `radio` | `switch` | `tab` | `menuitem` | `option` | `generic`. No Mac, `papelNativo` guarda o AXRole (mapa: AXButton→button, AXLink→link, AXTextField/AXTextArea/AXSecureTextField→textbox, AXPopUpButton/AXComboBox→combobox, AXCheckBox→checkbox, AXRadioButton→radio, AXMenuItem/AXMenuBarItem→menuitem, AXTabGroup filho/subrole AXTabButton→tab, demais→generic).
- `fonteRotulo`: `aria` | `label` | `texto` | `title` | `alt` | `placeholder` | `name` | `celula` | `ax` | `ocr` | `nenhum`.
- `captura.fonte`: `pointerdown` | `confirmacao` | `navegacao` | `compartilhada` | `manual`.
- `evento.confirmadoPor` (digitar): `blur` | `enter` | `clique` | `navegacao` | `tempo` | `parar`.
- `anotacoes[].tipo`: `recorte` | `desfoque` | `retangulo` | `seta` | `marcador` | `texto`.
- Cores das anotações são **tokens**, não hex: `cerceta` | `ambar` | `roxo` | `base` | `off`. Resolvidas por `CORES` em `modelo.js`: `{ cerceta:'#009994', cercetaClaro:'#00B3AC', ambar:'#FFA436', roxo:'#98569A', base:'#1B1B1B', off:'#F7F3E7', branco:'#FFFFFF' }` (idênticas aos tokens `--dxt-*` do `dexterity.css`).
- `estado` do guia: `gravando` | `interrompido` | `concluido`.

### 3.3 Anotações (operações não destrutivas, ordenadas)

| tipo | campos | semântica |
|---|---|---|
| `recorte` | `x,y,w,h` | No máximo um. Define a área visível de saída; aplicado como janela (translate + tamanho do canvas), **não desloca** as demais coordenadas. |
| `desfoque` | `x,y,w,h,bloco` | Pixelização determinística em blocos de `bloco` px da imagem (padrão `8 × escala`). Irreversível na exportação. |
| `retangulo` | `x,y,w,h,cor` | Traço de `3 × escala` px, cantos retos. |
| `seta` | `de:{x,y},para:{x,y},cor` | Haste `4 × escala`, ponta triangular `16 × escala`. |
| `marcador` | `x,y,numero,cor` | Círculo raio `16 × escala`, número em Barlow Condensed branco, anel branco `2 × escala` + fio `1 × escala` base. |
| `texto` | `x,y,texto,tamanho,cor,fundo` | Figtree 600; `fundo` = token ou `null`; `tamanho` em px da imagem. |

Campos comuns: `id` (`a_…`), `auto` (bool — criada pela captura; o usuário pode mover/excluir). Ao reordenar passos, o editor renumera os marcadores `auto` com o número do passo; marcadores manuais mantêm `numero`.

### 3.4 Exemplo completo (`tests/fixtures/guia-exemplo/guide.json`)

```json
{
  "formato": "stepbystep/guia",
  "versao": 1,
  "id": "g_m1x4k9zq7a2b",
  "titulo": "Cadastrar fornecedor no SAP Fiori",
  "descricao": "Como criar um parceiro de negócios do tipo fornecedor pelo app Manage Business Partner.",
  "idioma": "pt-BR",
  "autor": "Diego",
  "criadoEm": "2026-09-24T14:03:11.000Z",
  "atualizadoEm": "2026-09-24T14:21:40.000Z",
  "origem": { "tipo": "extensao", "versao": "0.1.0", "plataforma": "Chrome 130 / macOS 15" },
  "estilo": { "cor": "cerceta", "escurecerFora": true },
  "estado": "concluido",
  "publicacoes": [],
  "passos": [
    {
      "id": "p_m1x4k9zr01aa",
      "tipo": "navegar",
      "titulo": "Navegue para fiori.empresa.com.br/ui",
      "tituloAuto": true,
      "descricao": "",
      "criadoEm": "2026-09-24T14:03:12.100Z",
      "contexto": { "url": "https://fiori.empresa.com.br/ui#Shell-home", "tituloPagina": "Launchpad", "abaId": 812, "frameId": 0, "scroll": { "x": 0, "y": 0 } },
      "evento": { "url": "https://fiori.empresa.com.br/ui#Shell-home", "transicao": "inicio" },
      "alvo": null,
      "captura": { "imagemId": "img_m1x4k9zr01aa", "largura": 2880, "altura": 1620, "dpr": 2, "viewport": { "largura": 1440, "altura": 810 }, "escala": 2, "fonte": "navegacao", "faltante": false },
      "resultado": null,
      "anotacoes": []
    },
    {
      "id": "p_m1x4k9zr02ab",
      "tipo": "clicar",
      "titulo": "Clique em «Criar»",
      "tituloAuto": true,
      "descricao": "",
      "criadoEm": "2026-09-24T14:03:20.400Z",
      "contexto": { "url": "https://fiori.empresa.com.br/ui#BusinessPartner-manage", "tituloPagina": "Manage Business Partner", "abaId": 812, "frameId": 0, "scroll": { "x": 0, "y": 0 } },
      "evento": { "botao": "esquerdo", "vezes": 1, "modificadores": [] },
      "alvo": {
        "papel": "button", "papelNativo": null, "rotulo": "Criar", "fonteRotulo": "texto", "campo": null,
        "tag": "button", "tipoInput": null, "seletor": "#__button12-inner",
        "rectCss": { "x": 1270, "y": 146, "w": 72, "h": 26 },
        "bbox": { "x": 2540, "y": 292, "w": 144, "h": 52 },
        "ponto": { "x": 2612, "y": 318 },
        "frame": { "id": 0, "url": null }, "menu": null, "janelaBbox": null
      },
      "captura": { "imagemId": "img_m1x4k9zr02ab", "largura": 2880, "altura": 1620, "dpr": 2, "viewport": { "largura": 1440, "altura": 810 }, "escala": 2, "fonte": "pointerdown", "faltante": false },
      "resultado": { "url": "https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create" },
      "anotacoes": [
        { "id": "a_m1x4k9zr02a1", "tipo": "retangulo", "auto": true, "x": 2524, "y": 276, "w": 176, "h": 84, "cor": "cerceta" },
        { "id": "a_m1x4k9zr02a2", "tipo": "marcador", "auto": true, "x": 2700, "y": 276, "numero": 2, "cor": "cerceta" }
      ]
    },
    {
      "id": "p_m1x4k9zr03ac",
      "tipo": "digitar",
      "titulo": "Digite «ACME Ltda» no campo «Nome»",
      "tituloAuto": false,
      "descricao": "Use a razão social completa, sem abreviações.",
      "criadoEm": "2026-09-24T14:03:31.000Z",
      "contexto": { "url": "https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create", "tituloPagina": "Novo parceiro", "abaId": 812, "frameId": 0, "scroll": { "x": 0, "y": 240 } },
      "evento": { "valor": "ACME Ltda", "sensivel": false, "motivo": null, "confirmadoPor": "clique" },
      "alvo": { "papel": "textbox", "papelNativo": null, "rotulo": "Nome", "fonteRotulo": "label", "campo": "Nome", "tag": "input", "tipoInput": "text", "seletor": "#nome", "rectCss": { "x": 350, "y": 306, "w": 400, "h": 28 }, "bbox": { "x": 700, "y": 612, "w": 800, "h": 56 }, "ponto": null, "frame": { "id": 0, "url": null }, "menu": null, "janelaBbox": null },
      "captura": { "imagemId": "img_m1x4k9zr04ad", "largura": 2880, "altura": 1620, "dpr": 2, "viewport": { "largura": 1440, "altura": 810 }, "escala": 2, "fonte": "compartilhada", "faltante": false },
      "resultado": null,
      "anotacoes": [
        { "id": "a_m1x4k9zr03a1", "tipo": "recorte", "auto": false, "x": 400, "y": 400, "w": 1600, "h": 800 },
        { "id": "a_m1x4k9zr03a2", "tipo": "retangulo", "auto": true, "x": 684, "y": 596, "w": 832, "h": 88, "cor": "cerceta" },
        { "id": "a_m1x4k9zr03a3", "tipo": "marcador", "auto": true, "x": 1516, "y": 596, "numero": 3, "cor": "cerceta" },
        { "id": "a_m1x4k9zr03a4", "tipo": "seta", "auto": false, "de": { "x": 1700, "y": 900 }, "para": { "x": 1520, "y": 680 }, "cor": "ambar" },
        { "id": "a_m1x4k9zr03a5", "tipo": "texto", "auto": false, "x": 1710, "y": 920, "texto": "Razão social", "tamanho": 32, "cor": "base", "fundo": "off" }
      ]
    },
    {
      "id": "p_m1x4k9zr05ae",
      "tipo": "digitar",
      "titulo": "Digite sua senha no campo «Senha»",
      "tituloAuto": true,
      "descricao": "",
      "criadoEm": "2026-09-24T14:03:40.000Z",
      "contexto": { "url": "https://sso.empresa.com.br/login", "tituloPagina": "Entrar", "abaId": 812, "frameId": 0, "scroll": { "x": 0, "y": 0 } },
      "evento": { "valor": null, "sensivel": true, "motivo": "input[type=password]", "confirmadoPor": "enter" },
      "alvo": { "papel": "textbox", "papelNativo": null, "rotulo": "Senha", "fonteRotulo": "label", "campo": "Senha", "tag": "input", "tipoInput": "password", "seletor": "#senha", "rectCss": { "x": 350, "y": 386, "w": 400, "h": 28 }, "bbox": { "x": 700, "y": 772, "w": 800, "h": 56 }, "ponto": null, "frame": { "id": 0, "url": null }, "menu": null, "janelaBbox": null },
      "captura": { "imagemId": "img_m1x4k9zr05ae", "largura": 2880, "altura": 1620, "dpr": 2, "viewport": { "largura": 1440, "altura": 810 }, "escala": 2, "fonte": "confirmacao", "faltante": false },
      "resultado": null,
      "anotacoes": [
        { "id": "a_m1x4k9zr05a1", "tipo": "desfoque", "auto": true, "x": 700, "y": 772, "w": 800, "h": 56, "bloco": 16 },
        { "id": "a_m1x4k9zr05a2", "tipo": "retangulo", "auto": true, "x": 684, "y": 756, "w": 832, "h": 88, "cor": "cerceta" },
        { "id": "a_m1x4k9zr05a3", "tipo": "marcador", "auto": true, "x": 1516, "y": 756, "numero": 4, "cor": "cerceta" }
      ]
    },
    {
      "id": "p_m1x4k9zr06af",
      "tipo": "tecla",
      "titulo": "Pressione Enter",
      "tituloAuto": true,
      "descricao": "",
      "criadoEm": "2026-09-24T14:03:40.300Z",
      "contexto": { "url": "https://sso.empresa.com.br/login", "tituloPagina": "Entrar", "abaId": 812, "frameId": 0, "scroll": { "x": 0, "y": 0 } },
      "evento": { "tecla": "Enter", "modificadores": [], "atalho": "Enter" },
      "alvo": null,
      "captura": { "imagemId": "img_m1x4k9zr05ae", "largura": 2880, "altura": 1620, "dpr": 2, "viewport": { "largura": 1440, "altura": 810 }, "escala": 2, "fonte": "compartilhada", "faltante": false },
      "resultado": { "url": "https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create" },
      "anotacoes": []
    },
    {
      "id": "p_m1x4k9zr07ag",
      "tipo": "selecionar",
      "titulo": "Selecione «Brasil» em «País»",
      "tituloAuto": true,
      "descricao": "",
      "criadoEm": "2026-09-24T14:03:52.000Z",
      "contexto": { "url": "https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create", "tituloPagina": "Novo parceiro", "abaId": 812, "frameId": 0, "scroll": { "x": 0, "y": 240 } },
      "evento": { "valor": "BR", "opcao": "Brasil" },
      "alvo": { "papel": "combobox", "papelNativo": null, "rotulo": "País", "fonteRotulo": "label", "campo": "País", "tag": "select", "tipoInput": null, "seletor": "#pais", "rectCss": { "x": 350, "y": 436, "w": 400, "h": 28 }, "bbox": { "x": 700, "y": 872, "w": 800, "h": 56 }, "ponto": null, "frame": { "id": 0, "url": null }, "menu": null, "janelaBbox": null },
      "captura": { "imagemId": "img_m1x4k9zr07ag", "largura": 2880, "altura": 1620, "dpr": 2, "viewport": { "largura": 1440, "altura": 810 }, "escala": 2, "fonte": "confirmacao", "faltante": false },
      "resultado": null,
      "anotacoes": [
        { "id": "a_m1x4k9zr07a1", "tipo": "retangulo", "auto": true, "x": 684, "y": 856, "w": 832, "h": 88, "cor": "cerceta" },
        { "id": "a_m1x4k9zr07a2", "tipo": "marcador", "auto": true, "x": 1516, "y": 856, "numero": 6, "cor": "cerceta" }
      ]
    },
    {
      "id": "p_m1x4k9zr08ah",
      "tipo": "marcar",
      "titulo": "Marque «Aceito os termos»",
      "tituloAuto": true,
      "descricao": "",
      "criadoEm": "2026-09-24T14:04:01.000Z",
      "contexto": { "url": "https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create", "tituloPagina": "Novo parceiro", "abaId": 812, "frameId": 0, "scroll": { "x": 0, "y": 240 } },
      "evento": { "marcado": true },
      "alvo": { "papel": "checkbox", "papelNativo": null, "rotulo": "Aceito os termos", "fonteRotulo": "label", "campo": null, "tag": "input", "tipoInput": "checkbox", "seletor": "#aceito", "rectCss": { "x": 350, "y": 480, "w": 16, "h": 16 }, "bbox": { "x": 700, "y": 960, "w": 32, "h": 32 }, "ponto": { "x": 716, "y": 976 }, "frame": { "id": 0, "url": null }, "menu": null, "janelaBbox": null },
      "captura": { "imagemId": "img_m1x4k9zr08ah", "largura": 2880, "altura": 1620, "dpr": 2, "viewport": { "largura": 1440, "altura": 810 }, "escala": 2, "fonte": "pointerdown", "faltante": false },
      "resultado": null,
      "anotacoes": [
        { "id": "a_m1x4k9zr08a1", "tipo": "retangulo", "auto": true, "x": 684, "y": 944, "w": 64, "h": 64, "cor": "cerceta" },
        { "id": "a_m1x4k9zr08a2", "tipo": "marcador", "auto": true, "x": 748, "y": 944, "numero": 7, "cor": "cerceta" }
      ]
    },
    {
      "id": "p_m1x4k9zr09ai",
      "tipo": "secao",
      "titulo": "Conferência no SAP GUI",
      "tituloAuto": false,
      "descricao": "",
      "criadoEm": "2026-09-24T14:10:00.000Z",
      "contexto": null, "evento": null, "alvo": null, "captura": null, "resultado": null, "anotacoes": []
    },
    {
      "id": "p_m1x4k9zr10aj",
      "tipo": "clicar",
      "titulo": "Escolha o menu «Arquivo › Salvar»",
      "tituloAuto": true,
      "descricao": "",
      "criadoEm": "2026-09-24T14:12:10.000Z",
      "contexto": { "app": "SAP GUI", "bundleId": "com.sap.platin", "janela": "ME21N — Criar pedido", "tela": { "id": 2, "largura": 1728, "altura": 1117, "escala": 2 } },
      "evento": { "botao": "esquerdo", "vezes": 1, "modificadores": [] },
      "alvo": { "papel": "menuitem", "papelNativo": "AXMenuItem", "rotulo": "Salvar", "fonteRotulo": "ax", "campo": null, "tag": null, "tipoInput": null, "seletor": null, "rectCss": { "x": 120, "y": 62, "w": 180, "h": 22 }, "bbox": { "x": 240, "y": 124, "w": 360, "h": 44 }, "ponto": { "x": 300, "y": 146 }, "frame": null, "menu": "Arquivo › Salvar", "janelaBbox": { "x": 80, "y": 100, "w": 3200, "h": 2000 } },
      "captura": { "imagemId": "img_m1x4k9zr10aj", "largura": 3456, "altura": 2234, "dpr": 2, "viewport": { "largura": 1728, "altura": 1117 }, "escala": 2, "fonte": "pointerdown", "faltante": false },
      "resultado": null,
      "anotacoes": [
        { "id": "a_m1x4k9zr10a1", "tipo": "recorte", "auto": true, "x": 80, "y": 0, "w": 3200, "h": 2100 },
        { "id": "a_m1x4k9zr10a2", "tipo": "retangulo", "auto": true, "x": 224, "y": 108, "w": 392, "h": 76, "cor": "cerceta" },
        { "id": "a_m1x4k9zr10a3", "tipo": "marcador", "auto": true, "x": 616, "y": 108, "numero": 8, "cor": "cerceta" }
      ]
    },
    {
      "id": "p_m1x4k9zr11ak",
      "tipo": "manual",
      "titulo": "Confira o e-mail de confirmação",
      "tituloAuto": false,
      "descricao": "O sistema envia o número do parceiro em até 5 minutos.",
      "criadoEm": "2026-09-24T14:20:00.000Z",
      "contexto": null, "evento": null, "alvo": null, "captura": null, "resultado": null, "anotacoes": []
    }
  ],
  "imagens": {
    "img_m1x4k9zr01aa": { "arquivo": "imagens/img_m1x4k9zr01aa.png", "largura": 2880, "altura": 1620, "mime": "image/png" },
    "img_m1x4k9zr02ab": { "arquivo": "imagens/img_m1x4k9zr02ab.png", "largura": 2880, "altura": 1620, "mime": "image/png" },
    "img_m1x4k9zr04ad": { "arquivo": "imagens/img_m1x4k9zr04ad.png", "largura": 2880, "altura": 1620, "mime": "image/png" },
    "img_m1x4k9zr05ae": { "arquivo": "imagens/img_m1x4k9zr05ae.png", "largura": 2880, "altura": 1620, "mime": "image/png" },
    "img_m1x4k9zr07ag": { "arquivo": "imagens/img_m1x4k9zr07ag.png", "largura": 2880, "altura": 1620, "mime": "image/png" },
    "img_m1x4k9zr08ah": { "arquivo": "imagens/img_m1x4k9zr08ah.png", "largura": 2880, "altura": 1620, "mime": "image/png" },
    "img_m1x4k9zr10aj": { "arquivo": "imagens/img_m1x4k9zr10aj.png", "largura": 3456, "altura": 2234, "mime": "image/png" }
  }
}
```

### 3.5 Campos por tipo de passo

| tipo | `evento` | `alvo` | `captura` |
|---|---|---|---|
| `navegar` | `{ url, transicao: "inicio"\|"typed"\|"reload"\|"outro" }` (web) · `{ app }` (Mac, troca de app) | `null` | após pintura (`fonte: "navegacao"`) ou faltante |
| `clicar` | `{ botao: "esquerdo"\|"direito"\|"meio", vezes: 1\|2, modificadores: ["Ctrl"\|"Alt"\|"Shift"\|"Meta"] }` | obrigatório (`bbox` pode ser `null` se não resolvido) | `pointerdown` ou `compartilhada` |
| `digitar` | `{ valor: string\|null, sensivel, motivo: string\|null, confirmadoPor }` | obrigatório | `confirmacao` ou `compartilhada` |
| `selecionar` | `{ valor, opcao }` | obrigatório | `confirmacao` |
| `marcar` | `{ marcado: bool }` | obrigatório | `pointerdown` |
| `tecla` | `{ tecla, modificadores, atalho }` | `null` | `compartilhada` ou `null` |
| `secao` | `null` | `null` | `null` |
| `manual` | `null` | `null` | `null` ou `{ fonte: "manual", ... }` |

`contexto` web: `{ url, tituloPagina, abaId, frameId, scroll:{x,y} }`. `contexto` Mac: `{ app, bundleId, janela, tela:{ id, largura, altura, escala } }`. `resultado`: `{ url }` quando um clique/Enter disparou navegação (preenchido pelo SW), senão `null`. `mescladoDe: [ids]` opcional (auditoria de mesclagens). `publicacoes: [{ destino: "notion", paginaId, url, em, concluida, uploads: { [passoId]: uploadId }, lotesEnviados }]`.

### 3.6 Frases pt-BR (tabela normativa de `frases.gerarTitulo`)

Alvo sempre entre `«»`. `opcoes.plataforma`: `"mac"` | `"outro"` (padrão: derivado de `guia.origem.plataforma`, senão `"outro"`).

| situação | frase |
|---|---|
| navegar web | `Navegue para {abreviarUrl(url)}` — sem protocolo, sem `www.`, sem query; > 60 chars → corta em 57 + `…` |
| navegar Mac (`evento.app`) | `Abra o app «{app}»` |
| clicar button/generic com rótulo | `Clique em «{rotulo}»` |
| clicar link | `Clique no link «{rotulo}»` |
| clicar tab | `Abra a aba «{rotulo}»` |
| clicar menuitem com `alvo.menu` | `Escolha o menu «{menu}»` (caminho com ` › `) |
| clicar option | `Selecione «{rotulo}»` |
| clicar `vezes: 2` | `Dê dois cliques em «{rotulo}»` |
| clicar `botao: "direito"` | `Clique com o botão direito em «{rotulo}»` |
| clicar `botao: "meio"` | `Clique com o botão do meio em «{rotulo}»` |
| clicar sem rótulo | por papel: `Clique no botão` / `Clique no link` / `Clique aqui` |
| digitar normal, com campo | `Digite «{truncar(valor, 40)}» no campo «{campo}»` |
| digitar normal, sem campo | `Digite «{valor}»` |
| digitar sensível, motivo senha (`tipoInput=password` ou motivo contém `senha`/`password`) | `Digite sua senha no campo «{campo}»` (sem campo: `Digite sua senha`) |
| digitar sensível, outro motivo | `Preencha o campo «{campo}»` |
| selecionar | `Selecione «{opcao}» em «{campo}»` (sem campo: `Selecione «{opcao}»`) |
| marcar checkbox/switch `marcado: true` | `Marque «{rotulo}»` |
| marcar checkbox/switch `marcado: false` | `Desmarque «{rotulo}»` |
| marcar radio | `Selecione «{rotulo}»` |
| tecla sem modificadores | `Pressione {tecla}` (Enter, Esc, Tab, F5, Delete…) |
| tecla com modificadores, plataforma `outro` | `Pressione Ctrl+Shift+S` (ordem Ctrl, Alt, Shift, Meta→`Win`) |
| tecla com modificadores, plataforma `mac` | `Pressione ⌃⌥⇧⌘S` (ordem ⌃ ⌥ ⇧ ⌘, tecla maiúscula, sem `+`) |
| secao / manual | `titulo` como está (nunca regerado) |

Rótulos são normalizados: espaços colapsados, quebras removidas, ≤ 60 caracteres com `…`. `tests/fixtures/frases.json` contém ≥ 60 casos e é a fonte única de `tests/core/frases.test.mjs`.

---

## 4. Núcleo compartilhado (`packages/core`)

Regras: ES modules puros; nada de `document`, `window`, `chrome`; funções que precisam de canvas recebem o contexto/fábrica por parâmetro; `fetch` sempre injetado. Todos os módulos abaixo são exportados com **exatamente** estas assinaturas.

### 4.1 `modelo.js`

```js
export const FORMATO = 'stepbystep/guia';
export const VERSAO = 1;
export const TIPOS_PASSO = ['navegar','clicar','digitar','selecionar','marcar','tecla','secao','manual'];
export const TIPOS_ANOTACAO = ['recorte','desfoque','retangulo','seta','marcador','texto'];
export const PAPEIS = ['button','link','textbox','combobox','checkbox','radio','switch','tab','menuitem','option','generic'];
export const CORES = { cerceta:'#009994', cercetaClaro:'#00B3AC', ambar:'#FFA436', roxo:'#98569A', base:'#1B1B1B', off:'#F7F3E7', branco:'#FFFFFF' };

/** @param {{titulo?:string, descricao?:string, origem?:{tipo:'extensao'|'mac'|'manual', versao?:string, plataforma?:string}, autor?:string}} o
 *  @returns {Guia} guia válido, vazio, estado 'gravando' se origem.tipo!=='manual' senão 'concluido' */
export function criarGuia(o = {})
/** @param {{tipo:string, titulo?:string, tituloAuto?:boolean, descricao?:string, contexto?:object|null, evento?:object|null, alvo?:object|null, captura?:object|null, resultado?:object|null, anotacoes?:object[]}} o
 *  @returns {Passo} com id 'p_…', criadoEm agora; titulo '' e tituloAuto true por padrão */
export function criarPasso(o)
/** @param {string} tipo @param {object} props @returns {Anotacao} com id 'a_…', auto false por padrão, cor 'cerceta' por padrão */
export function criarAnotacao(tipo, props)
/** Valida estrutura, tipos, ids únicos, no máximo um recorte por passo, coordenadas numéricas ≥ 0, captura.faltante ⇒ imagemId null.
 *  @returns {{ok:boolean, erros:string[]}} mensagens em pt-BR com caminho (ex.: 'passos[3].anotacoes[1].bloco deve ser > 0') */
export function validarGuia(obj)
/** Sobe versões antigas para VERSAO; lança Error('Formato desconhecido') se formato ≠ FORMATO; idempotente. @returns {Guia} novo objeto */
export function migrarGuia(obj)
/** structuredClone sem o campo imagens. */
export function clonarGuia(guia)
/** Renumera marcadores auto: numero = numeroDoPasso(guia, indice). Muta e devolve o guia. */
export function renumerarMarcadores(guia)
/** Número exibido (1..n) ignorando passos 'secao'; devolve null para secao. */
export function numeroDoPasso(guia, indice)
```

### 4.2 `ids.js`

```js
/** @param {'g'|'p'|'img'|'a'} prefixo @returns {string} `${prefixo}_${Date.now().toString(36)}${6 chars base36 aleatórios}` */
export function gerarId(prefixo)
/** @returns {boolean} casa /^(g|p|img|a)_[0-9a-z]{8,24}$/ */
export function validarId(id)
```

### 4.3 `frases.js`

```js
/** @param {Passo} passo @param {{plataforma?:'mac'|'outro'}} [opcoes] @returns {string} conforme a tabela 3.6 */
export function gerarTitulo(passo, opcoes = {})
/** @returns {string} host+caminho sem protocolo, www., query e fragmento vazio; ≤ 60 chars */
export function abreviarUrl(url)
/** @param {string} tecla @param {string[]} modificadores @param {'mac'|'outro'} plataforma @returns {string} */
export function formatarAtalho(tecla, modificadores, plataforma)
/** @returns {string} texto normalizado (espaços colapsados) cortado em max-1 + '…' */
export function truncar(texto, max)
```

### 4.4 `mascara.js`

```js
/** @param {{tipoInput?:string|null, autocomplete?:string|null, nome?:string|null, id?:string|null, campo?:string|null, papelNativo?:string|null}} d
 *  @returns {{sensivel:boolean, motivo:string|null}}
 *  Regras: tipoInput==='password' → 'input[type=password]'; autocomplete ∈ {cc-number,cc-csc,cc-exp,cc-exp-month,cc-exp-year,current-password,new-password,one-time-code} → 'autocomplete='+valor;
 *  nome/id/campo casando /senha|password|passwd|token|secret|cvv|cvc|cart[ãa]o|cpf|cnpj/i → 'nome:'+trecho; papelNativo==='AXSecureTextField' → 'AXSecureTextField'. */
export function classificarCampo(d)
```

### 4.5 `coordenadas.js`

```js
/** @typedef {{x:number,y:number,w:number,h:number}} Rect  @typedef {{largura:number,altura:number}} Tamanho */
/** Escalas medidas: sx = imagem.largura/viewport.largura, sy = imagem.altura/viewport.altura. */
export function escalas(imagem, viewport) // → {sx, sy}
/** Rect em CSS px do viewport (já somados os deslocamentos de iframes) → px da imagem, arredondado e limitado à imagem.
 *  @param {Rect} rectCss @param {Tamanho} viewport @param {Tamanho} imagem @returns {Rect} (w/h podem ser 0 se totalmente fora) */
export function cssParaImagem(rectCss, viewport, imagem)
/** @param {{x,y}} pontoCss @returns {{x,y}} limitado à imagem */
export function pontoParaImagem(pontoCss, viewport, imagem)
/** @param {Rect} rectCss @param {{x:number,y:number}[]} deslocamentos (do frame mais interno ao topo) @returns {Rect} */
export function somarDeslocamentos(rectCss, deslocamentos)
export function limitarAImagem(rect, imagem) // → Rect
export function centro(rect) // → {x,y}
/** Centro do marcador: canto superior direito do bbox, deslocado para dentro da imagem se sair. @returns {{x,y}} */
export function posicaoMarcador(bbox, imagem, raio)
/** Recorte "focar no alvo": ao redor do bbox, largura ≥ max(40 % da imagem, bbox.w + 2*margem), proporção 16:10, dentro da imagem.
 *  @param {{margem?:number}} [opcoes] margem padrão 120*escala @returns {Rect} */
export function recorteFocado(bbox, imagem, opcoes = {})
```

### 4.6 `redutor-eventos.js`

Máquina de estados **pura e serializável** que transforma mensagens do gravador (já com captura resolvida pelo SW) em ações sobre o guia. O SW e o Mac (lógica simplificada em Swift) seguem as mesmas regras; os testes cobrem sequências com timestamps.

```js
/** @typedef {{ contador:number, urlAtual:string|null, ultimoClique:{passoId,seletor,url,em}|null, ultimoGatilho:{passoId,em}|null }} EstadoRedutor */
export function criarEstadoRedutor(urlInicial = null) // → EstadoRedutor

/** @typedef {{tipo:'PRE_CLIQUE'|'DIGITACAO'|'SELECAO'|'MARCACAO'|'TECLA'|'NAVEGACAO'|'NAVEGACAO_CAPTURADA'|'SPA', mensagem?:object, captura?:object|null, url?:string, transicao?:string, em:number}} Entrada
 *  @typedef {{tipo:'criar', passo:Passo}|{tipo:'atualizar', passoId:string, campos:object}|{tipo:'excluir', passoId:string}|{tipo:'capturarNavegacao', url:string}} Acao
 *  @param {EstadoRedutor} estado @param {Entrada} entrada @param {{plataforma?:'mac'|'outro'}} [opcoes]
 *  @returns {{estado:EstadoRedutor, acoes:Acao[]}} nunca muta `estado` */
export function reduzir(estado, entrada, opcoes = {})
```

Regras:
1. `PRE_CLIQUE`: se `mensagem.digitacaoPendente` → primeiro `criar` passo `digitar` (mesma `captura`, `fonte: 'compartilhada'`, `confirmadoPor: 'clique'`); depois: se `ultimoClique` tem o mesmo `seletor`, mesma `url` e `em − ultimoClique.em < 400` → `atualizar(ultimoClique.passoId, { evento.vezes: 2, titulo regerado se tituloAuto })` e nenhum passo novo; senão `criar` passo `clicar` (checkbox/radio/switch viram `marcar` com `evento.marcado = !mensagem.marcadoAntes`). Atualiza `ultimoClique` e `ultimoGatilho`.
2. `DIGITACAO`, `SELECAO`, `MARCACAO`: `criar` o passo correspondente.
3. `TECLA`: se `digitacaoPendente` → `criar` digitar (`confirmadoPor: 'enter'`, captura própria) e depois `criar` tecla com `fonte: 'compartilhada'`; Enter e atalhos atualizam `ultimoGatilho`.
4. `NAVEGACAO { url, transicao }`: se `ultimoGatilho && em − ultimoGatilho.em < 2000` ou `transicao ∈ {link, form_submit}` → `atualizar(ultimoGatilho.passoId, { resultado: { url } })`; senão → `capturarNavegacao { url }`. Sempre atualiza `urlAtual`.
5. `NAVEGACAO_CAPTURADA { url, captura }` → `criar` passo `navegar` (`transicao` da entrada, `fonte: 'navegacao'`).
6. `SPA { url }` (`onHistoryStateUpdated`/fragmento): só `urlAtual` e, se gatilho recente, `resultado.url`.
7. Todo passo criado recebe `titulo = gerarTitulo(passo, opcoes)`, `tituloAuto: true`, `alvo.bbox/ponto` convertidos por `coordenadas` (quando `captura` não é faltante) e `anotacoes = anotacoesAutomaticas(passo)`; `contador` incrementa e o marcador auto usa `contador`.

### 4.7 `anotacoes.js`

```js
/** Garante ids, auto boolean, cor padrão, um só recorte (mantém o último). @returns {Anotacao[]} nova lista */
export function normalizarAnotacoes(lista)
/** @returns {{recorte:Anotacao|null, demais:Anotacao[]}} */
export function separarRecorte(lista)
/** Área de saída: recorte limitado à imagem, ou a imagem inteira. @returns {Rect} */
export function areaSaida(imagem, recorte)
/** Triângulo da ponta. @returns {[{x,y},{x,y},{x,y}]} */
export function pontaDaSeta(de, para, tamanho)
export function bboxDaAnotacao(anotacao, medidas) // → Rect (seta/marcador/texto incluem espessura/raio)
/** @returns {boolean} ponto (px da imagem) dentro da anotação com tolerância */
export function hitTest(anotacao, ponto, tolerancia, medidas)
export function moverAnotacao(anotacao, dx, dy) // → nova anotação
/** Anotações geradas na captura: retangulo (bbox + 8·escala de folga) + marcador (posicaoMarcador) quando alvo.bbox; desfoque (bloco 8·escala) quando evento.sensivel;
 *  recorte quando alvo.janelaBbox (Mac). Nenhuma para navegar/tecla/secao/manual ou bbox null.
 *  @param {Passo} passo @param {{numero:number}} opcoes @returns {Anotacao[]} */
export function anotacoesAutomaticas(passo, opcoes)
```

### 4.8 `render-canvas.js`

```js
/** Medidas proporcionais à escala da captura (e = passo.captura?.escala ?? 1):
 *  { e, espessuraRect: 3e, raioMarcador: 16e, hasteSeta: 4e, pontaSeta: 16e, tamanhoTexto: 16e, fonteMarcador: `600 ${20e}px "Barlow Condensed"`, fonteTexto: `600 {t}px Figtree` } */
export function medidas(passo)
/** FUNÇÃO PURA de desenho. Não cria nem redimensiona canvas: o chamador dimensiona `ctx.canvas` para areaSaida × opcoes.escala.
 *  @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|object} ctx
 *  @param {{largura:number, altura:number, fonte:CanvasImageSource}} imagem  bitmap original
 *  @param {Passo} passo
 *  @param {{escala?:number, estilo?:{cor:string, escurecerFora:boolean}, criarCanvas:(w:number,h:number)=>{getContext:Function}, incluirRecorte?:boolean}} opcoes
 *  Ordem: save → scale(escala) → translate(−area.x, −area.y) → drawImage(fonte) → desfoques (pixelização via criarCanvas, imageSmoothingEnabled=false)
 *  → holofote (se estilo.escurecerFora e existe retangulo auto: clip evenodd área∖retângulo, fill rgba(27,27,27,.35)) → retangulos → setas → textos → marcadores → restore.
 *  Cores via CORES[token]; cor do retângulo/marcador auto = estilo.cor. */
export function desenharPasso(ctx, imagem, passo, opcoes)
/** Navegador: OffscreenCanvas(areaSaida × escalaSaida), desenharPasso, convertToBlob PNG.
 *  @param {ImageBitmap} bitmap @param {Passo} passo @param {{larguraMax?:number, tipo?:'image/png'|'image/webp', qualidade?:number, estilo?:object}} [opcoes]
 *  @returns {Promise<{blob:Blob, largura:number, altura:number}>} */
export async function assarPasso(bitmap, passo, opcoes = {})
```

O chamador (editor) faz `await document.fonts.ready` antes de assar. Em Node o teste usa um `ctx` falso (Proxy que registra chamadas) e verifica ordem e geometria.

### 4.9 `exportar-markdown.js` / `exportar-html.js`

```js
/** @param {Guia} guia @param {{nomeImagem:(passo:Passo, indice:number)=>string|null, data?:Date}} opcoes @returns {string}
 *  Estrutura: `# Título`, descrição, por passo `## {n}. {titulo}` (secao: `## {titulo}` sem número), descrição, `![Passo n — titulo](caminho)`;
 *  rodapé `---\n_Gerado com StepByStep · Dexterity IT Solutions · dd/mm/aaaa_` */
export function guiaParaMarkdown(guia, opcoes)
export function nomeImagemExportada(indice) // → 'imagens/passo-01.png' (2 dígitos; 3 a partir de 100)

/** @param {Guia} guia @param {{imagemDataUrl:(passo:Passo, indice:number)=>string|null, css:string, logoSvg?:string, data?:Date}} opcoes
 *  @returns {string} documento único: <style> com css (dexterity.css + impressao.css) inline, sem <script src>, sem <link> externo;
 *  cabeçalho (logo inline, título, descrição, n passos, data); <ol class="passos"> com <li class="passo" data-tipo> <h2><span class="numero">n</span> titulo</h2> <p> <img src="data:…">;
 *  secao → <h2 class="secao">; botão .no-print "Imprimir / salvar PDF" com onclick="window.print()". */
export function guiaParaHtml(guia, opcoes)
```

### 4.10 `zip.js` / `pacote.js`

```js
/** Escritor STORE (assinaturas 0x04034b50/0x02014b50/0x06054b50, CRC32, datas DOS, UTF-8 flag). @param {{nome:string, dados:Uint8Array}[]} entradas @returns {Promise<Uint8Array>} */
export async function criarZip(entradas)
/** Leitor STORE e DEFLATE (DecompressionStream('deflate-raw')). Ignora diretórios e __MACOSX/. @returns {Promise<Map<string, Uint8Array>>} nome → bytes */
export async function lerZip(bytes)
export function crc32(bytes) // → number sem sinal

export const NOME_GUIDE = 'guide.json';
export const PASTA_IMAGENS = 'imagens/';
export function caminhoImagem(imagemId, mime = 'image/png') // → 'imagens/img_….png'
/** Serializa guide.json (com `imagens`) + PNGs originais. @param {Guia} guia @param {(imagemId:string)=>Promise<{bytes:Uint8Array, largura:number, altura:number, mime:string}|null>} obterImagem
 *  @returns {Promise<Uint8Array>} zip */
export async function guiaParaPacote(guia, obterImagem)
/** Aceita arquivos na raiz ou dentro de UM diretório de primeiro nível (zip do Finder/ditto --keepParent). Valida e migra.
 *  @param {Map<string, Uint8Array>} arquivos @returns {{guia:Guia, imagens:Map<string, Uint8Array>, avisos:string[]}} guia sem `imagens` */
export function lerPacote(arquivos)
```

### 4.11 `notion-blocos.js` / `notion-cliente.js`

```js
/** @param {Guia} guia @param {{uploadIdDoPasso:(passo:Passo)=>string|null, data?:Date}} opcoes
 *  @returns {{titulo:string, blocos:object[]}} blocos de topo: callout (📘, gray_background, "Manual gerado com StepByStep · Dexterity IT Solutions · n passos · dd/mm/aaaa"),
 *  paragraph (descrição, se houver), depois por passo: secao → heading_2; demais → numbered_list_item com rich_text = richTextComDestaque(titulo) e
 *  children [paragraph(descricao) se houver, image{type:'file_upload', file_upload:{id}, caption:[Passo n]} se uploadId]. Manual sem imagem → item sem children. */
export function guiaParaBlocos(guia, opcoes)
/** Divide respeitando ≤ maxTopo blocos de topo e ≤ maxTotal contando filhos por requisição. @returns {object[][]} */
export function dividirEmLotes(blocos, { maxTopo = 100, maxTotal = 1000 } = {})
/** Fatia em objetos text de ≤ 2000 chars. @returns {object[]} */
export function richText(texto, anotacoes = {})
/** Trechos entre «» com annotations.bold, resto normal. @returns {object[]} */
export function richTextComDestaque(titulo)
export function contarBlocos(bloco) // → 1 + filhos recursivos

export const VERSAO_NOTION = '2022-06-28';
export const ROTAS_PERMITIDAS = /^\/v1\/(users\/me|search|pages|blocks\/[a-f0-9-]+\/children|file_uploads(\/[a-f0-9-]+\/send)?)$/;
export const LIMITE_UPLOAD_PROXY = 4 * 1024 * 1024;     // 4 MB atrás do proxy Vercel
export const LIMITE_UPLOAD_DIRETO = 20 * 1024 * 1024;   // single_part
/** @param {{token:string, base:'https://api.notion.com'|'/api/notion'|string, fetch:typeof fetch, versao?:string, esperar?:(ms:number)=>Promise<void>}} cfg */
export function criarClienteNotion(cfg) // → cliente
/* cliente:
 *   validarToken(): Promise<{nome:string}>                                  GET /v1/users/me
 *   buscarPaginas(texto): Promise<{id, titulo, icone, editadoEm}[]>         POST /v1/search (filter page, sort last_edited_time desc, page_size 20)
 *   criarUpload(nome, tipo): Promise<{id, uploadUrl, expiraEm}>             POST /v1/file_uploads {mode:'single_part', filename, content_type}
 *   enviarUpload(id, blob, nome): Promise<void>                             POST /v1/file_uploads/{id}/send multipart (FormData campo 'file'; sem Content-Type manual)
 *   criarPagina(paiId, titulo, filhos): Promise<{id, url}>                  POST /v1/pages
 *   anexarBlocos(paginaId, blocos): Promise<void>                           PATCH /v1/blocks/{id}/children
 *   publicarGuia(guia, {paiId, obterImagemAssada:(passo)=>Promise<Blob|null>, aoProgredir:(p:{fase:'upload'|'pagina'|'blocos', atual:number, total:number})=>void, publicacaoAnterior?:object, limiteUpload:number})
 *     : Promise<{paginaId, url, publicacao:object}>  — sequencial; uploads em janelas de 30 seguidas de criação/anexo (expiração 1 h);
 *       retoma de publicacaoAnterior (paginaId existente, uploads < 50 min) sem repetir POST /v1/pages;
 *   retentativa: 429 → Retry-After (ou 1s·2ⁿ) até 5×; 5xx/409 → 3×; nunca repete POST /v1/pages sem verificar. */
/** @returns {string} mensagem pt-BR (401 token inválido; 404/object_not_found página não compartilhada; 400 validation_error com detalhe; 413 imagem grande) */
export function traduzirErroNotion(status, corpo)
```

### 4.12 `armazenamento.js` (IndexedDB `stepbystep`, versão 1)

Stores: `guias` (keyPath `id`; índices `atualizadoEm`, `estado`), `imagens` (keyPath `id`; índice `guiaId`; valor `{ id, guiaId, blob:Blob, largura, altura, mime, criadoEm }`), `config` (keyPath `chave`; `{ chave, valor }`). Chaves de config: `notion.token`, `notion.paiId`, `notion.paiTitulo`, `editor.ultimoGuia`.

```js
export async function abrirBanco(nome = 'stepbystep') // → IDBDatabase (singleton por módulo)
export async function salvarGuia(guia)                  // remove `imagens`, marca atualizadoEm
export async function carregarGuia(id)                  // → Guia | null
export async function listarGuias({ estado } = {})      // → resumos [{id,titulo,estado,origem,qtdPassos,atualizadoEm}] por atualizadoEm desc
export async function excluirGuia(id)                   // apaga também as imagens do guia
export async function salvarImagem({ id, guiaId, blob, largura, altura, mime })
export async function carregarImagem(id)                // → registro | null
export async function listarImagensDoGuia(guiaId)       // → ids
export async function excluirImagensOrfas(guia)         // apaga imagens do guia não referenciadas por nenhum passo
export async function obterConfig(chave)                // → valor | undefined
export async function salvarConfig(chave, valor)
```

Só este módulo abre o banco; SW, editor empacotado (mesma origem `chrome-extension://<id>`) e editor hospedado o usam.

### 4.13 `redimensionar.js`

```js
/** @param {Blob} blob @param {{larguraMax:number, tipo?:'image/png'|'image/webp', qualidade?:number}} opcoes @returns {Promise<Blob>} (OffscreenCanvas; só navegador) */
export async function reduzirImagem(blob, opcoes)
```

---

## 5. Extensão MV3 (`packages/extensao`)

### 5.1 `manifest.json` (completo)

```json
{
  "manifest_version": 3,
  "name": "__MSG_nome__",
  "description": "__MSG_descricao__",
  "version": "0.1.0",
  "default_locale": "pt_BR",
  "minimum_chrome_version": "116",
  "icons": { "16": "icones/16.png", "32": "icones/32.png", "48": "icones/48.png", "128": "icones/128.png" },
  "action": { "default_popup": "popup/popup.html", "default_title": "StepByStep", "default_icon": { "16": "icones/16.png", "32": "icones/32.png" } },
  "background": { "service_worker": "sw.js", "type": "module" },
  "permissions": ["storage", "unlimitedStorage", "tabs", "scripting", "webNavigation", "alarms"],
  "host_permissions": ["<all_urls>", "https://api.notion.com/*"],
  "commands": {
    "alternar-gravacao": { "suggested_key": { "default": "Alt+Shift+R" }, "description": "Iniciar ou parar a gravação" }
  },
  "content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }
}
```

Sem `content_scripts` no manifest (registro dinâmico), sem `web_accessible_resources` (nada precisa ser acessível às páginas), sem `options_page` (o editor abre por `chrome.runtime.getURL('editor/index.html#/guia/' + id)`). `<all_urls>` porque `activeTab` expira ao navegar e a gravação atravessa domínios (SSO). `unlimitedStorage` porque um PNG 2x tem 1–3 MB. As fontes do editor são locais (`editor/fontes/`) por escolha de offline/privacidade, não por CSP.

### 5.2 Divisão de responsabilidades

- `conteudo/gravador.js` (script clássico, todos os frames): **sensor**. Não importa nada. Ao carregar lê `chrome.storage.session.get('gravacao')`; fica inerte se não há gravação; escuta `chrome.storage.onChanged` (área `session`) para ligar/desligar/pausar. Descreve o alvo, agrupa digitação, resolve deslocamento de iframes, envia mensagens. Nunca captura imagem, nunca toca IndexedDB, nunca envia valor de campo sensível.
- `conteudo/barra.js` (script clássico, só `window === window.top`): barra flutuante; expõe `window.__sbsBarra = { ocultar(), mostrar(), atualizar(estado) }` para o gravador do mesmo frame.
- `sw.js` (module): **cérebro**. Listeners registrados síncronos no topo (`runtime.onMessage`, `runtime.onStartup`, `runtime.onInstalled`, `webNavigation.onCommitted/onCompleted/onHistoryStateUpdated/onReferenceFragmentUpdated/onCreatedNavigationTarget`, `tabs.onActivated/onRemoved`, `commands.onCommand`, `alarms.onAlarm`). Imports estáticos `./core/*.js` e `./sw/*.js`. Expõe `globalThis.__sbs = { iniciar(abaId), parar(), pausar(), retomar(), estado(), lerGuia(id) }` (só alcançável por DevTools/CDP; usado pelo Playwright).
- `popup/`: controles quando a barra não pode ser injetada (`chrome://`, Web Store, PDF); lista os últimos 10 guias; "Abrir editor".

### 5.3 Estado (`chrome.storage.session`)

```js
// chave 'gravacao' (ausente = não gravando)
{ guiaId, status: 'gravando'|'pausado', abaId, janelaId, abas: [abaId], contador, iniciadoEm,
  ultimaCaptura: { imagemId, em, url, largura, altura } | null,
  redutor: EstadoRedutor }
```

`sw/estado.js`: `lerEstado()`, `gravarEstado(patch)`, `limparEstado()` sobre `globalThis.chrome.storage.session` (injetável em teste via `configurarEstado({ storage })`). No topo de `sw.js`: `chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })` (permite que content scripts leiam a chave). Toda função do SW começa com `const s = await lerEstado()`; nenhuma variável de módulo guarda estado (só caches reconstruíveis). `runtime.onStartup` e `onInstalled`: guias com `estado === 'gravando'` no IndexedDB viram `'interrompido'` (o editor mostra o banner "Gravação interrompida — abrir"). `chrome.alarms` (1 min) só atualiza o badge e detecta aba fechada (`abas` vazio → parar).

### 5.4 Protocolo de mensagens

Todas via `chrome.runtime.sendMessage({ tipo, ...payload })` → resposta assíncrona `{ ok: true, ... }` ou `{ ok: false, erro }`. O SW só aceita mensagens de conteúdo cuja `sender.tab.id ∈ abas`.

```
Descritor = { papel, rotulo, fonteRotulo, campo, tag, tipoInput, seletor, rectCss:{x,y,w,h}|null, marcadoAntes:boolean|null, autocomplete, nome, id }
Comum     = { viewport:{largura,altura}, dpr, url, tituloPagina, scroll:{x,y}, em }   // viewport = innerWidth/innerHeight do frame de topo
```

| direção | tipo | payload | resposta |
|---|---|---|---|
| conteúdo→SW | `PEDIR_ESTADO` | `{}` | `{ ok, gravando, pausado, contador, guiaId }` |
| conteúdo→SW | `PRE_CLIQUE` | `Comum + { alvo:Descritor, pontoCss:{x,y}, botao:'esquerdo'\|'direito'\|'meio', modificadores:[], digitacaoPendente:DigitacaoPayload\|null }` | `{ ok, passoId }` |
| conteúdo→SW | `DIGITACAO` | `Comum + { alvo, valor:string\|null, sensivel, motivo, confirmadoPor }` (= `DigitacaoPayload`) | `{ ok, passoId }` |
| conteúdo→SW | `SELECAO` | `Comum + { alvo, valor, opcao }` | `{ ok, passoId }` |
| conteúdo→SW | `MARCACAO` | `Comum + { alvo, marcado }` | `{ ok, passoId }` |
| conteúdo→SW | `TECLA` | `Comum + { tecla, modificadores, alvo\|null, digitacaoPendente\|null }` | `{ ok, passoId }` |
| conteúdo→SW | `PASSO_MANUAL` | `{ titulo }` | `{ ok, passoId }` |
| conteúdo→SW | `BARRA_PAUSAR` / `BARRA_RETOMAR` / `BARRA_PARAR` | `{}` | `{ ok }` |
| popup→SW | `INICIAR` | `{ abaId }` | `{ ok, guiaId }` ou `{ ok:false, erro:'Esta página não pode ser gravada' }` |
| popup→SW | `PARAR` / `PAUSAR` / `RETOMAR` | `{}` | `{ ok, guiaId }` |
| popup→SW | `ESTADO` | `{}` | `{ ok, gravando, pausado, contador, guiaId, abaId }` |
| popup→SW | `LISTAR_GUIAS` | `{ limite }` | `{ ok, guias:[resumo] }` |
| SW→conteúdo | *(nenhuma)* | o conteúdo reage a `chrome.storage.onChanged` (`gravacao.status`, `gravacao.contador`, remoção da chave) | — |
| frame filho→pai | `window.parent.postMessage({ sbs: 1, tipo: 'DESLOCAMENTO?', nonce }, '*')` | | pai responde `{ sbs:1, tipo:'DESLOCAMENTO', nonce, x, y, viewport:{largura,altura} }` (soma do seu próprio deslocamento até o topo; o topo oculta a barra e espera 2×rAF antes de responder) |

### 5.5 Máquina de estados da gravação

```
[parado] --INICIAR--> [gravando] --PAUSAR/BARRA_PAUSAR--> [pausado] --RETOMAR--> [gravando]
[gravando|pausado] --PARAR/BARRA_PARAR/última aba fechada--> [parado]
navegador reiniciado com guia 'gravando' no IndexedDB --onStartup--> guia.estado = 'interrompido'
```

- **INICIAR**: valida a aba (`url` não começa com `chrome://`, `chrome-extension://`, `https://chromewebstore.google.com`, `file://` sem permissão); cria guia (`criarGuia({ titulo: aba.title, origem: { tipo:'extensao', versao, plataforma } })`), `salvarGuia`; `registerContentScripts([{ id:'sbs', js:['conteudo/barra.js','conteudo/gravador.js'], matches:['<all_urls>'], allFrames:true, matchOriginAsFallback:true, runAt:'document_start', persistAcrossSessions:false }])`; `executeScript({ target:{ tabId, allFrames:true }, files:[...] })` na aba já aberta; grava estado; badge cerceta com contador; passo inicial `navegar` (`transicao:'inicio'`) capturado após 300 ms.
- **PAUSAR**: `status:'pausado'`; o SW ignora eventos; badge âmbar. **RETOMAR** inverte.
- **PARAR**: `unregisterContentScripts({ ids:['sbs'] })`; `limparEstado()` (a chave some → barras se removem); guia `estado:'concluido'`; badge limpo; abre `editor/index.html#/guia/<id>` em nova aba.
- Comando `alternar-gravacao`: INICIAR na aba ativa ou PARAR.
- Abas: `webNavigation.onCreatedNavigationTarget` com `sourceTabId ∈ abas` → adiciona `tabId`; `tabs.onActivated` com `tabId ∈ abas` → `abaId = tabId`; `tabs.onRemoved` remove; eventos de abas não ativas ou fora de `abas` são ignorados (captureVisibleTab só funciona na aba visível).

### 5.6 Ordem de eventos num clique (o ponto crítico)

1. `pointerdown` na fase de captura em `window` do frame clicado (não `click`: o `click` dispara após `mouseup`, quando `<a href>`/submit já navegam). Handler: alvo = `e.composedPath()[0]`; interativo = primeiro item de `composedPath()` (atravessa shadow roots abertos; fechados param no host) que casa `button, a[href], input, select, textarea, summary, label, [contenteditable], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], [role=combobox]`; sem match → o próprio alvo com `papel:'generic'`. Ignora se o caminho inclui o host da barra. `button === 1` → `botao:'meio'`; `2` → `'direito'` (também trata `contextmenu` como já coberto pelo pointerdown).
2. Se há digitação pendente em outro elemento → monta `digitacaoPendente` (flush) para ir na mesma mensagem.
3. `rectCss` = `getBoundingClientRect()` + deslocamentos de iframes (5.7); `pontoCss` = `clientX/Y` + deslocamentos. `viewport` do topo. Não somar `scroll` (o rect já é relativo ao viewport). `visualViewport` é ignorado de propósito (pinch-zoom em desktop fora do escopo).
4. Frame de topo: `__sbsBarra.ocultar()`; espera `requestAnimationFrame` duas vezes (~32 ms, frame pintado sem a barra). Frame filho: o pedido `DESLOCAMENTO?` já faz o topo ocultar e esperar.
5. `sendMessage(PRE_CLIQUE)`. O `pointerup`/`click` seguem normalmente; ao receber a resposta (ou em `pointerup`, o que vier antes) a barra volta.
6. SW: `lerEstado()`; se pausado → `{ok:true, ignorado:true}`. Chama **imediatamente** `capturar(janelaId, url, agora)` (5.8). Depois `reduzir(estado.redutor, { tipo:'PRE_CLIQUE', mensagem, captura, em })` → aplica ações no IndexedDB (`salvarGuia` com o passo anexado; ações executadas na ordem) → `gravarEstado({ redutor, contador, ultimaCaptura })` → badge → responde. Tudo `await` antes de responder; se o conteúdo receber erro (SW morto no meio), reenvia **uma vez** com o mesmo `em` (o redutor descarta duplicata com mesmo `em` e `seletor`).
7. Navegação disparada pelo clique: `webNavigation.onCommitted` (`frameId 0`, `tabId ∈ abas`) → `reduzir({ tipo:'NAVEGACAO', url, transicao: transitionType, em })`. Se virou `capturarNavegacao` → o SW espera `onCompleted` (ou 800 ms após `onDOMContentLoaded`, o que vier antes) + 300 ms, captura (`fonte:'navegacao'`) e chama `reduzir({ tipo:'NAVEGACAO_CAPTURADA', url, captura })`. `onHistoryStateUpdated`/`onReferenceFragmentUpdated` → `SPA`.
8. Novo documento carrega → gravador lê o estado → barra reaparece → gravação continua.

### 5.7 Coordenadas e iframes

```js
// conteúdo (frame clicado)
const r = el.getBoundingClientRect();
const d = await deslocamentoAteTopo();             // {x, y, viewport} — {0,0,innerWidth/innerHeight} no topo
msg.alvo.rectCss = { x: r.left + d.x, y: r.top + d.y, w: r.width, h: r.height };
msg.pontoCss = { x: e.clientX + d.x, y: e.clientY + d.y };
msg.viewport = d.viewport; msg.dpr = devicePixelRatio;   // dpr é informativo
// SW (core/coordenadas.js), após medir o PNG com createImageBitmap:
bbox = cssParaImagem(rectCss, viewport, { largura: bmp.width, altura: bmp.height });   // sx = largura/viewport.largura, sy = altura/viewport.altura
```

`deslocamentoAteTopo()`: se `window === window.top` → `{0,0}`; senão, se `window.frameElement` é acessível (same-origin) → `frameElement.getBoundingClientRect()` + `clientLeft/clientTop` somados recursivamente ao deslocamento do pai (síncrono); senão `postMessage` ao pai com `nonce` e espera `DESLOCAMENTO` (o pai encontra `[...document.querySelectorAll('iframe,frame')].find(f => f.contentWindow === event.source)`, soma `getBoundingClientRect()` + borda e o **seu** deslocamento até o topo, recursivamente). Timeout 150 ms → `rectCss: null` (passo sem marcador; o editor permite posicionar à mão) e `viewport` = o do próprio frame. Elementos parcialmente fora do viewport são limitados; totalmente fora → `bbox.w = h = 0` e sem anotações automáticas.

### 5.8 Captura (`sw/captura.js`)

```js
/** @returns {Promise<{imagemId, largura, altura, fonte:'pointerdown'|'confirmacao'|'navegacao'|'compartilhada', faltante:false} | {imagemId:null, faltante:true, motivo:string}>} */
export async function capturar(janelaId, url, agora, fontePedida, estado)
```
1. Se `estado.ultimaCaptura` existe, `agora − em < 500` e mesma `url` → devolve `{ imagemId: ultimaCaptura.imagemId, fonte:'compartilhada' }` (o estado pré-clique de meio segundo atrás é o que se quer; nunca esperar o slot e arriscar fotografar depois da navegação).
2. Senão `chrome.tabs.captureVisibleTab(janelaId, { format:'png' })`; erro ("Tabs cannot be edited right now", limite `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`, aba carregando) → uma nova tentativa após 120 ms; persistindo → `{ faltante:true, motivo }`.
3. Sucesso: `blob = await (await fetch(dataUrl)).blob()`; `bmp = await createImageBitmap(blob)` → largura/altura reais; `salvarImagem({ id: gerarId('img'), guiaId, blob, largura, altura, mime:'image/png' })`; atualiza `ultimaCaptura`.

Capturas de hover/pré-captura **não existem** (consumiriam a cota das capturas críticas).

### 5.9 Digitação, seleção, marcação, teclas

- `focusin` em `input` de texto (`text,email,search,tel,url,number,password` ou sem type), `textarea`, `[contenteditable]` → `pendente = { el, descritor, valorInicial }`. `input` só marca `alterado`. **Flush** (envia `DIGITACAO` com `valor = el.value` ou `innerText`) em: `focusout`/`change` (`confirmadoPor:'blur'`), `keydown Enter` fora de textarea (`'enter'`, vai dentro de `TECLA`), `pointerdown` em outro elemento (`'clique'`, vai dentro de `PRE_CLIQUE`), `pagehide` (`'navegacao'`; `sendMessage` ainda funciona), parada (`'parar'`), 8 s sem teclas (`'tempo'`). Sem `alterado` → não envia.
- Sensível: `classificarCampo` replicado no gravador (mesmas regras de `mascara.js`) → `valor: null`, `sensivel: true`, `motivo`. O valor real nunca sai do content script.
- `<select>` → `change` → `SELECAO { valor: el.value, opcao: el.selectedOptions[0]?.text }`. Checkbox/radio/switch: tratados no `PRE_CLIQUE` com `alvo.marcadoAntes = el.checked` (o redutor gera `marcar` com `marcado = !marcadoAntes`; radio sempre `true`). `change` em checkbox/radio sem pointerdown recente (teclado) → `MARCACAO`.
- `keydown` (captura): `Enter` fora de textarea → `TECLA` (com `digitacaoPendente` se houver); `Tab` e `Escape` → **ignorados**; combinações com `Ctrl`/`Meta`/`Alt` (exceto `Shift` sozinho) + tecla imprimível ou F1–F12 → `TECLA { tecla:'S', modificadores:['Ctrl'] }` (o SW captura antes, mesma lógica do clique). Teclas imprimíveis nunca viram passo.

### 5.10 Descritor do alvo (`conteudo/gravador.js`)

- `rotulo` (ordem): `aria-label` → `aria-labelledby` (textos concatenados) → `<label for>` / label ancestral → `innerText` aparado (≤ 60) → `value` de `input[type=button|submit]` → `title` → `alt` da `<img>` interna → `placeholder` → `name`. `fonteRotulo` registra a origem.
- `campo` (inputs/select/textarea): `<label for>` → label envolvente → `aria-label(ledby)` → `placeholder` → `name` → texto da célula anterior (`td/th` irmão anterior ou `[role=gridcell]`) — padrão do SAP GUI for HTML e Fiori (`fonteRotulo:'celula'`).
- `seletor`: `#id` se houver id sem espaços; senão caminho `tag:nth-of-type(n)` até 5 níveis (só depuração e detecção de duplo clique).
- `papel`: `role` explícito válido → ele; senão por tag/type (`button`/`input[type=button|submit|reset]`→button, `a[href]`→link, `input[type=checkbox]`→checkbox, `radio`→radio, `select`→combobox, `input`/`textarea`/`[contenteditable]`→textbox, `summary`→button, demais→generic).

### 5.11 Barra flutuante (`conteudo/barra.js`)

Host `<div data-sbs-barra>` em `document.documentElement`, `attachShadow({ mode:'closed' })`, estilos via `new CSSStyleSheet()` + `replaceSync` + `adoptedStyleSheets` (imune a `style-src`), DOM só por `createElement` (imune a Trusted Types). `position: fixed; right: 16px; bottom: 16px; z-index: 2147483647`, 220×40 px, arrastável, fonte do sistema (sem webfont em página alheia), cores Dexterity embutidas (`#1B1B1B` fundo, fio 1 px `rgba(247,243,231,.13)`, ponto cerceta pulsando, âmbar quando pausado). Conteúdo: "Gravando · 7 passos" (número em monospace), botões Pausar/Retomar, Parar, "+ Passo manual" (prompt de título → `PASSO_MANUAL`). Eventos internos param propagação. Reinserção a cada 2 s se a página remover o nó. `ocultar()` = `visibility:hidden`; `mostrar()` inverte. Ao sumir a chave `gravacao` do storage a barra se remove. O badge da action (cerceta gravando / âmbar pausado, com contador) é o indicador que nunca sai na foto.

### 5.12 Armazenamento e editor empacotado

IndexedDB `stepbystep` (`core/armazenamento.js`) na origem `chrome-extension://<id>` — disponível no SW e no editor empacotado, sem cópia de dados. `chrome.storage.local` não guarda imagens (10 MB, base64). Token do Notion em `config['notion.token']` (IndexedDB) nos dois ambientes.

Editor empacotado: `packages/extensao/editor/` é cópia de `packages/editor/` (script de sincronização; `tests/sincronizacao.test.mjs` falha se divergir). `app.js` detecta `naExtensao = typeof chrome !== 'undefined' && !!chrome.runtime?.id` e define `baseNotion = naExtensao ? 'https://api.notion.com' : '/api/notion'`.

### 5.13 Playwright

```js
const ctx = await chromium.launchPersistentContext(dirPerfil, {
  channel: 'chromium', headless: true, deviceScaleFactor: 2, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });   // EXT = packages/extensao (após sincronizar)
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const idExt = new URL(sw.url()).host;
await sw.evaluate(abaId => globalThis.__sbs.iniciar(abaId), abaId);   // abaId via sw.evaluate(() => chrome.tabs.query({active:true}))
const guia = await sw.evaluate(id => globalThis.__sbs.lerGuia(id), guiaId);
```
`channel: 'chromium'` usa o headless novo (build completo em `/opt/pw-browsers`, não o headless-shell), que carrega extensões e responde a `captureVisibleTab`. Fallback no CI: `xvfb-run -a` com `headless:false`.

---

## 6. App Mac (`packages/mac`, Swift/SwiftPM)

Alvo macOS 14+, Swift 5.9, sem Xcode (Command Line Tools trazem o SDK), sem dependências externas. Lógica sem UI num alvo de biblioteca testável com `swift test`.

### 6.1 `Package.swift`

```swift
// swift-tools-version: 5.9
import PackageDescription
let package = Package(
  name: "StepByStep",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "StepByStepNucleo", path: "Sources/StepByStepNucleo"),
    .executableTarget(
      name: "StepByStep", dependencies: ["StepByStepNucleo"], path: "Sources/StepByStep",
      linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("ApplicationServices"), .linkedFramework("CoreGraphics"),
                       .linkedFramework("ScreenCaptureKit"), .linkedFramework("Vision"), .linkedFramework("ImageIO"),
                       .linkedFramework("UniformTypeIdentifiers")]),
    .testTarget(name: "StepByStepNucleoTests", dependencies: ["StepByStepNucleo"], path: "Tests/StepByStepNucleoTests")
  ])
```

### 6.2 Arquivos e APIs

- `Guia.swift`: structs `Codable` (`Guia`, `Passo`, `Contexto`, `Tela`, `Evento`, `Alvo`, `Rect`, `Ponto`, `Captura`, `Anotacao`, `ImagemInfo`) com `CodingKeys` em português idênticos ao JSON; campos opcionais como `Optional`; `Anotacao` codificada por `tipo` (enum com payload). `JSONEncoder` com `.prettyPrinted, .sortedKeys, .withoutEscapingSlashes`, `dateEncodingStrategy = .iso8601` (com frações via `ISO8601DateFormatter` + `.withFractionalSeconds`). `Guia.novo(app:)`, `Passo.novo(tipo:)` sempre com `titulo: ""`, `tituloAuto: true`, `origem.tipo = "mac"`, `origem.plataforma = "macOS <versão>"`.
- `Ids.swift`: `func gerarId(_ prefixo: String) -> String` (mesmo padrão do JS).
- `Coordenadas.swift`: `CGEvent.location` está em coordenadas Quartz globais (origem no canto superior esquerdo do display principal, y para baixo, pontos). **Nunca** misturar com `NSScreen.frame`/`NSEvent.mouseLocation` (Cocoa, y para cima).
  ```swift
  public struct Display { public let id: CGDirectDisplayID; public let limites: CGRect /* Quartz, pontos */ }
  public func displaySobPonto(_ p: CGPoint) -> CGDirectDisplayID      // CGGetDisplaysWithPoint(p, 8, &ids, &n); n == 0 → CGMainDisplayID()
  public func rectParaImagem(_ r: CGRect, display: CGRect, imagem: CGSize) -> Rect  // sx = imagem.width/display.width; sy = imagem.height/display.height; subtrai origin; arredonda; limita
  public func pontoParaImagem(_ p: CGPoint, display: CGRect, imagem: CGSize) -> Ponto
  ```
  `captura.viewport` = tamanho do display em pontos; `alvo.rectCss` = rect AX menos a origem do display (a mesma fórmula do navegador).
- `main.swift`: `let app = NSApplication.shared; app.setActivationPolicy(.accessory); let delegado = AppDelegate(); app.delegate = delegado; app.run()`.
- `MenuBar.swift`: `NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)`; ícone `NSImage(systemSymbolName: "record.circle", accessibilityDescription: "StepByStep")`; durante a gravação o título vira `"● 7"` (fonte do sistema). Menu: "Iniciar gravação ⌥⇧R", "Pausar/Retomar", "Parar e revelar no Finder", "Abrir pasta de gravações", "Recuperar gravação…" (quando há journal sem fim), "Permissões…", "Sair". Atalho global detectado no próprio tap (`flags` ⌥⇧ + keycode 15).
- `Permissoes.swift`: Acessibilidade `AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)`; Gravação de Tela `CGPreflightScreenCaptureAccess()`/`CGRequestScreenCaptureAccess()`; Monitoramento de Entrada `CGPreflightListenEventAccess()`/`CGRequestListenEventAccess()`. `NSPanel` com as três linhas (estado verde/âmbar) e botões `NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)` (`…?Privacy_ScreenCapture`, `…?Privacy_ListenEvent`). **Gravação exige Acessibilidade + Gravação de Tela** (sem Acessibilidade `CGEvent.tapCreate` devolve `nil`; sem Gravação de Tela a captura sai preta/papel de parede). Monitoramento de Entrada é opcional: pedido só se o tap for criado mas não entregar `keyDown` (contador de teclas zero após 10 s de digitação detectada por `flagsChanged`). Não existe chave de Info.plist para esses prompts (`NSAccessibilityUsageDescription`/`NSScreenCaptureUsageDescription` não são reconhecidas).
- `MonitorEventos.swift`:
  ```swift
  let mascara: CGEventMask = (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue)
                           | (1 << CGEventType.otherMouseDown.rawValue) | (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
  guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                    eventsOfInterest: mascara, callback: retornoC, userInfo: Unmanaged.passUnretained(self).toOpaque()) else { throw ErroPermissao.semAcessibilidade }
  let fonte = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetMain(), fonte, .commonModes); CGEvent.tapEnable(tap: tap, enable: true)
  // retornoC: if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { CGEvent.tapEnable(tap: tap, enable: true); return Unmanaged.passUnretained(event) }
  ```
  O callback **nunca bloqueia**: copia `event.location`, `event.flags`, `getIntegerValueField(.mouseEventClickState)` (duplo clique), `.mouseEventButtonNumber`, keycode (`.keyboardEventKeycode`) e caracteres (`keyboardGetUnicodeString`), e despacha `DispatchQueue(label: "br.com.dexterity.stepbystep.gravacao")`. Pausar = `tapEnable(false)`. Cliques cujo pid frontal é o próprio app (`NSRunningApplication.current.processIdentifier`) são ignorados.
- `Captura.swift` (macOS 14, async): `SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)` (cache de 1 s) → `SCDisplay` com `displayID == displaySobPonto(p)` → `SCContentFilter(display:excludingWindows: [])` → `SCStreamConfiguration` (`width/height = Int(limites.size × escala)`, `showsCursor = false`, `captureResolution = .best`, `scalesToFit = false`) → `SCScreenshotManager.captureImage(contentFilter:configuration:)` (~30–60 ms). Captura-se o **display inteiro** (menus, popovers, sheets e listas de combo são janelas de layer ≠ 0 e sumiriam numa captura por janela). Janela clicada: `CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)`, primeira com `kCGWindowLayer == 0` cujo `kCGWindowBounds` contém o ponto → `alvo.janelaBbox` (convertido) → anotação `recorte` auto. Escala real = `CGFloat(img.width) / limites.width` (verdade do bitmap). Corrida mouseDown × efeito do clique (o tap listen-only não segura o evento; o efeito ocorre no mouseUp, ≥ 80 ms depois): aceita na v1; v1.1 prevê `SCStream` a 10 fps mantendo o último frame (latência zero).
- `Acessibilidade.swift`: `AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(p.x), Float(p.y), &el)` (Quartz, pontos — mesmo sistema do evento e de `kAXPositionAttribute`). Atributos: `kAXRoleAttribute`, `kAXSubroleAttribute`, `kAXTitleAttribute`, `kAXDescriptionAttribute`, `kAXValueAttribute`, `kAXPlaceholderValueAttribute`, `kAXHelpAttribute`, `kAXTitleUIElementAttribute` (label vinculado → `campo`), posição/tamanho via `AXValueGetValue(v, .cgPoint/.cgSize, &out)`. Sobe `kAXParentAttribute` até `kAXWindowRole` (título → `contexto.janela`); `AXUIElementGetPid` → `NSRunningApplication(processIdentifier:)` (`localizedName`, `bundleIdentifier`). Menu: se `AXMenuItem`, sobe por `AXMenu`/`AXMenuBarItem` coletando títulos → `alvo.menu = "Arquivo › Salvar como…"`. Campo seguro: `kAXSubroleAttribute == kAXSecureTextFieldSubrole` → sensível. Rótulo: title → description → value (texto estático) → título do pai (para AXImage) → OCR → `nenhum`. Apps Chromium/Electron: ao iniciar a gravação e a cada troca de app frontal, `AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXManualAccessibility" as CFString, kCFBooleanTrue)` e `"AXEnhancedUserInterface"`. `AXUIElementSetMessagingTimeout(el, 0.3)` em cada elemento.
- `OCR.swift`: quando AX não dá rótulo, recorta `240×80` pt ao redor do clique na imagem capturada e roda `VNRecognizeTextRequest` (`recognitionLevel = .fast`, `recognitionLanguages = ["pt-BR","en-US"]`), pega a linha cujo bbox contém o ponto → `rotulo`, `fonteRotulo:"ocr"`. Roda em background; o passo é escrito sem rótulo e atualizado no `guide.json` quando o OCR termina.
- `Teclado.swift`: `keyDown` — Return/Enter → confirma digitação + passo `tecla`; Tab/Escape ignorados; com ⌘/⌃/⌥ → passo `tecla` (`modificadores` `Meta/Ctrl/Alt/Shift`, tecla maiúscula; captura antes, como um clique); imprimíveis acumulam no buffer do elemento focado (`kAXFocusedUIElementAttribute` do app frontal via `AXUIElementCreateApplication(pid)`). Confirmação (Enter, Tab, mudança de foco — polling 300 ms enquanto há buffer —, próximo clique, 1,5 s sem teclas, troca de app): o `valor` é lido de `kAXValueAttribute` (cobre autocorreção e colagem); campo seguro ou foco indeterminável → `valor: nil`, `sensivel: true`. O modo "secure input" do macOS já bloqueia o tap em campos de senha.
- `Gravador.swift`: fila serial; estados `parado/gravando/pausado`; mesma lógica do redutor (digitação pendente antes do clique, duplo clique por `clickState == 2`, troca de app frontal via `NSWorkspace.shared.notificationCenter` `didActivateApplicationNotification` sem clique nos últimos 2 s → passo `navegar` com `evento.app`, captura após 300 ms).
- `Persistencia.swift`: pasta `~/Documents/StepByStep/<AAAA-MM-DD_HHmm>_<slug-do-app>/` criada ao iniciar; `imagens/<imagemId>.png` via `CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)`; `eventos.ndjson` (uma linha JSON por passo, `FileHandle` + `synchronize()`); `guide.json` reescrito após cada passo com `Data.write(to:options:.atomic)` e o mapa `imagens`. Crash perde no máximo o último passo; "Recuperar gravação" reconstrói o `guide.json` do NDJSON. "Parar": `Process` `/usr/bin/ditto -c -k --sequesterRsrc --keepParent <pasta> <pasta>.stepbystep.zip`, `NSWorkspace.shared.activateFileViewerSelecting([zip])` e abre `https://stepbystep-dexterity.vercel.app/editor/#/importar`.

### 6.3 Layout da pasta gravada (contrato com o editor)

```
2026-09-24_1412_sap-gui/
├── guide.json            # formato v1; titulo "" + tituloAuto true; origem.tipo "mac"; contexto {app,bundleId,janela,tela}; alvo.janelaBbox; anotacoes [recorte auto]; imagens {id → imagens/<id>.png}
├── imagens/img_<id>.png  # display inteiro em pixels reais (Retina 2x)
└── eventos.ndjson        # journal (ignorado pelo editor)
```
`<pasta>.stepbystep.zip` contém a pasta como diretório de primeiro nível (`lerPacote` aceita).

### 6.4 Info.plist e empacotamento (TCC)

`Recursos/Info.plist`: `CFBundleIdentifier br.com.dexterity.stepbystep`, `CFBundleName StepByStep`, `CFBundleShortVersionString 0.1.0`, `LSUIElement true`, `NSHighResolutionCapable true`, `LSMinimumSystemVersion 14.0`. `scripts/empacotar.sh`: `swift build -c release` → `build/StepByStep.app/Contents/{MacOS/StepByStep, Info.plist}` → `codesign --force --deep --sign "${IDENTIDADE:-StepByStep Dev}" --identifier br.com.dexterity.stepbystep build/StepByStep.app`. A identidade é um **certificado autoassinado de assinatura de código** criado uma vez no Acesso às Chaves (Assistente de Certificado › Criar certificado › tipo "Assinatura de código", nome `StepByStep Dev`): com assinatura estável o TCC mantém as permissões entre builds (ad-hoc `-` muda o cdhash e re-pede tudo). Executar sempre `open build/StepByStep.app` — rodar o binário no Terminal atribui as permissões ao Terminal.

### 6.5 Build (no Mac do usuário)

```
xcode-select --install            # Command Line Tools (Swift 5.9+)
cd packages/mac
make build                        # swift build -c release
make test                         # swift test (GuiaTests, CoordenadasTests — fixtures via #filePath → ../../../../tests/fixtures/guia-mac)
make app                          # scripts/empacotar.sh
open build/StepByStep.app         # conceder Acessibilidade e Gravação de Tela; reabrir o app
```
Entrega em duas fases: D1 (status item + permissões + Guia/Coordenadas) para validar o toolchain; D2 (tap, captura, AX, OCR, teclado). Primeira compilação: `swift build 2>&1 | tee build.log` e enviar erros. Estilo: APIs estáveis, sem SwiftUI/macros, arquivos curtos, tipos explícitos, `@MainActor` só na UI, `Task` + uma `DispatchQueue`.

---

## 7. Editor web (`packages/editor`)

### 7.1 Páginas (roteamento por hash em `index.html`)

- `#/` **Biblioteca** (`biblioteca.js`): cartões (título, nº de passos, origem, data), Abrir, Excluir, "Novo guia manual", "Importar" (arquivo/zip/pasta e área de arrastar), banner âmbar "Gravação interrompida — abrir" para guias `estado ∈ {gravando, interrompido}` (na extensão).
- `#/importar`: abre a biblioteca com o diálogo de importação (destino do app Mac).
- `#/guia/<id>` **Editor**: cabeçalho Dexterity com título editável; coluna esquerda `lista-passos.js` (miniaturas 160 px, número mono, título); centro `canvas-anotacao.js` com barra de ferramentas; direita `painel-passo.js`; rodapé Desfazer/Refazer/Salvar/Exportar/Notion. A 390 px as colunas viram abas "Passos / Imagem / Detalhes"; canvas rola em `.canvas-wrap`; nenhuma rolagem horizontal da página.

Visual: `dexterity.css` intocado + `app.css` (tokens `--dxt-*`, `--dxt-radius: 0`, fio `--dxt-line`, sem sombra; Barlow Condensed títulos, Figtree texto, IBM Plex Mono números). Cerceta = ação/destaque, âmbar = atenção (passo sem imagem, campo sensível), roxo = nota, vermelho só erro.

### 7.2 Módulos e estado

- `estado.js`: `{ guia, passoAtualId, ferramenta, selecaoAnotacaoId, zoom }`; `on('mudou', fn)`. Toda mutação passa por `historico.aplicar(descricao, fn, { coalescer?: chave })`.
- `historico.js`: pilhas `desfazer[]`/`refazer[]` de `clonarGuia(guia)` (limite 200); `aplicar` guarda snapshot, executa `fn(guia)`, marca `atualizadoEm`, agenda `salvarGuia` (debounce 300 ms; `beforeunload` força), notifica. Coalescência: edições com a mesma `chave` (ex.: `titulo:p_x`) em < 1 s substituem o topo. Atalhos `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`, `Ctrl+Y`. Imagens (Blobs) nunca entram na pilha; órfãs são apagadas por `excluirImagensOrfas` ao fechar o guia.
- `lista-passos.js`: reordenar (Pointer Events + `setPointerCapture`, indicador de 1 px cerceta; Alt+↑/↓) → `renumerarMarcadores`; editar título (`tituloAuto=false`); excluir; inserir passo `manual` antes/depois (imagem por arquivo, `paste` do clipboard ou colada no canvas → `captura.fonte:'manual'`); inserir `secao`; duplicar; **mesclar com o anterior** (passo do tipo do primeiro; título = do primeiro se `tituloAuto=false`, senão `A + " e " + minúsculaInicial(B)`; imagem do primeiro; anotações de B copiadas só se `captura.imagemId` for a mesma; descrições concatenadas; `mescladoDe`); "Regerar título" (`gerarTitulo`).
- `canvas-anotacao.js`: `<canvas>` de visualização com backing store = `areaSaida × zoom` e `<canvas>` de preview sobreposto; chama `desenharPasso(ctx, imagem, passo, { escala: zoom, estilo: guia.estilo, criarCanvas })`; cache `Map<imagemId, ImageBitmap>` (fecha ao trocar de passo). Conversão ponteiro → imagem: `x = area.x + (e.offsetX / zoom)`. Zoom 25–200 % (ajustar à largura por padrão).
- `ferramentas.js`: `selecionar` (hit-test em ordem inversa, alças de 8 px CSS nos cantos de retângulo/desfoque/recorte, arraste das pontas da seta, duplo clique em texto para editar), `recorte` (um só; botões "Focar no alvo" = `recorteFocado(alvo.bbox)`, "Recortar à janela" = `janelaBbox`, "Remover recorte"), `desfoque`, `retangulo`, `seta`, `marcador` (número = próximo), `texto` (`<textarea>` posicionada até confirmar). Atalhos V/C/B/R/A/M/T, Delete, Esc. Cada gesto concluído = uma entrada de histórico (nunca por `pointermove`).
- `painel-passo.js`: título, descrição, tipo, metadados (`url`/`app`/`janela`, data), estilo do guia (cor de destaque, holofote), lista de anotações com Excluir, aviso quando `captura.faltante` com "Anexar imagem".
- `importar.js`: `.json` (só metadados; passos ficam `faltante` até anexar), `.zip`/`.stepbystep.zip` (`lerZip` + `lerPacote`), pasta (`<input webkitdirectory>` e drag&drop com `webkitGetAsEntry` recursivo). Após `lerPacote`: `migrarGuia` → `validarGuia` → mede cada PNG com `createImageBitmap` (garante `captura.largura/altura` e `escala = largura/viewport.largura`) → `salvarImagem` → regenera títulos de passos com `titulo === ''` e `tituloAuto` → conflito de `id` existente: "substituir ou duplicar" (duplicar gera novos ids). `navigator.storage.persist()` na primeira gravação no editor hospedado.
- `exportar.js`: `.stepbystep.zip` (`guiaParaPacote` — intercâmbio/backup, originais sem anotações); **Markdown + imagens.zip** (`README.md` de `guiaParaMarkdown` + `imagens/passo-NN.png` **assadas** por `assarPasso`, opção "reduzir a 1x"); **HTML autocontido** (`guiaParaHtml` com `dexterity.css` + `impressao.css` inline, imagens assadas em `data:image/png;base64`, fontes por fallback de sistema); **Imprimir / salvar PDF** = abrir o HTML numa nova aba (Blob URL) e `window.print()` (`@page { size: A4; margin: 15mm }`, `.passo { break-inside: avoid }`). Downloads via `URL.createObjectURL` + `<a download>`.
- `notion-dialogo.js`: seção 8.

### 7.3 Persistência

`core/armazenamento.js` no banco da origem (na extensão é o mesmo que o SW preencheu). `navigator.storage.estimate()` no rodapé; aviso acima de 500 MB com sugestão de exportar `.stepbystep.zip`.

---

## 8. Exportação e Notion

### 8.1 Fluxo do token e da página-mãe (`notion-dialogo.js`)

1. Campo "Token de integração interna" (`ntn_…`/`secret_…`, tipo password com "mostrar"), link para `notion.so/profile/integrations` e `docs/notion.md` (criar integração com "Ler/Inserir conteúdo" e **conectar** a integração à página-mãe em ··· › Conexões — o erro mais comum). Botão **Testar** → `validarToken()` (`GET /v1/users/me`) mostra o nome da integração. Token salvo em `config['notion.token']`; botão "Esquecer". Nunca em query string, no guia ou no código.
2. Busca da página-mãe: `buscarPaginas(texto)` com debounce 400 ms; lista título (`properties.title.title[].plain_text` ou primeira propriedade `type==='title'`, senão "Sem título"), ícone, última edição. Lista vazia → "Só aparecem páginas conectadas à integração". Última escolha em `config['notion.paiId']`.
3. **Publicar** → `publicarGuia` com barra de progresso ("Enviando imagem 3 de 6", "Criando página", "Anexando blocos 2/3"); ao terminar, link "Abrir no Notion" e registro em `guia.publicacoes`. Falha parcial → "Retomar" (reusa `paginaId` e uploads recentes) ou "Criar nova página".

### 8.2 Requisições (cabeçalhos `Authorization: Bearer <token>`, `Notion-Version: 2022-06-28`, `Content-Type: application/json` exceto no `/send`)

```http
POST /v1/search
{ "query": "<texto>", "filter": { "property": "object", "value": "page" }, "sort": { "direction": "descending", "timestamp": "last_edited_time" }, "page_size": 20 }

POST /v1/file_uploads
{ "mode": "single_part", "filename": "passo-02.png", "content_type": "image/png" }
→ { "id": "<upload_id>", "upload_url": ".../v1/file_uploads/<upload_id>/send", "status": "pending", "expiry_time": "..." }

POST /v1/file_uploads/<upload_id>/send        (multipart/form-data; FormData com campo "file" = Blob e filename; SEM Content-Type manual)
→ { "status": "uploaded" }

POST /v1/pages
{ "parent": { "page_id": "<paiId>" }, "icon": { "type": "emoji", "emoji": "📘" },
  "properties": { "title": { "title": [ { "type": "text", "text": { "content": "Cadastrar fornecedor no SAP Fiori" } } ] } },
  "children": [
    { "object": "block", "type": "callout", "callout": { "icon": { "type": "emoji", "emoji": "📘" }, "color": "gray_background",
      "rich_text": [ { "type": "text", "text": { "content": "Manual gerado com StepByStep · Dexterity IT Solutions · 10 passos · 24/09/2026" } } ] } },
    { "object": "block", "type": "paragraph", "paragraph": { "rich_text": [ { "type": "text", "text": { "content": "Como criar um parceiro…" } } ] } },
    { "object": "block", "type": "numbered_list_item", "numbered_list_item": {
        "rich_text": [ { "type": "text", "text": { "content": "Clique em " } }, { "type": "text", "text": { "content": "«Criar»" }, "annotations": { "bold": true } } ],
        "children": [
          { "object": "block", "type": "image", "image": { "type": "file_upload", "file_upload": { "id": "<upload_id>" }, "caption": [ { "type": "text", "text": { "content": "Passo 2" } } ] } }
        ] } },
    { "object": "block", "type": "heading_2", "heading_2": { "rich_text": [ { "type": "text", "text": { "content": "Conferência no SAP GUI" } } ] } }
  ] }
→ { "id": "<page_id>", "url": "https://www.notion.so/..." }

PATCH /v1/blocks/<page_id>/children
{ "children": [ ...lote seguinte... ] }
```

### 8.3 Limites tratados

- 100 blocos de topo e 1000 blocos totais por requisição; 2 níveis de aninhamento (usamos 1: item → filhos) → `dividirEmLotes`; o primeiro lote vai em `children` do `POST /v1/pages`, os demais em `PATCH` na ordem (cada PATCH anexa ao fim).
- `rich_text[].text.content` ≤ 2000 caracteres (`richText` fatia); ≤ 100 objetos por bloco; nunca `null` em campos opcionais.
- Upload `single_part` ≤ 20 MB; workspaces gratuitos ≤ 5 MB por arquivo; atrás do proxy Vercel o corpo é ≤ 4,5 MB → `limiteUpload` = `LIMITE_UPLOAD_PROXY` (4 MB) quando `base === '/api/notion'`, senão `LIMITE_UPLOAD_DIRETO`. Imagem assada acima do limite → `reduzirImagem` para largura 2000 px, depois WebP q0,9 (`filename` `.webp`, `content_type image/webp`), depois largura 1400.
- Uploads expiram em 1 h → janelas de 30 uploads seguidas de criação/anexo; retomada só reaproveita uploads com < 50 min.
- Rate limit ~3 req/s → envios sequenciais; `429` respeita `Retry-After`.
- Seções (`heading_2`) reiniciam a numeração da lista no Notion; por isso, quando o guia tem seções, os itens recebem prefixo "Passo n — ".

### 8.4 Proxy `api/notion.js` (só para o editor hospedado)

```js
// Assinatura Web (Request → Response): o corpo chega como stream e é repassado byte a byte (multipart intacto).
// Não usar a assinatura (req, res) do Node: os helpers da Vercel consomem o corpo antes do handler.
const ROTAS = /^\/v1\/(users\/me|search|pages|blocks\/[a-f0-9-]+\/children|file_uploads(\/[a-f0-9-]+\/send)?)$/;
const METODOS = new Set(['GET', 'POST', 'PATCH']);
const BASE = process.env.NOTION_BASE ?? 'https://api.notion.com';          // só testes apontam para o Notion falso
const ORIGENS = (process.env.ORIGENS_PERMITIDAS ?? 'https://stepbystep-dexterity.vercel.app,http://localhost:8080,http://127.0.0.1:8080').split(',');
export default async function handler(request) {
  const url = new URL(request.url);
  const rota = url.pathname.replace(/^\/api\/notion/, '');
  const origem = request.headers.get('origin') ?? '';
  const cors = { 'access-control-allow-origin': ORIGENS.includes(origem) || /^https:\/\/stepbystep-[a-z0-9-]+\.vercel\.app$/.test(origem) ? origem : ORIGENS[0],
                 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS', 'access-control-allow-headers': 'authorization, notion-version, content-type',
                 'access-control-max-age': '600', 'vary': 'origin', 'cache-control': 'no-store' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!METODOS.has(request.method) || !ROTAS.test(rota)) return new Response(JSON.stringify({ erro: 'Rota não permitida' }), { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
  const h = new Headers();
  for (const n of ['authorization', 'notion-version', 'content-type']) { const v = request.headers.get(n); if (v) h.set(n, v); }
  const corpo = request.method === 'GET' ? undefined : await request.arrayBuffer();   // ≤ 4,5 MB (limite da plataforma); bytes intactos, boundary preservado
  const r = await fetch(BASE + rota, { method: request.method, headers: h, body: corpo, signal: AbortSignal.timeout(55_000) });
  return new Response(r.body, { status: r.status, headers: { ...cors, 'content-type': r.headers.get('content-type') ?? 'application/json' } });
}
```
Sem segredo no servidor, sem log de cabeçalhos, `no-store`, allow-list de rotas/métodos, CORS restrito às origens do editor (a credencial do usuário trafega). `scripts/dev-server.mjs` monta um `Request` a partir do `http.IncomingMessage` e chama o mesmo handler; com `NOTION_BASE=http://127.0.0.1:8090` aponta para `scripts/notion-falso.mjs`.

`api/hash.js`: igual ao padrão da casa (`GET /api/hash?path=/editor/app.js`), allow-list `^/(editor|core)/[a-z0-9._/-]+$`.

---

## 9. Testes

### 9.1 `npm test` (Node 22, `node --test`, sem navegador, < 5 s)

- `tests/core/modelo.test.mjs`: `criarGuia/criarPasso/criarAnotacao` válidos; `validarGuia` aceita o fixture e rejeita formato/versão desconhecidos, tipo de passo/anotação inválido, dois recortes, ids duplicados, coordenadas negativas, `faltante` com `imagemId`; `migrarGuia` idempotente; `renumerarMarcadores`; `numeroDoPasso` ignora seções.
- `ids.test.mjs`: formato, unicidade em 10 000 chamadas, ordenação temporal.
- `frases.test.mjs`: percorre `tests/fixtures/frases.json` (≥ 60 casos: tabela 3.6 completa, rótulos com quebras/espaços, > 60 chars, URL com query, plataforma mac/outro, botão direito/meio, duplo clique, menu Mac, troca de app, sem rótulo).
- `mascara.test.mjs`: password, `autocomplete=cc-number`, `name=cpf`, label "Senha", `AXSecureTextField`, casos negativos.
- `coordenadas.test.mjs`: escalas 1/1,25/1,5/2 e escala medida ≠ dpr; deslocamento de iframe aninhado 2 níveis com borda; bbox parcialmente e totalmente fora; `posicaoMarcador` perto das bordas; `recorteFocado` (≥ 40 %, 16:10, dentro da imagem); casos Mac (display secundário com origem negativa, escalas mistas).
- `redutor.test.mjs`: sequências com timestamps → ações esperadas: digitação pendente antes do clique (imagem compartilhada), Enter (digitar + tecla), duplo clique < 400 ms mescla, clique + navegação em 1,5 s → `resultado.url`, navegação `typed` → `capturarNavegacao` → `NAVEGACAO_CAPTURADA` cria passo, SPA só atualiza url, reenvio com mesmo `em` descartado, contador/numeração, `marcar` invertendo `marcadoAntes`.
- `anotacoes.test.mjs`: normalização, um só recorte, `areaSaida`, `pontaDaSeta` (ângulo), `hitTest`, `anotacoesAutomaticas` (rect + marcador, desfoque em sensível, recorte com `janelaBbox`, nada para navegar/tecla).
- `render-canvas.test.mjs`: `ctx` falso (Proxy que registra chamadas) — ordem (scale → translate → drawImage → desfoque → holofote evenodd → retângulo → seta → texto → marcador), geometria proporcional à escala, recorte por translate sem alterar coordenadas, cores resolvidas de `CORES`.
- `zip.test.mjs`: `criarZip` → `lerZip` round-trip; `crc32('123456789') === 0xCBF43926` e igual a `zlib.crc32`; leitura de zip deflatado gerado com `zlib.deflateRawSync`; entrada dentro de diretório; `unzip -t` se disponível.
- `pacote.test.mjs`: `guiaParaPacote` → `lerPacote` round-trip; zip com diretório de primeiro nível (estilo `ditto --keepParent`); `__MACOSX/` ignorado; `imagens` removido do guia.
- `exportar-markdown.test.mjs` / `exportar-html.test.mjs`: snapshot em `tests/fixtures/esperado/guia-exemplo.{md,html}` (imagens por placeholder); HTML sem `<script src`/`<link`, N `data:image`, `<h2 class="secao">`.
- `notion-blocos.test.mjs`: 250 passos → lotes ≤ 100 topo/≤ 1000 total; negrito no trecho «»; texto > 2000 fatiado; secao → heading_2; manual sem imagem sem children; prefixo "Passo n — " quando há seções.
- `notion-cliente.test.mjs`: `fetch` injetado registra a sequência (`users/me`, `search`, `file_uploads` → `send` multipart com `filename="passo-` → `pages` → `blocks/children`), `Retry-After` em 429, erro 401/404 traduzido, base `/api/notion` × direto, limite de upload, retomada sem novo `POST /v1/pages`.
- `tests/extensao/estado.test.mjs`: `sw/estado.js` com `chrome.storage.session` falso (get/set/remove, patch, sobrevive a "reinício" do módulo).
- `tests/api/notion-proxy.test.mjs`: handler chamado com `Request` (OPTIONS 204 + CORS; rota fora da lista 403; POST multipart repassado byte a byte ao Notion falso em `NOTION_BASE`; cabeçalhos filtrados; origem não permitida recebe a origem padrão).
- `tests/sincronizacao.test.mjs`: `packages/extensao/core` e `packages/extensao/editor` idênticos byte a byte aos originais (mensagem: "rode `npm run sincronizar`").

### 9.2 `npm run test:e2e` (Playwright 1.56, `node --test`, `--test-concurrency=1`)

Cada arquivo sobe `scripts/dev-server.mjs` em porta livre (`listen(0)`) com `NOTION_BASE` apontando para `scripts/notion-falso.mjs` e derruba no `after`.

- `tests/e2e/extensao.e2e.mjs`: contexto persistente (5.13). Abre `http://127.0.0.1:<porta>/tests/fixtures/paginas/formulario.html` (campos Nome `label for`, E-mail `aria-label`, Senha `type=password`, `<select>` País, checkbox "Aceito os termos", link `target=_blank`, botão "Enviar" que navega para `pagina2.html`, `<iframe src="iframe-filho.html">` com botão, custom element com shadow root aberto e botão, célula de tabela com rótulo à esquerda no padrão SAP). `__sbs.iniciar(abaId)`; espera `page.locator('[data-sbs-barra]')`; `fill('#nome','ACME Ltda')`, `fill('#senha','segredo')`, `selectOption('#pais','BR')`, `check('#aceito')`, clique no botão do shadow (`meu-widget >>> button`), clique no botão do iframe (`frameLocator('iframe').locator('button')`), `press('#email','Enter')`, `click('#enviar')`, `waitForURL(/pagina2/)`; a barra reaparece em `pagina2.html` (CSP `default-src 'self'; style-src 'self'`); `__sbs.parar()`. Asserções sobre `__sbs.lerGuia(id)`: títulos exatos na ordem (`Navegue para 127.0.0.1:<porta>/tests/fixtures/paginas/formulario.html`, `Digite «ACME Ltda» no campo «Nome»`, `Digite sua senha no campo «Senha»`, `Selecione «Brasil» em «País»`, `Marque «Aceito os termos»`, `Clique em «Botão no shadow»`, `Clique em «Botão no iframe»`, `Pressione Enter`, `Clique em «Enviar»`); senha com `evento.valor === null` e um `desfoque` auto; bbox do botão do iframe ≈ (`boundingBox()` do botão no frame + posição do iframe) × escala, tolerância 3 px; passo do clique em "Enviar" com `contexto.url` da página **anterior** e `resultado.url` terminando em `pagina2.html`; `captura.largura / viewport.largura` ≈ `dpr` **ou** 1 (tolerância a ambientes que capturam em 1x); `fonte:'compartilhada'` no `digitar` confirmado por clique; imagem existe no IndexedDB e `createImageBitmap` mede o mesmo tamanho; pixel no centro do marcador é cerceta (±12) após `assarPasso` na página do editor empacotado. Teste de reinício do SW: coberto por `tests/extensao/estado.test.mjs` (um `waitForTimeout(35000)` não prova nada — o SW anexado ao CDP não dorme).
- `tests/e2e/editor.e2e.mjs`: abre `/editor/`; importa `tests/fixtures/guia-mac/` (zip gerado no `before` com `criarZip`) via `setInputFiles`; confere que títulos vazios viraram frases; reordena (Alt+↓) e confere renumeração; edita título (`tituloAuto=false`); mescla dois passos; desenha desfoque/retângulo/seta no canvas (`mouse.down/move/up`), lê `guia.passos[i].anotacoes` do IndexedDB via `page.evaluate`; pixel na região de desfoque uniforme por bloco; `Ctrl+Z` ×3 / `Ctrl+Shift+Z` ×2 comparando JSON; exporta Markdown (`waitForEvent('download')`), extrai com `lerZip` em Node e confere `README.md` + PNG assada com as dimensões do recorte; exporta HTML e abre o Blob numa nova página (`section.passo` count, `data:image`); publica no Notion falso conferindo a sequência e o multipart; viewport 390 px: `document.documentElement.scrollWidth <= 390`.

### 9.3 Mac e CI

`swift test` só no Mac (`GuiaTests`, `CoordenadasTests`). Roteiro manual em `packages/mac/README.md` (12 pontos: permissões, Retina, dois monitores com origem negativa, menu suspenso e popover na foto, campo seguro, ⌘S, app Chromium, SAP GUI/OCR, pausa, crash-safety do JSON, importação no editor, recorte pela janela). CI `testes.yml`: job ubuntu (`npm ci`, `npm test`, `npm run test:e2e` com fallback `xvfb-run`) e job `macos-latest` (`swift build -c release` e `swift test` em `packages/mac`) — o único guarda-corpo real do Swift escrito em Linux. `verificar-publicacao.yml`: após deploy, compara `/api/hash` de `/editor/app.js` e `/core/modelo.js` com `sha256sum` do repositório.

---

## 10. Plano de trabalho (pacotes paralelizáveis, diretórios disjuntos)

Este documento é o P0. Antes de abrir os pacotes, o orquestrador cria `package.json`, `vercel.json`, `.gitignore`, `.vercelignore` (conteúdos fixados aqui) e `docs/especificacao.md`. Ninguém edita arquivo de outro pacote; necessidade cruzada vira alteração deste documento.

| Pacote | Diretórios (exclusivos) | Entrega | Critério de pronto |
|---|---|---|---|
| **P1 Núcleo** | `packages/core/**`, `tests/core/**`, `tests/fixtures/frases.json`, `tests/fixtures/guia-exemplo/**`, `tests/fixtures/guia-mac/**`, `tests/fixtures/esperado/**`, `scripts/gerar-fixtures.mjs` | Todos os módulos da seção 4 com as assinaturas exatas; fixtures (guide.json da seção 3 e a pasta estilo Mac com `titulo ""`); PNGs gerados sem dependências (encoder mínimo: IHDR/IDAT via `zlib.deflateSync`/IEND) | `node --test tests/core/*.test.mjs` verde; `validarGuia` aceita os dois fixtures; nenhum `document`/`window`/`chrome` em `packages/core` |
| **P2 Extensão** | `packages/extensao/**` (exceto `core/` e `editor/` sincronizados), `scripts/sincronizar-extensao.mjs`, `scripts/empacotar-extensao.mjs`, `tests/extensao/**`, `tests/e2e/extensao.e2e.mjs`, `tests/fixtures/paginas/**` | Manifest 5.1, `sw.js` + `sw/*`, `conteudo/*`, `popup/*`, ícones, `_locales`, script de sincronização (`fs.cp` recursivo), páginas de teste, e2e | `tests/extensao/estado.test.mjs` verde; após `npm run sincronizar` com o P1, `tests/e2e/extensao.e2e.mjs` verde; barra invisível nas capturas; nenhum `import()` dinâmico no SW |
| **P3 Editor** | `packages/editor/**`, `tests/e2e/editor.e2e.mjs` | Páginas e módulos da seção 7; `dexterity.css` copiado do app `calculadora-mtm-dexterity` (`assets/dexterity.css`, idêntico); fontes woff2 + `fontes.css`; import/export; diálogo Notion (8.1) | Importa `guia-exemplo` e `guia-mac`, edita, anota, desfaz, exporta zip/Markdown/HTML/impressão, publica no Notion falso; `tests/e2e/editor.e2e.mjs` verde; 390 px sem rolagem horizontal |
| **P4 Mac** | `packages/mac/**` | Seção 6 completa (fases D1 e D2), `Makefile`, scripts, README com roteiro | `swift build` e `swift test` verdes no CI macOS; pasta gravada importável no P3 (validada por `validarGuia`); `GuiaTests` compara com `tests/fixtures/guia-mac/guide.json` campo a campo |
| **P5 Infra, Notion e publicação** | `api/**`, `scripts/dev-server.mjs`, `scripts/notion-falso.mjs`, `tests/api/**`, `tests/sincronizacao.test.mjs`, `.github/workflows/**`, `README.md`, `CLAUDE.md`, `docs/notion.md` | Proxy 8.4 e `hash.js`; dev-server com rewrites da Vercel, `/api/notion` (Web) e `/api/hash` (Node); Notion falso (rotas 8.2, valida payloads, simula 429 e upload expirado, lê multipart com `new Request(...).formData()`); CI; docs | `tests/api/*.test.mjs` e `tests/sincronizacao.test.mjs` verdes; `npm run dev` serve `/editor/` e `/core/`; deploy na Vercel com `/api/hash` batendo |

Dependências em tempo de execução: P2, P3 e P5 (e2e) precisam do P1; P4 só deste documento. Todos podem ser escritos em paralelo contra o contrato; a **integração** (P6, sequencial, ao final) roda `npm test` + `npm run test:e2e`, grava um guia real com a extensão, importa uma pasta real do Mac no editor e publica na Vercel. Divergências encontradas na integração são corrigidas no pacote dono do arquivo.

Interfaces que atravessam pacotes (mudança só via este documento): (1) formato do guia e layout de pasta/zip; (2) assinaturas de `packages/core`; (3) mensagens e estado da extensão + `globalThis.__sbs`; (4) esquema do IndexedDB; (5) rotas do proxy, `Notion-Version`, `ORIGENS_PERMITIDAS`, `NOTION_BASE`; (6) scripts do `package.json` e rewrites de `vercel.json`/dev-server; (7) regra de sincronização `packages/extensao/{core,editor}`.

---

## 11. Riscos e mitigações

**MV3**
1. Captura depois da navegação — `pointerdown` em fase de captura, `keydown` para Enter/atalhos, ocultar barra + 2×rAF antes de pedir, reaproveitamento < 500 ms em vez de fila, retry 120 ms, passo salvo com `faltante` em vez de perdido. Resíduo: sites que navegam no `mousedown` (raros) — o usuário anexa imagem no editor.
2. Cota de 2 capturas/s — reaproveitamento marcado em `captura.fonte`; cliques em rajada compartilham a foto, cada um com seu marcador. Nenhuma captura secundária (hover) disputa a cota.
3. SW descartado — estado só em `storage.session`/IndexedDB, listeners no topo, `await` antes de responder, reenvio único com dedupe por `em`, `onStartup` marca guias interrompidos, content script reconstrói a barra sozinho.
4. Barra na foto — ocultada antes de toda captura; badge como indicador; reinserção se a página remover.
5. DPR/zoom/rolagem — escala medida no bitmap; testes com `deviceScaleFactor: 2`; asserção tolerante.
6. Iframes cross-origin/aninhados e shadow fechado — cadeia de `postMessage` com timeout; degrada para `bbox: null` (posicionar à mão); host do shadow fechado como alvo.
7. CSP/Trusted Types — shadow root + `adoptedStyleSheets` + `createElement`; `pagina2.html` restritiva no e2e.
8. Páginas não capturáveis (`chrome://`, Web Store, PDF) — popup e atalho como controles; aviso ao iniciar; passo `manual`.
9. Armazenamento — IndexedDB + `unlimitedStorage`; `storage.estimate()`; `persist()` no editor hospedado; export `.stepbystep.zip` como backup.
10. Dados sensíveis — classificação por tipo/autocomplete/nome, valor nunca sai do content script, desfoque por pixelização (irreversível), nada sai da máquina sem ação explícita.
11. Cópias `core/`/`editor/` divergindo na extensão — `sincronizacao.test.mjs` + `npm run sincronizar` no `test:e2e` e no CI.
12. Playwright + extensão — `channel: 'chromium'` (headless novo); fallback `xvfb-run`; asserções de imagem tolerantes, títulos nunca.
13. Distribuição — interna (zip + "carregar sem compactação" ou política de empresa) evita revisão de loja; `<all_urls>` justificado no README.

**macOS**
14. TCC volátil — `.app` com `LSUIElement`, certificado autoassinado estável, `open` (nunca o binário no Terminal), painel de permissões com preflight.
15. Tap desabilitado por callback lento — callback não bloqueante, reabilitação em `tapDisabledByTimeout`, captura/AX em fila.
16. Retina/multi-monitor — display sob o ponto, bounds Quartz, escala pelo bitmap; `CoordenadasTests` com origens negativas e escalas mistas.
17. Menus/popovers/sheets ausentes — captura do display inteiro + recorte automático não destrutivo pela janela.
18. AX pobre (Chromium sem `AXManualAccessibility`, Java/SAP GUI, Qt) — `AXManualAccessibility`/`AXEnhancedUserInterface`, OCR via Vision, fallback "Clique aqui" editável.
19. Corrida mouseDown × efeito do clique com tap listen-only — aceita na v1 (≥ 80 ms de folga humana); v1.1 `SCStream` com frame quente.
20. Swift escrito sem compilador — APIs estáveis (macOS 14), lógica pura em alvo testável, job `macos-latest`, entrega D1 mínima primeiro; esperar uma ou duas rodadas de correção com o `build.log` do usuário.
21. Teclado sensível — buffer só durante a gravação e em campo focado, descarte em campo seguro/secure input, valor lido do AX só na confirmação, aviso claro ao iniciar.
22. Frases divergentes JS/Swift — o Mac não gera frases; o editor gera.

**Notion**
23. CORS — direto só na extensão (`host_permissions`); proxy no hospedado.
24. Corpo de 4,5 MB no proxy × 20 MB direto × 5 MB no plano gratuito — `limiteUpload` por base, redução/WebP automática.
25. Expiração 1 h, 100/1000 blocos, 2 níveis, 2000 chars, ~3 req/s — janelas de 30, lotes por contagem, fatiamento, retentativa com `Retry-After`, publicação retomável sem repetir `POST /v1/pages`.
26. Página não conectada à integração (`object_not_found`) — busca só mostra páginas visíveis; mensagem orienta; ID colado aceito como avançado.
27. Token no navegador — IndexedDB local, botão "Esquecer", recomendação de integração com escopo mínimo; proxy sem logs e com CORS restrito.
28. Mudança de versão da API — `Notion-Version` fixa e testada pelo Notion falso; upgrade é decisão explícita.

**Produto/processo**
29. Escopo — contrato congelado (este documento) e pacotes disjuntos; MVP = P1 + P2 + P3 (zip/HTML/PDF); Notion e Mac sobre o mesmo formato.
30. Safari/Firefox — fora da v1; manifest sem APIs exclusivas; conversor da Apple depois.
31. Gravações simultâneas (extensão + Mac) — documentar "uma de cada vez"; futuro: o Mac ignora eventos quando o app frontal é um navegador com a extensão gravando.

---

## Anexo A — Divergências de implementação (registradas na integração)

Decisões tomadas durante a implementação que afastam o código do texto acima. Valem como emenda ao contrato;
o texto das seções originais foi mantido para preservar o histórico das decisões.

| Seção | O que mudou | Por quê |
|---|---|---|
| 5.6 item 5 | A barra flutuante **não** volta no `pointerup` nem ao receber a resposta de um envio isolado: o gravador conta as ocultações pendentes e só reexibe a barra quando a última resposta do SW chega (ou após 2,5 s de segurança). O SW, ao fotografar navegações, oculta e libera pela mesma contagem (`window.__sbsGravador.ocultarBarra/liberarBarra`). | A resposta ao evento A pode chegar depois que o evento B já ocultou a barra e pediu a foto; reexibir nessa hora colocava a barra na captura de B (visto no e2e). |
| 5.4 | O SW usa `chrome.scripting.executeScript` (mesmo isolated world) para ocultar/liberar a barra em volta das capturas de navegação e para pedir o flush da digitação pendente ao parar (`window.__sbsGravador.flush('parar')`). O gravador pergunta `PEDIR_ESTADO` ao carregar e só fica ativo em abas que o SW confirma em `abas`. | Sem mensagens SW→conteúdo pelo `runtime`, mas com um canal previsível. |
| 5.6 / 5.9 | Os passos são inseridos em ordem cronológica de `criadoEm` (= `em` do evento na página), com `renumerarMarcadores`; passo `tecla` sem digitação pendente recebe captura própria (`fonte: 'pointerdown'`); `change` num `<select>` com digitação pendente em outro campo faz o flush (`'blur'`) antes da `SELECAO`; o SW reduz `NAVEGACAO` 150 ms depois do `onCommitted` e ignora navegações anteriores a `iniciadoEm`. | Mensagens de frames filhos chegam depois de eventos posteriores do topo; automação e teclado não passam pelo `pointerdown`. |
| 5.13 | O e2e da extensão usa **janela real**: `viewport: null`, `--window-size=1280,887`, `--force-device-scale-factor=2` (nunca `viewport`/`deviceScaleFactor` emulados). | `captureVisibleTab` fotografa a aba real; com viewport emulado a foto sai recortada e `sy` desloca os bboxes. |
| 8.4 | O proxy exporta **só** `GET`, `POST`, `PATCH` e `OPTIONS` (sem `export default`). O dev-server despacha `modulo[req.method]`. `NOTION_BASE` e `ORIGENS_PERMITIDAS` são lidas a cada requisição; `retry-after` é repassado; falha de rede vira JSON 502/504. | O builder `@vercel/node` troca o módulo pelo `default` quando ele existe e chamaria o handler Web com `(req, res)`. |
| 4.12 | Chave de config opcional `notion.base` (só leitura): se existir, substitui `baseNotion` no editor. | Apontar o editor a um Notion falso sem proxy, em testes manuais. |
| 7.2 (importar) | Ao importar guias com `origem.tipo === 'mac'`, além dos títulos o editor gera as anotações automáticas (retângulo + marcador; desfoque em campo sensível) nos passos sem marcação, preservando o `recorte` gravado pelo Mac. | O Mac grava só o recorte pela janela (6.3); sem isso as imagens importadas não teriam destaque. |
| 4.9 / 9.2 | O HTML exportado usa `<li class="passo">` (como 4.9); a menção a `section.passo` em 9.2 era um conflito interno. | — |
| 4.5 / 4.8 | `recorteFocado` aceita `opcoes.escala`; `medidas(passo).fonteTexto` é uma função `(t) => string`. | A assinatura original não tinha como receber a escala / o placeholder `{t}` não era utilizável. |
| 2 | `playwright` fixado em `1.56.0` exato no `package.json`. | O `^` resolvia 1.63, que procura um Chromium que não existe no ambiente de testes. |
| 5.3 / 5.2 | `ultimaCaptura` ganhou `abaId` e o estado ganhou `navegacaoPendente: { abaId, url, transicao, em, documentId } \| null` (gravado no `onCommitted` quando o redutor pede `capturarNavegacao`; limpo ao persistir a `NAVEGACAO_CAPTURADA`, ao fechar a aba ou quando o documento já foi substituído — `webNavigation.getFrame` compara o `documentId`, ou a URL quando o Chrome não o informa). `chrome.windows.onFocusChanged` entra na lista de listeners (`aoJanelaFocada`: a aba ativa da janela focada, se estiver em `abas`, vira `abaId/janelaId`). O reaproveitamento de foto (`reaproveitarUltima`) exige a mesma aba **e** a mesma URL. | Voltar a uma janela cuja aba da gravação já estava ativa não dispara `tabs.onActivated`; sem isso `abaId/janelaId` apontavam para a outra janela (foto errada, navegações ignoradas). Duas abas na mesma URL (link `target=_blank`, SSO) não podem compartilhar foto. |
| 5.8 / 5.6 | Só a aba **visível** (`sender.tab.active`) é fotografada: evento vindo de aba em segundo plano recebe captura faltante com `motivo: 'aba não visível'` (`MOTIVO_ABA_OCULTA`); a foto é pedida pela janela do remetente (`captureVisibleTab(sender.tab.windowId)`), e o remetente atualiza `abaId/janelaId` quando difere do estado. `DIGITACAO` com `confirmadoPor: 'navegacao'` nunca fotografa: reaproveita a última foto da mesma aba e URL (sem a janela de 500 ms) ou fica faltante com `motivo: 'página descarregada'` (`MOTIVO_DESCARREGADA`). Uma `navegacaoPendente` da aba visível é fotografada antes do evento (`capturarPendente`). | `captureVisibleTab` fotografa a aba ativa da janela, seja ela qual for; no `pagehide` a página já descarregou e a foto sairia da página seguinte. |
| 5.6 / 5.9 | `criadoEm` do passo `navegar` = instante do `onCommitted` (`em` da entrada), mesmo que a foto seja tirada depois (`onCompleted`/DCL + 300 ms). `DIGITACAO` é ordenada pela última tecla (`em = emUltimaTecla`), e a foto de confirmação é a do momento do flush. No `keydown` do gravador não viram passo: teclas repetidas (`e.repeat`), teclas dentro da barra (`data-sbs-barra` no `composedPath`), AltGr/Option+letra (`AltGraph`, `Ctrl+Alt` no Windows, `Alt` sem `Ctrl/Meta` no macOS — `produzCaractere`) e tecla imprimível com modificador num campo sensível (`campoSensivel`). | Cliques feitos antes do `load` chegavam antes do `navegar`; tecla segurada gerava um passo e uma foto por repetição; AltGr+Q é o «/» digitado, não um atalho; um atalho em campo de senha levaria o caractere para o guia. |
| 4.6 regra 4 | `NAVEGACAO`: além da janela de 2 s, `transicao ∈ {link, form_submit}` só atribui a navegação ao gatilho se `em − ultimoGatilho.em < 30000` (`JANELA_GATILHO_TRANSICAO`); em ambos os casos o gatilho é **consumido** (`ultimoGatilho = null`), e a navegação seguinte, mesmo por link, ganha passo `navegar` próprio. | O Chrome também marca `location.href` por script como `link`; sem limite nem consumo, todo `navegar` posterior ao primeiro clique virava `resultado.url` dele. |
| 4.6 (`EstadoRedutor`, regra 7) | `EstadoRedutor` ganhou `sensiveis: RegiaoSensivel[]` (`{url, frameId, seletor, rectCss, scroll}` do campo de cada passo `digitar` sensível, substituído quando é o mesmo campo) e `ultimasEntradas` (últimas 8 entradas, para descartar o reenvio do content script). Regra 7: `anotacoes = anotacoesAutomaticas(passo)` + um `desfoque` `auto` por região sensível da mesma `url` (convertido para px da captura com o deslocamento de scroll do mesmo frame; inseridos antes do retângulo/marcador; a própria região do passo sensível não é repetida; região fora da foto é ignorada). O estado gravado por versão anterior sem esses campos é normalizado no `reduzir`. | O valor continua visível no campo depois da digitação: a pixelização precisa acompanhar todas as fotos seguintes da mesma página, inclusive a compartilhada com o clique. |
| 4.11 | `notion-cliente.js` exporta também `idNotionValido(id)` (UUID do Notion, com ou sem hifens), `urlNotionValida(url)` (prefixo `https://www.notion.so/`) e `publicacaoRetomavel(publicacao)` → cópia saneada `{destino:'notion', paginaId, url, em, concluida:false, uploads, lotesEnviados, …}` ou `null` (só retoma `destino === 'notion'`, não concluída e com `paginaId` válido; `url` fora do Notion vira o link canônico da página). O diálogo usa `publicacaoRetomavel` sobre `guia.publicacoes` antes de oferecer «Retomar». | `guia.publicacoes` vem de um `guide.json` importado (de terceiros): sem saneamento o editor retomaria numa página arbitrária ou abriria uma URL qualquer. |
| 2 | `test:e2e` = `npm run sincronizar && node --test --test-concurrency=1 tests/e2e/*.e2e.mjs`, **sem** `PLAYWRIGHT_BROWSERS_PATH` (o ambiente de testes e o CI já resolvem o Chromium). `vercel.json`: `/editor` (sem barra) é **redirect** 307 para `/editor/` (o rewrite `/editor` → `index.html` foi removido); `scripts/dev-server.mjs` faz o mesmo em `resolverRedirect` (`/` e `/editor` → `/editor/`). | `index.html` referencia `app.js`/`app.css`/`fontes.css` por caminho relativo: servido em `/editor` o navegador pediria `/app.js`, que não existe. |
| 5.13 / 9.3 / 11.12 | Sem fallback `xvfb-run` no CI (`testes.yml`): os e2e fixam `headless: true` (headless novo, que carrega a extensão) e não leem variável alguma, então repetir a suíte sob X virtual só dobrava o tempo de uma falha real. `verificar-publicacao.yml` só confere **deployments de produção** (`deployment.environment` igual a `Production` ou `Production – stepbystep-dexterity`; previews são ignorados) ou execução manual. | Previews têm URL própria e conferi-los contra o host de produção só produzia DIFF. |
| 7.2 (`historico.js`) | Antes de gravar, `historico.js` relê o guia do banco e compara `atualizadoEm` com a versão que este editor leu/gravou por último (`versaoGravada`); se diferirem, entra em `conflito` (evento `salvamento` com `estado: 'conflito'`, `emConflito()`), avisa e **nunca mais grava** aquele guia. Estados do evento `salvamento`: `pendente`, `salvando`, `salvo`, `erro`, `conflito`. | Duas abas do editor (ou o SW da extensão) no mesmo guia sobrescreviam uma à outra em silêncio. |
| 7.1 / 7.2 (editor) | Guia com `estado === 'gravando'` não abre no editor (aviso «Este guia está sendo gravado…» e volta a `#/`). Trocar o tipo para `secao` zera `captura`, `anotacoes`, `alvo`, `evento` e `resultado` (com confirmação quando havia algo) e `tituloAuto = false` (idem `manual`). Até 900 px as três colunas viram abas com `role="tablist"`/`tab`/`tabpanel` (`aria-selected`, `aria-controls`, setas entre abas). Diálogos se empilham (`componentes/dialogo.js`: `pilha`); só o do topo trata Esc e o foco preso. | O SW ainda insere passos num guia `gravando` e o autosave gravaria por cima; uma seção com imagem órfã confundia exportação e Notion; Importar → «Guia já existe» abre um diálogo sobre outro. |
| 8.1 / 7.2 (`notion-dialogo.js`) | O `fetch` injetado no cliente recebe `signal` de um `AbortController` criado a cada publicação: fechar o diálogo (Esc, ×, clique fora, «Fechar») no meio da publicação pede confirmação e aborta as requisições. `registrarPublicacao` (no guia aberto, procurado pelo id, ou direto no banco se o usuário já saiu) substitui o registro de mesmo `paginaId` e, ao registrar uma **página nova**, remove as publicações Notion não concluídas anteriores (`mesclarPublicacao`). | Sem cancelamento os uploads continuavam após fechar; pendências de páginas antigas ofereciam «Retomar» para uma página que o usuário já abandonou. |
| 6.2 (`Persistencia`/`PastaGravacao`) | Colisão de nome no mesmo minuto e app: a pasta e o zip recebem sufixo `_2`, `_3`… (`PastaGravacao.nomeLivre`, que consulta pasta **e** `<nome>.stepbystep.zip` já existentes). | A segunda gravação reutilizava a pasta e `ditto` apagava o zip da primeira. |
| 6.2 (`Gravador`, captura) | O Mac **não reaproveita** foto por tempo: cada clique tem a própria captura (estado pré-clique dele); `fonte: 'compartilhada'` só por decisão do fluxo (digitação pendente confirmada pelo clique/tecla usa a foto desse clique/tecla). A PNG é codificada e gravada fora do fluxo (`Task.detached(priority: .utility)`; o passo espera as escritas ao parar). Ao iniciar, uma captura de teste é feita **antes** de criar a pasta; falha → erro «Conceda Gravação de Tela… e reabra o app» e a gravação não começa. | O item de menu precisa da foto com o menu aberto (dois cliques em elementos distintos a poucos ms não podem compartilhar imagem); o disco não deve atrasar o evento seguinte; `CGPreflightScreenCaptureAccess` fica verdadeiro antes de o ScreenCaptureKit funcionar e a gravação inteira sairia faltante em silêncio. |
| 6.2 (`Teclado`/`Teclas`) | Nome da tecla pelo caractere **sem** ⌃/⌥ (`caractereDaTecla`: tecla sem modificadores do AppKit com ⇧ preservado → letra do caractere de controle U+0001…U+001A → layout ANSI por keycode → `Tecla<keycode>`). Atalho (`ehAtalho`) só com ⌘ ou ⌃; ⌥ sozinho é digitação, exceto ⌥+F1–F12/Enter. Campo seguro (sem `keyDown` no tap): a digitação é detectada pela variação de `kAXNumberOfCharactersAttribute` e só vira passo `digitar` quando o número de caracteres mudou desde o clique. A digitação só inicia quando o elemento focado é `textbox`/`combobox` (foco indeterminável segue como passo sensível). | ⌃C entrega U+0003 e ⌥S entrega «ß»; ⌥C é o «ç» digitado; um clique num campo de senha sem digitar gerava «Digite sua senha»; teclas em lista/tabela/botão (type-ahead do Finder) não são digitação. |
| 6.2 (`MenuBar`) / 6.5 | «Recuperar gravação…» fica oculto durante a gravação (só aparece parado e com journal sem fim). `scripts/build.sh`, `scripts/empacotar.sh` e o `Makefile` rodam com `bash` + `set -o pipefail`. `make test` exige o **Xcode** (o XCTest não vem no Command Line Tools); só com o CLT valem `make build`/`make app`. Testes Swift: `GuiaTests`, `CoordenadasTests`, `TeclasTests`, `PastaGravacaoTests`. | Recuperar no meio da gravação misturaria duas pastas; sem `pipefail` o status de `swift … \| tee` era o do `tee` e um build quebrado passava com exit 0. |
| 3.5 / 4.11 | `publicacoes[].impressao` (SHA-256 de título/descrição do guia + `[id, tipo, título, descrição, imagemId]` por passo, via `impressaoDoGuia(guia)`); ao retomar, se a impressão mudou, `publicarGuia` descarta a página e os lotes anteriores, cria página nova (reaproveitando uploads com < 50 min) e devolve `aviso` + `paginaAnterior {paginaId, url}` — o editor exibe o aviso. | Retomar por contagem de lotes depois de editar o guia duplicava ou omitia passos. |
| 4.9 | `escaparMarkdown(texto)` exportado e aplicado a título do guia, descrições, títulos de passo/seção e `alt`; caminho da imagem com espaço/parênteses codificado. | Colchete desbalanceado quebrava a imagem e HTML cru passava para o README. |
| 4.6 | `EstadoRedutor.ultimasEntradas` (8 últimas: tipo+em+seletor) para o descarte de reenvio; o ramo de duplo clique exige `em > ultimoClique.em`. | Reenvio depois de uma entrada intermediária virava duplo clique. |
| 4.10 | `criarZip` lança erro em pt-BR acima de 65 535 entradas ou 4 GB (sem zip64); `lerZip` rejeita zip64, confere tamanho e CRC-32 de cada entrada e normaliza `\` → `/` e `./` inicial nos nomes. | Limites truncados em silêncio; zips recompactados no Windows não eram reconhecidos. |
| 3.6 | `rotulo()` só remove `«»` que envolvem o rótulo inteiro e troca `«»` internos por `‹›`; `richTextComDestaque` casa o par mais externo. | Rótulos com aspas internas geravam «» desbalanceados e negrito errado no Notion. |
| 4.3 | `abreviarUrl` remove `usuario:senha@` da URL. | Credenciais entravam no título do passo. |
| 4.11 | Falha de rede no `fetch` → uma retentativa (exceto `POST /v1/pages`) e `ErroNotion(0)` em pt-BR; `AbortError` sobe intacto; resposta 2xx sem `id` vira `ErroNotion` em vez de `TypeError`. | Mensagem em inglês («Failed to fetch») e exceções cruas no diálogo. |
| 5.3 | Estado da gravação ganhou `plataforma` (`'mac'` \| `'outro'`, derivada do userAgent ao iniciar) usada nas opções do redutor. | `plataforma: 'outro'` fixa fazia ⌘S virar «Win+S» na gravação. |
| 2 / 8.4 | O proxy é `api/notion.js` (não `api/notion/[...rota].js`) e o `vercel.json` reescreve `/api/notion/:caminho*` → `/api/notion?rota=/:caminho*`; o handler aceita o caminho original ou o parâmetro `rota`, sempre pela allow-list. | Catch-all `[...x].js` é recurso do Next.js: em funções soltas a Vercel não cria a rota e o primeiro deploy respondeu 404 em `/api/notion/*`. |
