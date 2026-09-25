// Blocos da API do Notion a partir do guia (limites: 100 blocos de topo, 1000 no total, 2000 chars por texto).
// Visual de workflow: cabeçalho com resumo, um título por passo, notas em callouts coloridos e a imagem ampliada.
import { numeroDoPasso, notasDoPasso, NOMES_NOTA } from './modelo.js';
import { partesDoResumo } from './exportar-markdown.js';
import { trechosDoTitulo } from './frases.js';

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

/** Trechos entre «» (par mais externo; «» sem par ficam literais) com annotations.bold, resto normal. @returns {object[]} */
export function richTextComDestaque(titulo) {
  return trechosDoTitulo(titulo).flatMap((t) => richText(t.texto, t.destaque ? { bold: true } : {}));
}

export function contarBlocos(bloco) {
  const filhos = bloco?.[bloco?.type]?.children ?? bloco?.children ?? [];
  return 1 + filhos.reduce((s, f) => s + contarBlocos(f), 0);
}

const bloco = (type, corpo) => ({ object: 'block', type, [type]: corpo });

/** Callout de cada tipo de nota (paleta Dexterity no que o Notion oferece: cerceta ≈ verde, âmbar ≈ laranja, roxo). */
export const CALLOUT_NOTA = {
  dica: { emoji: '💡', color: 'green_background' },
  atencao: { emoji: '⚠️', color: 'orange_background' },
  nota: { emoji: '📝', color: 'purple_background' },
};

/** Bloco callout de uma nota do passo: rótulo em negrito ("Dica: ") + texto (fatiado em 2000). */
export function blocoDeNota(nota) {
  const { emoji, color } = CALLOUT_NOTA[nota.tipo] ?? CALLOUT_NOTA.nota;
  return bloco('callout', {
    icon: { type: 'emoji', emoji },
    color,
    rich_text: [...richText(`${NOMES_NOTA[nota.tipo] ?? 'Nota'}: `, { bold: true }), ...richText(nota.texto.trim())],
  });
}

/**
 * Página do guia em blocos de topo (sem aninhamento; nenhum bloco depende de numbered_list, então seções não
 * reiniciam a numeração): callout 📘 com "Autor · N passos · ≈ X min · dd/mm/aaaa", parágrafo da descrição;
 * por passo heading_3 "n. título" («…» em negrito), parágrafo da descrição, um callout por nota e a imagem
 * (file_upload, legenda "Passo n"); seção → heading_2 (+ parágrafo da descrição).
 * @param {object} guia @param {{uploadIdDoPasso:(passo:object)=>string|null, data?:Date}} opcoes
 * @returns {{titulo:string, blocos:object[], origem:number[]}} origem[k] = índice do passo que gerou blocos[k] (−1 no cabeçalho)
 */
export function guiaParaBlocos(guia, opcoes = {}) {
  const uploadIdDoPasso = opcoes.uploadIdDoPasso ?? (() => null);
  const titulo = guia.titulo || 'Manual sem título';
  const blocos = [];
  const origem = [];
  const add = (b, i) => { blocos.push(b); origem.push(i); };
  add(bloco('callout', {
    icon: { type: 'emoji', emoji: '📘' },
    color: 'gray_background',
    rich_text: richText(partesDoResumo(guia, opcoes.data ?? new Date()).join(' · ')),
  }), -1);
  if (guia.descricao) add(bloco('paragraph', { rich_text: richText(guia.descricao) }), -1);

  guia.passos.forEach((passo, indice) => {
    if (passo.tipo === 'secao') {
      add(bloco('heading_2', { rich_text: richText(passo.titulo) }), indice);
      if (passo.descricao) add(bloco('paragraph', { rich_text: richText(passo.descricao) }), indice);
      return;
    }
    const n = numeroDoPasso(guia, indice);
    add(bloco('heading_3', { rich_text: [...richText(`${n}. `), ...richTextComDestaque(passo.titulo)] }), indice);
    if (passo.descricao) add(bloco('paragraph', { rich_text: richText(passo.descricao) }), indice);
    for (const nota of notasDoPasso(passo)) add(blocoDeNota(nota), indice);
    const uploadId = uploadIdDoPasso(passo);
    if (uploadId) add(bloco('image', { type: 'file_upload', file_upload: { id: uploadId }, caption: richText(`Passo ${n}`) }), indice);
  });
  return { titulo, blocos, origem };
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
