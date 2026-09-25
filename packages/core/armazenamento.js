// IndexedDB "stepbystep" (versão 1): guias (sem imagens), imagens (Blob) e config.
// Só este módulo abre o banco. Importável em Node; as funções falham ao chamar sem indexedDB.

const NOME_PADRAO = 'stepbystep';
const VERSAO_BANCO = 1;
const bancos = new Map(); // nome → Promise<IDBDatabase>

const pedir = (req) => new Promise((resolver, rejeitar) => {
  req.onsuccess = () => resolver(req.result);
  req.onerror = () => rejeitar(req.error ?? new Error('Falha no IndexedDB'));
});

function criarStores(db) {
  if (!db.objectStoreNames.contains('guias')) {
    const guias = db.createObjectStore('guias', { keyPath: 'id' });
    guias.createIndex('atualizadoEm', 'atualizadoEm');
    guias.createIndex('estado', 'estado');
  }
  if (!db.objectStoreNames.contains('imagens')) {
    const imagens = db.createObjectStore('imagens', { keyPath: 'id' });
    imagens.createIndex('guiaId', 'guiaId');
  }
  if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'chave' });
}

/** @returns {Promise<IDBDatabase>} singleton por nome */
export async function abrirBanco(nome = NOME_PADRAO) {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponível neste ambiente');
  if (!bancos.has(nome)) {
    const promessa = new Promise((resolver, rejeitar) => {
      const req = indexedDB.open(nome, VERSAO_BANCO);
      req.onupgradeneeded = () => criarStores(req.result);
      req.onsuccess = () => {
        const db = req.result;
        // se outra aba pedir upgrade ou o banco for apagado, fecha e deixa reabrir
        db.onversionchange = () => { db.close(); bancos.delete(nome); };
        db.onclose = () => bancos.delete(nome);
        resolver(db);
      };
      req.onerror = () => rejeitar(req.error ?? new Error('Não foi possível abrir o banco'));
      req.onblocked = () => rejeitar(new Error('Abertura do banco bloqueada por outra aba'));
    });
    promessa.catch(() => bancos.delete(nome));
    bancos.set(nome, promessa);
  }
  return bancos.get(nome);
}

async function transacao(stores, modo, fn) {
  const db = await abrirBanco();
  return new Promise((resolver, rejeitar) => {
    const tx = db.transaction(stores, modo);
    let resultado;
    tx.oncomplete = () => resolver(resultado);
    tx.onerror = () => rejeitar(tx.error ?? new Error('Falha na transação'));
    tx.onabort = () => rejeitar(tx.error ?? new Error('Transação abortada'));
    Promise.resolve(fn(tx)).then((r) => { resultado = r; }).catch((e) => { rejeitar(e); try { tx.abort(); } catch { /* já abortada */ } });
  });
}

/** Remove `imagens`, marca atualizadoEm e grava. @returns {Promise<object>} guia gravado */
export async function salvarGuia(guia) {
  const { imagens: _ignorado, ...registro } = guia;
  registro.atualizadoEm = new Date().toISOString();
  await transacao('guias', 'readwrite', (tx) => pedir(tx.objectStore('guias').put(registro)));
  guia.atualizadoEm = registro.atualizadoEm;
  return registro;
}

/** @returns {Promise<object|null>} */
export async function carregarGuia(id) {
  const r = await transacao('guias', 'readonly', (tx) => pedir(tx.objectStore('guias').get(id)));
  return r ?? null;
}

/** @returns {Promise<{id,titulo,estado,origem,qtdPassos,atualizadoEm}[]>} por atualizadoEm desc */
export async function listarGuias({ estado } = {}) {
  const todos = await transacao('guias', 'readonly', (tx) => {
    const store = tx.objectStore('guias');
    return pedir(estado ? store.index('estado').getAll(estado) : store.getAll());
  });
  return todos
    .map((g) => ({ id: g.id, titulo: g.titulo, estado: g.estado, origem: g.origem, qtdPassos: g.passos?.length ?? 0, atualizadoEm: g.atualizadoEm }))
    .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)));
}

/** Apaga o guia e também as imagens dele. */
export async function excluirGuia(id) {
  await transacao(['guias', 'imagens'], 'readwrite', async (tx) => {
    tx.objectStore('guias').delete(id);
    const chaves = await pedir(tx.objectStore('imagens').index('guiaId').getAllKeys(id));
    for (const chave of chaves) tx.objectStore('imagens').delete(chave);
  });
}

export async function salvarImagem({ id, guiaId, blob, largura, altura, mime }) {
  const registro = { id, guiaId, blob, largura, altura, mime: mime ?? blob?.type ?? 'image/png', criadoEm: new Date().toISOString() };
  await transacao('imagens', 'readwrite', (tx) => pedir(tx.objectStore('imagens').put(registro)));
  return registro;
}

/** @returns {Promise<object|null>} registro {id, guiaId, blob, largura, altura, mime, criadoEm} */
export async function carregarImagem(id) {
  const r = await transacao('imagens', 'readonly', (tx) => pedir(tx.objectStore('imagens').get(id)));
  return r ?? null;
}

/** @returns {Promise<string[]>} ids */
export async function listarImagensDoGuia(guiaId) {
  return transacao('imagens', 'readonly', (tx) => pedir(tx.objectStore('imagens').index('guiaId').getAllKeys(guiaId)));
}

/** Apaga imagens do guia não referenciadas por nenhum passo. @returns {Promise<string[]>} ids apagados */
export async function excluirImagensOrfas(guia) {
  const usadas = new Set((guia.passos ?? []).map((p) => p.captura?.imagemId).filter(Boolean));
  const ids = await listarImagensDoGuia(guia.id);
  const orfas = ids.filter((id) => !usadas.has(id));
  if (orfas.length) {
    await transacao('imagens', 'readwrite', (tx) => { for (const id of orfas) tx.objectStore('imagens').delete(id); });
  }
  return orfas;
}

/** @returns {Promise<any>} valor | undefined */
export async function obterConfig(chave) {
  const r = await transacao('config', 'readonly', (tx) => pedir(tx.objectStore('config').get(chave)));
  return r?.valor;
}

export async function salvarConfig(chave, valor) {
  await transacao('config', 'readwrite', (tx) => pedir(tx.objectStore('config').put({ chave, valor })));
}
