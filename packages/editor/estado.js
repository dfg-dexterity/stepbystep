// Estado do editor: um objeto mutável único + emissor de eventos.
// Toda mutação do guia passa por historico.aplicar (que emite 'mudou' com motivo 'guia');
// seleção, ferramenta e zoom mudam por aqui e emitem 'mudou' com o motivo correspondente.

export const FERRAMENTA_PADRAO = 'selecionar';

export const estado = {
  guia: null,
  passoAtualId: null,
  ferramenta: FERRAMENTA_PADRAO,
  selecaoAnotacaoId: null,
  zoom: 1,
};

const ouvintes = new Map(); // evento → Set<fn>

/** @returns {Function} cancela a inscrição */
export function on(evento, fn) {
  if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
  ouvintes.get(evento).add(fn);
  return () => ouvintes.get(evento)?.delete(fn);
}

export function emitir(evento, detalhe = {}) {
  for (const fn of [...(ouvintes.get(evento) ?? [])]) {
    try { fn(detalhe); } catch (e) { console.error(`Ouvinte de "${evento}" falhou`, e); }
  }
}

export function passoAtual() {
  return estado.guia?.passos.find((p) => p.id === estado.passoAtualId) ?? null;
}

export function indiceDoPasso(id) {
  return estado.guia ? estado.guia.passos.findIndex((p) => p.id === id) : -1;
}

export function anotacaoSelecionada() {
  return passoAtual()?.anotacoes.find((a) => a.id === estado.selecaoAnotacaoId) ?? null;
}

/** Abre um guia no editor (substitui o atual). */
export function carregarGuia(guia) {
  estado.guia = guia;
  estado.passoAtualId = guia?.passos[0]?.id ?? null;
  estado.selecaoAnotacaoId = null;
  estado.ferramenta = FERRAMENTA_PADRAO;
  emitir('mudou', { motivo: 'guia', descricao: 'abrir' });
}

export function fecharGuia() {
  estado.guia = null;
  estado.passoAtualId = null;
  estado.selecaoAnotacaoId = null;
  estado.ferramenta = FERRAMENTA_PADRAO;
  emitir('mudou', { motivo: 'fechar' });
}

export function selecionarPasso(id) {
  if (estado.passoAtualId === id) return;
  estado.passoAtualId = id;
  estado.selecaoAnotacaoId = null;
  emitir('mudou', { motivo: 'passo' });
}

export function definirFerramenta(ferramenta) {
  if (estado.ferramenta === ferramenta) return;
  estado.ferramenta = ferramenta;
  emitir('mudou', { motivo: 'ferramenta' });
}

export function selecionarAnotacao(id) {
  if (estado.selecaoAnotacaoId === id) return;
  estado.selecaoAnotacaoId = id;
  emitir('mudou', { motivo: 'selecao' });
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

export function definirZoom(zoom) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || 1));
  if (Math.abs(z - estado.zoom) < 1e-6) return;
  estado.zoom = z;
  emitir('mudou', { motivo: 'zoom' });
}

/** Campo de texto com foco: os atalhos de uma letra não devem agir. */
export function ehEditavel(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

/** Plataforma das frases: origem Mac ou plataforma "macOS" → 'mac'; senão 'outro'. */
export function plataformaDoGuia(guia) {
  const origem = guia?.origem ?? {};
  if (origem.tipo === 'mac' || /mac/i.test(String(origem.plataforma ?? ''))) return 'mac';
  return 'outro';
}

export const temImagem = (passo) => !!(passo?.captura && !passo.captura.faltante && passo.captura.imagemId);
