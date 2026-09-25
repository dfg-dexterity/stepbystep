// Dublês para testar o service worker em Node (sem navegador): chrome.storage.session, um indexedDB
// mínimo (só o que core/armazenamento.js usa) e um `chrome` com tabs/scripting/webNavigation falsos
// que registra as chamadas de captureVisibleTab — o que os testes de visibilidade da aba conferem.

/** Storage falso compatível com chrome.storage.session (valores clonados como o Chrome faz). */
export function criarStorageFalso() {
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

// ---------------------------------------------------------------------------
// IndexedDB mínimo: requisições resolvem em microtask, a transação conclui num macrotask
// (como no navegador, o `then` de quem aguardou a requisição corre antes do oncomplete).
// ---------------------------------------------------------------------------
function requisicao(valor) {
  const req = { onsuccess: null, onerror: null, result: undefined, error: null };
  queueMicrotask(() => { req.result = valor; req.onsuccess?.({ target: req }); });
  return req;
}

class StoreFalsa {
  constructor(nome, keyPath) { this.nome = nome; this.keyPath = keyPath; this.dados = new Map(); this.indices = new Map(); }
  createIndex(nome, keyPath) { this.indices.set(nome, keyPath); }
  put(obj) { const chave = obj[this.keyPath]; this.dados.set(chave, structuredClone(obj)); return requisicao(chave); }
  get(chave) { return requisicao(this.dados.has(chave) ? structuredClone(this.dados.get(chave)) : undefined); }
  getAll() { return requisicao([...this.dados.values()].map((v) => structuredClone(v))); }
  delete(chave) { this.dados.delete(chave); return requisicao(undefined); }
  index(nome) {
    const keyPath = this.indices.get(nome);
    const filtrar = (valor) => [...this.dados.values()].filter((v) => valor === undefined || v[keyPath] === valor);
    return {
      getAll: (valor) => requisicao(filtrar(valor).map((v) => structuredClone(v))),
      getAllKeys: (valor) => requisicao(filtrar(valor).map((v) => v[this.keyPath])),
    };
  }
}

class TransacaoFalsa {
  constructor(stores) {
    this.stores = stores;
    this.oncomplete = null; this.onerror = null; this.onabort = null; this.error = null;
    this.abortada = false;
    setTimeout(() => { if (!this.abortada) this.oncomplete?.(); }, 0);
  }
  objectStore(nome) {
    const s = this.stores.get(nome);
    if (!s) throw new Error(`store inexistente: ${nome}`);
    return s;
  }
  abort() { this.abortada = true; queueMicrotask(() => this.onabort?.()); }
}

class BancoFalso {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains: (n) => this.stores.has(n) };
    this.onversionchange = null; this.onclose = null;
  }
  createObjectStore(nome, { keyPath }) { const s = new StoreFalsa(nome, keyPath); this.stores.set(nome, s); return s; }
  transaction() { return new TransacaoFalsa(this.stores); }
  close() {}
}

/** `globalThis.indexedDB` falso: `open` cria o banco na primeira vez (onupgradeneeded) e devolve o mesmo depois. */
export function criarIndexedDBFalso() {
  const bancos = new Map();
  return {
    bancos,
    open(nome) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined, error: null };
      queueMicrotask(() => {
        const novo = !bancos.has(nome);
        if (novo) bancos.set(nome, new BancoFalso());
        req.result = bancos.get(nome);
        if (novo) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

// ---------------------------------------------------------------------------
// chrome falso
// ---------------------------------------------------------------------------
const PNG_FALSO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const VIEWPORT_FALSO = { largura: 1280, altura: 800 };

/**
 * @param {{abas?:object[], storage?:object}} [o] abas: `{ id, windowId, active, url, status, title, documentId }`
 * @returns {object} chrome falso; `abas` (Map por id) pode ser alterado pelo teste; `chamadas.captureVisibleTab`
 *          guarda o windowId de cada foto pedida
 */
export function criarChromeFalso({ abas = [], storage = criarStorageFalso() } = {}) {
  const porId = new Map(abas.map((a) => [a.id, { status: 'complete', active: true, title: '', documentId: null, ...a }]));
  const chamadas = { captureVisibleTab: [], executeScript: [] };
  return {
    abas: porId,
    chamadas,
    storage: { session: storage },
    runtime: { getManifest: () => ({ version: '0.1.0' }), getURL: (p) => `chrome-extension://abcdefghijklmnop/${p}` },
    alarms: { create() {}, async clear() { return true; } },
    windows: { WINDOW_ID_NONE: -1 },
    tabs: {
      async get(id) {
        const a = porId.get(id);
        if (!a) throw new Error(`No tab with id: ${id}.`);
        return structuredClone(a);
      },
      async query({ active, windowId } = {}) {
        return [...porId.values()]
          .filter((a) => (active == null || a.active === active) && (windowId == null || a.windowId === windowId))
          .map((a) => structuredClone(a));
      },
      async captureVisibleTab(janelaId) { chamadas.captureVisibleTab.push(janelaId); return PNG_FALSO; },
      async create({ url, windowId = 1 }) {
        const id = Math.max(0, ...porId.keys()) + 1;
        porId.set(id, { id, windowId, active: true, url, status: 'complete', title: '', documentId: null });
        return structuredClone(porId.get(id));
      },
      async remove(id) { porId.delete(id); },
    },
    scripting: {
      async getRegisteredContentScripts() { return []; },
      async registerContentScripts() {},
      async unregisterContentScripts() {},
      async executeScript({ target, func, files }) {
        chamadas.executeScript.push({ tabId: target.tabId, files: files ?? null, func: func ? String(func).slice(0, 40) : null });
        const a = porId.get(target.tabId);
        if (!a) throw new Error(`No tab with id: ${target.tabId}.`);
        return [{ result: { viewport: { ...VIEWPORT_FALSO }, dpr: 1, tituloPagina: a.title ?? '', url: a.url } }];
      },
    },
    webNavigation: {
      async getFrame({ tabId }) {
        const a = porId.get(tabId);
        return a ? { url: a.url, documentId: a.documentId ?? null, frameId: 0, parentFrameId: -1, errorOccurred: false } : null;
      },
    },
  };
}

/** `createImageBitmap` falso: mede o "PNG" como viewport × 1 (a escala é medida no bitmap, nunca no dpr). */
export async function createImageBitmapFalso() {
  return { width: VIEWPORT_FALSO.largura, height: VIEWPORT_FALSO.altura, close() {} };
}
