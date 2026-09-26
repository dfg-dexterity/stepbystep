// scripts/dev-server.mjs: rewrites da Vercel, /api/hash (Node) e /api/notion (Web) sobre o Notion falso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { iniciarServidor, resolverRedirect, resolverRewrite } from '../../scripts/dev-server.mjs';
import { iniciarNotionFalso } from '../../scripts/notion-falso.mjs';

const RAIZ = new URL('../../', import.meta.url);
let servidor;
let notion;
const url = (caminho) => `http://127.0.0.1:${servidor.porta}${caminho}`;
const existe = (rel) => stat(new URL(rel, RAIZ)).then(() => true, () => false);

before(async () => {
  notion = await iniciarNotionFalso();
  process.env.NOTION_BASE = notion.base;
  servidor = await iniciarServidor({ porta: 0 });
});
after(async () => { delete process.env.NOTION_BASE; await servidor.fechar(); await notion.fechar(); });

test('resolverRedirect reproduz os redirects do vercel.json', () => {
  assert.equal(resolverRedirect('/'), '/editor/');
  assert.equal(resolverRedirect('/editor'), '/editor/');
  assert.equal(resolverRedirect('/editor/'), null);
  assert.equal(resolverRedirect('/editor/app.js'), null);
  assert.equal(resolverRedirect('/core/modelo.js'), null);
});

test('resolverRewrite reproduz o vercel.json', () => {
  assert.equal(resolverRewrite('/editor'), null);   // /editor sem barra é redirect, não rewrite
  assert.equal(resolverRewrite('/editor/'), 'packages/editor/index.html');
  assert.equal(resolverRewrite('/editor/app.js'), 'packages/editor/app.js');
  assert.equal(resolverRewrite('/editor/fontes/Figtree-Regular.woff2'), 'packages/editor/fontes/Figtree-Regular.woff2');
  assert.equal(resolverRewrite('/core/modelo.js'), 'packages/core/modelo.js');
  assert.equal(resolverRewrite('/tests/fixtures/paginas/formulario.html'), 'tests/fixtures/paginas/formulario.html');
  assert.equal(resolverRewrite('/packages/extensao/manifest.json'), 'packages/extensao/manifest.json');
  assert.equal(resolverRewrite('/package.json'), null);
  assert.equal(resolverRewrite('/api/hash'), null);
});

test('/ e /editor (sem barra) redirecionam para /editor/ (não permanente)', async () => {
  for (const caminho of ['/', '/editor']) {
    const r = await fetch(url(caminho), { redirect: 'manual' });
    assert.equal(r.status, 307, caminho);
    assert.equal(r.headers.get('location'), '/editor/', caminho);
  }
});

test('/editor/ aponta para packages/editor/index.html (200 se existir, 404 enquanto não)', async () => {
  const r = await fetch(url('/editor/'));
  if (await existe('packages/editor/index.html')) {
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/html/);
  } else {
    assert.equal(r.status, 404);
  }
});

test('os recursos relativos do index.html do editor resolvem a partir de /editor/', async (t) => {
  if (!(await existe('packages/editor/index.html'))) return t.skip('packages/editor/index.html ainda não existe');
  const html = await readFile(new URL('packages/editor/index.html', RAIZ), 'utf8');
  const relativos = [...html.matchAll(/\b(?:href|src)="([^"#/][^"]*)"/g)].map((m) => m[1]).filter((c) => !c.includes(':'));   // só caminhos relativos (sem esquema)
  assert.ok(relativos.some((c) => c.endsWith('app.js')), 'index.html referencia app.js por caminho relativo');
  for (const rel of relativos) {
    const r = await fetch(new URL(rel, url('/editor/')));   // mesma resolução que o navegador faz com o documento em /editor/
    assert.equal(r.status, 200, `/editor/${rel}`);
  }
});

test('/core/modelo.js é servido como módulo com os bytes do repositório', async () => {
  const r = await fetch(url('/core/modelo.js'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/javascript/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const esperado = await readFile(new URL('packages/core/modelo.js', RAIZ));
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), esperado);
});

test('MIME por extensão e /tests para fixtures', async () => {
  const r = await fetch(url('/tests/fixtures/guia-exemplo/guide.json'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.equal((await r.json()).formato, 'stepbystep/guia');
  const png = await fetch(url('/tests/fixtures/guia-exemplo/imagens/img_m1x4k9zr01aa.png'));
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
});

test('fora dos rewrites e travessia de diretório dão 404', async () => {
  for (const caminho of ['/package.json', '/vercel.json', '/core/../package.json', '/core/%2e%2e/package.json', '/editor/../../etc/passwd', '/scripts/dev-server.mjs', '/nada']) {
    const r = await fetch(url(caminho));
    assert.equal(r.status, 404, caminho);
  }
});

test('/api/hash devolve o SHA-256 do arquivo servido e recusa caminhos fora da allow-list', async () => {
  const r = await fetch(url('/api/hash?path=/core/modelo.js'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const corpo = await r.json();
  const bytes = await readFile(new URL('packages/core/modelo.js', RAIZ));
  assert.equal(corpo.path, '/core/modelo.js');
  assert.equal(corpo.status, 200);
  assert.equal(corpo.bytes, bytes.length);
  assert.equal(corpo.sha256, createHash('sha256').update(bytes).digest('hex'));
  for (const ruim of ['/package.json', '/api/hash.js', '/core/../package.json', '/editor/App.JS', '', '/core/']) {
    const rr = await fetch(url(`/api/hash?path=${encodeURIComponent(ruim)}`));
    assert.equal(rr.status, 400, `path=${ruim}`);
  }
});

test('/api/notion/* atravessa o handler Web até o Notion falso (GET, OPTIONS, multipart)', async () => {
  const cabecalhos = { authorization: 'Bearer ntn_dev', 'notion-version': '2022-06-28', origin: 'http://localhost:8080' };
  let r = await fetch(url('/api/notion/v1/users/me'), { headers: cabecalhos });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  assert.equal((await r.json()).object, 'user');
  assert.equal(notion.registros.at(-1).cabecalhos.authorization, 'Bearer ntn_dev');

  r = await fetch(url('/api/notion/v1/pages'), { method: 'OPTIONS', headers: { origin: 'http://localhost:8080' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, OPTIONS');

  r = await fetch(url('/api/notion/v1/databases'), { method: 'POST', headers: cabecalhos });
  assert.equal(r.status, 403);

  r = await fetch(url('/api/notion/v1/file_uploads'), { method: 'POST', headers: { ...cabecalhos, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'single_part', filename: 'passo-01.png', content_type: 'image/png' }) });
  assert.equal(r.status, 200);
  const upload = await r.json();
  const bytes = new Uint8Array(12_345).map((_, i) => (i * 31) & 0xff);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'passo-01.png');
  r = await fetch(url(`/api/notion/v1/file_uploads/${upload.id}/send`), { method: 'POST', headers: cabecalhos, body: form });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const reg = notion.registros.at(-1);
  assert.equal(reg.arquivo.tamanho, bytes.length);
  assert.equal(reg.arquivo.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(reg.arquivo.nome, 'passo-01.png');
});

test('método não permitido nos estáticos e função inexistente', async () => {
  let r = await fetch(url('/core/modelo.js'), { method: 'POST' });
  assert.equal(r.status, 405);
  r = await fetch(url('/api/inexistente'));
  assert.equal(r.status, 404);
});

test('proxy recusa DELETE e PUT pela allow-list (403 com CORS, igual à produção)', async () => {
  for (const method of ['DELETE', 'PUT']) {
    const r = await fetch(url('/api/notion/v1/pages'), { method });
    assert.equal(r.status, 403, method);
    assert.ok(r.headers.get('access-control-allow-origin'), method);
  }
});
