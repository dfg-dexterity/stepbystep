// Frases pt-BR dos passos (tabela normativa 3.6 da especificação).
// Alvo sempre entre «»; rótulos normalizados (espaços colapsados, ≤ 60 caracteres com …).

const LIMITE_ROTULO = 60;
const LIMITE_VALOR = 40;
const LIMITE_URL = 60;

// Modificadores canônicos na ordem de exibição; entradas sinônimas do navegador/Mac.
const ORDEM_MODIFICADORES = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const SINONIMOS_MODIFICADOR = {
  ctrl: 'Ctrl', control: 'Ctrl', '⌃': 'Ctrl',
  alt: 'Alt', option: 'Alt', opt: 'Alt', '⌥': 'Alt',
  shift: 'Shift', '⇧': 'Shift',
  meta: 'Meta', cmd: 'Meta', command: 'Meta', os: 'Meta', super: 'Meta', win: 'Meta', '⌘': 'Meta',
};
const SIMBOLOS_MAC = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
const NOMES_TECLA = {
  escape: 'Esc', esc: 'Esc', ' ': 'Espaço', space: 'Espaço', spacebar: 'Espaço', return: 'Enter', enter: 'Enter',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', del: 'Delete', delete: 'Delete', backspace: 'Backspace',
  tab: 'Tab', pageup: 'Page Up', pagedown: 'Page Down', home: 'Home', end: 'End', insert: 'Insert',
};

const normalizarEspacos = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();

/** @returns {string} texto normalizado (espaços colapsados) cortado em max-1 + '…' */
export function truncar(texto, max) {
  const t = normalizarEspacos(texto);
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  return chars.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

/** Rótulo pronto para a frase: sem quebras, sem ":" ou "*" finais de formulário, ≤ 60 chars. '' quando não há. */
function rotulo(texto) {
  let t = normalizarEspacos(texto);
  t = t.replace(/^[«"“]+|[»"”]+$/g, '');   // evita «« »» quando o rótulo já vem entre aspas
  t = t.replace(/[\s:*]+$/g, '');           // "Nome:" / "Nome *" → "Nome"
  return truncar(t, LIMITE_ROTULO);
}

/** @returns {string} host+caminho sem protocolo, www., query e fragmento; ≤ 60 chars */
export function abreviarUrl(url) {
  let u = normalizarEspacos(url);
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  u = u.replace(/^www\./i, '');
  u = u.replace(/[?#].*$/s, '');
  try { u = decodeURI(u); } catch { /* mantém codificado se inválido */ }
  u = u.replace(/\/+$/, '');
  const chars = Array.from(u);
  if (chars.length > LIMITE_URL) u = chars.slice(0, 57).join('') + '…';
  return u;
}

function normalizarModificadores(modificadores) {
  const achados = new Set();
  for (const m of modificadores ?? []) {
    const canon = SINONIMOS_MODIFICADOR[String(m).trim().toLowerCase()];
    if (canon) achados.add(canon);
  }
  return ORDEM_MODIFICADORES.filter((m) => achados.has(m));
}

function nomeTecla(tecla) {
  const bruto = String(tecla ?? '').trim() || String(tecla ?? '');
  if (bruto === '') return '';
  const conhecido = NOMES_TECLA[bruto.toLowerCase()];
  if (conhecido) return conhecido;
  if (Array.from(bruto).length === 1) return bruto.toUpperCase();
  if (/^f\d{1,2}$/i.test(bruto)) return bruto.toUpperCase();
  return bruto[0].toUpperCase() + bruto.slice(1);
}

/** @param {string} tecla @param {string[]} modificadores @param {'mac'|'outro'} plataforma @returns {string} */
export function formatarAtalho(tecla, modificadores, plataforma) {
  const mods = normalizarModificadores(modificadores);
  const t = nomeTecla(tecla);
  if (mods.length === 0) return t;
  if (plataforma === 'mac') return mods.map((m) => SIMBOLOS_MAC[m]).join('') + t;
  return [...mods.map((m) => (m === 'Meta' ? 'Win' : m)), t].filter(Boolean).join('+');
}

/** Contexto Mac (app/bundleId) indica plataforma mac quando o chamador não informa. */
function detectarPlataforma(passo) {
  const c = passo.contexto;
  if (c && (typeof c.bundleId === 'string' || typeof c.app === 'string') && c.url === undefined) return 'mac';
  return 'outro';
}

// "sem rótulo": complemento por papel
const semRotulo = (papel) => (papel === 'button' ? 'no botão' : papel === 'link' ? 'no link' : 'aqui');

function tituloNavegar(passo, evento) {
  if (typeof evento.app === 'string' && rotulo(evento.app)) return `Abra o app «${rotulo(evento.app)}»`;
  const url = evento.url ?? passo.contexto?.url;
  if (typeof url === 'string' && abreviarUrl(url)) return `Navegue para ${abreviarUrl(url)}`;
  return 'Navegue para a página';
}

function tituloClicar(alvo, evento) {
  const papel = alvo.papel ?? 'generic';
  const r = rotulo(alvo.rotulo);
  const menu = rotulo(alvo.menu);
  if (papel === 'menuitem' && menu) return `Escolha o menu «${menu}»`;
  if (evento.botao === 'direito') return r ? `Clique com o botão direito em «${r}»` : `Clique com o botão direito ${semRotulo(papel)}`;
  if (evento.botao === 'meio') return r ? `Clique com o botão do meio em «${r}»` : `Clique com o botão do meio ${semRotulo(papel)}`;
  if (evento.vezes === 2) return r ? `Dê dois cliques em «${r}»` : `Dê dois cliques ${semRotulo(papel)}`;
  switch (papel) {
    case 'link': return r ? `Clique no link «${r}»` : 'Clique no link';
    case 'tab': return r ? `Abra a aba «${r}»` : 'Abra a aba';
    case 'option': return r ? `Selecione «${r}»` : 'Selecione a opção';
    case 'textbox': case 'combobox': {
      const campo = rotulo(alvo.campo) || r;
      return campo ? `Clique no campo «${campo}»` : 'Clique no campo';
    }
    default: return r ? `Clique em «${r}»` : `Clique ${semRotulo(papel)}`;
  }
}

function ehSenha(alvo, evento) {
  if (alvo.tipoInput === 'password') return true;
  if (alvo.papelNativo === 'AXSecureTextField') return true;
  return /senha|password|AXSecureTextField/i.test(String(evento.motivo ?? ''));
}

function tituloDigitar(alvo, evento) {
  const campo = rotulo(alvo.campo) || rotulo(alvo.rotulo);
  if (evento.sensivel) {
    if (ehSenha(alvo, evento)) return campo ? `Digite sua senha no campo «${campo}»` : 'Digite sua senha';
    return campo ? `Preencha o campo «${campo}»` : 'Preencha o campo';
  }
  const valor = evento.valor == null ? '' : truncar(String(evento.valor), LIMITE_VALOR);
  if (!valor) return campo ? `Preencha o campo «${campo}»` : 'Preencha o campo';
  return campo ? `Digite «${valor}» no campo «${campo}»` : `Digite «${valor}»`;
}

function tituloSelecionar(alvo, evento) {
  const opcao = rotulo(evento.opcao) || rotulo(evento.valor);
  const campo = rotulo(alvo.campo) || rotulo(alvo.rotulo);
  if (!opcao) return campo ? `Selecione uma opção em «${campo}»` : 'Selecione uma opção';
  return campo ? `Selecione «${opcao}» em «${campo}»` : `Selecione «${opcao}»`;
}

function tituloMarcar(alvo, evento) {
  const r = rotulo(alvo.rotulo) || rotulo(alvo.campo);
  if (alvo.papel === 'radio') return r ? `Selecione «${r}»` : 'Selecione a opção';
  if (evento.marcado === false) return r ? `Desmarque «${r}»` : 'Desmarque a opção';
  return r ? `Marque «${r}»` : 'Marque a opção';
}

/** @param {object} passo @param {{plataforma?:'mac'|'outro'}} [opcoes] @returns {string} conforme a tabela 3.6 */
export function gerarTitulo(passo, opcoes = {}) {
  if (!passo || typeof passo !== 'object') return '';
  const plataforma = opcoes.plataforma ?? detectarPlataforma(passo);
  const alvo = passo.alvo ?? {};
  const evento = passo.evento ?? {};
  switch (passo.tipo) {
    case 'navegar': return tituloNavegar(passo, evento);
    case 'clicar': return tituloClicar(alvo, evento);
    case 'digitar': return tituloDigitar(alvo, evento);
    case 'selecionar': return tituloSelecionar(alvo, evento);
    case 'marcar': return tituloMarcar(alvo, evento);
    case 'tecla': {
      const atalho = formatarAtalho(evento.tecla, evento.modificadores, plataforma);
      return atalho ? `Pressione ${atalho}` : 'Pressione a tecla';
    }
    case 'secao':
    case 'manual':
    default:
      return typeof passo.titulo === 'string' ? passo.titulo : '';
  }
}
