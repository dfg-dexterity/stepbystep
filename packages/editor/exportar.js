// Exportações: .stepbystep.zip (originais, intercâmbio), Markdown + imagens assadas (zip),
// HTML autocontido (CSS inline, imagens em data:) e Imprimir/PDF (HTML numa nova aba + print).
import { guiaParaPacote } from '../core/pacote.js';
import { criarZip } from '../core/zip.js';
import { guiaParaMarkdown, nomeImagemExportada } from '../core/exportar-markdown.js';
import { guiaParaHtml } from '../core/exportar-html.js';
import { assarPasso } from '../core/render-canvas.js';
import { areaEfetiva } from '../core/anotacoes.js';
import { numeroDoPasso } from '../core/modelo.js';
import { carregarImagem } from '../core/armazenamento.js';
import { obterBitmap } from './canvas-anotacao.js';
import { temImagem } from './estado.js';
import { avisar } from './componentes/aviso.js';

/** Nome de arquivo a partir do título ("cadastrar-fornecedor-no-sap-fiori"). */
export function slugDoGuia(guia) {
  const s = String(guia?.titulo ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 60) || 'guia';
}

export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function obterImagemOriginal(id) {
  const reg = await carregarImagem(id);
  if (!reg?.blob) return null;
  return { bytes: new Uint8Array(await reg.blob.arrayBuffer()), largura: reg.largura, altura: reg.altura, mime: reg.mime ?? reg.blob.type ?? 'image/png' };
}

/**
 * Imagem do passo com as anotações aplicadas (recorte, desfoque, marcações), na área efetiva: recorte manual,
 * senão zoom no alvo (padrão do guia ou do passo), senão a tela inteira.
 * @param {{reduzir1x?:boolean}} [opcoes] reduzir1x: largura de saída = área ÷ escala da captura
 * @returns {Promise<{blob:Blob, largura:number, altura:number}|null>}
 */
export async function assarImagemDoPasso(passo, guia, opcoes = {}) {
  if (!temImagem(passo)) return null;
  const bitmap = await obterBitmap(passo.captura.imagemId);
  if (!bitmap) return null;
  let larguraMax;
  if (opcoes.reduzir1x) {
    const escala = passo.captura.escala > 0 ? passo.captura.escala : 1;
    const area = areaEfetiva(passo, { largura: bitmap.width, altura: bitmap.height }, guia.estilo);
    larguraMax = Math.max(1, Math.round(area.w / escala));
  }
  return assarPasso(bitmap, passo, { estilo: guia.estilo, larguraMax });
}

/**
 * Fontes do marcador (Barlow Condensed) e do texto (Figtree) carregadas antes de assar: o canvas não espera
 * @font-face e desenharia com a fonte serifada padrão se nenhuma parte da página tivesse usado a família ainda.
 */
export const fontesDoDesenho = () => (document.fonts?.load
  ? Promise.all(['600 20px "Barlow Condensed"', '600 16px Figtree'].map((f) => document.fonts.load(f))).then(() => document.fonts.ready).catch(() => {})
  : Promise.resolve());

async function assarTodas(guia, opcoes, rotulo) {
  await fontesDoDesenho();
  const comImagem = guia.passos.filter(temImagem);
  const aviso = avisar(`${rotulo}: preparando imagens…`, { duracao: 0 });
  const saida = new Map(); // passoId → { blob, largura, altura }
  try {
    let n = 0;
    for (const p of comImagem) {
      aviso.atualizar(`${rotulo}: imagem ${++n} de ${comImagem.length}`);
      const r = await assarImagemDoPasso(p, guia, opcoes);
      if (r) saida.set(p.id, r);
    }
  } finally {
    aviso.fechar();
  }
  return saida;
}

const blobParaDataUrl = (blob) => new Promise((resolver, rejeitar) => {
  const fr = new FileReader();
  fr.onload = () => resolver(fr.result);
  fr.onerror = () => rejeitar(fr.error);
  fr.readAsDataURL(blob);
});

/** .stepbystep.zip: guide.json + PNGs originais (sem anotações assadas). */
export async function exportarPacote(guia) {
  const zip = await guiaParaPacote(guia, obterImagemOriginal);
  baixar(new Blob([zip], { type: 'application/zip' }), `${slugDoGuia(guia)}.stepbystep.zip`);
  avisar('Pacote .stepbystep.zip gerado.', { tipo: 'sucesso' });
}

/** Markdown + imagens.zip: README.md + imagens/passo-NN.png assadas. */
export async function exportarMarkdown(guia, opcoes = {}) {
  const assadas = await assarTodas(guia, { reduzir1x: !!opcoes.reduzir1x }, 'Markdown');
  const entradas = [];
  const nomes = new Map();
  guia.passos.forEach((p, i) => {
    const img = assadas.get(p.id);
    if (!img) return;
    const nome = nomeImagemExportada(numeroDoPasso(guia, i));
    nomes.set(p.id, nome);
    entradas.push({ nome, blob: img.blob });
  });
  const md = guiaParaMarkdown(guia, { nomeImagem: (p) => nomes.get(p.id) ?? null });
  const arquivos = [{ nome: 'README.md', dados: new TextEncoder().encode(md) }];
  for (const e of entradas) arquivos.push({ nome: e.nome, dados: new Uint8Array(await e.blob.arrayBuffer()) });
  const zip = await criarZip(arquivos);
  baixar(new Blob([zip], { type: 'application/zip' }), `${slugDoGuia(guia)}-markdown.zip`);
  avisar('Markdown + imagens exportados.', { tipo: 'sucesso' });
}

let cssCache = null;
async function lerTexto(nome) {
  const r = await fetch(new URL(nome, import.meta.url));
  if (!r.ok) throw new Error(`Não foi possível ler ${nome}`);
  return r.text();
}
async function recursosDoHtml() {
  if (!cssCache) {
    cssCache = Promise.all([lerTexto('./dexterity.css'), lerTexto('./impressao.css'), lerTexto('./logo-dexterity.svg').catch(() => '')])
      .then(([dexterity, impressao, logo]) => ({ css: `${dexterity}\n${impressao}`, logo }))
      .catch((e) => { cssCache = null; throw e; });
  }
  return cssCache;
}

/** HTML autocontido do guia (string). */
export async function gerarHtml(guia) {
  const [{ css, logo }, assadas] = await Promise.all([recursosDoHtml(), assarTodas(guia, {}, 'HTML')]);
  const dataUrls = new Map();
  for (const [id, img] of assadas) dataUrls.set(id, await blobParaDataUrl(img.blob));
  return guiaParaHtml(guia, { imagemDataUrl: (p) => dataUrls.get(p.id) ?? null, css, logoSvg: logo });
}

export async function exportarHtml(guia) {
  const html = await gerarHtml(guia);
  baixar(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slugDoGuia(guia)}.html`);
  avisar('HTML autocontido gerado.', { tipo: 'sucesso' });
}

/**
 * Abre o HTML numa nova aba (Blob URL) e chama print(). A aba pode vir já aberta pelo chamador
 * (window.open dentro do clique, antes de assar as imagens, para não cair no bloqueio de pop-up).
 */
export async function imprimir(guia, { janela = null } = {}) {
  let html;
  try { html = await gerarHtml(guia); } catch (e) { janela?.close(); throw e; }
  // só a cópia de impressão leva um script inline: dispara o diálogo assim que a aba carrega
  html = html.replace('</body>', '<script>addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script>\n</body>');
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const aba = janela && !janela.closed ? janela : window.open(url, '_blank');
  if (!aba) {
    avisar('O navegador bloqueou a nova aba. Baixe o HTML e imprima a partir dele.', { tipo: 'atencao', acao: { rotulo: 'Baixar HTML', executar: () => baixar(blob, `${slugDoGuia(guia)}.html`) } });
    return;
  }
  if (aba === janela) aba.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
