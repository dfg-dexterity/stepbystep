// Coluna direita: título, descrição, tipo, metadados de contexto, imagem (anexar/substituir),
// lista de anotações e estilo do guia. Os campos de texto sincronizam sem perder o foco.
import { TIPOS_PASSO, TOKENS_COR } from '../core/modelo.js';
import { gerarId } from '../core/ids.js';
import { salvarImagem } from '../core/armazenamento.js';
import { cssParaImagem, pontoParaImagem } from '../core/coordenadas.js';
import { anotacoesAutomaticas } from '../core/anotacoes.js';
import { abreviarUrl } from '../core/frases.js';
import { estado, on, passoAtual, indiceDoPasso, selecionarAnotacao, temImagem } from './estado.js';
import { aplicar } from './historico.js';
import { regerarTitulo, renomearPasso, NOMES_TIPO } from './lista-passos.js';
import { excluirAnotacao } from './ferramentas.js';
import { confirmar } from './componentes/dialogo.js';
import { avisar } from './componentes/aviso.js';

/** Falha inesperada ao anexar (os erros previstos já viram aviso dentro de anexarImagemAoPasso). */
const aoFalharAnexo = (e) => { console.warn('Falha ao anexar a imagem', e); avisar(e?.message || 'Não foi possível anexar a imagem.', { tipo: 'erro' }); };

export const NOMES_COR = { cerceta: 'Cerceta', ambar: 'Âmbar', roxo: 'Roxo', base: 'Base (escuro)', off: 'Off-white' };
const NOMES_ANOTACAO = { recorte: 'Recorte', desfoque: 'Desfoque', retangulo: 'Retângulo', seta: 'Seta', marcador: 'Marcador', texto: 'Texto' };
const NOMES_FONTE = { pointerdown: 'no clique', confirmacao: 'na confirmação', navegacao: 'após navegar', compartilhada: 'compartilhada', manual: 'manual' };

const formatarData = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/**
 * Anexa (ou substitui) a imagem de um passo a partir de um Blob. Recalcula bbox/ponto pelo rectCss
 * quando há viewport e gera as anotações automáticas se o passo ainda não tem nenhuma.
 */
export async function anexarImagemAoPasso(passoId, blob) {
  const guia = estado.guia;
  const passo = guia?.passos.find((p) => p.id === passoId);
  if (!passo) return;
  if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) { avisar('Use uma imagem PNG, JPEG ou WebP.', { tipo: 'atencao' }); return; }
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { avisar('Não foi possível ler a imagem.', { tipo: 'erro' }); return; }
  const largura = bitmap.width, altura = bitmap.height;
  bitmap.close();
  const id = gerarId('img');
  try {
    await salvarImagem({ id, guiaId: guia.id, blob, largura, altura, mime: blob.type });
  } catch (e) {
    // cota estourada ou transação falha: sem aviso o passo ficaria «Sem imagem» sem explicação
    console.warn('Falha ao gravar a imagem anexada', e);
    avisar('Não foi possível gravar a imagem neste navegador (espaço insuficiente?). Exclua guias antigos ou exporte um .stepbystep.zip e tente de novo.', { tipo: 'erro' });
    return;
  }
  aplicar('anexar imagem', (g) => {
    const p = g.passos.find((x) => x.id === passoId);
    if (!p) return;
    const anterior = p.captura ?? {};
    const viewport = anterior.viewport?.largura > 0 ? anterior.viewport : { largura, altura };
    const escala = largura / viewport.largura;
    p.captura = { imagemId: id, largura, altura, dpr: anterior.dpr ?? 1, viewport, escala, fonte: anterior.fonte && anterior.fonte !== 'manual' && anterior.faltante ? anterior.fonte : 'manual', faltante: false };
    const imagem = { largura, altura };
    if (p.alvo?.rectCss) {
      p.alvo.bbox = cssParaImagem(p.alvo.rectCss, viewport, imagem);
      if (p.alvo.ponto) p.alvo.ponto = pontoParaImagem({ x: p.alvo.rectCss.x + p.alvo.rectCss.w / 2, y: p.alvo.rectCss.y + p.alvo.rectCss.h / 2 }, viewport, imagem);
    }
    if (!p.anotacoes.length) {
      const n = g.passos.indexOf(p);
      const numero = g.passos.slice(0, n + 1).filter((x) => x.tipo !== 'secao').length;
      p.anotacoes = anotacoesAutomaticas(p, { numero });
    }
  });
  avisar('Imagem anexada ao passo.', { tipo: 'sucesso' });
}

/** Lê uma imagem do clipboard (evento paste) e anexa ao passo atual. @returns {boolean} tratou */
export function colarImagem(evento) {
  const passo = passoAtual();
  if (!passo || passo.tipo === 'secao') return false;
  const item = [...(evento.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const arquivo = item?.getAsFile();
  if (!arquivo) return false;
  evento.preventDefault();
  anexarImagemAoPasso(passo.id, arquivo).catch(aoFalharAnexo);
  return true;
}

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}
function campo(rotulo, controle, id) {
  const wrap = el('div', 'campo');
  const label = el('label', 'dxt-label', rotulo);
  if (id) { controle.id = id; label.htmlFor = id; }
  wrap.append(label, controle);
  return wrap;
}

export function montarPainel(raiz, opcoes = {}) {
  raiz.classList.add('painel-passo');
  const form = el('div', 'painel-form');
  raiz.append(form);

  // --- cabeçalho do passo
  const cabecalho = el('div', 'painel-cabecalho');
  const eyebrow = el('span', 'dxt-eyebrow');
  const badgeAuto = el('span', 'dxt-badge dxt-badge--info', 'título automático');
  badgeAuto.title = 'Gerado a partir da captura; editar o título desliga a geração.';
  cabecalho.append(eyebrow, badgeAuto);

  // --- título
  const titulo = el('input', 'dxt-input');
  titulo.type = 'text';
  titulo.placeholder = 'Título do passo';
  titulo.autocomplete = 'off';
  const linhaTitulo = el('div', 'campo-linha');
  const btnRegerar = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm', 'Regerar');
  btnRegerar.type = 'button';
  btnRegerar.title = 'Gerar o título de novo a partir da captura';
  linhaTitulo.append(titulo, btnRegerar);
  const campoTitulo = campo('Título', linhaTitulo);
  campoTitulo.querySelector('label').htmlFor = 'passo-titulo';
  titulo.id = 'passo-titulo';

  // --- descrição
  const descricao = el('textarea', 'dxt-input');
  descricao.rows = 3;
  descricao.placeholder = 'Observações que ajudam quem segue o manual';
  const campoDescricao = campo('Descrição', descricao, 'passo-descricao');

  // --- tipo
  const tipo = el('select', 'dxt-select');
  for (const t of TIPOS_PASSO) { const o = el('option', '', NOMES_TIPO[t]); o.value = t; tipo.append(o); }
  const campoTipo = campo('Tipo', tipo, 'passo-tipo');

  // --- imagem
  const secImagem = el('section', 'painel-secao painel-imagem');

  // --- metadados
  const secMeta = el('section', 'painel-secao');

  // --- anotações
  const secAnot = el('section', 'painel-secao');
  const tituloAnot = el('h3', 'painel-secao-titulo', 'Anotações');
  const listaAnot = el('ul', 'lista-anotacoes');
  listaAnot.id = 'passo-anotacoes';
  secAnot.append(tituloAnot, listaAnot);

  // --- guia
  const secGuia = el('section', 'painel-secao');
  secGuia.append(el('h3', 'painel-secao-titulo', 'Guia'));
  const corGuia = el('select', 'dxt-select');
  for (const c of TOKENS_COR) { const o = el('option', '', NOMES_COR[c]); o.value = c; corGuia.append(o); }
  const holofote = el('input');
  holofote.type = 'checkbox';
  holofote.id = 'guia-holofote';
  const rotuloHolofote = el('label', 'campo-check');
  rotuloHolofote.htmlFor = 'guia-holofote';
  rotuloHolofote.append(holofote, document.createTextNode(' Escurecer fora do alvo (holofote)'));
  const descGuia = el('textarea', 'dxt-input');
  descGuia.rows = 2;
  descGuia.placeholder = 'Uma frase sobre o que este manual ensina';
  const autorGuia = el('input', 'dxt-input');
  autorGuia.type = 'text';
  autorGuia.placeholder = 'Quem escreveu';
  secGuia.append(campo('Cor de destaque', corGuia, 'guia-cor'), rotuloHolofote, campo('Descrição do guia', descGuia, 'guia-descricao'), campo('Autor', autorGuia, 'guia-autor'));

  const vazio = el('p', 'painel-vazio', 'Selecione um passo para editar título, descrição e anotações.');
  form.append(cabecalho, campoTitulo, campoDescricao, campoTipo, secImagem, secMeta, secAnot, secGuia);
  raiz.append(vazio);

  // ---- ligações
  titulo.addEventListener('input', () => { const p = passoAtual(); if (p) renomearPasso(p.id, titulo.value); });
  btnRegerar.addEventListener('click', () => { const p = passoAtual(); if (p) regerarTitulo(p.id); });
  descricao.addEventListener('input', () => {
    const p = passoAtual();
    if (!p) return;
    aplicar('editar descrição', (g) => { const x = g.passos.find((y) => y.id === p.id); if (x) x.descricao = descricao.value; }, { coalescer: `descricao:${p.id}` });
  });
  tipo.addEventListener('change', async () => {
    const p = passoAtual();
    if (!p) return;
    const novo = tipo.value;
    // seção é só um título (3.5: captura, alvo e evento nulos): o que o passo tinha vai embora, com confirmação
    if (novo === 'secao' && (p.captura || p.anotacoes.length || p.alvo)) {
      const ok = await confirmar('Uma seção é só um título: a imagem, as anotações e o alvo deste passo serão removidos (dá para desfazer com Ctrl/⌘+Z). Continuar?', { titulo: 'Transformar em seção', ok: 'Transformar', perigo: true });
      if (!ok) { tipo.value = passoAtual()?.tipo ?? p.tipo; return; }
    }
    aplicar('mudar tipo do passo', (g) => {
      const x = g.passos.find((y) => y.id === p.id);
      if (!x) return;
      x.tipo = novo;
      if (novo === 'secao' || novo === 'manual') x.tituloAuto = false;
      if (novo === 'secao') { x.captura = null; x.anotacoes = []; x.alvo = null; x.evento = null; x.resultado = null; }
    });
    if (novo === 'secao') selecionarAnotacao(null);
  });
  corGuia.addEventListener('change', () => aplicar('mudar cor de destaque', (g) => { g.estilo.cor = corGuia.value; }));
  holofote.addEventListener('change', () => aplicar('holofote', (g) => { g.estilo.escurecerFora = holofote.checked; }));
  descGuia.addEventListener('input', () => aplicar('editar descrição do guia', (g) => { g.descricao = descGuia.value; }, { coalescer: 'guia:descricao' }));
  autorGuia.addEventListener('input', () => aplicar('editar autor', (g) => { g.autor = autorGuia.value; }, { coalescer: 'guia:autor' }));

  const sincronizar = (input, valor) => { if (document.activeElement !== input && input.value !== valor) input.value = valor; };

  function renderImagem(p) {
    secImagem.replaceChildren(el('h3', 'painel-secao-titulo', 'Imagem'));
    if (p.tipo === 'secao') { secImagem.append(el('p', 'painel-nota', 'Seções não têm imagem.')); return; }
    const entrada = el('input');
    entrada.type = 'file';
    entrada.accept = 'image/png,image/jpeg,image/webp';
    entrada.hidden = true;
    entrada.id = 'passo-imagem-arquivo';
    entrada.addEventListener('change', () => { const f = entrada.files?.[0]; if (f) anexarImagemAoPasso(p.id, f).catch(aoFalharAnexo); entrada.value = ''; });
    const botao = el('label', 'dxt-btn dxt-btn--ghost dxt-btn--sm');
    botao.htmlFor = entrada.id;
    if (temImagem(p)) {
      const c = p.captura;
      const info = el('p', 'painel-info dxt-num', `${c.largura} × ${c.altura} px · escala ${Number(c.escala ?? 1).toFixed(2).replace(/\.?0+$/, '')}× · ${NOMES_FONTE[c.fonte] ?? c.fonte ?? ''}`);
      botao.textContent = 'Substituir imagem';
      secImagem.append(info, botao, entrada);
    } else {
      const aviso = el('p', 'painel-aviso');
      aviso.textContent = p.captura?.faltante ? 'A captura falhou neste passo — anexe uma imagem para anotar.' : 'Sem imagem. Anexe um arquivo ou cole do clipboard (Ctrl/⌘+V).';
      botao.textContent = p.captura?.faltante ? 'Anexar imagem' : 'Adicionar imagem';
      secImagem.append(aviso, botao, entrada);
    }
  }

  function renderMeta(p) {
    secMeta.replaceChildren(el('h3', 'painel-secao-titulo', 'Contexto'));
    const dl = el('dl', 'painel-meta');
    const linha = (rotulo, valor, classe = '') => {
      if (valor === null || valor === undefined || valor === '') return;
      dl.append(el('dt', '', rotulo));
      const dd = el('dd', classe);
      if (valor instanceof Node) dd.append(valor); else dd.textContent = String(valor);
      dl.append(dd);
    };
    const c = p.contexto ?? {};
    if (c.url) { const a = el('a', '', abreviarUrl(c.url)); a.href = c.url; a.target = '_blank'; a.rel = 'noopener'; a.title = c.url; linha('URL', a); }
    linha('Página', c.tituloPagina);
    linha('App', c.app);
    linha('Janela', c.janela);
    if (p.alvo?.rotulo) linha('Alvo', `${p.alvo.rotulo}${p.alvo.papel ? ` (${p.alvo.papel})` : ''}`);
    if (p.alvo?.menu) linha('Menu', p.alvo.menu);
    if (p.evento?.sensivel) linha('Valor', 'campo sensível — não gravado', 'painel-meta-atencao');
    else if (typeof p.evento?.valor === 'string' && p.evento.valor) linha('Valor digitado', p.evento.valor, 'dxt-num');
    if (p.evento?.opcao) linha('Opção', p.evento.opcao);
    if (p.evento?.atalho) linha('Atalho', p.evento.atalho, 'dxt-num');
    if (p.resultado?.url) linha('Levou a', abreviarUrl(p.resultado.url));
    linha('Registrado em', formatarData(p.criadoEm), 'dxt-num');
    if (p.mescladoDe?.length > 1) linha('Mesclado de', `${p.mescladoDe.length} passos`);
    if (!dl.children.length) dl.append(el('dt', '', '—'), el('dd', '', 'Sem contexto registrado'));
    secMeta.append(dl);
  }

  function renderAnotacoes(p) {
    listaAnot.replaceChildren();
    if (!p.anotacoes.length) {
      listaAnot.append(el('li', 'painel-nota', temImagem(p) ? 'Nenhuma anotação. Use as ferramentas sobre a imagem (R, A, M, T, B, C).' : 'Anote depois de anexar uma imagem.'));
      return;
    }
    for (const a of p.anotacoes) {
      const li = el('li', 'anotacao-item');
      li.dataset.id = a.id;
      if (a.id === estado.selecaoAnotacaoId) li.classList.add('is-selecionada');
      const cor = el('span', 'anotacao-cor');
      cor.style.setProperty('--cor', a.tipo === 'recorte' || a.tipo === 'desfoque' ? 'transparent' : `var(--anot-${a.cor})`);
      const nome = el('button', 'anotacao-nome', NOMES_ANOTACAO[a.tipo] ?? a.tipo);
      nome.type = 'button';
      let detalhe = '';
      if (a.tipo === 'marcador') detalhe = `nº ${a.numero}`;
      else if (a.tipo === 'texto') detalhe = `«${a.texto}»`;
      else if (a.w !== undefined) detalhe = `${Math.round(a.w)} × ${Math.round(a.h)}`;
      const det = el('span', 'anotacao-detalhe dxt-num', detalhe);
      const auto = a.auto ? el('span', 'dxt-badge', 'auto') : null;
      const excluir = el('button', 'anotacao-excluir', '×');
      excluir.type = 'button';
      excluir.setAttribute('aria-label', `Excluir ${NOMES_ANOTACAO[a.tipo] ?? a.tipo}`);
      excluir.title = 'Excluir anotação';
      nome.addEventListener('click', () => selecionarAnotacao(a.id));
      excluir.addEventListener('click', () => excluirAnotacao(p.id, a.id));
      li.append(cor, nome, det);
      if (auto) li.append(auto);
      li.append(excluir);
      listaAnot.append(li);
    }
  }

  function atualizar(motivo) {
    const guia = estado.guia;
    const p = passoAtual();
    if (!guia || !p) { form.hidden = true; vazio.hidden = false; return; }
    form.hidden = false;
    vazio.hidden = true;
    const i = indiceDoPasso(p.id);
    const numero = guia.passos.slice(0, i + 1).filter((x) => x.tipo !== 'secao').length;
    eyebrow.textContent = p.tipo === 'secao' ? 'Seção' : `Passo ${String(numero).padStart(2, '0')} · ${NOMES_TIPO[p.tipo] ?? p.tipo}`;
    badgeAuto.hidden = !p.tituloAuto;
    btnRegerar.hidden = p.tipo === 'secao' || p.tipo === 'manual';
    sincronizar(titulo, p.titulo);
    sincronizar(descricao, p.descricao ?? '');
    sincronizar(tipo, p.tipo);
    sincronizar(corGuia, guia.estilo?.cor ?? 'cerceta');
    if (document.activeElement !== holofote) holofote.checked = guia.estilo?.escurecerFora !== false;
    sincronizar(descGuia, guia.descricao ?? '');
    sincronizar(autorGuia, guia.autor ?? '');
    if (motivo !== 'selecao') { renderImagem(p); renderMeta(p); }
    renderAnotacoes(p);
  }

  const cancelar = on('mudou', ({ motivo }) => { if (motivo !== 'zoom' && motivo !== 'ferramenta') atualizar(motivo); });
  atualizar('guia');
  return { atualizar, destruir() { cancelar(); raiz.replaceChildren(); } };
}
