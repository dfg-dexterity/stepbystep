// Coluna esquerda: cartões de passo com miniatura (160 px), número mono e título.
// Reordenar por arraste (Pointer Events + setPointerCapture) ou Alt+↑/↓; menu de ações por passo.
import { criarPasso, renumerarMarcadores, numeroDoPasso } from '../core/modelo.js';
import { gerarTitulo } from '../core/frases.js';
import { gerarId } from '../core/ids.js';
import { desenharPasso } from '../core/render-canvas.js';
import { separarRecorte, areaSaida } from '../core/anotacoes.js';
import { estado, on, selecionarPasso, indiceDoPasso, plataformaDoGuia, temImagem } from './estado.js';
import { aplicar } from './historico.js';
import { obterBitmap, esquecerBitmap, bitmapFechado, criarCanvas } from './canvas-anotacao.js';
import { abrirMenu } from './componentes/menu.js';
import { confirmar, perguntar } from './componentes/dialogo.js';
import { avisar } from './componentes/aviso.js';

const LARGURA_MINI = 160;

export const NOMES_TIPO = {
  navegar: 'Navegação', clicar: 'Clique', digitar: 'Digitação', selecionar: 'Seleção', marcar: 'Marcação',
  tecla: 'Tecla', secao: 'Seção', manual: 'Manual',
};

const minusculaInicial = (t) => {
  const s = String(t ?? '');
  return s && !/^[«"“]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
};
const passoPorId = (guia, id) => guia.passos.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// Operações sobre passos (também usadas pelo app e pelo painel)
// ---------------------------------------------------------------------------
export function moverPasso(id, delta) {
  const de = indiceDoPasso(id);
  if (de < 0) return false;
  const para = de + delta;
  if (para < 0 || para >= estado.guia.passos.length) return false;
  aplicar('reordenar passos', (guia) => {
    const [p] = guia.passos.splice(de, 1);
    guia.passos.splice(para, 0, p);
    renumerarMarcadores(guia);
  });
  return true;
}

export function reordenarPasso(de, para) {
  if (de === para || de < 0 || para < 0) return;
  aplicar('reordenar passos', (guia) => {
    if (de >= guia.passos.length || para >= guia.passos.length) return;
    const [p] = guia.passos.splice(de, 1);
    guia.passos.splice(para, 0, p);
    renumerarMarcadores(guia);
  });
}

export async function excluirPasso(id, { confirmarAntes = true } = {}) {
  const guia = estado.guia;
  const passo = passoPorId(guia, id);
  if (!passo) return false;
  if (confirmarAntes) {
    const ok = await confirmar(`Excluir o passo «${passo.titulo || NOMES_TIPO[passo.tipo]}»? Você pode desfazer com Ctrl/⌘+Z.`, { titulo: 'Excluir passo', ok: 'Excluir', perigo: true });
    if (!ok) return false;
  }
  const i = indiceDoPasso(id);
  aplicar('excluir passo', (g) => {
    g.passos.splice(i, 1);
    renumerarMarcadores(g);
  });
  const vizinho = estado.guia.passos[Math.min(i, estado.guia.passos.length - 1)];
  selecionarPasso(vizinho?.id ?? null);
  return true;
}

export function inserirManual(idReferencia, posicao = 'depois') {
  const novo = criarPasso({ tipo: 'manual', titulo: 'Novo passo', tituloAuto: false });
  aplicar('inserir passo manual', (guia) => {
    const i = guia.passos.findIndex((p) => p.id === idReferencia);
    const alvo = i < 0 ? guia.passos.length : posicao === 'antes' ? i : i + 1;
    guia.passos.splice(alvo, 0, novo);
    renumerarMarcadores(guia);
  });
  selecionarPasso(novo.id);
  return novo.id;
}

export async function inserirSecao(idReferencia) {
  const titulo = await perguntar('Título da seção', { titulo: 'Nova seção', placeholder: 'Ex.: Conferência no SAP GUI', rotulo: 'Inserir' });
  if (!titulo) return null;
  const novo = criarPasso({ tipo: 'secao', titulo, tituloAuto: false });
  aplicar('inserir seção', (guia) => {
    const i = guia.passos.findIndex((p) => p.id === idReferencia);
    guia.passos.splice(i < 0 ? guia.passos.length : i + 1, 0, novo);
    renumerarMarcadores(guia);
  });
  selecionarPasso(novo.id);
  return novo.id;
}

export function duplicarPasso(id) {
  const original = passoPorId(estado.guia, id);
  if (!original) return null;
  const copia = structuredClone(original);
  copia.id = gerarId('p');
  copia.criadoEm = new Date().toISOString();
  copia.anotacoes = copia.anotacoes.map((a) => ({ ...a, id: gerarId('a') }));
  if (temImagem(copia)) copia.captura = { ...copia.captura, fonte: 'compartilhada' };
  delete copia.mescladoDe;
  aplicar('duplicar passo', (guia) => {
    const i = guia.passos.findIndex((p) => p.id === id);
    guia.passos.splice(i + 1, 0, copia);
    renumerarMarcadores(guia);
  });
  selecionarPasso(copia.id);
  return copia.id;
}

/**
 * Mescla o passo com o anterior: tipo/imagem do primeiro; título do primeiro se editado à mão,
 * senão "A e b"; anotações de B só se a imagem for a mesma; descrições concatenadas; mescladoDe.
 */
export function mesclarComAnterior(id) {
  const guia = estado.guia;
  const i = indiceDoPasso(id);
  if (i <= 0) { avisar('Não há passo anterior para mesclar.', { tipo: 'atencao' }); return false; }
  const a = guia.passos[i - 1], b = guia.passos[i];
  if (a.tipo === 'secao' || b.tipo === 'secao') { avisar('Seções não podem ser mescladas com passos.', { tipo: 'atencao' }); return false; }
  aplicar('mesclar passos', (g) => {
    const A = g.passos[i - 1], B = g.passos[i];
    A.titulo = A.tituloAuto === false ? A.titulo : `${A.titulo} e ${minusculaInicial(B.titulo)}`;
    A.tituloAuto = false;
    A.descricao = [A.descricao, B.descricao].filter(Boolean).join('\n\n');
    if (temImagem(A) && temImagem(B) && A.captura.imagemId === B.captura.imagemId) {
      const temRecorte = A.anotacoes.some((x) => x.tipo === 'recorte');
      for (const an of B.anotacoes) {
        if (an.tipo === 'recorte' && temRecorte) continue;
        A.anotacoes.push({ ...an, id: gerarId('a') });
      }
    } else if (!temImagem(A) && temImagem(B)) {
      // o primeiro não tinha imagem (ex.: tecla sem captura): herda a do segundo
      A.captura = B.captura;
      A.anotacoes = B.anotacoes.map((an) => ({ ...an, id: gerarId('a') }));
    }
    A.mescladoDe = [...(A.mescladoDe ?? [A.id]), ...(B.mescladoDe ?? [B.id])];
    g.passos.splice(i, 1);
    renumerarMarcadores(g);
  });
  selecionarPasso(a.id);
  return true;
}

export function regerarTitulo(id) {
  const passo = passoPorId(estado.guia, id);
  if (!passo) return;
  if (passo.tipo === 'secao' || passo.tipo === 'manual') { avisar('Seções e passos manuais têm título só seu: não há frase para gerar.', { tipo: 'info' }); return; }
  const plataforma = plataformaDoGuia(estado.guia);
  aplicar('regerar título', (guia) => {
    const p = passoPorId(guia, id);
    p.titulo = gerarTitulo(p, { plataforma });
    p.tituloAuto = true;
  });
}

export function renomearPasso(id, titulo) {
  aplicar('editar título', (guia) => {
    const p = passoPorId(guia, id);
    if (!p) return;
    p.titulo = titulo;
    p.tituloAuto = false;
  }, { coalescer: `titulo:${id}` });
}

/** Itens do menu de ações de um passo. */
export function itensDoMenu(id) {
  const guia = estado.guia;
  const i = indiceDoPasso(id);
  const p = guia.passos[i];
  const anterior = guia.passos[i - 1];
  const podeMesclar = i > 0 && p.tipo !== 'secao' && anterior?.tipo !== 'secao';
  return [
    { rotulo: 'Renomear', atalho: 'F2', acao: async () => { const t = await perguntar('Título do passo', { valor: p.titulo, rotulo: 'Salvar', titulo: 'Renomear passo' }); if (t !== null && t !== p.titulo) renomearPasso(id, t); } },
    { rotulo: 'Regerar título', desabilitado: p.tipo === 'secao' || p.tipo === 'manual', acao: () => regerarTitulo(id) },
    { separador: true },
    { rotulo: 'Inserir passo manual antes', acao: () => inserirManual(id, 'antes') },
    { rotulo: 'Inserir passo manual depois', acao: () => inserirManual(id, 'depois') },
    { rotulo: 'Inserir seção depois', acao: () => inserirSecao(id) },
    { rotulo: 'Duplicar', acao: () => duplicarPasso(id) },
    { rotulo: 'Mesclar com o anterior', desabilitado: !podeMesclar, acao: () => mesclarComAnterior(id) },
    { separador: true },
    { rotulo: 'Mover para cima', atalho: 'Alt+↑', desabilitado: i === 0, acao: () => moverPasso(id, -1) },
    { rotulo: 'Mover para baixo', atalho: 'Alt+↓', desabilitado: i === guia.passos.length - 1, acao: () => moverPasso(id, 1) },
    { separador: true },
    { rotulo: 'Excluir', atalho: 'Delete', perigo: true, acao: () => excluirPasso(id) },
  ];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export function montarListaPassos(raiz) {
  raiz.classList.add('lista-passos');
  const ol = document.createElement('ol');
  ol.className = 'lista-passos-itens';
  ol.setAttribute('aria-label', 'Passos do guia');
  const indicador = document.createElement('div');
  indicador.className = 'lista-indicador';
  indicador.hidden = true;
  const vazio = document.createElement('div');
  vazio.className = 'lista-vazia';
  vazio.hidden = true;
  vazio.innerHTML = '<p>Este guia ainda não tem passos.</p><p class="dica">Use o botão <strong>+ Passo</strong> para criar um passo manual, ou importe uma gravação.</p>';
  raiz.append(ol, indicador, vazio);

  const miniaturas = new Map(); // passoId → { assinatura, canvas }
  const cartoes = new Map();    // passoId → { li, assinatura }: o cartão só é recriado quando algo visível nele muda
  const fila = [];
  let processando = false;
  let destruido = false;

  const assinatura = (p, guia) => `${p.captura?.imagemId}|${JSON.stringify(p.anotacoes)}|${guia.estilo?.cor}|${guia.estilo?.escurecerFora}`;
  const assinaturaCartao = (p, i, guia) => [p.tipo, numeroDoPasso(guia, i), p.titulo, !!p.captura?.faltante, !!p.evento?.sensivel, temImagem(p), assinatura(p, guia)].join('\u0000');

  async function renderizarMiniatura(passoId, alvo) {
    const guia = estado.guia;
    const passo = guia && passoPorId(guia, passoId);
    if (!passo || !temImagem(passo) || !alvo.isConnected) return;
    const ass = assinatura(passo, guia);
    const cacheado = miniaturas.get(passoId);
    if (cacheado && cacheado.assinatura === ass) { alvo.replaceChildren(cacheado.canvas); return; }
    let bmp = await obterBitmap(passo.captura.imagemId);
    if (bitmapFechado(bmp)) { esquecerBitmap(passo.captura.imagemId); bmp = await obterBitmap(passo.captura.imagemId); }   // fechado pelo LRU: recarrega
    if (destruido || !bmp || !alvo.isConnected) return;
    const imagem = { largura: bmp.width, altura: bmp.height, fonte: bmp };
    const { recorte } = separarRecorte(passo.anotacoes);
    const area = areaSaida(imagem, recorte);
    // backing store em pixels físicos (até 2x) para a miniatura ficar nítida em telas Retina
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const escala = (LARGURA_MINI * dpr) / area.w;
    const c = document.createElement('canvas');
    c.width = Math.round(LARGURA_MINI * dpr);
    c.height = Math.max(1, Math.round(area.h * escala));
    c.className = 'miniatura';
    try {
      desenharPasso(c.getContext('2d'), imagem, passo, { escala, estilo: guia.estilo, criarCanvas });
    } catch (e) { console.warn('Miniatura não desenhada', e); return; }
    miniaturas.set(passoId, { assinatura: ass, canvas: c });
    alvo.replaceChildren(c);
  }

  function enfileirar(passoId, alvo) {
    fila.push({ passoId, alvo });
    processar();
  }
  async function processar() {
    if (processando) return;
    processando = true;
    while (fila.length && !destruido) {
      const { passoId, alvo } = fila.shift();
      try { await renderizarMiniatura(passoId, alvo); } catch (e) { console.warn(e); }
    }
    processando = false;
  }

  const visiveis = new IntersectionObserver((entradas) => {
    for (const en of entradas) {
      if (!en.isIntersecting) continue;
      visiveis.unobserve(en.target);
      enfileirar(en.target.dataset.passoId, en.target);
    }
  }, { root: raiz, rootMargin: '240px 0px' });

  // ---- arraste para reordenar ----
  let arrasto = null;
  function indiceDestino(y) {
    const cartoes = [...ol.children];
    for (let i = 0; i < cartoes.length; i++) {
      const r = cartoes[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return cartoes.length;
  }
  function mostrarIndicador(indice) {
    const cartoes = [...ol.children];
    const olRect = ol.getBoundingClientRect();
    let y;
    if (indice < cartoes.length) y = cartoes[indice].getBoundingClientRect().top;
    else y = cartoes[cartoes.length - 1]?.getBoundingClientRect().bottom ?? olRect.top;
    indicador.style.top = `${y - olRect.top + ol.scrollTop}px`;
    indicador.hidden = false;
  }

  function cartao(passo, indice) {
    const guia = estado.guia;
    const li = document.createElement('li');
    li.className = `passo-cartao passo-cartao--${passo.tipo}`;
    li.dataset.id = passo.id;
    li.tabIndex = 0;
    // lista comum (<ol>/<li>): um item com botão «⋯» dentro não pode ser option de listbox; o atual leva aria-current
    if (passo.id === estado.passoAtualId) { li.classList.add('is-atual'); li.setAttribute('aria-current', 'true'); }
    const n = numeroDoPasso(guia, indice);

    if (passo.tipo !== 'secao') {
      const mini = document.createElement('div');
      mini.className = 'passo-cartao-mini';
      mini.dataset.passoId = passo.id;
      if (temImagem(passo)) {
        const cacheado = miniaturas.get(passo.id);
        if (cacheado && cacheado.assinatura === assinatura(passo, guia)) mini.append(cacheado.canvas);
        else visiveis.observe(mini);
      } else {
        const semImagem = document.createElement('span');
        semImagem.className = `mini-vazia${passo.captura?.faltante ? ' mini-vazia--faltante' : ''}`;
        semImagem.textContent = passo.captura?.faltante ? 'Captura faltante' : 'Sem imagem';
        mini.append(semImagem);
      }
      li.append(mini);
    }

    const corpo = document.createElement('div');
    corpo.className = 'passo-cartao-corpo';
    const linha = document.createElement('div');
    linha.className = 'passo-cartao-linha';
    const numero = document.createElement('span');
    numero.className = 'numero dxt-num';
    numero.textContent = passo.tipo === 'secao' ? '§' : String(n).padStart(2, '0');
    const tipo = document.createElement('span');
    tipo.className = 'passo-cartao-tipo';
    tipo.textContent = NOMES_TIPO[passo.tipo] ?? passo.tipo;
    linha.append(numero, tipo);
    if (passo.evento?.sensivel) { const b = document.createElement('span'); b.className = 'dxt-badge dxt-badge--down'; b.textContent = 'sensível'; linha.append(b); }
    if (passo.captura?.faltante) { const b = document.createElement('span'); b.className = 'dxt-badge dxt-badge--down'; b.textContent = 'sem imagem'; linha.append(b); }
    const titulo = document.createElement('div');
    titulo.className = 'titulo';
    titulo.textContent = passo.titulo || (passo.tipo === 'secao' ? 'Seção sem título' : 'Passo sem título');
    corpo.append(linha, titulo);
    li.append(corpo);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.setAttribute('aria-label', `Ações do passo ${n ?? ''}`.trim());
    btn.setAttribute('aria-haspopup', 'menu');
    btn.textContent = '⋯';
    btn.addEventListener('click', (e) => { e.stopPropagation(); selecionarPasso(passo.id); abrirMenu(btn, itensDoMenu(passo.id), { alinhar: 'direita' }); });
    li.append(btn);

    li.addEventListener('contextmenu', (e) => { e.preventDefault(); selecionarPasso(passo.id); abrirMenu(btn, itensDoMenu(passo.id), { alinhar: 'direita' }); });
    li.addEventListener('keydown', (e) => aoTeclarCartao(e, passo.id, li));

    li.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      arrasto = { id: passo.id, y0: e.clientY, ativo: false, destino: null, pointerId: e.pointerId };
      li.setPointerCapture(e.pointerId);
    });
    li.addEventListener('pointermove', (e) => {
      if (!arrasto || arrasto.id !== passo.id) return;
      if (!arrasto.ativo) {
        if (Math.abs(e.clientY - arrasto.y0) < 6) return;
        arrasto.ativo = true;
        li.classList.add('is-arrastando');
      }
      arrasto.destino = indiceDestino(e.clientY);
      mostrarIndicador(arrasto.destino);
      // rolagem automática perto das bordas da lista
      const r = raiz.getBoundingClientRect();
      if (e.clientY < r.top + 32) raiz.scrollTop -= 8;
      else if (e.clientY > r.bottom - 32) raiz.scrollTop += 8;
    });
    const terminar = (e) => {
      if (!arrasto || arrasto.id !== passo.id) return;
      const a = arrasto;
      arrasto = null;
      li.classList.remove('is-arrastando');
      indicador.hidden = true;
      if (!a.ativo) { if (e.type === 'pointerup') selecionarPasso(passo.id); return; }
      const de = indiceDoPasso(passo.id);
      let para = a.destino;
      if (para === null) return;
      if (para > de) para -= 1;
      if (para !== de) reordenarPasso(de, para);
    };
    li.addEventListener('pointerup', terminar);
    li.addEventListener('pointercancel', terminar);
    return li;
  }

  function aoTeclarCartao(e, id, li) {
    const k = e.key;
    // teclas tratadas aqui não chegam aos atalhos globais (Delete apagaria também a anotação selecionada)
    const tratar = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'Enter' || k === ' ') { tratar(); selecionarPasso(id); return; }
    if ((k === 'ArrowDown' || k === 'ArrowUp') && e.altKey) {
      tratar();
      if (moverPasso(id, k === 'ArrowDown' ? 1 : -1)) focarPasso(id);
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      tratar();
      const irmao = k === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
      if (irmao) { irmao.focus(); selecionarPasso(irmao.dataset.id); }
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { tratar(); excluirPasso(id); return; }
    if (k === 'F2') { tratar(); itensDoMenu(id)[0].acao(); return; }
    if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) { tratar(); abrirMenu(li.querySelector('.menu-btn'), itensDoMenu(id), { alinhar: 'direita' }); }
  }

  function focarPasso(id) {
    const li = ol.querySelector(`[data-id="${CSS.escape(id)}"]`);
    li?.focus({ preventScroll: false });
  }

  /** Cartão que sai da lista: a miniatura pendente deixa de ser observada (a fila ignora nós desconectados). */
  function descartarCartao(li) {
    const mini = li.querySelector('.passo-cartao-mini');
    if (mini) visiveis.unobserve(mini);
  }

  /**
   * Reconcilia a lista com o guia: cartões cuja assinatura (tipo, número, título, selos, miniatura) não mudou são
   * reaproveitados — digitar na descrição emite 'mudou' a cada tecla e não pode recriar centenas de nós.
   */
  function renderizar() {
    const guia = estado.guia;
    if (!guia) {
      for (const { li } of cartoes.values()) descartarCartao(li);
      cartoes.clear();
      fila.length = 0;
      ol.replaceChildren();
      vazio.hidden = true;
      return;
    }
    vazio.hidden = guia.passos.length > 0;
    // esquece miniaturas e cartões de passos que não existem mais
    const ids = new Set(guia.passos.map((p) => p.id));
    for (const id of [...miniaturas.keys()]) if (!ids.has(id)) miniaturas.delete(id);
    for (const [id, c] of [...cartoes]) if (!ids.has(id)) { descartarCartao(c.li); cartoes.delete(id); }
    const desejados = guia.passos.map((p, i) => {
      const ass = assinaturaCartao(p, i, guia);
      const c = cartoes.get(p.id);
      if (c && c.assinatura === ass) return c.li;
      if (c) descartarCartao(c.li);
      const li = cartao(p, i);
      cartoes.set(p.id, { li, assinatura: ass });
      return li;
    });
    const atuais = [...ol.children];
    if (desejados.length !== atuais.length || desejados.some((li, i) => li !== atuais[i])) ol.replaceChildren(...desejados);
  }

  function marcarAtual() {
    for (const li of ol.children) {
      const atual = li.dataset.id === estado.passoAtualId;
      li.classList.toggle('is-atual', atual);
      if (atual) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
      if (atual && !li.matches(':focus-within')) li.scrollIntoView({ block: 'nearest' });
    }
  }

  const cancelar = on('mudou', ({ motivo }) => {
    if (motivo === 'guia') { renderizar(); marcarAtual(); }
    else if (motivo === 'passo') marcarAtual();
  });
  renderizar();
  marcarAtual();

  return {
    renderizar,
    focarPasso,
    destruir() { destruido = true; cancelar(); visiveis.disconnect(); miniaturas.clear(); cartoes.clear(); raiz.replaceChildren(); },
  };
}
