// Utilidades compartilhadas pelos testes do núcleo.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = join(RAIZ, 'tests', 'fixtures');

export function lerFixture(nome) {
  return JSON.parse(readFileSync(join(FIXTURES, nome, 'guide.json'), 'utf8'));
}

export function lerArquivoFixture(caminho) {
  return new Uint8Array(readFileSync(join(FIXTURES, caminho)));
}

/**
 * Contexto 2D falso: registra toda chamada de método e toda atribuição de propriedade em `chamadas`.
 * measureText devolve largura = 10 px por caractere.
 */
export function criarCtxFalso(nome = 'ctx') {
  const chamadas = [];
  const props = { nome };
  const ctx = new Proxy({}, {
    get(_, prop) {
      if (prop === 'chamadas') return chamadas;
      if (prop === 'then') return undefined;
      if (prop === 'measureText') return (t) => { chamadas.push(['measureText', t]); return { width: String(t).length * 10 }; };
      if (prop in props) return props[prop];
      return (...args) => { chamadas.push([prop, ...args]); };
    },
    set(_, prop, valor) { props[prop] = valor; chamadas.push(['set', prop, valor]); return true; },
    has(_, prop) { return prop in props; },
  });
  return ctx;
}

/** Sequência só dos nomes dos métodos chamados (sem atribuições). */
export const metodos = (ctx) => ctx.chamadas.filter((c) => c[0] !== 'set').map((c) => c[0]);

/** Mensagem "Comum" do content script. */
export function comum(extra = {}) {
  return {
    viewport: { largura: 1440, altura: 810 }, dpr: 2, url: 'https://app.exemplo.com/form', tituloPagina: 'Formulário',
    scroll: { x: 0, y: 0 }, em: 1000, ...extra,
  };
}

export function capturaOk(imagemId = 'img_m1x4k9zr0test', fonte = 'pointerdown') {
  return { imagemId, largura: 2880, altura: 1620, fonte, faltante: false };
}
