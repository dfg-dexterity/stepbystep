// Menu suspenso (popover) ancorado a um botão: navegação por setas, Esc e clique fora fecham.
// Com o menu aberto o teclado é dele: a tecla anunciada num item (`atalho`) executa o item e as demais
// não chegam aos atalhos globais do editor (Delete apagaria a anotação selecionada, não o passo).

let menuAberto = null;

const TECLAS = { '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', Del: 'Delete', Esc: 'Escape' };

/** «Alt+↓», «F2», «Delete», «Ctrl+D» casam com o keydown? (⌘/Cmd/Ctrl valem como ctrlKey ou metaKey) */
export function atalhoCasa(atalho, e) {
  const partes = String(atalho ?? '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return false;
  const tecla = partes.pop();
  const mods = new Set(partes.map((p) => p.toLowerCase()));
  const controle = mods.has('ctrl') || mods.has('⌘') || mods.has('cmd');
  if (mods.has('alt') !== !!e.altKey || mods.has('shift') !== !!e.shiftKey || controle !== !!(e.ctrlKey || e.metaKey)) return false;
  return (TECLAS[tecla] ?? tecla).toLowerCase() === String(e.key).toLowerCase();
}

/**
 * @param {HTMLElement} ancora
 * @param {{rotulo?:string, atalho?:string, acao?:Function, desabilitado?:boolean, perigo?:boolean, separador?:boolean, marcado?:boolean}[]} itens
 * @param {{alinhar?:'esquerda'|'direita'}} [opcoes]
 * @returns {{fechar:Function, elemento:HTMLElement}}
 */
export function abrirMenu(ancora, itens, opcoes = {}) {
  menuAberto?.fechar();

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');

  for (const item of itens) {
    if (item.separador) {
      const hr = document.createElement('div');
      hr.className = 'menu-separador';
      hr.setAttribute('role', 'separator');
      menu.append(hr);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `menu-item${item.perigo ? ' menu-item--perigo' : ''}`;
    b.setAttribute('role', 'menuitem');
    if (item.marcado !== undefined) b.setAttribute('aria-checked', String(!!item.marcado));
    b.disabled = !!item.desabilitado;
    const rotulo = document.createElement('span');
    rotulo.textContent = (item.marcado ? '✓ ' : '') + item.rotulo;
    b.append(rotulo);
    if (item.atalho) {
      const kbd = document.createElement('kbd');
      kbd.textContent = item.atalho;
      b.append(kbd);
    }
    b.addEventListener('click', () => { fechar(); item.acao?.(); });
    menu.append(b);
  }

  const fechar = () => {
    if (!menu.isConnected) return;
    menu.remove();
    document.removeEventListener('pointerdown', aoClicarFora, true);
    document.removeEventListener('keydown', aoTeclar, true);
    window.removeEventListener('resize', fechar);
    ancora.setAttribute('aria-expanded', 'false');
    if (menuAberto?.elemento === menu) menuAberto = null;
  };
  const aoClicarFora = (e) => { if (!menu.contains(e.target) && e.target !== ancora && !ancora.contains(e.target)) fechar(); };
  const itensFocaveis = () => [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  const aoTeclar = (e) => {
    // a tecla anunciada num item (Delete, F2, Alt+↓…) executa o item — antes das setas, que sem Alt só navegam
    const item = itens.find((it) => !it.separador && !it.desabilitado && it.atalho && atalhoCasa(it.atalho, e));
    if (item) { e.preventDefault(); e.stopPropagation(); fechar(); item.acao?.(); return; }
    const lista = itensFocaveis();
    const i = lista.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); ancora.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); lista[(i + 1) % lista.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); lista[(i - 1 + lista.length) % lista.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); lista[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); lista[lista.length - 1]?.focus(); }
    else if (e.key === 'Tab') { fechar(); }
    else if (e.key !== 'Enter' && e.key !== ' ') { e.stopPropagation(); }   // Enter/Espaço ativam o item focado; o resto não sai do menu
  };

  document.body.append(menu);
  // posição fixa abaixo da âncora; vira para cima/esquerda quando não cabe
  const r = ancora.getBoundingClientRect();
  const largura = menu.offsetWidth, altura = menu.offsetHeight;
  let x = opcoes.alinhar === 'direita' ? r.right - largura : r.left;
  let y = r.bottom + 4;
  if (x + largura > window.innerWidth - 8) x = window.innerWidth - largura - 8;
  if (x < 8) x = 8;
  if (y + altura > window.innerHeight - 8) y = Math.max(8, r.top - altura - 4);
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;

  ancora.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', aoClicarFora, true);
  document.addEventListener('keydown', aoTeclar, true);
  window.addEventListener('resize', fechar);
  itensFocaveis()[0]?.focus();

  menuAberto = { fechar, elemento: menu };
  return menuAberto;
}

export function fecharMenus() { menuAberto?.fechar(); }
