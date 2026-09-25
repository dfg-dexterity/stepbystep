// O núcleo roda igual em Node, no service worker e na página: nenhum módulo pode referenciar
// document/window/chrome, e todos precisam ser importáveis em Node (só falham ao chamar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from './util.mjs';

const PASTA = join(RAIZ, 'packages', 'core');
const ESPERADOS = [
  'modelo.js', 'ids.js', 'frases.js', 'mascara.js', 'coordenadas.js', 'redutor-eventos.js', 'anotacoes.js', 'render-canvas.js',
  'exportar-markdown.js', 'exportar-html.js', 'zip.js', 'pacote.js', 'notion-blocos.js', 'notion-cliente.js', 'armazenamento.js', 'redimensionar.js',
];

/** Remove comentários e o conteúdo de strings/template literals para inspecionar só o código. */
function soCodigo(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

test('todos os módulos da seção 4 existem', () => {
  const presentes = readdirSync(PASTA).filter((f) => f.endsWith('.js'));
  for (const nome of ESPERADOS) assert.ok(presentes.includes(nome), `falta packages/core/${nome}`);
});

for (const nome of ESPERADOS) {
  test(`${nome} é importável em Node e não referencia document/window/chrome`, async () => {
    const modulo = await import(`../../packages/core/${nome}`);
    assert.ok(Object.keys(modulo).length > 0, 'módulo sem exports');
    const codigo = soCodigo(readFileSync(join(PASTA, nome), 'utf8'));
    const proibidos = codigo.match(/\b(document|window|chrome)\b/g) ?? [];
    assert.deepEqual(proibidos, [], `${nome} referencia ${proibidos.join(', ')}`);
    assert.doesNotMatch(codigo, /\bimport\s*\(/, 'import() dinâmico não é permitido no núcleo (SW)');
  });
}

test('armazenamento e redimensionar só falham ao chamar', async () => {
  const arm = await import('../../packages/core/armazenamento.js');
  await assert.rejects(arm.abrirBanco(), /IndexedDB indisponível/);
  await assert.rejects(arm.obterConfig('notion.token'), /IndexedDB indisponível/);
  const red = await import('../../packages/core/redimensionar.js');
  await assert.rejects(red.reduzirImagem(new Blob([new Uint8Array(4)]), { larguraMax: 10 }), /só navegador/);
  const render = await import('../../packages/core/render-canvas.js');
  await assert.rejects(render.assarPasso({ width: 1, height: 1 }, { anotacoes: [] }), /só navegador/);
});
