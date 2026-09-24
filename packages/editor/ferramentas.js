// Máquina de estados das ferramentas de anotação sobre a camada de preview do canvas.
// Cada gesto concluído vira UMA entrada do histórico (nunca por pointermove): durante o gesto o
// canvas desenha uma lista provisória; ao soltar, aplica-se ao guia.
import { criarAnotacao, numeroDoPasso } from '../core/modelo.js';
import { hitTest, moverAnotacao } from '../core/anotacoes.js';
import { medidas } from '../core/render-canvas.js';
import { limitarAImagem, recorteFocado } from '../core/coordenadas.js';
import { estado, passoAtual, anotacaoSelecionada, definirFerramenta, selecionarAnotacao, ehEditavel, indiceDoPasso, temImagem } from './estado.js';
import { aplicar } from './historico.js';
import { alcas } from './canvas-anotacao.js';
import { avisar } from './componentes/aviso.js';

export const FERRAMENTAS = [
  { id: 'selecionar', rotulo: 'Selecionar', tecla: 'V', dica: 'Selecionar, mover e redimensionar' },
  { id: 'recorte', rotulo: 'Recorte', tecla: 'C', dica: 'Janela de saída da imagem (um só recorte)' },
  { id: 'desfoque', rotulo: 'Desfoque', tecla: 'B', dica: 'Pixeliza uma área (irreversível na exportação)' },
  { id: 'retangulo', rotulo: 'Retângulo', tecla: 'R', dica: 'Destaca uma área com um traço' },
  { id: 'seta', rotulo: 'Seta', tecla: 'A', dica: 'Aponta para um elemento' },
  { id: 'marcador', rotulo: 'Marcador', tecla: 'M', dica: 'Círculo numerado' },
  { id: 'texto', rotulo: 'Texto', tecla: 'T', dica: 'Legenda sobre a imagem' },
];

/** Ícones das ferramentas (SVG inline, traço em currentColor). */
export const ICONES = {
  selecionar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8.5-6.5 1.2L10.5 20z"/></svg>',
  recorte: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v15h15M2 7h15v15"/></svg>',
  desfoque: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z"/></svg>',
  retangulo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3z"/></svg>',
  seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20L20 4M11 4h9v9"/></svg>',
  marcador: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M10.5 9.5l2-1.5v8"/></svg>',
  texto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M12 5v14M9 19h6"/></svg>',
};

/** Opções compartilhadas pela barra de ferramentas (cor das anotações novas, fundo do texto). */
export const opcoesFerramenta = { cor: 'cerceta', fundoTexto: true };

const MIN_ARRASTE_TELA = 3;   // px de tela antes de considerar um arraste
const MIN_LADO = 4;           // px da imagem: retângulos menores são descartados
const MIN_SETA = 8;

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const clampPonto = (p, img) => ({ x: clamp(Math.round(p.x), 0, img.largura), y: clamp(Math.round(p.y), 0, img.altura) });

function rectDePontos(a, b, img) {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  return limitarAImagem({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }, img);
}

/** Move mantendo a anotação dentro da imagem (rects mantêm o tamanho; a seta mantém a forma). */
function moverLimitado(anotacao, dx, dy, img) {
  if (anotacao.tipo === 'seta') {
    const minX = Math.min(anotacao.de.x, anotacao.para.x), maxX = Math.max(anotacao.de.x, anotacao.para.x);
    const minY = Math.min(anotacao.de.y, anotacao.para.y), maxY = Math.max(anotacao.de.y, anotacao.para.y);
    return moverAnotacao(anotacao, clamp(dx, -minX, img.largura - maxX), clamp(dy, -minY, img.altura - maxY));
  }
  if (anotacao.w !== undefined) {
    return moverAnotacao(anotacao, clamp(dx, -anotacao.x, img.largura - anotacao.x - anotacao.w), clamp(dy, -anotacao.y, img.altura - anotacao.y - anotacao.h));
  }
  return moverAnotacao(anotacao, clamp(dx, -anotacao.x, img.largura - anotacao.x), clamp(dy, -anotacao.y, img.altura - anotacao.y));
}

function redimensionar(original, alca, p, img) {
  if (original.tipo === 'seta') {
    const q = clampPonto(p, img);
    return alca === 'de' ? { ...original, de: q } : { ...original, para: q };
  }
  const x0 = original.x, y0 = original.y, x1 = original.x + original.w, y1 = original.y + original.h;
  const fixo = { no: { x: x1, y: y1 }, ne: { x: x0, y: y1 }, so: { x: x1, y: y0 }, se: { x: x0, y: y0 } }[alca];
  const r = rectDePontos(fixo, p, img);
  return { ...original, x: r.x, y: r.y, w: Math.max(1, r.w), h: Math.max(1, r.h) };
}

const substituir = (lista, anotacao) => lista.map((a) => (a.id === anotacao.id ? anotacao : a));

function proximoNumero(passo) {
  const numeros = passo.anotacoes.filter((a) => a.tipo === 'marcador').map((a) => a.numero);
  if (numeros.length) return Math.max(...numeros) + 1;
  return numeroDoPasso(estado.guia, indiceDoPasso(passo.id)) ?? 1;
}

function fundoParaTexto(cor) {
  if (!opcoesFerramenta.fundoTexto) return null;
  return cor === 'off' ? 'base' : 'off';
}

/** Substitui a anotação `id` do passo atual (ou a acrescenta). */
function gravarAnotacao(passoId, anotacao, descricao) {
  aplicar(descricao, (guia) => {
    const p = guia.passos.find((x) => x.id === passoId);
    if (!p) return;
    const i = p.anotacoes.findIndex((a) => a.id === anotacao.id);
    if (i >= 0) p.anotacoes[i] = anotacao;
    else p.anotacoes.push(anotacao);
  });
}

/** Define (ou substitui) o único recorte do passo atual. */
export function definirRecorte(rect) {
  const passo = passoAtual();
  if (!passo || !temImagem(passo)) return;
  const img = { largura: passo.captura.largura, altura: passo.captura.altura };
  const r = limitarAImagem(rect, img);
  if (r.w < MIN_LADO || r.h < MIN_LADO) { avisar('O recorte ficaria pequeno demais.', { tipo: 'atencao' }); return; }
  const recorte = criarAnotacao('recorte', r);
  aplicar('definir recorte', (guia) => {
    const p = guia.passos.find((x) => x.id === passo.id);
    if (!p) return;
    p.anotacoes = [...p.anotacoes.filter((a) => a.tipo !== 'recorte'), recorte];
  });
  selecionarAnotacao(recorte.id);
}

export function removerRecorte() {
  const passo = passoAtual();
  if (!passo?.anotacoes.some((a) => a.tipo === 'recorte')) { avisar('Este passo não tem recorte.', { tipo: 'info' }); return; }
  aplicar('remover recorte', (guia) => {
    const p = guia.passos.find((x) => x.id === passo.id);
    if (p) p.anotacoes = p.anotacoes.filter((a) => a.tipo !== 'recorte');
  });
  selecionarAnotacao(null);
}

/** "Focar no alvo": recorte 16:10 ao redor do bbox do alvo. */
export function focarNoAlvo() {
  const passo = passoAtual();
  if (!passo || !temImagem(passo)) return;
  const bbox = passo.alvo?.bbox;
  if (!bbox || !(bbox.w > 0 && bbox.h > 0)) { avisar('Este passo não tem alvo registrado para focar.', { tipo: 'atencao' }); return; }
  const img = { largura: passo.captura.largura, altura: passo.captura.altura };
  definirRecorte(recorteFocado(bbox, img, { escala: medidas(passo).e }));
}

/** "Recortar à janela": recorte pela janela clicada (Mac). */
export function recortarAJanela() {
  const passo = passoAtual();
  if (!passo || !temImagem(passo)) return;
  const j = passo.alvo?.janelaBbox;
  if (!j || !(j.w > 0 && j.h > 0)) { avisar('Este passo não tem a janela registrada (só gravações no Mac).', { tipo: 'atencao' }); return; }
  definirRecorte(j);
}

export function excluirSelecionada() {
  const passo = passoAtual();
  const sel = anotacaoSelecionada();
  if (!passo || !sel) return false;
  aplicar('excluir anotação', (guia) => {
    const p = guia.passos.find((x) => x.id === passo.id);
    if (p) p.anotacoes = p.anotacoes.filter((a) => a.id !== sel.id);
  });
  selecionarAnotacao(null);
  return true;
}

export function excluirAnotacao(passoId, anotacaoId) {
  aplicar('excluir anotação', (guia) => {
    const p = guia.passos.find((x) => x.id === passoId);
    if (p) p.anotacoes = p.anotacoes.filter((a) => a.id !== anotacaoId);
  });
  if (estado.selecaoAnotacaoId === anotacaoId) selecionarAnotacao(null);
}

const CURSORES = { selecionar: 'default', recorte: 'crosshair', desfoque: 'crosshair', retangulo: 'crosshair', seta: 'crosshair', marcador: 'copy', texto: 'text' };

/**
 * Liga os eventos de ponteiro/teclado às ferramentas.
 * @param {ReturnType<import('./canvas-anotacao.js').montarCanvas>} canvas
 * @returns {{destruir:Function}}
 */
export function ligarFerramentas(canvas) {
  const preview = canvas.elementoPreview;
  let gesto = null;
  let editorTexto = null; // { textarea, passoId, ponto, existente }

  const imagemDims = (passo) => canvas.imagemAtual() ?? { largura: passo.captura.largura, altura: passo.captura.altura };

  function alcaEm(sel, p) {
    const tol = 8 / estado.zoom;
    return alcas(sel).find((a) => Math.abs(a.x - p.x) <= tol && Math.abs(a.y - p.y) <= tol)?.id ?? null;
  }

  function atualizarCursor(e) {
    const f = estado.ferramenta;
    if (f !== 'selecionar') { preview.style.cursor = CURSORES[f] ?? 'default'; return; }
    const passo = passoAtual();
    if (!passo || !temImagem(passo)) { preview.style.cursor = 'default'; return; }
    const p = canvas.coordenadasDoEvento(e);
    const sel = anotacaoSelecionada();
    if (sel && alcaEm(sel, p)) { preview.style.cursor = sel.tipo === 'seta' ? 'move' : 'nwse-resize'; return; }
    const m = medidas(passo);
    const sobre = passo.anotacoes.some((a) => hitTest(a, p, 6 / estado.zoom, m));
    preview.style.cursor = sobre ? 'move' : 'default';
  }

  function aoPressionar(e) {
    if (e.button !== 0) return;
    const passo = passoAtual();
    if (!passo || !temImagem(passo)) return;
    if (editorTexto) { confirmarTexto(); return; }
    preview.focus({ preventScroll: true });
    const p = canvas.coordenadasDoEvento(e);
    const img = imagemDims(passo);
    const f = estado.ferramenta;

    if (f === 'selecionar') {
      const sel = anotacaoSelecionada();
      if (sel) {
        const alca = alcaEm(sel, p);
        if (alca) { gesto = { tipo: 'redimensionar', alca, original: sel, ultimo: sel, mudou: false }; preview.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      }
      const m = medidas(passo);
      const alvo = [...passo.anotacoes].reverse().find((a) => hitTest(a, p, 6 / estado.zoom, m));
      if (alvo) {
        selecionarAnotacao(alvo.id);
        gesto = { tipo: 'mover', original: alvo, inicio: p, ultimo: alvo, moveu: false };
        preview.setPointerCapture(e.pointerId);
      } else {
        selecionarAnotacao(null);
      }
      e.preventDefault();
      return;
    }
    if (f === 'marcador') {
      const a = criarAnotacao('marcador', { ...clampPonto(p, img), numero: proximoNumero(passo), cor: opcoesFerramenta.cor });
      gravarAnotacao(passo.id, a, 'adicionar marcador');
      selecionarAnotacao(a.id);
      e.preventDefault();
      return;
    }
    if (f === 'texto') {
      abrirEditorTexto(passo, clampPonto(p, img), null);
      e.preventDefault();
      return;
    }
    if (f === 'recorte' || f === 'desfoque' || f === 'retangulo') {
      gesto = { tipo: 'criar-rect', ferramenta: f, inicio: p, anotacao: null };
      preview.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (f === 'seta') {
      gesto = { tipo: 'criar-seta', inicio: clampPonto(p, img), anotacao: null };
      preview.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  function montarRect(ferramenta, r, passo) {
    if (ferramenta === 'recorte') return criarAnotacao('recorte', r);
    if (ferramenta === 'desfoque') return criarAnotacao('desfoque', { ...r, bloco: 8 * medidas(passo).e });
    return criarAnotacao('retangulo', { ...r, cor: opcoesFerramenta.cor });
  }

  function aoMover(e) {
    if (!gesto) { atualizarCursor(e); return; }
    const passo = passoAtual();
    if (!passo) return;
    const p = canvas.coordenadasDoEvento(e);
    const img = imagemDims(passo);
    switch (gesto.tipo) {
      case 'mover': {
        const dx = p.x - gesto.inicio.x, dy = p.y - gesto.inicio.y;
        if (!gesto.moveu && Math.hypot(dx, dy) * estado.zoom < MIN_ARRASTE_TELA) return;
        gesto.moveu = true;
        gesto.ultimo = moverLimitado(gesto.original, Math.round(dx), Math.round(dy), img);
        canvas.definirTemporario(substituir(passo.anotacoes, gesto.ultimo));
        break;
      }
      case 'redimensionar': {
        gesto.ultimo = redimensionar(gesto.original, gesto.alca, p, img);
        gesto.mudou = true;
        canvas.definirTemporario(substituir(passo.anotacoes, gesto.ultimo));
        break;
      }
      case 'criar-rect': {
        const r = rectDePontos(gesto.inicio, p, img);
        if (r.w < 1 || r.h < 1) return;
        const a = gesto.anotacao ? { ...gesto.anotacao, ...r } : montarRect(gesto.ferramenta, r, passo);
        gesto.anotacao = a;
        const base = gesto.ferramenta === 'recorte' ? passo.anotacoes.filter((x) => x.tipo !== 'recorte') : passo.anotacoes;
        canvas.definirTemporario([...base, a]);
        break;
      }
      case 'criar-seta': {
        const para = clampPonto(p, img);
        const a = gesto.anotacao ? { ...gesto.anotacao, para } : criarAnotacao('seta', { de: gesto.inicio, para, cor: opcoesFerramenta.cor });
        gesto.anotacao = a;
        canvas.definirTemporario([...passo.anotacoes, a]);
        break;
      }
    }
  }

  function aoSoltar() {
    if (!gesto) return;
    const g = gesto;
    gesto = null;
    canvas.definirTemporario(null);
    const passo = passoAtual();
    if (!passo) return;
    switch (g.tipo) {
      case 'mover':
        if (g.moveu) gravarAnotacao(passo.id, g.ultimo, 'mover anotação');
        break;
      case 'redimensionar':
        if (g.mudou) gravarAnotacao(passo.id, g.ultimo, 'redimensionar anotação');
        break;
      case 'criar-rect': {
        const a = g.anotacao;
        if (!a || a.w < MIN_LADO || a.h < MIN_LADO) return;
        const nomes = { recorte: 'definir recorte', desfoque: 'adicionar desfoque', retangulo: 'adicionar retângulo' };
        aplicar(nomes[g.ferramenta], (guia) => {
          const p = guia.passos.find((x) => x.id === passo.id);
          if (!p) return;
          if (g.ferramenta === 'recorte') p.anotacoes = p.anotacoes.filter((x) => x.tipo !== 'recorte');
          p.anotacoes.push(a);
        });
        selecionarAnotacao(a.id);
        break;
      }
      case 'criar-seta': {
        const a = g.anotacao;
        if (!a || Math.hypot(a.para.x - a.de.x, a.para.y - a.de.y) < MIN_SETA) return;
        gravarAnotacao(passo.id, a, 'adicionar seta');
        selecionarAnotacao(a.id);
        break;
      }
    }
  }

  function cancelarGesto() {
    if (!gesto) return false;
    gesto = null;
    canvas.definirTemporario(null);
    return true;
  }

  // ---- editor de texto sobre o canvas ----
  function abrirEditorTexto(passo, ponto, existente) {
    confirmarTexto();
    const m = medidas(passo);
    const tamanho = existente?.tamanho ?? m.tamanhoTexto;
    const cor = existente?.cor ?? opcoesFerramenta.cor;
    const fundo = existente ? existente.fundo : fundoParaTexto(cor);
    const ta = document.createElement('textarea');
    ta.className = 'canvas-texto-editor';
    ta.rows = 1;
    ta.value = existente?.texto ?? '';
    ta.placeholder = 'Texto…';
    ta.setAttribute('aria-label', 'Texto da anotação');
    const pos = canvas.posicaoNoPalco(ponto);
    ta.style.left = `${pos.x}px`;
    ta.style.top = `${pos.y}px`;
    ta.style.fontSize = `${Math.max(10, tamanho * estado.zoom)}px`;
    ta.style.setProperty('--cor-texto', `var(--anot-${cor}, #009994)`);
    ta.style.setProperty('--fundo-texto', fundo ? `var(--anot-${fundo})` : 'transparent');
    canvas.palco.append(ta);
    editorTexto = { textarea: ta, passoId: passo.id, ponto, existente, tamanho, cor, fundo };
    const ajustar = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; ta.style.width = `${Math.max(120, ta.value.length * tamanho * estado.zoom * 0.62 + 24)}px`; };
    ta.addEventListener('input', ajustar);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmarTexto(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelarTexto(); }
    });
    ta.addEventListener('blur', () => { if (editorTexto?.textarea === ta) confirmarTexto(); });
    ajustar();
    ta.focus();
    ta.select();
  }

  function confirmarTexto() {
    if (!editorTexto) return;
    const { textarea, passoId, ponto, existente, tamanho, cor, fundo } = editorTexto;
    editorTexto = null;
    const texto = textarea.value.replace(/\s+$/g, '');
    textarea.remove();
    if (existente) {
      if (texto === existente.texto) return;
      if (!texto) { excluirAnotacao(passoId, existente.id); return; }
      gravarAnotacao(passoId, { ...existente, texto }, 'editar texto');
      return;
    }
    if (!texto.trim()) return;
    const a = criarAnotacao('texto', { x: ponto.x, y: ponto.y, texto, tamanho, cor, fundo });
    gravarAnotacao(passoId, a, 'adicionar texto');
    selecionarAnotacao(a.id);
  }

  function cancelarTexto() {
    if (!editorTexto) return;
    const { textarea } = editorTexto;
    editorTexto = null;
    textarea.remove();
    preview.focus({ preventScroll: true });
  }

  function aoDuploClique(e) {
    if (estado.ferramenta !== 'selecionar') return;
    const passo = passoAtual();
    if (!passo || !temImagem(passo)) return;
    const p = canvas.coordenadasDoEvento(e);
    const m = medidas(passo);
    const texto = [...passo.anotacoes].reverse().find((a) => a.tipo === 'texto' && hitTest(a, p, 6 / estado.zoom, m));
    if (texto) { cancelarGesto(); abrirEditorTexto(passo, { x: texto.x, y: texto.y }, texto); }
  }

  // ---- teclado ----
  function aoTeclar(e) {
    if (!estado.guia || ehEditavel(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const f = FERRAMENTAS.find((t) => t.tecla.toLowerCase() === k.toLowerCase());
    if (f && !e.shiftKey && k.length === 1) { e.preventDefault(); definirFerramenta(f.id); return; }
    if (k === 'Delete' || k === 'Backspace') { if (excluirSelecionada()) e.preventDefault(); return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (cancelarGesto()) return;
      if (estado.selecaoAnotacaoId) { selecionarAnotacao(null); return; }
      definirFerramenta('selecionar');
      return;
    }
    if (k.startsWith('Arrow')) {
      const passo = passoAtual();
      const sel = anotacaoSelecionada();
      if (!passo || !sel || !temImagem(passo)) return;
      e.preventDefault();
      const passoPx = (e.shiftKey ? 10 : 1) * medidas(passo).e;
      const dx = k === 'ArrowLeft' ? -passoPx : k === 'ArrowRight' ? passoPx : 0;
      const dy = k === 'ArrowUp' ? -passoPx : k === 'ArrowDown' ? passoPx : 0;
      const img = imagemDims(passo);
      aplicar('mover anotação', (guia) => {
        const p = guia.passos.find((x) => x.id === passo.id);
        const i = p?.anotacoes.findIndex((a) => a.id === sel.id) ?? -1;
        if (i >= 0) p.anotacoes[i] = moverLimitado(p.anotacoes[i], dx, dy, img);
      }, { coalescer: `mover:${sel.id}` });
    }
  }

  preview.addEventListener('pointerdown', aoPressionar);
  preview.addEventListener('pointermove', aoMover);
  preview.addEventListener('pointerup', aoSoltar);
  preview.addEventListener('pointercancel', cancelarGesto);
  preview.addEventListener('dblclick', aoDuploClique);
  preview.addEventListener('pointerleave', () => { if (!gesto) preview.style.cursor = CURSORES[estado.ferramenta] ?? 'default'; });
  window.addEventListener('keydown', aoTeclar);

  return {
    destruir() {
      cancelarTexto();
      preview.removeEventListener('pointerdown', aoPressionar);
      preview.removeEventListener('pointermove', aoMover);
      preview.removeEventListener('pointerup', aoSoltar);
      preview.removeEventListener('pointercancel', cancelarGesto);
      preview.removeEventListener('dblclick', aoDuploClique);
      window.removeEventListener('keydown', aoTeclar);
    },
  };
}
