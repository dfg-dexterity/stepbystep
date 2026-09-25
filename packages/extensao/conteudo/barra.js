// Barra flutuante da gravação (seção 5.11). Script clássico, só no frame de topo, sem import.
// Shadow root fechado + adoptedStyleSheets + DOM por createElement: imune a CSP style-src e a
// Trusted Types. Expõe window.__sbsBarra = { ocultar, mostrar, atualizar } para o gravador do
// mesmo frame; some sozinha quando a chave 'gravacao' desaparece do chrome.storage.session.
(() => {
  if (window !== window.top || window.__sbsBarra) return;
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.id || !globalThis.chrome?.storage?.session) return;

  const CSS = `
    :host { all: initial; display: block; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
    .barra { display: flex; align-items: center; gap: 8px; box-sizing: border-box; min-width: 220px; height: 40px;
      padding: 0 8px 0 12px; background: #1B1B1B; color: #F7F3E7; border: 1px solid rgba(247,243,231,.13);
      font: 500 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; cursor: grab; user-select: none; }
    .barra.arrastando { cursor: grabbing; }
    .ponto { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #009994; animation: sbs-pulsar 1.4s ease-in-out infinite; }
    .barra.pausada .ponto { background: #FFA436; animation: none; }
    .texto { flex: 1 1 auto; white-space: nowrap; }
    .numero { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
    button { all: initial; box-sizing: border-box; height: 26px; padding: 0 8px; border: 1px solid rgba(247,243,231,.25);
      color: #F7F3E7; font: 600 11px/24px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; cursor: pointer; white-space: nowrap; }
    button:hover { border-color: #00B3AC; color: #00B3AC; }
    button.parar { border-color: #FFA436; color: #FFA436; }
    button.parar:hover { background: #FFA436; color: #1B1B1B; }
    @keyframes sbs-pulsar { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
  `;
  const EVENTOS_ISOLADOS = ['pointerdown', 'pointerup', 'click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu', 'keydown', 'keyup', 'keypress', 'touchstart', 'touchend'];
  const INTERVALO_REINSERCAO = 2000;

  let host = null;
  let barra = null;
  let refs = null;
  let intervalo = null;
  let estadoAtual = { gravando: false, pausado: false, contador: 0 };

  function elemento(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function botao(texto, aoClicar, classe) {
    const b = elemento('button', classe, texto);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); aoClicar(); });
    return b;
  }

  function enviar(tipo, extra = {}) {
    try {
      return runtime.sendMessage({ tipo, em: Date.now(), ...extra }).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  function passoManual() {
    const titulo = (window.prompt('Título do passo manual:', '') ?? '').trim();
    if (titulo) enviar('PASSO_MANUAL', { titulo });
  }

  function instalarArraste() {
    let inicio = null;
    barra.addEventListener('pointerdown', (e) => {
      if (e.target instanceof HTMLButtonElement || e.button !== 0) return;
      const r = host.getBoundingClientRect();
      inicio = { dx: e.clientX - r.left, dy: e.clientY - r.top, largura: r.width, altura: r.height };
      try { barra.setPointerCapture(e.pointerId); } catch { /* sem captura, o arraste segue enquanto o ponteiro estiver sobre a barra */ }
      barra.classList.add('arrastando');
    });
    barra.addEventListener('pointermove', (e) => {
      if (!inicio) return;
      const x = Math.min(Math.max(0, e.clientX - inicio.dx), Math.max(0, innerWidth - inicio.largura));
      const y = Math.min(Math.max(0, e.clientY - inicio.dy), Math.max(0, innerHeight - inicio.altura));
      // CSSOM (não é "inline style" para a CSP): posição passa a ser pelo canto superior esquerdo
      host.style.setProperty('left', `${Math.round(x)}px`, 'important');
      host.style.setProperty('top', `${Math.round(y)}px`, 'important');
      host.style.setProperty('right', 'auto', 'important');
      host.style.setProperty('bottom', 'auto', 'important');
    });
    const soltar = () => { inicio = null; barra.classList.remove('arrastando'); };
    barra.addEventListener('pointerup', soltar);
    barra.addEventListener('pointercancel', soltar);
  }

  function criar() {
    host = document.createElement('div');
    host.setAttribute('data-sbs-barra', '');
    const raiz = host.attachShadow({ mode: 'closed' });
    const folha = new CSSStyleSheet();
    folha.replaceSync(CSS);
    raiz.adoptedStyleSheets = [folha];

    barra = elemento('div', 'barra');
    const ponto = elemento('span', 'ponto');
    const texto = elemento('span', 'texto');
    const prefixo = elemento('span', null, 'Gravando · ');
    const numero = elemento('span', 'numero', '0');
    const sufixo = elemento('span', null, ' passos');
    texto.append(prefixo, numero, sufixo);
    const pausa = botao('Pausar', () => enviar(estadoAtual.pausado ? 'BARRA_RETOMAR' : 'BARRA_PAUSAR'));
    const parar = botao('Parar', () => enviar('BARRA_PARAR'), 'parar');
    const manual = botao('+', passoManual);
    manual.title = 'Passo manual';
    barra.append(ponto, texto, pausa, parar, manual);
    raiz.append(barra);
    refs = { prefixo, numero, sufixo, pausa };

    // nada do que acontece na barra vaza para a página
    for (const tipo of EVENTOS_ISOLADOS) host.addEventListener(tipo, (e) => e.stopPropagation());
    instalarArraste();
    document.documentElement.appendChild(host);
    intervalo = setInterval(() => {
      if (host && !host.isConnected && document.documentElement) document.documentElement.appendChild(host);
    }, INTERVALO_REINSERCAO);
  }

  function remover() {
    clearInterval(intervalo);
    intervalo = null;
    host?.remove();
    host = null;
    barra = null;
    refs = null;
  }

  function ocultar() { host?.style.setProperty('visibility', 'hidden', 'important'); }
  function mostrar() { host?.style.setProperty('visibility', 'visible', 'important'); }

  /** @param {{gravando:boolean, pausado?:boolean, contador?:number}} estado */
  function atualizar(estado) {
    estadoAtual = { gravando: !!estado?.gravando, pausado: !!estado?.pausado, contador: Number(estado?.contador) || 0 };
    if (!estadoAtual.gravando) { remover(); return; }
    if (!host) criar();
    refs.prefixo.textContent = estadoAtual.pausado ? 'Pausado · ' : 'Gravando · ';
    refs.numero.textContent = String(estadoAtual.contador);
    refs.sufixo.textContent = estadoAtual.contador === 1 ? ' passo' : ' passos';
    refs.pausa.textContent = estadoAtual.pausado ? 'Retomar' : 'Pausar';
    barra.classList.toggle('pausada', estadoAtual.pausado);
  }

  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== 'session' || !mudancas.gravacao) return;
    const novo = mudancas.gravacao.newValue;
    if (!novo) { atualizar({ gravando: false }); return; }
    if (host) atualizar({ gravando: true, pausado: novo.status === 'pausado', contador: novo.contador });
  });

  window.__sbsBarra = { ocultar, mostrar, atualizar };
})();
