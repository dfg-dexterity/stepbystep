// E2E do editor (seção 9.2): importa o fixture do Mac, edita, anota, desfaz, exporta e publica no Notion falso.
// Sobe o dev-server (porta livre) com NOTION_BASE apontando para scripts/notion-falso.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { iniciarServidor } from '../../scripts/dev-server.mjs';
import { iniciarNotionFalso } from '../../scripts/notion-falso.mjs';
import { criarZip, lerZip } from '../../packages/core/zip.js';
import { lerPacote } from '../../packages/core/pacote.js';
import { numeroDoPasso } from '../../packages/core/modelo.js';
import { recorteFocado } from '../../packages/core/coordenadas.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = join(RAIZ, 'tests', 'fixtures');
const ID_MAC = 'g_m1x7q2mac0aa';
const ID_EXEMPLO = 'g_m1x4k9zq7a2b';
const PAI_NOTION = '11111111-1111-4111-8111-111111111111';
const TITULOS_MAC = [
  'Abra o app «SAP GUI»',
  'Escolha o menu «Arquivo › Novo»',
  'Clique em «Executar»',
  'Digite «4500001234» no campo «Pedido»',
  'Pressione Enter',
  'Pressione ⌘S',
  'Digite sua senha no campo «Senha»',
];

let notion, servidor, navegador, contexto, page;
const errosDePagina = [];
const snapshots = {};
const url = (caminho) => `http://127.0.0.1:${servidor.porta}${caminho}`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const semData = (guia) => { const { atualizadoEm, ...resto } = guia; return JSON.stringify(resto); };
const tamanhoPng = (bytes) => ({ largura: new DataView(bytes.buffer, bytes.byteOffset).getUint32(16), altura: new DataView(bytes.buffer, bytes.byteOffset).getUint32(20) });

/** Zip da pasta do fixture com um diretório de primeiro nível (como `ditto --keepParent`). */
async function zipDaPasta(nome) {
  const pasta = join(FIXTURES, nome);
  const entradas = [{ nome: `${nome}/guide.json`, dados: new Uint8Array(await readFile(join(pasta, 'guide.json'))) }];
  for (const f of readdirSync(join(pasta, 'imagens'))) entradas.push({ nome: `${nome}/imagens/${f}`, dados: new Uint8Array(await readFile(join(pasta, 'imagens', f))) });
  return Buffer.from(await criarZip(entradas));
}

/** Chromium do canal 'chromium'; se a versão instalada do Playwright não tiver o build, usa o que houver em PLAYWRIGHT_BROWSERS_PATH. */
async function lancarChromium() {
  try {
    return await chromium.launch({ channel: 'chromium', headless: true });
  } catch (erroCanal) {
    const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const candidatos = [];
    if (existsSync(raiz)) {
      for (const d of readdirSync(raiz)) {
        if (!/^chromium-\d+$/.test(d)) continue;
        for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = join(raiz, d, sub); if (existsSync(p)) candidatos.push(p); }
      }
    }
    if (!candidatos.length) throw erroCanal;
    return chromium.launch({ executablePath: candidatos.sort().at(-1), headless: true });
  }
}

const lerGuia = (id) => page.evaluate(async (id) => {
  const { carregarGuia } = await import('/core/armazenamento.js');
  return carregarGuia(id);
}, id);

/** Espera o guia gravado no IndexedDB (salvamento com debounce) satisfazer a condição. */
async function esperarGuia(id, condicao, descricao, tempo = 8000) {
  const inicio = Date.now();
  let ultimo = null;
  while (Date.now() - inicio < tempo) {
    ultimo = await lerGuia(id);
    if (ultimo && condicao(ultimo)) return ultimo;
    await page.waitForTimeout(100);
  }
  throw new Error(`Tempo esgotado esperando: ${descricao}\n${JSON.stringify(ultimo?.passos?.map((p) => [p.id, p.titulo, p.anotacoes.length]))}`);
}

/** Espera uma requisição específica chegar ao Notion falso. */
async function esperarRegistro(condicao, descricao, tempo = 5000) {
  const inicio = Date.now();
  while (Date.now() - inicio < tempo) {
    if (notion.registros.some(condicao)) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Tempo esgotado esperando: ${descricao}`);
}

/** Fecha diálogos que um teste anterior possa ter deixado abertos (falha não contamina o seguinte). */
async function fecharDialogos() {
  for (let i = 0; i < 3 && (await page.$('.dialogo')); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }
}

async function importarZip(nome, buffer, idEsperado) {
  await fecharDialogos();
  await page.goto(url('/editor/#/'));
  await page.waitForSelector('#btn-importar');
  await page.click('#btn-importar');
  await page.setInputFiles('#importar-arquivo', { name: nome, mimeType: 'application/zip', buffer });
  await page.waitForURL(new RegExp(`#/guia/${idEsperado}$`), { timeout: 20000 });
  await page.waitForSelector('.passo-cartao');
}

/** Geometria do canvas para converter px da imagem em coordenadas de tela. */
async function geometriaDoCanvas() {
  await page.evaluate(() => { document.querySelector('.canvas-wrap').scrollTo(0, 0); });
  return page.evaluate(() => {
    const palco = document.querySelector('.canvas-palco');
    const r = document.getElementById('canvas-preview').getBoundingClientRect();
    const [x, y, w, h] = palco.dataset.area.split(',').map(Number);
    return { zoom: Number(palco.dataset.zoom), area: { x, y, w, h }, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
}
async function arrastarNaImagem(de, para) {
  const g = await geometriaDoCanvas();
  const tela = (p) => ({ x: g.rect.x + (p.x - g.area.x) * g.zoom, y: g.rect.y + (p.y - g.area.y) * g.zoom });
  const a = tela(de), b = tela(para);
  for (const p of [a, b]) {
    assert.ok(p.x >= g.rect.x && p.x <= g.rect.x + g.rect.w && p.y >= g.rect.y && p.y <= g.rect.y + g.rect.h, `ponto fora do canvas: ${JSON.stringify(p)} em ${JSON.stringify(g)}`);
  }
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  return g;
}

before(async () => {
  if (!existsSync(join(FIXTURES, 'guia-mac', 'imagens', 'img_m1x7q2mac01a.png'))) {
    const { gerarFixtures } = await import('../../scripts/gerar-fixtures.mjs');
    gerarFixtures();
  }
  notion = await iniciarNotionFalso();
  process.env.NOTION_BASE = notion.base;
  servidor = await iniciarServidor({ porta: 0 });
  navegador = await lancarChromium();
  contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true, locale: 'pt-BR' });
  page = await contexto.newPage();
  page.on('pageerror', (e) => errosDePagina.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errosDePagina.push(`console.error: ${m.text()}`); });
  // instrumentação: conta os drawImage no canvas de visualização e simula falha de cota ao gravar imagens no IndexedDB
  await page.addInitScript(() => {
    window.__sbsTeste = { drawImageVis: 0, falharImagem: null };
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas?.id === 'canvas-vis') window.__sbsTeste.drawImageVis++;
      return drawImage.apply(this, args);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (valor, ...resto) {
      const alvo = window.__sbsTeste.falharImagem;
      if (alvo && this.name === 'imagens' && (alvo === '*' || valor?.id === alvo)) throw new DOMException('cota simulada pelo teste', 'QuotaExceededError');
      return put.call(this, valor, ...resto);
    };
  });
});

/** Escreve no IndexedDB como se fosse outra aba (ou o gravador): `mudar(guia)` altera e grava. */
const gravarComoOutraAba = (id, mudar) => page.evaluate(async ({ id, codigo }) => {
  const { carregarGuia, salvarGuia } = await import('/core/armazenamento.js');
  const g = await carregarGuia(id);
  (new Function('g', codigo))(g);
  await salvarGuia(g);
}, { id, codigo: `(${mudar.toString()})(g)` });

const imagensDoGuia = (id) => page.evaluate(async (id) => (await import('/core/armazenamento.js')).listarImagensDoGuia(id), id);

after(async () => {
  await navegador?.close();
  await servidor?.fechar();
  await notion?.fechar();
  delete process.env.NOTION_BASE;
});

test('importa a pasta do Mac (zip) e gera as frases dos títulos vazios', async () => {
  await importarZip('guia-mac.stepbystep.zip', await zipDaPasta('guia-mac'), ID_MAC);
  const titulos = await page.$$eval('.passo-cartao .titulo', (els) => els.map((e) => e.textContent));
  assert.deepEqual(titulos, TITULOS_MAC);

  const guia = await esperarGuia(ID_MAC, (g) => g.passos.every((p) => p.titulo !== ''), 'títulos gravados');
  assert.equal(guia.estado, 'concluido');
  assert.ok(guia.passos.every((p) => p.tituloAuto === true), 'títulos gerados continuam automáticos');
  assert.deepEqual(guia.passos.map((p) => p.titulo), TITULOS_MAC);
  // capturas medidas no bitmap
  for (const p of guia.passos) {
    assert.equal(p.captura.largura, 3456);
    assert.equal(p.captura.altura, 2234);
    assert.equal(p.captura.escala, 2);
  }
  // o clique no botão ganhou retângulo + marcador automáticos, mantendo o único recorte gravado pelo Mac
  const executar = guia.passos.find((p) => p.id === 'p_m1x7q2mac03c');
  assert.equal(executar.anotacoes.filter((a) => a.tipo === 'recorte').length, 1);
  assert.deepEqual(executar.anotacoes.find((a) => a.tipo === 'recorte'), { id: 'a_m1x7q2mac03a1', tipo: 'recorte', auto: true, x: 160, y: 90, w: 3000, h: 1900 });
  assert.ok(executar.anotacoes.some((a) => a.tipo === 'retangulo' && a.auto));
  assert.equal(executar.anotacoes.find((a) => a.tipo === 'marcador' && a.auto)?.numero, 3);
  // campo sensível: desfoque automático
  const senha = guia.passos.find((p) => p.id === 'p_m1x7q2mac07g');
  assert.ok(senha.anotacoes.some((a) => a.tipo === 'desfoque' && a.auto && a.bloco === 16));
  // a imagem existe no IndexedDB com o tamanho medido
  const medida = await page.evaluate(async () => {
    const { carregarImagem } = await import('/core/armazenamento.js');
    const r = await carregarImagem('img_m1x7q2mac03c');
    const b = await createImageBitmap(r.blob);
    return { largura: b.width, altura: b.height, guiaId: r.guiaId };
  });
  assert.deepEqual(medida, { largura: 3456, altura: 2234, guiaId: ID_MAC });
});

test('reordena com Alt+↓ / Alt+↑ e renumera os marcadores automáticos', async () => {
  const cartao = page.locator('.passo-cartao[data-id="p_m1x7q2mac02b"]');
  await cartao.focus();
  await page.keyboard.press('Alt+ArrowDown');
  let guia = await esperarGuia(ID_MAC, (g) => g.passos[2].id === 'p_m1x7q2mac02b', 'passo movido para baixo');
  assert.equal(guia.passos[1].id, 'p_m1x7q2mac03c');
  guia.passos.forEach((p, i) => {
    for (const a of p.anotacoes) if (a.tipo === 'marcador' && a.auto) assert.equal(a.numero, numeroDoPasso(guia, i), `marcador do passo ${i}`);
  });
  assert.equal(guia.passos[1].anotacoes.find((a) => a.tipo === 'marcador').numero, 2);
  assert.equal(guia.passos[2].anotacoes.find((a) => a.tipo === 'marcador').numero, 3);
  const titulos = await page.$$eval('.passo-cartao .titulo', (els) => els.map((e) => e.textContent));
  assert.equal(titulos[1], 'Clique em «Executar»');
  assert.equal(titulos[2], 'Escolha o menu «Arquivo › Novo»');

  // o cartão movido continua com foco: volta ao lugar
  await page.keyboard.press('Alt+ArrowUp');
  guia = await esperarGuia(ID_MAC, (g) => g.passos[1].id === 'p_m1x7q2mac02b', 'passo movido de volta');
  assert.equal(guia.passos[1].anotacoes.find((a) => a.tipo === 'marcador').numero, 2);
  assert.equal(guia.passos[2].anotacoes.find((a) => a.tipo === 'marcador').numero, 3);
});

test('edita o título no painel e desliga tituloAuto', async () => {
  await page.click('.passo-cartao[data-id="p_m1x7q2mac03c"]');
  await page.waitForFunction(() => document.querySelector('#passo-titulo')?.value === 'Clique em «Executar»');
  await page.fill('#passo-titulo', 'Clique em «Executar» para abrir a transação');
  const guia = await esperarGuia(ID_MAC, (g) => g.passos[2].titulo === 'Clique em «Executar» para abrir a transação', 'título editado');
  assert.equal(guia.passos[2].tituloAuto, false);
  assert.equal(await page.locator('.passo-cartao[data-id="p_m1x7q2mac03c"] .titulo').textContent(), 'Clique em «Executar» para abrir a transação');
  // os outros continuam automáticos
  assert.equal(guia.passos[3].tituloAuto, true);
});

test('mescla «Pressione Enter» com o passo anterior', async () => {
  await page.click('.passo-cartao[data-id="p_m1x7q2mac05e"] .menu-btn');
  await page.click('.menu-item:has-text("Mesclar com o anterior")');
  const guia = await esperarGuia(ID_MAC, (g) => g.passos.length === 6, 'passos mesclados');
  const mesclado = guia.passos[3];
  assert.equal(mesclado.id, 'p_m1x7q2mac04d');
  assert.equal(mesclado.titulo, 'Digite «4500001234» no campo «Pedido» e pressione Enter');
  assert.equal(mesclado.tituloAuto, false);
  assert.deepEqual(mesclado.mescladoDe, ['p_m1x7q2mac04d', 'p_m1x7q2mac05e']);
  assert.equal(mesclado.captura.imagemId, 'img_m1x7q2mac04d');
  assert.ok(!guia.passos.some((p) => p.id === 'p_m1x7q2mac05e'));
  assert.equal(guia.passos[4].anotacoes.length, 0, 'o ⌘S continua sem anotações');
  assert.equal((await page.$$('.passo-cartao')).length, 6);
});

test('desenha desfoque, retângulo e seta no canvas e grava as anotações', async () => {
  await page.click('.passo-cartao[data-id="p_m1x7q2mac03c"]');
  await page.waitForFunction(() => document.querySelector('.canvas-palco')?.dataset.area === '160,90,3000,1900');
  snapshots.antes = semData(await esperarGuia(ID_MAC, (g) => g.passos[2].id === 'p_m1x7q2mac03c', 'passo atual'));
  const totalAntes = (await lerGuia(ID_MAC)).passos[2].anotacoes.length;

  // desfoque atravessando a borda do alvo branco (480..660 × 280..332), dentro do retângulo automático
  await page.keyboard.press('b');
  await page.waitForSelector('.ferramenta-btn[data-ferramenta="desfoque"].is-ativa');
  let g = await arrastarNaImagem({ x: 472, y: 300 }, { x: 640, y: 340 });
  const tol = 2 / g.zoom + 1;
  let guia = await esperarGuia(ID_MAC, (x) => x.passos[2].anotacoes.length === totalAntes + 1, 'desfoque gravado');
  const desfoque = guia.passos[2].anotacoes.at(-1);
  assert.equal(desfoque.tipo, 'desfoque');
  assert.equal(desfoque.auto, false);
  assert.equal(desfoque.bloco, 16);
  assert.ok(Math.abs(desfoque.x - 472) <= tol && Math.abs(desfoque.y - 300) <= tol, `posição do desfoque ${JSON.stringify(desfoque)}`);
  assert.ok(Math.abs(desfoque.w - 168) <= tol && Math.abs(desfoque.h - 40) <= tol, `tamanho do desfoque ${JSON.stringify(desfoque)}`);
  snapshots.desfoque = semData(guia);

  // retângulo
  await page.keyboard.press('r');
  await page.waitForSelector('.ferramenta-btn[data-ferramenta="retangulo"].is-ativa');
  await arrastarNaImagem({ x: 900, y: 500 }, { x: 1300, y: 700 });
  guia = await esperarGuia(ID_MAC, (x) => x.passos[2].anotacoes.length === totalAntes + 2, 'retângulo gravado');
  const retangulo = guia.passos[2].anotacoes.at(-1);
  assert.equal(retangulo.tipo, 'retangulo');
  assert.equal(retangulo.cor, 'cerceta');
  assert.ok(Math.abs(retangulo.x - 900) <= tol && Math.abs(retangulo.y - 500) <= tol && Math.abs(retangulo.w - 400) <= tol && Math.abs(retangulo.h - 200) <= tol, JSON.stringify(retangulo));
  snapshots.retangulo = semData(guia);

  // seta
  await page.keyboard.press('a');
  await page.waitForSelector('.ferramenta-btn[data-ferramenta="seta"].is-ativa');
  await arrastarNaImagem({ x: 1500, y: 900 }, { x: 1100, y: 700 });
  guia = await esperarGuia(ID_MAC, (x) => x.passos[2].anotacoes.length === totalAntes + 3, 'seta gravada');
  const seta = guia.passos[2].anotacoes.at(-1);
  assert.equal(seta.tipo, 'seta');
  assert.ok(Math.abs(seta.de.x - 1500) <= tol && Math.abs(seta.de.y - 900) <= tol && Math.abs(seta.para.x - 1100) <= tol && Math.abs(seta.para.y - 700) <= tol, JSON.stringify(seta));
  snapshots.seta = semData(guia);

  // a anotação recém-criada fica selecionada e aparece no painel
  assert.equal((await page.$$('#passo-anotacoes .anotacao-item')).length, totalAntes + 3);
  assert.equal(await page.$eval('#passo-anotacoes .anotacao-item.is-selecionada .anotacao-nome', (e) => e.textContent), 'Seta');

  // pixelização: cada bloco da imagem assada é uniforme e só tem as duas cores originais (sem mistura)
  const pix = await page.evaluate(async ({ id, passoId }) => {
    const arm = await import('/core/armazenamento.js');
    const rc = await import('/core/render-canvas.js');
    const an = await import('/core/anotacoes.js');
    const guia = await arm.carregarGuia(id);
    const passo = guia.passos.find((p) => p.id === passoId);
    const reg = await arm.carregarImagem(passo.captura.imagemId);
    const bmp = await createImageBitmap(reg.blob);
    const { blob, largura, altura } = await rc.assarPasso(bmp, passo, { estilo: guia.estilo });
    const assada = await createImageBitmap(blob);
    const c = new OffscreenCanvas(assada.width, assada.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(assada, 0, 0);
    const { recorte } = an.separarRecorte(passo.anotacoes);
    const area = an.areaSaida({ largura: bmp.width, altura: bmp.height }, recorte);
    const d = passo.anotacoes.find((a) => a.tipo === 'desfoque');
    const dados = ctx.getImageData(d.x - area.x, d.y - area.y, d.w, d.h).data;
    const cor = (x, y) => { const i = (y * d.w + x) * 4; return [dados[i], dados[i + 1], dados[i + 2]]; };
    const cores = new Set();
    let blocos = 0, uniformes = 0;
    for (let by = d.bloco / 2; by < d.h; by += d.bloco) {
      for (let bx = d.bloco / 2; bx < d.w; bx += d.bloco) {
        blocos++;
        const ref = cor(bx, by);
        let uniforme = true;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const c2 = cor(bx + dx, by + dy);
          if (Math.abs(c2[0] - ref[0]) > 2 || Math.abs(c2[1] - ref[1]) > 2 || Math.abs(c2[2] - ref[2]) > 2) uniforme = false;
        }
        if (uniforme) uniformes++;
        cores.add(ref.join(','));
      }
    }
    return { largura, altura, blocos, uniformes, cores: [...cores] };
  }, { id: ID_MAC, passoId: 'p_m1x7q2mac03c' });
  assert.deepEqual({ largura: pix.largura, altura: pix.altura }, { largura: 3000, altura: 1900 }, 'imagem assada com o tamanho do recorte');
  assert.equal(pix.uniformes, pix.blocos, `blocos uniformes ${pix.uniformes}/${pix.blocos}`);
  assert.ok(pix.cores.length >= 2 && pix.cores.length <= 3, `cores dos blocos: ${pix.cores.join(' | ')}`);
  for (const c of pix.cores) assert.ok(c === '247,243,231' || c === '46,46,46', `cor de bloco sem mistura: ${c}`);
});

test('Ctrl+Z ×3 e Ctrl+Shift+Z ×2 restauram os snapshots', async () => {
  await page.locator('#canvas-preview').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  let guia = await esperarGuia(ID_MAC, (g) => semData(g) === snapshots.antes, 'três desfazer');
  assert.equal(semData(guia), snapshots.antes);
  for (let i = 0; i < 2; i++) await page.keyboard.press('Control+Shift+z');
  guia = await esperarGuia(ID_MAC, (g) => semData(g) === snapshots.retangulo, 'dois refazer');
  assert.equal(semData(guia), snapshots.retangulo);
  assert.equal(guia.passos[2].anotacoes.at(-1).tipo, 'retangulo');
  assert.equal(await page.$eval('#btn-refazer', (b) => b.disabled), false);
  assert.equal(await page.$eval('#btn-desfazer', (b) => b.disabled), false);
});

test('exporta Markdown + imagens e confere README e PNG assada', async () => {
  await page.click('#btn-exportar');
  await page.click('.menu-item:has-text("Markdown + imagens")');
  const download = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#exportar-markdown-confirmar');
  const arquivo = await download;
  assert.match(arquivo.suggestedFilename(), /^gravacao-sap-gui-markdown\.zip$/);
  const zip = await lerZip(new Uint8Array(await readFile(await arquivo.path())));
  const readme = new TextDecoder().decode(zip.get('README.md'));
  assert.ok(readme.startsWith('# Gravação — SAP GUI\n'), readme.slice(0, 80));
  assert.ok(readme.includes('## 1. Abra o app «SAP GUI»'));
  assert.ok(readme.includes('## 3. Clique em «Executar» para abrir a transação'));
  assert.ok(readme.includes('## 4. Digite «4500001234» no campo «Pedido» e pressione Enter'));
  assert.ok(readme.includes('![Passo 3 — Clique em «Executar» para abrir a transação](imagens/passo-03.png)'));
  assert.ok(/---\n_Gerado com StepByStep · Dexterity IT Solutions · \d{2}\/\d{2}\/\d{4}_\n$/.test(readme), readme.slice(-80));
  const pngs = [...zip.keys()].filter((n) => n.startsWith('imagens/')).sort();
  assert.deepEqual(pngs, ['imagens/passo-01.png', 'imagens/passo-02.png', 'imagens/passo-03.png', 'imagens/passo-04.png', 'imagens/passo-05.png', 'imagens/passo-06.png']);
  const passo3 = zip.get('imagens/passo-03.png');
  assert.deepEqual(tamanhoPng(passo3), { largura: 3000, altura: 1900 }, 'PNG assada com as dimensões do recorte');
  assert.deepEqual(tamanhoPng(zip.get('imagens/passo-01.png')), { largura: 3456, altura: 2234 }, 'passo sem recorte sai inteiro');
  snapshots.passo3Sha = sha256(passo3);
});

test('exporta HTML autocontido e abre numa nova página', async () => {
  await page.click('#btn-exportar');
  const download = page.waitForEvent('download', { timeout: 60000 });
  await page.click('.menu-item:has-text("HTML autocontido")');
  const arquivo = await download;
  assert.equal(arquivo.suggestedFilename(), 'gravacao-sap-gui.html');
  const html = await readFile(await arquivo.path(), 'utf8');
  assert.ok(!/<script\s+src/i.test(html) && !/<link\b/i.test(html), 'sem script externo nem link');
  assert.ok(html.includes('@page') && html.includes('--dxt-cerceta'), 'dexterity.css + impressao.css inline');
  const pagina = await contexto.newPage();
  await pagina.setContent(html);
  assert.equal((await pagina.$$('.passo')).length, 6);
  assert.equal((await pagina.$$('img[src^="data:image/png;base64,"]')).length, 6);
  assert.equal(await pagina.$eval('h1', (e) => e.textContent), 'Gravação — SAP GUI');
  assert.equal(await pagina.$eval('.passo:nth-of-type(3) h2', (e) => e.textContent.trim()), '3 Clique em «Executar» para abrir a transação');
  const img = await pagina.$eval('.passo:nth-of-type(3) img', (e) => ({ w: e.naturalWidth, h: e.naturalHeight }));
  assert.deepEqual(img, { w: 3000, h: 1900 });
  await pagina.close();
});

test('Imprimir / salvar PDF abre o HTML numa nova aba', async () => {
  await page.click('#btn-exportar');
  const novaAba = contexto.waitForEvent('page', { timeout: 60000 });
  await page.click('.menu-item:has-text("Imprimir / salvar PDF")');
  const aba = await novaAba;
  await aba.waitForFunction(() => location.protocol === 'blob:' && document.querySelectorAll('.passo').length > 0, null, { timeout: 60000 });
  assert.equal((await aba.$$('.passo')).length, 6);
  assert.ok(await aba.$('button.no-print'), 'botão Imprimir / salvar PDF presente');
  assert.equal(await aba.$eval('h1', (e) => e.textContent), 'Gravação — SAP GUI');
  await aba.close();
});

test('publica no Notion falso: token, busca, uploads multipart, página e registro', async () => {
  await page.click('#btn-notion');
  await page.waitForSelector('#notion-token');
  await page.fill('#notion-token', 'ntn_teste_e2e');
  await page.click('#notion-testar');
  await page.waitForFunction(() => /StepByStep \(falso\)/.test(document.querySelector('#notion-token-estado')?.textContent ?? ''));
  await page.fill('#notion-busca', 'Manuais');
  // a busca tem debounce de 400 ms: espera ela chegar ao Notion falso e a resposta ser renderizada
  await esperarRegistro((r) => r.rota === '/v1/search' && r.corpo?.query === 'Manuais', 'busca da página-mãe');
  await page.waitForSelector(`.notion-pagina[data-id="${PAI_NOTION}"]`, { timeout: 5000 });
  assert.deepEqual(await page.$$eval('.notion-pagina', (els) => els.map((e) => e.dataset.id)), [PAI_NOTION]);
  await page.click(`.notion-pagina[data-id="${PAI_NOTION}"]`);
  await page.waitForFunction(() => /Página-mãe: Manuais/.test(document.querySelector('#notion-pai')?.textContent ?? ''));
  const antes = notion.registros.length;
  await page.click('#notion-publicar');
  await page.waitForSelector('#notion-link', { timeout: 60000 });
  const href = await page.$eval('#notion-link', (a) => a.href);
  assert.ok(href.startsWith('https://www.notion.so/'), href);

  const registros = notion.registros.slice(antes);
  const rotas = registros.map((r) => `${r.metodo} ${r.rota.replace(/[0-9a-f-]{36}/g, '<id>')}`);
  const esperadas = [];
  for (let i = 0; i < 6; i++) esperadas.push('POST /v1/file_uploads', 'POST /v1/file_uploads/<id>/send');
  esperadas.push('POST /v1/pages');
  assert.deepEqual(rotas, esperadas);
  for (const r of registros) {
    assert.equal(r.cabecalhos.authorization, 'Bearer ntn_teste_e2e');
    assert.equal(r.cabecalhos['notion-version'], '2022-06-28');
    assert.equal(r.status, 200, `${r.metodo} ${r.rota}`);
  }
  const envios = registros.filter((r) => r.rota.endsWith('/send'));
  assert.deepEqual(envios.map((r) => r.arquivo.nome), ['passo-01.png', 'passo-02.png', 'passo-03.png', 'passo-04.png', 'passo-05.png', 'passo-06.png']);
  for (const r of envios) {
    assert.match(r.cabecalhos['content-type'], /^multipart\/form-data; boundary=/);
    assert.equal(r.arquivo.tipo, 'image/png');
    assert.ok(r.arquivo.tamanho > 0 && r.tamanhoMultipart > r.arquivo.tamanho);
  }
  assert.equal(envios[2].arquivo.sha256, snapshots.passo3Sha, 'a imagem enviada é a mesma assada na exportação (bytes intactos pelo proxy)');

  const pagina = registros.find((r) => r.rota === '/v1/pages');
  assert.equal(pagina.corpo.parent.page_id, PAI_NOTION);
  assert.equal(pagina.corpo.properties.title.title[0].text.content, 'Gravação — SAP GUI');
  const filhos = pagina.corpo.children;
  assert.equal(filhos[0].type, 'callout');
  assert.match(filhos[0].callout.rich_text[0].text.content, /^Manual gerado com StepByStep · Dexterity IT Solutions · 6 passos · \d{2}\/\d{2}\/\d{4}$/);
  const itens = filhos.filter((b) => b.type === 'numbered_list_item');
  assert.equal(itens.length, 6);
  const idsUpload = new Set(envios.map((r) => r.rota.match(/file_uploads\/([0-9a-f-]+)\/send/)[1]));
  for (const item of itens) {
    const imagem = item.numbered_list_item.children.find((c) => c.type === 'image');
    assert.equal(imagem.image.type, 'file_upload');
    assert.ok(idsUpload.has(imagem.image.file_upload.id), 'imagem aponta para um upload enviado');
  }
  assert.deepEqual(itens[2].numbered_list_item.rich_text.map((t) => [t.text.content, !!t.annotations?.bold]), [['Clique em ', false], ['«Executar»', true], [' para abrir a transação', false]]);

  const guia = await esperarGuia(ID_MAC, (g) => g.publicacoes.some((p) => p.concluida), 'publicação registrada');
  const pub = guia.publicacoes[0];
  assert.equal(pub.destino, 'notion');
  assert.equal(pub.url, href);
  assert.ok(notion.paginas.has(pub.paginaId));
  assert.equal(Object.keys(pub.uploads).length, 6);
  assert.equal(pub.lotesEnviados, 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#notion-token', { state: 'detached' });
});

test('«Criar nova página» encerra a publicação pendente antiga: ela não reaparece ao reabrir o diálogo', async () => {
  const PENDENTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  // publicação incompleta gravada no guia (ex.: falha numa sessão anterior); o editor recarrega para lê-la do banco
  await gravarComoOutraAba(ID_MAC, (g) => {
    g.publicacoes.unshift({ destino: 'notion', paginaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', url: 'https://www.notion.so/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', em: new Date().toISOString(), concluida: false, uploads: {}, lotesEnviados: 1 });
  });
  await page.reload();
  await page.waitForSelector('.passo-cartao');
  await page.click('#btn-notion');
  await page.waitForSelector('#notion-retomar:visible');
  assert.equal(await page.$eval('#notion-publicar', (b) => b.hidden), true, 'com pendência, só Retomar / Criar nova página');
  const antes = notion.registros.length;
  await page.click('#notion-nova');
  await page.waitForSelector('#notion-link', { timeout: 60000 });
  assert.equal(notion.registros.slice(antes).filter((r) => r.rota === '/v1/pages').length, 1, 'uma página nova foi criada');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#notion-token', { state: 'detached' });
  const guia = await esperarGuia(ID_MAC, (g) => g.publicacoes.length === 2 && g.publicacoes.every((p) => p.concluida), 'pendência antiga encerrada');
  assert.ok(!guia.publicacoes.some((p) => p.paginaId === PENDENTE), 'a pendência antiga saiu do registro');
  // ao reabrir: Publicar visível, sem Retomar nem aviso de publicação incompleta
  await page.click('#btn-notion');
  await page.waitForSelector('#notion-publicar:visible');
  assert.equal(await page.$eval('#notion-retomar', (b) => b.hidden), true);
  assert.doesNotMatch(await page.$eval('#notion-resultado', (e) => e.textContent), /Publicação anterior incompleta/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#notion-token', { state: 'detached' });
});

test('publicação em andamento: fechar pede confirmação, cancelar aborta e sair do editor ainda registra a página', async () => {
  const n0 = (await lerGuia(ID_MAC)).publicacoes.length;
  const progredindo = () => page.waitForFunction(() => /Enviando imagem/.test(document.querySelector('.notion-progresso-texto')?.textContent ?? ''));
  // cada requisição ao Notion falso demora 250 ms: dá tempo de interagir no meio da publicação
  await page.route('**/api/notion/**', async (rota) => {
    await new Promise((r) => setTimeout(r, 250));
    try { await rota.continue(); } catch { /* requisição abortada pelo cancelamento */ }
  });
  try {
    // (a) Esc no meio → confirmação; «Continuar publicando» mantém o diálogo e a publicação
    await page.click('#btn-notion');
    await page.waitForSelector('#notion-publicar:visible');
    await page.click('#notion-publicar');
    await progredindo();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.dialogo:has-text("Publicação em andamento")');
    await page.click('.dialogo .dxt-btn:has-text("Continuar publicando")');
    assert.ok(await page.$('#notion-token'), 'o diálogo do Notion continua aberto');
    await page.waitForSelector('#notion-link', { timeout: 60000 });
    await esperarGuia(ID_MAC, (g) => g.publicacoes.length === n0 + 1, 'publicação (a) registrada');

    // (b) publicar de novo e cancelar de verdade: o diálogo fecha, os fetch param e nenhuma página é criada
    await page.click('#notion-publicar');
    await progredindo();
    const antesCancelar = notion.registros.length;
    await page.keyboard.press('Escape');
    await page.click('.dialogo .dxt-btn:has-text("Cancelar publicação")');
    await page.waitForSelector('#notion-token', { state: 'detached' });
    await page.waitForSelector('.aviso:has-text("cancelada")');
    await page.waitForTimeout(1500);
    assert.ok(!notion.registros.slice(antesCancelar).some((r) => r.rota === '/v1/pages'), 'nenhuma página criada depois do cancelamento');
    assert.equal((await lerGuia(ID_MAC)).publicacoes.length, n0 + 1, 'nada a retomar: sem registro novo');

    // (c) publicar e sair do editor no meio: a página é criada e registrada direto no banco
    await page.click('#btn-notion');
    await page.waitForSelector('#notion-publicar:visible');
    const antesSair = notion.registros.length;
    await page.click('#notion-publicar');
    await progredindo();
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('.guia-cartao');
    await page.waitForSelector('#notion-link', { timeout: 60000 });
    assert.ok(notion.registros.slice(antesSair).some((r) => r.rota === '/v1/pages'), 'a página foi criada mesmo com o editor fechado');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#notion-token', { state: 'detached' });
    const guia = await esperarGuia(ID_MAC, (g) => g.publicacoes.length === n0 + 2, 'publicação (c) registrada no banco');
    const ultima = guia.publicacoes.at(-1);
    assert.equal(ultima.concluida, true);
    assert.ok(notion.paginas.has(ultima.paginaId), 'o paginaId gravado é o da página criada');
  } finally {
    await page.unroute('**/api/notion/**');
  }
  await page.goto(url(`/editor/#/guia/${ID_MAC}`));
  await page.waitForSelector('.passo-cartao');
});

test('a 390 px o editor vira abas e nada rola na horizontal', async () => {
  await fecharDialogos();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  assert.ok(await page.$eval('.editor-abas', (e) => getComputedStyle(e).display !== 'none'), 'abas visíveis');
  for (const aba of ['passos', 'imagem', 'detalhes']) {
    await page.click(`.editor-abas button[data-aba="${aba}"]`);
    await page.waitForTimeout(250);
    const largura = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(largura <= 390, `aba ${aba}: scrollWidth ${largura}`);
    assert.ok(await page.$eval(`.editor-col[data-col="${aba}"]`, (e) => getComputedStyle(e).display !== 'none'));
  }
  // o canvas cabe no seu contêiner com rolagem própria, e o rodapé continua na tela
  const rodape = await page.$eval('.editor-rodape', (e) => e.getBoundingClientRect().bottom);
  assert.ok(rodape <= 800, `rodapé em ${rodape}`);
  // título longo: reticências (e o valor inteiro na dica), em vez de corte seco
  await page.fill('#guia-titulo', 'Guia sintético com um título comprido demais para caber em 390 px de largura');
  await page.evaluate(() => document.activeElement?.blur());
  const titulo = await page.$eval('#guia-titulo', (e) => ({ overflow: getComputedStyle(e).textOverflow, dica: e.title, cabe: e.scrollWidth > e.clientWidth }));
  assert.equal(titulo.overflow, 'ellipsis');
  assert.equal(titulo.dica, 'Guia sintético com um título comprido demais para caber em 390 px de largura');
  assert.ok(titulo.cabe, 'o título realmente transborda a 390 px');
  await page.fill('#guia-titulo', 'Gravação — SAP GUI');
  await esperarGuia(ID_MAC, (g) => g.titulo === 'Gravação — SAP GUI', 'título restaurado');
  // as abas são um tablist de verdade (tab + aria-selected + tabpanel) e as setas trocam de aba
  assert.deepEqual(await page.$$eval('.editor-abas [role="tab"]', (els) => els.map((e) => [e.getAttribute('aria-selected'), e.tabIndex, document.getElementById(e.getAttribute('aria-controls'))?.getAttribute('role')])), [['false', -1, 'tabpanel'], ['false', -1, 'tabpanel'], ['true', 0, 'tabpanel']]);
  await page.focus('.editor-abas [role="tab"][aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('.editor-abas [role="tab"][aria-selected="true"]', (e) => e.dataset.aba), 'passos');
  await page.goto(url('/editor/#/'));
  await page.waitForSelector('.guia-cartao');
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'biblioteca sem rolagem horizontal');
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('guia em gravação não abre no editor (o gravador ainda insere passos nele)', async () => {
  await gravarComoOutraAba(ID_MAC, (g) => { g.estado = 'gravando'; });
  await page.goto(url(`/editor/#/guia/${ID_MAC}`));
  await page.waitForFunction(() => location.hash === '#/');
  await page.waitForSelector('.aviso:has-text("sendo gravado")');
  await page.waitForFunction(() => /Gravação em andamento/.test(document.querySelector('#biblioteca-banner')?.textContent ?? ''));
  assert.equal(await page.$('#editor'), null, 'o editor não montou');
  assert.equal(await page.$eval('#biblioteca-banner', (e) => e.querySelectorAll('button').length), 0, 'o banner não oferece «Abrir»');
  assert.equal(await page.$eval(`.guia-cartao[data-id="${ID_MAC}"] button:has-text("Abrir")`, (b) => b.disabled), true, 'o cartão não abre');
  await gravarComoOutraAba(ID_MAC, (g) => { g.estado = 'concluido'; });
  await page.reload();
  await page.waitForSelector('.guia-cartao');
  assert.equal(await page.$eval(`.guia-cartao[data-id="${ID_MAC}"] button:has-text("Abrir")`, (b) => b.disabled), false);
  assert.equal(await page.$eval('#biblioteca-banner', (e) => e.children.length), 0);
});

test('importa guia-exemplo mantendo títulos e exporta o .stepbystep.zip de volta', async () => {
  await importarZip('guia-exemplo.stepbystep.zip', await zipDaPasta('guia-exemplo'), ID_EXEMPLO);
  const original = JSON.parse(await readFile(join(FIXTURES, 'guia-exemplo', 'guide.json'), 'utf8'));
  const titulos = await page.$$eval('.passo-cartao .titulo', (els) => els.map((e) => e.textContent));
  assert.deepEqual(titulos, original.passos.map((p) => p.titulo));
  const guia = await esperarGuia(ID_EXEMPLO, (g) => g.passos.length === 10, 'guia-exemplo gravado');
  assert.deepEqual(guia.passos.map((p) => p.tituloAuto), original.passos.map((p) => p.tituloAuto));
  assert.equal(guia.imagens, undefined, 'o mapa imagens não vai para o IndexedDB');
  assert.equal(await page.$eval('.passo-cartao--secao .titulo', (e) => e.textContent), 'Conferência no SAP GUI');
  assert.equal((await page.$$('.passo-cartao .dxt-badge:has-text("sensível")')).length, 1);

  await page.click('#btn-exportar');
  const download = page.waitForEvent('download', { timeout: 60000 });
  await page.click('.menu-item:has-text("Pacote .stepbystep.zip")');
  const arquivo = await download;
  assert.equal(arquivo.suggestedFilename(), 'cadastrar-fornecedor-no-sap-fiori.stepbystep.zip');
  const lido = lerPacote(await lerZip(new Uint8Array(await readFile(await arquivo.path()))));
  assert.equal(lido.guia.passos.length, 10);
  assert.equal(lido.imagens.size, 7);
  assert.deepEqual(lido.avisos, []);
  assert.deepEqual(lido.guia.passos.map((p) => p.titulo), original.passos.map((p) => p.titulo));
  assert.equal(sha256(lido.imagens.get('img_m1x4k9zr02ab')), sha256(await readFile(join(FIXTURES, 'guia-exemplo', 'imagens', 'img_m1x4k9zr02ab.png'))), 'PNG original intacto');
});

test('recorte «Focar no alvo» segue recorteFocado e «Remover recorte» o apaga', async () => {
  await page.click('.passo-cartao[data-id="p_m1x4k9zr02ab"]');
  await page.keyboard.press('c');
  await page.waitForSelector('#btn-focar-alvo:visible');
  await page.click('#btn-focar-alvo');
  const esperado = recorteFocado({ x: 2540, y: 292, w: 144, h: 52 }, { largura: 2880, altura: 1620 }, { escala: 2 });
  let guia = await esperarGuia(ID_EXEMPLO, (g) => g.passos[1].anotacoes.some((a) => a.tipo === 'recorte'), 'recorte focado');
  const recorte = guia.passos[1].anotacoes.find((a) => a.tipo === 'recorte');
  assert.deepEqual({ x: recorte.x, y: recorte.y, w: recorte.w, h: recorte.h }, esperado);
  assert.equal(recorte.auto, false);
  await page.waitForFunction((a) => document.querySelector('.canvas-palco')?.dataset.area === `${a.x},${a.y},${a.w},${a.h}` || document.querySelector('.canvas-palco')?.dataset.area === '0,0,2880,1620', esperado);
  await page.click('#btn-remover-recorte');
  guia = await esperarGuia(ID_EXEMPLO, (g) => !g.passos[1].anotacoes.some((a) => a.tipo === 'recorte'), 'recorte removido');
  assert.equal(guia.passos[1].anotacoes.length, 2, 'as anotações automáticas continuam');
});

test('marcador e texto: número seguinte, fonte proporcional à escala e fundo', async () => {
  await page.keyboard.press('Escape');            // volta a Selecionar
  await page.keyboard.press('m');
  await page.waitForSelector('.ferramenta-btn[data-ferramenta="marcador"].is-ativa');
  const g = await geometriaDoCanvas();
  const tela = (p) => ({ x: g.rect.x + (p.x - g.area.x) * g.zoom, y: g.rect.y + (p.y - g.area.y) * g.zoom });
  const pm = tela({ x: 1200, y: 800 });
  await page.mouse.click(pm.x, pm.y);
  let guia = await esperarGuia(ID_EXEMPLO, (x) => x.passos[1].anotacoes.length === 3, 'marcador gravado');
  const marcador = guia.passos[1].anotacoes.at(-1);
  assert.equal(marcador.tipo, 'marcador');
  assert.equal(marcador.numero, 3, 'seguinte ao marcador automático 2');
  assert.ok(Math.abs(marcador.x - 1200) <= 2 / g.zoom + 1 && Math.abs(marcador.y - 800) <= 2 / g.zoom + 1, JSON.stringify(marcador));

  await page.keyboard.press('t');
  await page.waitForSelector('.ferramenta-btn[data-ferramenta="texto"].is-ativa');
  const pt = tela({ x: 600, y: 1200 });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.canvas-texto-editor');
  await page.keyboard.type('Razão social');
  await page.keyboard.press('Enter');
  guia = await esperarGuia(ID_EXEMPLO, (x) => x.passos[1].anotacoes.length === 4, 'texto gravado');
  const texto = guia.passos[1].anotacoes.at(-1);
  assert.equal(texto.tipo, 'texto');
  assert.equal(texto.texto, 'Razão social');
  assert.equal(texto.tamanho, 32, '16 × escala 2');
  assert.equal(texto.cor, 'cerceta');
  assert.equal(texto.fundo, 'off');
  assert.equal(await page.$('.canvas-texto-editor'), null, 'o editor de texto fecha ao confirmar');
  assert.equal(await page.$eval('#passo-anotacoes .anotacao-item.is-selecionada .anotacao-detalhe', (e) => e.textContent), '«Razão social»');
});

test('gesto no canvas depois de o LRU descartar outras imagens: o bitmap do passo fica fixado e a anotação sai certa', async () => {
  await page.keyboard.press('Escape');            // limpa a seleção do texto
  await page.keyboard.press('r');
  await page.waitForSelector('.ferramenta-btn[data-ferramenta="retangulo"].is-ativa');
  // 10 imagens inexistentes ocupam o cache (limite 6): sem a fixação, o bitmap do passo aberto seria fechado (0×0)
  const cache = await page.evaluate(async () => {
    const m = await import('/editor/canvas-anotacao.js');
    const antes = await m.obterBitmap('img_m1x4k9zr02ab');
    for (let i = 0; i < 10; i++) await m.obterBitmap(`img_inexistente${i}`);
    const depois = await m.obterBitmap('img_m1x4k9zr02ab');
    return { mesmo: antes === depois, fechado: m.bitmapFechado(depois), largura: depois.width };
  });
  assert.deepEqual(cache, { mesmo: true, fechado: false, largura: 2880 }, 'a imagem do passo aberto continua no cache, aberta');
  const total = (await lerGuia(ID_EXEMPLO)).passos[1].anotacoes.length;
  const g = await arrastarNaImagem({ x: 900, y: 500 }, { x: 1300, y: 700 });
  const tol = 2 / g.zoom + 1;
  const guia = await esperarGuia(ID_EXEMPLO, (x) => x.passos[1].anotacoes.length === total + 1, 'retângulo gravado após a evicção');
  const r = guia.passos[1].anotacoes.at(-1);
  assert.equal(r.tipo, 'retangulo');
  assert.ok(Math.abs(r.x - 900) <= tol && Math.abs(r.y - 500) <= tol && Math.abs(r.w - 400) <= tol && Math.abs(r.h - 200) <= tol, JSON.stringify(r));
});

test('Shift+Enter confirma o texto e quebras de linha coladas viram espaço (o render é de uma linha)', async () => {
  await page.keyboard.press('t');
  await page.waitForSelector('.ferramenta-btn[data-ferramenta="texto"].is-ativa');
  const total = (await lerGuia(ID_EXEMPLO)).passos[1].anotacoes.length;
  const g = await geometriaDoCanvas();
  const tela = (p) => ({ x: g.rect.x + (p.x - g.area.x) * g.zoom, y: g.rect.y + (p.y - g.area.y) * g.zoom });
  const pt = tela({ x: 600, y: 1400 });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.canvas-texto-editor');
  await page.keyboard.type('linha um');
  await page.evaluate(() => { document.querySelector('.canvas-texto-editor').value += '\nlinha dois'; });   // colagem com quebra
  await page.keyboard.press('Shift+Enter');
  await page.waitForSelector('.canvas-texto-editor', { state: 'detached' });
  const guia = await esperarGuia(ID_EXEMPLO, (x) => x.passos[1].anotacoes.length === total + 1, 'texto gravado');
  const texto = guia.passos[1].anotacoes.at(-1);
  assert.equal(texto.tipo, 'texto');
  assert.equal(texto.texto, 'linha um linha dois');
});

test('digitar na descrição não redesenha o canvas nem recria os cartões da lista', async () => {
  await page.click('#passo-descricao');
  await page.evaluate(() => {
    window.__sbsTeste.drawImageVis = 0;
    window.__sbsTeste.cartoes = [...document.querySelectorAll('.passo-cartao')];
  });
  await page.keyboard.type('Observação digitada letra a letra', { delay: 15 });
  await esperarGuia(ID_EXEMPLO, (g) => g.passos[1].descricao === 'Observação digitada letra a letra', 'descrição gravada');
  const r = await page.evaluate(() => {
    const agora = [...document.querySelectorAll('.passo-cartao')];
    return { desenhos: window.__sbsTeste.drawImageVis, mesmos: agora.length === window.__sbsTeste.cartoes.length && agora.every((li, i) => li === window.__sbsTeste.cartoes[i]) };
  });
  assert.equal(r.desenhos, 0, 'nenhum drawImage no canvas de visualização ao digitar');
  assert.equal(r.mesmos, true, 'os cartões foram reaproveitados');
  // e uma mudança visível (título) troca só o cartão do passo
  await page.fill('#passo-titulo', 'Clique em «Criar» agora');
  await page.waitForFunction(() => document.querySelector('.passo-cartao[data-id="p_m1x4k9zr02ab"] .titulo')?.textContent === 'Clique em «Criar» agora');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.passo-cartao')].filter((li, i) => li !== window.__sbsTeste.cartoes[i]).map((li) => li.dataset.id).join()), 'p_m1x4k9zr02ab');
  await esperarGuia(ID_EXEMPLO, (g) => g.passos[1].titulo === 'Clique em «Criar» agora', 'título gravado');
});

test('com o menu do passo aberto, Delete exclui o passo (com confirmação), não a anotação selecionada', async () => {
  await page.click('#passo-anotacoes .anotacao-item .anotacao-nome');
  await page.waitForSelector('#passo-anotacoes .anotacao-item.is-selecionada');
  const antes = await lerGuia(ID_EXEMPLO);
  await page.click('.passo-cartao[data-id="p_m1x4k9zr02ab"] .menu-btn');
  await page.waitForSelector('.menu [role="menuitem"]');
  await page.keyboard.press('Delete');
  await page.waitForSelector('.dialogo:has-text("Excluir passo")');
  assert.equal(await page.$('.menu'), null, 'o menu fechou ao executar o item');
  await page.click('.dialogo .dxt-btn:has-text("Cancelar")');
  await page.waitForSelector('.dialogo', { state: 'detached' });
  await page.waitForTimeout(400);
  const depois = await lerGuia(ID_EXEMPLO);
  assert.equal(depois.passos.length, antes.passos.length);
  assert.equal(depois.passos[1].anotacoes.length, antes.passos[1].anotacoes.length, 'a anotação selecionada continua');
  assert.ok(await page.$('#passo-anotacoes .anotacao-item.is-selecionada'), 'e continua selecionada');
  // Enter continua ativando o item focado (Renomear)
  await page.click('.passo-cartao[data-id="p_m1x4k9zr02ab"] .menu-btn');
  await page.waitForSelector('.menu [role="menuitem"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.dialogo:has-text("Renomear passo")');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialogo', { state: 'detached' });
  // Alt+↓ (anunciado em «Mover para baixo») executa o item em vez de só navegar no menu; Alt+↑ desfaz
  await page.click('.passo-cartao[data-id="p_m1x4k9zr02ab"] .menu-btn');
  await page.waitForSelector('.menu [role="menuitem"]');
  await page.keyboard.press('Alt+ArrowDown');
  await esperarGuia(ID_EXEMPLO, (g) => g.passos[2].id === 'p_m1x4k9zr02ab', 'passo movido para baixo pelo menu');
  assert.equal(await page.$('.menu'), null);
  await page.click('.passo-cartao[data-id="p_m1x4k9zr02ab"] .menu-btn');
  await page.waitForSelector('.menu [role="menuitem"]');
  await page.keyboard.press('Alt+ArrowUp');
  await esperarGuia(ID_EXEMPLO, (g) => g.passos[1].id === 'p_m1x4k9zr02ab', 'passo de volta ao lugar');
});

test('mudar o tipo para Seção remove imagem, anotações e alvo (com confirmação; desfazível)', async () => {
  const antes = await lerGuia(ID_EXEMPLO);
  await page.selectOption('#passo-tipo', 'secao');
  await page.waitForSelector('.dialogo:has-text("Transformar em seção")');
  await page.click('.dialogo .dxt-btn:has-text("Transformar")');
  const guia = await esperarGuia(ID_EXEMPLO, (g) => g.passos[1].tipo === 'secao', 'passo virou seção');
  const p = guia.passos[1];
  assert.deepEqual({ captura: p.captura, anotacoes: p.anotacoes, alvo: p.alvo, evento: p.evento }, { captura: null, anotacoes: [], alvo: null, evento: null });
  await page.waitForFunction(() => document.querySelector('.canvas-palco')?.hidden && /Seções não têm imagem/.test(document.querySelector('.canvas-vazio')?.textContent ?? ''));
  assert.equal(await page.$('.passo-cartao[data-id="p_m1x4k9zr02ab"] .passo-cartao-mini'), null, 'cartão de seção sem miniatura');
  // desfazer restaura tudo
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  const restaurado = await esperarGuia(ID_EXEMPLO, (g) => g.passos[1].tipo === 'clicar', 'tipo restaurado');
  assert.deepEqual(restaurado.passos[1].captura, antes.passos[1].captura);
  assert.equal(restaurado.passos[1].anotacoes.length, antes.passos[1].anotacoes.length);
  await page.waitForFunction(() => !document.querySelector('.canvas-palco')?.hidden);
  // cancelar na confirmação mantém o tipo
  await page.selectOption('#passo-tipo', 'secao');
  await page.waitForSelector('.dialogo:has-text("Transformar em seção")');
  await page.click('.dialogo .dxt-btn:has-text("Cancelar")');
  await page.waitForSelector('.dialogo', { state: 'detached' });
  assert.equal(await page.$eval('#passo-tipo', (s) => s.value), 'clicar');
});

test('falha ao gravar a imagem anexada vira aviso, não rejeição silenciosa', async () => {
  const antes = await lerGuia(ID_EXEMPLO);
  await page.evaluate(() => { window.__sbsTeste.falharImagem = '*'; });
  await page.setInputFiles('#passo-imagem-arquivo', { name: 'nova.png', mimeType: 'image/png', buffer: await readFile(join(FIXTURES, 'guia-exemplo', 'imagens', 'img_m1x4k9zr01aa.png')) });
  await page.waitForSelector('.aviso--erro:has-text("Não foi possível gravar a imagem")');
  await page.evaluate(() => { window.__sbsTeste.falharImagem = null; });
  await page.waitForTimeout(500);
  const depois = await lerGuia(ID_EXEMPLO);
  assert.equal(depois.passos[1].captura.imagemId, antes.passos[1].captura.imagemId, 'a imagem do passo não mudou');
  assert.equal(depois.passos[1].anotacoes.length, antes.passos[1].anotacoes.length);
});

test('dois hashchange seguidos enquanto o editor fecha montam uma tela só (sem atalhos duplicados)', async () => {
  await page.fill('#guia-autor', 'Equipe de TI');   // alteração pendente: o fechamento espera a gravação
  await page.evaluate((id) => { location.hash = '#/'; location.hash = `#/guia/${id}`; }, ID_MAC);
  await page.waitForFunction(() => document.querySelectorAll('.passo-cartao').length === 6 && document.querySelector('#guia-titulo')?.value === 'Gravação — SAP GUI');
  assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('#editor').length, document.querySelectorAll('#canvas-vis').length, document.querySelectorAll('.biblioteca').length]), [1, 1, 0], 'um editor, um canvas, nenhuma biblioteca sobrando');
  await page.click('#btn-novo-passo');
  await page.click('#btn-novo-passo');
  await esperarGuia(ID_MAC, (g) => g.passos.length === 8, 'dois passos inseridos');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelectorAll('.passo-cartao').length < 8);
  assert.equal((await page.$$('.passo-cartao')).length, 7, 'um Ctrl+Z desfaz uma inserção só (um único handler de atalhos)');
  await esperarGuia(ID_MAC, (g) => g.passos.length === 7, 'gravado com 7 passos');
  await page.keyboard.press('Control+z');
  await esperarGuia(ID_MAC, (g) => g.passos.length === 6, 'de volta aos 6 passos');
  assert.equal((await lerGuia(ID_EXEMPLO)).autor, 'Equipe de TI', 'a alteração pendente do editor anterior foi gravada');
});

test('diálogos aninhados: só o do topo trata Esc e Tab; cancelar a importação não é erro', async () => {
  await page.goto(url('/editor/#/'));
  await page.waitForSelector('#btn-importar');
  await page.click('#btn-importar');
  await page.setInputFiles('#importar-arquivo', { name: 'guia-exemplo.stepbystep.zip', mimeType: 'application/zip', buffer: await zipDaPasta('guia-exemplo') });
  await page.waitForSelector('.dialogo:has-text("Guia já existe")');
  assert.equal((await page.$$('.dialogo')).length, 2);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    assert.ok(await page.evaluate(() => document.querySelectorAll('.dialogo')[1].contains(document.activeElement)), `Tab ${i}: foco preso no diálogo do topo`);
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialogo:has-text("Guia já existe")', { state: 'detached' });
  assert.equal((await page.$$('.dialogo')).length, 1, 'o diálogo de importação continua aberto');
  await page.waitForTimeout(300);
  assert.ok(!errosDePagina.some((e) => /Importação cancelada/.test(e)), 'cancelar não é registrado como erro');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialogo', { state: 'detached' });
});

test('«Substituir» na importação só apaga o original depois de a importação terminar', async () => {
  await page.click('#btn-importar');
  await page.evaluate(() => { window.__sbsTeste.falharImagem = 'img_m1x4k9zr04ad'; });   // a 3ª imagem falha ao gravar (cota)
  await page.setInputFiles('#importar-arquivo', { name: 'guia-exemplo.stepbystep.zip', mimeType: 'application/zip', buffer: await zipDaPasta('guia-exemplo') });
  await page.waitForSelector('.dialogo:has-text("Guia já existe")');
  await page.click('.dialogo .dxt-btn:has-text("Substituir")');
  await page.waitForSelector('.aviso--erro:has-text("cota simulada")');
  await page.evaluate(() => { window.__sbsTeste.falharImagem = null; });
  const guia = await lerGuia(ID_EXEMPLO);
  assert.ok(guia, 'o guia original continua na biblioteca');
  assert.equal(guia.passos.length, 10);
  assert.equal(guia.passos[1].descricao, 'Observação digitada letra a letra', 'com as edições feitas no editor');
  assert.equal((await imagensDoGuia(ID_EXEMPLO)).length, 7, 'e com todas as imagens');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialogo', { state: 'detached' });
  // a falha real foi registrada no console (esperado neste teste): não conta como erro da página
  const i = errosDePagina.findIndex((e) => /Falha na importação/.test(e));
  assert.ok(i >= 0, 'a falha foi registrada no console');
  errosDePagina.splice(i, 1);
});

test('gravação de outra aba não é sobrescrita: o editor entra em conflito, avisa e não apaga imagens ao sair', async () => {
  await page.goto(url(`/editor/#/guia/${ID_EXEMPLO}`));
  await page.waitForSelector('.passo-cartao');
  await gravarComoOutraAba(ID_EXEMPLO, (g) => { g.titulo = 'Alterado em outra aba'; });
  await page.click('#passo-descricao');
  await page.keyboard.type(' (edição que não pode sobrescrever)');
  await page.waitForFunction(() => /outra aba/.test(document.querySelector('#estado-salvamento')?.textContent ?? ''));
  await page.waitForSelector('.aviso--erro:has-text("outra aba")');
  await page.waitForTimeout(500);
  const guia = await lerGuia(ID_EXEMPLO);
  assert.equal(guia.titulo, 'Alterado em outra aba', 'a versão mais nova do banco ficou intacta');
  assert.equal(guia.passos[1].descricao, 'Observação digitada letra a letra');
  await page.goto(url('/editor/#/'));
  await page.waitForSelector('.guia-cartao');
  assert.equal(await page.$eval(`.guia-cartao[data-id="${ID_EXEMPLO}"] .guia-cartao-titulo`, (e) => e.textContent), 'Alterado em outra aba');
  assert.equal((await imagensDoGuia(ID_EXEMPLO)).length, 7, 'nenhuma imagem apagada com base na cópia velha');
});

test('a biblioteca lista os dois guias e a página não registrou erros', async () => {
  await page.goto(url('/editor/#/'));
  await page.waitForSelector('.guia-cartao');
  const ids = await page.$$eval('.guia-cartao', (els) => els.map((e) => e.dataset.id));
  assert.deepEqual(new Set(ids), new Set([ID_MAC, ID_EXEMPLO]));
  assert.deepEqual(errosDePagina, []);
});
