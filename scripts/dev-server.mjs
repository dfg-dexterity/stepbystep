/**
 * Servidor local de desenvolvimento: estáticos com os MESMOS rewrites do vercel.json
 * (/ → /editor/, /editor/* → packages/editor/*, /core/* → packages/core/*), mais
 * /tests/* e /packages/* para os testes, /api/notion/* (handler Web: monta um Request a
 * partir do IncomingMessage e chama o default export) e /api/hash (assinatura Node).
 *
 * Uso: `npm run dev` → http://localhost:8080 (ou PORT). Com NOTION_BASE=http://127.0.0.1:8090
 * o proxy aponta para scripts/notion-falso.mjs. Os e2e importam `iniciarServidor({ porta: 0 })`.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
};
// Cabeçalhos de salto (e os que o fetch recalcula) não entram no Request montado.
const NAO_REPASSAR = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'expect', 'upgrade']);

/** Mesmos rewrites do vercel.json (+ /tests e /packages para os testes). Devolve caminho relativo à raiz ou null. */
export function resolverRewrite(pathname) {
  if (pathname === '/editor' || pathname === '/editor/') return 'packages/editor/index.html';
  if (pathname.startsWith('/editor/')) return 'packages/editor/' + pathname.slice('/editor/'.length);
  if (pathname.startsWith('/core/')) return 'packages/core/' + pathname.slice('/core/'.length);
  if (pathname.startsWith('/tests/') || pathname.startsWith('/packages/')) return pathname.slice(1);
  return null;
}

async function servirEstatico(pathname, res) {
  let decodificado;
  try { decodificado = decodeURIComponent(pathname); } catch { return responderTexto(res, 400, 'caminho inválido'); }
  const relativo = resolverRewrite(decodificado);
  if (!relativo || relativo.split('/').includes('..')) return responderTexto(res, 404, 'not found');
  let caminho = resolve(RAIZ, relativo);
  if (!caminho.startsWith(RAIZ.endsWith(sep) ? RAIZ : RAIZ + sep)) return responderTexto(res, 404, 'not found');
  try {
    let s = await stat(caminho);
    if (s.isDirectory()) { caminho = join(caminho, 'index.html'); s = await stat(caminho); }
    const dados = await readFile(caminho);
    res.writeHead(200, {
      'content-type': MIME[extname(caminho).toLowerCase()] ?? 'application/octet-stream',
      'content-length': dados.length,
      'cache-control': 'no-store',
    });
    res.end(dados);
  } catch {
    responderTexto(res, 404, 'not found');
  }
}

function responderTexto(res, status, texto) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(texto);
}

async function lerCorpo(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes);
}

/** http.IncomingMessage → Request (URL absoluta, método, cabeçalhos, corpo como Buffer). */
async function montarRequest(req, porta) {
  const url = `http://${req.headers.host ?? `127.0.0.1:${porta}`}${req.url}`;
  const headers = new Headers();
  for (const [nome, valor] of Object.entries(req.headers)) {
    if (NAO_REPASSAR.has(nome) || valor == null) continue;
    headers.set(nome, Array.isArray(valor) ? valor.join(', ') : valor);
  }
  const corpo = await lerCorpo(req);
  const temCorpo = req.method !== 'GET' && req.method !== 'HEAD' && corpo.length > 0;
  return new Request(url, { method: req.method, headers, body: temCorpo ? corpo : undefined });
}

/** Response (Web) → http.ServerResponse. */
async function escreverResponse(resposta, res) {
  const cabecalhos = {};
  for (const [nome, valor] of resposta.headers) cabecalhos[nome] = valor;
  const corpo = Buffer.from(await resposta.arrayBuffer());
  delete cabecalhos['content-length'];
  res.writeHead(resposta.status, corpo.length ? { ...cabecalhos, 'content-length': corpo.length } : cabecalhos);
  res.end(corpo);
}

/** Shim mínimo de res da Vercel (assinatura Node) para api/hash.js. */
function shimRes(res) {
  let codigo = 200;
  return {
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { codigo = c; return this; },
    send(corpo) { res.statusCode = codigo; res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo)); },
    json(corpo) { res.statusCode = codigo; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(corpo)); },
  };
}

const importarApi = (...segmentos) => import(pathToFileURL(join(RAIZ, 'api', ...segmentos)).href);

async function tratarApi(req, res, url, porta) {
  if (url.pathname.startsWith('/api/notion/') || url.pathname === '/api/notion') {
    const modulo = await importarApi('notion', '[...rota].js');
    const handler = modulo[req.method?.toUpperCase()];   // exports nomeados por método, como a Vercel despacha
    if (typeof handler !== 'function') return responderTexto(res, 405, 'método não permitido');
    const resposta = await handler(await montarRequest(req, porta));
    return escreverResponse(resposta, res);
  }
  if (url.pathname === '/api/hash') {
    const { default: handler } = await importarApi('hash.js');
    const query = Object.fromEntries(url.searchParams.entries());
    // hash.js busca o arquivo no próprio host; localmente é http, não https
    const headers = { ...req.headers, 'x-forwarded-proto': 'http', 'x-forwarded-host': req.headers.host ?? `127.0.0.1:${porta}` };
    return handler({ query, method: req.method, headers }, shimRes(res));
  }
  responderTexto(res, 404, 'função não encontrada');
}

/**
 * Sobe o servidor. `porta: 0` escolhe uma porta livre (uso dos e2e).
 * @param {{porta?:number}} [opcoes] @returns {Promise<{porta:number, fechar:()=>Promise<void>}>}
 */
export function iniciarServidor({ porta = Number(process.env.PORT ?? 8080) } = {}) {
  const servidor = http.createServer(async (req, res) => {
    const portaReal = servidor.address().port;
    const url = new URL(req.url, `http://127.0.0.1:${portaReal}`);
    try {
      if (url.pathname === '/') {
        res.writeHead(307, { location: '/editor/', 'cache-control': 'no-store' });   // redirect não permanente, como na Vercel
        return res.end();
      }
      if (url.pathname.startsWith('/api/')) return await tratarApi(req, res, url, portaReal);
      if (req.method !== 'GET' && req.method !== 'HEAD') return responderTexto(res, 405, 'método não permitido');
      if (url.pathname === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); }   // páginas de fixture sem ícone: sem 404 no console
      await servirEstatico(url.pathname, res);
    } catch (e) {
      if (!res.headersSent) responderTexto(res, 500, `erro interno: ${e.message}`);
      else res.end();
    }
  });
  return new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(porta, '127.0.0.1', () => {
      resolver({
        porta: servidor.address().port,
        fechar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); }),
      });
    });
  });
}

const ehPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehPrincipal) {
  const { porta } = await iniciarServidor();
  console.log(`StepByStep em http://localhost:${porta}/editor/` + (process.env.NOTION_BASE ? ` (Notion: ${process.env.NOTION_BASE})` : ''));
}
