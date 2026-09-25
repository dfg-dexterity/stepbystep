// Exportação para HTML autocontido (CSS inline, imagens em data:, sem script externo). Serve também
// para "Imprimir / salvar PDF" (impressao.css vem no css injetado).
import { numeroDoPasso } from './modelo.js';
import { formatarData } from './exportar-markdown.js';

export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const temImagem = (passo) => !!(passo.captura && !passo.captura.faltante && passo.captura.imagemId);

/**
 * @param {object} guia @param {{imagemDataUrl:(passo:object, indice:number)=>string|null, css?:string, logoSvg?:string, data?:Date}} opcoes
 * @returns {string} documento único, sem <script src> nem <link> externo
 */
export function guiaParaHtml(guia, opcoes = {}) {
  const imagemDataUrl = opcoes.imagemDataUrl ?? (() => null);
  const css = opcoes.css ?? '';
  const titulo = guia.titulo || 'Manual sem título';
  const totalPassos = guia.passos.length;
  const data = formatarData(opcoes.data ?? new Date());
  const itens = guia.passos.map((passo, indice) => {
    const n = numeroDoPasso(guia, indice);
    if (passo.tipo === 'secao') {
      const desc = passo.descricao ? `\n      <p>${escaparHtml(passo.descricao)}</p>` : '';
      return `    <li class="secao" data-tipo="secao">\n      <h2 class="secao">${escaparHtml(passo.titulo)}</h2>${desc}\n    </li>`;
    }
    const partes = [`      <h2><span class="numero">${n}</span> ${escaparHtml(passo.titulo)}</h2>`];
    if (passo.descricao) partes.push(`      <p>${escaparHtml(passo.descricao)}</p>`);
    const src = temImagem(passo) ? imagemDataUrl(passo, indice) : null;
    if (src) partes.push(`      <img src="${escaparHtml(src)}" alt="${escaparHtml(`Passo ${n} — ${passo.titulo}`)}">`);
    return `    <li class="passo" data-tipo="${escaparHtml(passo.tipo)}">\n${partes.join('\n')}\n    </li>`;
  });

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaparHtml(titulo)}</title>
<style>
${css}
</style>
</head>
<body class="stepbystep-exportado">
<header class="cabecalho">
  <div class="marca">${opcoes.logoSvg ?? ''}</div>
  <h1>${escaparHtml(titulo)}</h1>
${guia.descricao ? `  <p class="descricao">${escaparHtml(guia.descricao)}</p>\n` : ''}  <p class="meta"><span class="numero">${totalPassos}</span> passos · ${data}</p>
  <button type="button" class="no-print" onclick="window.print()">Imprimir / salvar PDF</button>
</header>
<main>
  <ol class="passos">
${itens.join('\n')}
  </ol>
</main>
<footer class="rodape">Gerado com StepByStep · Dexterity IT Solutions · ${data}</footer>
</body>
</html>
`;
}
