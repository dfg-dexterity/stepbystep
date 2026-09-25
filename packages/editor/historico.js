// Undo/redo por snapshots (clonarGuia, sem imagens), limite 200, coalescência de edições de texto
// e gravação no IndexedDB com debounce de 300 ms (forçada ao sair da página). Antes de gravar, confere
// que o banco ainda tem a versão que este editor leu: outra aba (ou o gravador da extensão) pode ter
// gravado por cima, e a cópia em memória não pode apagar esse trabalho.
import { clonarGuia } from '../core/modelo.js';
import { salvarGuia, carregarGuia as lerGuiaDoBanco } from '../core/armazenamento.js';
import { estado, emitir, ehEditavel, indiceDoPasso } from './estado.js';

const LIMITE = 200;
const JANELA_COALESCER = 1000;
const ATRASO_SALVAR = 300;

let pilhaDesfazer = [];
let pilhaRefazer = [];
let ultimaChave = null;
let ultimaEm = 0;
let timerSalvar = null;
let sujo = false;
let salvando = null;
let versaoGravada = null; // atualizadoEm do guia como este editor o leu do banco (ou gravou por último)
let conflito = false;     // o banco tem uma versão mais nova: nunca sobrescrever

/**
 * Executa `fn(guia)` como uma entrada do histórico.
 * @param {string} descricao para a interface ("Desfazer: mover anotação")
 * @param {(guia:object)=>void} fn
 * @param {{coalescer?:string}} [opcoes] edições com a mesma chave em < 1 s reaproveitam o snapshot anterior
 */
export function aplicar(descricao, fn, opcoes = {}) {
  const guia = estado.guia;
  if (!guia) return;
  const agora = Date.now();
  const chave = opcoes.coalescer ?? null;
  const coalesce = chave !== null && chave === ultimaChave && agora - ultimaEm < JANELA_COALESCER;
  if (!coalesce) {
    pilhaDesfazer.push({ descricao, guia: clonarGuia(guia) });
    if (pilhaDesfazer.length > LIMITE) pilhaDesfazer.shift();
    pilhaRefazer = [];
  }
  ultimaChave = chave;
  ultimaEm = agora;
  fn(guia);
  guia.atualizadoEm = new Date().toISOString();
  agendarSalvar();
  emitir('mudou', { motivo: 'guia', descricao });
}

function corrigirSelecao(anterior) {
  const guia = estado.guia;
  if (!guia.passos.some((p) => p.id === estado.passoAtualId)) {
    const i = anterior ? anterior.passos.findIndex((p) => p.id === estado.passoAtualId) : -1;
    estado.passoAtualId = guia.passos[Math.min(Math.max(i, 0), guia.passos.length - 1)]?.id ?? null;
  }
  const passo = guia.passos.find((p) => p.id === estado.passoAtualId);
  if (!passo?.anotacoes.some((a) => a.id === estado.selecaoAnotacaoId)) estado.selecaoAnotacaoId = null;
}

function restaurar(snapshot, descricao) {
  const anterior = estado.guia;
  estado.guia = snapshot;
  corrigirSelecao(anterior);
  ultimaChave = null;
  agendarSalvar();
  emitir('mudou', { motivo: 'guia', descricao });
}

export function desfazer() {
  if (!pilhaDesfazer.length || !estado.guia) return false;
  const entrada = pilhaDesfazer.pop();
  pilhaRefazer.push({ descricao: entrada.descricao, guia: clonarGuia(estado.guia) });
  restaurar(entrada.guia, `desfazer: ${entrada.descricao}`);
  return true;
}

export function refazer() {
  if (!pilhaRefazer.length || !estado.guia) return false;
  const entrada = pilhaRefazer.pop();
  pilhaDesfazer.push({ descricao: entrada.descricao, guia: clonarGuia(estado.guia) });
  restaurar(entrada.guia, `refazer: ${entrada.descricao}`);
  return true;
}

export const podeDesfazer = () => pilhaDesfazer.length > 0;
export const podeRefazer = () => pilhaRefazer.length > 0;
export const descricaoDesfazer = () => pilhaDesfazer.at(-1)?.descricao ?? '';
export const descricaoRefazer = () => pilhaRefazer.at(-1)?.descricao ?? '';

/** Esvazia as pilhas (ao abrir outro guia). */
export function limpar() {
  pilhaDesfazer = [];
  pilhaRefazer = [];
  ultimaChave = null;
  ultimaEm = 0;
  clearTimeout(timerSalvar);
  sujo = false;
  versaoGravada = null;
  conflito = false;
}

/** Registra a versão (`atualizadoEm`) lida do banco ao abrir o guia: a gravação recusa sobrescrever uma mais nova. */
export function definirVersaoGravada(atualizadoEm) {
  versaoGravada = typeof atualizadoEm === 'string' ? atualizadoEm : null;
  conflito = false;
}

/** true quando o banco tem uma versão mais nova que a deste editor (as edições daqui não são mais gravadas). */
export const emConflito = () => conflito;

function agendarSalvar() {
  sujo = true;
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(() => { salvarAgora(); }, ATRASO_SALVAR);
  emitir('salvamento', { estado: 'pendente' });
}

async function gravar(guia, verificar) {
  if (conflito) return;
  if (verificar && versaoGravada) {
    const noBanco = await lerGuiaDoBanco(guia.id);
    if (noBanco?.atualizadoEm !== versaoGravada) {
      conflito = true;
      console.warn('Guia alterado fora deste editor: gravação recusada para não sobrescrever', { id: guia.id, aqui: versaoGravada, noBanco: noBanco?.atualizadoEm ?? null });
      emitir('salvamento', { estado: 'conflito' });
      return;
    }
  }
  const gravado = await salvarGuia(guia);
  versaoGravada = gravado.atualizadoEm;
  emitir('salvamento', { estado: 'salvo', em: gravado.atualizadoEm });
}

/**
 * Grava já (usado pelo botão Salvar, ao sair da página e antes de exportar). As gravações são encadeadas (uma por vez).
 * @param {{verificar?:boolean}} [opcoes] verificar=false pula a leitura de conferência (só ao descarregar a página,
 *   quando não há tempo para uma transação a mais). @returns {Promise<void>}
 */
export function salvarAgora({ verificar = true } = {}) {
  clearTimeout(timerSalvar);
  if (!sujo || !estado.guia || conflito) return salvando ?? Promise.resolve();
  const guia = estado.guia;
  sujo = false;
  emitir('salvamento', { estado: 'salvando' });
  salvando = (salvando ?? Promise.resolve())
    .then(() => gravar(guia, verificar))
    .catch((e) => {
      sujo = true;
      console.error('Falha ao salvar o guia', e);
      emitir('salvamento', { estado: 'erro', erro: e });
    });
  return salvando;
}

export const temPendencia = () => sujo;

/** Marca o guia como alterado fora do histórico (ex.: registro de publicação) e agenda a gravação. */
export function marcarAlterado() {
  if (!estado.guia) return;
  estado.guia.atualizadoEm = new Date().toISOString();
  agendarSalvar();
}

/** Ctrl/⌘+Z, Ctrl/⌘+Shift+Z e Ctrl+Y; ignora campos de texto (o navegador desfaz o texto). @returns {Function} remove */
export function instalarAtalhos(alvo = window) {
  const aoTeclar = (e) => {
    if (!estado.guia || ehEditavel(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) refazer(); else desfazer(); }
    else if (k === 'y' && !e.shiftKey) { e.preventDefault(); refazer(); }
  };
  const aoSair = () => { salvarAgora({ verificar: false }); };
  const aoOcultar = () => { if (document.visibilityState === 'hidden') salvarAgora(); };
  alvo.addEventListener('keydown', aoTeclar);
  window.addEventListener('beforeunload', aoSair);
  window.addEventListener('pagehide', aoSair);
  document.addEventListener('visibilitychange', aoOcultar);
  return () => {
    alvo.removeEventListener('keydown', aoTeclar);
    window.removeEventListener('beforeunload', aoSair);
    window.removeEventListener('pagehide', aoSair);
    document.removeEventListener('visibilitychange', aoOcultar);
  };
}

// Mantém a compatibilidade com quem só quer saber o índice do passo atual.
export { indiceDoPasso };
