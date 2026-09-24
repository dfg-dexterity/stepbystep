// webNavigation.* → entradas do redutor (NAVEGACAO, NAVEGACAO_CAPTURADA, SPA) e adoção de abas.
// Só o frame de topo (frameId 0) da aba ativa da gravação conta; captureVisibleTab só vê a aba visível.
import { lerEstado, gravarEstado } from './estado.js';
import { enfileirar, aplicarAcoes, capturarNavegacaoAgora, finalizarGravacao } from './gravacao.js';
import { reduzir } from '../core/redutor-eventos.js';

const ATRASO_COMMITTED = 150;  // deixa chegar o PRE_CLIQUE despachado no pagehide da página anterior
const ATRASO_DOM = 800;        // onDOMContentLoaded + 800 ms, se onCompleted demorar
const ATRASO_PINTURA = 300;    // depois de carregar, a página ainda pinta
const OPCOES_REDUTOR = { plataforma: 'outro' };

const registrar = (e) => console.warn('[StepByStep] navegação:', e?.message ?? e);
const quando = (d) => (typeof d?.timeStamp === 'number' ? d.timeStamp : Date.now());

async function processarNavegacao(d) {
  const s = await lerEstado();
  if (!s || d.tabId !== s.abaId) return;
  const em = quando(d);
  if (em < s.iniciadoEm) return; // navegação anterior ao início (evento adiado pela fila)
  if (s.status === 'pausado') { await gravarEstado({ redutor: { ...s.redutor, urlAtual: d.url } }); return; }
  const { estado: redutor, acoes } = reduzir(s.redutor, { tipo: 'NAVEGACAO', url: d.url, transicao: d.transitionType, em }, OPCOES_REDUTOR);
  const r = await aplicarAcoes(s.guiaId, acoes);
  const patch = { redutor };
  if (r.capturarNavegacao) patch.navegacaoPendente = { abaId: d.tabId, url: d.url, transicao: r.capturarNavegacao.transicao, em };
  await gravarEstado(patch);
  if (r.capturarNavegacao) {
    // a página pode já ter terminado de carregar enquanto o commit esperava na fila
    const aba = await chrome.tabs.get(d.tabId).catch(() => null);
    if (aba?.status === 'complete') agendarCaptura(d.tabId, ATRASO_PINTURA);
  }
}

async function capturarPendente(tabId) {
  const s = await lerEstado();
  const p = s?.navegacaoPendente;
  if (!p || p.abaId !== tabId) return;
  await capturarNavegacaoAgora(tabId, p.url, p.transicao); // limpa navegacaoPendente ao persistir
}

function agendarCaptura(tabId, atraso) {
  setTimeout(() => enfileirar(() => capturarPendente(tabId)).catch(registrar), atraso);
}

async function processarSpa(d) {
  const s = await lerEstado();
  if (!s || d.tabId !== s.abaId || s.status === 'pausado') return;
  const em = quando(d);
  if (em < s.iniciadoEm) return;
  const { estado: redutor, acoes } = reduzir(s.redutor, { tipo: 'SPA', url: d.url, em }, OPCOES_REDUTOR);
  await aplicarAcoes(s.guiaId, acoes);
  await gravarEstado({ redutor });
}

/** webNavigation.onCommitted */
export function aoCommitted(d) {
  if (d.frameId !== 0) return;
  setTimeout(() => enfileirar(() => processarNavegacao(d)).catch(registrar), ATRASO_COMMITTED);
}

/** webNavigation.onDOMContentLoaded */
export function aoDomContentLoaded(d) {
  if (d.frameId === 0) agendarCaptura(d.tabId, ATRASO_DOM + ATRASO_PINTURA);
}

/** webNavigation.onCompleted */
export function aoCompleted(d) {
  if (d.frameId === 0) agendarCaptura(d.tabId, ATRASO_PINTURA);
}

/** webNavigation.onHistoryStateUpdated / onReferenceFragmentUpdated */
export function aoHistoryStateUpdated(d) {
  if (d.frameId === 0) enfileirar(() => processarSpa(d)).catch(registrar);
}
export const aoReferenceFragmentUpdated = aoHistoryStateUpdated;

/** webNavigation.onCreatedNavigationTarget: aba aberta a partir de uma aba da gravação entra na gravação. */
export function aoCreatedNavigationTarget(d) {
  enfileirar(async () => {
    const s = await lerEstado();
    if (!s || !s.abas.includes(d.sourceTabId) || s.abas.includes(d.tabId)) return;
    await gravarEstado({ abas: [...s.abas, d.tabId] });
  }).catch(registrar);
}

/** tabs.onActivated: a aba ativa da gravação passa a ser a visível. */
export function aoAbaAtivada(info) {
  enfileirar(async () => {
    const s = await lerEstado();
    if (!s || !s.abas.includes(info.tabId)) return;
    await gravarEstado({ abaId: info.tabId, janelaId: info.windowId ?? s.janelaId });
  }).catch(registrar);
}

/** tabs.onRemoved: última aba fechada encerra a gravação. */
export function aoAbaRemovida(tabId) {
  enfileirar(async () => {
    const s = await lerEstado();
    if (!s || !s.abas.includes(tabId)) return;
    const abas = s.abas.filter((id) => id !== tabId);
    if (!abas.length) { await finalizarGravacao(); return; }
    await gravarEstado({ abas, abaId: s.abaId === tabId ? abas[0] : s.abaId });
  }).catch(registrar);
}
