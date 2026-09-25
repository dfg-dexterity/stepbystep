// Pacote .stepbystep.zip / pasta: guide.json (com `imagens`) + PNGs originais.
import { criarZip } from './zip.js';
import { migrarGuia, validarGuia, notasDoPasso } from './modelo.js';

export const NOME_GUIDE = 'guide.json';
export const PASTA_IMAGENS = 'imagens/';

const EXTENSOES = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

export function caminhoImagem(imagemId, mime = 'image/png') {
  return `${PASTA_IMAGENS}${imagemId}.${EXTENSOES[mime] ?? 'png'}`;
}

/** Ids de imagem referenciados pelos passos, na ordem de primeira aparição. */
export function imagensDoGuia(guia) {
  const ids = [];
  for (const p of guia.passos ?? []) {
    const id = p.captura?.imagemId;
    if (id && !p.captura.faltante && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Serializa guide.json (com `imagens`) + PNGs originais. Notas sem texto são descartadas.
 * @param {object} guia @param {(imagemId:string)=>Promise<{bytes:Uint8Array, largura:number, altura:number, mime:string}|null>} obterImagem
 * @returns {Promise<Uint8Array>} zip
 */
export async function guiaParaPacote(guia, obterImagem) {
  const { imagens: _ignorado, ...semImagens } = guia;
  const imagens = {};
  const entradas = [];
  for (const id of imagensDoGuia(guia)) {
    const img = await obterImagem(id);
    if (!img) continue;
    const mime = img.mime ?? 'image/png';
    const arquivo = caminhoImagem(id, mime);
    imagens[id] = { arquivo, largura: img.largura, altura: img.altura, mime };
    entradas.push({ nome: arquivo, dados: img.bytes });
  }
  // notas vazias (em edição no editor) não entram: o guide.json precisa passar em validarGuia na volta
  if (Array.isArray(semImagens.passos)) {
    semImagens.passos = semImagens.passos.map((p) => (Array.isArray(p?.notas) ? { ...p, notas: notasDoPasso(p) } : p));
  }
  const texto = JSON.stringify({ ...semImagens, imagens }, null, 2) + '\n';
  return criarZip([{ nome: NOME_GUIDE, dados: new TextEncoder().encode(texto) }, ...entradas]);
}

/**
 * Aceita arquivos na raiz ou dentro de UM diretório de primeiro nível (zip do Finder/ditto --keepParent). Valida e migra.
 * @param {Map<string, Uint8Array>} arquivos @returns {{guia:object, imagens:Map<string, Uint8Array>, avisos:string[]}} guia sem `imagens`
 */
export function lerPacote(arquivos) {
  const nomes = [...arquivos.keys()].filter((n) => !n.startsWith('__MACOSX/') && !n.includes('/__MACOSX/'));
  let prefixo = null;
  if (nomes.includes(NOME_GUIDE)) prefixo = '';
  else {
    const candidatos = nomes.filter((n) => n.endsWith('/' + NOME_GUIDE) && n.split('/').length === 2);
    if (candidatos.length === 1) prefixo = candidatos[0].slice(0, -NOME_GUIDE.length);
    else if (candidatos.length > 1) throw new Error('O pacote contém mais de um guide.json');
  }
  if (prefixo === null) throw new Error('guide.json não encontrado no pacote');

  let bruto;
  try {
    bruto = JSON.parse(new TextDecoder().decode(arquivos.get(prefixo + NOME_GUIDE)));
  } catch {
    throw new Error('guide.json não é um JSON válido');
  }
  const guia = migrarGuia(bruto);
  const validacao = validarGuia(guia);
  if (!validacao.ok) throw new Error('Guia inválido: ' + validacao.erros.join('; '));

  const avisos = [];
  const imagens = new Map();
  const mapa = guia.imagens ?? {};
  delete guia.imagens;

  for (const id of imagensDoGuia(guia)) {
    const arquivo = mapa[id]?.arquivo ?? caminhoImagem(id);
    const bytes = arquivos.get(prefixo + arquivo);
    if (bytes) { imagens.set(id, bytes); continue; }
    avisos.push(`Imagem ${id} (${arquivo}) não encontrada no pacote`);
    for (const p of guia.passos) {
      if (p.captura?.imagemId === id) { p.captura.imagemId = null; p.captura.faltante = true; }
    }
  }
  for (const [id, info] of Object.entries(mapa)) {
    if (!imagens.has(id) && arquivos.has(prefixo + info.arquivo)) avisos.push(`Imagem ${id} não é usada por nenhum passo`);
  }
  return { guia, imagens, avisos };
}
