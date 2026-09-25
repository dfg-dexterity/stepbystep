// Ciclo de vida da gravação (seção 5.5): iniciar/pausar/retomar/parar, registro dinâmico dos
// content scripts, badge, fila serial de eventos e aplicação das ações do redutor no IndexedDB.
// Toda função começa lendo o estado de chrome.storage.session; nada de estado em variável de módulo.
import { criarGuia, renumerarMarcadores } from '../core/modelo.js';
import { criarEstadoRedutor, reduzir } from '../core/redutor-eventos.js';
import { salvarGuia, carregarGuia, listarGuias, excluirGuia } from '../core/armazenamento.js';
import { lerEstado, gravarEstado, limparEstado } from './estado.js';
import { capturar, capturaFaltante, reaproveitarUltima } from './captura.js';

export const ID_SCRIPTS = 'sbs';
export const ARQUIVOS_CONTEUDO = ['conteudo/barra.js', 'conteudo/gravador.js'];
export const ALARME = 'sbs-badge';
export const ERRO_PAGINA = 'Esta página não pode ser gravada';
export const ERRO_SEM_GRAVACAO = 'Nenhuma gravação em andamento';

const CORES_BADGE = { gravando: '#009994', pausado: '#FFA436' };
const TEXTO_BADGE = { gravando: '#F7F3E7', pausado: '#1B1B1B' };
const PREFIXOS_PROIBIDOS = [
  'chrome://', 'chrome-extension://', 'chrome-untrusted://', 'chrome-search://', 'devtools://', 'edge://', 'about:', 'view-source:',
  'https://chromewebstore.google.com', 'https://chrome.google.com/webstore',
];
// fonte pedida ao capturar, por tipo de mensagem (PASSO_MANUAL não fotografa)
const FONTE_POR_TIPO = { PRE_CLIQUE: 'pointerdown', MARCACAO: 'pointerdown', TECLA: 'pointerdown', DIGITACAO: 'confirmacao', SELECAO: 'confirmacao' };
const ESPERA_PASSO_INICIAL = 300;
const ESPERA_FLUSH = 150;
// captureVisibleTab fotografa a aba ATIVA da janela: um evento de aba em segundo plano (flush por tempo,
// focusout, página carregando) nunca é fotografado — a foto seria de outra aba, com conteúdo alheio
export const MOTIVO_ABA_OCULTA = 'aba não visível';
// digitação confirmada no pagehide: fotografar agora pegaria a página seguinte
export const MOTIVO_DESCARREGADA = 'página descarregada';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Fila serial: garante a ordem dos passos e leitura/escrita consistente do estado.
// É só um cache reconstruível — se o SW morrer, a fila recomeça vazia.
let fila = Promise.resolve();
export function enfileirar(fn) {
  const tarefa = fila.then(() => fn());
  fila = tarefa.catch(() => {});
  return tarefa;
}

/** URLs onde a gravação nunca funciona (chrome://, Web Store, páginas da própria extensão…). */
export function urlGravavel(url) {
  if (typeof url !== 'string' || !url) return false;
  const u = url.toLowerCase();
  return !PREFIXOS_PROIBIDOS.some((p) => u.startsWith(p));
}

function descreverPlataforma() {
  const ua = globalThis.navigator?.userAgent ?? '';
  const versao = /Chrome\/(\d+)/.exec(ua)?.[1] ?? '?';
  const so = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'desconhecido';
  return `Chrome ${versao} / ${so}`;
}

/** Plataforma dos atalhos (3.6): `'mac'` (⌘S) no macOS, `'outro'` (Win+S) nos demais — pelo userAgent do próprio Chrome. */
function plataformaDosAtalhos() {
  return /Mac OS X|Macintosh/.test(globalThis.navigator?.userAgent ?? '') ? 'mac' : 'outro';
}

/** Opções do redutor lidas do estado da gravação (`plataforma`, decidida em `iniciar`); estado sem o campo segue 'outro'. */
export function opcoesRedutor(s) {
  return { plataforma: s?.plataforma === 'mac' ? 'mac' : 'outro' };
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
/** Badge da action: cerceta gravando / âmbar pausado, com o contador; `null` limpa. */
export async function atualizarBadge(s) {
  const action = globalThis.chrome?.action;
  if (!action) return;
  try {
    if (!s) { await action.setBadgeText({ text: '' }); return; }
    const chave = s.status === 'pausado' ? 'pausado' : 'gravando';
    await action.setBadgeBackgroundColor({ color: CORES_BADGE[chave] });
    if (action.setBadgeTextColor) await action.setBadgeTextColor({ color: TEXTO_BADGE[chave] });
    await action.setBadgeText({ text: String(s.contador ?? 0) });
  } catch (e) {
    console.warn('[StepByStep] badge:', e?.message ?? e);
  }
}

// ---------------------------------------------------------------------------
// Content scripts (registro dinâmico só durante a gravação)
// ---------------------------------------------------------------------------
async function registrarScripts() {
  const existentes = await chrome.scripting.getRegisteredContentScripts({ ids: [ID_SCRIPTS] }).catch(() => []);
  if (existentes.length) await chrome.scripting.unregisterContentScripts({ ids: [ID_SCRIPTS] });
  const base = { id: ID_SCRIPTS, js: ARQUIVOS_CONTEUDO, matches: ['<all_urls>'], allFrames: true, runAt: 'document_start', persistAcrossSessions: false };
  try {
    await chrome.scripting.registerContentScripts([{ ...base, matchOriginAsFallback: true }]);
  } catch {
    await chrome.scripting.registerContentScripts([base]); // Chrome < 119 não conhece matchOriginAsFallback
  }
}

export async function desregistrarScripts() {
  try { await chrome.scripting.unregisterContentScripts({ ids: [ID_SCRIPTS] }); } catch { /* já removidos */ }
}

/**
 * Esconde a barra no frame de topo e espera dois quadros pintados (a barra nunca sai na foto).
 * Passa pela contagem de ocultações do gravador para não reexibir a barra em cima de um envio dele.
 */
async function ocultarBarra(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        (globalThis.__sbsGravador?.ocultarBarra ?? globalThis.__sbsBarra?.ocultar)?.();
        return new Promise((r) => {
          const t = setTimeout(() => r(false), 250);
          requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(true); }));
        });
      },
    });
  } catch { /* página sem content script (chrome://, PDF…) */ }
}

async function mostrarBarra(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => { (globalThis.__sbsGravador?.liberarBarra ?? globalThis.__sbsBarra?.mostrar)?.(); } });
  } catch { /* idem */ }
}

/** viewport/dpr/título da página, para os passos `navegar` (que não vêm de um content script). */
async function infoDaPagina(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ viewport: { largura: innerWidth, altura: innerHeight }, dpr: devicePixelRatio, tituloPagina: document.title, url: location.href }),
    });
    return r?.result ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Ações do redutor → IndexedDB
// ---------------------------------------------------------------------------
/** Insere o passo pela ordem cronológica do evento (criadoEm): mensagens de frames filhos podem chegar depois de eventos posteriores do topo. */
function inserirPasso(passos, passo) {
  let i = passos.length;
  while (i > 0 && typeof passos[i - 1].criadoEm === 'string' && passos[i - 1].criadoEm > passo.criadoEm) i--;
  passos.splice(i, 0, passo);
}

/**
 * Aplica as ações na ordem e grava o guia (marcadores auto renumerados pela posição).
 * @returns {Promise<{passoId:string|null, capturarNavegacao:{url:string, transicao:string}|null}>}
 */
export async function aplicarAcoes(guiaId, acoes) {
  const resultado = { passoId: null, capturarNavegacao: null };
  if (!acoes?.length) return resultado;
  const guia = await carregarGuia(guiaId);
  if (!guia) throw new Error('Guia da gravação não encontrado');
  let mudou = false;
  for (const acao of acoes) {
    switch (acao.tipo) {
      case 'criar':
        inserirPasso(guia.passos, acao.passo);
        resultado.passoId = acao.passo.id;
        mudou = true;
        break;
      case 'atualizar': {
        const p = guia.passos.find((x) => x.id === acao.passoId);
        if (!p) break;
        for (const [campo, valor] of Object.entries(acao.campos ?? {})) {
          if (campo === 'titulo') { if (p.tituloAuto) p.titulo = valor; } // título editado pelo usuário nunca é sobrescrito
          else p[campo] = valor;
        }
        resultado.passoId = p.id;
        mudou = true;
        break;
      }
      case 'excluir': {
        const antes = guia.passos.length;
        guia.passos = guia.passos.filter((x) => x.id !== acao.passoId);
        mudou = mudou || antes !== guia.passos.length;
        break;
      }
      case 'capturarNavegacao':
        resultado.capturarNavegacao = { url: acao.url, transicao: acao.transicao ?? 'outro' };
        break;
      default:
        break;
    }
  }
  if (mudou) await salvarGuia(renumerarMarcadores(guia));
  return resultado;
}

function patchDeCaptura(captura, abaId) {
  if (!captura || captura.faltante || captura.reaproveitada) return {};
  return { ultimaCaptura: { imagemId: captura.imagemId, em: captura.em, url: captura.url ?? null, largura: captura.largura, altura: captura.altura, abaId: abaId ?? null } };
}

/** Reduz uma entrada já com captura, aplica, persiste e atualiza o badge. @returns {Promise<string|null>} passoId */
async function reduzirEPersistir(s, entrada, captura, abaId) {
  const { estado: redutor, acoes } = reduzir(s.redutor, entrada, opcoesRedutor(s));
  // criadoEm = instante do evento na página (não o da persistência): é o que ordena os passos
  const criadoEm = new Date(Number.isFinite(entrada.em) ? entrada.em : Date.now()).toISOString();
  for (const a of acoes) if (a.tipo === 'criar') a.passo.criadoEm = criadoEm;
  const r = await aplicarAcoes(s.guiaId, acoes);
  const patch = { redutor, contador: redutor.contador, ...patchDeCaptura(captura, abaId) };
  if (r.passoId) patch.ultimoPassoId = r.passoId;
  if (entrada.tipo === 'NAVEGACAO_CAPTURADA') patch.navegacaoPendente = null;
  const novo = await gravarEstado(patch);
  await atualizarBadge(novo);
  return r.passoId;
}

// ---------------------------------------------------------------------------
// Eventos vindos dos content scripts (PRE_CLIQUE, DIGITACAO, SELECAO, MARCACAO, TECLA, PASSO_MANUAL)
// ---------------------------------------------------------------------------
/** @returns {Promise<{ok:boolean, passoId?:string|null, ignorado?:boolean, duplicado?:boolean, erro?:string}>} responde só depois de persistir */
export function processarEvento(tipo, mensagem, sender) {
  return enfileirar(async () => {
    let s = await lerEstado();
    if (!s) return { ok: false, erro: ERRO_SEM_GRAVACAO };
    const aba = sender?.tab;
    const abaId = aba?.id;
    if (!s.abas.includes(abaId)) return { ok: false, erro: 'Aba fora da gravação' };
    if (s.status === 'pausado') return { ok: true, ignorado: true };

    const em = Number.isFinite(mensagem?.em) ? mensagem.em : Date.now();
    const seletor = mensagem?.alvo?.seletor ?? null;
    // reenvio do content script (SW morto no meio): mesma entrada → não fotografa de novo
    const u = s.redutor?.ultimaEntrada;
    if (u && u.tipo === tipo && u.em === em && (u.seletor ?? null) === seletor) {
      return { ok: true, passoId: s.ultimoPassoId ?? null, duplicado: true };
    }

    // O remetente é a verdade sobre a aba/janela em uso: ao voltar a uma janela cuja aba da gravação já
    // estava ativa, tabs.onActivated não dispara e s.abaId/s.janelaId apontariam para a outra janela.
    const visivel = aba.active === true;
    if (visivel && (abaId !== s.abaId || aba.windowId !== s.janelaId)) s = await gravarEstado({ abaId, janelaId: aba.windowId });
    // navegação desta aba ainda sem foto (página interativa antes do `load`): fotografa antes do evento,
    // com o instante do onCommitted — o evento pode então compartilhar essa foto
    if (visivel && s.navegacaoPendente?.abaId === abaId) {
      await capturarPendente(abaId);
      s = await lerEstado();
    }

    const url = mensagem?.url ?? s.redutor?.urlAtual ?? null;
    const fonte = FONTE_POR_TIPO[tipo];
    let captura = null;
    if (fonte && !visivel) {
      captura = capturaFaltante(MOTIVO_ABA_OCULTA, fonte, em, url);
    } else if (fonte && tipo === 'DIGITACAO' && mensagem?.confirmadoPor === 'navegacao') {
      // a página já descarregou: só a última foto da mesma aba e URL serve (sem janela de 500 ms)
      captura = reaproveitarUltima(s, abaId, url) ?? capturaFaltante(MOTIVO_DESCARREGADA, fonte, em, url);
    } else if (fonte) {
      // na digitação `em` é a última tecla (é o que ordena o passo); a foto de confirmação é a de agora
      const referencia = tipo === 'DIGITACAO' ? Date.now() : em;
      captura = await capturar(aba.windowId, url, referencia, fonte, s, { abaId });
    }
    const msg = { ...mensagem, abaId, frameId: sender.frameId ?? 0, frameUrl: sender.frameId ? sender.url ?? null : null };
    const passoId = await reduzirEPersistir(s, { tipo, mensagem: msg, captura, em }, captura, abaId);
    return { ok: true, passoId };
  });
}

/**
 * Passo `navegar` (fonte 'navegacao') de uma aba da gravação: esconde a barra, fotografa, reduz NAVEGACAO_CAPTURADA.
 * `em` é o instante do onCommitted (ordena o passo antes de cliques feitos antes do `load`); a foto é de agora.
 * Aba não visível → passo com captura faltante (captureVisibleTab fotografaria a aba ativa, que é outra).
 * Deve rodar dentro da fila. @returns {Promise<string|null>} passoId
 */
export async function capturarNavegacaoAgora(abaId, url, transicao, em = Date.now()) {
  const s = await lerEstado();
  if (!s || s.status === 'pausado' || !s.abas.includes(abaId)) return null;
  const aba = await chrome.tabs.get(abaId).catch(() => null);
  if (!aba) return null;
  const visivel = aba.active === true;
  const agora = Date.now();
  if (visivel) await ocultarBarra(abaId);
  const info = await infoDaPagina(abaId);
  const captura = visivel
    ? await capturar(aba.windowId, url, agora, 'navegacao', s, { abaId })
    : capturaFaltante(MOTIVO_ABA_OCULTA, 'navegacao', agora, url);
  if (visivel) await mostrarBarra(abaId);
  const mensagem = { url, tituloPagina: info?.tituloPagina ?? aba.title ?? '', abaId, viewport: info?.viewport ?? null, dpr: info?.dpr ?? null };
  return reduzirEPersistir(s, { tipo: 'NAVEGACAO_CAPTURADA', url, transicao, captura, mensagem, em }, captura, abaId);
}

/** A pendência ainda é o documento atual do frame de topo? (documentId quando o Chrome informa; senão a URL.) */
async function pendenciaAtual(p) {
  const quadro = await chrome.webNavigation.getFrame({ tabId: p.abaId, frameId: 0 }).catch(() => null);
  if (!quadro) return false;
  if (p.documentId && quadro.documentId) return quadro.documentId === p.documentId;
  return (quadro.url ?? null) === p.url;
}

/**
 * Fotografa a navegação pendente da aba (`navegacaoPendente`, gravada em processarNavegacao). Pendência de um
 * documento já substituído é descartada sem foto; aba em segundo plano fica pendente até voltar a ser visível
 * (tabs.onActivated agenda a foto). Deve rodar dentro da fila. @returns {Promise<string|null>} passoId
 */
export async function capturarPendente(abaId) {
  const s = await lerEstado();
  const p = s?.navegacaoPendente;
  if (!p || p.abaId !== abaId) return null;
  const aba = await chrome.tabs.get(abaId).catch(() => null);
  if (!aba || !(await pendenciaAtual(p))) {
    await gravarEstado({ navegacaoPendente: null });
    return null;
  }
  if (aba.active !== true) return null;
  return capturarNavegacaoAgora(abaId, p.url, p.transicao, p.em); // limpa navegacaoPendente ao persistir
}

// ---------------------------------------------------------------------------
// INICIAR / PAUSAR / RETOMAR / PARAR
// ---------------------------------------------------------------------------
/** @returns {Promise<{ok:true, guiaId:string}|{ok:false, erro:string}>} resolve depois do passo inicial `navegar` */
export function iniciar(abaId) {
  return enfileirar(async () => {
    if (await lerEstado()) return { ok: false, erro: 'Já existe uma gravação em andamento' };
    let aba;
    try { aba = await chrome.tabs.get(abaId); } catch { return { ok: false, erro: ERRO_PAGINA }; }
    const url = aba.url || aba.pendingUrl || '';
    if (!urlGravavel(url)) return { ok: false, erro: ERRO_PAGINA };
    if (url.startsWith('file:') && !(await chrome.extension?.isAllowedFileSchemeAccess?.().catch(() => false))) return { ok: false, erro: ERRO_PAGINA };

    const guia = criarGuia({ titulo: aba.title ?? '', origem: { tipo: 'extensao', versao: chrome.runtime.getManifest().version, plataforma: descreverPlataforma() } });
    await salvarGuia(guia);
    const estado = {
      guiaId: guia.id, status: 'gravando', abaId, janelaId: aba.windowId, abas: [abaId], contador: 0, iniciadoEm: Date.now(),
      plataforma: plataformaDosAtalhos(), ultimaCaptura: null, ultimoPassoId: null, navegacaoPendente: null, redutor: criarEstadoRedutor(url),
    };
    await gravarEstado(estado);
    try {
      await registrarScripts();
      await chrome.scripting.executeScript({ target: { tabId: abaId, allFrames: true }, files: ARQUIVOS_CONTEUDO });
    } catch (e) {
      console.warn('[StepByStep] não foi possível injetar os content scripts:', e?.message ?? e);
      await desregistrarScripts();
      await limparEstado();
      await excluirGuia(guia.id).catch(() => {});
      return { ok: false, erro: ERRO_PAGINA };
    }
    await atualizarBadge(estado);
    chrome.alarms.create(ALARME, { periodInMinutes: 1 });
    // passo inicial "Navegue para …": a página assenta antes da foto; criadoEm = início (nenhum evento é anterior)
    await esperar(ESPERA_PASSO_INICIAL);
    await capturarNavegacaoAgora(abaId, url, 'inicio', estado.iniciadoEm);
    return { ok: true, guiaId: guia.id };
  });
}

export function pausar() {
  return enfileirar(async () => {
    const s = await lerEstado();
    if (!s) return { ok: false, erro: ERRO_SEM_GRAVACAO };
    const novo = await gravarEstado({ status: 'pausado' });
    await atualizarBadge(novo);
    return { ok: true, guiaId: s.guiaId };
  });
}

export function retomar() {
  return enfileirar(async () => {
    const s = await lerEstado();
    if (!s) return { ok: false, erro: ERRO_SEM_GRAVACAO };
    const novo = await gravarEstado({ status: 'gravando' });
    await atualizarBadge(novo);
    return { ok: true, guiaId: s.guiaId };
  });
}

/** Pede aos gravadores da aba ativa que enviem a digitação pendente (confirmadoPor 'parar'). @returns {Promise<boolean>} algo foi enviado */
async function pedirFlush(tabId) {
  try {
    const rs = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => globalThis.__sbsGravador?.flush?.('parar') === true });
    return rs.some((r) => r?.result === true);
  } catch { return false; }
}

/** Encerra de fato (dentro da fila): remove scripts, limpa o estado, conclui o guia, abre o editor. */
export async function finalizarGravacao() {
  const s = await lerEstado();
  if (!s) return { ok: false, erro: ERRO_SEM_GRAVACAO };
  await desregistrarScripts();
  await limparEstado();
  chrome.alarms.clear(ALARME).catch?.(() => {});
  const guia = await carregarGuia(s.guiaId);
  if (guia) { guia.estado = 'concluido'; await salvarGuia(guia); }
  await atualizarBadge(null);
  try { await chrome.tabs.create({ url: chrome.runtime.getURL(`editor/index.html#/guia/${s.guiaId}`) }); } catch (e) { console.warn('[StepByStep] abrir editor:', e?.message ?? e); }
  return { ok: true, guiaId: s.guiaId };
}

export async function parar() {
  const s = await lerEstado();
  if (!s) return { ok: false, erro: ERRO_SEM_GRAVACAO };
  // a digitação pendente da aba ativa vira passo antes do encerramento; a mensagem entra na fila antes de finalizar
  if (await pedirFlush(s.abaId)) await esperar(ESPERA_FLUSH);
  return enfileirar(() => finalizarGravacao());
}

/** Resposta de ESTADO (popup). */
export async function estadoResumo() {
  const s = await lerEstado();
  return { ok: true, gravando: !!s, pausado: s?.status === 'pausado', contador: s?.contador ?? 0, guiaId: s?.guiaId ?? null, abaId: s?.abaId ?? null };
}

/** Resposta de PEDIR_ESTADO (content script): só é "gravando" para abas da gravação. Roda na fila para ver adoções recentes. */
export function estadoParaConteudo(sender) {
  return enfileirar(async () => {
    const s = await lerEstado();
    const dentro = !!s && s.abas.includes(sender?.tab?.id);
    return { ok: true, gravando: dentro, pausado: dentro && s.status === 'pausado', contador: dentro ? s.contador ?? 0 : 0, guiaId: dentro ? s.guiaId : null };
  });
}

/** onStartup/onInstalled: guias 'gravando' viram 'interrompido'; nada fica registrado ou no badge. */
export function marcarInterrompidos() {
  return enfileirar(async () => {
    try {
      for (const r of await listarGuias({ estado: 'gravando' })) {
        const g = await carregarGuia(r.id);
        if (g) { g.estado = 'interrompido'; await salvarGuia(g); }
      }
    } catch (e) {
      console.warn('[StepByStep] não foi possível marcar guias interrompidos:', e?.message ?? e);
    }
    await desregistrarScripts();
    await limparEstado().catch(() => {});
    await atualizarBadge(null);
  });
}

/** Alarme de 1 min: atualiza o badge e encerra se todas as abas da gravação fecharam. */
export function verificarAbas() {
  return enfileirar(async () => {
    const s = await lerEstado();
    if (!s) { await atualizarBadge(null); return; }
    const vivas = [];
    for (const id of s.abas) { try { await chrome.tabs.get(id); vivas.push(id); } catch { /* fechada */ } }
    if (!vivas.length) { await finalizarGravacao(); return; }
    const novo = vivas.length === s.abas.length ? s : await gravarEstado({ abas: vivas, abaId: vivas.includes(s.abaId) ? s.abaId : vivas[0] });
    await atualizarBadge(novo);
  });
}
