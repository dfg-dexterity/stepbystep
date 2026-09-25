import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOME_GUIDE, PASTA_IMAGENS, caminhoImagem, guiaParaPacote, lerPacote, imagensDoGuia } from '../../packages/core/pacote.js';
import { criarZip, lerZip } from '../../packages/core/zip.js';
import { validarGuia } from '../../packages/core/modelo.js';
import { lerDimensoesPng } from '../../scripts/png-minimo.mjs';
import { lerFixture, lerArquivoFixture } from './util.mjs';

const texto = (s) => new TextEncoder().encode(s);

function obterImagemDoFixture(nome) {
  const g = lerFixture(nome);
  return async (id) => {
    const info = g.imagens[id];
    if (!info) return null;
    return { bytes: lerArquivoFixture(`${nome}/${info.arquivo}`), largura: info.largura, altura: info.altura, mime: info.mime };
  };
}

test('constantes e caminhoImagem', () => {
  assert.equal(NOME_GUIDE, 'guide.json');
  assert.equal(PASTA_IMAGENS, 'imagens/');
  assert.equal(caminhoImagem('img_m1x4k9zr01aa'), 'imagens/img_m1x4k9zr01aa.png');
  assert.equal(caminhoImagem('img_m1x4k9zr01aa', 'image/webp'), 'imagens/img_m1x4k9zr01aa.webp');
});

test('imagensDoGuia lista ids únicos na ordem, ignorando faltantes', () => {
  const g = lerFixture('guia-exemplo');
  assert.deepEqual(imagensDoGuia(g), ['img_m1x4k9zr01aa', 'img_m1x4k9zr02ab', 'img_m1x4k9zr04ad', 'img_m1x4k9zr05ae', 'img_m1x4k9zr07ag', 'img_m1x4k9zr08ah', 'img_m1x4k9zr10aj']);
});

test('guiaParaPacote → lerPacote round-trip com os PNGs do fixture', async () => {
  const original = lerFixture('guia-exemplo');
  const { imagens: _i, ...semImagens } = original;
  const zip = await guiaParaPacote(semImagens, obterImagemDoFixture('guia-exemplo'));
  const arquivos = await lerZip(zip);
  assert.equal([...arquivos.keys()][0], 'guide.json');
  assert.equal(arquivos.size, 8);
  const guide = JSON.parse(new TextDecoder().decode(arquivos.get('guide.json')));
  assert.deepEqual(guide.imagens, original.imagens);
  assert.deepEqual(Object.keys(guide).at(-1), 'imagens');
  const { guia, imagens, avisos } = lerPacote(arquivos);
  assert.deepEqual(avisos, []);
  assert.equal('imagens' in guia, false);
  assert.deepEqual(guia, semImagens);
  assert.equal(imagens.size, 7);
  assert.deepEqual(lerDimensoesPng(imagens.get('img_m1x4k9zr10aj')), { largura: 3456, altura: 2234 });
  assert.deepEqual(imagens.get('img_m1x4k9zr01aa'), lerArquivoFixture('guia-exemplo/imagens/img_m1x4k9zr01aa.png'));
});

test('lerPacote aceita a pasta do Mac dentro de um diretório de primeiro nível (ditto --keepParent) e ignora __MACOSX', async () => {
  const g = lerFixture('guia-mac');
  const obter = obterImagemDoFixture('guia-mac');
  const entradas = [{ nome: '2026-09-24_1712_sap-gui/guide.json', dados: lerArquivoFixture('guia-mac/guide.json') }];
  for (const id of Object.keys(g.imagens)) entradas.push({ nome: '2026-09-24_1712_sap-gui/' + g.imagens[id].arquivo, dados: (await obter(id)).bytes });
  entradas.push({ nome: '2026-09-24_1712_sap-gui/eventos.ndjson', dados: lerArquivoFixture('guia-mac/eventos.ndjson') });
  entradas.push({ nome: '__MACOSX/2026-09-24_1712_sap-gui/._guide.json', dados: texto('lixo') });
  entradas.push({ nome: '__MACOSX/2026-09-24_1712_sap-gui/imagens/._img.png', dados: texto('lixo') });
  const arquivos = await lerZip(await criarZip(entradas));
  const { guia, imagens, avisos } = lerPacote(arquivos);
  assert.deepEqual(avisos, []);
  assert.equal(guia.origem.tipo, 'mac');
  assert.equal(guia.passos.length, 7);
  assert.ok(guia.passos.every((p) => p.titulo === '' && p.tituloAuto === true));
  assert.equal(imagens.size, 6);
  assert.equal('imagens' in guia, false);
  assert.deepEqual(validarGuia(guia), { ok: true, erros: [] });
});

test('lerPacote aceita zip recompactado no Windows (nomes com barra invertida)', async () => {
  const g = lerFixture('guia-exemplo');
  const entradas = [{ nome: '2026-09-24_1412_sap-gui\\guide.json', dados: texto(JSON.stringify(g)) }];
  for (const info of Object.values(g.imagens)) entradas.push({ nome: '2026-09-24_1412_sap-gui\\' + info.arquivo.replace(/\//g, '\\'), dados: new Uint8Array([1]) });
  const { guia, imagens, avisos } = lerPacote(await lerZip(await criarZip(entradas)));
  assert.deepEqual(avisos, []);
  assert.equal(imagens.size, 7);
  assert.equal(guia.passos.length, 10);
  assert.deepEqual(validarGuia(guia), { ok: true, erros: [] });
});

test('lerPacote: imagem ausente vira captura faltante com aviso; imagem sobrando gera aviso', () => {
  const g = lerFixture('guia-exemplo');
  const arquivos = new Map([[NOME_GUIDE, texto(JSON.stringify(g))]]);
  for (const [id, info] of Object.entries(g.imagens)) if (id !== 'img_m1x4k9zr05ae') arquivos.set(info.arquivo, new Uint8Array([1]));
  arquivos.set('imagens/img_m1x4k9zr99zz.png', new Uint8Array([2]));
  const { guia, imagens, avisos } = lerPacote(arquivos);
  assert.equal(imagens.size, 6);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /img_m1x4k9zr05ae/);
  const afetados = guia.passos.filter((p) => ['p_m1x4k9zr05ae', 'p_m1x4k9zr06af'].includes(p.id));
  assert.equal(afetados.length, 2);
  for (const p of afetados) { assert.equal(p.captura.faltante, true); assert.equal(p.captura.imagemId, null); }
  assert.deepEqual(validarGuia(guia), { ok: true, erros: [] });
});

test('lerPacote sem `imagens` no guide.json procura imagens/<id>.png', () => {
  const g = lerFixture('guia-exemplo');
  delete g.imagens;
  const arquivos = new Map([[NOME_GUIDE, texto(JSON.stringify(g))]]);
  arquivos.set('imagens/img_m1x4k9zr01aa.png', new Uint8Array([9]));
  const { imagens, avisos } = lerPacote(arquivos);
  assert.deepEqual([...imagens.keys()], ['img_m1x4k9zr01aa']);
  assert.equal(avisos.length, 6);
});

test('lerPacote rejeita pacote sem guide.json, JSON inválido, guia inválido e dois guias', () => {
  assert.throws(() => lerPacote(new Map([['x.txt', texto('a')]])), /guide\.json não encontrado/);
  assert.throws(() => lerPacote(new Map([[NOME_GUIDE, texto('{')]])), /JSON válido/);
  assert.throws(() => lerPacote(new Map([[NOME_GUIDE, texto('{"formato":"outro"}')]])), /Formato desconhecido/);
  const g = lerFixture('guia-exemplo');
  g.passos[0].tipo = 'x';
  assert.throws(() => lerPacote(new Map([[NOME_GUIDE, texto(JSON.stringify(g))]])), /Guia inválido: passos\[0\]\.tipo/);
  assert.throws(() => lerPacote(new Map([['a/guide.json', texto('{}')], ['b/guide.json', texto('{}')]])), /mais de um guide\.json/);
  // guide.json em profundidade 2 não conta
  assert.throws(() => lerPacote(new Map([['a/b/guide.json', texto('{}')]])), /não encontrado/);
});

test('notas e zoom fazem round-trip no pacote; notas vazias (em edição) ficam de fora e o guide.json continua válido', async () => {
  const original = lerFixture('guia-exemplo');
  const { imagens: _i, ...semImagens } = structuredClone(original);
  semImagens.estilo = { ...semImagens.estilo, zoom: 'tela' };
  semImagens.passos[1] = { ...semImagens.passos[1], zoom: 'alvo', notas: [...semImagens.passos[1].notas, { id: 'n_m1x4k9zr02n2', tipo: 'nota', texto: '   ' }] };
  const zip = await guiaParaPacote(semImagens, obterImagemDoFixture('guia-exemplo'));
  const { guia } = lerPacote(await lerZip(zip));
  assert.equal(guia.estilo.zoom, 'tela');
  assert.equal(guia.passos[1].zoom, 'alvo');
  assert.deepEqual(guia.passos[1].notas, original.passos[1].notas);
  assert.deepEqual(guia.passos[3].notas, original.passos[3].notas);
  assert.equal(validarGuia(guia).ok, true);
  assert.equal(semImagens.passos[1].notas.length, 2, 'o guia de origem não é alterado');
});
