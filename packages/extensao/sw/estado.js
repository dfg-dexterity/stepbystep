// Estado da gravação em chrome.storage.session (chave 'gravacao'; ausente = não gravando).
// Nenhuma variável de módulo guarda estado: o service worker pode ser descartado a qualquer
// momento. `configurarEstado({ storage })` injeta um storage falso nos testes (node --test).

const CHAVE = 'gravacao';
let storageInjetado = null;

/** @param {{storage?:{get:Function,set:Function,remove:Function}}} [o] storage compatível com chrome.storage.session */
export function configurarEstado({ storage } = {}) {
  storageInjetado = storage ?? null;
}

function storage() {
  const s = storageInjetado ?? globalThis.chrome?.storage?.session;
  if (!s) throw new Error('chrome.storage.session indisponível');
  return s;
}

/** @returns {Promise<object|null>} estado atual ou null quando não há gravação */
export async function lerEstado() {
  const r = await storage().get(CHAVE);
  return r?.[CHAVE] ?? null;
}

/** Mescla `patch` (raso) no estado atual e grava. @returns {Promise<object>} estado gravado */
export async function gravarEstado(patch) {
  const atual = await lerEstado();
  const novo = { ...(atual ?? {}), ...(patch ?? {}) };
  await storage().set({ [CHAVE]: novo });
  return novo;
}

/** Remove a chave: as barras flutuantes se removem ao ver a mudança. */
export async function limparEstado() {
  await storage().remove(CHAVE);
}
