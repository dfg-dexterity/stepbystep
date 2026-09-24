// Zip (STORE, via packages/core/zip.js) da pasta packages/extensao — já sincronizada — em
// dist/stepbystep-extensao-<versao>.zip, com manifest.json na raiz do zip ("carregar sem compactação"
// depois de descompactar). Uso: `npm run empacotar` (roda a sincronização antes).
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarZip } from '../packages/core/zip.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const EXTENSAO = join(RAIZ, 'packages', 'extensao');
const DIST = join(RAIZ, 'dist');
const IGNORAR = new Set(['.DS_Store', 'Thumbs.db']);

const ehDiretorio = (c) => stat(c).then((s) => s.isDirectory(), () => false);

/** Lista relativa (ordenada, separador '/') de todos os arquivos sob `dir`. */
async function listarArquivos(dir, base = dir) {
  const saida = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const caminho = join(dir, e.name);
    if (e.isDirectory()) saida.push(...await listarArquivos(caminho, base));
    else saida.push(relative(base, caminho).split('\\').join('/'));
  }
  return saida.sort();
}

/** @returns {Promise<{saida:string, arquivos:number, bytes:number}>} */
export async function empacotar() {
  for (const copia of ['core', 'editor']) {
    if (!(await ehDiretorio(join(EXTENSAO, copia)))) throw new Error(`packages/extensao/${copia} não existe — rode \`npm run sincronizar\``);
  }
  const manifest = JSON.parse(await readFile(join(EXTENSAO, 'manifest.json'), 'utf8'));
  const arquivos = await listarArquivos(EXTENSAO);
  const entradas = [];
  for (const nome of arquivos) entradas.push({ nome, dados: new Uint8Array(await readFile(join(EXTENSAO, nome))) });
  const zip = await criarZip(entradas);
  await mkdir(DIST, { recursive: true });
  const saida = join(DIST, `stepbystep-extensao-${manifest.version}.zip`);
  await writeFile(saida, zip);
  return { saida, arquivos: arquivos.length, bytes: zip.length };
}

const ehPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehPrincipal) {
  const r = await empacotar();
  console.log(`${relative(RAIZ, r.saida)} — ${r.arquivos} arquivos, ${(r.bytes / 1024).toFixed(0)} KB`);
}
