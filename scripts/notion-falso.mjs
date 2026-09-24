/**
 * Servidor Notion falso (node:http) para os testes de API e os e2e.
 *
 * Implementa as rotas que o StepByStep usa (seção 8.2 da especificação) com a forma real
 * das respostas (ids uuid, url https://www.notion.so/..., expiry_time), exige
 * `Authorization: Bearer` e `Notion-Version: 2022-06-28`, valida limites (≤ 100 blocos de
 * topo, ≤ 1000 no total, rich_text ≤ 2000 chars, 2 níveis), lê o multipart do /send com
 * `new Request(...).formData()` e registra toda requisição em `registros[]`.
 *
 * Simulações: 429 com Retry-After quando vier o cabeçalho `x-simular-429: N` (N vezes para
 * aquela rota) ou por configuração (`iniciarNotionFalso({ simular429: N })` /
 * `configurar({ simular429: N })`); upload expirado com `x-simular-expirado` no
 * POST /v1/file_uploads (ou `validadeUploadMs` na configuração).
 *
 * Standalone: `node scripts/notion-falso.mjs` (PORT, padrão 8090).
 */
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSAO_NOTION = '2022-06-28';
export const LIMITE_SINGLE_PART = 20 * 1024 * 1024;

// Páginas "conectadas à integração" — ids fixos para os testes poderem escolher a página-mãe.
export const PAGINAS_INICIAIS = [
  { id: '11111111-1111-4111-8111-111111111111', titulo: 'Manuais', icone: '📚' },
  { id: '22222222-2222-4222-8222-222222222222', titulo: 'Processos internos', icone: '🗂️' },
  { id: '33333333-3333-4333-8333-333333333333', titulo: 'Rascunhos', icone: null },
];

const CABECALHOS_REGISTRADOS = ['authorization', 'notion-version', 'content-type'];
const slug = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Sem-titulo';
const urlDaPagina = (titulo, id) => `https://www.notion.so/${slug(titulo)}-${id.replace(/-/g, '')}`;
const agoraIso = () => new Date().toISOString();

class ErroApi extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const validacao = (msg) => new ErroApi(400, 'validation_error', msg);

function textoRico(conteudo) {
  return [{
    type: 'text', text: { content: conteudo, link: null },
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    plain_text: conteudo, href: null,
  }];
}

function objetoPagina(p) {
  return {
    object: 'page', id: p.id, created_time: p.criadoEm, last_edited_time: p.editadoEm,
    icon: p.icone ? { type: 'emoji', emoji: p.icone } : null, cover: null,
    parent: p.paiId ? { type: 'page_id', page_id: p.paiId } : { type: 'workspace', workspace: true },
    archived: false, in_trash: false,
    properties: { title: { id: 'title', type: 'title', title: textoRico(p.titulo) } },
    url: urlDaPagina(p.titulo, p.id), public_url: null,
  };
}

function objetoUpload(u) {
  return {
    object: 'file_upload', id: u.id, created_time: u.criadoEm, last_edited_time: u.editadoEm,
    expiry_time: u.expiraEm, upload_url: u.status === 'pending' ? u.uploadUrl : null,
    archived: false, status: u.status, filename: u.filename, content_type: u.contentType, content_length: u.tamanho,
  };
}

/** Valida uma lista de blocos como o Notion (limites de 8.3). Devolve o total de blocos contados. */
function validarBlocos(lista, caminho, nivel, uploads) {
  if (!Array.isArray(lista)) throw validacao(`${caminho} should be an array, instead was ${JSON.stringify(lista)}.`);
  if (nivel === 0 && lista.length > 100) throw validacao(`${caminho}.length should be ≤ \`100\`, instead was \`${lista.length}\`.`);
  if (nivel > 1) throw validacao(`${caminho} nesting is too deep: only two levels of nested blocks are allowed per request.`);
  let total = 0;
  lista.forEach((bloco, i) => {
    const c = `${caminho}[${i}]`;
    if (!bloco || typeof bloco !== 'object') throw validacao(`${c} should be an object.`);
    if (bloco.object !== undefined && bloco.object !== 'block') throw validacao(`${c}.object should be "block".`);
    if (typeof bloco.type !== 'string') throw validacao(`${c}.type should be defined.`);
    const dados = bloco[bloco.type];
    if (!dados || typeof dados !== 'object') throw validacao(`${c}.${bloco.type} should be defined.`);
    for (const chave of ['rich_text', 'caption']) {
      if (dados[chave] === undefined) continue;
      if (!Array.isArray(dados[chave])) throw validacao(`${c}.${bloco.type}.${chave} should be an array.`);
      if (dados[chave].length > 100) throw validacao(`${c}.${bloco.type}.${chave}.length should be ≤ \`100\`.`);
      dados[chave].forEach((t, j) => {
        const conteudo = t?.text?.content;
        if (typeof conteudo !== 'string') throw validacao(`${c}.${bloco.type}.${chave}[${j}].text.content should be a string.`);
        if (conteudo.length > 2000) throw validacao(`${c}.${bloco.type}.${chave}[${j}].text.content.length should be ≤ \`2000\`, instead was \`${conteudo.length}\`.`);
      });
    }
    for (const [chave, valor] of Object.entries(dados)) {
      if (valor === null) throw validacao(`${c}.${bloco.type}.${chave} should not be null.`);
    }
    if (bloco.type === 'image') {
      if (dados.type !== 'file_upload' && dados.type !== 'external') throw validacao(`${c}.image.type should be "file_upload" or "external".`);
      if (dados.type === 'file_upload') {
        const u = uploads.get(dados.file_upload?.id);
        if (!u) throw validacao(`${c}.image.file_upload.id: file upload not found.`);
        if (u.status !== 'uploaded') throw validacao(`${c}.image.file_upload.id: file upload with status "${u.status}" cannot be attached.`);
      }
    }
    total += 1;
    if (dados.children !== undefined) total += validarBlocos(dados.children, `${c}.${bloco.type}.children`, nivel + 1, uploads);
  });
  return total;
}

function objetosDeBlocos(lista, paiId) {
  return lista.map((bloco) => {
    const id = randomUUID();
    const dados = { ...bloco[bloco.type] };
    const filhos = Array.isArray(dados.children) ? objetosDeBlocos(dados.children, id) : [];
    delete dados.children;
    return {
      object: 'block', id, parent: { type: 'block_id', block_id: paiId }, created_time: agoraIso(), last_edited_time: agoraIso(),
      has_children: filhos.length > 0, archived: false, type: bloco.type, [bloco.type]: dados, _filhos: filhos,
    };
  });
}

const semInternos = (b) => ({ ...b, _filhos: undefined });

/**
 * @param {{porta?:number, simular429?:number, retryAfter?:number, validadeUploadMs?:number}} [opcoes]
 * @returns {Promise<{porta:number, base:string, registros:object[], paginas:Map, uploads:Map, blocos:Map, configurar:Function, fechar:()=>Promise<void>}>}
 */
export function iniciarNotionFalso(opcoes = {}) {
  const config = { simular429: 0, retryAfter: 1, validadeUploadMs: 60 * 60 * 1000, ...opcoes };
  const registros = [];
  const paginas = new Map(PAGINAS_INICIAIS.map((p) => [p.id, { ...p, paiId: null, criadoEm: '2026-09-01T12:00:00.000Z', editadoEm: '2026-09-20T09:30:00.000Z' }]));
  const uploads = new Map();
  const blocos = new Map();          // paginaId → blocos anexados (na ordem)
  const contagem429 = new Map();     // "MÉTODO rota" → quantos 429 já devolvidos
  let base = '';

  function deve429(metodo, rota, headers) {
    const chave = `${metodo} ${rota}`;
    const doCabecalho = headers['x-simular-429'] !== undefined ? Number(headers['x-simular-429'] || 1) : 0;
    const limite = Math.max(doCabecalho, config.simular429 || 0);
    if (!limite) return false;
    const feitos = contagem429.get(chave) ?? 0;
    if (feitos >= limite) return false;
    contagem429.set(chave, feitos + 1);
    return true;
  }

  function lerJson(registro, corpo, headers) {
    if (!/^application\/json/i.test(headers['content-type'] ?? '')) throw new ErroApi(400, 'invalid_request', 'Content-Type should be application/json.');
    try { registro.corpo = JSON.parse(corpo.toString('utf8')); } catch { throw new ErroApi(400, 'invalid_json', 'Error parsing JSON body.'); }
    if (!registro.corpo || typeof registro.corpo !== 'object') throw validacao('body should be an object.');
    return registro.corpo;
  }

  async function tratar(metodo, rota, headers, corpo, registro) {
    if (deve429(metodo, rota, headers)) {
      return { status: 429, cabecalhos: { 'retry-after': String(config.retryAfter) }, corpo: { object: 'error', status: 429, code: 'rate_limited', message: 'Rate limited. Please try again later.' } };
    }
    if (!/^Bearer \S+$/.test(headers.authorization ?? '')) throw new ErroApi(401, 'unauthorized', 'API token is invalid.');
    const versao = headers['notion-version'];
    if (!versao) throw new ErroApi(400, 'missing_version', 'Notion-Version header failed validation: Notion-Version header should be defined, instead was `undefined`.');
    if (versao !== VERSAO_NOTION) throw new ErroApi(400, 'invalid_request', `Notion-Version header failed validation: unsupported version "${versao}" (use ${VERSAO_NOTION}).`);

    if (metodo === 'GET' && rota === '/v1/users/me') {
      return { corpo: { object: 'user', id: 'bbbbbbbb-0000-4000-8000-000000000001', type: 'bot', name: 'StepByStep (falso)', avatar_url: null, bot: { owner: { type: 'workspace', workspace: true }, workspace_name: 'Dexterity (falso)' } } };
    }

    if (metodo === 'POST' && rota === '/v1/search') {
      const b = lerJson(registro, corpo, headers);
      if (b.filter && (b.filter.property !== 'object' || !['page', 'data_source', 'database'].includes(b.filter.value))) throw validacao('body.filter should be { property: "object", value: "page" | "data_source" }.');
      const q = String(b.query ?? '').trim().toLowerCase();
      const resultados = [...paginas.values()]
        .filter((p) => !q || p.titulo.toLowerCase().includes(q))
        .sort((a, c) => (b.sort?.direction === 'ascending' ? 1 : -1) * a.editadoEm.localeCompare(c.editadoEm))
        .slice(0, Math.min(Number(b.page_size) || 100, 100))
        .map(objetoPagina);
      return { corpo: { object: 'list', results: resultados, next_cursor: null, has_more: false, type: 'page_or_data_source', page_or_data_source: {} } };
    }

    if (metodo === 'POST' && rota === '/v1/pages') {
      const b = lerJson(registro, corpo, headers);
      const paiId = b.parent?.page_id;
      if (!paiId) throw validacao('body.parent.page_id should be defined.');
      if (!paginas.has(paiId)) throw new ErroApi(404, 'object_not_found', `Could not find page with ID: ${paiId}. Make sure the relevant pages and databases are shared with your integration.`);
      const titulo = b.properties?.title?.title;
      if (!Array.isArray(titulo)) throw validacao('body.properties.title.title should be an array.');
      titulo.forEach((t, i) => {
        if (typeof t?.text?.content !== 'string') throw validacao(`body.properties.title.title[${i}].text.content should be a string.`);
        if (t.text.content.length > 2000) throw validacao(`body.properties.title.title[${i}].text.content.length should be ≤ \`2000\`.`);
      });
      if (b.icon !== undefined && (b.icon?.type !== 'emoji' || typeof b.icon.emoji !== 'string')) throw validacao('body.icon should be { type: "emoji", emoji }.');
      const filhos = b.children ?? [];
      const total = validarBlocos(filhos, 'body.children', 0, uploads);
      if (total > 1000) throw validacao(`body.children: total number of blocks (${total}) should be ≤ 1000.`);
      const id = randomUUID();
      const pagina = { id, titulo: titulo.map((t) => t.text.content).join(''), icone: b.icon?.emoji ?? null, paiId, criadoEm: agoraIso(), editadoEm: agoraIso() };
      paginas.set(id, pagina);
      blocos.set(id, objetosDeBlocos(filhos, id));
      return { corpo: objetoPagina(pagina) };
    }

    const anexo = rota.match(/^\/v1\/blocks\/([a-f0-9-]+)\/children$/);
    if (metodo === 'PATCH' && anexo) {
      const b = lerJson(registro, corpo, headers);
      const alvo = anexo[1];
      if (!paginas.has(alvo)) throw new ErroApi(404, 'object_not_found', `Could not find block with ID: ${alvo}. Make sure the relevant pages and databases are shared with your integration.`);
      if (b.children === undefined) throw validacao('body.children should be defined.');
      const total = validarBlocos(b.children, 'body.children', 0, uploads);
      if (total > 1000) throw validacao(`body.children: total number of blocks (${total}) should be ≤ 1000.`);
      const novos = objetosDeBlocos(b.children, alvo);
      blocos.set(alvo, [...(blocos.get(alvo) ?? []), ...novos]);
      paginas.get(alvo).editadoEm = agoraIso();
      return { corpo: { object: 'list', results: novos.map(semInternos), next_cursor: null, has_more: false, type: 'block', block: {} } };
    }

    if (metodo === 'POST' && rota === '/v1/file_uploads') {
      const b = lerJson(registro, corpo, headers);
      if (b.mode !== undefined && b.mode !== 'single_part') throw validacao(`body.mode "${b.mode}" is not supported by this fake (use "single_part").`);
      if (typeof b.filename !== 'string' || !b.filename) throw validacao('body.filename should be defined.');
      if (typeof b.content_type !== 'string' || !b.content_type) throw validacao('body.content_type should be defined.');
      const id = randomUUID();
      const validade = headers['x-simular-expirado'] !== undefined ? -1 : config.validadeUploadMs;
      const u = {
        id, filename: b.filename, contentType: b.content_type, status: 'pending', tamanho: null,
        criadoEm: agoraIso(), editadoEm: agoraIso(), expiraEm: new Date(Date.now() + validade).toISOString(),
        uploadUrl: `${base}/v1/file_uploads/${id}/send`, sha256: null,
      };
      uploads.set(id, u);
      return { corpo: objetoUpload(u) };
    }

    const envio = rota.match(/^\/v1\/file_uploads\/([a-f0-9-]+)\/send$/);
    if (metodo === 'POST' && envio) {
      const u = uploads.get(envio[1]);
      if (!u) throw new ErroApi(404, 'object_not_found', `Could not find file upload with ID: ${envio[1]}.`);
      if (u.status !== 'pending') throw validacao(`File upload with status "${u.status}" cannot receive content.`);
      if (Date.parse(u.expiraEm) < Date.now()) { u.status = 'expired'; throw validacao('File upload has expired. Create a new file upload.'); }
      const tipo = headers['content-type'] ?? '';
      if (!/^multipart\/form-data/i.test(tipo)) throw new ErroApi(400, 'invalid_request', 'Content-Type should be multipart/form-data.');
      registro.tamanhoMultipart = corpo.length;
      let form;
      try {
        form = await new Request('http://notion.falso/send', { method: 'POST', headers: { 'content-type': tipo }, body: corpo }).formData();
      } catch {
        throw new ErroApi(400, 'invalid_request', 'Could not parse multipart/form-data body.');
      }
      const arquivo = form.get('file');
      if (!(arquivo instanceof Blob)) throw validacao('body.file should be defined (multipart field "file").');
      if (arquivo.size === 0) throw validacao('body.file should not be empty.');
      if (arquivo.size > LIMITE_SINGLE_PART) throw new ErroApi(413, 'validation_error', 'File size exceeds the 20 MB limit for single_part uploads.');
      const bytes = Buffer.from(await arquivo.arrayBuffer());
      u.status = 'uploaded'; u.tamanho = bytes.length; u.editadoEm = agoraIso();
      u.sha256 = createHash('sha256').update(bytes).digest('hex');
      u.nomeEnviado = arquivo.name; u.tipoEnviado = arquivo.type;
      registro.arquivo = { nome: arquivo.name, tipo: arquivo.type, tamanho: bytes.length, sha256: u.sha256 };
      return { corpo: objetoUpload(u) };
    }

    throw new ErroApi(400, 'invalid_request_url', `Invalid request URL: ${metodo} ${rota} is not supported by this fake.`);
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, base || 'http://127.0.0.1');
    const partes = [];
    for await (const p of req) partes.push(p);
    const corpo = Buffer.concat(partes);
    const headers = req.headers;
    const registro = {
      em: agoraIso(), metodo: req.method, rota: url.pathname,
      cabecalhos: Object.fromEntries(CABECALHOS_REGISTRADOS.filter((n) => headers[n] !== undefined).map((n) => [n, headers[n]])),
      nomesCabecalhos: Object.keys(headers),
      corpo: null, tamanhoMultipart: null, arquivo: null, status: null,
    };
    registros.push(registro);
    let resultado;
    try {
      resultado = await tratar(req.method, url.pathname, headers, corpo, registro);
      resultado.status ??= 200;
    } catch (e) {
      const status = e instanceof ErroApi ? e.status : 500;
      resultado = { status, corpo: { object: 'error', status, code: e.code ?? 'internal_server_error', message: e.message, request_id: randomUUID() } };
    }
    registro.status = resultado.status;
    const texto = JSON.stringify(resultado.corpo);
    res.writeHead(resultado.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(texto), ...(resultado.cabecalhos ?? {}) });
    res.end(texto);
  });

  return new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(opcoes.porta ?? 0, '127.0.0.1', () => {
      const porta = servidor.address().port;
      base = `http://127.0.0.1:${porta}`;
      resolver({
        porta, base, registros, paginas, uploads, blocos,
        /** Altera simular429 / retryAfter / validadeUploadMs em tempo de execução e zera a contagem de 429. */
        configurar(patch = {}) { Object.assign(config, patch); contagem429.clear(); return { ...config }; },
        fechar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); }),
      });
    });
  });
}

const ehPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehPrincipal) {
  const { base } = await iniciarNotionFalso({ porta: Number(process.env.PORT ?? 8090) });
  console.log(`Notion falso em ${base} — use NOTION_BASE=${base} no dev-server`);
}
