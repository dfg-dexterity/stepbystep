import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gerarTitulo, abreviarUrl, formatarAtalho, truncar } from '../../packages/core/frases.js';
import { FIXTURES, lerFixture } from './util.mjs';

const casos = JSON.parse(readFileSync(join(FIXTURES, 'frases.json'), 'utf8'));

test('fixture de frases cobre a tabela 3.6 (≥ 60 casos)', () => {
  assert.ok(casos.length >= 60, `só ${casos.length} casos`);
  const tipos = new Set(casos.map((c) => c.passo.tipo));
  for (const t of ['navegar', 'clicar', 'digitar', 'selecionar', 'marcar', 'tecla', 'secao', 'manual']) assert.ok(tipos.has(t), `sem caso para ${t}`);
  assert.ok(casos.some((c) => c.opcoes?.plataforma === 'mac'));
  assert.ok(casos.some((c) => c.passo.evento?.botao === 'direito'));
  assert.ok(casos.some((c) => c.passo.evento?.botao === 'meio'));
  assert.ok(casos.some((c) => c.passo.evento?.vezes === 2));
  assert.ok(casos.some((c) => c.passo.alvo?.menu));
  assert.ok(casos.some((c) => c.passo.evento?.app));
});

for (const caso of casos) {
  test(`frase: ${caso.nome}`, () => {
    assert.equal(gerarTitulo(caso.passo, caso.opcoes ?? {}), caso.esperado);
  });
}

test('gerarTitulo nunca ultrapassa o limite do rótulo nem gera «» vazio', () => {
  for (const caso of casos) {
    const t = gerarTitulo(caso.passo, caso.opcoes ?? {});
    assert.ok(!t.includes('«»'), t);
    assert.ok(!t.includes('  '), t);
    for (const m of t.matchAll(/«([^»]*)»/g)) assert.ok(Array.from(m[1]).length <= 60, t);
  }
});

test('gerarTitulo reproduz os títulos dos fixtures', () => {
  const g = lerFixture('guia-exemplo');
  for (const p of g.passos) {
    const plataforma = p.contexto?.bundleId ? 'mac' : 'outro';
    assert.equal(gerarTitulo(p, { plataforma }), p.titulo);
  }
  const m = lerFixture('guia-mac');
  const titulos = m.passos.map((p) => gerarTitulo(p, { plataforma: 'mac' }));
  assert.deepEqual(titulos, [
    'Abra o app «SAP GUI»', 'Escolha o menu «Arquivo › Novo»', 'Clique em «Executar»', 'Digite «4500001234» no campo «Pedido»',
    'Pressione Enter', 'Pressione ⌘S', 'Digite sua senha no campo «Senha»',
  ]);
});

test('abreviarUrl', () => {
  assert.equal(abreviarUrl('https://www.exemplo.com.br/a/b?x=1#frag'), 'exemplo.com.br/a/b');
  assert.equal(abreviarUrl('http://localhost:8080/'), 'localhost:8080');
  assert.equal(abreviarUrl('https://exemplo.com'), 'exemplo.com');
  assert.equal(abreviarUrl('exemplo.com/x/'), 'exemplo.com/x');
  assert.equal(abreviarUrl(''), '');
  assert.equal(abreviarUrl(null), '');
  const longa = 'https://' + 'a'.repeat(70) + '.com/x';
  const r = abreviarUrl(longa);
  assert.equal(Array.from(r).length, 58);
  assert.ok(r.endsWith('…'));
  assert.equal(abreviarUrl('https://x.y/%E2%82'), 'x.y/%E2%82'); // URI inválida fica como está
});

test('formatarAtalho', () => {
  assert.equal(formatarAtalho('Enter', [], 'outro'), 'Enter');
  assert.equal(formatarAtalho('s', ['Meta', 'Shift', 'Alt', 'Ctrl'], 'outro'), 'Ctrl+Alt+Shift+Win+S');
  assert.equal(formatarAtalho('s', ['Meta', 'Shift', 'Alt', 'Ctrl'], 'mac'), '⌃⌥⇧⌘S');
  assert.equal(formatarAtalho('Escape', [], 'mac'), 'Esc');
  assert.equal(formatarAtalho('f12', [], 'outro'), 'F12');
  assert.equal(formatarAtalho('', [], 'outro'), '');
  assert.equal(formatarAtalho('ç', ['Ctrl'], 'outro'), 'Ctrl+Ç');
});

test('truncar normaliza e corta em max-1 + …', () => {
  assert.equal(truncar('  a   b\n c ', 40), 'a b c');
  assert.equal(truncar('abcdefghij', 10), 'abcdefghij');
  assert.equal(truncar('abcdefghijk', 10), 'abcdefghi…');
  assert.equal(truncar('ação bonita demais', 6), 'ação…');   // não deixa espaço antes da reticência
  assert.equal(truncar('😀😀😀😀', 3), '😀😀…');                  // conta pontos de código, não unidades UTF-16
  assert.equal(truncar(null, 5), '');
});
