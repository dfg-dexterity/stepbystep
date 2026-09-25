// Exportação para HTML autocontido (CSS inline, imagens em data:, sem script externo). Serve também
// para "Imprimir / salvar PDF" (impressao.css vem no css injetado). Visual de workflow: cabeçalho com
// resumo (autor · passos · tempo · data), um cartão por passo com número grande, título com o alvo em
// negrito, descrição, caixas de dica/atenção/nota e a imagem ampliada no alvo; seções como faixas.
import { numeroDoPasso, notasDoPasso, NOMES_NOTA } from './modelo.js';
import { formatarData, partesDoResumo } from './exportar-markdown.js';
import { trechosDoTitulo } from './frases.js';

export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const temImagem = (passo) => !!(passo.captura && !passo.captura.faltante && passo.captura.imagemId);

/** Título do passo com os trechos «…» (o alvo) em <strong>. */
export function tituloComDestaqueHtml(titulo) {
  return trechosDoTitulo(titulo).map((t) => (t.destaque ? `<strong>${escaparHtml(t.texto)}</strong>` : escaparHtml(t.texto))).join('');
}

/** Parágrafos de um texto livre (linha em branco separa parágrafos; quebra simples vira <br>). */
function paragrafos(texto, classe, recuo) {
  return String(texto).trim().split(/\n\s*\n/).map((p) => `${recuo}<p class="${classe}">${escaparHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function notaHtml(nota, recuo) {
  return `${recuo}<aside class="nota nota--${nota.tipo}" role="note">\n`
    + `${recuo}  <span class="nota-rotulo">${NOMES_NOTA[nota.tipo]}</span>\n`
    + `${paragrafos(nota.texto, 'nota-texto', recuo + '  ')}\n`
    + `${recuo}</aside>`;
}

/**
 * @param {object} guia @param {{imagemDataUrl:(passo:object, indice:number)=>string|null, css?:string, logoSvg?:string, data?:Date}} opcoes
 * @returns {string} documento único, sem <script src> nem <link> externo
 */
export function guiaParaHtml(guia, opcoes = {}) {
  const imagemDataUrl = opcoes.imagemDataUrl ?? (() => null);
  const css = opcoes.css ?? '';
  const titulo = guia.titulo || 'Manual sem título';
  const dataGeracao = formatarData(opcoes.data ?? new Date());
  const meta = partesDoResumo(guia, opcoes.data ?? new Date())
    .map((p) => `<span>${escaparHtml(p)}</span>`).join('<span class="sep" aria-hidden="true"> · </span>');

  const itens = guia.passos.map((passo, indice) => {
    const n = numeroDoPasso(guia, indice);
    if (passo.tipo === 'secao') {
      const partes = [`      <h2 class="secao">${escaparHtml(passo.titulo)}</h2>`];
      if (passo.descricao) partes.push(paragrafos(passo.descricao, 'secao-descricao', '      '));
      return `    <li class="secao" data-tipo="secao">\n${partes.join('\n')}\n    </li>`;
    }
    const partes = [`      <h2><span class="numero">${n}</span> <span class="titulo">${tituloComDestaqueHtml(passo.titulo)}</span></h2>`];
    const corpo = [];
    if (passo.descricao) corpo.push(paragrafos(passo.descricao, 'passo-descricao', '        '));
    for (const nota of notasDoPasso(passo)) corpo.push(notaHtml(nota, '        '));
    const src = temImagem(passo) ? imagemDataUrl(passo, indice) : null;
    if (src) {
      corpo.push(`        <figure class="passo-imagem"><img src="${escaparHtml(src)}" alt="${escaparHtml(`Passo ${n} — ${passo.titulo}`)}"></figure>`);
    }
    if (corpo.length) partes.push(`      <div class="passo-corpo">\n${corpo.join('\n')}\n      </div>`);
    return `    <li class="passo" data-tipo="${escaparHtml(passo.tipo)}" id="passo-${n}">\n${partes.join('\n')}\n    </li>`;
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
  <p class="sobretitulo">Manual passo a passo</p>
  <h1>${escaparHtml(titulo)}</h1>
${guia.descricao ? `${paragrafos(guia.descricao, 'descricao', '  ')}\n` : ''}  <p class="meta">${meta}</p>
  <button type="button" class="no-print" onclick="window.print()">Imprimir / salvar PDF</button>
</header>
<main>
  <ol class="passos">
${itens.join('\n')}
  </ol>
</main>
<footer class="rodape">Gerado com StepByStep · Dexterity IT Solutions · ${dataGeracao}</footer>
</body>
</html>
`;
}
