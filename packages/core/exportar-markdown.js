// Exportação para Markdown (README.md do zip "Markdown + imagens").
import { numeroDoPasso } from './modelo.js';

/** dd/mm/aaaa no fuso local. */
export function formatarData(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
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

/**
 * @param {object} guia @param {{nomeImagem?:(passo:object, indice:number)=>string|null, data?:Date}} [opcoes]
 * @returns {string} Markdown: `# Título`, descrição, por passo `## {n}. {titulo}` (secao: `## {titulo}`), descrição, imagem; rodapé.
 */
export function guiaParaMarkdown(guia, opcoes = {}) {
  const nomeImagem = opcoes.nomeImagem ?? ((passo, indice) => (temImagem(passo) ? nomeImagemExportada(numeroDoPasso(guia, indice)) : null));
  const linhas = [];
  linhas.push(`# ${escaparMarkdown(guia.titulo || 'Manual sem título')}`, '');
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
    const caminho = nomeImagem(passo, indice);
    if (caminho) linhas.push(`![Passo ${n} — ${titulo}](${caminhoMarkdown(caminho)})`, '');
  });
  linhas.push('---', `_Gerado com StepByStep · Dexterity IT Solutions · ${formatarData(opcoes.data ?? new Date())}_`, '');
  return linhas.join('\n');
}
