// packages/extensao/{core,editor} são cópias geradas por `npm run sincronizar` (gitignored) e
// precisam ser idênticas byte a byte aos originais em packages/core e packages/editor.
// Enquanto as cópias não existirem o teste é pulado (rode `npm run sincronizar`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PARES = [
  { origem: 'packages/core', copia: 'packages/extensao/core' },
  { origem: 'packages/editor', copia: 'packages/extensao/editor' },
];
const MENSAGEM_SKIP = 'rode `npm run sincronizar`';

const ehDiretorio = (c) => stat(c).then((s) => s.isDirectory(), () => false);

/** Lista relativa (ordenada) de todos os arquivos sob `dir`. */
async function listarArquivos(dir, base = dir) {
  const entradas = await readdir(dir, { withFileTypes: true });
  const arquivos = [];
  for (const e of entradas) {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) arquivos.push(...await listarArquivos(caminho, base));
    else arquivos.push(relative(base, caminho).split('\\').join('/'));
  }
  return arquivos.sort();
}

for (const { origem, copia } of PARES) {
  test(`${copia} é cópia idêntica de ${origem}`, async (t) => {
    const dirOrigem = join(RAIZ, origem);
    const dirCopia = join(RAIZ, copia);
    if (!(await ehDiretorio(dirCopia))) return t.skip(MENSAGEM_SKIP);
    assert.ok(await ehDiretorio(dirOrigem), `${origem} não existe`);

    const arquivosOrigem = await listarArquivos(dirOrigem);
    const arquivosCopia = await listarArquivos(dirCopia);
    const faltando = arquivosOrigem.filter((a) => !arquivosCopia.includes(a));
    const sobrando = arquivosCopia.filter((a) => !arquivosOrigem.includes(a));
    assert.deepEqual({ faltando, sobrando }, { faltando: [], sobrando: [] }, `lista de arquivos diverge em ${copia} — ${MENSAGEM_SKIP}`);
    assert.ok(arquivosOrigem.length > 0, `${origem} está vazio`);

    const diferentes = [];
    for (const arquivo of arquivosOrigem) {
      const [a, b] = await Promise.all([readFile(join(dirOrigem, arquivo)), readFile(join(dirCopia, arquivo))]);
      if (!a.equals(b)) diferentes.push(arquivo);
    }
    assert.deepEqual(diferentes, [], `arquivos diferentes em ${copia} — ${MENSAGEM_SKIP}`);
  });
}
