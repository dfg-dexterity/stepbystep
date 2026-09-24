// Diálogo modal sem framework, sobre .dxt-modal do dexterity.css (sombra removida em app.css).
// Devolve uma Promise resolvida com o `valor` do botão clicado (null ao fechar por Esc/fora).
// Diálogos podem se empilhar (ex.: Importar → «Guia já existe»): só o do topo trata o teclado.

let abertos = 0;
const pilha = []; // fundos dos diálogos abertos, do mais antigo ao do topo

/**
 * @param {{titulo?:string, conteudo?:Node|string, botoes?:{rotulo:string, valor?:any, primario?:boolean, perigo?:boolean, fechar?:boolean}[],
 *          fechavel?:boolean, largura?:number, classe?:string, aoAbrir?:(caixa:HTMLElement)=>void,
 *          antesDeFechar?:(valor:any)=>boolean|Promise<boolean>}} opcoes
 *   antesDeFechar: consultado quando o USUÁRIO fecha (Esc, ×, clique fora, botões do rodapé); devolver false mantém
 *   o diálogo aberto. `fechar(valor)` programático não passa por ele.
 * @returns {{promessa:Promise<any>, fechar:(valor?:any)=>void, elemento:HTMLElement, caixa:HTMLElement}}
 */
export function abrirDialogo(opcoes = {}) {
  const { titulo = '', conteudo = null, fechavel = true, largura = 580, classe = '', antesDeFechar = null } = opcoes;
  const botoes = opcoes.botoes ?? [{ rotulo: 'Fechar', valor: null }];
  const focoAnterior = document.activeElement;

  const fundo = document.createElement('div');
  fundo.className = `dxt-modal dialogo ${classe}`.trim();
  const caixa = document.createElement('div');
  caixa.className = 'dxt-modal-box dialogo-caixa';
  caixa.style.maxWidth = `${largura}px`;
  caixa.setAttribute('role', 'dialog');
  caixa.setAttribute('aria-modal', 'true');
  fundo.append(caixa);

  if (titulo) {
    const h = document.createElement('h2');
    h.className = 'dialogo-titulo';
    h.id = `dialogo-titulo-${++abertos}`;
    h.textContent = titulo;
    caixa.setAttribute('aria-labelledby', h.id);
    caixa.append(h);
  }
  const corpo = document.createElement('div');
  corpo.className = 'dialogo-corpo';
  if (typeof conteudo === 'string') corpo.textContent = conteudo;
  else if (conteudo) corpo.append(conteudo);
  caixa.append(corpo);

  let resolver;
  const promessa = new Promise((r) => { resolver = r; });
  let fechado = false;
  const fechar = (valor = null) => {
    if (fechado) return;
    fechado = true;
    document.removeEventListener('keydown', aoTeclar, true);
    const i = pilha.indexOf(fundo);
    if (i >= 0) pilha.splice(i, 1);
    fundo.remove();
    if (focoAnterior && typeof focoAnterior.focus === 'function' && focoAnterior.isConnected) focoAnterior.focus();
    resolver(valor);
  };
  let consultando = false;
  const fecharPeloUsuario = async (valor = null) => {
    if (fechado || consultando) return;
    if (antesDeFechar) {
      consultando = true;
      let pode = false;
      try { pode = await antesDeFechar(valor); } finally { consultando = false; }
      if (!pode) return;
    }
    fechar(valor);
  };

  if (botoes.length) {
    const rodape = document.createElement('div');
    rodape.className = 'dialogo-botoes';
    for (const b of botoes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `dxt-btn${b.primario ? '' : ' dxt-btn--ghost'}${b.perigo ? ' dxt-btn--perigo' : ''}`;
      btn.textContent = b.rotulo;
      btn.addEventListener('click', () => { fecharPeloUsuario(b.valor); });
      rodape.append(btn);
    }
    caixa.append(rodape);
  }

  if (fechavel) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'dialogo-fechar';
    x.setAttribute('aria-label', 'Fechar');
    x.textContent = '×';
    x.addEventListener('click', () => { fecharPeloUsuario(null); });
    caixa.append(x);
    fundo.addEventListener('pointerdown', (e) => { if (e.target === fundo) fecharPeloUsuario(null); });
  }

  // foco preso dentro do diálogo; Esc fecha quando permitido. Só o diálogo do topo da pilha trata o teclado:
  // os listeners de captura em `document` rodam na ordem de registro e stopPropagation não cala os irmãos.
  const focaveis = () => [...caixa.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  function aoTeclar(e) {
    if (pilha.at(-1) !== fundo) return;
    if (e.key === 'Escape' && fechavel) { e.preventDefault(); e.stopPropagation(); fecharPeloUsuario(null); return; }
    if (e.key === 'Tab') {
      const lista = focaveis();
      if (!lista.length) { e.preventDefault(); return; }
      const primeiro = lista[0], ultimo = lista[lista.length - 1];
      if (!caixa.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? ultimo : primeiro).focus(); }
      else if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
    // atalhos globais do editor não devem agir por trás do diálogo
    e.stopPropagation();
  }
  document.addEventListener('keydown', aoTeclar, true);
  pilha.push(fundo);

  document.body.append(fundo);
  opcoes.aoAbrir?.(caixa);
  const alvoFoco = caixa.querySelector('[autofocus]') ?? focaveis().find((el) => !el.classList.contains('dialogo-fechar'));
  alvoFoco?.focus();

  return { promessa, fechar, elemento: fundo, caixa };
}

/** Confirmação simples. @returns {Promise<boolean>} */
export function confirmar(mensagem, { titulo = 'Confirmar', ok = 'Confirmar', cancelar = 'Cancelar', perigo = false } = {}) {
  const p = document.createElement('p');
  p.className = 'dialogo-mensagem';
  p.textContent = mensagem;
  return abrirDialogo({
    titulo,
    conteudo: p,
    botoes: [{ rotulo: cancelar, valor: false }, { rotulo: ok, valor: true, primario: true, perigo }],
  }).promessa.then((v) => v === true);
}

/** Pergunta um texto curto. @returns {Promise<string|null>} null se cancelado */
export function perguntar(mensagem, { titulo = '', valor = '', rotulo = 'OK', placeholder = '' } = {}) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.className = 'dxt-label dialogo-rotulo';
  label.textContent = mensagem;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dxt-input dialogo-input';
  input.value = valor;
  input.placeholder = placeholder;
  input.setAttribute('autofocus', '');
  label.append(input);
  wrap.append(label);
  const d = abrirDialogo({ titulo, conteudo: wrap, botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo, valor: 'ok', primario: true }] });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); d.fechar('ok'); } });
  return d.promessa.then((v) => (v === 'ok' ? input.value.trim() : null));
}
