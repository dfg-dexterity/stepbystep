// Service worker da extensão (module). Listeners registrados síncronos no topo e imports
// estáticos (nunca import() dinâmico): o SW pode ser descartado e recriado a qualquer momento.
// Estado só em chrome.storage.session (sw/estado.js) e IndexedDB (core/armazenamento.js).
import { lerEstado } from './sw/estado.js';
import { carregarGuia, listarGuias } from './core/armazenamento.js';
import {
  iniciar, pausar, retomar, parar, estadoResumo, estadoParaConteudo, processarEvento,
  marcarInterrompidos, verificarAbas, ALARME,
} from './sw/gravacao.js';
import {
  aoCommitted, aoDomContentLoaded, aoCompleted, aoHistoryStateUpdated, aoReferenceFragmentUpdated,
  aoCreatedNavigationTarget, aoAbaAtivada, aoJanelaFocada, aoAbaRemovida,
} from './sw/navegacao.js';

// content scripts precisam ler a chave 'gravacao'
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch((e) => console.warn('[StepByStep] setAccessLevel:', e?.message ?? e));

const TIPOS_EVENTO = new Set(['PRE_CLIQUE', 'DIGITACAO', 'SELECAO', 'MARCACAO', 'TECLA', 'PASSO_MANUAL']);
const LIMITE_GUIAS = 10;

async function exigirAba(sender, fn) {
  const s = await lerEstado();
  if (!s || !s.abas.includes(sender.tab.id)) return { ok: false, erro: 'Aba fora da gravação' };
  return fn();
}

// Páginas da extensão (popup, editor) também podem estar numa aba (sender.tab definido): o que
// distingue um content script é a URL de página comum.
const dePaginaDaExtensao = (sender) => typeof sender?.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));

async function tratarMensagem(msg, sender) {
  const tipo = msg?.tipo;
  if (sender?.tab && !dePaginaDaExtensao(sender)) {
    // vindo de um content script
    switch (tipo) {
      case 'PEDIR_ESTADO': return estadoParaConteudo(sender);
      case 'BARRA_PAUSAR': return exigirAba(sender, pausar);
      case 'BARRA_RETOMAR': return exigirAba(sender, retomar);
      case 'BARRA_PARAR': return exigirAba(sender, parar);
      default:
        if (TIPOS_EVENTO.has(tipo)) return processarEvento(tipo, msg, sender);
        return { ok: false, erro: `Mensagem desconhecida: ${tipo}` };
    }
  }
  // vindo do popup (ou de outra página da extensão)
  switch (tipo) {
    case 'INICIAR': return iniciar(msg.abaId);
    case 'PARAR': return parar();
    case 'PAUSAR': return pausar();
    case 'RETOMAR': return retomar();
    case 'ESTADO': return estadoResumo();
    case 'LISTAR_GUIAS': {
      const guias = await listarGuias();
      return { ok: true, guias: guias.slice(0, Number.isInteger(msg.limite) && msg.limite > 0 ? msg.limite : LIMITE_GUIAS) };
    }
    default: return { ok: false, erro: `Mensagem desconhecida: ${tipo}` };
  }
}

async function alternarGravacao() {
  if (await lerEstado()) return parar();
  const [aba] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!aba) return { ok: false, erro: 'Nenhuma aba ativa' };
  return iniciar(aba.id);
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  tratarMensagem(msg, sender).then(
    (r) => responder(r ?? { ok: true }),
    (e) => responder({ ok: false, erro: e?.message ?? String(e) }),
  );
  return true; // resposta assíncrona: só depois de persistir
});
chrome.runtime.onStartup.addListener(() => { marcarInterrompidos(); });
chrome.runtime.onInstalled.addListener(() => { marcarInterrompidos(); });
chrome.webNavigation.onCommitted.addListener(aoCommitted);
chrome.webNavigation.onDOMContentLoaded.addListener(aoDomContentLoaded);
chrome.webNavigation.onCompleted.addListener(aoCompleted);
chrome.webNavigation.onHistoryStateUpdated.addListener(aoHistoryStateUpdated);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(aoReferenceFragmentUpdated);
chrome.webNavigation.onCreatedNavigationTarget.addListener(aoCreatedNavigationTarget);
chrome.tabs.onActivated.addListener(aoAbaAtivada);
chrome.windows.onFocusChanged.addListener(aoJanelaFocada);
chrome.tabs.onRemoved.addListener((tabId) => aoAbaRemovida(tabId));
chrome.commands.onCommand.addListener((comando) => { if (comando === 'alternar-gravacao') alternarGravacao(); });
chrome.alarms.onAlarm.addListener((alarme) => { if (alarme.name === ALARME) verificarAbas(); });

// Só alcançável por DevTools/CDP (Playwright): mesma superfície do popup, sem mensagens.
globalThis.__sbs = { iniciar, parar, pausar, retomar, estado: lerEstado, lerGuia: carregarGuia };
