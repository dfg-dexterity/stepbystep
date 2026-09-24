# CLAUDE.md — StepByStep

Ferramenta da Dexterity IT Solutions para construir manuais passo a passo: captura automática no navegador
(extensão Chrome MV3) e no Mac (app de menu bar em Swift), anotações polidas em pt-BR, editor web sem build e
exportação para Markdown/HTML/PDF e Notion (só salvar o manual como página nova).

**`docs/especificacao.md` é o contrato.** Formato do guia, assinaturas de `packages/core`, mensagens da extensão,
layout da pasta gravada pelo Mac, esquema do IndexedDB e rotas de `api/` estão fechados lá. Mudança em qualquer
interface que atravessa pacotes começa alterando a especificação.

## Regras do projeto

- **Lógica só em `packages/core`** (ES modules puros: sem `document`, `window`, `chrome`; canvas e `fetch` sempre
  injetados). Extensão, editor e app Mac não reimplementam regras: o Mac grava `titulo: ""` + `tituloAuto: true` e
  o editor gera as frases. Toda mudança de regra precisa de teste em `tests/core/` (`npm test`).
- **Sem build**: HTML + ES modules. `packages/extensao/{core,editor}` são cópias geradas por `npm run sincronizar`
  (gitignored) — nunca editar as cópias; `tests/sincronizacao.test.mjs` cobra a igualdade.
- **Sinal e coordenadas**: todas as coordenadas do guia são em pixels da imagem original; a escala é medida no
  bitmap (`largura / viewport.largura`), nunca no `devicePixelRatio`. Anotações são não destrutivas.
- **Privacidade**: valor de campo sensível nunca sai do content script; desfoque é pixelização irreversível;
  nada sai da máquina sem ação explícita. Token do Notion fica no IndexedDB do usuário — **nunca no código,
  nunca no servidor** (o proxy `api/notion` só repassa e não registra cabeçalhos).
- **Visual**: `packages/editor/dexterity.css` é cópia idêntica do arquivo dos apps `taxas-indices`, `bndes-um`,
  `curvas`, `tesourodireto`, `cotacao-derivativos-b3` e `calculadora-mtm-dexterity` — não editar aqui sem
  replicar nos demais. Estilos próprios em `app.css`. Paleta: base `#1B1B1B`, off-white `#F7F3E7`, cerceta
  `#009994` (destaque `#00B3AC`), âmbar `#FFA436`, roxo `#98569A`. Cerceta = ação/destaque, âmbar = atenção,
  roxo = nota, vermelho só para erro. Cantos retos, sem sombra, grades com fio de 1px. Barlow Condensed
  (títulos), Figtree (texto), IBM Plex Mono (números).
- **Responsivo**: editor testado a 390px (nenhuma rolagem horizontal da página).
- Textos, código, comentários e commits em português do Brasil.

## Comandos

```bash
npm test            # node --test: núcleo, estado da extensão, proxy, sincronização (< 5 s, sem navegador)
npm run test:e2e    # Playwright (Chromium em /opt/pw-browsers): extensão e editor
npm run dev         # servidor local :8080 com os rewrites da Vercel e /api
npm run sincronizar # copia packages/core e packages/editor para dentro da extensão
npm run empacotar   # zip da extensão em dist/
cd packages/mac && make build && make app   # só no Mac (Swift 5.9+, Command Line Tools)
```

## Publicação

Vercel, time `dexterityit`, projeto `stepbystep-dexterity` (push na branch padrão = produção em
https://stepbystep-dexterity.vercel.app). A extensão é distribuída como zip ("carregar sem compactação").
O app Mac é compilado no Mac do usuário (`packages/mac/README.md`).
