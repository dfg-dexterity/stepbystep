// Formato do guia (JSON v1): constantes, construtores, validação e migração.
// Tudo o que atravessa pacotes (extensão, Mac, editor) passa por aqui.
import { gerarId, validarId } from './ids.js';

export const FORMATO = 'stepbystep/guia';
export const VERSAO = 1;
export const TIPOS_PASSO = ['navegar', 'clicar', 'digitar', 'selecionar', 'marcar', 'tecla', 'secao', 'manual'];
export const TIPOS_ANOTACAO = ['recorte', 'desfoque', 'retangulo', 'seta', 'marcador', 'texto'];
export const PAPEIS = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'generic'];
export const CORES = { cerceta: '#009994', cercetaClaro: '#00B3AC', ambar: '#FFA436', roxo: '#98569A', base: '#1B1B1B', off: '#F7F3E7', branco: '#FFFFFF' };

// Tokens de cor aceitos nas anotações (resolvidos por CORES no render).
export const TOKENS_COR = ['cerceta', 'ambar', 'roxo', 'base', 'off'];
export const ESTADOS_GUIA = ['gravando', 'interrompido', 'concluido'];
export const ORIGENS = ['extensao', 'mac', 'manual'];
export const FONTES_CAPTURA = ['pointerdown', 'confirmacao', 'navegacao', 'compartilhada', 'manual'];

const agoraIso = () => new Date().toISOString();

/**
 * @param {{titulo?:string, descricao?:string, origem?:{tipo:'extensao'|'mac'|'manual', versao?:string, plataforma?:string}, autor?:string}} o
 * @returns {object} guia válido, vazio, estado 'gravando' se origem.tipo !== 'manual' senão 'concluido'
 */
export function criarGuia(o = {}) {
  const tipoOrigem = o.origem?.tipo ?? 'manual';
  if (!ORIGENS.includes(tipoOrigem)) throw new Error(`Origem inválida: ${tipoOrigem}`);
  const agora = agoraIso();
  return {
    formato: FORMATO,
    versao: VERSAO,
    id: gerarId('g'),
    titulo: o.titulo ?? '',
    descricao: o.descricao ?? '',
    idioma: 'pt-BR',
    autor: o.autor ?? '',
    criadoEm: agora,
    atualizadoEm: agora,
    origem: { tipo: tipoOrigem, versao: o.origem?.versao ?? null, plataforma: o.origem?.plataforma ?? null },
    estilo: { cor: 'cerceta', escurecerFora: true },
    estado: tipoOrigem === 'manual' ? 'concluido' : 'gravando',
    publicacoes: [],
    passos: [],
  };
}

/**
 * @param {{tipo:string, titulo?:string, tituloAuto?:boolean, descricao?:string, contexto?:object|null, evento?:object|null, alvo?:object|null, captura?:object|null, resultado?:object|null, anotacoes?:object[]}} o
 * @returns {object} passo com id 'p_…', criadoEm agora; titulo '' e tituloAuto true por padrão
 */
export function criarPasso(o) {
  if (!o || !TIPOS_PASSO.includes(o.tipo)) throw new Error(`Tipo de passo inválido: ${o?.tipo}`);
  return {
    id: gerarId('p'),
    tipo: o.tipo,
    titulo: o.titulo ?? '',
    tituloAuto: o.tituloAuto ?? true,
    descricao: o.descricao ?? '',
    criadoEm: agoraIso(),
    contexto: o.contexto ?? null,
    evento: o.evento ?? null,
    alvo: o.alvo ?? null,
    captura: o.captura ?? null,
    resultado: o.resultado ?? null,
    anotacoes: Array.isArray(o.anotacoes) ? o.anotacoes.map((a) => ({ ...a })) : [],
  };
}

/** @param {string} tipo @param {object} props @returns {object} anotação com id 'a_…', auto false por padrão, cor 'cerceta' por padrão */
export function criarAnotacao(tipo, props = {}) {
  if (!TIPOS_ANOTACAO.includes(tipo)) throw new Error(`Tipo de anotação inválido: ${tipo}`);
  const base = { id: gerarId('a'), tipo, auto: props.auto ?? false };
  const cor = props.cor ?? 'cerceta';
  switch (tipo) {
    case 'recorte':
      return { ...base, x: props.x ?? 0, y: props.y ?? 0, w: props.w ?? 0, h: props.h ?? 0 };
    case 'desfoque':
      return { ...base, x: props.x ?? 0, y: props.y ?? 0, w: props.w ?? 0, h: props.h ?? 0, bloco: props.bloco ?? 8 };
    case 'retangulo':
      return { ...base, x: props.x ?? 0, y: props.y ?? 0, w: props.w ?? 0, h: props.h ?? 0, cor };
    case 'seta':
      return { ...base, de: { x: props.de?.x ?? 0, y: props.de?.y ?? 0 }, para: { x: props.para?.x ?? 0, y: props.para?.y ?? 0 }, cor };
    case 'marcador':
      return { ...base, x: props.x ?? 0, y: props.y ?? 0, numero: props.numero ?? 1, cor };
    case 'texto':
      return { ...base, x: props.x ?? 0, y: props.y ?? 0, texto: props.texto ?? '', tamanho: props.tamanho ?? 16, cor, fundo: props.fundo ?? null };
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const ehNaoNegativo = (v) => ehNumero(v) && v >= 0;

/**
 * Valida estrutura, tipos, ids únicos, no máximo um recorte por passo, coordenadas numéricas ≥ 0, captura.faltante ⇒ imagemId null.
 * @returns {{ok:boolean, erros:string[]}} mensagens em pt-BR com caminho
 */
export function validarGuia(obj) {
  const erros = [];
  const erro = (caminho, msg) => erros.push(`${caminho} ${msg}`);
  if (!ehObjeto(obj)) return { ok: false, erros: ['guia deve ser um objeto'] };

  if (obj.formato !== FORMATO) erro('formato', `desconhecido (esperado "${FORMATO}")`);
  if (!Number.isInteger(obj.versao) || obj.versao < 1) erro('versao', 'deve ser um inteiro ≥ 1');
  else if (obj.versao > VERSAO) erro('versao', `${obj.versao} não é suportada (máximo ${VERSAO})`);
  if (erros.length) return { ok: false, erros };

  const ids = new Map();
  const registrarId = (caminho, id, prefixo) => {
    if (!validarId(id)) { erro(caminho, 'deve ser um id válido'); return; }
    if (prefixo && !id.startsWith(prefixo + '_')) erro(caminho, `deve começar com "${prefixo}_"`);
    if (ids.has(id)) erro(caminho, `repete o id "${id}" de ${ids.get(id)}`);
    else ids.set(id, caminho);
  };

  registrarId('id', obj.id, 'g');
  if (typeof obj.titulo !== 'string') erro('titulo', 'deve ser texto');
  if (obj.descricao !== undefined && typeof obj.descricao !== 'string') erro('descricao', 'deve ser texto');
  if (obj.criadoEm !== undefined && typeof obj.criadoEm !== 'string') erro('criadoEm', 'deve ser data ISO 8601');
  if (obj.atualizadoEm !== undefined && typeof obj.atualizadoEm !== 'string') erro('atualizadoEm', 'deve ser data ISO 8601');
  if (!ehObjeto(obj.origem) || !ORIGENS.includes(obj.origem.tipo)) erro('origem.tipo', `deve ser um de ${ORIGENS.join(', ')}`);
  if (obj.estilo !== undefined) {
    if (!ehObjeto(obj.estilo)) erro('estilo', 'deve ser um objeto');
    else {
      if (!TOKENS_COR.includes(obj.estilo.cor)) erro('estilo.cor', `deve ser um token de cor (${TOKENS_COR.join(', ')})`);
      if (typeof obj.estilo.escurecerFora !== 'boolean') erro('estilo.escurecerFora', 'deve ser booleano');
    }
  }
  if (!ESTADOS_GUIA.includes(obj.estado)) erro('estado', `deve ser um de ${ESTADOS_GUIA.join(', ')}`);
  if (obj.publicacoes !== undefined && !Array.isArray(obj.publicacoes)) erro('publicacoes', 'deve ser uma lista');

  if (!Array.isArray(obj.passos)) { erro('passos', 'deve ser uma lista'); return { ok: false, erros }; }
  obj.passos.forEach((p, i) => validarPasso(p, `passos[${i}]`, erro, registrarId));

  if (obj.imagens !== undefined && obj.imagens !== null) {
    if (!ehObjeto(obj.imagens)) erro('imagens', 'deve ser um mapa imagemId → {arquivo, largura, altura, mime}');
    else {
      for (const [id, info] of Object.entries(obj.imagens)) {
        const c = `imagens.${id}`;
        if (!validarId(id) || !id.startsWith('img_')) erro(c, 'chave deve ser um id "img_…"');
        if (!ehObjeto(info)) { erro(c, 'deve ser um objeto'); continue; }
        if (typeof info.arquivo !== 'string' || !info.arquivo) erro(`${c}.arquivo`, 'deve ser um caminho');
        if (!(ehNumero(info.largura) && info.largura > 0)) erro(`${c}.largura`, 'deve ser > 0');
        if (!(ehNumero(info.altura) && info.altura > 0)) erro(`${c}.altura`, 'deve ser > 0');
        if (typeof info.mime !== 'string') erro(`${c}.mime`, 'deve ser texto');
      }
    }
  }
  return { ok: erros.length === 0, erros };
}

function validarRect(rect, caminho, erro, { permitirNulo = true } = {}) {
  if (rect === null || rect === undefined) { if (!permitirNulo) erro(caminho, 'é obrigatório'); return; }
  if (!ehObjeto(rect)) { erro(caminho, 'deve ser {x,y,w,h}'); return; }
  for (const k of ['x', 'y', 'w', 'h']) if (!ehNaoNegativo(rect[k])) erro(`${caminho}.${k}`, 'deve ser número ≥ 0');
}

function validarPonto(p, caminho, erro) {
  if (p === null || p === undefined) return;
  if (!ehObjeto(p)) { erro(caminho, 'deve ser {x,y}'); return; }
  for (const k of ['x', 'y']) if (!ehNaoNegativo(p[k])) erro(`${caminho}.${k}`, 'deve ser número ≥ 0');
}

function validarPasso(p, c, erro, registrarId) {
  if (!ehObjeto(p)) { erro(c, 'deve ser um objeto'); return; }
  registrarId(`${c}.id`, p.id, 'p');
  if (!TIPOS_PASSO.includes(p.tipo)) erro(`${c}.tipo`, `deve ser um de ${TIPOS_PASSO.join(', ')}`);
  if (typeof p.titulo !== 'string') erro(`${c}.titulo`, 'deve ser texto');
  if (typeof p.tituloAuto !== 'boolean') erro(`${c}.tituloAuto`, 'deve ser booleano');
  if (p.descricao !== undefined && typeof p.descricao !== 'string') erro(`${c}.descricao`, 'deve ser texto');
  if (p.contexto !== null && p.contexto !== undefined && !ehObjeto(p.contexto)) erro(`${c}.contexto`, 'deve ser objeto ou null');
  if (p.evento !== null && p.evento !== undefined && !ehObjeto(p.evento)) erro(`${c}.evento`, 'deve ser objeto ou null');
  if (p.resultado !== null && p.resultado !== undefined && !ehObjeto(p.resultado)) erro(`${c}.resultado`, 'deve ser objeto ou null');

  // alvo
  if (p.alvo !== null && p.alvo !== undefined) {
    if (!ehObjeto(p.alvo)) erro(`${c}.alvo`, 'deve ser objeto ou null');
    else {
      if (p.alvo.papel !== undefined && p.alvo.papel !== null && !PAPEIS.includes(p.alvo.papel)) erro(`${c}.alvo.papel`, `deve ser um de ${PAPEIS.join(', ')}`);
      validarRect(p.alvo.bbox, `${c}.alvo.bbox`, erro);
      validarPonto(p.alvo.ponto, `${c}.alvo.ponto`, erro);
      validarRect(p.alvo.janelaBbox, `${c}.alvo.janelaBbox`, erro);
      if (p.alvo.rectCss !== null && p.alvo.rectCss !== undefined) {
        if (!ehObjeto(p.alvo.rectCss)) erro(`${c}.alvo.rectCss`, 'deve ser {x,y,w,h} ou null');
        else for (const k of ['x', 'y', 'w', 'h']) if (!ehNumero(p.alvo.rectCss[k])) erro(`${c}.alvo.rectCss.${k}`, 'deve ser número');
      }
    }
  }

  // captura
  if (p.captura !== null && p.captura !== undefined) {
    const cap = p.captura, cc = `${c}.captura`;
    if (!ehObjeto(cap)) erro(cc, 'deve ser objeto ou null');
    else {
      if (cap.faltante === true) {
        if (cap.imagemId !== null && cap.imagemId !== undefined) erro(`${cc}.imagemId`, 'deve ser null quando faltante');
      } else {
        if (!validarId(cap.imagemId) || !cap.imagemId.startsWith('img_')) erro(`${cc}.imagemId`, 'deve ser um id "img_…"');
        if (!(ehNumero(cap.largura) && cap.largura > 0)) erro(`${cc}.largura`, 'deve ser > 0');
        if (!(ehNumero(cap.altura) && cap.altura > 0)) erro(`${cc}.altura`, 'deve ser > 0');
        if (cap.escala !== undefined && cap.escala !== null && !(ehNumero(cap.escala) && cap.escala > 0)) erro(`${cc}.escala`, 'deve ser > 0');
      }
      if (cap.fonte !== undefined && cap.fonte !== null && !FONTES_CAPTURA.includes(cap.fonte)) erro(`${cc}.fonte`, `deve ser um de ${FONTES_CAPTURA.join(', ')}`);
      if (cap.viewport !== undefined && cap.viewport !== null) {
        if (!ehObjeto(cap.viewport) || !ehNumero(cap.viewport.largura) || !ehNumero(cap.viewport.altura)) erro(`${cc}.viewport`, 'deve ser {largura, altura}');
      }
    }
  }

  // anotações
  if (!Array.isArray(p.anotacoes)) { erro(`${c}.anotacoes`, 'deve ser uma lista'); return; }
  let recortes = 0;
  p.anotacoes.forEach((a, j) => {
    const ca = `${c}.anotacoes[${j}]`;
    if (!ehObjeto(a)) { erro(ca, 'deve ser um objeto'); return; }
    registrarId(`${ca}.id`, a.id, 'a');
    if (!TIPOS_ANOTACAO.includes(a.tipo)) { erro(`${ca}.tipo`, `deve ser um de ${TIPOS_ANOTACAO.join(', ')}`); return; }
    if (typeof a.auto !== 'boolean') erro(`${ca}.auto`, 'deve ser booleano');
    const cor = (campo) => { if (!TOKENS_COR.includes(a[campo])) erro(`${ca}.${campo}`, `deve ser um token de cor (${TOKENS_COR.join(', ')})`); };
    switch (a.tipo) {
      case 'recorte':
        recortes++;
        validarRect(a, ca, erro, { permitirNulo: false });
        break;
      case 'desfoque':
        validarRect(a, ca, erro, { permitirNulo: false });
        if (!(ehNumero(a.bloco) && a.bloco > 0)) erro(`${ca}.bloco`, 'deve ser > 0');
        break;
      case 'retangulo':
        validarRect(a, ca, erro, { permitirNulo: false });
        cor('cor');
        break;
      case 'seta':
        if (!ehObjeto(a.de)) erro(`${ca}.de`, 'deve ser {x,y}'); else validarPonto(a.de, `${ca}.de`, erro);
        if (!ehObjeto(a.para)) erro(`${ca}.para`, 'deve ser {x,y}'); else validarPonto(a.para, `${ca}.para`, erro);
        cor('cor');
        break;
      case 'marcador':
        if (!ehNaoNegativo(a.x)) erro(`${ca}.x`, 'deve ser número ≥ 0');
        if (!ehNaoNegativo(a.y)) erro(`${ca}.y`, 'deve ser número ≥ 0');
        if (!(Number.isInteger(a.numero) && a.numero >= 1)) erro(`${ca}.numero`, 'deve ser inteiro ≥ 1');
        cor('cor');
        break;
      case 'texto':
        if (!ehNaoNegativo(a.x)) erro(`${ca}.x`, 'deve ser número ≥ 0');
        if (!ehNaoNegativo(a.y)) erro(`${ca}.y`, 'deve ser número ≥ 0');
        if (typeof a.texto !== 'string') erro(`${ca}.texto`, 'deve ser texto');
        if (!(ehNumero(a.tamanho) && a.tamanho > 0)) erro(`${ca}.tamanho`, 'deve ser > 0');
        cor('cor');
        if (a.fundo !== null && a.fundo !== undefined && !TOKENS_COR.includes(a.fundo)) erro(`${ca}.fundo`, 'deve ser um token de cor ou null');
        break;
    }
  });
  if (recortes > 1) erro(`${c}.anotacoes`, 'deve ter no máximo um recorte');
}

// ---------------------------------------------------------------------------
// Migração e utilidades
// ---------------------------------------------------------------------------
/** Sobe versões antigas para VERSAO; lança Error('Formato desconhecido') se formato ≠ FORMATO; idempotente. @returns {object} novo objeto */
export function migrarGuia(obj) {
  if (!ehObjeto(obj) || obj.formato !== FORMATO) throw new Error('Formato desconhecido');
  const versao = Number.isInteger(obj.versao) ? obj.versao : 1;
  if (versao > VERSAO) throw new Error(`Versão ${versao} não é suportada (máximo ${VERSAO})`);
  const guia = structuredClone(obj);
  // v1 é a primeira versão: não há migrações; só se completam campos opcionais ausentes.
  guia.versao = VERSAO;
  guia.descricao ??= '';
  guia.idioma ??= 'pt-BR';
  guia.autor ??= '';
  guia.estilo ??= { cor: 'cerceta', escurecerFora: true };
  guia.publicacoes ??= [];
  guia.passos ??= [];
  for (const p of guia.passos) {
    if (!ehObjeto(p)) continue;
    p.titulo ??= '';
    p.tituloAuto ??= p.titulo === '';
    p.descricao ??= '';
    p.contexto ??= null; p.evento ??= null; p.alvo ??= null; p.captura ??= null; p.resultado ??= null;
    p.anotacoes ??= [];
  }
  return guia;
}

/** structuredClone sem o campo imagens. */
export function clonarGuia(guia) {
  const { imagens, ...resto } = guia;
  return structuredClone(resto);
}

/** Número exibido (1..n) ignorando passos 'secao'; devolve null para secao. */
export function numeroDoPasso(guia, indice) {
  const passos = guia.passos ?? [];
  if (indice < 0 || indice >= passos.length || passos[indice].tipo === 'secao') return null;
  let n = 0;
  for (let i = 0; i <= indice; i++) if (passos[i].tipo !== 'secao') n++;
  return n;
}

/** Renumera marcadores auto: numero = numeroDoPasso(guia, indice). Muta e devolve o guia. */
export function renumerarMarcadores(guia) {
  guia.passos.forEach((p, i) => {
    const n = numeroDoPasso(guia, i);
    if (n === null) return;
    for (const a of p.anotacoes ?? []) if (a.tipo === 'marcador' && a.auto) a.numero = n;
  });
  return guia;
}
