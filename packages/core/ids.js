// Ids do guia: `${prefixo}_${Date.now().toString(36)}${6 chars base36 aleatórios}`.
// O prefixo temporal mantém a ordenação cronológica; o sufixo evita colisão no mesmo milissegundo.

const REGEX_ID = /^(g|p|img|a)_[0-9a-z]{8,24}$/;
const ALFABETO = '0123456789abcdefghijklmnopqrstuvwxyz';

// Ids emitidos no milissegundo corrente: garante unicidade dentro do processo mesmo em rajadas.
let ultimoMs = 0;
const emitidosNoMs = new Set();

function sufixoAleatorio() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALFABETO[b % 36];
  return s;
}

/** @param {'g'|'p'|'img'|'a'} prefixo @returns {string} */
export function gerarId(prefixo) {
  if (!['g', 'p', 'img', 'a'].includes(prefixo)) throw new Error(`Prefixo de id inválido: ${prefixo}`);
  const agora = Date.now();
  if (agora !== ultimoMs) { ultimoMs = agora; emitidosNoMs.clear(); }
  const tempo = agora.toString(36);
  let sufixo = sufixoAleatorio();
  while (emitidosNoMs.has(sufixo)) sufixo = sufixoAleatorio();
  emitidosNoMs.add(sufixo);
  return `${prefixo}_${tempo}${sufixo}`;
}

/** @returns {boolean} casa /^(g|p|img|a)_[0-9a-z]{8,24}$/ */
export function validarId(id) {
  return typeof id === 'string' && REGEX_ID.test(id);
}
