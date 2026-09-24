import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSAO_NOTION, ROTAS_PERMITIDAS, LIMITE_UPLOAD_PROXY, LIMITE_UPLOAD_DIRETO, URL_EDITOR,
  criarClienteNotion, traduzirErroNotion, ErroNotion,
} from '../../packages/core/notion-cliente.js';
import { criarGuia, criarPasso } from '../../packages/core/modelo.js';
import { lerFixture } from './util.mjs';

const json = (corpo, status = 200, headers = {}) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...headers } });

/** fetch falso: registra cada chamada e responde pela rota (ou por uma fila de respostas). */
function fetchFalso(respostas = {}) {
  const chamadas = [];
  let contadorUpload = 0;
  const f = async (url, init = {}) => {
    const u = new URL(url, 'http://local');
    const rota = u.pathname.replace(/^\/api\/notion/, '');
    const registro = { url: String(url), rota, metodo: init.method, headers: { ...init.headers }, body: init.body };
    chamadas.push(registro);
    if (init.body instanceof FormData) {
      // serializa o multipart como o navegador faria, para inspecionar filename e boundary
      const req = new Request('http://local/x', { method: 'POST', body: init.body });
      registro.contentType = req.headers.get('content-type');
      registro.multipart = await req.text();
    } else if (typeof init.body === 'string') registro.json = JSON.parse(init.body);
    const fila = respostas[rota];
    if (Array.isArray(fila) && fila.length) return typeof fila[0] === 'function' ? fila.shift()(registro) : fila.shift();
    if (typeof fila === 'function') return fila(registro);
    if (rota === '/v1/users/me') return json({ object: 'user', type: 'bot', name: 'StepByStep Bot', bot: { workspace_name: 'Dexterity' } });
    if (rota === '/v1/search') return json({ results: [] });
    if (rota === '/v1/file_uploads') return json({ id: `up-${++contadorUpload}`, upload_url: `https://api.notion.com/v1/file_uploads/up-${contadorUpload}/send`, status: 'pending', expiry_time: '2026-09-24T15:00:00.000Z' });
    if (/^\/v1\/file_uploads\/[^/]+\/send$/.test(rota)) return json({ status: 'uploaded' });
    if (rota === '/v1/pages') return json({ id: 'pagina-1', url: 'https://www.notion.so/pagina-1' });
    if (/^\/v1\/blocks\/[^/]+\/children$/.test(rota)) return json({ results: [] });
    return json({ code: 'object_not_found', message: 'rota desconhecida' }, 404);
  };
  f.chamadas = chamadas;
  return f;
}

const esperas = [];
const esperar = async (ms) => { esperas.push(ms); };
const cliente = (f, extra = {}) => criarClienteNotion({ token: 'ntn_abc', base: 'https://api.notion.com', fetch: f, esperar, ...extra });
const blobPng = (tamanho = 1000) => new Blob([new Uint8Array(tamanho)], { type: 'image/png' });

test('constantes', () => {
  assert.equal(VERSAO_NOTION, '2022-06-28');
  assert.equal(LIMITE_UPLOAD_PROXY, 4 * 1024 * 1024);
  assert.equal(LIMITE_UPLOAD_DIRETO, 20 * 1024 * 1024);
  assert.equal(URL_EDITOR, 'https://stepbystep-dexterity.vercel.app');
  for (const r of ['/v1/users/me', '/v1/search', '/v1/pages', '/v1/blocks/abc-123/children', '/v1/file_uploads', '/v1/file_uploads/abc-123/send']) assert.ok(ROTAS_PERMITIDAS.test(r), r);
  for (const r of ['/v1/users', '/v1/databases', '/v1/pages/abc', '/v1/blocks/abc/children/x', '/v1/file_uploads/abc', '/v2/search']) assert.ok(!ROTAS_PERMITIDAS.test(r), r);
  assert.throws(() => criarClienteNotion({ token: 'x', base: 'y' }), /fetch/);
});

test('validarToken: GET /v1/users/me com os cabeçalhos certos', async () => {
  const f = fetchFalso();
  const r = await cliente(f).validarToken();
  assert.deepEqual(r, { nome: 'StepByStep Bot' });
  assert.equal(f.chamadas.length, 1);
  assert.equal(f.chamadas[0].url, 'https://api.notion.com/v1/users/me');
  assert.equal(f.chamadas[0].metodo, 'GET');
  assert.deepEqual(f.chamadas[0].headers, { authorization: 'Bearer ntn_abc', 'notion-version': '2022-06-28' });
  assert.equal(f.chamadas[0].body, undefined);
});

test('buscarPaginas: POST /v1/search com filtro de página e resumo dos resultados', async () => {
  const f = fetchFalso({ '/v1/search': () => json({ results: [
    { object: 'page', id: 'p1', icon: { type: 'emoji', emoji: '📘' }, last_edited_time: '2026-09-20T10:00:00.000Z', properties: { title: { type: 'title', title: [{ plain_text: 'Manuais ' }, { plain_text: 'TI' }] } } },
    { object: 'page', id: 'p2', icon: null, last_edited_time: '2026-09-19T10:00:00.000Z', properties: { Nome: { type: 'title', title: [] } } },
    { object: 'page', id: 'p3', icon: { type: 'external', external: { url: 'https://x/y.png' } }, last_edited_time: null, properties: {} },
    { object: 'database', id: 'd1' },
  ] }) });
  const r = await cliente(f).buscarPaginas('Manuais');
  assert.deepEqual(r, [
    { id: 'p1', titulo: 'Manuais TI', icone: '📘', editadoEm: '2026-09-20T10:00:00.000Z' },
    { id: 'p2', titulo: 'Sem título', icone: null, editadoEm: '2026-09-19T10:00:00.000Z' },
    { id: 'p3', titulo: 'Sem título', icone: 'https://x/y.png', editadoEm: null },
  ]);
  assert.deepEqual(f.chamadas[0].json, { query: 'Manuais', filter: { property: 'object', value: 'page' }, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 20 });
  assert.equal(f.chamadas[0].headers['content-type'], 'application/json');
});

test('publicarGuia: sequência users/me → file_uploads → send multipart → pages → blocks/children', async () => {
  const f = fetchFalso();
  const guia = lerFixture('guia-exemplo');
  const progresso = [];
  const c = cliente(f);
  await c.validarToken();
  const r = await c.publicarGuia(guia, {
    paiId: 'pai-1',
    obterImagemAssada: async (p) => (p.captura?.imagemId ? blobPng(500) : null),
    aoProgredir: (p) => progresso.push({ fase: p.fase, atual: p.atual, total: p.total }),
    data: new Date('2026-09-24T12:00:00Z'),
  });
  assert.equal(r.paginaId, 'pagina-1');
  assert.equal(r.url, 'https://www.notion.so/pagina-1');
  const rotas = f.chamadas.map((c) => `${c.metodo} ${c.rota}`);
  assert.equal(rotas[0], 'GET /v1/users/me');
  // 8 passos com imagem → 8 pares upload/send, depois a página (um só lote: 12 blocos)
  assert.deepEqual(rotas.slice(1, 17), Array.from({ length: 8 }, (_, i) => [`POST /v1/file_uploads`, `POST /v1/file_uploads/up-${i + 1}/send`]).flat());
  assert.deepEqual(rotas.slice(17), ['POST /v1/pages']);
  // upload
  assert.deepEqual(f.chamadas[1].json, { mode: 'single_part', filename: 'passo-01.png', content_type: 'image/png' });
  assert.deepEqual(f.chamadas[3].json.filename, 'passo-02.png');
  assert.deepEqual(f.chamadas[15].json.filename, 'passo-08.png');
  const envio = f.chamadas[2];
  assert.ok(envio.body instanceof FormData);
  assert.equal(envio.headers['content-type'], undefined, 'sem Content-Type manual no multipart');
  assert.match(envio.contentType, /^multipart\/form-data; boundary=/);
  assert.match(envio.multipart, /name="file"; filename="passo-01\.png"/);
  assert.match(envio.multipart, /Content-Type: image\/png/);
  // página
  const pagina = f.chamadas.at(-1).json;
  assert.deepEqual(pagina.parent, { page_id: 'pai-1' });
  assert.deepEqual(pagina.icon, { type: 'emoji', emoji: '📘' });
  assert.deepEqual(pagina.properties, { title: { title: [{ type: 'text', text: { content: 'Cadastrar fornecedor no SAP Fiori' } } ] } });
  assert.equal(pagina.children.length, 12);
  assert.equal(pagina.children[0].type, 'callout');
  assert.equal(pagina.children[0].callout.rich_text[0].text.content, 'Manual gerado com StepByStep · Dexterity IT Solutions · 10 passos · 24/09/2026');
  assert.equal(pagina.children[3].numbered_list_item.children[0].image.file_upload.id, 'up-2');
  assert.equal(pagina.children[10].numbered_list_item.children[0].image.file_upload.id, 'up-8');
  // publicação registrada
  assert.equal(r.publicacao.destino, 'notion');
  assert.equal(r.publicacao.concluida, true);
  assert.equal(r.publicacao.lotesEnviados, 1);
  assert.equal(Object.keys(r.publicacao.uploads).length, 8);
  assert.equal(r.publicacao.uploads['p_m1x4k9zr02ab'], 'up-2');
  assert.ok(!Number.isNaN(Date.parse(r.publicacao.em)));
  // progresso
  assert.deepEqual(progresso.slice(0, 2), [{ fase: 'upload', atual: 1, total: 8 }, { fase: 'upload', atual: 2, total: 8 }]);
  assert.deepEqual(progresso.at(-1), { fase: 'pagina', atual: 1, total: 1 });
});

test('429 respeita Retry-After e depois 1s·2ⁿ; desiste após 5 tentativas', async () => {
  esperas.length = 0;
  const f = fetchFalso({ '/v1/users/me': [json({ code: 'rate_limited' }, 429, { 'retry-after': '2' }), json({ code: 'rate_limited' }, 429), json({ name: 'ok' })] });
  const r = await cliente(f).validarToken();
  assert.equal(r.nome, 'ok');
  assert.equal(f.chamadas.length, 3);
  assert.deepEqual(esperas, [2000, 2000]);   // Retry-After 2 s; sem cabeçalho → 1s·2¹
  esperas.length = 0;
  const f2 = fetchFalso({ '/v1/users/me': Array(6).fill(null).map(() => json({ code: 'rate_limited' }, 429)) });
  await assert.rejects(cliente(f2).validarToken(), (e) => e instanceof ErroNotion && e.status === 429 && /Limite de requisições/.test(e.message));
  assert.equal(f2.chamadas.length, 6);
  assert.deepEqual(esperas, [1000, 2000, 4000, 8000, 16000]);
});

test('5xx/409 tenta 3×; POST /v1/pages nunca é repetido às cegas', async () => {
  const f = fetchFalso({ '/v1/search': [json({}, 502), json({}, 409), json({ results: [] })] });
  assert.deepEqual(await cliente(f).buscarPaginas(''), []);
  assert.equal(f.chamadas.length, 3);
  const f2 = fetchFalso({ '/v1/search': Array(4).fill(null).map(() => json({}, 503)) });
  await assert.rejects(cliente(f2).buscarPaginas(''), /indisponível no momento \(erro 503\)/);
  assert.equal(f2.chamadas.length, 4);
  const f3 = fetchFalso({ '/v1/pages': [json({}, 500), json({ id: 'x' })] });
  await assert.rejects(cliente(f3).criarPagina('pai', 'T', []), /erro 500/);
  assert.equal(f3.chamadas.length, 1);
});

test('erros 401/404/400 traduzidos e expostos em ErroNotion', async () => {
  const f = fetchFalso({ '/v1/users/me': [json({ code: 'unauthorized', message: 'API token is invalid.' }, 401)] });
  await assert.rejects(cliente(f).validarToken(), (e) => {
    assert.ok(e instanceof ErroNotion);
    assert.equal(e.status, 401);
    assert.deepEqual(e.corpo, { code: 'unauthorized', message: 'API token is invalid.' });
    assert.match(e.message, /Token inválido ou expirado/);
    return true;
  });
  const f2 = fetchFalso({ '/v1/pages': [json({ code: 'object_not_found', message: 'Could not find page' }, 404)] });
  await assert.rejects(cliente(f2).criarPagina('pai', 'T', []), /conectada à integração/);
  const f3 = fetchFalso({ '/v1/pages': [json({ code: 'validation_error', message: 'body.children[0] should be defined' }, 400)] });
  await assert.rejects(cliente(f3).criarPagina('pai', 'T', []), /recusou os dados enviados: body\.children\[0\] should be defined/);
  assert.match(traduzirErroNotion(413, null), /grande demais/);
  assert.match(traduzirErroNotion(403, {}), /permissão/);
  assert.match(traduzirErroNotion(418, 'bule'), /Erro 418 do Notion: bule/);
  assert.match(traduzirErroNotion(404, 'texto'), /Página não encontrada/);
});

test('base /api/notion: URL relativa e limite de upload do proxy (4 MB) com redução automática', async () => {
  const f = fetchFalso();
  const chamadasReduzir = [];
  const reduzirFalso = async (blob, o) => { chamadasReduzir.push(o); return new Blob([new Uint8Array(o.larguraMax === 1400 ? 1000 : 5 * 1024 * 1024)], { type: o.tipo }); };
  const c = criarClienteNotion({ token: 't', base: '/api/notion', fetch: f, esperar, versao: '2022-06-28' });
  await c.validarToken();
  assert.equal(f.chamadas[0].url, '/api/notion/v1/users/me');
  const guia = criarGuia({ titulo: 'G' });
  guia.passos.push(criarPasso({ tipo: 'clicar', titulo: 'Clique em «X»', captura: { imagemId: 'img_m1x4k9zr01aa', largura: 1, altura: 1, faltante: false } }));
  const r = await c.publicarGuia(guia, { paiId: 'pai', obterImagemAssada: async () => blobPng(5 * 1024 * 1024), reduzirImagem: reduzirFalso });
  assert.deepEqual(chamadasReduzir, [
    { larguraMax: 2000, tipo: 'image/png' },
    { larguraMax: 2000, tipo: 'image/webp', qualidade: 0.9 },
    { larguraMax: 1400, tipo: 'image/webp', qualidade: 0.9 },
  ]);
  const upload = f.chamadas.find((x) => x.rota === '/v1/file_uploads');
  assert.deepEqual(upload.json, { mode: 'single_part', filename: 'passo-01.webp', content_type: 'image/webp' });
  assert.equal(r.publicacao.concluida, true);
  // sem conseguir reduzir: erro claro com a publicação anexada
  const f2 = fetchFalso();
  const c2 = criarClienteNotion({ token: 't', base: '/api/notion', fetch: f2, esperar });
  await assert.rejects(c2.publicarGuia(guia, { paiId: 'pai', obterImagemAssada: async () => blobPng(5 * 1024 * 1024), reduzirImagem: async (b) => b }), (e) => {
    assert.match(e.message, /excede o limite de 4,0 MB/);
    assert.equal(e.publicacao.paginaId, null);
    return true;
  });
  assert.equal(f2.chamadas.length, 0);
  // direto (api.notion.com): 5 MB passa sem reduzir
  const f3 = fetchFalso();
  await cliente(f3).publicarGuia(guia, { paiId: 'pai', obterImagemAssada: async () => blobPng(5 * 1024 * 1024), reduzirImagem: async () => { throw new Error('não deveria reduzir'); } });
  assert.equal(f3.chamadas[0].json.filename, 'passo-01.png');
  // limiteUpload explícito manda
  const f4 = fetchFalso();
  await assert.rejects(cliente(f4).publicarGuia(guia, { paiId: 'pai', limiteUpload: 100, obterImagemAssada: async () => blobPng(200), reduzirImagem: async (b) => b }), /excede o limite/);
});

test('retomada: reaproveita paginaId e uploads recentes, sem novo POST /v1/pages', async () => {
  const guia = criarGuia({ titulo: 'Grande' });
  for (let i = 0; i < 120; i++) guia.passos.push(criarPasso({ tipo: 'manual', titulo: `Passo ${i + 1}`, tituloAuto: false }));
  guia.passos[0].captura = { imagemId: 'img_m1x4k9zr01aa', largura: 1, altura: 1, faltante: false };
  guia.passos[110].captura = { imagemId: 'img_m1x4k9zr02ab', largura: 1, altura: 1, faltante: false };
  // primeira tentativa: o PATCH do segundo lote falha
  const f = fetchFalso({ '/v1/blocks/pagina-1/children': [json({}, 500), json({}, 500), json({}, 500), json({}, 500)] });
  const obter = async () => blobPng(10);
  let falha;
  await cliente(f).publicarGuia(guia, { paiId: 'pai', obterImagemAssada: obter }).catch((e) => { falha = e; });
  assert.ok(falha instanceof ErroNotion);
  const parcial = falha.publicacao;
  assert.equal(parcial.paginaId, 'pagina-1');
  assert.equal(parcial.lotesEnviados, 1);
  assert.equal(parcial.concluida, false);
  assert.deepEqual(Object.values(parcial.uploads), ['up-1', 'up-2']);
  const rotas1 = f.chamadas.map((c) => `${c.metodo} ${c.rota}`);
  assert.equal(rotas1.filter((r) => r === 'POST /v1/pages').length, 1);
  assert.equal(f.chamadas.find((c) => c.rota === '/v1/pages').json.children.length, 100);
  // retomada
  const f2 = fetchFalso();
  const progresso = [];
  const r = await cliente(f2).publicarGuia(guia, { paiId: 'pai', obterImagemAssada: async () => { throw new Error('não deveria assar de novo'); }, publicacaoAnterior: parcial, aoProgredir: (p) => progresso.push(p.fase) });
  const rotas2 = f2.chamadas.map((c) => `${c.metodo} ${c.rota}`);
  assert.deepEqual(rotas2, ['PATCH /v1/blocks/pagina-1/children']);
  assert.equal(f2.chamadas[0].json.children.length, 21);
  assert.equal(f2.chamadas[0].json.children.at(-10).numbered_list_item.children[0].image.file_upload.id, 'up-2');
  assert.equal(r.paginaId, 'pagina-1');
  assert.equal(r.publicacao.concluida, true);
  assert.equal(r.publicacao.lotesEnviados, 2);
  assert.deepEqual(progresso, ['blocos']);
  // uploads antigos (> 50 min) são refeitos, mas a página é mantida
  const velha = { ...parcial, em: new Date(Date.now() - 55 * 60 * 1000).toISOString() };
  const f3 = fetchFalso();
  await cliente(f3).publicarGuia(guia, { paiId: 'pai', obterImagemAssada: obter, publicacaoAnterior: velha });
  const rotas3 = f3.chamadas.map((c) => `${c.metodo} ${c.rota}`);
  assert.deepEqual(rotas3, ['POST /v1/file_uploads', 'POST /v1/file_uploads/up-1/send', 'PATCH /v1/blocks/pagina-1/children']);
  // publicação concluída não é retomada: cria página nova
  const f4 = fetchFalso();
  await cliente(f4).publicarGuia(guia, { paiId: 'pai', obterImagemAssada: obter, publicacaoAnterior: { ...parcial, concluida: true } });
  assert.ok(f4.chamadas.some((c) => c.rota === '/v1/pages'));
});

test('janelas de 30 uploads seguidas de criação/anexo', async () => {
  const guia = criarGuia({ titulo: 'Muitas imagens' });
  for (let i = 0; i < 35; i++) guia.passos.push(criarPasso({ tipo: 'clicar', titulo: `Clique em «${i + 1}»`, captura: { imagemId: 'img_m1x4k9zr01aa', largura: 1, altura: 1, faltante: false } }));
  const f = fetchFalso();
  const r = await cliente(f).publicarGuia(guia, { paiId: 'pai', obterImagemAssada: async () => blobPng(10) });
  const rotas = f.chamadas.map((c) => `${c.metodo} ${c.rota}`);
  const iPagina = rotas.indexOf('POST /v1/pages');
  assert.equal(rotas.slice(0, iPagina).filter((x) => x === 'POST /v1/file_uploads').length, 30);
  const iPatch = rotas.indexOf('PATCH /v1/blocks/pagina-1/children');
  assert.equal(rotas.slice(iPagina + 1, iPatch).filter((x) => x === 'POST /v1/file_uploads').length, 5);
  assert.equal(rotas.length, 35 * 2 + 2);
  assert.equal(f.chamadas[iPagina].json.children.length, 31);   // callout + 30
  assert.equal(f.chamadas[iPatch].json.children.length, 5);
  assert.equal(r.publicacao.lotesEnviados, 2);
});

test('guia sem passos cria a página só com o callout', async () => {
  const f = fetchFalso();
  const r = await cliente(f).publicarGuia(criarGuia({ titulo: 'Vazio' }), { paiId: 'pai', obterImagemAssada: async () => null });
  assert.deepEqual(f.chamadas.map((c) => c.rota), ['/v1/pages']);
  assert.equal(f.chamadas[0].json.children.length, 1);
  assert.equal(r.publicacao.concluida, true);
});
