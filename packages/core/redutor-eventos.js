// Máquina de estados pura e serializável: mensagens do gravador (com captura já resolvida pelo SW)
// → ações sobre o guia. O SW aplica as ações na ordem; o Mac segue as mesmas regras em Swift.
import { criarPasso } from './modelo.js';
import { gerarTitulo } from './frases.js';
import { gerarId } from './ids.js';
import { cssParaImagem, pontoParaImagem } from './coordenadas.js';
import { anotacoesAutomaticas } from './anotacoes.js';

const JANELA_DUPLO_CLIQUE = 400;          // ms entre dois cliques no mesmo alvo
const JANELA_GATILHO = 2000;              // ms entre clique/Enter e a navegação que ele disparou
const JANELA_GATILHO_TRANSICAO = 30000;   // ms para link/form_submit (POST lento, redirecionamento no servidor)
const PAPEIS_MARCAR = new Set(['checkbox', 'radio', 'switch']);
const TRANSICOES_GATILHO = new Set(['link', 'form_submit']);

/**
 * `sensiveis`: regiões (CSS px do viewport + scroll do frame) dos campos sensíveis já digitados, por url da página;
 * todo passo seguinte fotografado na mesma url recebe um `desfoque` auto sobre cada uma (o valor continua no campo).
 * @typedef {{url:string, frameId:number, seletor:string|null, rectCss:{x:number,y:number,w:number,h:number}, scroll:{x:number,y:number}}} RegiaoSensivel
 * @returns {{contador:number, urlAtual:string|null, ultimoClique:object|null, ultimoGatilho:object|null, ultimaEntrada:object|null, sensiveis:RegiaoSensivel[]}}
 */
export function criarEstadoRedutor(urlInicial = null) {
  return { contador: 0, urlAtual: urlInicial, ultimoClique: null, ultimoGatilho: null, ultimaEntrada: null, sensiveis: [] };
}

function mapearTransicao(t) {
  if (t === 'inicio' || t === 'reload') return t;
  if (t === 'typed' || t === 'generated' || t === 'keyword' || t === 'auto_bookmark') return 'typed';
  return 'outro';
}

function montarContexto(mensagem) {
  if (!mensagem) return null;
  return {
    url: mensagem.url ?? null,
    tituloPagina: mensagem.tituloPagina ?? '',
    abaId: mensagem.abaId ?? null,
    frameId: mensagem.frameId ?? 0,
    scroll: { x: mensagem.scroll?.x ?? 0, y: mensagem.scroll?.y ?? 0 },
  };
}

/** Captura do passo a partir do resultado de sw/captura.js e do viewport da mensagem. */
function montarCaptura(captura, mensagem, fonte) {
  if (!captura) return null;
  const viewport = mensagem?.viewport ? { largura: mensagem.viewport.largura, altura: mensagem.viewport.altura } : null;
  const dpr = mensagem?.dpr ?? null;
  if (captura.faltante || !captura.imagemId) {
    return { imagemId: null, largura: null, altura: null, dpr, viewport, escala: null, fonte: fonte ?? captura.fonte ?? 'pointerdown', faltante: true, motivo: captura.motivo ?? null };
  }
  const escala = viewport?.largura > 0 ? captura.largura / viewport.largura : 1;
  return { imagemId: captura.imagemId, largura: captura.largura, altura: captura.altura, dpr, viewport, escala, fonte: fonte ?? captura.fonte ?? 'pointerdown', faltante: false };
}

/** Alvo do passo: descritor do content script + bbox/ponto convertidos para px da imagem. */
function montarAlvo(descritor, mensagem, captura, pontoCss) {
  if (!descritor) return null;
  const imagem = captura && !captura.faltante ? { largura: captura.largura, altura: captura.altura } : null;
  const viewport = mensagem?.viewport ?? null;
  const podeConverter = imagem && viewport?.largura > 0;
  return {
    papel: descritor.papel ?? 'generic',
    papelNativo: descritor.papelNativo ?? null,
    rotulo: descritor.rotulo ?? null,
    fonteRotulo: descritor.fonteRotulo ?? 'nenhum',
    campo: descritor.campo ?? null,
    tag: descritor.tag ?? null,
    tipoInput: descritor.tipoInput ?? null,
    seletor: descritor.seletor ?? null,
    rectCss: descritor.rectCss ?? null,
    bbox: podeConverter && descritor.rectCss ? cssParaImagem(descritor.rectCss, viewport, imagem) : null,
    ponto: podeConverter && pontoCss ? pontoParaImagem(pontoCss, viewport, imagem) : null,
    frame: { id: mensagem?.frameId ?? 0, url: mensagem?.frameUrl ?? null },
    menu: descritor.menu ?? null,
    janelaBbox: descritor.janelaBbox ?? null,
  };
}

const mesmoSeletor = (a, b) => (a ?? null) === (b ?? null);
const rectValido = (r) => r && typeof r === 'object' && r.w > 0 && r.h > 0;
const rectIgual = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

// ---------------------------------------------------------------------------
// Campos sensíveis: o valor fica visível no campo depois da digitação, então a pixelização
// precisa acompanhar todas as fotos seguintes da mesma página (inclusive a compartilhada com o clique).
// ---------------------------------------------------------------------------
/** @returns {RegiaoSensivel|null} região do campo do passo (null sem url ou sem rectCss) */
function regiaoDoPasso(passo) {
  const rectCss = passo.alvo?.rectCss;
  const url = passo.contexto?.url ?? null;
  if (!url || !rectValido(rectCss)) return null;
  return {
    url,
    frameId: passo.contexto?.frameId ?? 0,
    seletor: passo.alvo?.seletor ?? null,
    rectCss: { x: rectCss.x, y: rectCss.y, w: rectCss.w, h: rectCss.h },
    scroll: { x: passo.contexto?.scroll?.x ?? 0, y: passo.contexto?.scroll?.y ?? 0 },
  };
}

/** Mesmo campo: mesma página e frame, mesmo seletor (ou mesmo rect quando não há seletor). */
function mesmaRegiao(a, b) {
  if (a.url !== b.url || a.frameId !== b.frameId) return false;
  return a.seletor !== null && b.seletor !== null ? a.seletor === b.seletor : rectIgual(a.rectCss, b.rectCss);
}

/** Registra (ou substitui) a região do campo sensível do passo `digitar`. */
function registrarSensivel(estado, passo) {
  const r = regiaoDoPasso(passo);
  if (!r) return;
  estado.sensiveis = [...estado.sensiveis.filter((x) => !mesmaRegiao(x, r)), r];
}

/** Desfoques auto das regiões sensíveis da mesma url, convertidos para px desta captura. @returns {object[]} */
function desfoquesSensiveis(estado, passo) {
  const captura = passo.captura;
  const url = passo.contexto?.url ?? null;
  if (!url || !estado.sensiveis.length) return [];
  if (!captura || captura.faltante || !(captura.largura > 0) || !(captura.altura > 0) || !(captura.viewport?.largura > 0)) return [];
  const imagem = { largura: captura.largura, altura: captura.altura };
  const e = captura.escala > 0 ? captura.escala : 1;
  const frameId = passo.contexto?.frameId ?? 0;
  const scroll = { x: passo.contexto?.scroll?.x ?? 0, y: passo.contexto?.scroll?.y ?? 0 };
  // o próprio campo sensível já recebe o desfoque de anotacoesAutomaticas (quando tem bbox)
  const propria = passo.evento?.sensivel === true && rectValido(passo.alvo?.bbox) ? regiaoDoPasso(passo) : null;
  const lista = [];
  for (const r of estado.sensiveis) {
    if (r.url !== url) continue;
    if (propria && mesmaRegiao(r, propria)) continue;
    // rectCss já vem somado ao topo; o scroll é do frame que enviou, então só é comparável dentro do mesmo frame
    const dx = r.frameId === frameId ? r.scroll.x - scroll.x : 0;
    const dy = r.frameId === frameId ? r.scroll.y - scroll.y : 0;
    const bbox = cssParaImagem({ x: r.rectCss.x + dx, y: r.rectCss.y + dy, w: r.rectCss.w, h: r.rectCss.h }, captura.viewport, imagem);
    if (!(bbox.w > 0 && bbox.h > 0)) continue; // rolou para fora da foto
    lista.push({ id: gerarId('a'), tipo: 'desfoque', auto: true, x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, bloco: 8 * e });
  }
  return lista;
}

/** Cria o passo completo (título, anotações) e incrementa o contador. */
function novoPasso(estado, o, opcoes) {
  estado.contador += 1;
  const passo = criarPasso({ ...o, tituloAuto: true });
  passo.titulo = gerarTitulo(passo, opcoes);
  const autos = anotacoesAutomaticas(passo, { numero: estado.contador });
  const sensiveis = desfoquesSensiveis(estado, passo);
  // desfoques antes do retângulo/marcador, como em anotacoesAutomaticas
  const i = autos.findIndex((a) => a.tipo === 'retangulo');
  passo.anotacoes = i < 0 ? [...autos, ...sensiveis] : [...autos.slice(0, i), ...sensiveis, ...autos.slice(i)];
  return passo;
}

function passoDigitar(estado, payload, captura, confirmadoPor, opcoes) {
  const cap = montarCaptura(captura, payload, captura?.fonte === 'compartilhada' ? 'compartilhada' : 'confirmacao');
  const passo = novoPasso(estado, {
    tipo: 'digitar',
    contexto: montarContexto(payload),
    evento: { valor: payload.sensivel ? null : payload.valor ?? null, sensivel: payload.sensivel === true, motivo: payload.motivo ?? null, confirmadoPor },
    alvo: montarAlvo(payload.alvo, payload, cap, null),
    captura: cap,
  }, opcoes);
  if (passo.evento.sensivel) registrarSensivel(estado, passo);
  return passo;
}

/**
 * @param {object} estado @param {{tipo:string, mensagem?:object, captura?:object|null, url?:string, transicao?:string, em:number}} entrada
 * @param {{plataforma?:'mac'|'outro'}} [opcoes]
 * @returns {{estado:object, acoes:object[]}} nunca muta `estado`
 */
export function reduzir(estado, entrada, opcoes = {}) {
  const s = structuredClone(estado ?? criarEstadoRedutor());
  if (!Array.isArray(s.sensiveis)) s.sensiveis = []; // estado gravado por versão anterior
  const acoes = [];
  const em = entrada.em ?? Date.now();
  const mensagem = entrada.mensagem ?? {};

  // reenvio do content script após falha do SW: mesma entrada (tipo + em + seletor) é descartada
  const seletor = mensagem.alvo?.seletor ?? null;
  if (s.ultimaEntrada && s.ultimaEntrada.tipo === entrada.tipo && s.ultimaEntrada.em === em && mesmoSeletor(s.ultimaEntrada.seletor, seletor)) {
    return { estado: s, acoes };
  }
  s.ultimaEntrada = { tipo: entrada.tipo, em, seletor };

  switch (entrada.tipo) {
    case 'PRE_CLIQUE': {
      const captura = entrada.captura ?? null;
      if (mensagem.digitacaoPendente) {
        const p = passoDigitar(s, mensagem.digitacaoPendente, captura ? { ...captura, fonte: 'compartilhada' } : null, 'clique', opcoes);
        acoes.push({ tipo: 'criar', passo: p });
      }
      const alvo = mensagem.alvo ?? {};
      const url = mensagem.url ?? s.urlAtual;
      const duplo = s.ultimoClique && s.ultimoClique.tipo === 'clicar' && mesmoSeletor(s.ultimoClique.seletor, alvo.seletor)
        && s.ultimoClique.url === url && em - s.ultimoClique.em < JANELA_DUPLO_CLIQUE && !PAPEIS_MARCAR.has(alvo.papel);
      if (duplo) {
        const evento = { botao: mensagem.botao ?? 'esquerdo', vezes: 2, modificadores: mensagem.modificadores ?? [] };
        const titulo = gerarTitulo({ tipo: 'clicar', alvo, evento }, opcoes);
        // titulo só deve ser aplicado se o passo ainda tiver tituloAuto (sempre verdadeiro durante a gravação)
        acoes.push({ tipo: 'atualizar', passoId: s.ultimoClique.passoId, campos: { evento, titulo } });
        s.ultimoClique = { ...s.ultimoClique, em };
        s.ultimoGatilho = { passoId: s.ultimoClique.passoId, em };
        break;
      }
      const cap = montarCaptura(captura, mensagem, captura?.fonte);
      const ehMarcar = PAPEIS_MARCAR.has(alvo.papel);
      const evento = ehMarcar
        ? { marcado: alvo.papel === 'radio' ? true : !(alvo.marcadoAntes === true) }
        : { botao: mensagem.botao ?? 'esquerdo', vezes: 1, modificadores: mensagem.modificadores ?? [] };
      const passo = novoPasso(s, {
        tipo: ehMarcar ? 'marcar' : 'clicar',
        contexto: montarContexto(mensagem),
        evento,
        alvo: montarAlvo(alvo, mensagem, cap, mensagem.pontoCss ?? null),
        captura: cap,
      }, opcoes);
      acoes.push({ tipo: 'criar', passo });
      s.ultimoClique = { passoId: passo.id, seletor: alvo.seletor ?? null, url, em, tipo: passo.tipo };
      s.ultimoGatilho = { passoId: passo.id, em };
      break;
    }

    case 'DIGITACAO': {
      const p = passoDigitar(s, mensagem, entrada.captura ?? null, mensagem.confirmadoPor ?? 'blur', opcoes);
      acoes.push({ tipo: 'criar', passo: p });
      break;
    }

    case 'SELECAO': {
      const cap = montarCaptura(entrada.captura ?? null, mensagem, 'confirmacao');
      const passo = novoPasso(s, {
        tipo: 'selecionar',
        contexto: montarContexto(mensagem),
        evento: { valor: mensagem.valor ?? null, opcao: mensagem.opcao ?? null },
        alvo: montarAlvo(mensagem.alvo, mensagem, cap, null),
        captura: cap,
      }, opcoes);
      acoes.push({ tipo: 'criar', passo });
      break;
    }

    case 'MARCACAO': {
      const cap = montarCaptura(entrada.captura ?? null, mensagem, entrada.captura?.fonte ?? 'pointerdown');
      const passo = novoPasso(s, {
        tipo: 'marcar',
        contexto: montarContexto(mensagem),
        evento: { marcado: mensagem.marcado === true },
        alvo: montarAlvo(mensagem.alvo, mensagem, cap, null),
        captura: cap,
      }, opcoes);
      acoes.push({ tipo: 'criar', passo });
      break;
    }

    case 'TECLA': {
      const captura = entrada.captura ?? null;
      let capturaTecla = captura;
      if (mensagem.digitacaoPendente) {
        const p = passoDigitar(s, mensagem.digitacaoPendente, captura, 'enter', opcoes);
        acoes.push({ tipo: 'criar', passo: p });
        if (captura && !captura.faltante) capturaTecla = { ...captura, fonte: 'compartilhada' };
      }
      const cap = montarCaptura(capturaTecla, mensagem, capturaTecla?.fonte ?? 'pointerdown');
      const modificadores = mensagem.modificadores ?? [];
      const passo = novoPasso(s, {
        tipo: 'tecla',
        contexto: montarContexto(mensagem),
        evento: { tecla: mensagem.tecla, modificadores, atalho: null },
        alvo: null,
        captura: cap,
      }, opcoes);
      passo.evento.atalho = passo.titulo.replace(/^Pressione /, '');
      acoes.push({ tipo: 'criar', passo });
      s.ultimoGatilho = { passoId: passo.id, em };
      break;
    }

    case 'NAVEGACAO': {
      const url = entrada.url ?? mensagem.url ?? null;
      const transicao = entrada.transicao ?? mensagem.transicao ?? 'outro';
      const idade = s.ultimoGatilho ? em - s.ultimoGatilho.em : Infinity;
      // link/form_submit ganham uma janela maior (o Chrome também usa `link` para location.href por script),
      // mas finita; o gatilho é consumido: a próxima navegação, mesmo por link, ganha passo `navegar` próprio.
      if (idade < JANELA_GATILHO || (idade < JANELA_GATILHO_TRANSICAO && TRANSICOES_GATILHO.has(transicao))) {
        acoes.push({ tipo: 'atualizar', passoId: s.ultimoGatilho.passoId, campos: { resultado: { url } } });
        s.ultimoGatilho = null;
      } else {
        acoes.push({ tipo: 'capturarNavegacao', url, transicao });
      }
      s.urlAtual = url;
      break;
    }

    case 'NAVEGACAO_CAPTURADA': {
      const url = entrada.url ?? mensagem.url ?? null;
      const cap = montarCaptura(entrada.captura ?? null, mensagem, 'navegacao');
      const passo = novoPasso(s, {
        tipo: 'navegar',
        contexto: { url, tituloPagina: mensagem.tituloPagina ?? '', abaId: mensagem.abaId ?? null, frameId: 0, scroll: { x: 0, y: 0 } },
        evento: { url, transicao: mapearTransicao(entrada.transicao ?? mensagem.transicao) },
        alvo: null,
        captura: cap,
      }, opcoes);
      acoes.push({ tipo: 'criar', passo });
      s.urlAtual = url;
      break;
    }

    case 'SPA': {
      const url = entrada.url ?? mensagem.url ?? null;
      if (s.ultimoGatilho && em - s.ultimoGatilho.em < JANELA_GATILHO) {
        acoes.push({ tipo: 'atualizar', passoId: s.ultimoGatilho.passoId, campos: { resultado: { url } } });
      }
      s.urlAtual = url;
      break;
    }

    case 'PASSO_MANUAL': {
      // conveniência para o SW: "+ Passo manual" da barra
      const passo = novoPasso(s, { tipo: 'manual', titulo: mensagem.titulo ?? '' }, opcoes);
      passo.tituloAuto = false;
      acoes.push({ tipo: 'criar', passo });
      break;
    }

    default:
      break;
  }
  return { estado: s, acoes };
}
