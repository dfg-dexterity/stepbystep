// Importação: .json (só metadados), .zip/.stepbystep.zip (lerZip + lerPacote) e pasta
// (webkitdirectory ou arrastar com webkitGetAsEntry). Mede cada PNG, grava as imagens no
// IndexedDB, gera os títulos vazios (Mac) e resolve conflito de id (substituir/duplicar).
import { lerZip } from '../core/zip.js';
import { lerPacote, NOME_GUIDE } from '../core/pacote.js';
import { migrarGuia, validarGuia, renumerarMarcadores } from '../core/modelo.js';
import { gerarTitulo } from '../core/frases.js';
import { gerarId } from '../core/ids.js';
import { anotacoesAutomaticas } from '../core/anotacoes.js';
import { carregarGuia, excluirGuia, salvarGuia, salvarImagem } from '../core/armazenamento.js';
import { plataformaDoGuia } from './estado.js';

/** @typedef {{caminho:string, arquivo:Blob}} Entrada */

const ehZip = (nome) => /\.zip$/i.test(nome);
const ehJson = (nome) => /\.json$/i.test(nome);
const nomeBase = (caminho) => caminho.split('/').pop();

/** Arquivos de um <input type="file"> (com ou sem webkitdirectory). @returns {Entrada[]} */
export function entradasDeInput(input) {
  return [...(input.files ?? [])].map((f) => ({ caminho: f.webkitRelativePath || f.name, arquivo: f }));
}

function lerEntradaRecursiva(entry, prefixo, saida) {
  return new Promise((resolver) => {
    if (entry.isFile) {
      entry.file((f) => { saida.push({ caminho: prefixo + entry.name, arquivo: f }); resolver(); }, () => resolver());
    } else if (entry.isDirectory) {
      const leitor = entry.createReader();
      const lote = () => leitor.readEntries(async (itens) => {
        if (!itens.length) { resolver(); return; }
        for (const item of itens) await lerEntradaRecursiva(item, `${prefixo}${entry.name}/`, saida);
        lote(); // readEntries devolve em lotes de até 100
      }, () => resolver());
      lote();
    } else resolver();
  });
}

/** Arquivos/pastas soltos na área de arrastar. @returns {Promise<Entrada[]>} */
export async function entradasDeDataTransfer(dt) {
  const itens = [...(dt.items ?? [])];
  const saida = [];
  const entries = itens.map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (entries.length) {
    for (const e of entries) await lerEntradaRecursiva(e, '', saida);
    if (saida.length) return saida;
  }
  return [...(dt.files ?? [])].map((f) => ({ caminho: f.name, arquivo: f }));
}

const bytesDe = async (blob) => new Uint8Array(await blob.arrayBuffer());

/** Só metadados (.json): passos com imagem ficam `faltante` até o usuário anexar. */
function guiaSemImagens(texto) {
  let bruto;
  try { bruto = JSON.parse(texto); } catch { throw new Error('O arquivo .json não é um JSON válido'); }
  const guia = migrarGuia(bruto);
  delete guia.imagens;
  for (const p of guia.passos) {
    if (p.captura?.imagemId) { p.captura.faltante = true; p.captura.imagemId = null; }
  }
  const v = validarGuia(guia);
  if (!v.ok) throw new Error('Guia inválido: ' + v.erros.join('; '));
  return { guia, imagens: new Map(), avisos: ['Arquivo .json sem imagens: anexe as capturas passo a passo.'] };
}

/** Novos ids para guia, passos, anotações e imagens (duplicar). */
function remapearIds(guia, imagens) {
  guia.id = gerarId('g');
  const mapaImagens = new Map();
  for (const id of imagens.keys()) mapaImagens.set(id, gerarId('img'));
  const novasImagens = new Map();
  for (const [id, bytes] of imagens) novasImagens.set(mapaImagens.get(id), bytes);
  for (const p of guia.passos) {
    p.id = gerarId('p');
    p.anotacoes = p.anotacoes.map((a) => ({ ...a, id: gerarId('a') }));
    if (p.captura?.imagemId) p.captura.imagemId = mapaImagens.get(p.captura.imagemId) ?? gerarId('img');
    delete p.mescladoDe;
  }
  guia.publicacoes = [];
  return novasImagens;
}

/** Títulos das frases para passos vazios (Mac) e anotações automáticas quando não há nenhuma marcação. */
export function completarPassos(guia) {
  const plataforma = plataformaDoGuia(guia);
  guia.passos.forEach((p, i) => {
    if (p.tipo === 'secao' || p.tipo === 'manual') return;
    if (p.titulo !== '' || !p.tituloAuto) return;
    p.titulo = gerarTitulo(p, { plataforma });
    const temMarcacao = p.anotacoes.some((a) => a.tipo === 'retangulo' || a.tipo === 'marcador' || a.tipo === 'desfoque');
    if (temMarcacao) return;
    const numero = guia.passos.slice(0, i + 1).filter((x) => x.tipo !== 'secao').length;
    const temRecorte = p.anotacoes.some((a) => a.tipo === 'recorte');
    for (const a of anotacoesAutomaticas(p, { numero })) {
      if (a.tipo === 'recorte' && temRecorte) continue; // o Mac já gravou o recorte pela janela
      p.anotacoes.push(a);
    }
  });
  renumerarMarcadores(guia);
  return guia;
}

/**
 * Importa um guia a partir de arquivos (zip, json ou pasta).
 * @param {Entrada[]} entradas
 * @param {{aoProgredir?:(p:{fase:string, atual:number, total:number})=>void, resolverConflito?:(existente:object)=>Promise<'substituir'|'duplicar'|null>}} [opcoes]
 * @returns {Promise<{guiaId:string, titulo:string, passos:number, avisos:string[]}>}
 */
export async function importarEntradas(entradas, opcoes = {}) {
  const progresso = opcoes.aoProgredir ?? (() => {});
  if (!entradas?.length) throw new Error('Nenhum arquivo selecionado');
  progresso({ fase: 'lendo', atual: 0, total: 1 });

  let lido;
  const unico = entradas.length === 1 ? entradas[0] : null;
  if (unico && ehZip(unico.caminho)) {
    lido = lerPacote(await lerZip(await bytesDe(unico.arquivo)));
  } else if (unico && ehJson(unico.caminho)) {
    lido = guiaSemImagens(await unico.arquivo.text());
  } else {
    const arquivos = new Map();
    for (const e of entradas) arquivos.set(e.caminho, await bytesDe(e.arquivo));
    // um zip dentro da pasta solta (ex.: só o .stepbystep.zip arrastado junto com outros) não é aceito: pede o guide.json
    if (![...arquivos.keys()].some((n) => nomeBase(n) === NOME_GUIDE)) {
      throw new Error('Selecione o arquivo .stepbystep.zip, o guide.json ou a pasta gravada (com guide.json e imagens/).');
    }
    lido = lerPacote(arquivos);
  }
  const { guia, avisos } = lido;
  let imagens = lido.imagens;

  // conflito de id: substituir o guia existente ou importar como cópia
  const existente = await carregarGuia(guia.id);
  if (existente) {
    const decisao = opcoes.resolverConflito ? await opcoes.resolverConflito(existente) : 'duplicar';
    if (!decisao) throw new Error('Importação cancelada');
    if (decisao === 'duplicar') imagens = remapearIds(guia, imagens);
    else await excluirGuia(guia.id);
  }

  // imagens: mede no bitmap (garante largura/altura/escala) e grava no IndexedDB
  const total = imagens.size;
  let feitas = 0;
  for (const [id, bytes] of imagens) {
    progresso({ fase: 'imagens', atual: ++feitas, total });
    const mime = lido.guia.imagens?.[id]?.mime ?? (bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : 'image/webp');
    const blob = new Blob([bytes], { type: mime });
    let largura = 0, altura = 0;
    try {
      const bmp = await createImageBitmap(blob);
      largura = bmp.width; altura = bmp.height;
      bmp.close();
    } catch {
      avisos.push(`Imagem ${id} não pôde ser decodificada`);
      for (const p of guia.passos) if (p.captura?.imagemId === id) { p.captura.imagemId = null; p.captura.faltante = true; }
      continue;
    }
    await salvarImagem({ id, guiaId: guia.id, blob, largura, altura, mime });
    for (const p of guia.passos) {
      if (p.captura?.imagemId !== id) continue;
      p.captura.largura = largura;
      p.captura.altura = altura;
      if (p.captura.viewport?.largura > 0) p.captura.escala = largura / p.captura.viewport.largura;
      else if (!(p.captura.escala > 0)) p.captura.escala = 1;
    }
  }

  completarPassos(guia);
  if (guia.estado === 'gravando') guia.estado = 'concluido';
  progresso({ fase: 'salvando', atual: 1, total: 1 });
  await salvarGuia(guia);
  try { await navigator.storage?.persist?.(); } catch { /* sem permissão: segue sem persistência garantida */ }
  return { guiaId: guia.id, titulo: guia.titulo, passos: guia.passos.length, avisos };
}
