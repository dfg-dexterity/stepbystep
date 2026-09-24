// Conversão de coordenadas: CSS px do viewport (ou pontos do display, no Mac) → px da imagem original.
// A escala é sempre medida no bitmap (largura / viewport.largura), nunca no devicePixelRatio.

/** @typedef {{x:number,y:number,w:number,h:number}} Rect */
/** @typedef {{largura:number,altura:number}} Tamanho */

const arred = Math.round;
const limitar = (v, min, max) => Math.min(Math.max(v, min), max);

/** Escalas medidas: sx = imagem.largura/viewport.largura, sy = imagem.altura/viewport.altura. */
export function escalas(imagem, viewport) {
  const sx = viewport?.largura > 0 ? imagem.largura / viewport.largura : 1;
  const sy = viewport?.altura > 0 ? imagem.altura / viewport.altura : sx;
  return { sx, sy };
}

/** Limita o rect à imagem; w/h ficam 0 se o rect estiver totalmente fora. @returns {Rect} */
export function limitarAImagem(rect, imagem) {
  const x0 = limitar(rect.x, 0, imagem.largura);
  const y0 = limitar(rect.y, 0, imagem.altura);
  const x1 = limitar(rect.x + rect.w, 0, imagem.largura);
  const y1 = limitar(rect.y + rect.h, 0, imagem.altura);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Rect em CSS px do viewport (já somados os deslocamentos de iframes) → px da imagem, arredondado e limitado.
 * @param {Rect} rectCss @param {Tamanho} viewport @param {Tamanho} imagem @returns {Rect}
 */
export function cssParaImagem(rectCss, viewport, imagem) {
  const { sx, sy } = escalas(imagem, viewport);
  const bruto = { x: arred(rectCss.x * sx), y: arred(rectCss.y * sy), w: arred(rectCss.w * sx), h: arred(rectCss.h * sy) };
  return limitarAImagem(bruto, imagem);
}

/** @param {{x:number,y:number}} pontoCss @returns {{x:number,y:number}} limitado à imagem */
export function pontoParaImagem(pontoCss, viewport, imagem) {
  const { sx, sy } = escalas(imagem, viewport);
  return { x: limitar(arred(pontoCss.x * sx), 0, imagem.largura), y: limitar(arred(pontoCss.y * sy), 0, imagem.altura) };
}

/** @param {Rect} rectCss @param {{x:number,y:number}[]} deslocamentos (do frame mais interno ao topo) @returns {Rect} */
export function somarDeslocamentos(rectCss, deslocamentos) {
  let { x, y } = rectCss;
  for (const d of deslocamentos ?? []) { x += d.x; y += d.y; }
  return { x, y, w: rectCss.w, h: rectCss.h };
}

export function centro(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Centro do marcador: canto superior direito do bbox, deslocado para dentro da imagem se sair. @returns {{x,y}} */
export function posicaoMarcador(bbox, imagem, raio) {
  const r = raio ?? 16;
  let x = bbox.x + bbox.w;
  let y = bbox.y;
  // se a imagem for menor que o círculo, o centro fica no meio dela
  x = imagem.largura >= 2 * r ? limitar(x, r, imagem.largura - r) : imagem.largura / 2;
  y = imagem.altura >= 2 * r ? limitar(y, r, imagem.altura - r) : imagem.altura / 2;
  return { x: arred(x), y: arred(y) };
}

/**
 * Recorte "focar no alvo": ao redor do bbox, largura ≥ max(40 % da imagem, bbox.w + 2·margem), proporção 16:10, dentro da imagem.
 * @param {{margem?:number, escala?:number}} [opcoes] margem padrão 120·escala (escala padrão 1) @returns {Rect}
 */
export function recorteFocado(bbox, imagem, opcoes = {}) {
  const margem = opcoes.margem ?? 120 * (opcoes.escala ?? 1);
  const W = imagem.largura, H = imagem.altura;
  let w = Math.max(0.4 * W, bbox.w + 2 * margem);
  let h = w * 10 / 16;
  if (h < bbox.h + 2 * margem) { h = bbox.h + 2 * margem; w = h * 16 / 10; }
  // cabe na imagem mantendo a proporção sempre que possível
  if (w > W) { w = W; h = w * 10 / 16; }
  if (h > H) { h = H; w = Math.min(W, h * 16 / 10); }
  const c = centro(bbox);
  let x = c.x - w / 2;
  let y = c.y - h / 2;
  x = limitar(x, 0, W - w);
  y = limitar(y, 0, H - h);
  return { x: arred(x), y: arred(y), w: arred(w), h: arred(h) };
}
