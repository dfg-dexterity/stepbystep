// Codificador/leitor PNG mínimo, sem dependências além de node:zlib.
// Uso: fixtures de teste (scripts/gerar-fixtures.mjs) e ícones da extensão.
// Gera sempre PNG RGBA 8 bits, sem entrelaçamento, um único IDAT.
import { deflateSync, inflateSync } from 'node:zlib';

const ASSINATURA = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Tabela CRC-32 (polinômio 0xEDB88320), a mesma do zip e do PNG.
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 sem sinal de um Uint8Array. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(valor) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, valor >>> 0);
  return b;
}

function chunk(tipo, dados) {
  const nome = new TextEncoder().encode(tipo);
  const corpo = new Uint8Array(nome.length + dados.length);
  corpo.set(nome, 0);
  corpo.set(dados, nome.length);
  const saida = new Uint8Array(4 + corpo.length + 4);
  saida.set(u32(dados.length), 0);
  saida.set(corpo, 4);
  saida.set(u32(crc32(corpo)), 4 + corpo.length);
  return saida;
}

/**
 * Codifica um bitmap RGBA como PNG.
 * @param {{largura:number, altura:number, rgba:Uint8Array, nivel?:number}} o
 *   rgba: largura*altura*4 bytes (linha a linha, canais R,G,B,A). nivel: compressão do deflate (padrão 9).
 * @returns {Uint8Array} bytes do arquivo PNG
 */
export function codificarPng({ largura, altura, rgba, nivel = 9 }) {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura <= 0 || altura <= 0) {
    throw new Error('Dimensões inválidas para o PNG');
  }
  if (!(rgba instanceof Uint8Array) || rgba.length !== largura * altura * 4) {
    throw new Error(`rgba deve ter ${largura * altura * 4} bytes`);
  }
  // Filtro "Up" (2) em linhas iguais à anterior vira zeros e comprime muito; "None" (0) nas demais.
  const larguraLinha = largura * 4;
  const bruto = new Uint8Array((larguraLinha + 1) * altura);
  for (let y = 0; y < altura; y++) {
    const inicio = y * larguraLinha;
    const linha = rgba.subarray(inicio, inicio + larguraLinha);
    const destino = y * (larguraLinha + 1);
    let igualAnterior = y > 0;
    if (igualAnterior) {
      const anterior = rgba.subarray(inicio - larguraLinha, inicio);
      for (let i = 0; i < larguraLinha; i++) {
        if (linha[i] !== anterior[i]) { igualAnterior = false; break; }
      }
    }
    if (igualAnterior) {
      bruto[destino] = 2; // filtro Up: diferença zero
    } else {
      bruto[destino] = 0;
      bruto.set(linha, destino + 1);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, largura);
  dv.setUint32(4, altura);
  ihdr[8] = 8;  // profundidade de bits
  ihdr[9] = 6;  // tipo de cor: RGBA
  ihdr[10] = 0; // compressão
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sem entrelaçamento
  const idat = new Uint8Array(deflateSync(bruto, { level: nivel }));
  const partes = [ASSINATURA, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { saida.set(p, pos); pos += p.length; }
  return saida;
}

/**
 * Lê largura e altura do IHDR de um PNG.
 * @param {Uint8Array} bytes @returns {{largura:number, altura:number}}
 */
export function lerDimensoesPng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) throw new Error('PNG inválido');
  for (let i = 0; i < 8; i++) if (bytes[i] !== ASSINATURA[i]) throw new Error('PNG inválido: assinatura');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(12, 16)) !== 'IHDR') throw new Error('PNG inválido: IHDR ausente');
  return { largura: dv.getUint32(16), altura: dv.getUint32(20) };
}

/**
 * Decodifica um PNG gerado por codificarPng (RGBA 8 bits, filtros None/Up, um ou mais IDAT).
 * Útil em testes para conferir pixels; não cobre paleta, entrelaçamento nem outros filtros.
 * @param {Uint8Array} bytes @returns {{largura:number, altura:number, rgba:Uint8Array}}
 */
export function decodificarPng(bytes) {
  const { largura, altura } = lerDimensoesPng(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idats = [];
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const tamanho = dv.getUint32(pos);
    const tipo = new TextDecoder().decode(bytes.subarray(pos + 4, pos + 8));
    if (tipo === 'IHDR' && (bytes[pos + 8 + 9] !== 6 || bytes[pos + 8 + 8] !== 8)) {
      throw new Error('decodificarPng só cobre RGBA 8 bits');
    }
    if (tipo === 'IDAT') idats.push(bytes.subarray(pos + 8, pos + 8 + tamanho));
    if (tipo === 'IEND') break;
    pos += 12 + tamanho;
  }
  const comprimido = new Uint8Array(idats.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const d of idats) { comprimido.set(d, p); p += d.length; }
  const bruto = new Uint8Array(inflateSync(comprimido));
  const larguraLinha = largura * 4;
  const rgba = new Uint8Array(larguraLinha * altura);
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (larguraLinha + 1)];
    const origem = bruto.subarray(y * (larguraLinha + 1) + 1, (y + 1) * (larguraLinha + 1));
    const destino = y * larguraLinha;
    if (filtro === 0) rgba.set(origem, destino);
    else if (filtro === 2) {
      for (let i = 0; i < larguraLinha; i++) rgba[destino + i] = (origem[i] + (y > 0 ? rgba[destino - larguraLinha + i] : 0)) & 0xff;
    } else throw new Error(`Filtro PNG ${filtro} não suportado`);
  }
  return { largura, altura, rgba };
}
