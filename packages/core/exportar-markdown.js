// Exportação para Markdown (README.md do zip "Markdown + imagens").
import { numeroDoPasso, notasDoPasso, resumoDoGuia, NOMES_NOTA } from './modelo.js';

/** dd/mm/aaaa no fuso local. */
export function formatarData(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Partes da linha de metadados do cabeçalho: [autor?, 'N passos', '≈ X min', 'dd/mm/aaaa'] (autor vazio é omitido;
 * data = guia.atualizadoEm, ou `dataPadrao` quando o guia não a tem). Juntas com ' · ' em todas as exportações.
 * @param {object} guia @param {Date} [dataPadrao] @returns {string[]}
 */
export function partesDoResumo(guia, dataPadrao = new Date()) {
  const r = resumoDoGuia(guia);
  const partes = [];
  if (r.autor) partes.push(r.autor);
  partes.push(`${r.passos} ${r.passos === 1 ? 'passo' : 'passos'}`, `≈ ${r.minutos} min`);
  const data = r.data && Number.isFinite(Date.parse(r.data)) ? new Date(r.data) : dataPadrao;
  partes.push(formatarData(data));
  return partes;
}

/** @param {number} numero número exibido do passo (1..n) @returns {string} 'imagens/passo-01.png' (2 dígitos; 3 a partir de 100) */
export function nomeImagemExportada(indice) {
  return `imagens/passo-${String(indice).padStart(2, '0')}.png`;
}

const temImagem = (passo) => !!(passo.captura && !passo.captura.faltante && passo.captura.imagemId);

/**
 * Texto literal em Markdown (títulos, descrições e alt vêm de rótulos da página e do usuário): escapa a pontuação
 * que abriria ênfase, link/imagem, código, HTML, tabela ou entidade, e o início de linha que viraria título, lista,
 * citação ou régua. Em CommonMark toda pontuação ASCII pode ser escapada com `\`.
 */
export function escaparMarkdown(texto) {
  return String(texto ?? '')
    .replace(/[\\`*_[\]<>|~&]/g, (c) => '\\' + c)
    .replace(/^([ \t]*)([#>+=-])/gm, '$1\\$2')
    .replace(/^([ \t]*\d+)([.)])(?=\s|$)/gm, '$1\\$2');
}

/** Destino de link sem espaço nem parêntese (encerrariam o `(...)` da imagem); encodeURIComponent não codifica `()`. */
const CODIGO_CAMINHO = { ' ': '%20', '(': '%28', ')': '%29' };
const caminhoMarkdown = (caminho) => String(caminho).replace(/[ ()]/g, (c) => CODIGO_CAMINHO[c]);

/** Nota como citação: `> **Dica:** texto` (cada linha do texto continua dentro da citação). */
function blocoDeNota(nota) {
  const linhas = escaparMarkdown(nota.texto.trim()).split('\n');
  return [`> **${NOMES_NOTA[nota.tipo]}:** ${linhas[0]}`, ...linhas.slice(1).map((l) => (l ? `> ${l}` : '>'))].join('\n');
}

/**
 * @param {object} guia @param {{nomeImagem?:(passo:object, indice:number)=>string|null, data?:Date}} [opcoes]
 * @returns {string} Markdown: `# Título`, linha de metadados (autor · n passos · ≈ x min · data), descrição, por passo
 *   `## {n}. {titulo}` (secao: `## {titulo}`), descrição, notas em citação (`> **Dica:** …`), imagem (já assada com a
 *   área efetiva: zoom no alvo); rodapé.
 */
export function guiaParaMarkdown(guia, opcoes = {}) {
  const nomeImagem = opcoes.nomeImagem ?? ((passo, indice) => (temImagem(passo) ? nomeImagemExportada(numeroDoPasso(guia, indice)) : null));
  const linhas = [];
  linhas.push(`# ${escaparMarkdown(guia.titulo || 'Manual sem título')}`, '');
  linhas.push(`_${partesDoResumo(guia, opcoes.data).map(escaparMarkdown).join(' · ')}_`, '');
  if (guia.descricao) linhas.push(escaparMarkdown(guia.descricao), '');
  guia.passos.forEach((passo, indice) => {
    const n = numeroDoPasso(guia, indice);
    const titulo = escaparMarkdown(passo.titulo);
    if (passo.tipo === 'secao') {
      linhas.push(`## ${titulo}`, '');
      if (passo.descricao) linhas.push(escaparMarkdown(passo.descricao), '');
      return;
    }
    linhas.push(`## ${n}. ${titulo}`, '');
    if (passo.descricao) linhas.push(escaparMarkdown(passo.descricao), '');
    for (const nota of notasDoPasso(passo)) linhas.push(blocoDeNota(nota), '');
    const caminho = nomeImagem(passo, indice);
    if (caminho) linhas.push(`![Passo ${n} — ${titulo}](${caminhoMarkdown(caminho)})`, '');
  });
  linhas.push('---', `_Gerado com StepByStep · Dexterity IT Solutions · ${formatarData(opcoes.data ?? new Date())}_`, '');
  return linhas.join('\n');
}
