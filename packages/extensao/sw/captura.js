// Captura de tela do service worker (seção 5.8): reaproveita a imagem de < 500 ms atrás em vez
// de esperar o slot de captureVisibleTab (≤ 2/s), tenta de novo uma vez após 120 ms e, se
// persistir a falha, devolve `faltante` — um passo nunca é perdido por falta de foto.
// Quem chama garante que a aba do evento é a visível da janela: captureVisibleTab fotografa a
// aba ativa da janela, seja ela qual for.
import { gerarId } from '../core/ids.js';
import { salvarImagem } from '../core/armazenamento.js';

const JANELA_REAPROVEITAMENTO = 500;
const ESPERA_RETENTATIVA = 120;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function fotografar(janelaId) {
  const opcoes = { format: 'png' };
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.captureVisibleTab) throw new Error('captureVisibleTab indisponível');
  return janelaId == null ? tabs.captureVisibleTab(opcoes) : tabs.captureVisibleTab(janelaId, opcoes);
}

/** Captura ausente com o motivo: o passo é gravado mesmo assim (o editor permite anexar a imagem). */
export function capturaFaltante(motivo, fontePedida, agora, url) {
  return { imagemId: null, faltante: true, motivo, fonte: fontePedida, em: agora, url: url ?? null };
}

/**
 * `ultimaCaptura` do estado como captura `compartilhada`, se for da mesma aba e da mesma URL — duas abas
 * da gravação na mesma URL (link `target=_blank` para a própria página, SSO) nunca compartilham foto.
 * @returns {object|null}
 */
export function reaproveitarUltima(estado, abaId, url) {
  const u = estado?.ultimaCaptura;
  if (!u?.imagemId || (u.abaId ?? null) !== (abaId ?? null) || (u.url ?? null) !== (url ?? null)) return null;
  return { imagemId: u.imagemId, largura: u.largura, altura: u.altura, fonte: 'compartilhada', faltante: false, em: u.em, url: url ?? null, reaproveitada: true };
}

/**
 * @param {number|null} janelaId janela da aba do evento @param {string|null} url URL da página no momento do evento
 * @param {number} agora timestamp (ms) de referência do reaproveitamento (o do evento que pediu a captura)
 * @param {'pointerdown'|'confirmacao'|'navegacao'} [fontePedida]
 * @param {object|null} [estado] estado da gravação (usa guiaId e ultimaCaptura)
 * @param {{abaId?:number|null}} [opcoes] aba do evento (o reaproveitamento exige a mesma aba)
 * @returns {Promise<{imagemId:string, largura:number, altura:number, fonte:string, faltante:false, em:number, url:string|null, reaproveitada:boolean}
 *          | {imagemId:null, faltante:true, motivo:string, fonte:string, em:number, url:string|null}>}
 */
export async function capturar(janelaId, url, agora, fontePedida = 'pointerdown', estado = null, { abaId = null } = {}) {
  const ultima = estado?.ultimaCaptura;
  if (ultima?.imagemId && agora - ultima.em < JANELA_REAPROVEITAMENTO) {
    // o estado pré-clique de meio segundo atrás é o que se quer; esperar o slot arriscaria fotografar depois da navegação
    const compartilhada = reaproveitarUltima(estado, abaId, url);
    if (compartilhada) return compartilhada;
  }

  let dataUrl = null;
  let erro = null;
  for (let tentativa = 0; tentativa < 2 && !dataUrl; tentativa++) {
    try {
      dataUrl = await fotografar(janelaId);
    } catch (e) {
      // "Tabs cannot be edited right now", MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND, aba carregando…
      erro = e;
      if (tentativa === 0) await esperar(ESPERA_RETENTATIVA);
    }
  }
  if (!dataUrl) return capturaFaltante(String(erro?.message ?? erro ?? 'captura indisponível'), fontePedida, agora, url);

  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const largura = bmp.width;
  const altura = bmp.height;
  bmp.close?.();
  const imagemId = gerarId('img');
  await salvarImagem({ id: imagemId, guiaId: estado?.guiaId ?? null, blob, largura, altura, mime: 'image/png' });
  return { imagemId, largura, altura, fonte: fontePedida, faltante: false, em: agora, url: url ?? null, reaproveitada: false };
}
