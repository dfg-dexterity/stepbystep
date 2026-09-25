// Proxy api/notion/[...rota].js chamado como handler Web (Request → Response), com
// NOTION_BASE apontando para o Notion falso (scripts/notion-falso.mjs).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { iniciarNotionFalso, PAGINAS_INICIAIS } from '../../scripts/notion-falso.mjs';
import * as proxy from '../../api/notion/[...rota].js';

const { GET, POST, PATCH, OPTIONS } = proxy;
const handler = GET;

const EDITOR = 'https://stepbystep-dexterity.vercel.app';
const TOKEN = 'ntn_teste_1234567890';
let notion;

before(async () => {
  notion = await iniciarNotionFalso();
  process.env.NOTION_BASE = notion.base;
});
after(async () => { delete process.env.NOTION_BASE; await notion.fechar(); });
beforeEach(() => { notion.registros.length = 0; notion.configurar({ simular429: 0 }); });

const req = (rota, init = {}, origem = EDITOR) => {
  const headers = new Headers(init.headers ?? {});
  if (origem) headers.set('origin', origem);
  return new Request(`http://localhost:8080/api/notion${rota}`, { ...init, headers });
};
const autenticado = (extra = {}) => ({ authorization: `Bearer ${TOKEN}`, 'notion-version': '2022-06-28', ...extra });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('exports nomeados por método apontam para o mesmo handler, sem export default', () => {
  assert.equal(typeof handler, 'function');
  for (const f of [GET, POST, PATCH, OPTIONS]) assert.equal(f, handler);
  // o builder da Vercel desembrulha `default` antes de procurar GET/POST/…: com default, o handler Web viraria (req, res)
  assert.equal(proxy.default, undefined);
});

test('OPTIONS responde 204 com os cabeçalhos de CORS e no-store', async () => {
  const r = await handler(req('/v1/pages', { method: 'OPTIONS' }));
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), EDITOR);
  assert.equal(r.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, OPTIONS');
  assert.equal(r.headers.get('access-control-allow-headers'), 'authorization, notion-version, content-type');
  assert.equal(r.headers.get('access-control-max-age'), '600');
  assert.equal(r.headers.get('vary'), 'origin');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(notion.registros.length, 0, 'preflight não chega ao Notion');
});

test('rota fora da allow-list e método não permitido recebem 403 sem tocar o Notion', async () => {
  for (const [rota, method] of [
    ['/v1/databases', 'POST'], ['/v1/users', 'GET'], ['/v1/pages/abc', 'GET'], ['/v1/blocks/abc/children', 'DELETE'],
    ['/v1/pages', 'DELETE'], ['/v1/file_uploads/abc/send/extra', 'POST'], ['/v1/blocks/../children', 'PATCH'], ['', 'GET'],
  ]) {
    const r = await handler(req(rota, { method, headers: autenticado() }));
    assert.equal(r.status, 403, `${method} ${rota}`);
    assert.equal(r.headers.get('content-type'), 'application/json');
    assert.deepEqual(await r.json(), { erro: 'Rota não permitida' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(notion.registros.length, 0);
});

test('CORS: origem permitida é ecoada; preview da Vercel é aceito; origem estranha recebe a origem padrão', async () => {
  const casos = [
    ['http://localhost:8080', 'http://localhost:8080'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['https://stepbystep-git-main-dexterityit.vercel.app', 'https://stepbystep-git-main-dexterityit.vercel.app'],
    ['https://malicioso.example', EDITOR],
    ['https://stepbystep-dexterity.vercel.app.evil.com', EDITOR],
    [null, EDITOR],
  ];
  for (const [origem, esperado] of casos) {
    const r = await handler(req('/v1/users/me', { method: 'OPTIONS' }, origem));
    assert.equal(r.headers.get('access-control-allow-origin'), esperado, `origin ${origem}`);
  }
});

test('ORIGENS_PERMITIDAS substitui a lista padrão', async () => {
  process.env.ORIGENS_PERMITIDAS = 'https://editor.exemplo.com.br, http://localhost:3000';
  try {
    let r = await handler(req('/v1/users/me', { method: 'OPTIONS' }, 'http://localhost:3000'));
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    r = await handler(req('/v1/users/me', { method: 'OPTIONS' }, 'http://localhost:8080'));
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://editor.exemplo.com.br');
  } finally {
    delete process.env.ORIGENS_PERMITIDAS;
  }
});

test('GET /v1/users/me repassa só authorization, notion-version e content-type', async () => {
  const r = await handler(req('/v1/users/me', { method: 'GET', headers: autenticado({ cookie: 'sessao=abc', 'x-forwarded-for': '10.0.0.1', 'user-agent': 'Teste' }) }));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.equal(r.headers.get('access-control-allow-origin'), EDITOR);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const corpo = await r.json();
  assert.equal(corpo.object, 'user');
  assert.equal(corpo.type, 'bot');
  assert.equal(notion.registros.length, 1);
  const [reg] = notion.registros;
  assert.equal(reg.metodo, 'GET');
  assert.equal(reg.rota, '/v1/users/me');
  assert.equal(reg.cabecalhos.authorization, `Bearer ${TOKEN}`);
  assert.equal(reg.cabecalhos['notion-version'], '2022-06-28');
  // (user-agent aparece no Notion falso porque o fetch do Node põe o seu próprio, não o do cliente)
  for (const proibido of ['cookie', 'x-forwarded-for', 'origin']) {
    assert.ok(!reg.nomesCabecalhos.includes(proibido), `${proibido} não deve chegar ao Notion`);
  }
});

test('erros do Notion (401 sem token, 400 sem versão) passam intactos com o corpo original', async () => {
  let r = await handler(req('/v1/users/me', { method: 'GET' }));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'unauthorized');
  r = await handler(req('/v1/users/me', { method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'missing_version');
});

test('POST JSON é repassado byte a byte (search, pages, blocks)', async () => {
  const busca = { query: 'manu', filter: { property: 'object', value: 'page' }, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 20 };
  let r = await handler(req('/v1/search', { method: 'POST', headers: autenticado({ 'content-type': 'application/json' }), body: JSON.stringify(busca) }));
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.equal(lista.object, 'list');
  assert.equal(lista.results.length, 1);
  assert.equal(lista.results[0].properties.title.title[0].plain_text, 'Manuais');
  assert.deepEqual(notion.registros.at(-1).corpo, busca);
  assert.equal(notion.registros.at(-1).cabecalhos['content-type'], 'application/json');

  const pagina = {
    parent: { page_id: PAGINAS_INICIAIS[0].id }, icon: { type: 'emoji', emoji: '📘' },
    properties: { title: { title: [{ type: 'text', text: { content: 'Guia «teste» com acentuação' } }] } },
    children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Olá' } }] } }],
  };
  r = await handler(req('/v1/pages', { method: 'POST', headers: autenticado({ 'content-type': 'application/json; charset=utf-8' }), body: JSON.stringify(pagina) }));
  assert.equal(r.status, 200);
  const criada = await r.json();
  assert.match(criada.id, /^[0-9a-f-]{36}$/);
  assert.match(criada.url, /^https:\/\/www\.notion\.so\//);
  assert.deepEqual(notion.registros.at(-1).corpo, pagina);   // acentos e «» sobreviveram ao repasse

  r = await handler(req(`/v1/blocks/${criada.id}/children`, { method: 'PATCH', headers: autenticado({ 'content-type': 'application/json' }), body: JSON.stringify({ children: pagina.children }) }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).results.length, 1);
});

test('POST multipart (/send) chega ao Notion com boundary e bytes intactos', async () => {
  let r = await handler(req('/v1/file_uploads', { method: 'POST', headers: autenticado({ 'content-type': 'application/json' }), body: JSON.stringify({ mode: 'single_part', filename: 'passo-02.png', content_type: 'image/png' }) }));
  assert.equal(r.status, 200);
  const upload = await r.json();
  assert.equal(upload.status, 'pending');
  assert.ok(Date.parse(upload.expiry_time) > Date.now());

  const bytes = new Uint8Array(70_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919 + 13) & 0xff;   // inclui todos os valores de byte (0–255)
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'passo-02.png');
  const original = new Request('http://localhost:8080/x', { method: 'POST', body: form });
  const contentType = original.headers.get('content-type');
  assert.match(contentType, /^multipart\/form-data; boundary=/);
  const serializado = new Uint8Array(await original.arrayBuffer());

  r = await handler(new Request(`http://localhost:8080/api/notion/v1/file_uploads/${upload.id}/send`, {
    method: 'POST', headers: { ...autenticado({ 'content-type': contentType }), origin: EDITOR }, body: serializado,
  }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal((await r.json()).status, 'uploaded');
  const reg = notion.registros.at(-1);
  assert.equal(reg.cabecalhos['content-type'], contentType, 'boundary preservado');
  assert.equal(reg.tamanhoMultipart, serializado.length, 'corpo repassado sem alteração de tamanho');
  assert.deepEqual(reg.arquivo, { nome: 'passo-02.png', tipo: 'image/png', tamanho: bytes.length, sha256: sha256(bytes) });
});

test('429 do Notion passa com Retry-After para o cliente poder esperar', async () => {
  notion.configurar({ simular429: 1, retryAfter: 2 });
  let r = await handler(req('/v1/users/me', { method: 'GET', headers: autenticado() }));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '2');
  assert.equal((await r.json()).code, 'rate_limited');
  r = await handler(req('/v1/users/me', { method: 'GET', headers: autenticado() }));
  assert.equal(r.status, 200, 'segunda tentativa passa');
});

test('Notion fora do ar vira 502 em JSON (sem vazar a URL interna)', async () => {
  const anterior = process.env.NOTION_BASE;
  process.env.NOTION_BASE = 'http://127.0.0.1:1';
  try {
    const r = await handler(req('/v1/users/me', { method: 'GET', headers: autenticado() }));
    assert.equal(r.status, 502);
    const corpo = await r.json();
    assert.equal(corpo.erro, 'Não foi possível falar com o Notion');
    assert.equal(r.headers.get('access-control-allow-origin'), EDITOR);
  } finally {
    process.env.NOTION_BASE = anterior;
  }
});
