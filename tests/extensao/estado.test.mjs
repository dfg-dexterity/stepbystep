// sw/estado.js com chrome.storage.session falso: get/set/remove, patch raso e "reinício" do módulo
// (o estado tem de sobreviver porque só existe no storage, nunca em variável de módulo).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MODULO = '../../packages/extensao/sw/estado.js';

/** Storage falso compatível com chrome.storage.session (valores clonados como o Chrome faz). */
function criarStorageFalso() {
  const dados = new Map();
  const chaves = (c) => (Array.isArray(c) ? c : typeof c === 'string' ? [c] : [...dados.keys()]);
  return {
    dados,
    chamadas: { get: 0, set: 0, remove: 0 },
    async get(c) {
      this.chamadas.get++;
      const r = {};
      for (const k of chaves(c)) if (dados.has(k)) r[k] = structuredClone(dados.get(k));
      return r;
    },
    async set(obj) {
      this.chamadas.set++;
      for (const [k, v] of Object.entries(obj)) dados.set(k, structuredClone(v));
    },
    async remove(c) {
      this.chamadas.remove++;
      for (const k of chaves(c)) dados.delete(k);
    },
  };
}

/** Importa uma cópia nova do módulo (simula o SW ser descartado e recriado). */
let contador = 0;
const importarNovo = () => import(`${MODULO}?reinicio=${++contador}`);

test('lerEstado devolve null sem gravação e gravarEstado cria o estado', async () => {
  const { configurarEstado, lerEstado, gravarEstado } = await importarNovo();
  const storage = criarStorageFalso();
  configurarEstado({ storage });
  assert.equal(await lerEstado(), null);
  const gravado = await gravarEstado({ guiaId: 'g_abc12345', status: 'gravando', abas: [7], contador: 0 });
  assert.deepEqual(gravado, { guiaId: 'g_abc12345', status: 'gravando', abas: [7], contador: 0 });
  assert.deepEqual(await lerEstado(), gravado);
  assert.deepEqual(storage.dados.get('gravacao'), gravado, 'grava na chave "gravacao"');
});

test('gravarEstado mescla o patch (raso) preservando os demais campos', async () => {
  const { configurarEstado, lerEstado, gravarEstado } = await importarNovo();
  const storage = criarStorageFalso();
  configurarEstado({ storage });
  await gravarEstado({ guiaId: 'g_abc12345', status: 'gravando', abas: [7], contador: 0, redutor: { contador: 0, urlAtual: 'a' }, ultimaCaptura: null });
  await gravarEstado({ status: 'pausado', contador: 3 });
  const s = await lerEstado();
  assert.equal(s.status, 'pausado');
  assert.equal(s.contador, 3);
  assert.equal(s.guiaId, 'g_abc12345');
  assert.deepEqual(s.abas, [7]);
  // objetos aninhados são substituídos inteiros (o redutor sempre devolve um estado novo)
  await gravarEstado({ redutor: { contador: 4 } });
  assert.deepEqual((await lerEstado()).redutor, { contador: 4 });
  // null é valor válido num patch
  await gravarEstado({ ultimaCaptura: { imagemId: 'img_x', em: 1 } });
  await gravarEstado({ ultimaCaptura: null });
  assert.equal((await lerEstado()).ultimaCaptura, null);
});

test('limparEstado remove a chave e lerEstado volta a null', async () => {
  const { configurarEstado, lerEstado, gravarEstado, limparEstado } = await importarNovo();
  const storage = criarStorageFalso();
  configurarEstado({ storage });
  await gravarEstado({ guiaId: 'g_abc12345', status: 'gravando' });
  await limparEstado();
  assert.equal(await lerEstado(), null);
  assert.equal(storage.dados.has('gravacao'), false);
  assert.equal(storage.chamadas.remove, 1);
  // gravar depois de limpar começa do zero
  await gravarEstado({ guiaId: 'g_novo12345' });
  assert.deepEqual(await lerEstado(), { guiaId: 'g_novo12345' });
});

test('o estado sobrevive a um "reinício" do módulo (nada fica em variável de módulo)', async () => {
  const storage = criarStorageFalso();
  const primeiro = await importarNovo();
  primeiro.configurarEstado({ storage });
  await primeiro.gravarEstado({ guiaId: 'g_abc12345', status: 'gravando', abas: [7, 9], contador: 5, redutor: { contador: 5, urlAtual: 'https://x' } });

  const segundo = await importarNovo();
  assert.notEqual(segundo, primeiro, 'é outra instância do módulo');
  segundo.configurarEstado({ storage });
  const s = await segundo.lerEstado();
  assert.deepEqual(s, { guiaId: 'g_abc12345', status: 'gravando', abas: [7, 9], contador: 5, redutor: { contador: 5, urlAtual: 'https://x' } });
  await segundo.gravarEstado({ contador: 6 });
  assert.equal((await primeiro.lerEstado()).contador, 6, 'as duas instâncias veem o mesmo storage');
});

test('sem configurarEstado usa globalThis.chrome.storage.session; sem nada, lança erro claro', async () => {
  const modulo = await importarNovo();
  const anterior = globalThis.chrome;
  try {
    globalThis.chrome = undefined;
    await assert.rejects(() => modulo.lerEstado(), /chrome\.storage\.session indisponível/);
    const storage = criarStorageFalso();
    globalThis.chrome = { storage: { session: storage } };
    await modulo.gravarEstado({ guiaId: 'g_abc12345' });
    assert.deepEqual(await modulo.lerEstado(), { guiaId: 'g_abc12345' });
    assert.equal(storage.chamadas.set, 1);
  } finally {
    globalThis.chrome = anterior;
  }
});

test('lerEstado nunca devolve o mesmo objeto do storage (mutação local não vaza)', async () => {
  const { configurarEstado, lerEstado, gravarEstado } = await importarNovo();
  configurarEstado({ storage: criarStorageFalso() });
  await gravarEstado({ abas: [1] });
  const a = await lerEstado();
  a.abas.push(2);
  assert.deepEqual((await lerEstado()).abas, [1]);
});
