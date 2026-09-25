// Zip mínimo: escritor STORE (sem compressão — PNGs já são deflatados) e leitor STORE + DEFLATE
// (DecompressionStream('deflate-raw'), disponível em Node 22, no SW e na página).

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_LOCALIZADOR_ZIP64 = 0x07064b50;   // 20 bytes imediatamente antes do fim do diretório central
// Sem zip64: os campos de 32/16 bits saturam nesses valores (e um zip64 real os grava assim, como sentinela)
const LIMITE_BYTES = 0xffffffff;
const LIMITE_ENTRADAS = 0xffff;
const MENSAGEM_LIMITE = 'O pacote excede o limite do formato zip (4 GB ou 65 535 arquivos). Exporte o guia em partes.';
const MENSAGEM_ZIP64 = 'Arquivo zip64 (mais de 4 GB ou 65 535 arquivos) não é suportado.';

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @returns {number} CRC-32 sem sinal */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data/hora no formato DOS (resolução de 2 s; anos a partir de 1980). */
function dataDos(d) {
  const ano = Math.max(1980, d.getFullYear());
  const data = ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { data, hora };
}

/**
 * @param {{nome:string, dados:Uint8Array, modificadoEm?:Date}[]} entradas
 * @returns {Promise<Uint8Array>} zip STORE com nomes em UTF-8
 */
export async function criarZip(entradas) {
  if (entradas.length > LIMITE_ENTRADAS) throw new Error(MENSAGEM_LIMITE);
  const codificador = new TextEncoder();
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const entrada of entradas) {
    const nome = codificador.encode(entrada.nome);
    const dados = entrada.dados instanceof Uint8Array ? entrada.dados : new Uint8Array(entrada.dados);
    // tamanho e deslocamento do diretório central são de 32 bits: acima disso o DataView truncaria em silêncio
    if (dados.length >= LIMITE_BYTES || deslocamento + 30 + nome.length + dados.length >= LIMITE_BYTES) throw new Error(MENSAGEM_LIMITE);
    const crc = crc32(dados);
    const { data, hora } = dataDos(entrada.modificadoEm ?? new Date());

    const local = new Uint8Array(30 + nome.length);
    const dl = new DataView(local.buffer);
    dl.setUint32(0, ASSINATURA_LOCAL, true);
    dl.setUint16(4, 20, true);       // versão necessária
    dl.setUint16(6, 0x0800, true);   // flags: nomes em UTF-8
    dl.setUint16(8, 0, true);        // método STORE
    dl.setUint16(10, hora, true);
    dl.setUint16(12, data, true);
    dl.setUint32(14, crc, true);
    dl.setUint32(18, dados.length, true);
    dl.setUint32(22, dados.length, true);
    dl.setUint16(26, nome.length, true);
    dl.setUint16(28, 0, true);
    local.set(nome, 30);
    locais.push(local, dados);

    const central = new Uint8Array(46 + nome.length);
    const dc = new DataView(central.buffer);
    dc.setUint32(0, ASSINATURA_CENTRAL, true);
    dc.setUint16(4, 20, true);       // versão de quem criou
    dc.setUint16(6, 20, true);       // versão necessária
    dc.setUint16(8, 0x0800, true);
    dc.setUint16(10, 0, true);
    dc.setUint16(12, hora, true);
    dc.setUint16(14, data, true);
    dc.setUint32(16, crc, true);
    dc.setUint32(20, dados.length, true);
    dc.setUint32(24, dados.length, true);
    dc.setUint16(28, nome.length, true);
    dc.setUint16(30, 0, true);       // extra
    dc.setUint16(32, 0, true);       // comentário
    dc.setUint16(34, 0, true);       // disco
    dc.setUint16(36, 0, true);       // atributos internos
    dc.setUint32(38, 0, true);       // atributos externos
    dc.setUint32(42, deslocamento, true);
    central.set(nome, 46);
    centrais.push(central);

    deslocamento += local.length + dados.length;
  }
  const tamanhoCentral = centrais.reduce((s, c) => s + c.length, 0);
  const fim = new Uint8Array(22);
  const df = new DataView(fim.buffer);
  df.setUint32(0, ASSINATURA_FIM, true);
  df.setUint16(4, 0, true);
  df.setUint16(6, 0, true);
  df.setUint16(8, entradas.length, true);
  df.setUint16(10, entradas.length, true);
  df.setUint32(12, tamanhoCentral, true);
  df.setUint32(16, deslocamento, true);
  df.setUint16(20, 0, true);

  const total = deslocamento + tamanhoCentral + fim.length;
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const parte of [...locais, ...centrais, fim]) { saida.set(parte, pos); pos += parte.length; }
  return saida;
}

async function inflarRaw(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** Nomes como o APPNOTE manda (`/`): zips do Windows gravam `pasta\arquivo`, e alguns `./arquivo`. */
const normalizarNome = (nome) => nome.replace(/\\/g, '/').replace(/^(\.\/)+/, '');

/**
 * Leitor STORE e DEFLATE. Ignora diretórios e __MACOSX/. Confere o CRC-32 de cada entrada; rejeita zip64.
 * @param {Uint8Array} bytes @returns {Promise<Map<string, Uint8Array>>} nome → bytes
 */
export async function lerZip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // fim do diretório central: procura a assinatura de trás para a frente (comentário de até 64 KB)
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === ASSINATURA_FIM) { fim = i; break; }
  }
  if (fim < 0) throw new Error('Arquivo zip inválido (fim do diretório central não encontrado)');
  const quantidade = dv.getUint16(fim + 10, true);
  let pos = dv.getUint32(fim + 16, true);
  if ((fim >= 20 && dv.getUint32(fim - 20, true) === ASSINATURA_LOCALIZADOR_ZIP64) || pos === LIMITE_BYTES) throw new Error(MENSAGEM_ZIP64);
  const decodificador = new TextDecoder();
  const saida = new Map();
  for (let i = 0; i < quantidade; i++) {
    if (dv.getUint32(pos, true) !== ASSINATURA_CENTRAL) throw new Error('Arquivo zip inválido (entrada do diretório central)');
    const metodo = dv.getUint16(pos + 10, true);
    const crcEsperado = dv.getUint32(pos + 16, true);
    const tamanhoComprimido = dv.getUint32(pos + 20, true);
    const tamanhoOriginal = dv.getUint32(pos + 24, true);
    const tamanhoNome = dv.getUint16(pos + 28, true);
    const tamanhoExtra = dv.getUint16(pos + 30, true);
    const tamanhoComentario = dv.getUint16(pos + 32, true);
    const deslocamentoLocal = dv.getUint32(pos + 42, true);
    const nome = normalizarNome(decodificador.decode(b.subarray(pos + 46, pos + 46 + tamanhoNome)));
    pos += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;

    if (nome.endsWith('/') || nome.startsWith('__MACOSX/') || nome.includes('/__MACOSX/') || nome.split('/').pop() === '.DS_Store') continue;
    // zip64 grava 0xFFFFFFFF nesses campos e o valor real no extra: o slice devolveria o resto do arquivo
    if (tamanhoComprimido === LIMITE_BYTES || tamanhoOriginal === LIMITE_BYTES || deslocamentoLocal === LIMITE_BYTES) throw new Error(MENSAGEM_ZIP64);
    if (dv.getUint32(deslocamentoLocal, true) !== ASSINATURA_LOCAL) throw new Error(`Arquivo zip inválido (cabeçalho local de ${nome})`);
    const nomeLocal = dv.getUint16(deslocamentoLocal + 26, true);
    const extraLocal = dv.getUint16(deslocamentoLocal + 28, true);
    const inicio = deslocamentoLocal + 30 + nomeLocal + extraLocal;
    const comprimido = b.slice(inicio, inicio + tamanhoComprimido);
    let dados;
    if (metodo === 0) dados = comprimido;
    else if (metodo === 8) dados = await inflarRaw(comprimido);
    else throw new Error(`Método de compressão ${metodo} não suportado em ${nome}`);
    // download truncado ou byte trocado: melhor falhar aqui do que num createImageBitmap genérico
    if (dados.length !== tamanhoOriginal || crc32(dados) !== crcEsperado) throw new Error(`Arquivo zip corrompido (${nome} não confere com o CRC gravado)`);
    saida.set(nome, dados);
  }
  return saida;
}
