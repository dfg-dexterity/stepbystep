import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarId, validarId } from '../../packages/core/ids.js';

const REGEX = /^(g|p|img|a|n)_[0-9a-z]{8,24}$/;

test('gerarId respeita o formato prefixo_tempo36+6 chars', () => {
  for (const prefixo of ['g', 'p', 'img', 'a', 'n']) {
    const id = gerarId(prefixo);
    assert.match(id, REGEX);
    assert.ok(id.startsWith(prefixo + '_'));
    const corpo = id.slice(prefixo.length + 1);
    assert.equal(corpo.length, Date.now().toString(36).length + 6);
    assert.equal(validarId(id), true);
  }
  assert.throws(() => gerarId('x'), /Prefixo de id inválido/);
});

test('validarId aceita o padrão e rejeita o resto', () => {
  assert.equal(validarId('g_m1x4k9zq7a2b'), true);
  assert.equal(validarId('img_m1x4k9zr01aa'), true);
  assert.equal(validarId('p_abcdefgh'), true);
  assert.equal(validarId('n_m1x4k9zr03n1'), true);   // nota do passo
  assert.equal(validarId('p_abcdefg'), false);       // curto demais
  assert.equal(validarId('x_m1x4k9zq7a2b'), false);  // prefixo desconhecido
  assert.equal(validarId('g_M1X4K9ZQ7A2B'), false);  // maiúsculas
  assert.equal(validarId('g_m1x4k9zq7a2b-'), false);
  assert.equal(validarId(''), false);
  assert.equal(validarId(null), false);
  assert.equal(validarId(123), false);
});

test('10 000 ids são únicos', () => {
  const vistos = new Set();
  for (let i = 0; i < 10_000; i++) vistos.add(gerarId('p'));
  assert.equal(vistos.size, 10_000);
});

test('ids ordenam-se no tempo', async () => {
  const a = gerarId('p');
  await new Promise((r) => setTimeout(r, 3));
  const b = gerarId('p');
  assert.ok(a < b, `${a} deveria vir antes de ${b}`);
});
