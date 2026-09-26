/**
 * Proxy allow-list para a API do Notion — usado só pelo editor hospedado
 * (a extensão chama api.notion.com direto via host_permissions).
 *
 * Assinatura Web (Request → Response): o corpo chega como stream e é repassado
 * byte a byte, com o boundary do multipart intacto. Não usar (req, res) do Node:
 * os helpers da Vercel consomem o corpo antes do handler. Só os exports nomeados por
 * método fazem a Vercel montar um Request — sem `export default`
 * (ver nota no fim); o dev-server e os testes importam os mesmos exports nomeados.
 *
 * Sem segredo no servidor, sem log de cabeçalhos, `no-store`, allow-list de rotas
 * e métodos, CORS restrito às origens do editor (a credencial do usuário trafega).
 * Variáveis: NOTION_BASE (só testes apontam para o Notion falso) e ORIGENS_PERMITIDAS.
 */
const ROTAS = /^\/v1\/(users\/me|search|pages|blocks\/[a-f0-9-]+\/children|file_uploads(\/[a-f0-9-]+\/send)?)$/;
const METODOS = new Set(['GET', 'POST', 'PATCH']);
const CABECALHOS_REPASSADOS = ['authorization', 'notion-version', 'content-type'];
const ORIGENS_PADRAO = 'https://stepbystep-dexterity.vercel.app,http://localhost:8080,http://127.0.0.1:8080';
const PREVIEW_VERCEL = /^https:\/\/stepbystep-[a-z0-9-]+\.vercel\.app$/;
const SEM_CORPO = new Set([204, 205, 304]);

// Lidas a cada requisição (e não no carregamento do módulo) para que os testes e o
// dev-server possam subir o Notion falso antes de definir NOTION_BASE.
const baseNotion = () => (process.env.NOTION_BASE ?? 'https://api.notion.com').replace(/\/+$/, '');
const origensPermitidas = () => (process.env.ORIGENS_PERMITIDAS ?? ORIGENS_PADRAO).split(',').map((o) => o.trim()).filter(Boolean);

function cabecalhosCors(origem) {
  const origens = origensPermitidas();
  return {
    'access-control-allow-origin': origens.includes(origem) || PREVIEW_VERCEL.test(origem) ? origem : origens[0],
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'authorization, notion-version, content-type',
    'access-control-max-age': '600',
    vary: 'origin',
    'cache-control': 'no-store',
  };
}

const json = (corpo, status, cors) => new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'content-type': 'application/json' } });

/**
 * Rota do Notion pedida. Funções soltas da Vercel não têm catch-all (`[...x].js` é só do
 * Next.js), então o vercel.json reescreve /api/notion/:caminho* para /api/notion?rota=/:caminho*.
 * Aceita as duas formas: o caminho original (dev-server, testes e plataformas que preservam
 * a URL) e o parâmetro `rota` do rewrite. Qualquer valor passa pela allow-list ROTAS.
 */
function rotaDe(url) {
  const peloCaminho = url.pathname.replace(/^\/api\/notion(\.js)?/, '');
  if (peloCaminho) return peloCaminho;
  return url.searchParams.get('rota') ?? '';
}

async function handler(request) {
  const url = new URL(request.url);
  const rota = rotaDe(url);
  const cors = cabecalhosCors(request.headers.get('origin') ?? '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!METODOS.has(request.method) || !ROTAS.test(rota)) return json({ erro: 'Rota não permitida' }, 403, cors);

  const h = new Headers();
  for (const nome of CABECALHOS_REPASSADOS) {
    const valor = request.headers.get(nome);
    if (valor) h.set(nome, valor);
  }
  // ≤ 4,5 MB (limite da plataforma); bytes intactos, boundary preservado
  const corpo = request.method === 'GET' ? undefined : await request.arrayBuffer();

  let r;
  try {
    r = await fetch(baseNotion() + rota, { method: request.method, headers: h, body: corpo, signal: AbortSignal.timeout(55_000) });
  } catch (e) {
    const tempo = e?.name === 'TimeoutError';
    return json({ erro: tempo ? 'O Notion não respondeu a tempo' : 'Não foi possível falar com o Notion' }, tempo ? 504 : 502, cors);
  }

  const cabecalhos = { ...cors, 'content-type': r.headers.get('content-type') ?? 'application/json' };
  const retryAfter = r.headers.get('retry-after');   // o cliente respeita o Retry-After do 429
  if (retryAfter) cabecalhos['retry-after'] = retryAfter;
  return new Response(SEM_CORPO.has(r.status) ? null : r.body, { status: r.status, headers: cabecalhos });
}

// Só exports nomeados por método: o builder da Vercel (@vercel/node, `unwrapDefaults`) troca o módulo pelo
// `default` quando ele existe e, aí, trataria este handler como (req, res) do Node — quebrando a assinatura Web.
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const OPTIONS = handler;
// Métodos fora da allow-list também passam pelo handler: sem export, a Vercel responde 405 sem CORS;
// assim a recusa é igual em todo ambiente (403 com CORS), como o "Verificar publicação" confere.
export const PUT = handler;
export const DELETE = handler;
