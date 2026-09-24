// Blocos da API do Notion a partir do guia (limites: 100 blocos de topo, 1000 no total, 2000 chars por texto).
import { numeroDoPasso } from './modelo.js';
import { formatarData } from './exportar-markdown.js';

const LIMITE_TEXTO = 2000;

/** Fatia em objetos text de ≤ 2000 chars. @returns {object[]} */
export function richText(texto, anotacoes = {}) {
  const chars = Array.from(String(texto ?? ''));
  const saida = [];
  for (let i = 0; i < chars.length; i += LIMITE_TEXTO) {
    const item = { type: 'text', text: { content: chars.slice(i, i + LIMITE_TEXTO).join('') } };
    if (anotacoes && Object.keys(anotacoes).length > 0) item.annotations = { ...anotacoes };
    saida.push(item);
  }
  return saida;
}

/** Trechos entre «» com annotations.bold, resto normal. @returns {object[]} */
export function richTextComDestaque(titulo) {
  const partes = String(titulo ?? '').split(/(«[^»]*»)/).filter((p) => p !== '');
  const saida = [];
  for (const parte of partes) {
    const destaque = parte.startsWith('«') && parte.endsWith('»');
    saida.push(...richText(parte, destaque ? { bold: true } : {}));
  }
  return saida;
}

export function contarBlocos(bloco) {
  const filhos = bloco?.[bloco?.type]?.children ?? bloco?.children ?? [];
  return 1 + filhos.reduce((s, f) => s + contarBlocos(f), 0);
}

const bloco = (type, corpo) => ({ object: 'block', type, [type]: corpo });

/**
 * @param {object} guia @param {{uploadIdDoPasso:(passo:object)=>string|null, data?:Date}} opcoes
 * @returns {{titulo:string, blocos:object[]}}
 */
export function guiaParaBlocos(guia, opcoes = {}) {
  const uploadIdDoPasso = opcoes.uploadIdDoPasso ?? (() => null);
  const titulo = guia.titulo || 'Manual sem título';
  const blocos = [];
  blocos.push(bloco('callout', {
    icon: { type: 'emoji', emoji: '📘' },
    color: 'gray_background',
    rich_text: richText(`Manual gerado com StepByStep · Dexterity IT Solutions · ${guia.passos.length} passos · ${formatarData(opcoes.data ?? new Date())}`),
  }));
  if (guia.descricao) blocos.push(bloco('paragraph', { rich_text: richText(guia.descricao) }));

  // headings reiniciam a numeração da lista no Notion: com seções, o número vai no texto
  const temSecoes = guia.passos.some((p) => p.tipo === 'secao');
  guia.passos.forEach((passo, indice) => {
    if (passo.tipo === 'secao') {
      blocos.push(bloco('heading_2', { rich_text: richText(passo.titulo) }));
      return;
    }
    const n = numeroDoPasso(guia, indice);
    const rich_text = temSecoes ? [...richText(`Passo ${n} — `), ...richTextComDestaque(passo.titulo)] : richTextComDestaque(passo.titulo);
    const children = [];
    if (passo.descricao) children.push(bloco('paragraph', { rich_text: richText(passo.descricao) }));
    const uploadId = uploadIdDoPasso(passo);
    if (uploadId) {
      children.push(bloco('image', { type: 'file_upload', file_upload: { id: uploadId }, caption: richText(`Passo ${n}`) }));
    }
    const corpo = { rich_text };
    if (children.length) corpo.children = children;
    blocos.push(bloco('numbered_list_item', corpo));
  });
  return { titulo, blocos };
}

/** Divide respeitando ≤ maxTopo blocos de topo e ≤ maxTotal contando filhos por requisição. @returns {object[][]} */
export function dividirEmLotes(blocos, { maxTopo = 100, maxTotal = 1000 } = {}) {
  const lotes = [];
  let atual = [];
  let total = 0;
  for (const b of blocos) {
    const n = contarBlocos(b);
    if (atual.length > 0 && (atual.length + 1 > maxTopo || total + n > maxTotal)) {
      lotes.push(atual);
      atual = [];
      total = 0;
    }
    atual.push(b);
    total += n;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}
