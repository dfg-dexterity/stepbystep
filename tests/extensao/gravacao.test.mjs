// sw/gravacao.js + sw/navegacao.js com chrome falso (tests/extensao/falso-chrome.mjs): a foto nunca sai de
// uma aba que não está visível, a janela é a do remetente, a navegação pendente recebe o instante do
// onCommitted e é fotografada antes do evento seguinte, pendência obsoleta é descartada, digitação
// confirmada no pagehide não fotografa a página seguinte e o reaproveitamento exige a mesma aba.
// Os módulos do SW importam ../core/*.js (cópias de `npm run sincronizar`): sem elas os testes são pulados.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarChromeFalso, criarIndexedDBFalso, createImageBitmapFalso, VIEWPORT_FALSO } from './falso-chrome.mjs';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const EXT = join(RAIZ, 'packages', 'extensao');
const temCopias = existsSync(join(EXT, 'core', 'redutor-eventos.js'));
const MENSAGEM_SKIP = 'rode `npm run sincronizar`';

const URL_A = 'https://app.exemplo.com/a';
const URL_B = 'https://app.exemplo.com/b';
const URL_C = 'https://app.exemplo.com/c';
const ALVO_BOTAO = { papel: 'button', rotulo: 'Criar', fonteRotulo: 'texto', campo: null, tag: 'button', tipoInput: null, seletor: '#criar', rectCss: { x: 100, y: 100, w: 72, h: 26 }, marcadoAntes: null, autocomplete: null, nome: null, id: 'criar' };
const ALVO_NOME = { papel: 'textbox', rotulo: 'Nome', fonteRotulo: 'label', campo: 'Nome', tag: 'input', tipoInput: 'text', seletor: '#nome', rectCss: { x: 100, y: 200, w: 400, h: 28 }, marcadoAntes: null, autocomplete: null, nome: 'nome', id: 'nome' };

let gravacao;   // packages/extensao/sw/gravacao.js
let navegacao;  // packages/extensao/sw/navegacao.js
let core;       // { criarGuia, criarEstadoRedutor, salvarGuia }

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera a fila serial do SW esvaziar (listeners como aoCommitted/aoAbaAtivada não devolvem a promessa). */
const drenar = () => gravacao.enfileirar(() => {});
const iso = (ms) => new Date(ms).toISOString();

before(async () => {
  if (!temCopias) return;
  globalThis.indexedDB = criarIndexedDBFalso();
  globalThis.createImageBitmap = createImageBitmapFalso;
  gravacao = await import('../../packages/extensao/sw/gravacao.js');
  navegacao = await import('../../packages/extensao/sw/navegacao.js');
  const [modelo, redutor, armazenamento] = await Promise.all([
    import('../../packages/extensao/core/modelo.js'),
    import('../../packages/extensao/core/redutor-eventos.js'),
    import('../../packages/extensao/core/armazenamento.js'),
  ]);
  core = { criarGuia: modelo.criarGuia, criarEstadoRedutor: redutor.criarEstadoRedutor, salvarGuia: armazenamento.salvarGuia, carregarGuia: armazenamento.carregarGuia };
});

const teste = (nome, fn) => test(nome, async (t) => { if (!temCopias) return t.skip(MENSAGEM_SKIP); await fn(t); });

/**
 * Gravação já em andamento (sem passar por `iniciar`, que espera 300 ms): guia no IndexedDB falso e estado
 * em chrome.storage.session. `chrome` vira o global. @returns {Promise<{guiaId:string, estado:object}>}
 */
async function prepararGravacao(chrome, { abaId = 1, janelaId = 10, abas = [abaId], url = URL_A, iniciadoEm = 1_700_000_000_000, patch = {} } = {}) {
  globalThis.chrome = chrome;
  const guia = core.criarGuia({ titulo: 'Teste', origem: { tipo: 'extensao', versao: '0.1.0', plataforma: 'Chrome ? / teste' } });
  await core.salvarGuia(guia);
  const estado = {
    guiaId: guia.id, status: 'gravando', abaId, janelaId, abas, contador: 0, iniciadoEm,
    ultimaCaptura: null, ultimoPassoId: null, navegacaoPendente: null, redutor: core.criarEstadoRedutor(url), ...patch,
  };
  await chrome.storage.session.set({ gravacao: estado });
  return { guiaId: guia.id, estado };
}

const lerEstado = () => globalThis.chrome.storage.session.get('gravacao').then((r) => r.gravacao ?? null);
const lerPassos = (guiaId) => core.carregarGuia(guiaId).then((g) => g.passos);

const comum = (em, url = URL_A) => ({ viewport: { ...VIEWPORT_FALSO }, dpr: 1, url, tituloPagina: 'Página', scroll: { x: 0, y: 0 }, em });
const preClique = (em, url = URL_A, alvo = ALVO_BOTAO) => ({ ...comum(em, url), alvo, pontoCss: { x: 110, y: 110 }, botao: 'esquerdo', modificadores: [], digitacaoPendente: null });
const digitacao = (em, confirmadoPor, url = URL_A) => ({ ...comum(em, url), alvo: ALVO_NOME, valor: 'ACME', sensivel: false, motivo: null, confirmadoPor });
const remetente = (chrome, abaId, frameId = 0) => ({ tab: structuredClone(chrome.abas.get(abaId)), frameId, url: chrome.abas.get(abaId).url });

teste('evento de aba em segundo plano: passo com captura faltante «aba não visível» e nenhuma foto (seria de outra aba)', async () => {
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: false, url: URL_A }, { id: 2, windowId: 10, active: true, url: 'https://webmail.exemplo.com/' }] });
  const { guiaId } = await prepararGravacao(chrome);
  const r = await gravacao.processarEvento('DIGITACAO', digitacao(5000, 'tempo'), remetente(chrome, 1));
  assert.equal(r.ok, true);
  const [passo] = await lerPassos(guiaId);
  assert.equal(passo.tipo, 'digitar');
  assert.equal(passo.titulo, 'Digite «ACME» no campo «Nome»');
  assert.equal(passo.captura.faltante, true);
  assert.equal(passo.captura.motivo, gravacao.MOTIVO_ABA_OCULTA);
  assert.equal(passo.captura.fonte, 'confirmacao');
  assert.deepEqual(chrome.chamadas.captureVisibleTab, [], 'captureVisibleTab nunca é chamado para aba não visível');
  const s = await lerEstado();
  assert.equal(s.ultimaCaptura, null);
  assert.equal(s.abaId, 1, 'remetente em segundo plano não vira a aba ativa da gravação');
});

teste('iniciar numa aba em segundo plano grava o passo inicial «navegar» sem foto', async () => {
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: false, url: URL_A, title: 'A' }, { id: 2, windowId: 10, active: true, url: URL_B }] });
  globalThis.chrome = chrome;
  const r = await gravacao.iniciar(1);
  assert.equal(r.ok, true, r.erro ?? '');
  const [passo] = await lerPassos(r.guiaId);
  assert.equal(passo.tipo, 'navegar');
  assert.equal(passo.captura.faltante, true);
  assert.equal(passo.captura.motivo, gravacao.MOTIVO_ABA_OCULTA);
  assert.deepEqual(chrome.chamadas.captureVisibleTab, []);
  await gravacao.finalizarGravacao();
});

teste('evento de outra janela: a foto é da janela do remetente e abaId/janelaId passam a ser os dele', async () => {
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: true, url: URL_A }, { id: 3, windowId: 20, active: true, url: URL_B }] });
  const { guiaId } = await prepararGravacao(chrome, { abaId: 1, janelaId: 10, abas: [1, 3] });
  const r = await gravacao.processarEvento('PRE_CLIQUE', preClique(5000, URL_B), remetente(chrome, 3));
  assert.equal(r.ok, true);
  assert.deepEqual(chrome.chamadas.captureVisibleTab, [20], 'captureVisibleTab recebe a janela do remetente, não s.janelaId');
  const [passo] = await lerPassos(guiaId);
  assert.equal(passo.tipo, 'clicar');
  assert.equal(passo.captura.faltante, false);
  assert.equal(passo.captura.fonte, 'pointerdown');
  assert.equal(passo.contexto.abaId, 3);
  const s = await lerEstado();
  assert.equal(s.abaId, 3);
  assert.equal(s.janelaId, 20);
  assert.equal(s.ultimaCaptura.abaId, 3, 'ultimaCaptura registra a aba');
  assert.equal(s.ultimaCaptura.url, URL_B);
});

teste('reaproveitamento < 500 ms exige a mesma aba: outra aba na mesma URL recebe foto própria', async () => {
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: true, url: URL_A }, { id: 3, windowId: 20, active: true, url: URL_A }] });
  const { guiaId } = await prepararGravacao(chrome, { abaId: 1, janelaId: 10, abas: [1, 3], patch: { ultimaCaptura: { imagemId: 'img_m1x4k9zr02ab', em: 1000, url: URL_A, largura: 1280, altura: 800, abaId: 1 } } });
  await gravacao.processarEvento('PRE_CLIQUE', preClique(1200, URL_A), remetente(chrome, 1));
  await gravacao.processarEvento('PRE_CLIQUE', preClique(1300, URL_A, ALVO_NOME), remetente(chrome, 3)); // outro alvo: não é duplo clique
  const [mesmaAba, outraAba] = await lerPassos(guiaId);
  assert.equal(mesmaAba.captura.fonte, 'compartilhada');
  assert.equal(mesmaAba.captura.imagemId, 'img_m1x4k9zr02ab');
  assert.equal(outraAba.captura.fonte, 'pointerdown');
  assert.notEqual(outraAba.captura.imagemId, 'img_m1x4k9zr02ab');
  assert.deepEqual(chrome.chamadas.captureVisibleTab, [20], 'só a outra aba foi fotografada');
});

teste('digitação confirmada por navegação (pagehide): reaproveita a última foto da mesma aba e URL, senão «página descarregada»', async () => {
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: true, url: URL_B }] });
  const { guiaId } = await prepararGravacao(chrome, { patch: { ultimaCaptura: { imagemId: 'img_m1x4k9zr02ab', em: 1000, url: URL_A, largura: 1280, altura: 800, abaId: 1 } } });
  // muito depois dos 500 ms: a última foto da página que descarregou ainda é a certa
  await gravacao.processarEvento('DIGITACAO', digitacao(9000, 'navegacao', URL_A), remetente(chrome, 1));
  // URL diferente da última foto: fotografar agora pegaria a página seguinte
  await gravacao.processarEvento('DIGITACAO', { ...digitacao(9100, 'navegacao', URL_B), valor: 'Outra' }, remetente(chrome, 1));
  const [reaproveitada, descarregada] = await lerPassos(guiaId);
  assert.equal(reaproveitada.captura.fonte, 'compartilhada');
  assert.equal(reaproveitada.captura.imagemId, 'img_m1x4k9zr02ab');
  assert.equal(descarregada.captura.faltante, true);
  assert.equal(descarregada.captura.motivo, gravacao.MOTIVO_DESCARREGADA);
  assert.deepEqual(chrome.chamadas.captureVisibleTab, [], 'nenhuma foto depois do pagehide');
});

teste('navegação pendente: criadoEm é o instante do onCommitted e a foto sai antes do evento seguinte, que a compartilha', async () => {
  const T = 1_700_000_100_000;
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: true, url: URL_A, status: 'loading' }] });
  const { guiaId } = await prepararGravacao(chrome, { iniciadoEm: T - 10_000 });
  navegacao.aoCommitted({ tabId: 1, frameId: 0, url: URL_B, transitionType: 'typed', timeStamp: T, documentId: 'doc-b' });
  await esperar(200); // ATRASO_COMMITTED
  await drenar();
  assert.deepEqual((await lerEstado()).navegacaoPendente, { abaId: 1, url: URL_B, transicao: 'typed', em: T, documentId: 'doc-b' });
  assert.deepEqual(await lerPassos(guiaId), [], 'a página ainda carrega: nada fotografado');
  // página B interativa antes do `load` (terceiros lentos): o usuário clica
  Object.assign(chrome.abas.get(1), { url: URL_B, documentId: 'doc-b' });
  const r = await gravacao.processarEvento('PRE_CLIQUE', preClique(T + 800, URL_B), remetente(chrome, 1));
  assert.equal(r.ok, true);
  const passos = await lerPassos(guiaId);
  assert.deepEqual(passos.map((p) => p.tipo), ['navegar', 'clicar']);
  const [navegar, clicar] = passos;
  assert.equal(navegar.criadoEm, iso(T), 'criadoEm do navegar = onCommitted, não a hora da foto');
  assert.equal(navegar.evento.transicao, 'typed');
  assert.equal(navegar.captura.faltante, false);
  assert.equal(navegar.captura.fonte, 'navegacao');
  assert.equal(clicar.criadoEm, iso(T + 800));
  assert.equal(clicar.captura.fonte, 'compartilhada');
  assert.equal(clicar.captura.imagemId, navegar.captura.imagemId, 'o clique compartilha a foto da navegação, tirada antes dele');
  assert.deepEqual(chrome.chamadas.captureVisibleTab, [10], 'uma única foto');
  assert.equal((await lerEstado()).navegacaoPendente, null);
});

teste('pendência de um documento já substituído é descartada sem foto; sem documentId vale a URL', async () => {
  const T = 1_700_000_100_000;
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: true, url: URL_C, documentId: 'doc-c' }] });
  const { guiaId } = await prepararGravacao(chrome, { patch: { navegacaoPendente: { abaId: 1, url: URL_B, transicao: 'typed', em: T, documentId: 'doc-b' } } });
  assert.equal(await gravacao.capturarPendente(1), null);
  assert.equal((await lerEstado()).navegacaoPendente, null, 'pendência obsoleta limpa');
  assert.deepEqual(await lerPassos(guiaId), [], 'nenhum «Navegue para B» com a foto de C');
  assert.deepEqual(chrome.chamadas.captureVisibleTab, []);
  // Chrome sem documentId: compara a URL do frame de topo
  await chrome.storage.session.set({ gravacao: { ...(await lerEstado()), navegacaoPendente: { abaId: 1, url: URL_C, transicao: 'typed', em: T, documentId: null } } });
  assert.ok(await gravacao.capturarPendente(1), 'passoId');
  const [navegar] = await lerPassos(guiaId);
  assert.equal(navegar.tipo, 'navegar');
  assert.equal(navegar.evento.url, URL_C);
  assert.equal(navegar.criadoEm, iso(T));
  assert.equal((await lerEstado()).navegacaoPendente, null);
});

teste('navegação atribuída a um gatilho limpa a pendência anterior da aba', async () => {
  const T = 1_700_000_100_000;
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: true, url: URL_A, status: 'loading' }] });
  const { guiaId } = await prepararGravacao(chrome, { iniciadoEm: T - 10_000 });
  await gravacao.processarEvento('PRE_CLIQUE', preClique(T, URL_A), remetente(chrome, 1));
  navegacao.aoCommitted({ tabId: 1, frameId: 0, url: URL_B, transitionType: 'typed', timeStamp: T + 3000, documentId: 'doc-b' });
  await esperar(200);
  await drenar();
  assert.equal((await lerEstado()).navegacaoPendente?.url, URL_B);
  // antes da foto de B o usuário clica num link: a navegação vira resultado.url do clique
  navegacao.aoCommitted({ tabId: 1, frameId: 0, url: URL_C, transitionType: 'link', timeStamp: T + 3100, documentId: 'doc-c' });
  await esperar(200);
  await drenar();
  assert.equal((await lerEstado()).navegacaoPendente, null, 'pendência de B descartada junto com a navegação atribuída');
  const passos = await lerPassos(guiaId);
  assert.deepEqual(passos.map((p) => p.tipo), ['clicar']);
  assert.equal(passos[0].resultado?.url, URL_C);
  assert.equal(await gravacao.capturarPendente(1), null);
  assert.equal(chrome.chamadas.captureVisibleTab.length, 1, 'só a foto do clique');
});

teste('aba em segundo plano: a pendência espera; tabs.onActivated fotografa quando a aba volta a ser visível', async () => {
  const T = 1_700_000_100_000;
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: false, url: URL_B, documentId: 'doc-b' }, { id: 2, windowId: 10, active: true, url: 'https://webmail.exemplo.com/' }] });
  const { guiaId } = await prepararGravacao(chrome, { patch: { navegacaoPendente: { abaId: 1, url: URL_B, transicao: 'typed', em: T, documentId: 'doc-b' } } });
  assert.equal(await gravacao.capturarPendente(1), null);
  assert.equal((await lerEstado()).navegacaoPendente?.url, URL_B, 'continua pendente');
  assert.deepEqual(chrome.chamadas.captureVisibleTab, [], 'a aba visível é o webmail: nada fotografado');
  chrome.abas.get(1).active = true;
  chrome.abas.get(2).active = false;
  navegacao.aoAbaAtivada({ tabId: 1, windowId: 10 });
  await esperar(400); // ATRASO_PINTURA
  await drenar();
  const [navegar] = await lerPassos(guiaId);
  assert.equal(navegar?.tipo, 'navegar');
  assert.equal(navegar.captura.faltante, false);
  assert.equal(navegar.criadoEm, iso(T));
  assert.deepEqual(chrome.chamadas.captureVisibleTab, [10]);
  assert.equal((await lerEstado()).navegacaoPendente, null);
});

teste('windows.onFocusChanged: aba da gravação já ativa na janela focada vira abaId/janelaId', async () => {
  const chrome = criarChromeFalso({ abas: [{ id: 1, windowId: 10, active: true, url: URL_A }, { id: 3, windowId: 20, active: true, url: URL_B }, { id: 5, windowId: 30, active: true, url: 'https://outra.exemplo.com/' }] });
  await prepararGravacao(chrome, { abaId: 3, janelaId: 20, abas: [1, 3] });
  navegacao.aoJanelaFocada(-1); // WINDOW_ID_NONE: o Chrome perdeu o foco
  await drenar();
  assert.deepEqual([(await lerEstado()).abaId, (await lerEstado()).janelaId], [3, 20]);
  navegacao.aoJanelaFocada(30); // janela sem aba da gravação
  await drenar();
  assert.deepEqual([(await lerEstado()).abaId, (await lerEstado()).janelaId], [3, 20]);
  navegacao.aoJanelaFocada(10); // a aba 1 já estava ativa lá: tabs.onActivated não dispara
  await drenar();
  assert.deepEqual([(await lerEstado()).abaId, (await lerEstado()).janelaId], [1, 10]);
});
