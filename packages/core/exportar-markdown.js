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
 * @param {object} guia @param {{nomeImagem?:(passo:object, indice:number)=>string|null, data?:Date}} [opcoes]
 * @returns {string} Markdown: `# Título`, descrição, por passo `## {n}. {titulo}` (secao: `## {titulo}`), descrição, imagem; rodapé.
 */
export function guiaParaMarkdown(guia, opcoes = {}) {
  const nomeImagem = opcoes.nomeImagem ?? ((passo, indice) => (temImagem(passo) ? nomeImagemExportada(numeroDoPasso(guia, indice)) : null));
  const linhas = [];
  linhas.push(`# ${guia.titulo || 'Manual sem título'}`, '');
  if (guia.descricao) linhas.push(guia.descricao, '');
  guia.passos.forEach((passo, indice) => {
    const n = numeroDoPasso(guia, indice);
    if (passo.tipo === 'secao') {
      linhas.push(`## ${passo.titulo}`, '');
      if (passo.descricao) linhas.push(passo.descricao, '');
      return;
    }
    linhas.push(`## ${n}. ${passo.titulo}`, '');
    if (passo.descricao) linhas.push(passo.descricao, '');
    const caminho = nomeImagem(passo, indice);
    if (caminho) linhas.push(`![Passo ${n} — ${passo.titulo}](${caminho})`, '');
  });
  linhas.push('---', `_Gerado com StepByStep · Dexterity IT Solutions · ${formatarData(opcoes.data ?? new Date())}_`, '');
  return linhas.join('\n');
}
