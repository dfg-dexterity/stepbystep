// Sensor da gravação (seções 5.6–5.10). Script clássico em todos os frames, sem import:
// classificarCampo (core/mascara.js) e o descritor do alvo são replicados aqui.
// Nunca captura imagem, nunca toca o IndexedDB e nunca envia o valor de um campo sensível.
// Inerte até o SW confirmar (PEDIR_ESTADO) que esta aba faz parte da gravação; reage a
// chrome.storage.onChanged para ligar/desligar/pausar sem depender do SW.
(() => {
  if (window.__sbsGravador) return;
  const runtime = globalThis.chrome?.runtime;
  const storage = globalThis.chrome?.storage?.session;
  if (!runtime?.id || !storage) return;

  const ehTopo = window === window.top;
  const SELETOR_INTERATIVO = 'button, a[href], input, select, textarea, summary, label, [contenteditable], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], [role=combobox]';
  const PAPEIS = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option']);
  const PAPEIS_MARCAR = new Set(['checkbox', 'radio', 'switch']);
  const TIPOS_TEXTO = new Set(['text', 'email', 'search', 'tel', 'url', 'number', 'password']);
  const TECLAS_MODIFICADORAS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn']);
  // mesmas regras de core/mascara.js
  const AUTOCOMPLETE_SENSIVEL = new Set(['cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'current-password', 'new-password', 'one-time-code']);
  const REGEX_NOME = /senha|password|passwd|token|secret|cvv|cvc|cart[ãa]o|cpf|cnpj/i;
  const LIMITE_ROTULO = 60;
  const TEMPO_DIGITACAO = 8000;      // 8 s sem teclas → confirmadoPor 'tempo'
  const TIMEOUT_DESLOCAMENTO = 150;  // pai que não responde → rectCss null
  const TIMEOUT_BARRA = 2500;        // barra volta mesmo sem resposta do SW (captura + fila raramente passam de 300 ms)
  const MOSTRAR_APOS_FILHO = 800;    // barra volta depois de responder DESLOCAMENTO? a um frame filho
  const JANELA_POINTERDOWN = 1000;   // change de checkbox/radio logo após pointerdown já virou passo

  let ativo = false;
  let pausado = false;
  let pendente = null;          // { el, valorInicial, alterado, timer }
  let ultimoPointerdown = null; // { el, em }
  let filaEnvio = Promise.resolve();
  const aguardando = [];        // envios ainda esperando barra oculta + 2×rAF (despachados no pagehide)
  let timerBarra = null;
  // Ocultações da barra ainda não liberadas. A barra só volta quando a contagem zera: a resposta
  // do SW ao envio A pode chegar depois que o envio B já ocultou a barra e pediu a foto — reexibir
  // nessa hora colocaria a barra na captura de B.
  let ocultacoes = 0;

  // ---------------------------------------------------------------------------
  // Texto e classificação
  // ---------------------------------------------------------------------------
  const normalizar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
  function cortar(t) {
    const chars = Array.from(normalizar(t));
    return chars.length <= LIMITE_ROTULO ? chars.join('') : chars.slice(0, LIMITE_ROTULO - 1).join('').trimEnd() + '…';
  }
  const textoDe = (el) => normalizar(el?.innerText ?? el?.textContent);

  function classificarCampo(d) {
    const desc = d ?? {};
    if (typeof desc.tipoInput === 'string' && desc.tipoInput.toLowerCase() === 'password') return { sensivel: true, motivo: 'input[type=password]' };
    if (typeof desc.autocomplete === 'string') {
      const achado = desc.autocomplete.trim().toLowerCase().split(/\s+/).find((t) => AUTOCOMPLETE_SENSIVEL.has(t));
      if (achado) return { sensivel: true, motivo: 'autocomplete=' + achado };
    }
    for (const chave of ['nome', 'id', 'campo']) {
      const valor = desc[chave];
      if (typeof valor !== 'string') continue;
      const m = REGEX_NOME.exec(valor);
      if (m) return { sensivel: true, motivo: 'nome:' + m[0].toLowerCase() };
    }
    if (desc.papelNativo === 'AXSecureTextField') return { sensivel: true, motivo: 'AXSecureTextField' };
    return { sensivel: false, motivo: null };
  }

  // ---------------------------------------------------------------------------
  // Descritor do alvo (5.10)
  // ---------------------------------------------------------------------------
  function porId(el, id) {
    const raiz = el.getRootNode?.();
    return (raiz && typeof raiz.getElementById === 'function' ? raiz.getElementById(id) : null) ?? document.getElementById(id);
  }

  function labelDe(el) {
    const labels = el.labels; // só elementos rotuláveis
    if (labels?.length) { const t = textoDe(labels[0]); if (t) return t; }
    const ancestral = el.closest?.('label');
    if (ancestral) { const t = textoDe(ancestral); if (t) return t; }
    return '';
  }

  function ariaDe(el) {
    const aria = normalizar(el.getAttribute('aria-label'));
    if (aria) return aria;
    const ids = normalizar(el.getAttribute('aria-labelledby'));
    if (ids) {
      const t = ids.split(' ').map((id) => textoDe(porId(el, id))).filter(Boolean).join(' ');
      if (t) return t;
    }
    return '';
  }

  function celulaAnterior(el) {
    const celula = el.closest?.('td, th, [role=gridcell], [role=cell]');
    const anterior = celula?.previousElementSibling;
    return anterior ? textoDe(anterior) : '';
  }

  const ehCampo = (tag, papel) => tag === 'input' || tag === 'select' || tag === 'textarea' || papel === 'textbox' || papel === 'combobox';

  /** @returns {[string|null, string]} rótulo e fonteRotulo */
  function rotuloDe(el, tag, tipoInput, papel) {
    const aria = ariaDe(el);
    if (aria) return [cortar(aria), 'aria'];
    const label = labelDe(el);
    if (label) return [cortar(label), 'label'];
    if (!ehCampo(tag, papel)) { const t = textoDe(el); if (t) return [cortar(t), 'texto']; }
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(tipoInput) && normalizar(el.value)) return [cortar(el.value), 'texto'];
    const title = normalizar(el.getAttribute('title'));
    if (title) return [cortar(title), 'title'];
    const img = el.querySelector?.('img[alt]');
    if (img && normalizar(img.alt)) return [cortar(img.alt), 'alt'];
    const placeholder = normalizar(el.getAttribute('placeholder'));
    if (placeholder) return [cortar(placeholder), 'placeholder'];
    const nome = normalizar(el.getAttribute('name'));
    if (nome) return [cortar(nome), 'name'];
    return [null, 'nenhum'];
  }

  /** @returns {[string|null, string]} campo e sua fonte (label, aria, placeholder, name, celula) */
  function campoDe(el) {
    const label = labelDe(el);
    if (label) return [cortar(label), 'label'];
    const aria = ariaDe(el);
    if (aria) return [cortar(aria), 'aria'];
    const placeholder = normalizar(el.getAttribute('placeholder'));
    if (placeholder) return [cortar(placeholder), 'placeholder'];
    const nome = normalizar(el.getAttribute('name'));
    if (nome) return [cortar(nome), 'name'];
    const celula = celulaAnterior(el); // padrão SAP GUI for HTML / Fiori: rótulo na célula à esquerda
    if (celula) return [cortar(celula), 'celula'];
    return [null, 'nenhum'];
  }

  function papelDe(el, tag, tipoInput) {
    const role = normalizar(el.getAttribute('role')).toLowerCase();
    if (PAPEIS.has(role)) return role;
    if (tag === 'button' || tag === 'summary' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(tipoInput))) return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'input' && tipoInput === 'checkbox') return 'checkbox';
    if (tag === 'input' && tipoInput === 'radio') return 'radio';
    if (tag === 'select') return 'combobox';
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return 'textbox';
    return 'generic';
  }

  const idUsavel = (el) => typeof el.id === 'string' && el.id !== '' && !/\s/.test(el.id);

  /** `#id` ou caminho tag:nth-of-type(n) até 5 níveis (só depuração e duplo clique). */
  function seletorDe(el) {
    if (idUsavel(el)) return '#' + CSS.escape(el.id);
    const partes = [];
    let atual = el;
    for (let nivel = 0; atual && atual.nodeType === 1 && nivel < 5; nivel++) {
      if (idUsavel(atual)) { partes.unshift('#' + CSS.escape(atual.id)); break; }
      let n = 1;
      for (let irmao = atual.previousElementSibling; irmao; irmao = irmao.previousElementSibling) if (irmao.tagName === atual.tagName) n++;
      partes.unshift(`${atual.tagName.toLowerCase()}:nth-of-type(${n})`);
      const pai = atual.parentNode;
      atual = pai?.nodeType === 1 ? pai : pai?.host ?? null; // sobe pelo host do shadow root
    }
    return partes.join(' > ');
  }

  function marcadoDe(el) {
    if (typeof el.checked === 'boolean') return el.checked;
    return el.getAttribute('aria-checked') === 'true';
  }

  function descrever(el) {
    const tag = el.tagName.toLowerCase();
    const tipoInput = tag === 'input' ? (el.getAttribute('type') || 'text').trim().toLowerCase() : null;
    const papel = papelDe(el, tag, tipoInput);
    let [rotulo, fonteRotulo] = rotuloDe(el, tag, tipoInput, papel);
    let campo = null;
    if (ehCampo(tag, papel)) {
      const [c, fonteCampo] = campoDe(el);
      campo = c;
      if (!rotulo && c) { rotulo = c; fonteRotulo = fonteCampo; }
    }
    const r = el.getBoundingClientRect();
    return {
      papel, rotulo, fonteRotulo, campo, tag, tipoInput,
      seletor: seletorDe(el),
      rectCss: { x: r.left, y: r.top, w: r.width, h: r.height },
      marcadoAntes: PAPEIS_MARCAR.has(papel) ? marcadoDe(el) : null,
      autocomplete: el.getAttribute('autocomplete'),
      nome: el.getAttribute('name'),
      id: el.id || null,
    };
  }

  // ---------------------------------------------------------------------------
  // Deslocamento até o topo (5.7) e barra
  // ---------------------------------------------------------------------------
  function doisQuadros() {
    return new Promise((r) => {
      const t = setTimeout(r, 250); // aba em segundo plano não pinta: não trava o envio
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(); }));
    });
  }

  /** Oculta a barra (mais uma ocultação pendente); o temporizador de segurança zera tudo se nenhuma resposta vier. */
  function ocultarBarra() {
    if (!ehTopo) return;
    ocultacoes++;
    clearTimeout(timerBarra);
    window.__sbsBarra?.ocultar();
    timerBarra = setTimeout(mostrarBarra, TIMEOUT_BARRA);
  }
  /** Reexibe a barra incondicionalmente (fim da gravação, temporizador de segurança). */
  function mostrarBarra() {
    if (!ehTopo) return;
    clearTimeout(timerBarra);
    timerBarra = null;
    ocultacoes = 0;
    window.__sbsBarra?.mostrar();
  }
  /** Libera uma ocultação; a barra só volta quando não resta nenhuma. */
  function liberarBarra() {
    if (!ehTopo) return;
    ocultacoes = Math.max(0, ocultacoes - 1);
    if (ocultacoes === 0) mostrarBarra();
  }
  function liberarBarraDepois(ms) {
    if (!ehTopo) return;
    setTimeout(liberarBarra, ms);
  }

  /** Cadeia same-origin por frameElement (síncrona); null se algum pai for de outra origem. */
  function deslocamentoSincrono() {
    if (ehTopo) return { x: 0, y: 0, viewport: { largura: innerWidth, altura: innerHeight } };
    try {
      let x = 0, y = 0, w = window;
      while (w !== w.top) {
        const fe = w.frameElement; // null quando o pai é de outra origem
        if (!fe) return null;
        const r = fe.getBoundingClientRect();
        x += r.left + fe.clientLeft;
        y += r.top + fe.clientTop;
        w = w.parent;
      }
      return { x, y, viewport: { largura: w.innerWidth, altura: w.innerHeight } };
    } catch {
      return null;
    }
  }

  /** Pede ao pai (postMessage): ele soma o próprio deslocamento; o topo oculta a barra e espera 2×rAF. */
  function pedirDeslocamentoAoPai() {
    return new Promise((resolver) => {
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => { window.removeEventListener('message', ouvir); resolver(null); }, TIMEOUT_DESLOCAMENTO);
      function ouvir(e) {
        const d = e.data;
        if (e.source !== window.parent || !d || d.sbs !== 1 || d.tipo !== 'DESLOCAMENTO' || d.nonce !== nonce) return;
        clearTimeout(timer);
        window.removeEventListener('message', ouvir);
        resolver({ x: d.x, y: d.y, viewport: d.viewport });
      }
      window.addEventListener('message', ouvir);
      window.parent.postMessage({ sbs: 1, tipo: 'DESLOCAMENTO?', nonce }, '*');
    });
  }

  /** Barra oculta e quadro pintado; devolve {x, y, viewport} ou null (timeout → rectCss null, viewport do próprio frame). */
  async function prepararCaptura() {
    if (ehTopo) {
      ocultarBarra();
      await doisQuadros();
      return deslocamentoSincrono();
    }
    const sincrono = deslocamentoSincrono();
    const doPai = await pedirDeslocamentoAoPai(); // mesmo same-origin: é o pedido que faz o topo ocultar a barra
    return sincrono ?? doPai;
  }

  // pai: responde DESLOCAMENTO? de um frame filho com a posição dele somada ao próprio deslocamento
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!ativo || !d || d.sbs !== 1 || d.tipo !== 'DESLOCAMENTO?' || !e.source) return;
    const frame = Array.from(document.querySelectorAll('iframe, frame')).find((f) => f.contentWindow === e.source);
    if (!frame) return;
    const r = frame.getBoundingClientRect();
    prepararCaptura().then((meu) => {
      if (!meu) return; // sem deslocamento próprio o filho também expira
      e.source.postMessage({ sbs: 1, tipo: 'DESLOCAMENTO', nonce: d.nonce, x: r.left + frame.clientLeft + meu.x, y: r.top + frame.clientTop + meu.y, viewport: meu.viewport }, '*');
      liberarBarraDepois(MOSTRAR_APOS_FILHO);
    });
  });

  // ---------------------------------------------------------------------------
  // Envio ao SW
  // ---------------------------------------------------------------------------
  function urlTopo() { try { return window.top.location.href; } catch { return location.href; } }
  function tituloTopo() { try { return window.top.document.title; } catch { return document.title; } }

  function comum(d, em) {
    return {
      viewport: d?.viewport ?? { largura: innerWidth, altura: innerHeight },
      dpr: devicePixelRatio,
      url: urlTopo(),
      tituloPagina: tituloTopo(),
      scroll: { x: scrollX, y: scrollY },
      em,
    };
  }

  const somar = (p, d) => (p && d ? { ...p, x: p.x + d.x, y: p.y + d.y } : null);
  function aplicarDeslocamento(payload, d) {
    if (payload.alvo) payload.alvo.rectCss = somar(payload.alvo.rectCss, d);
    if ('pontoCss' in payload) payload.pontoCss = somar(payload.pontoCss, d);
    const dp = payload.digitacaoPendente;
    if (dp) {
      if (dp.alvo) dp.alvo.rectCss = somar(dp.alvo.rectCss, d);
      if (d) dp.viewport = d.viewport;
    }
  }

  async function enviarComReenvio(msg) {
    try {
      return await runtime.sendMessage(msg);
    } catch {
      try {
        return await runtime.sendMessage(msg); // reenvio único com o mesmo `em`: o redutor descarta a duplicata
      } catch (e) {
        return { ok: false, erro: String(e?.message ?? e) };
      }
    }
  }

  function despachar(item, d) {
    if (item.enviado) return;
    item.enviado = true;
    const i = aguardando.indexOf(item);
    if (i >= 0) aguardando.splice(i, 1);
    aplicarDeslocamento(item.payload, d);
    const msg = { tipo: item.tipo, ...comum(d, item.em), ...item.payload };
    enviarComReenvio(msg).then((r) => { if (item.ocultou) liberarBarra(); item.resolver(r); });
  }

  /** Oculta a barra, espera 2×rAF (via pedido ao pai nos frames filhos), soma deslocamentos e envia. Ordem preservada. */
  function enviarComCaptura(tipo, payload, em) {
    const item = { tipo, payload, em, enviado: false, ocultou: false, resolver: null };
    const promessa = new Promise((r) => { item.resolver = r; });
    aguardando.push(item);
    filaEnvio = filaEnvio.then(async () => {
      if (item.enviado) return;
      const d = await prepararCaptura();
      item.ocultou = ehTopo; // só o topo ocultou por conta própria; nos filhos é o topo quem libera (DESLOCAMENTO?)
      despachar(item, d);
    }).catch(() => {});
    return promessa;
  }

  /** Envio imediato (pagehide, parar): sem esperar quadro nem ocultar a barra; deslocamento só se for síncrono. */
  function enviarDireto(tipo, payload, em) {
    const item = { tipo, payload, em, enviado: false, ocultou: false, resolver: () => {} };
    despachar(item, deslocamentoSincrono());
  }

  // ---------------------------------------------------------------------------
  // Digitação (5.9)
  // ---------------------------------------------------------------------------
  function ehCampoTexto(el) {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') return TIPOS_TEXTO.has((el.getAttribute('type') || 'text').trim().toLowerCase());
    return el.isContentEditable === true;
  }
  const valorDe = (el) => (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.innerText);
  const focado = (el) => document.activeElement === el || el.getRootNode?.()?.activeElement === el;

  function iniciarPendente(el) {
    if (pendente?.el === el) return;
    if (pendente) clearTimeout(pendente.timer);
    pendente = { el, valorInicial: valorDe(el), alterado: false, timer: null };
  }

  function montarDigitacao(p, confirmadoPor) {
    const alvo = descrever(p.el);
    const { sensivel, motivo } = classificarCampo({ tipoInput: alvo.tipoInput, autocomplete: alvo.autocomplete, nome: alvo.nome, id: alvo.id, campo: alvo.campo });
    return { alvo, valor: sensivel ? null : valorDe(p.el), sensivel, motivo, confirmadoPor, ...comum(null, Date.now()) };
  }

  /** Consome a digitação pendente; null se não houve alteração. Se o campo continua focado, rearma para a continuação. */
  function consumirPendente(confirmadoPor) {
    const p = pendente;
    if (!p) return null;
    clearTimeout(p.timer);
    pendente = null;
    const valor = valorDe(p.el);
    const payload = p.alterado && valor !== p.valorInicial ? montarDigitacao(p, confirmadoPor) : null;
    if (p.el.isConnected && focado(p.el)) pendente = { el: p.el, valorInicial: valor, alterado: false, timer: null };
    return payload;
  }

  /** @returns {boolean} algo foi enviado */
  function flush(confirmadoPor, direto = false) {
    const payload = consumirPendente(confirmadoPor);
    if (!payload) return false;
    if (direto) enviarDireto('DIGITACAO', payload, payload.em);
    else enviarComCaptura('DIGITACAO', payload, payload.em);
    return true;
  }

  const ligado = () => ativo && !pausado;
  const modificadoresDe = (e) => [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);

  function pointerdownRecente(el) {
    return !!ultimoPointerdown && Date.now() - ultimoPointerdown.em < JANELA_POINTERDOWN
      && (ultimoPointerdown.el === el || ultimoPointerdown.el?.control === el || el.control === ultimoPointerdown.el);
  }

  // ---------------------------------------------------------------------------
  // Sensores (fase de captura)
  // ---------------------------------------------------------------------------
  window.addEventListener('pointerdown', (e) => {
    if (!ligado()) return;
    const caminho = e.composedPath();
    if (caminho.some((n) => n instanceof Element && n.hasAttribute('data-sbs-barra'))) return;
    const alvo = caminho[0];
    const elAlvo = alvo instanceof Element ? alvo : alvo?.parentElement ?? null;
    if (!elAlvo) return;
    let interativo = caminho.find((n) => n instanceof Element && n.matches(SELETOR_INTERATIVO)) ?? elAlvo;
    // clique no rótulo de checkbox/radio é o clique no controle
    const controle = interativo.tagName === 'LABEL' ? interativo.control : null;
    if (controle && ['checkbox', 'radio'].includes((controle.getAttribute('type') || '').trim().toLowerCase())) interativo = controle;
    const em = Date.now();
    ultimoPointerdown = { el: interativo, em };
    const descritor = descrever(interativo);
    const digitacaoPendente = pendente && pendente.el !== interativo ? consumirPendente('clique') : null;
    const botao = e.button === 1 ? 'meio' : e.button === 2 ? 'direito' : 'esquerdo';
    enviarComCaptura('PRE_CLIQUE', { alvo: descritor, pontoCss: { x: e.clientX, y: e.clientY }, botao, modificadores: modificadoresDe(e), digitacaoPendente }, em);
  }, true);

  window.addEventListener('focusin', (e) => {
    if (!ligado() || !ehCampoTexto(e.target)) return;
    if (pendente && pendente.el !== e.target) flush('blur');
    iniciarPendente(e.target);
  }, true);

  window.addEventListener('input', (e) => {
    if (!ligado() || !ehCampoTexto(e.target)) return;
    if (!pendente || pendente.el !== e.target) return; // sem focusin antes (ex.: autofill) não há valor inicial confiável
    pendente.alterado = true;
    clearTimeout(pendente.timer);
    pendente.timer = setTimeout(() => flush('tempo'), TEMPO_DIGITACAO);
  }, true);

  window.addEventListener('focusout', (e) => {
    if (!ativo || !pendente || pendente.el !== e.target) return;
    flush('blur');
  }, true);

  window.addEventListener('change', (e) => {
    if (!ligado()) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      if (pendente && pendente.el !== el) flush('blur'); // campo anterior abandonado sem pointerdown (automação, teclado)
      const opcao = el.selectedOptions?.[0]?.text;
      enviarComCaptura('SELECAO', { alvo: descrever(el), valor: el.value, opcao: opcao == null ? null : normalizar(opcao) }, Date.now());
      return;
    }
    if (tag === 'input' && ['checkbox', 'radio'].includes((el.getAttribute('type') || '').trim().toLowerCase())) {
      if (pointerdownRecente(el)) return; // já virou `marcar` no PRE_CLIQUE
      enviarComCaptura('MARCACAO', { alvo: descrever(el), marcado: !!el.checked }, Date.now());
      return;
    }
    if (pendente && pendente.el === el) flush('blur');
  }, true);

  window.addEventListener('keydown', (e) => {
    if (!ligado() || e.isComposing || TECLAS_MODIFICADORAS.has(e.key)) return;
    if (e.key === 'Tab' || e.key === 'Escape') return;
    const el = e.target instanceof Element ? e.target : null;
    const tag = el?.tagName.toLowerCase();
    const modificadores = modificadoresDe(e);
    const em = Date.now();
    if (e.key === 'Enter') {
      if (tag === 'textarea' && !modificadores.some((m) => m !== 'Shift')) return; // quebra de linha
      enviarComCaptura('TECLA', { tecla: 'Enter', modificadores, alvo: el ? descrever(el) : null, digitacaoPendente: consumirPendente('enter') }, em);
      return;
    }
    if (!modificadores.some((m) => m !== 'Shift')) return; // teclas imprimíveis nunca viram passo
    const imprimivel = e.key.length === 1 && e.key.trim() !== '';
    const funcao = /^F([1-9]|1[0-2])$/.test(e.key);
    if (!imprimivel && !funcao) return;
    enviarComCaptura('TECLA', { tecla: imprimivel ? e.key.toUpperCase() : e.key, modificadores, alvo: el ? descrever(el) : null, digitacaoPendente: consumirPendente('enter') }, em);
  }, true);

  // navegação: o que ainda espera quadro vai já; digitação pendente é confirmada por 'navegacao'
  window.addEventListener('pagehide', () => {
    if (!ativo) return;
    const d = deslocamentoSincrono();
    for (const item of [...aguardando]) despachar(item, d);
    flush('navegacao', true);
  }, true);

  // ---------------------------------------------------------------------------
  // Estado da gravação
  // ---------------------------------------------------------------------------
  function aplicarEstado(estado) {
    const antes = ativo;
    ativo = !!estado?.gravando;
    pausado = ativo && !!estado?.pausado;
    if (antes && !ativo) {
      if (pendente) clearTimeout(pendente.timer);
      pendente = null;
      aguardando.length = 0;
      mostrarBarra();
    }
    if (ehTopo) window.__sbsBarra?.atualizar({ gravando: ativo, pausado, contador: estado?.contador ?? 0 });
  }

  /** O SW decide se esta aba faz parte da gravação; se ele não responder, vale a chave do storage. */
  async function sincronizarEstado() {
    let resposta = null;
    try { resposta = await runtime.sendMessage({ tipo: 'PEDIR_ESTADO' }); } catch { resposta = null; }
    if (resposta?.ok) { aplicarEstado(resposta); return; }
    try {
      const { gravacao } = await storage.get('gravacao');
      aplicarEstado(gravacao ? { gravando: true, pausado: gravacao.status === 'pausado', contador: gravacao.contador } : null);
    } catch {
      aplicarEstado(null);
    }
  }

  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== 'session' || !mudancas.gravacao) return;
    const { oldValue, newValue } = mudancas.gravacao;
    if (!newValue) { aplicarEstado(null); return; }
    if (!oldValue) { sincronizarEstado(); return; } // gravação nova: o SW diz se esta aba participa
    if (ativo) aplicarEstado({ gravando: true, pausado: newValue.status === 'pausado', contador: newValue.contador });
  });

  window.__sbsGravador = {
    /** Usado pelo SW ao parar (executeScript): envia a digitação pendente sem esperar quadro. @returns {boolean} */
    flush: (motivo) => (ativo ? flush(motivo || 'parar', true) : false),
    /** Usados pelo SW em volta das capturas de navegação: entram na mesma contagem dos envios do gravador. */
    ocultarBarra,
    liberarBarra,
  };

  sincronizarEstado();
})();
