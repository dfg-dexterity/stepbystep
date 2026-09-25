// scripts/notion-falso.mjs: autenticação, limites da API, simulações (429, upload expirado) e,
// como prova de forma, uma publicação completa do guia-exemplo com o cliente real
// (packages/core/notion-cliente.js) atravessando o proxy api/notion.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { iniciarNotionFalso, PAGINAS_INICIAIS, VERSAO_NOTION } from '../../scripts/notion-falso.mjs';
import { criarClienteNotion } from '../../packages/core/notion-cliente.js';
import { POST as handler } from '../../api/notion.js';

const FIXTURE = new URL('../fixtures/guia-exemplo/', import.meta.url);
const CAB = { authorization: 'Bearer ntn_falso', 'notion-version': VERSAO_NOTION, 'content-type': 'application/json' };
let notion;

before(async () => { notion = await iniciarNotionFalso(); });
after(() => notion.fechar());
beforeEach(() => { notion.registros.length = 0; notion.configurar({ simular429: 0, retryAfter: 1 }); });

const chamar = (rota, init = {}) => fetch(notion.base + rota, init);
const post = (rota, corpo, headers = {}) => chamar(rota, { method: 'POST', headers: { ...CAB, ...headers }, body: JSON.stringify(corpo) });
const paragrafo = (texto) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: texto } }] } });
const pagina = (children, extra = {}) => ({ parent: { page_id: PAGINAS_INICIAIS[0].id }, properties: { title: { title: [{ type: 'text', text: { content: 'Teste' } }] } }, children, ...extra });

async function esperarErro(resposta, status, code, trecho) {
  assert.equal(resposta.status, status);
  const corpo = await resposta.json();
  assert.equal(corpo.object, 'error');
  assert.equal(corpo.status, status);
  assert.equal(corpo.code, code);
  if (trecho) assert.match(corpo.message, trecho);
  return corpo;
}

test('exige Authorization Bearer e Notion-Version 2022-06-28, como o Notion', async () => {
  await esperarErro(await chamar('/v1/users/me'), 401, 'unauthorized');
  await esperarErro(await chamar('/v1/users/me', { headers: { authorization: 'Token abc', 'notion-version': VERSAO_NOTION } }), 401, 'unauthorized');
  await esperarErro(await chamar('/v1/users/me', { headers: { authorization: 'Bearer abc' } }), 400, 'missing_version');
  await esperarErro(await chamar('/v1/users/me', { headers: { authorization: 'Bearer abc', 'notion-version': '2025-09-03' } }), 400, 'invalid_request', /2022-06-28/);
  const ok = await chamar('/v1/users/me', { headers: { authorization: 'Bearer abc', 'notion-version': VERSAO_NOTION } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).bot.workspace_name, 'Dexterity (falso)');
  assert.equal(notion.registros.length, 5);
  assert.deepEqual(notion.registros[4].cabecalhos, { authorization: 'Bearer abc', 'notion-version': VERSAO_NOTION });
});

test('rota desconhecida → 400 invalid_request_url; página-mãe não conectada → 404 object_not_found', async () => {
  await esperarErro(await chamar('/v1/databases', { method: 'POST', headers: CAB, body: '{}' }), 400, 'invalid_request_url');
  await esperarErro(await post('/v1/pages', pagina([], { parent: { page_id: '99999999-9999-4999-8999-999999999999' } })), 404, 'object_not_found', /shared with your integration/);
  await esperarErro(await chamar('/v1/blocks/99999999-9999-4999-8999-999999999999/children', { method: 'PATCH', headers: CAB, body: JSON.stringify({ children: [] }) }), 404, 'object_not_found');
});

test('busca filtra por texto e devolve páginas com a forma real', async () => {
  const r = await post('/v1/search', { query: 'proc', filter: { property: 'object', value: 'page' }, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 20 });
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.equal(lista.object, 'list');
  assert.equal(lista.has_more, false);
  assert.equal(lista.results.length, 1);
  const p = lista.results[0];
  assert.equal(p.object, 'page');
  assert.equal(p.id, PAGINAS_INICIAIS[1].id);
  assert.equal(p.properties.title.type, 'title');
  assert.equal(p.properties.title.title[0].plain_text, 'Processos internos');
  assert.deepEqual(p.icon, { type: 'emoji', emoji: '🗂️' });
  assert.match(p.url, /^https:\/\/www\.notion\.so\/Processos-internos-[0-9a-f]{32}$/);
  assert.match(p.last_edited_time, /^\d{4}-\d{2}-\d{2}T/);
  const todas = await (await post('/v1/search', { query: '' })).json();
  assert.equal(todas.results.length, PAGINAS_INICIAIS.length);
  await esperarErro(await post('/v1/search', { filter: { property: 'object', value: 'user' } }), 400, 'validation_error');
});

test('limites: 100 blocos de topo, 1000 no total, 2000 chars por rich_text, 2 níveis, nulos', async () => {
  const cem = Array.from({ length: 100 }, (_, i) => paragrafo(`p${i}`));
  assert.equal((await post('/v1/pages', pagina(cem))).status, 200);
  await esperarErro(await post('/v1/pages', pagina([...cem, paragrafo('101')])), 400, 'validation_error', /body\.children\.length should be ≤ `100`/);

  const filhos = Array.from({ length: 10 }, (_, i) => paragrafo(`f${i}`));
  const comFilhos = Array.from({ length: 100 }, (_, i) => ({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: `item ${i}` } }], children: filhos } }));
  await esperarErro(await post('/v1/pages', pagina(comFilhos)), 400, 'validation_error', /total number of blocks \(1100\) should be ≤ 1000/);

  assert.equal((await post('/v1/pages', pagina([paragrafo('x'.repeat(2000))]))).status, 200);
  await esperarErro(await post('/v1/pages', pagina([paragrafo('x'.repeat(2001))])), 400, 'validation_error', /rich_text\[0\]\.text\.content\.length should be ≤ `2000`/);

  const nivel3 = { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: 'a' } }], children: [{ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: 'b' } }], children: [paragrafo('c')] } }] } };
  await esperarErro(await post('/v1/pages', pagina([nivel3])), 400, 'validation_error', /nesting/);

  await esperarErro(await post('/v1/pages', pagina([{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'a' } }], color: null } }])), 400, 'validation_error', /should not be null/);
  await esperarErro(await post('/v1/pages', pagina([{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: 'nao-existe' } } }])), 400, 'validation_error', /file upload not found/);
  await esperarErro(await chamar('/v1/pages', { method: 'POST', headers: CAB, body: '{corpo quebrado' }), 400, 'invalid_json');
  await esperarErro(await chamar('/v1/pages', { method: 'POST', headers: { ...CAB, 'content-type': 'text/plain' }, body: '{}' }), 400, 'invalid_request');
});

test('file_uploads: criação, envio multipart (campo "file"), reenvio, campo errado, expiração e id inexistente', async () => {
  const cria = await post('/v1/file_uploads', { mode: 'single_part', filename: 'passo-01.png', content_type: 'image/png' });
  assert.equal(cria.status, 200);
  const u = await cria.json();
  assert.equal(u.object, 'file_upload');
  assert.equal(u.status, 'pending');
  assert.equal(u.upload_url, `${notion.base}/v1/file_uploads/${u.id}/send`);
  assert.ok(Date.parse(u.expiry_time) - Date.now() > 55 * 60 * 1000, 'expira em ~1 h');

  const bytes = await readFile(new URL('imagens/img_m1x4k9zr01aa.png', FIXTURE));
  const errado = new FormData();
  errado.append('arquivo', new Blob([bytes], { type: 'image/png' }), 'passo-01.png');
  await esperarErro(await chamar(`/v1/file_uploads/${u.id}/send`, { method: 'POST', headers: { authorization: CAB.authorization, 'notion-version': VERSAO_NOTION }, body: errado }), 400, 'validation_error', /body\.file/);
  await esperarErro(await chamar(`/v1/file_uploads/${u.id}/send`, { method: 'POST', headers: CAB, body: '{}' }), 400, 'invalid_request', /multipart/);

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'passo-01.png');
  const envio = await chamar(`/v1/file_uploads/${u.id}/send`, { method: 'POST', headers: { authorization: CAB.authorization, 'notion-version': VERSAO_NOTION }, body: form });
  assert.equal(envio.status, 200);
  const enviado = await envio.json();
  assert.equal(enviado.status, 'uploaded');
  assert.equal(enviado.content_length, bytes.length);
  const reg = notion.registros.at(-1);
  assert.ok(reg.tamanhoMultipart > bytes.length, 'registra o tamanho do multipart inteiro');
  assert.equal(reg.arquivo.nome, 'passo-01.png');
  assert.equal(reg.arquivo.tipo, 'image/png');
  await esperarErro(await chamar(`/v1/file_uploads/${u.id}/send`, { method: 'POST', headers: { authorization: CAB.authorization, 'notion-version': VERSAO_NOTION }, body: form }), 400, 'validation_error', /"uploaded"/);

  const imagem = { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: u.id }, caption: [{ type: 'text', text: { content: 'Passo 1' } }] } };
  assert.equal((await post('/v1/pages', pagina([imagem]))).status, 200);

  const expirado = await (await post('/v1/file_uploads', { mode: 'single_part', filename: 'x.png', content_type: 'image/png' }, { 'x-simular-expirado': '1' })).json();
  assert.ok(Date.parse(expirado.expiry_time) < Date.now());
  await esperarErro(await chamar(`/v1/file_uploads/${expirado.id}/send`, { method: 'POST', headers: { authorization: CAB.authorization, 'notion-version': VERSAO_NOTION }, body: form }), 400, 'validation_error', /expired/);
  await esperarErro(await chamar('/v1/file_uploads/99999999-9999-4999-8999-999999999999/send', { method: 'POST', headers: { authorization: CAB.authorization, 'notion-version': VERSAO_NOTION }, body: form }), 404, 'object_not_found');
  await esperarErro(await post('/v1/file_uploads', { mode: 'multi_part', filename: 'x.png', content_type: 'image/png', number_of_parts: 2 }), 400, 'validation_error');
});

test('429 simulado por cabeçalho (N vezes por rota) e por configuração, com Retry-After', async () => {
  const cab = { ...CAB, 'x-simular-429': '2' };
  let r = await chamar('/v1/users/me', { headers: cab });
  await esperarErro(r, 429, 'rate_limited');
  assert.equal(r.headers.get('retry-after'), '1');
  await esperarErro(await chamar('/v1/users/me', { headers: cab }), 429, 'rate_limited');
  assert.equal((await chamar('/v1/users/me', { headers: cab })).status, 200);
  assert.equal((await post('/v1/search', { query: '' }, { 'x-simular-429': '1' })).status, 429, 'contagem é por rota');

  notion.configurar({ simular429: 1, retryAfter: 3 });
  r = await chamar('/v1/users/me', { headers: CAB });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '3');
  assert.equal((await chamar('/v1/users/me', { headers: CAB })).status, 200);
});

test('publicação completa do guia-exemplo com o cliente real, via proxy, com um 429 no caminho', async () => {
  const guia = JSON.parse(await readFile(new URL('guide.json', FIXTURE), 'utf8'));
  process.env.NOTION_BASE = notion.base;
  try {
    notion.configurar({ simular429: 1, retryAfter: 0 });
    const esperas = [];
    const cliente = criarClienteNotion({
      token: 'ntn_falso', base: '/api/notion',
      fetch: (url, init) => handler(new Request(`http://localhost:8080${url}`, { ...init, headers: { ...init.headers, origin: 'http://localhost:8080' } })),
      esperar: async (ms) => { esperas.push(ms); },
    });
    assert.deepEqual(await cliente.validarToken(), { nome: 'StepByStep (falso)' });
    const paginas = await cliente.buscarPaginas('manu');
    assert.equal(paginas.length, 1);
    assert.equal(paginas[0].titulo, 'Manuais');

    const progresso = [];
    const resultado = await cliente.publicarGuia(guia, {
      paiId: paginas[0].id,
      obterImagemAssada: async (p) => new Blob([await readFile(new URL(`imagens/${p.captura.imagemId}.png`, FIXTURE))], { type: 'image/png' }),
      aoProgredir: (p) => progresso.push(p.fase),
      data: new Date('2026-09-24T12:00:00Z'),
    });
    assert.ok(esperas.length >= 1, 'o cliente esperou o Retry-After do 429 simulado');
    assert.ok(resultado.publicacao.concluida);
    const criada = notion.paginas.get(resultado.paginaId);
    assert.equal(criada.titulo, 'Cadastrar fornecedor no SAP Fiori');
    assert.equal(criada.paiId, PAGINAS_INICIAIS[0].id);
    assert.equal(resultado.url, `https://www.notion.so/Cadastrar-fornecedor-no-SAP-Fiori-${resultado.paginaId.replace(/-/g, '')}`);

    const comImagem = guia.passos.filter((p) => p.tipo !== 'secao' && p.captura && !p.captura.faltante && p.captura.imagemId);
    assert.equal(Object.keys(resultado.publicacao.uploads).length, comImagem.length);
    // (o teste anterior deixa um upload expirado de propósito; só os desta publicação interessam)
    assert.ok(Object.values(resultado.publicacao.uploads).every((id) => notion.uploads.get(id)?.status === 'uploaded'));
    const blocos = notion.blocos.get(resultado.paginaId);
    assert.equal(blocos[0].type, 'callout');
    assert.equal(blocos.filter((b) => b.type === 'heading_2').length, 1);
    assert.equal(blocos.filter((b) => b.type === 'numbered_list_item').length, guia.passos.length - 1);
    const imagens = blocos.flatMap((b) => b._filhos).filter((b) => b.type === 'image');
    assert.equal(imagens.length, comImagem.length);
    assert.ok(imagens.every((b) => notion.uploads.get(b.image.file_upload.id)?.status === 'uploaded'));

    const rotas = notion.registros.map((r) => `${r.metodo} ${r.rota.replace(/[0-9a-f-]{36}/g, ':id')}`);
    // o 429 simulado atinge também POST /v1/pages: o cliente repete (429 = não processado), mas só UMA criação vale
    const criacoes = notion.registros.filter((r) => r.metodo === 'POST' && r.rota === '/v1/pages');
    assert.deepEqual(criacoes.map((r) => r.status), [429, 200], 'uma só criação de página efetiva');
    assert.ok(rotas.indexOf('POST /v1/pages') > rotas.lastIndexOf('POST /v1/file_uploads/:id/send'), 'uploads antes da página');
    assert.ok(progresso.includes('upload') && progresso.includes('pagina'));
  } finally {
    delete process.env.NOTION_BASE;
  }
});
