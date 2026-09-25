// Playwright + extensão carregada (seções 5.13 e 9.2): grava formulario.html e confere o guia
// produzido pelo service worker. Sobe o dev-server em porta livre, sincroniza core/editor para
// dentro da extensão e usa um perfil descartável em tests/.perfis/.
// Depuração: SBS_DEBUG=1 imprime o console do SW e das páginas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { iniciarServidor } from '../../scripts/dev-server.mjs';
import { sincronizar } from '../../scripts/sincronizar-extensao.mjs';
import { validarGuia } from '../../packages/core/modelo.js';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const EXT = join(RAIZ, 'packages', 'extensao');
const PERFIS = join(RAIZ, 'tests', '.perfis');
const DEBUG = !!process.env.SBS_DEBUG;
const CERCETA = [0x00, 0x99, 0x94];
// Janela real (sem viewport emulado): captureVisibleTab fotografa a aba de verdade, e um viewport emulado
// pelo Playwright (1280×800 "por dentro" numa aba menor) sairia recortado na foto, deslocando todo bbox.
// 887 = 800 de página + ~87 px de interface do headless novo; o DPR 2 é forçado no próprio Chromium.
const JANELA = { width: 1280, height: 887 };
const DPR = 2;

let servidor;
let ctx;
let sw;
let perfil;
let base;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const proximo = (v, esperado, tol) => Math.abs(v - esperado) <= tol;

/**
 * `channel: 'chromium'` usa o build completo (headless novo, carrega extensões). Se a revisão que o
 * Playwright instalado espera não estiver em PLAYWRIGHT_BROWSERS_PATH, usa o build completo mais
 * recente que existir lá (undefined = deixar o Playwright resolver).
 */
function executavelChromium() {
  try { if (existsSync(chromium.executablePath())) return undefined; } catch { /* segue para o fallback */ }
  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  let revisoes = [];
  try { revisoes = readdirSync(raiz).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9))); } catch { return undefined; }
  for (const rev of revisoes) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const caminho = join(raiz, rev, sub);
      if (existsSync(caminho)) return caminho;
    }
  }
  return undefined;
}

/** Espera até `condicao(guia)` ser verdadeira (o SW responde só depois de persistir, mas há tarefas adiadas). */
async function esperarGuia(guiaId, condicao, timeout = 8000) {
  const inicio = Date.now();
  let guia = null;
  while (Date.now() - inicio < timeout) {
    guia = await sw.evaluate((id) => globalThis.__sbs.lerGuia(id), guiaId);
    if (guia && condicao(guia)) return guia;
    await esperar(100);
  }
  return guia;
}

async function abaPorUrl(url) {
  return sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? null, url);
}

before(async () => {
  await sincronizar();
  servidor = await iniciarServidor({ porta: 0 });
  base = `http://127.0.0.1:${servidor.porta}/tests/fixtures/paginas/`;
  await mkdir(PERFIS, { recursive: true });
  perfil = await mkdtemp(join(PERFIS, 'extensao-'));
  const executablePath = executavelChromium();
  if (DEBUG && executablePath) console.log('[e2e] chromium:', executablePath);
  ctx = await chromium.launchPersistentContext(perfil, {
    channel: 'chromium', headless: true, viewport: null, executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--window-size=${JANELA.width},${JANELA.height}`, `--force-device-scale-factor=${DPR}`],
  });
  sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
  if (DEBUG) sw.on('console', (m) => console.log('[sw]', m.text()));
  // o Playwright anexa ao SW antes de o módulo terminar de avaliar (e antes de os globais existirem): espera daqui
  for (let i = 0; i < 200 && !(await sw.evaluate(() => typeof globalThis.__sbs === 'object')); i++) await esperar(50);
  assert.ok(await sw.evaluate(() => typeof globalThis.__sbs === 'object'), 'globalThis.__sbs disponível no service worker');
});

after(async () => {
  await ctx?.close().catch(() => {});
  await servidor?.fechar();
  if (perfil) await rm(perfil, { recursive: true, force: true }).catch(() => {});
});

test('grava formulario.html: títulos, sensível, iframe, navegação, imagens e marcador', async () => {
  const urlFormulario = base + 'formulario.html';
  const page = ctx.pages()[0] ?? await ctx.newPage();
  if (DEBUG) page.on('console', (m) => console.log('[pagina]', m.text()));
  await page.goto(urlFormulario);
  const abaId = await abaPorUrl(urlFormulario);
  assert.ok(Number.isInteger(abaId), 'aba do formulário encontrada');

  const inicio = await sw.evaluate((id) => globalThis.__sbs.iniciar(id), abaId);
  assert.equal(inicio.ok, true, `iniciar: ${inicio.erro ?? ''}`);
  const guiaId = inicio.guiaId;
  const barra = page.locator('[data-sbs-barra]');
  await barra.waitFor({ state: 'attached', timeout: 5000 });
  const estadoInicial = await sw.evaluate(() => globalThis.__sbs.estado());
  assert.equal(estadoInicial.status, 'gravando');
  assert.deepEqual(estadoInicial.abas, [abaId]);

  await page.fill('#nome', 'ACME Ltda');
  await page.fill('#senha', 'segredo');
  await page.selectOption('#pais', 'BR');
  await page.check('#aceito');
  await page.locator('meu-widget').locator('button').click();
  const botaoIframe = page.frameLocator('iframe').locator('button');
  await botaoIframe.scrollIntoViewIfNeeded();
  const caixaIframe = await botaoIframe.boundingBox(); // já relativo ao viewport principal
  await botaoIframe.click();
  await page.press('#email', 'Enter');
  // pressão de ~100 ms como a de um clique humano: a navegação só dispara no mouseup
  await page.click('#enviar', { delay: 100 });
  await page.waitForURL(/pagina2\.html$/);
  // a barra reaparece na página com CSP restritiva
  await page.locator('[data-sbs-barra]').waitFor({ state: 'attached', timeout: 5000 });

  const guiaGravando = await esperarGuia(guiaId, (g) => g.passos.length >= 9 && !!g.passos[8]?.resultado?.url);
  // PARAR abre o editor empacotado numa aba nova (seção 5.5)
  const idExt = new URL(sw.url()).host;
  const abaEditor = ctx.waitForEvent('page', { timeout: 10000 });
  const parada = await sw.evaluate(() => globalThis.__sbs.parar());
  assert.equal(parada.ok, true);
  assert.equal(await sw.evaluate(() => globalThis.__sbs.estado()), null, 'estado limpo depois de parar');
  const guia = await sw.evaluate((id) => globalThis.__sbs.lerGuia(id), guiaId);
  assert.ok(guia, 'guia gravado no IndexedDB');
  const editor = await abaEditor;
  const errosEditor = [];
  editor.on('pageerror', (e) => errosEditor.push(`pageerror: ${e.message}`));
  editor.on('console', (m) => { if (m.type() === 'error') errosEditor.push(`console.error: ${m.text()}`); });
  await editor.waitForLoadState('load');
  assert.equal(editor.url(), `chrome-extension://${idExt}/editor/index.html#/guia/${guiaId}`, 'editor aberto no guia gravado');
  if (DEBUG) console.log(JSON.stringify(guia.passos.map((p) => ({ tipo: p.tipo, titulo: p.titulo, fonte: p.captura?.fonte, faltante: p.captura?.faltante })), null, 1));

  // títulos exatos, na ordem
  assert.deepEqual(guia.passos.map((p) => p.titulo), [
    `Navegue para 127.0.0.1:${servidor.porta}/tests/fixtures/paginas/formulario.html`,
    'Digite «ACME Ltda» no campo «Nome»',
    'Digite sua senha no campo «Senha»',
    'Selecione «Brasil» em «País»',
    'Marque «Aceito os termos»',
    'Clique em «Botão no shadow»',
    'Clique em «Botão no iframe»',
    'Pressione Enter',
    'Clique em «Enviar»',
  ], `títulos: ${JSON.stringify(guia.passos.map((p) => p.titulo))}`);
  assert.equal(guiaGravando?.passos.length, 9, 'nenhum passo extra criado pela navegação');
  assert.equal(guia.estado, 'concluido');
  assert.equal(guia.origem.tipo, 'extensao');
  const validacao = validarGuia(guia);
  assert.deepEqual(validacao.erros, [], 'guia válido segundo o núcleo');
  assert.deepEqual(guia.passos.map((p) => p.tipo), ['navegar', 'digitar', 'digitar', 'selecionar', 'marcar', 'clicar', 'clicar', 'tecla', 'clicar']);
  assert.ok(guia.passos.every((p) => p.tituloAuto === true));

  const [navegar, nome, senha, pais, aceito, shadow, iframe, enter, enviar] = guia.passos;

  // captura: escala medida no bitmap ≈ dpr (2) ou 1; a foto tem exatamente o tamanho do viewport × escala
  for (const p of guia.passos) {
    if (!p.captura || p.captura.faltante) continue;
    const escala = p.captura.largura / p.captura.viewport.largura;
    assert.ok(proximo(escala, 2, 0.05) || proximo(escala, 1, 0.05), `escala ${escala} de ${p.titulo}`);
    assert.ok(proximo(p.captura.escala, escala, 0.01));
    assert.ok(proximo(p.captura.altura, p.captura.viewport.altura * escala, 2), `altura ${p.captura.altura} ≠ viewport ${p.captura.viewport.altura} × ${escala} em ${p.titulo}`);
  }
  assert.equal(navegar.captura?.faltante, false, 'passo inicial com foto');
  assert.equal(navegar.captura.fonte, 'navegacao');
  assert.equal(navegar.evento.transicao, 'inicio');

  // digitação
  assert.equal(nome.evento.valor, 'ACME Ltda');
  assert.equal(nome.evento.sensivel, false);
  assert.equal(nome.alvo.campo, 'Nome');
  assert.equal(nome.alvo.fonteRotulo, 'label');
  assert.equal(nome.captura.faltante, false);
  assert.ok(['confirmacao', 'compartilhada'].includes(nome.captura.fonte));

  // senha: valor nunca sai da página; desfoque automático
  assert.equal(senha.evento.valor, null);
  assert.equal(senha.evento.sensivel, true);
  assert.equal(senha.evento.motivo, 'input[type=password]');
  assert.equal(senha.alvo.tipoInput, 'password');
  assert.equal(senha.captura.faltante, false);
  assert.ok(senha.anotacoes.some((a) => a.tipo === 'desfoque' && a.auto), 'senha tem desfoque auto');
  assert.ok(senha.anotacoes.some((a) => a.tipo === 'retangulo' && a.auto));

  // digitar confirmado por clique compartilha a foto do clique
  for (const p of guia.passos.filter((x) => x.tipo === 'digitar' && x.evento.confirmadoPor === 'clique')) {
    assert.equal(p.captura.fonte, 'compartilhada', `${p.titulo} confirmado por clique`);
  }
  assert.ok(['blur', 'clique'].includes(nome.evento.confirmadoPor));

  // seleção e marcação
  assert.deepEqual(pais.evento, { valor: 'BR', opcao: 'Brasil' });
  assert.equal(pais.alvo.papel, 'combobox');
  assert.deepEqual(aceito.evento, { marcado: true });
  assert.equal(aceito.alvo.papel, 'checkbox');
  assert.equal(aceito.captura.faltante, false);

  // shadow root aberto
  assert.equal(shadow.alvo.papel, 'button');
  assert.equal(shadow.alvo.fonteRotulo, 'texto');
  assert.equal(shadow.contexto.frameId, 0);

  // iframe: bbox ≈ (boundingBox do botão no frame já relativo ao viewport principal) × escala, tolerância 3 px
  assert.ok(caixaIframe, 'boundingBox do botão do iframe');
  assert.notEqual(iframe.contexto.frameId, 0, 'clique veio de um frame filho');
  assert.equal(iframe.captura.faltante, false, 'clique no iframe tem foto');
  assert.ok(iframe.alvo.bbox, 'bbox do botão do iframe resolvido');
  {
    const e = iframe.captura.escala;
    const tol = 3;
    const bb = iframe.alvo.bbox;
    assert.ok(proximo(bb.x, caixaIframe.x * e, tol), `bbox.x ${bb.x} ≈ ${caixaIframe.x * e}`);
    assert.ok(proximo(bb.y, caixaIframe.y * e, tol), `bbox.y ${bb.y} ≈ ${caixaIframe.y * e}`);
    assert.ok(proximo(bb.w, caixaIframe.width * e, tol), `bbox.w ${bb.w} ≈ ${caixaIframe.width * e}`);
    assert.ok(proximo(bb.h, caixaIframe.height * e, tol), `bbox.h ${bb.h} ≈ ${caixaIframe.height * e}`);
    assert.ok(iframe.anotacoes.some((a) => a.tipo === 'marcador' && a.auto && a.numero === 7));
  }

  // Enter
  assert.deepEqual(enter.evento, { tecla: 'Enter', modificadores: [], atalho: 'Enter' });
  assert.equal(enter.alvo, null);

  // clique em Enviar: contexto da página anterior, resultado na página nova
  assert.equal(enviar.contexto.url, urlFormulario);
  assert.ok(enviar.resultado?.url?.endsWith('pagina2.html'), `resultado.url = ${enviar.resultado?.url}`);
  assert.equal(enviar.alvo.papel, 'button');
  assert.equal(enviar.evento.vezes, 1);

  // numeração dos marcadores auto = contador do passo
  guia.passos.forEach((p, i) => {
    for (const a of p.anotacoes.filter((x) => x.tipo === 'marcador' && x.auto)) assert.equal(a.numero, i + 1, `marcador de ${p.titulo}`);
  });

  // o editor empacotado (mesma origem, mesmo IndexedDB) lista os passos que o SW gravou
  await editor.locator('.passo-cartao').first().waitFor({ timeout: 10000 });
  assert.deepEqual(await editor.$$eval('.passo-cartao .titulo', (els) => els.map((e) => e.textContent)), guia.passos.map((p) => p.titulo), 'títulos no editor');
  assert.equal(await editor.$eval('#ambiente', (e) => (e.hidden ? null : e.textContent)), 'extensão', 'editor detecta a extensão');
  assert.deepEqual(errosEditor, [], 'editor sem erros de página');
  await editor.close();

  // imagens no IndexedDB (mesma origem da extensão): tamanho medido = captura; marcador cerceta depois de assar; barra fora da foto
  const paginaExt = await ctx.newPage();
  if (DEBUG) paginaExt.on('console', (m) => console.log('[ext]', m.text()));
  await paginaExt.goto(`chrome-extension://${idExt}/popup/popup.html`);
  const comMarcador = guia.passos.filter((p) => p.captura && !p.captura.faltante && p.anotacoes.some((a) => a.tipo === 'marcador'));
  assert.ok(comMarcador.length >= 5, 'há passos com foto e marcador');
  const resultados = await paginaExt.evaluate(async ({ passos, estilo }) => {
    const { carregarImagem } = await import(chrome.runtime.getURL('core/armazenamento.js'));
    const { assarPasso } = await import(chrome.runtime.getURL('core/render-canvas.js'));
    const saida = [];
    for (const passo of passos) {
      const registro = await carregarImagem(passo.captura.imagemId);
      if (!registro) { saida.push({ id: passo.id, erro: 'imagem ausente' }); continue; }
      const bitmap = await createImageBitmap(registro.blob);
      const medida = { largura: bitmap.width, altura: bitmap.height, registro: { largura: registro.largura, altura: registro.altura } };
      const escala = passo.captura.escala;
      const original = new OffscreenCanvas(bitmap.width, bitmap.height);
      const co = original.getContext('2d', { willReadFrequently: true });
      co.drawImage(bitmap, 0, 0);
      // centro da barra flutuante (right/bottom 16 px, 220×40 CSS) em px da foto
      const posicaoBarra = { x: bitmap.width - (16 + 110) * escala, y: bitmap.height - (16 + 20) * escala };
      const pixelBarra = [...co.getImageData(Math.round(posicaoBarra.x), Math.round(posicaoBarra.y), 1, 1).data].slice(0, 3);
      const { blob, largura, altura } = await assarPasso(bitmap, passo, { estilo });
      const assado = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(assado.width, assado.height);
      const ctx2 = canvas.getContext('2d', { willReadFrequently: true });
      ctx2.drawImage(assado, 0, 0);
      const marcador = passo.anotacoes.find((a) => a.tipo === 'marcador');
      const r = 16 * escala;
      // diagonais a 0,6·r do centro: dentro do círculo e fora do algarismo branco
      const amostras = [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]].map(([dx, dy]) => {
        const d = ctx2.getImageData(Math.round(marcador.x + dx * r), Math.round(marcador.y + dy * r), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
      saida.push({ id: passo.id, medida, assado: { largura, altura }, amostras, pixelBarra });
      bitmap.close(); assado.close();
    }
    return saida;
  }, { passos: comMarcador, estilo: guia.estilo });
  for (const [i, r] of resultados.entries()) {
    const passo = comMarcador[i];
    assert.equal(r.erro, undefined, `${passo.titulo}: ${r.erro}`);
    assert.deepEqual({ largura: r.medida.largura, altura: r.medida.altura }, { largura: passo.captura.largura, altura: passo.captura.altura }, `bitmap de ${passo.titulo}`);
    assert.deepEqual(r.medida.registro, { largura: passo.captura.largura, altura: passo.captura.altura });
    assert.deepEqual(r.assado, { largura: passo.captura.largura, altura: passo.captura.altura }, 'sem recorte, a saída tem o tamanho da imagem');
    for (const px of r.amostras) {
      for (let c = 0; c < 3; c++) assert.ok(proximo(px[c], CERCETA[c], 12), `${passo.titulo}: pixel ${px} no marcador não é cerceta`);
    }
    assert.ok(r.pixelBarra.every((v) => v > 200), `${passo.titulo}: barra flutuante apareceu na foto (${r.pixelBarra})`);
  }
  await paginaExt.close();
  await page.close();
});

test('pausar ignora eventos; retomar volta a gravar; parar conclui o guia', async () => {
  const url = base + 'pagina2.html?gravacao=2'; // URL única: a aba é localizada pela URL
  const page = await ctx.newPage();
  await page.goto(url);
  await page.bringToFront();
  const abaId = await abaPorUrl(url);
  const inicio = await sw.evaluate((id) => globalThis.__sbs.iniciar(id), abaId);
  assert.equal(inicio.ok, true, inicio.erro ?? '');
  await page.locator('[data-sbs-barra]').waitFor({ state: 'attached', timeout: 5000 });

  assert.equal((await sw.evaluate(() => globalThis.__sbs.pausar())).ok, true);
  assert.equal((await sw.evaluate(() => globalThis.__sbs.estado())).status, 'pausado');
  await page.click('#voltar');
  await esperar(300);
  assert.equal((await sw.evaluate(() => globalThis.__sbs.retomar())).ok, true);
  await page.click('#voltar');
  const guiaAntes = await esperarGuia(inicio.guiaId, (g) => g.passos.length >= 2);
  assert.equal((await sw.evaluate(() => globalThis.__sbs.parar())).ok, true);
  const guia = await sw.evaluate((id) => globalThis.__sbs.lerGuia(id), inicio.guiaId);
  assert.deepEqual(guia.passos.map((p) => p.titulo), [`Navegue para 127.0.0.1:${servidor.porta}/tests/fixtures/paginas/pagina2.html`, 'Clique em «Voltar»']);
  assert.equal(guiaAntes.passos.length, 2, 'o clique durante a pausa não virou passo');
  assert.equal(guia.estado, 'concluido');
  assert.equal(await page.locator('[data-sbs-barra]').count(), 0, 'barra removida ao parar');

  // iniciar numa página que não pode ser gravada
  const recusa = await sw.evaluate(async () => {
    const aba = await chrome.tabs.create({ url: 'chrome://version/', active: false });
    const r = await globalThis.__sbs.iniciar(aba.id);
    await chrome.tabs.remove(aba.id);
    return r;
  });
  assert.deepEqual(recusa, { ok: false, erro: 'Esta página não pode ser gravada' });
  await page.close();
});

test('popup: lista os últimos guias e recusa gravar uma página da extensão', async () => {
  const idExt = new URL(sw.url()).host;
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${idExt}/popup/popup.html`);
  await popup.bringToFront();
  await popup.locator('#lista li').first().waitFor({ state: 'attached', timeout: 5000 });
  const titulos = await popup.locator('#lista .guia-titulo').allTextContents();
  assert.ok(titulos.length >= 2, `guias listados: ${JSON.stringify(titulos)}`);
  assert.ok(titulos.includes('Formulário de teste — StepByStep'), 'guia da gravação com o título da aba');
  assert.equal(await popup.locator('#situacao').textContent(), 'Parado');
  assert.equal(await popup.locator('#iniciar').isVisible(), true);
  // a aba ativa é a própria página da extensão: não pode ser gravada
  await popup.click('#iniciar');
  await popup.locator('#aviso:not([hidden])').waitFor({ timeout: 5000 });
  assert.equal(await popup.locator('#aviso').textContent(), 'Esta página não pode ser gravada');
  assert.equal(await sw.evaluate(() => globalThis.__sbs.estado()), null);
  await popup.close();
});

/** Inicia uma gravação numa página nova e visível. @returns {Promise<{page, abaId:number, guiaId:string}>} */
async function gravarPagina(url) {
  const page = await ctx.newPage();
  if (DEBUG) page.on('console', (m) => console.log('[pagina]', m.text()));
  await page.goto(url);
  await page.bringToFront();
  const abaId = await abaPorUrl(url);
  assert.ok(Number.isInteger(abaId), 'aba encontrada');
  const inicio = await sw.evaluate((id) => globalThis.__sbs.iniciar(id), abaId);
  assert.equal(inicio.ok, true, inicio.erro ?? '');
  await page.locator('[data-sbs-barra]').waitFor({ state: 'attached', timeout: 5000 });
  return { page, abaId, guiaId: inicio.guiaId };
}

test('teclado: AltGr, Ctrl+Alt+tecla, tecla segurada, Enter na barra e caractere em campo sensível não viram passos', async () => {
  const { page, guiaId } = await gravarPagina(base + 'formulario.html?gravacao=teclas');
  // keydown sintético (isTrusted false chega ao sensor do mesmo jeito): estados que o Playwright não gera
  const sintetico = (seletor, init) => page.evaluate(([s, i]) => {
    document.querySelector(s).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...i }));
  }, [seletor, init]);

  await page.focus('#nome');
  await page.keyboard.press('Control+b');                                                             // atalho de verdade → passo
  await page.keyboard.press('Control+Alt+q');                                                         // AltGr no Windows chega como Ctrl+Alt
  await sintetico('#nome', { key: '/', code: 'KeyQ', ctrlKey: true, altKey: true, modifierAltGraph: true }); // AltGr+Q (ABNT2) = «/»
  await sintetico('#nome', { key: '?', code: 'KeyW', altKey: true, modifierAltGraph: true });          // AltGraph sem Ctrl
  await sintetico('#nome', { key: 'Enter', repeat: true });                                           // Enter segurado
  await sintetico('[data-sbs-barra]', { key: 'Enter' });                                              // Enter com foco num botão da barra
  await page.press('#nome', 'Enter');                                                                 // Enter de verdade → passo
  await page.focus('#senha');
  await page.keyboard.press('Control+b');                                                             // caractere + modificador em campo sensível
  await page.keyboard.press('Control+Shift+x');

  await esperarGuia(guiaId, (g) => g.passos.length >= 3);
  await esperar(600); // nada mais pode chegar
  assert.equal((await sw.evaluate(() => globalThis.__sbs.parar())).ok, true);
  const guia = await sw.evaluate((id) => globalThis.__sbs.lerGuia(id), guiaId);
  assert.deepEqual(guia.passos.map((p) => p.titulo), [
    `Navegue para 127.0.0.1:${servidor.porta}/tests/fixtures/paginas/formulario.html`, // a frase omite a query
    'Pressione Ctrl+B',
    'Pressione Enter',
  ], `títulos: ${JSON.stringify(guia.passos.map((p) => p.titulo))}`);
  assert.deepEqual(guia.passos[1].evento, { tecla: 'B', modificadores: ['Ctrl'], atalho: 'Ctrl+B' });
  assert.equal(guia.passos[1].captura.faltante, false);
  await page.close();
});

test('aba em segundo plano: digitação confirmada com outra aba visível fica sem foto (a outra aba nunca é fotografada)', async () => {
  const { page, abaId, guiaId } = await gravarPagina(base + 'formulario.html?gravacao=fundo');
  await page.fill('#nome', 'Em segundo plano');
  // outra aba, fora da gravação, vira a visível da mesma janela — como o webmail pessoal do usuário
  const outra = await sw.evaluate(async ({ url, abaId: id }) => {
    const { windowId } = await chrome.tabs.get(id);
    return (await chrome.tabs.create({ url, windowId, active: true })).id;
  }, { url: base + 'pagina2.html?outra=1', abaId });
  for (let i = 0; i < 50 && await sw.evaluate(async (id) => (await chrome.tabs.get(id)).active, abaId); i++) await esperar(100);
  assert.equal(await sw.evaluate(async (id) => (await chrome.tabs.get(id)).active, abaId), false, 'aba gravada em segundo plano');
  await page.evaluate(() => document.getElementById('nome').blur()); // focusout → DIGITACAO confirmada por blur

  const gravando = await esperarGuia(guiaId, (g) => g.passos.length >= 2);
  const digitar = gravando.passos[1];
  assert.equal(digitar?.titulo, 'Digite «Em segundo plano» no campo «Nome»');
  assert.equal(digitar.captura.faltante, true, 'sem foto: captureVisibleTab fotografaria a outra aba');
  assert.equal(digitar.captura.motivo, 'aba não visível');
  assert.equal(digitar.captura.imagemId, null);

  // de volta à aba gravada, a captura funciona de novo
  await sw.evaluate(async ({ abaId: id, outra: o }) => { await chrome.tabs.update(id, { active: true }); await chrome.tabs.remove(o); }, { abaId, outra });
  await page.bringToFront();
  await page.locator('meu-widget').locator('button').click();
  const depois = await esperarGuia(guiaId, (g) => g.passos.length >= 3);
  assert.equal(depois.passos[2]?.titulo, 'Clique em «Botão no shadow»');
  assert.equal(depois.passos[2].captura.faltante, false);
  assert.equal((await sw.evaluate(() => globalThis.__sbs.parar())).ok, true);
  await page.close();
});
