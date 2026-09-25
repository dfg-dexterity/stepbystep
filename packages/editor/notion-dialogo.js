// Diálogo Notion (seção 8.1): token com Testar, busca da página-mãe com debounce,
// Publicar com progresso, Retomar/Criar nova página. Escopo: só criar a página nova.
// Fechar o diálogo durante a publicação pede confirmação e aborta os fetch; o registro da página criada
// vai para o guia aberto (procurado pelo id) ou direto para o banco, se o usuário já saiu do editor.
import { criarClienteNotion, publicacaoRetomavel } from '../core/notion-cliente.js';
import { obterConfig, salvarConfig, carregarGuia as lerGuiaDoBanco, salvarGuia } from '../core/armazenamento.js';
import { assarPasso } from '../core/render-canvas.js';
import { fontesDoDesenho } from './exportar.js';
import { obterBitmap } from './canvas-anotacao.js';
import { estado, temImagem } from './estado.js';
import { marcarAlterado, salvarAgora, definirVersaoGravada } from './historico.js';
import { abrirDialogo, confirmar } from './componentes/dialogo.js';
import { avisar } from './componentes/aviso.js';

const URL_INTEGRACOES = 'https://www.notion.so/profile/integrations';
const URL_GUIA = 'https://github.com/dfg-dexterity/stepbystep/blob/main/docs/notion.md';
const DEBOUNCE_BUSCA = 400;

const formatarData = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};
const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };

/** ID de página colado (uuid com ou sem hífens, ou URL do Notion). */
function extrairIdDePagina(texto) {
  const t = String(texto ?? '').trim();
  const m = t.replace(/-/g, '').match(/([0-9a-f]{32})(?:[^0-9a-f]|$)/i) ?? t.match(/([0-9a-f]{32})$/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * @param {{baseNotion:string, naExtensao:boolean}} cfg
 */
export async function abrirNotion(cfg) {
  const guia = estado.guia;
  if (!guia) return;
  if (!guia.passos.length) { avisar('O guia não tem passos para publicar.', { tipo: 'atencao' }); return; }

  const raiz = el('div', 'notion');

  // --- token
  const secToken = el('section', 'notion-secao');
  const rotuloToken = el('label', 'dxt-label', 'Token de integração interna');
  rotuloToken.htmlFor = 'notion-token';
  const linhaToken = el('div', 'campo-linha');
  const token = el('input', 'dxt-input');
  token.type = 'password';
  token.id = 'notion-token';
  token.placeholder = 'ntn_… ou secret_…';
  token.autocomplete = 'off';
  token.spellcheck = false;
  const btnMostrar = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm', 'Mostrar');
  btnMostrar.type = 'button';
  btnMostrar.id = 'notion-mostrar';
  const btnTestar = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm', 'Testar');
  btnTestar.type = 'button';
  btnTestar.id = 'notion-testar';
  linhaToken.append(token, btnMostrar, btnTestar);
  const estadoToken = el('p', 'notion-estado');
  estadoToken.id = 'notion-token-estado';
  const ajuda = el('p', 'painel-nota');
  ajuda.append('Crie a integração em ');
  const a1 = el('a', '', 'notion.so/profile/integrations'); a1.href = URL_INTEGRACOES; a1.target = '_blank'; a1.rel = 'noopener';
  ajuda.append(a1, ' com permissão de ler e inserir conteúdo e ');
  const forte = el('strong', '', 'conecte a integração à página-mãe');
  ajuda.append(forte, ' (··· › Conexões) — é o erro mais comum. ');
  const a2 = el('a', '', 'Passo a passo'); a2.href = URL_GUIA; a2.target = '_blank'; a2.rel = 'noopener';
  ajuda.append(a2, '. O token fica só neste navegador. ');
  const btnEsquecer = el('button', 'link-btn', 'Esquecer token');
  btnEsquecer.type = 'button';
  btnEsquecer.id = 'notion-esquecer';
  ajuda.append(btnEsquecer);
  secToken.append(rotuloToken, linhaToken, estadoToken, ajuda);

  // --- página-mãe
  const secPai = el('section', 'notion-secao');
  const rotuloBusca = el('label', 'dxt-label', 'Página-mãe (onde a página nova será criada)');
  rotuloBusca.htmlFor = 'notion-busca';
  const busca = el('input', 'dxt-input');
  busca.type = 'search';
  busca.id = 'notion-busca';
  busca.placeholder = 'Buscar página conectada à integração… ou colar o ID/URL';
  busca.autocomplete = 'off';
  const paginas = el('ul', 'notion-paginas');
  paginas.id = 'notion-paginas';
  paginas.setAttribute('role', 'listbox');
  const estadoPai = el('p', 'notion-estado');
  estadoPai.id = 'notion-pai';
  secPai.append(rotuloBusca, busca, paginas, estadoPai);

  // --- publicar
  const secPub = el('section', 'notion-secao notion-publicar');
  const linhaPub = el('div', 'campo-linha');
  const btnPublicar = el('button', 'dxt-btn', 'Publicar');
  btnPublicar.type = 'button';
  btnPublicar.id = 'notion-publicar';
  const btnRetomar = el('button', 'dxt-btn dxt-btn--ghost', 'Retomar');
  btnRetomar.type = 'button';
  btnRetomar.id = 'notion-retomar';
  btnRetomar.hidden = true;
  const btnNova = el('button', 'dxt-btn dxt-btn--ghost', 'Criar nova página');
  btnNova.type = 'button';
  btnNova.id = 'notion-nova';
  btnNova.hidden = true;
  linhaPub.append(btnPublicar, btnRetomar, btnNova);
  const progresso = el('div', 'notion-progresso');
  progresso.id = 'notion-progresso';
  progresso.hidden = true;
  const barra = el('div', 'notion-barra');
  const preenchido = el('div', 'notion-barra-preenchido');
  barra.append(preenchido);
  const textoProgresso = el('p', 'notion-progresso-texto dxt-num');
  progresso.append(barra, textoProgresso);
  const resultado = el('p', 'notion-estado');
  resultado.id = 'notion-resultado';
  resultado.setAttribute('aria-live', 'polite');
  secPub.append(linhaPub, progresso, resultado);

  // ---- estado
  let paiId = null;
  let paiTitulo = '';
  let publicando = false;
  let controlador = null; // AbortController da publicação em curso: cancelar = abortar os fetch
  // só uma pendência saneada pelo núcleo (id e link no formato do Notion) oferece «Retomar»: um registro inválido ou
  // adulterado (guide.json de terceiros) não esconde o Publicar nem anuncia publicação incompleta
  let publicacaoPendente = (guia.publicacoes ?? []).map((p) => publicacaoRetomavel(p)).find(Boolean) ?? null;

  raiz.append(secToken, secPai, secPub);
  const dialogo = abrirDialogo({
    titulo: 'Publicar no Notion',
    conteudo: raiz,
    botoes: [{ rotulo: 'Fechar', valor: null }],
    largura: 620,
    classe: 'dialogo--notion',
    // Esc, ×, clique fora ou «Fechar» no meio da publicação: confirma antes de abortar
    antesDeFechar: async () => {
      if (!publicando) return true;
      const cancelar = await confirmar('A publicação ainda está em andamento. Cancelar agora? Se a página já tiver sido criada no Notion, ela poderá ser retomada depois.', {
        titulo: 'Publicação em andamento', ok: 'Cancelar publicação', cancelar: 'Continuar publicando', perigo: true,
      });
      if (cancelar) controlador?.abort();
      return cancelar;
    },
  });

  // todo fetch da publicação leva o sinal do cancelamento (fora dela `controlador` é null e o sinal, undefined)
  const cliente = () => criarClienteNotion({ token: token.value.trim(), base: cfg.baseNotion, fetch: (url, init) => fetch(url, { ...init, signal: controlador?.signal }) });
  const definirEstado = (elemento, texto, tipo = '') => { elemento.textContent = texto; elemento.className = `notion-estado${tipo ? ` notion-estado--${tipo}` : ''}`; };

  function mostrarPai() {
    if (paiId) definirEstado(estadoPai, `Página-mãe: ${paiTitulo || paiId}`, 'ok');
    else definirEstado(estadoPai, 'Escolha a página-mãe na lista (ou cole o ID de uma página conectada).');
    btnPublicar.disabled = !paiId || !token.value.trim() || publicando;
  }
  function mostrarRetomada() {
    btnRetomar.hidden = !publicacaoPendente;
    btnNova.hidden = !publicacaoPendente;
    if (publicacaoPendente) {
      definirEstado(resultado, `Publicação anterior incompleta (${publicacaoPendente.lotesEnviados ?? 0} lote(s) enviado(s)). Retome para continuar na mesma página ou crie uma nova.`, 'atencao');
      btnPublicar.hidden = true;
    } else {
      btnPublicar.hidden = false;
    }
  }

  // token salvo
  try {
    const salvo = await obterConfig('notion.token');
    if (typeof salvo === 'string' && salvo) { token.value = salvo; definirEstado(estadoToken, 'Token salvo neste navegador. Clique em Testar para validar.'); }
    const paiSalvo = await obterConfig('notion.paiId');
    if (typeof paiSalvo === 'string' && paiSalvo) { paiId = paiSalvo; paiTitulo = (await obterConfig('notion.paiTitulo')) ?? ''; }
  } catch (e) { console.warn('Config do Notion indisponível', e); }
  mostrarPai();
  mostrarRetomada();

  btnMostrar.addEventListener('click', () => {
    const visivel = token.type === 'text';
    token.type = visivel ? 'password' : 'text';
    btnMostrar.textContent = visivel ? 'Mostrar' : 'Ocultar';
  });
  token.addEventListener('input', () => { definirEstado(estadoToken, ''); mostrarPai(); });
  btnEsquecer.addEventListener('click', async () => {
    token.value = '';
    await salvarConfig('notion.token', '');
    definirEstado(estadoToken, 'Token removido deste navegador.');
    mostrarPai();
  });

  btnTestar.addEventListener('click', async () => {
    const t = token.value.trim();
    if (!t) { definirEstado(estadoToken, 'Cole o token da integração interna.', 'erro'); token.focus(); return; }
    btnTestar.disabled = true;
    definirEstado(estadoToken, 'Testando…');
    try {
      const { nome } = await cliente().validarToken();
      await salvarConfig('notion.token', t);
      definirEstado(estadoToken, `Conectado à integração «${nome}». Token salvo neste navegador.`, 'ok');
      if (!paginas.children.length) buscar('');
    } catch (e) {
      definirEstado(estadoToken, e.message || 'Não foi possível validar o token.', 'erro');
    } finally {
      btnTestar.disabled = false;
      mostrarPai();
    }
  });

  // busca com debounce
  let timerBusca = null;
  let ultimaBusca = 0;
  async function buscar(texto) {
    const t = token.value.trim();
    if (!t) { paginas.replaceChildren(el('li', 'notion-pagina-vazia', 'Informe e teste o token para buscar páginas.')); return; }
    const idColado = extrairIdDePagina(texto);
    const minha = ++ultimaBusca;
    paginas.replaceChildren(el('li', 'notion-pagina-vazia', 'Buscando…'));
    let lista = [];
    try {
      lista = await cliente().buscarPaginas(idColado ? '' : texto);
    } catch (e) {
      if (minha !== ultimaBusca) return;
      paginas.replaceChildren(el('li', 'notion-pagina-vazia notion-estado--erro', e.message || 'Falha na busca.'));
      return;
    }
    if (minha !== ultimaBusca) return;
    paginas.replaceChildren();
    if (idColado) {
      const li = el('li');
      const b = el('button', 'notion-pagina');
      b.type = 'button';
      b.dataset.id = idColado;
      b.append(el('span', 'notion-pagina-icone', '#'), el('span', 'notion-pagina-titulo', `Usar o ID colado ${idColado}`));
      b.addEventListener('click', () => escolher(idColado, `ID ${idColado.slice(0, 8)}…`));
      li.append(b);
      paginas.append(li);
    }
    for (const p of lista) {
      const li = el('li');
      const b = el('button', 'notion-pagina');
      b.type = 'button';
      b.dataset.id = p.id;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(p.id === paiId));
      const icone = el('span', 'notion-pagina-icone', typeof p.icone === 'string' && p.icone.length <= 4 ? p.icone : '▫');
      const titulo = el('span', 'notion-pagina-titulo', p.titulo);
      const data = el('span', 'notion-pagina-data dxt-num', p.editadoEm ? `editada ${formatarData(p.editadoEm)}` : '');
      b.append(icone, titulo, data);
      b.addEventListener('click', () => escolher(p.id, p.titulo));
      li.append(b);
      paginas.append(li);
    }
    if (!lista.length && !idColado) paginas.append(el('li', 'notion-pagina-vazia', 'Nenhuma página encontrada. Só aparecem páginas conectadas à integração (··· › Conexões).'));
  }
  async function escolher(id, titulo) {
    paiId = id;
    paiTitulo = titulo;
    for (const b of paginas.querySelectorAll('.notion-pagina')) b.setAttribute('aria-selected', String(b.dataset.id === id));
    await salvarConfig('notion.paiId', id);
    await salvarConfig('notion.paiTitulo', titulo);
    mostrarPai();
  }
  busca.addEventListener('input', () => {
    clearTimeout(timerBusca);
    timerBusca = setTimeout(() => buscar(busca.value), DEBOUNCE_BUSCA);
  });
  busca.addEventListener('focus', () => { if (!paginas.children.length) buscar(busca.value); });
  if (token.value) buscar('');

  // ---- publicar
  async function obterImagemAssada(passo) {
    if (!temImagem(passo)) return null;
    const bitmap = await obterBitmap(passo.captura.imagemId);
    if (!bitmap) return null;
    await fontesDoDesenho();
    const { blob } = await assarPasso(bitmap, passo, { estilo: guia.estilo });
    return blob;
  }
  function aoProgredir({ fase, atual, total }) {
    let pct = 0, texto = '';
    if (fase === 'upload') { pct = total ? (atual / total) * 80 : 80; texto = `Enviando imagem ${atual} de ${total}`; }
    else if (fase === 'pagina') { pct = 85; texto = 'Criando página'; }
    else if (fase === 'blocos') { pct = 85 + (total ? (atual / total) * 15 : 15); texto = `Anexando blocos ${atual}/${total}`; }
    preenchido.style.width = `${Math.min(100, Math.round(pct))}%`;
    textoProgresso.textContent = texto;
  }
  /** Lista com a publicação mesclada: substitui a entrada da mesma página; uma página nova encerra a pendência antiga. */
  function mesclarPublicacao(lista, publicacao) {
    const atual = Array.isArray(lista) ? lista : [];
    const i = atual.findIndex((p) => p.destino === 'notion' && p.paginaId && p.paginaId === publicacao.paginaId);
    if (i >= 0) return atual.map((p, k) => (k === i ? publicacao : p));
    return [...atual.filter((p) => !(p.destino === 'notion' && !p.concluida)), publicacao];
  }
  /**
   * Registra no guia aberto (procurado pelo id: desfazer/refazer troca o objeto) ou, se o usuário já saiu dele,
   * direto no banco — a página existe no Notion e sem `paginaId` gravado não haveria como retomar.
   */
  async function registrarPublicacao(publicacao) {
    const aberto = estado.guia?.id === guia.id ? estado.guia : null;
    if (aberto) {
      aberto.publicacoes = mesclarPublicacao(aberto.publicacoes, publicacao);
      marcarAlterado();
      return;
    }
    try {
      const noBanco = await lerGuiaDoBanco(guia.id);
      if (!noBanco) return;
      if (estado.guia?.id === guia.id) { await registrarPublicacao(publicacao); return; }   // reaberto enquanto líamos
      noBanco.publicacoes = mesclarPublicacao(noBanco.publicacoes, publicacao);
      const gravado = await salvarGuia(noBanco);
      // reaberto entre a leitura e a gravação: a cópia em memória recebe o registro e passa a valer a versão gravada
      if (estado.guia?.id === guia.id) { estado.guia.publicacoes = noBanco.publicacoes; definirVersaoGravada(gravado.atualizadoEm); }
    } catch (e) {
      console.warn('Registro da publicação não gravado', e);
      avisar('A página foi criada no Notion, mas o registro não pôde ser gravado no guia.', { tipo: 'atencao' });
    }
  }
  async function publicar(publicacaoAnterior) {
    const t = token.value.trim();
    if (!t) { definirEstado(estadoToken, 'Cole o token da integração interna.', 'erro'); token.focus(); return; }
    if (!paiId) { definirEstado(estadoPai, 'Escolha a página-mãe antes de publicar.', 'erro'); busca.focus(); return; }
    publicando = true;
    controlador = new AbortController();
    const sinal = controlador.signal;
    btnPublicar.disabled = btnRetomar.disabled = btnNova.disabled = btnTestar.disabled = true;
    progresso.hidden = false;
    preenchido.style.width = '0%';
    textoProgresso.textContent = 'Preparando…';
    definirEstado(resultado, '');
    await salvarConfig('notion.token', t);
    await salvarAgora();
    try {
      const r = await cliente().publicarGuia(guia, { paiId, obterImagemAssada, aoProgredir, publicacaoAnterior: publicacaoAnterior ?? undefined });
      await registrarPublicacao(r.publicacao);
      publicacaoPendente = null;
      preenchido.style.width = '100%';
      textoProgresso.textContent = 'Concluído';
      resultado.replaceChildren();
      resultado.className = 'notion-estado notion-estado--ok';
      resultado.append('Página criada no Notion. ');
      const link = el('a', 'notion-link', 'Abrir no Notion');
      link.id = 'notion-link';
      link.href = r.url ?? '#';
      link.target = '_blank';
      link.rel = 'noopener';
      resultado.append(link);
      // o núcleo avisa quando o guia mudou desde a tentativa anterior e a publicação recomeçou numa página nova
      if (r.aviso) avisar(r.aviso, { tipo: 'atencao' });
      else avisar('Manual publicado no Notion.', { tipo: 'sucesso' });
    } catch (e) {
      const cancelada = sinal.aborted;
      if (!cancelada) console.error('Falha na publicação', e);
      const parcial = e?.publicacao;
      if (parcial?.paginaId) { publicacaoPendente = { ...parcial, concluida: false }; await registrarPublicacao(publicacaoPendente); }
      if (cancelada) {
        const retomavel = !!parcial?.paginaId;
        definirEstado(resultado, retomavel ? 'Publicação cancelada. A página já criada pode ser retomada.' : 'Publicação cancelada.', 'atencao');
        avisar(retomavel ? 'Publicação no Notion cancelada. Abra o Notion de novo para retomar a página já criada.' : 'Publicação no Notion cancelada.', { tipo: 'atencao' });
      } else {
        definirEstado(resultado, `${e?.message || 'Falha ao publicar.'}${parcial?.paginaId ? ' A página já foi criada: você pode retomar sem repetir o que foi enviado.' : ''}`, 'erro');
      }
    } finally {
      publicando = false;
      controlador = null;
      btnPublicar.disabled = btnRetomar.disabled = btnNova.disabled = btnTestar.disabled = false;
      mostrarRetomada();
      mostrarPai();
    }
  }
  btnPublicar.addEventListener('click', () => publicar(null));
  btnRetomar.addEventListener('click', () => publicar(publicacaoPendente));
  btnNova.addEventListener('click', () => { publicacaoPendente = null; mostrarRetomada(); publicar(null); });

  return dialogo.promessa;
}
