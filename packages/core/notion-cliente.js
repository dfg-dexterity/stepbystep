// Cliente da API do Notion com `fetch` injetado: token do usuário, File Upload API, publicação retomável.
// Da extensão chama api.notion.com direto; do editor hospedado passa por /api/notion (proxy sem estado).
import { numeroDoPasso } from './modelo.js';
import { guiaParaBlocos, dividirEmLotes, richText } from './notion-blocos.js';
import { reduzirImagem } from './redimensionar.js';

export const URL_EDITOR = 'https://stepbystep-dexterity.vercel.app';
export const VERSAO_NOTION = '2022-06-28';
export const ROTAS_PERMITIDAS = /^\/v1\/(users\/me|search|pages|blocks\/[a-f0-9-]+\/children|file_uploads(\/[a-f0-9-]+\/send)?)$/;
export const LIMITE_UPLOAD_PROXY = 4 * 1024 * 1024;     // 4 MB atrás do proxy Vercel
export const LIMITE_UPLOAD_DIRETO = 20 * 1024 * 1024;   // single_part

const JANELA_UPLOADS = 30;                    // uploads seguidos antes de criar/anexar (expiram em 1 h)
const VALIDADE_UPLOAD_MS = 50 * 60 * 1000;    // retomada só reaproveita uploads com < 50 min
const MAX_TENTATIVAS_429 = 5;
const MAX_TENTATIVAS_SERVIDOR = 3;
const ID_NOTION = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/;
const PREFIXO_URL_NOTION = 'https://www.notion.so/';

/** @returns {boolean} id de página/bloco no formato do Notion (uuid, com ou sem hífens) — só esses entram na rota da API */
export const idNotionValido = (id) => typeof id === 'string' && ID_NOTION.test(id);
/** @returns {boolean} link que pode ser oferecido como "Abrir no Notion" */
export const urlNotionValida = (url) => typeof url === 'string' && url.startsWith(PREFIXO_URL_NOTION);

/**
 * Publicação anterior aceitável para retomada. `guia.publicacoes` vem do guide.json (possivelmente importado de
 * terceiros): só retoma com `paginaId` no formato do Notion, e `url` fora do Notion é trocada pelo link canônico da página.
 * @param {object} publicacao @returns {object|null} cópia saneada, ou null quando não há o que retomar
 */
export function publicacaoRetomavel(publicacao) {
  const p = publicacao;
  if (!p || typeof p !== 'object' || p.destino !== 'notion' || p.concluida || !idNotionValido(p.paginaId)) return null;
  const uploads = p.uploads && typeof p.uploads === 'object' && !Array.isArray(p.uploads) ? { ...p.uploads } : {};
  return {
    destino: 'notion',
    paginaId: p.paginaId,
    url: urlNotionValida(p.url) ? p.url : PREFIXO_URL_NOTION + p.paginaId.replace(/-/g, ''),
    em: typeof p.em === 'string' && Number.isFinite(Date.parse(p.em)) ? p.em : null,
    concluida: false,
    uploads,
    lotesEnviados: Number.isInteger(p.lotesEnviados) && p.lotesEnviados > 0 ? p.lotesEnviados : 0,
  };
}

export class ErroNotion extends Error {
  constructor(status, corpo, mensagem) {
    super(mensagem);
    this.name = 'ErroNotion';
    this.status = status;
    this.corpo = corpo;
  }
}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';

/** @returns {string} mensagem pt-BR para o usuário */
export function traduzirErroNotion(status, corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const codigo = c.code ?? '';
  const detalhe = typeof c.message === 'string' ? c.message : (typeof corpo === 'string' ? corpo : '');
  if (status === 401 || codigo === 'unauthorized') return 'Token inválido ou expirado. Confira o token de integração interna do Notion.';
  if (status === 404 || codigo === 'object_not_found') {
    return 'Página não encontrada no Notion. Confira se a página-mãe foi conectada à integração (··· › Conexões).';
  }
  if (status === 403 || codigo === 'restricted_resource') return 'A integração não tem permissão para esta ação no Notion.';
  if (status === 413) return 'A imagem é grande demais para o envio ao Notion.';
  if (status === 429 || codigo === 'rate_limited') return 'Limite de requisições do Notion atingido. Tente novamente em instantes.';
  if (status === 400 && codigo === 'validation_error') return `O Notion recusou os dados enviados: ${detalhe || 'erro de validação'}.`;
  if (status === 409) return 'Conflito ao gravar no Notion. Tente novamente.';
  if (status >= 500) return `O Notion está indisponível no momento (erro ${status}). Tente novamente mais tarde.`;
  return `Erro ${status} do Notion${detalhe ? `: ${detalhe}` : ''}.`;
}

async function lerCorpo(resposta) {
  const texto = await resposta.text();
  if (!texto) return null;
  try { return JSON.parse(texto); } catch { return texto; }
}

const temImagem = (p) => p.tipo !== 'secao' && !!(p.captura && !p.captura.faltante && p.captura.imagemId);

/**
 * @param {{token:string, base:string, fetch:typeof fetch, versao?:string, esperar?:(ms:number)=>Promise<void>}} cfg
 */
export function criarClienteNotion(cfg) {
  if (!cfg || typeof cfg.fetch !== 'function') throw new Error('criarClienteNotion exige `fetch` injetado');
  const { token, fetch: enviar, versao = VERSAO_NOTION } = cfg;
  const base = String(cfg.base ?? 'https://api.notion.com').replace(/\/+$/, '');
  const esperar = cfg.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const atrasDoProxy = /\/api\/notion$/.test(base);

  async function requisicao(metodo, rota, { json, formData } = {}) {
    const headers = { authorization: `Bearer ${token}`, 'notion-version': versao };
    let body;
    if (formData) body = formData;                       // sem Content-Type manual: o fetch põe o boundary
    else if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    const criacaoDePagina = metodo === 'POST' && rota === '/v1/pages';
    let tentativas429 = 0;
    let tentativasServidor = 0;
    for (;;) {
      const resposta = await enviar(base + rota, { method: metodo, headers, body });
      if (resposta.ok) return lerCorpo(resposta);
      const corpo = await lerCorpo(resposta).catch(() => null);
      if (resposta.status === 429 && tentativas429 < MAX_TENTATIVAS_429) {
        tentativas429++;
        const retryAfter = Number(resposta.headers?.get?.('retry-after'));
        await esperar(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (tentativas429 - 1));
        continue;
      }
      // POST /v1/pages nunca é repetido às cegas: um 5xx pode ter criado a página
      if ((resposta.status >= 500 || resposta.status === 409) && tentativasServidor < MAX_TENTATIVAS_SERVIDOR && !criacaoDePagina) {
        tentativasServidor++;
        await esperar(500 * tentativasServidor);
        continue;
      }
      throw new ErroNotion(resposta.status, corpo, traduzirErroNotion(resposta.status, corpo));
    }
  }

  function tituloDaPagina(pagina) {
    const props = pagina?.properties ?? {};
    const prop = props.title?.type === 'title' ? props.title : Object.values(props).find((p) => p?.type === 'title');
    const texto = (prop?.title ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();
    return texto || 'Sem título';
  }

  const cliente = {
    /** GET /v1/users/me @returns {Promise<{nome:string}>} */
    async validarToken() {
      const r = await requisicao('GET', '/v1/users/me');
      return { nome: r?.name || r?.bot?.workspace_name || 'Integração' };
    },

    /** POST /v1/search @returns {Promise<{id, titulo, icone, editadoEm}[]>} */
    async buscarPaginas(texto) {
      const r = await requisicao('POST', '/v1/search', {
        json: {
          query: texto ?? '',
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
          page_size: 20,
        },
      });
      return (r?.results ?? []).filter((p) => p.object === 'page').map((p) => ({
        id: p.id,
        titulo: tituloDaPagina(p),
        icone: p.icon?.type === 'emoji' ? p.icon.emoji : (p.icon?.external?.url ?? p.icon?.file?.url ?? null),
        editadoEm: p.last_edited_time ?? null,
      }));
    },

    /** POST /v1/file_uploads @returns {Promise<{id, uploadUrl, expiraEm}>} */
    async criarUpload(nome, tipo) {
      const r = await requisicao('POST', '/v1/file_uploads', { json: { mode: 'single_part', filename: nome, content_type: tipo } });
      return { id: r.id, uploadUrl: r.upload_url ?? null, expiraEm: r.expiry_time ?? null };
    },

    /** POST /v1/file_uploads/{id}/send multipart (campo 'file') */
    async enviarUpload(id, blob, nome) {
      const formData = new FormData();
      formData.append('file', blob, nome);
      await requisicao('POST', `/v1/file_uploads/${id}/send`, { formData });
    },

    /** POST /v1/pages @returns {Promise<{id, url}>} */
    async criarPagina(paiId, titulo, filhos) {
      const r = await requisicao('POST', '/v1/pages', {
        json: {
          parent: { page_id: paiId },
          icon: { type: 'emoji', emoji: '📘' },
          properties: { title: { title: richText(titulo) } },
          children: filhos ?? [],
        },
      });
      return { id: r.id, url: r.url ?? null };
    },

    /** PATCH /v1/blocks/{id}/children */
    async anexarBlocos(paginaId, blocos) {
      if (!idNotionValido(paginaId)) throw new Error('Id de página do Notion inválido.');
      await requisicao('PATCH', `/v1/blocks/${paginaId}/children`, { json: { children: blocos } });
    },

    /**
     * Publicação sequencial e retomável: uploads em janelas de 30, criação da página com o primeiro lote,
     * PATCH dos demais. Erros carregam `.publicacao` para a retomada.
     * @param {object} guia
     * @param {{paiId:string, obterImagemAssada:(passo:object)=>Promise<Blob|null>, aoProgredir?:Function, publicacaoAnterior?:object, limiteUpload?:number, reduzirImagem?:Function, data?:Date}} o
     * @returns {Promise<{paginaId:string, url:string|null, publicacao:object}>}
     */
    async publicarGuia(guia, o) {
      const { paiId, obterImagemAssada } = o;
      const aoProgredir = typeof o.aoProgredir === 'function' ? o.aoProgredir : () => {};
      const limite = o.limiteUpload ?? (atrasDoProxy ? LIMITE_UPLOAD_PROXY : LIMITE_UPLOAD_DIRETO);
      const reduzir = o.reduzirImagem ?? reduzirImagem;
      const agora = Date.now();
      const anterior = publicacaoRetomavel(o.publicacaoAnterior);   // ids/links vindos do arquivo só entram saneados
      const uploadsValidos = !!anterior && anterior.em !== null && agora - Date.parse(anterior.em) < VALIDADE_UPLOAD_MS;
      const publicacao = {
        destino: 'notion',
        paginaId: anterior ? anterior.paginaId : null,
        url: anterior ? anterior.url : null,
        em: uploadsValidos ? anterior.em : new Date(agora).toISOString(),
        concluida: false,
        uploads: uploadsValidos ? anterior.uploads : {},
        lotesEnviados: anterior ? anterior.lotesEnviados : 0,
      };

      // janelas de passos: corta quando a janela já tem 30 imagens
      const janelas = [];
      let atual = [];
      let imagensNaJanela = 0;
      for (const p of guia.passos) {
        if (temImagem(p) && imagensNaJanela === JANELA_UPLOADS) { janelas.push(atual); atual = []; imagensNaJanela = 0; }
        atual.push(p);
        if (temImagem(p)) imagensNaJanela++;
      }
      janelas.push(atual);

      const { titulo, blocos: blocosVazios } = guiaParaBlocos(guia, { uploadIdDoPasso: () => null, data: o.data });
      const cabecalho = blocosVazios.length - guia.passos.length;   // callout (+ parágrafo da descrição)
      const blocosDaFaixa = (inicio, fim, uploadIdDoPasso) => {
        const todos = guiaParaBlocos(guia, { uploadIdDoPasso, data: o.data }).blocos;
        return inicio === 0 ? todos.slice(0, cabecalho + fim) : todos.slice(cabecalho + inicio, cabecalho + fim);
      };
      const placeholder = (p) => (temImagem(p) ? 'pendente' : null);

      // lotes por janela e passos cobertos por cada lote (a estrutura não depende dos ids reais dos uploads)
      const lotesPorJanela = [];
      let inicio = 0;
      for (const janela of janelas) {
        const lotes = dividirEmLotes(blocosDaFaixa(inicio, inicio + janela.length, placeholder));
        let cursor = 0;
        lotesPorJanela.push(lotes.map((lote, k) => {
          const n = lote.length - (inicio === 0 && k === 0 ? cabecalho : 0);
          const passos = janela.slice(cursor, cursor + n);
          cursor += n;
          return passos;
        }));
        inicio += janela.length;
      }
      const totalLotes = lotesPorJanela.reduce((s, l) => s + l.length, 0);
      const totalImagens = guia.passos.filter(temImagem).length;
      let imagensFeitas = guia.passos.filter((p) => temImagem(p) && publicacao.uploads[p.id]).length;
      let loteGlobal = 0;
      const progresso = (fase, atualN, total) => aoProgredir({ fase, atual: atualN, total, publicacao });

      try {
        inicio = 0;
        for (let j = 0; j < janelas.length; j++) {
          const janela = janelas[j];
          const fim = inicio + janela.length;
          const lotesDaJanela = lotesPorJanela[j];
          if (loteGlobal + lotesDaJanela.length <= publicacao.lotesEnviados) { loteGlobal += lotesDaJanela.length; inicio = fim; continue; }

          // só sobe imagens de passos em lotes ainda não enviados (retomada não repete o que já está na página)
          const pendentes = lotesDaJanela.filter((_, k) => loteGlobal + k >= publicacao.lotesEnviados).flat();
          for (const p of pendentes) {
            if (!temImagem(p) || publicacao.uploads[p.id]) continue;
            progresso('upload', imagensFeitas + 1, totalImagens);
            const n = numeroDoPasso(guia, guia.passos.indexOf(p));
            const uploadId = await enviarImagemDoPasso(p, n);
            if (uploadId) publicacao.uploads[p.id] = uploadId;
            imagensFeitas++;
          }

          const lotes = dividirEmLotes(blocosDaFaixa(inicio, fim, (p) => publicacao.uploads[p.id] ?? null));
          for (const lote of lotes) {
            if (loteGlobal < publicacao.lotesEnviados) { loteGlobal++; continue; }
            if (!publicacao.paginaId) {
              progresso('pagina', 1, 1);
              const pagina = await cliente.criarPagina(paiId, titulo, lote);
              publicacao.paginaId = pagina.id;
              publicacao.url = pagina.url;
            } else {
              progresso('blocos', loteGlobal + 1, totalLotes);
              await cliente.anexarBlocos(publicacao.paginaId, lote);
            }
            loteGlobal++;
            publicacao.lotesEnviados = loteGlobal;
          }
          inicio = fim;
        }
        publicacao.concluida = true;
        return { paginaId: publicacao.paginaId, url: publicacao.url, publicacao };
      } catch (e) {
        if (e && typeof e === 'object') e.publicacao = publicacao;
        throw e;
      }

      async function enviarImagemDoPasso(passo, n) {
        let blob = await obterImagemAssada(passo);
        if (!blob) return null;
        let tipo = blob.type || 'image/png';
        // acima do limite: 2000 px PNG → WebP q0,9 → 1400 px WebP
        if (blob.size > limite) blob = await reduzir(blob, { larguraMax: 2000, tipo: 'image/png' });
        if (blob.size > limite) { blob = await reduzir(blob, { larguraMax: 2000, tipo: 'image/webp', qualidade: 0.9 }); tipo = 'image/webp'; }
        if (blob.size > limite) { blob = await reduzir(blob, { larguraMax: 1400, tipo: 'image/webp', qualidade: 0.9 }); tipo = 'image/webp'; }
        if (blob.size > limite) {
          throw new Error(`A imagem do passo ${n} tem ${mb(blob.size)} e excede o limite de ${mb(limite)} do envio ao Notion.`);
        }
        const nome = `passo-${String(n).padStart(2, '0')}.${tipo === 'image/webp' ? 'webp' : 'png'}`;
        const upload = await cliente.criarUpload(nome, tipo);
        await cliente.enviarUpload(upload.id, blob, nome);
        return upload.id;
      }
    },
  };
  return cliente;
}
