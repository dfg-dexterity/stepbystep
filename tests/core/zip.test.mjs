import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 as crc32Zlib } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarZip, lerZip, crc32 } from '../../packages/core/zip.js';

const texto = (s) => new TextEncoder().encode(s);
const decodificar = (b) => new TextDecoder().decode(b);

test('crc32 bate com o valor de referência e com o zlib', () => {
  assert.equal(crc32(texto('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const aleatorio = new Uint8Array(4096);
  crypto.getRandomValues(aleatorio);
  assert.equal(crc32(aleatorio), crc32Zlib(aleatorio));
  assert.equal(crc32(texto('Olá, ação!')), crc32Zlib(Buffer.from('Olá, ação!')));
});

test('criarZip → lerZip round-trip com nomes UTF-8 e binário', async () => {
  const binario = new Uint8Array(1000);
  for (let i = 0; i < binario.length; i++) binario[i] = (i * 7) & 0xff;
  const zip = await criarZip([
    { nome: 'guide.json', dados: texto('{"a":1}') },
    { nome: 'imagens/ação.png', dados: binario },
    { nome: 'vazio.txt', dados: new Uint8Array(0) },
  ]);
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
  const lido = await lerZip(zip);
  assert.deepEqual([...lido.keys()], ['guide.json', 'imagens/ação.png', 'vazio.txt']);
  assert.equal(decodificar(lido.get('guide.json')), '{"a":1}');
  assert.deepEqual(lido.get('imagens/ação.png'), binario);
  assert.equal(lido.get('vazio.txt').length, 0);
});

test('estrutura do zip: assinaturas, STORE, flag UTF-8, CRC e offsets', async () => {
  const dados = texto('conteúdo');
  const zip = await criarZip([{ nome: 'a.txt', dados, modificadoEm: new Date(2026, 8, 24, 14, 3, 10) }]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint16(6, true), 0x0800);          // UTF-8
  assert.equal(dv.getUint16(8, true), 0);               // STORE
  assert.equal(dv.getUint32(14, true), crc32(dados));
  assert.equal(dv.getUint32(18, true), dados.length);
  assert.equal(dv.getUint16(10, true), (14 << 11) | (3 << 5) | 5);          // hora DOS
  assert.equal(dv.getUint16(12, true), ((2026 - 1980) << 9) | (9 << 5) | 24); // data DOS
  const central = 30 + 5 + dados.length;
  assert.equal(dv.getUint32(central, true), 0x02014b50);
  assert.equal(dv.getUint32(central + 42, true), 0);    // offset do cabeçalho local
  const fim = zip.length - 22;
  assert.equal(dv.getUint32(fim, true), 0x06054b50);
  assert.equal(dv.getUint16(fim + 10, true), 1);
  assert.equal(dv.getUint32(fim + 16, true), central);
});

/** Zip DEFLATE mínimo escrito à mão (o escritor do núcleo só faz STORE). */
function zipDeflatado(entradas) {
  const partes = [];
  const centrais = [];
  let offset = 0;
  for (const { nome, dados } of entradas) {
    const n = texto(nome);
    const comp = new Uint8Array(deflateRawSync(dados));
    const local = new Uint8Array(30 + n.length);
    const dl = new DataView(local.buffer);
    dl.setUint32(0, 0x04034b50, true); dl.setUint16(4, 20, true); dl.setUint16(6, 0x0800, true); dl.setUint16(8, 8, true);
    dl.setUint32(14, crc32(dados), true); dl.setUint32(18, comp.length, true); dl.setUint32(22, dados.length, true); dl.setUint16(26, n.length, true);
    local.set(n, 30);
    const central = new Uint8Array(46 + n.length);
    const dc = new DataView(central.buffer);
    dc.setUint32(0, 0x02014b50, true); dc.setUint16(4, 20, true); dc.setUint16(6, 20, true); dc.setUint16(8, 0x0800, true); dc.setUint16(10, 8, true);
    dc.setUint32(16, crc32(dados), true); dc.setUint32(20, comp.length, true); dc.setUint32(24, dados.length, true); dc.setUint16(28, n.length, true);
    dc.setUint32(42, offset, true);
    central.set(n, 46);
    partes.push(local, comp);
    centrais.push(central);
    offset += local.length + comp.length;
  }
  const tamCentral = centrais.reduce((s, c) => s + c.length, 0);
  const fim = new Uint8Array(22);
  const df = new DataView(fim.buffer);
  df.setUint32(0, 0x06054b50, true); df.setUint16(8, entradas.length, true); df.setUint16(10, entradas.length, true);
  df.setUint32(12, tamCentral, true); df.setUint32(16, offset, true);
  const todas = [...partes, ...centrais, fim];
  const saida = new Uint8Array(todas.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of todas) { saida.set(p, pos); pos += p.length; }
  return saida;
}

test('lerZip lê entradas DEFLATE (deflate-raw), ignora diretórios e __MACOSX/', async () => {
  const grande = texto('linha repetida\n'.repeat(5000));
  const zip = zipDeflatado([
    { nome: 'pasta/', dados: new Uint8Array(0) },
    { nome: 'pasta/guide.json', dados: texto('{"formato":"stepbystep/guia"}') },
    { nome: 'pasta/imagens/x.png', dados: grande },
    { nome: '__MACOSX/pasta/._guide.json', dados: texto('lixo') },
    { nome: 'pasta/__MACOSX/._x', dados: texto('lixo') },
    { nome: 'pasta/.DS_Store', dados: texto('lixo') },
  ]);
  const lido = await lerZip(zip);
  assert.deepEqual([...lido.keys()], ['pasta/guide.json', 'pasta/imagens/x.png']);
  assert.equal(decodificar(lido.get('pasta/guide.json')), '{"formato":"stepbystep/guia"}');
  assert.deepEqual(lido.get('pasta/imagens/x.png'), grande);
});

test('lerZip rejeita bytes que não são zip', async () => {
  await assert.rejects(lerZip(texto('isto não é um zip')), /zip inválido/);
  await assert.rejects(lerZip(new Uint8Array(0)), /zip inválido/);
});

test('criarZip recusa mais de 65 535 entradas com mensagem clara (sem zip64)', async () => {
  const muitas = Array.from({ length: 0x10000 }, (_, i) => ({ nome: `a/${i}`, dados: new Uint8Array(0) }));
  await assert.rejects(criarZip(muitas), /excede o limite do formato zip \(4 GB ou 65 535 arquivos\)\. Exporte o guia em partes/);
  // no limite exato ainda passa
  const lido = await lerZip(await criarZip(muitas.slice(0, 0xffff)));
  assert.equal(lido.size, 0xffff);
});

test('lerZip rejeita campos zip64 (0xFFFFFFFF/0xFFFF) e confere o CRC-32 de cada entrada', async () => {
  const dados = texto('conteúdo que precisa chegar inteiro');
  const zip = await criarZip([{ nome: 'a.txt', dados }]);
  const central = 30 + 5 + dados.length;
  const fim = zip.length - 22;
  const copia = () => new Uint8Array(zip);
  // tamanho comprimido, original e deslocamento local sentinela → zip64
  for (const campo of [20, 24, 42]) {
    const z = copia();
    new DataView(z.buffer).setUint32(central + campo, 0xffffffff, true);
    await assert.rejects(lerZip(z), /zip64 .*não é suportado/);
  }
  // deslocamento do diretório central sentinela
  const semDeslocamento = copia();
  new DataView(semDeslocamento.buffer).setUint32(fim + 16, 0xffffffff, true);
  await assert.rejects(lerZip(semDeslocamento), /zip64 .*não é suportado/);
  // localizador zip64 (0x07064b50) nos 20 bytes antes do fim do diretório central
  const localizador = new Uint8Array(20);
  new DataView(localizador.buffer).setUint32(0, 0x07064b50, true);
  const comLocalizador = new Uint8Array(zip.length + 20);
  comLocalizador.set(zip.subarray(0, fim), 0);
  comLocalizador.set(localizador, fim);
  comLocalizador.set(zip.subarray(fim), fim + 20);
  await assert.rejects(lerZip(comLocalizador), /zip64 .*não é suportado/);
  // um byte trocado no conteúdo (download corrompido) não passa despercebido
  const corrompido = copia();
  corrompido[30 + 5 + 3] ^= 0x01;
  await assert.rejects(lerZip(corrompido), /zip corrompido \(a\.txt não confere com o CRC gravado\)/);
  // DEFLATE também é conferido depois de inflar
  const deflatado = zipDeflatado([{ nome: 'b.txt', dados: texto('x'.repeat(2000)) }]);
  const dvD = new DataView(deflatado.buffer);
  const centralD = deflatado.length - 22 - (46 + 5);
  dvD.setUint32(centralD + 16, dvD.getUint32(centralD + 16, true) ^ 1, true);
  await assert.rejects(lerZip(deflatado), /zip corrompido \(b\.txt/);
  // intacto continua lendo
  assert.equal(decodificar((await lerZip(zip)).get('a.txt')), 'conteúdo que precisa chegar inteiro');
});

test('lerZip normaliza nomes com barra invertida (zips do Windows) e ./ inicial', async () => {
  const zip = await criarZip([
    { nome: 'pasta\\guide.json', dados: texto('{}') },
    { nome: 'pasta\\imagens\\a.png', dados: new Uint8Array([1]) },
    { nome: './raiz.txt', dados: texto('r') },
    { nome: '__MACOSX\\pasta\\._guide.json', dados: texto('lixo') },
  ]);
  const lido = await lerZip(zip);
  assert.deepEqual([...lido.keys()], ['pasta/guide.json', 'pasta/imagens/a.png', 'raiz.txt']);
});

test('zip gerado passa em `unzip -t` quando disponível', async () => {
  let unzip;
  try { unzip = execFileSync('which', ['unzip']).toString().trim(); } catch { unzip = null; }
  if (!unzip) { console.log('  (unzip indisponível: teste pulado)'); return; }
  const zip = await criarZip([{ nome: 'guide.json', dados: texto('{}') }, { nome: 'imagens/a.png', dados: new Uint8Array([1, 2, 3]) }]);
  const pasta = mkdtempSync(join(tmpdir(), 'sbs-zip-'));
  const arquivo = join(pasta, 'teste.zip');
  writeFileSync(arquivo, zip);
  const saida = execFileSync(unzip, ['-t', arquivo]).toString();
  assert.match(saida, /No errors detected/);
});
