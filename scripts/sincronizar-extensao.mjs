// Copia packages/core → packages/extensao/core e packages/editor → packages/extensao/editor
// (fs.cp recursivo, apagando as cópias antes). As cópias são gitignored e conferidas byte a byte por
// tests/sincronizacao.test.mjs. Se packages/editor ainda não existir, a extensão recebe um
// editor/index.html mínimo de aviso para o "Abrir editor" não cair numa página inexistente.
// Uso: `npm run sincronizar` ou `import { sincronizar } from './scripts/sincronizar-extensao.mjs'`.
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
export const PARES = [
  { origem: 'packages/core', destino: 'packages/extensao/core' },
  { origem: 'packages/editor', destino: 'packages/extensao/editor' },
];

const AVISO_EDITOR = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>StepByStep — editor ausente</title></head>
<body style="font-family: system-ui, sans-serif; background: #1B1B1B; color: #F7F3E7; padding: 32px">
<h1>Editor ainda não incluído</h1>
<p>A pasta <code>packages/editor</code> não existia quando <code>npm run sincronizar</code> rodou.
Gere-a e rode a sincronização de novo para embutir o editor na extensão.</p>
</body>
</html>
`;

const ehDiretorio = (c) => stat(c).then((s) => s.isDirectory(), () => false);

/**
 * @param {{raiz?:string}} [opcoes]
 * @returns {Promise<{origem:string, destino:string, copiado:boolean}[]>}
 */
export async function sincronizar({ raiz = RAIZ } = {}) {
  const resultado = [];
  for (const { origem, destino } of PARES) {
    const dirOrigem = join(raiz, origem);
    const dirDestino = join(raiz, destino);
    await rm(dirDestino, { recursive: true, force: true });
    if (await ehDiretorio(dirOrigem)) {
      await cp(dirOrigem, dirDestino, { recursive: true });
      resultado.push({ origem, destino, copiado: true });
    } else {
      await mkdir(dirDestino, { recursive: true });
      await writeFile(join(dirDestino, 'index.html'), AVISO_EDITOR);
      resultado.push({ origem, destino, copiado: false });
    }
  }
  return resultado;
}

const ehPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehPrincipal) {
  for (const r of await sincronizar()) {
    console.log(r.copiado ? `${r.origem} → ${r.destino}` : `${r.origem} não existe — ${r.destino}/index.html de aviso criado`);
  }
}
