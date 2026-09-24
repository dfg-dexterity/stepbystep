// Anotações não destrutivas (px da imagem original): normalização, geometria, hit-test e
// anotações automáticas da captura. O recorte é janela de saída e não desloca as demais.
import { gerarId, validarId } from './ids.js';
import { TIPOS_ANOTACAO, TOKENS_COR } from './modelo.js';
import { limitarAImagem, posicaoMarcador } from './coordenadas.js';

const COM_COR = new Set(['retangulo', 'seta', 'marcador', 'texto']);

/** Garante ids, auto boolean, cor padrão, um só recorte (mantém o último). @returns {object[]} nova lista */
export function normalizarAnotacoes(lista) {
  const entrada = Array.isArray(lista) ? lista.filter((a) => a && typeof a === 'object' && TIPOS_ANOTACAO.includes(a.tipo)) : [];
  const ultimoRecorte = entrada.map((a) => a.tipo).lastIndexOf('recorte');
  const saida = [];
  entrada.forEach((a, i) => {
    if (a.tipo === 'recorte' && i !== ultimoRecorte) return;
    const n = { ...a };
    if (!validarId(n.id) || !n.id.startsWith('a_')) n.id = gerarId('a');
    n.auto = Boolean(n.auto);
    if (COM_COR.has(n.tipo) && !TOKENS_COR.includes(n.cor)) n.cor = 'cerceta';
    if (n.tipo === 'texto') {
      n.texto = typeof n.texto === 'string' ? n.texto : '';
      if (!(n.tamanho > 0)) n.tamanho = 16;
      if (n.fundo !== null && !TOKENS_COR.includes(n.fundo)) n.fundo = null;
    }
    if (n.tipo === 'desfoque' && !(n.bloco > 0)) n.bloco = 8;
    if (n.tipo === 'marcador' && !(Number.isInteger(n.numero) && n.numero >= 1)) n.numero = 1;
    saida.push(n);
  });
  return saida;
}

/** @returns {{recorte:object|null, demais:object[]}} */
export function separarRecorte(lista) {
  const demais = [];
  let recorte = null;
  for (const a of lista ?? []) {
    if (a.tipo === 'recorte') recorte = a; // o último vale
    else demais.push(a);
  }
  return { recorte, demais };
}

/** Área de saída: recorte limitado à imagem, ou a imagem inteira. @returns {{x,y,w,h}} */
export function areaSaida(imagem, recorte) {
  const inteira = { x: 0, y: 0, w: imagem.largura, h: imagem.altura };
  if (!recorte) return inteira;
  const r = limitarAImagem(recorte, imagem);
  return r.w > 0 && r.h > 0 ? r : inteira;
}

/** Triângulo da ponta, com o vértice em `para`. @returns {[{x,y},{x,y},{x,y}]} */
export function pontaDaSeta(de, para, tamanho) {
  const dx = para.x - de.x, dy = para.y - de.y;
  const comp = Math.hypot(dx, dy) || 1;
  const ux = dx / comp, uy = dy / comp;           // direção
  const px = -uy, py = ux;                          // perpendicular
  const bx = para.x - ux * tamanho, by = para.y - uy * tamanho;
  const meia = tamanho / 2;
  return [
    { x: para.x, y: para.y },
    { x: bx + px * meia, y: by + py * meia },
    { x: bx - px * meia, y: by - py * meia },
  ];
}

const medidasPadrao = (m) => ({
  e: m?.e ?? 1,
  espessuraRect: m?.espessuraRect ?? 3,
  raioMarcador: m?.raioMarcador ?? 16,
  hasteSeta: m?.hasteSeta ?? 4,
  pontaSeta: m?.pontaSeta ?? 16,
});

/** Largura estimada do texto quando não há measureText (0,55 em por caractere em Figtree 600). */
export function larguraTextoEstimada(texto, tamanho) {
  return Array.from(String(texto ?? '')).length * tamanho * 0.55;
}

/** Caixa de um texto: (x,y) é o canto superior esquerdo; com fundo há folga de 0,25·tamanho. */
export function caixaTexto(anotacao, larguraMedida) {
  const t = anotacao.tamanho;
  const largura = larguraMedida ?? larguraTextoEstimada(anotacao.texto, t);
  const folga = anotacao.fundo ? t * 0.25 : 0;
  return { x: anotacao.x - folga, y: anotacao.y - folga, w: largura + 2 * folga, h: t * 1.25 + 2 * folga };
}

/** @returns {{x,y,w,h}} (seta/marcador/texto incluem espessura/raio) */
export function bboxDaAnotacao(anotacao, medidas) {
  const m = medidasPadrao(medidas);
  switch (anotacao.tipo) {
    case 'recorte':
    case 'desfoque':
      return { x: anotacao.x, y: anotacao.y, w: anotacao.w, h: anotacao.h };
    case 'retangulo': {
      const meia = m.espessuraRect / 2;
      return { x: anotacao.x - meia, y: anotacao.y - meia, w: anotacao.w + m.espessuraRect, h: anotacao.h + m.espessuraRect };
    }
    case 'seta': {
      const pontos = [anotacao.de, anotacao.para, ...pontaDaSeta(anotacao.de, anotacao.para, m.pontaSeta)];
      const folga = m.hasteSeta / 2;
      const xs = pontos.map((p) => p.x), ys = pontos.map((p) => p.y);
      const x0 = Math.min(...xs) - folga, y0 = Math.min(...ys) - folga;
      return { x: x0, y: y0, w: Math.max(...xs) + folga - x0, h: Math.max(...ys) + folga - y0 };
    }
    case 'marcador': {
      const r = m.raioMarcador + 3 * m.e; // anel branco (2e) + fio (1e)
      return { x: anotacao.x - r, y: anotacao.y - r, w: 2 * r, h: 2 * r };
    }
    case 'texto':
      return caixaTexto(anotacao);
    default:
      return { x: anotacao.x ?? 0, y: anotacao.y ?? 0, w: anotacao.w ?? 0, h: anotacao.h ?? 0 };
  }
}

function distanciaAoSegmento(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function dentroDeRect(p, r, tol) {
  return p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;
}

/** @returns {boolean} ponto (px da imagem) dentro da anotação com tolerância */
export function hitTest(anotacao, ponto, tolerancia = 0, medidas) {
  const m = medidasPadrao(medidas);
  const tol = tolerancia ?? 0;
  switch (anotacao.tipo) {
    case 'marcador':
      return Math.hypot(ponto.x - anotacao.x, ponto.y - anotacao.y) <= m.raioMarcador + 3 * m.e + tol;
    case 'seta': {
      if (distanciaAoSegmento(ponto, anotacao.de, anotacao.para) <= m.hasteSeta / 2 + tol) return true;
      const ponta = pontaDaSeta(anotacao.de, anotacao.para, m.pontaSeta);
      const xs = ponta.map((p) => p.x), ys = ponta.map((p) => p.y);
      return dentroDeRect(ponto, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, tol);
    }
    default:
      return dentroDeRect(ponto, bboxDaAnotacao(anotacao, m), tol);
  }
}

/** @returns {object} nova anotação deslocada */
export function moverAnotacao(anotacao, dx, dy) {
  if (anotacao.tipo === 'seta') {
    return { ...anotacao, de: { x: anotacao.de.x + dx, y: anotacao.de.y + dy }, para: { x: anotacao.para.x + dx, y: anotacao.para.y + dy } };
  }
  return { ...anotacao, x: anotacao.x + dx, y: anotacao.y + dy };
}

const rectValido = (r) => r && typeof r === 'object' && r.w > 0 && r.h > 0;

/**
 * Anotações geradas na captura: retangulo (bbox + 8·escala de folga) + marcador (posicaoMarcador) quando alvo.bbox;
 * desfoque (bloco 8·escala) quando evento.sensivel; recorte quando alvo.janelaBbox (Mac).
 * Nenhuma para navegar/tecla/secao/manual ou bbox null.
 * @param {object} passo @param {{numero:number}} [opcoes] @returns {object[]}
 */
export function anotacoesAutomaticas(passo, opcoes = {}) {
  if (!passo || ['navegar', 'tecla', 'secao', 'manual'].includes(passo.tipo)) return [];
  const captura = passo.captura;
  if (!captura || captura.faltante || !(captura.largura > 0) || !(captura.altura > 0)) return [];
  const imagem = { largura: captura.largura, altura: captura.altura };
  const e = captura.escala > 0 ? captura.escala : 1;
  const alvo = passo.alvo ?? {};
  const bbox = rectValido(alvo.bbox) ? limitarAImagem(alvo.bbox, imagem) : null;
  const lista = [];

  if (rectValido(alvo.janelaBbox)) {
    // Mac: recorte pela janela clicada; menus pendem da barra de menus, então o recorte sobe até o topo da tela.
    let r = { ...alvo.janelaBbox };
    if (bbox) {
      const x0 = Math.min(r.x, bbox.x), y0 = Math.min(r.y, bbox.y);
      const x1 = Math.max(r.x + r.w, bbox.x + bbox.w), y1 = Math.max(r.y + r.h, bbox.y + bbox.h);
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (alvo.papel === 'menuitem') { r.h += r.y; r.y = 0; }
    r = limitarAImagem(r, imagem);
    if (r.w > 0 && r.h > 0) lista.push({ id: gerarId('a'), tipo: 'recorte', auto: true, ...r });
  }

  if (bbox && bbox.w > 0 && bbox.h > 0) {
    if (passo.evento?.sensivel) {
      lista.push({ id: gerarId('a'), tipo: 'desfoque', auto: true, x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, bloco: 8 * e });
    }
    const folga = 8 * e;
    const rect = limitarAImagem({ x: bbox.x - folga, y: bbox.y - folga, w: bbox.w + 2 * folga, h: bbox.h + 2 * folga }, imagem);
    lista.push({ id: gerarId('a'), tipo: 'retangulo', auto: true, x: rect.x, y: rect.y, w: rect.w, h: rect.h, cor: 'cerceta' });
    const pos = posicaoMarcador(rect, imagem, 16 * e);
    lista.push({ id: gerarId('a'), tipo: 'marcador', auto: true, x: pos.x, y: pos.y, numero: opcoes.numero ?? 1, cor: 'cerceta' });
  }
  return lista;
}
