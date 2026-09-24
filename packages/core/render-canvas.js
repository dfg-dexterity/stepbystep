// Desenho de um passo (imagem + anotações) num contexto 2D injetado. Função pura: não cria canvas.
// O chamador dimensiona ctx.canvas para areaSaida × escala e, no navegador, espera as fontes carregarem.
import { CORES } from './modelo.js';
import { separarRecorte, areaSaida, pontaDaSeta, caixaTexto } from './anotacoes.js';

const ESTILO_PADRAO = { cor: 'cerceta', escurecerFora: true };
const corDe = (token) => CORES[token] ?? CORES.cerceta;

/**
 * Medidas proporcionais à escala da captura (e = passo.captura?.escala ?? 1).
 * fonteTexto é função do tamanho da anotação (em px da imagem).
 */
export function medidas(passo) {
  const e = passo?.captura?.escala > 0 ? passo.captura.escala : 1;
  return {
    e,
    espessuraRect: 3 * e,
    raioMarcador: 16 * e,
    hasteSeta: 4 * e,
    pontaSeta: 16 * e,
    tamanhoTexto: 16 * e,
    fonteMarcador: `600 ${20 * e}px "Barlow Condensed"`,
    fonteTexto: (t) => `600 ${t}px Figtree`,
  };
}

function desenharDesfoque(ctx, imagem, a, criarCanvas) {
  const bloco = Math.max(1, a.bloco || 8);
  const cw = Math.max(1, Math.ceil(a.w / bloco));
  const ch = Math.max(1, Math.ceil(a.h / bloco));
  if (typeof criarCanvas !== 'function') return;
  const pequeno = criarCanvas(cw, ch);
  const cx = pequeno.getContext('2d');
  // reduzir sem suavização pega um pixel por bloco; ampliar sem suavização vira mosaico (irreversível)
  cx.imageSmoothingEnabled = false;
  cx.drawImage(imagem.fonte, a.x, a.y, a.w, a.h, 0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pequeno, 0, 0, cw, ch, a.x, a.y, a.w, a.h);
  ctx.imageSmoothingEnabled = true;
}

function desenharHolofote(ctx, area, retangulos) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  for (const r of retangulos) ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip('evenodd');
  ctx.fillStyle = 'rgba(27,27,27,.35)';
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}

function desenharRetangulo(ctx, a, m, estilo) {
  ctx.lineWidth = m.espessuraRect;
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = corDe(a.auto ? estilo.cor : a.cor);
  ctx.strokeRect(a.x, a.y, a.w, a.h);
}

function desenharSeta(ctx, a, m) {
  const cor = corDe(a.cor);
  const ponta = pontaDaSeta(a.de, a.para, m.pontaSeta);
  // a haste termina na base da ponta para não vazar pela frente do triângulo
  const base = { x: (ponta[1].x + ponta[2].x) / 2, y: (ponta[1].y + ponta[2].y) / 2 };
  ctx.lineWidth = m.hasteSeta;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = cor;
  ctx.beginPath();
  ctx.moveTo(a.de.x, a.de.y);
  ctx.lineTo(base.x, base.y);
  ctx.stroke();
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.moveTo(ponta[0].x, ponta[0].y);
  ctx.lineTo(ponta[1].x, ponta[1].y);
  ctx.lineTo(ponta[2].x, ponta[2].y);
  ctx.closePath();
  ctx.fill();
}

function desenharTexto(ctx, a, m) {
  ctx.font = m.fonteTexto(a.tamanho);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const medida = typeof ctx.measureText === 'function' ? ctx.measureText(a.texto) : null;
  const largura = typeof medida?.width === 'number' ? medida.width : undefined;
  if (a.fundo) {
    const caixa = caixaTexto(a, largura);
    ctx.fillStyle = corDe(a.fundo);
    ctx.fillRect(caixa.x, caixa.y, caixa.w, caixa.h);
  }
  ctx.fillStyle = corDe(a.cor);
  ctx.fillText(a.texto, a.x, a.y);
}

function desenharMarcador(ctx, a, m, estilo) {
  const r = m.raioMarcador;
  const cor = corDe(a.auto ? estilo.cor : a.cor);
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
  ctx.fill();
  // anel branco de 2e colado ao círculo e fio base de 1e por fora
  ctx.lineWidth = 2 * m.e;
  ctx.strokeStyle = CORES.branco;
  ctx.beginPath();
  ctx.arc(a.x, a.y, r + m.e, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1 * m.e;
  ctx.strokeStyle = CORES.base;
  ctx.beginPath();
  ctx.arc(a.x, a.y, r + 2.5 * m.e, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = m.fonteMarcador;
  ctx.fillStyle = CORES.branco;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(a.numero), a.x, a.y);
}

/**
 * Desenha imagem + anotações. Ordem: save → scale → translate(−area) → drawImage → desfoques → holofote
 * → retângulos → setas → textos → marcadores → restore.
 * @param {object} ctx contexto 2D (real ou falso)
 * @param {{largura:number, altura:number, fonte:any}} imagem bitmap original
 * @param {object} passo
 * @param {{escala?:number, estilo?:{cor:string, escurecerFora:boolean}, criarCanvas?:(w:number,h:number)=>{getContext:Function}, incluirRecorte?:boolean}} opcoes
 */
export function desenharPasso(ctx, imagem, passo, opcoes = {}) {
  const escala = opcoes.escala > 0 ? opcoes.escala : 1;
  const estilo = { ...ESTILO_PADRAO, ...(opcoes.estilo ?? {}) };
  const m = medidas(passo);
  const { recorte, demais } = separarRecorte(passo.anotacoes ?? []);
  const area = opcoes.incluirRecorte === false ? areaSaida(imagem, null) : areaSaida(imagem, recorte);
  const por = (tipo) => demais.filter((a) => a.tipo === tipo);

  ctx.save();
  ctx.scale(escala, escala);
  ctx.translate(-area.x, -area.y);
  ctx.drawImage(imagem.fonte, 0, 0, imagem.largura, imagem.altura);

  for (const a of por('desfoque')) desenharDesfoque(ctx, imagem, a, opcoes.criarCanvas);

  const retangulos = por('retangulo');
  const autos = retangulos.filter((a) => a.auto);
  if (estilo.escurecerFora && autos.length > 0) desenharHolofote(ctx, area, autos);

  for (const a of retangulos) desenharRetangulo(ctx, a, m, estilo);
  for (const a of por('seta')) desenharSeta(ctx, a, m);
  for (const a of por('texto')) desenharTexto(ctx, a, m);
  for (const a of por('marcador')) desenharMarcador(ctx, a, m, estilo);
  ctx.restore();
  return area;
}

/**
 * Navegador: OffscreenCanvas(areaSaida × escalaSaida), desenharPasso, convertToBlob.
 * @param {ImageBitmap} bitmap @param {object} passo
 * @param {{larguraMax?:number, tipo?:'image/png'|'image/webp', qualidade?:number, estilo?:object}} [opcoes]
 * @returns {Promise<{blob:Blob, largura:number, altura:number}>}
 */
export async function assarPasso(bitmap, passo, opcoes = {}) {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('assarPasso exige OffscreenCanvas (só navegador)');
  const imagem = { largura: bitmap.width, altura: bitmap.height, fonte: bitmap };
  const { recorte } = separarRecorte(passo.anotacoes ?? []);
  const area = areaSaida(imagem, recorte);
  const escala = opcoes.larguraMax > 0 && area.w > opcoes.larguraMax ? opcoes.larguraMax / area.w : 1;
  const largura = Math.max(1, Math.round(area.w * escala));
  const altura = Math.max(1, Math.round(area.h * escala));
  const canvas = new OffscreenCanvas(largura, altura);
  const ctx = canvas.getContext('2d');
  desenharPasso(ctx, imagem, passo, {
    escala,
    estilo: opcoes.estilo,
    criarCanvas: (w, h) => new OffscreenCanvas(w, h),
  });
  const tipo = opcoes.tipo ?? 'image/png';
  const blob = await canvas.convertToBlob(tipo === 'image/png' ? { type: tipo } : { type: tipo, quality: opcoes.qualidade ?? 0.9 });
  return { blob, largura, altura };
}
