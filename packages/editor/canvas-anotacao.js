// Painel da imagem: <canvas> de visualização (desenharPasso do núcleo) + camada de preview
// (alças, máscara do recorte) sobreposta, zoom e cache de ImageBitmap por imagemId.
// Conversão ponteiro → imagem: x = area.x + offsetX / zoom (todas as coordenadas em px da imagem).
import { desenharPasso, medidas } from '../core/render-canvas.js';
import { separarRecorte, areaSaida, bboxDaAnotacao } from '../core/anotacoes.js';
import { carregarImagem } from '../core/armazenamento.js';
import { CORES } from '../core/modelo.js';
import { estado, on, emitir, passoAtual, anotacaoSelecionada, temImagem, ZOOM_MIN, ZOOM_MAX } from './estado.js';

// ---------------------------------------------------------------------------
// Cache de bitmaps (LRU pequeno: cada captura 2x ocupa ~30 MB decodificada)
// ---------------------------------------------------------------------------
const cache = new Map(); // imagemId → Promise<ImageBitmap|null>
const LIMITE_CACHE = 6;

export const criarCanvas = (w, h) => new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));

/** @returns {Promise<ImageBitmap|null>} */
export function obterBitmap(imagemId) {
  if (!imagemId) return Promise.resolve(null);
  if (cache.has(imagemId)) {
    const p = cache.get(imagemId);
    cache.delete(imagemId);
    cache.set(imagemId, p); // toque LRU
    return p;
  }
  const p = carregarImagem(imagemId)
    .then((reg) => (reg?.blob ? createImageBitmap(reg.blob) : null))
    .catch((e) => { console.error('Falha ao carregar a imagem', imagemId, e); return null; });
  cache.set(imagemId, p);
  while (cache.size > LIMITE_CACHE) {
    const [id, antigo] = cache.entries().next().value;
    cache.delete(id);
    antigo.then((b) => b?.close?.());
  }
  return p;
}

export function esquecerBitmap(imagemId) {
  const p = cache.get(imagemId);
  if (!p) return;
  cache.delete(imagemId);
  p.then((b) => b?.close?.());
}

export function limparBitmaps() {
  for (const p of cache.values()) p.then((b) => b?.close?.());
  cache.clear();
}

/** Alças de uma anotação, em px da imagem: cantos (no/ne/so/se) ou pontas da seta (de/para). */
export function alcas(anotacao) {
  switch (anotacao?.tipo) {
    case 'recorte': case 'desfoque': case 'retangulo':
      return [
        { id: 'no', x: anotacao.x, y: anotacao.y },
        { id: 'ne', x: anotacao.x + anotacao.w, y: anotacao.y },
        { id: 'so', x: anotacao.x, y: anotacao.y + anotacao.h },
        { id: 'se', x: anotacao.x + anotacao.w, y: anotacao.y + anotacao.h },
      ];
    case 'seta':
      return [{ id: 'de', ...anotacao.de }, { id: 'para', ...anotacao.para }];
    default:
      return [];
  }
}

const fontesProntas = typeof document !== 'undefined' && document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();

/**
 * Monta o painel dentro de `wrap` (.canvas-wrap). Devolve a API usada por ferramentas.js e app.js.
 * @param {HTMLElement} wrap
 * @param {{aoAnexar?:(arquivo:File)=>void}} [opcoes]
 */
export function montarCanvas(wrap, opcoes = {}) {
  wrap.classList.add('canvas-wrap');
  const palco = document.createElement('div');
  palco.className = 'canvas-palco';
  const vis = document.createElement('canvas');
  vis.id = 'canvas-vis';
  vis.className = 'canvas-vis';
  const preview = document.createElement('canvas');
  preview.id = 'canvas-preview';
  preview.className = 'canvas-preview';
  preview.tabIndex = 0;
  preview.setAttribute('aria-label', 'Imagem do passo com anotações');
  palco.append(vis, preview);

  const vazio = document.createElement('div');
  vazio.className = 'canvas-vazio';
  vazio.hidden = true;
  wrap.append(palco, vazio);

  let temporario = null;      // anotações provisórias durante um gesto
  let agendado = false;
  let bitmapAtual = null;
  let areaAtual = { x: 0, y: 0, w: 1, h: 1 };
  let modoAjustar = true;     // zoom "ajustar à largura" até o usuário mexer no zoom
  let destruido = false;

  const zoomAjustado = (area) => {
    const disponivel = Math.max(120, wrap.clientWidth - 32);
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, disponivel / area.w));
  };

  function mostrarVazio(passo, mensagem) {
    palco.hidden = true;
    vazio.hidden = false;
    vazio.replaceChildren();
    bitmapAtual = null;
    const p = document.createElement('p');
    p.className = 'canvas-vazio-texto';
    if (!passo) p.textContent = 'Selecione um passo na lista para ver a imagem.';
    else if (mensagem) p.textContent = mensagem;
    else if (passo.tipo === 'secao') p.textContent = 'Seções não têm imagem: são títulos que agrupam os passos seguintes.';
    else if (passo.captura?.faltante) p.textContent = 'A captura falhou neste passo. Anexe uma imagem para anotar.';
    else p.textContent = 'Este passo não tem imagem. Anexe uma captura, cole do clipboard (Ctrl/⌘+V) ou deixe só o texto.';
    vazio.append(p);
    if (passo && passo.tipo !== 'secao' && opcoes.aoAnexar) {
      const rotulo = document.createElement('label');
      rotulo.className = 'dxt-btn dxt-btn--ghost dxt-btn--sm';
      rotulo.textContent = passo.captura?.faltante ? 'Anexar imagem' : 'Adicionar imagem';
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.hidden = true;
      input.addEventListener('change', () => { const f = input.files?.[0]; if (f) opcoes.aoAnexar(f); input.value = ''; });
      rotulo.append(input);
      vazio.append(rotulo);
    }
    palco.dataset.zoom = '';
    palco.dataset.area = '';
  }

  function rectTela(r, area, zoom) {
    return { x: (r.x - area.x) * zoom, y: (r.y - area.y) * zoom, w: r.w * zoom, h: r.h * zoom };
  }

  function desenharPreview(anotacoes, recorte, selecionada, area, zoom, mostrarTudo, passo) {
    const ctx = preview.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, preview.width, preview.height);
    if (mostrarTudo && recorte) {
      // fora do recorte fica escurecido; o contorno tracejado mostra a janela de saída
      const r = rectTela(recorte, area, zoom);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, preview.width, preview.height);
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip('evenodd');
      ctx.fillStyle = 'rgba(27,27,27,.62)';
      ctx.fillRect(0, 0, preview.width, preview.height);
      ctx.restore();
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = CORES.cercetaClaro;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
      ctx.setLineDash([]);
    }
    if (selecionada) {
      const b = rectTela(bboxDaAnotacao(selecionada, medidas(passo)), area, zoom);
      // contorno duplo (escuro + claro) para contrastar com qualquer fundo
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(27,27,27,.7)';
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.lineWidth = 1;
      ctx.strokeStyle = CORES.off;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.setLineDash([]);
      for (const a of alcas(selecionada)) {
        const x = (a.x - area.x) * zoom, y = (a.y - area.y) * zoom;
        ctx.fillStyle = CORES.off;
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeStyle = CORES.base;
        ctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
      }
    }
  }

  async function desenhar() {
    if (destruido) return;
    const guia = estado.guia;
    const passo = passoAtual();
    if (!guia || !passo || !temImagem(passo)) { mostrarVazio(passo); return; }
    const imagemId = passo.captura.imagemId;
    const bmp = await obterBitmap(imagemId);
    if (destruido || passoAtual()?.id !== passo.id || passoAtual().captura?.imagemId !== imagemId) return;
    if (!bmp) { mostrarVazio(passo, 'A imagem deste passo não foi encontrada no armazenamento. Anexe outra.'); return; }
    bitmapAtual = bmp;
    const imagem = { largura: bmp.width, altura: bmp.height, fonte: bmp };
    const anotacoes = temporario ?? passo.anotacoes;
    const { recorte } = separarRecorte(anotacoes);
    const selecionada = anotacoes.find((a) => a.id === estado.selecaoAnotacaoId) ?? null;
    const mostrarTudo = estado.ferramenta === 'recorte' || selecionada?.tipo === 'recorte';
    const area = areaSaida(imagem, mostrarTudo ? null : recorte);
    areaAtual = area;
    if (modoAjustar) {
      const z = zoomAjustado(area);
      if (Math.abs(z - estado.zoom) > 1e-6) { estado.zoom = z; emitir('mudou', { motivo: 'zoom' }); }
    }
    const zoom = estado.zoom;
    const W = Math.max(1, Math.round(area.w * zoom));
    const H = Math.max(1, Math.round(area.h * zoom));
    for (const c of [vis, preview]) {
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    palco.style.width = `${W}px`;
    palco.style.height = `${H}px`;
    await fontesProntas;
    if (destruido) return;
    const ctx = vis.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    try {
      desenharPasso(ctx, imagem, { ...passo, anotacoes }, { escala: zoom, estilo: guia.estilo, criarCanvas, incluirRecorte: !mostrarTudo });
    } catch (e) {
      // bitmap fechado pelo LRU entre o carregamento e o desenho: recarrega uma vez
      console.warn('Redesenho após falha no bitmap', e);
      esquecerBitmap(imagemId);
      agendar();
      return;
    }
    desenharPreview(anotacoes, recorte, selecionada, area, zoom, mostrarTudo, passo);
    palco.dataset.zoom = String(zoom);
    palco.dataset.area = `${area.x},${area.y},${area.w},${area.h}`;
    palco.hidden = false;
    vazio.hidden = true;
  }

  function agendar() {
    if (agendado || destruido) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; desenhar().catch((e) => console.error('Falha ao desenhar o passo', e)); });
  }

  const cancelar = on('mudou', ({ motivo }) => {
    if (motivo === 'passo' || motivo === 'guia') temporario = null;
    if (['guia', 'passo', 'zoom', 'selecao', 'ferramenta'].includes(motivo)) agendar();
  });
  const observador = new ResizeObserver(() => { if (modoAjustar) agendar(); });
  observador.observe(wrap);
  agendar();

  return {
    palco,
    elementoPreview: preview,
    redesenhar: agendar,
    /** Zoom "ajustar à largura" (padrão). */
    ajustarZoom() { modoAjustar = true; agendar(); },
    /** Zoom manual: desliga o ajuste automático. */
    definirZoomManual(z) { modoAjustar = false; estado.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); emitir('mudou', { motivo: 'zoom' }); },
    emAjuste: () => modoAjustar,
    area: () => areaAtual,
    imagemAtual: () => (bitmapAtual ? { largura: bitmapAtual.width, altura: bitmapAtual.height } : null),
    /** Ponteiro → px da imagem. */
    coordenadasDoEvento(e) {
      const r = preview.getBoundingClientRect();
      const z = estado.zoom;
      return { x: areaAtual.x + (e.clientX - r.left) / z, y: areaAtual.y + (e.clientY - r.top) / z };
    },
    /** px da imagem → posição CSS dentro do palco. */
    posicaoNoPalco(p) {
      return { x: (p.x - areaAtual.x) * estado.zoom, y: (p.y - areaAtual.y) * estado.zoom };
    },
    /** Anotações provisórias (gesto em curso); null volta ao guia. */
    definirTemporario(lista) { temporario = lista; agendar(); },
    destruir() { destruido = true; cancelar(); observador.disconnect(); wrap.replaceChildren(); },
  };
}
