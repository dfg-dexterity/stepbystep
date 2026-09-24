// Máquina de estados pura e serializável: mensagens do gravador (com captura já resolvida pelo SW)
// → ações sobre o guia. O SW aplica as ações na ordem; o Mac segue as mesmas regras em Swift.
import { criarPasso } from './modelo.js';
import { gerarTitulo } from './frases.js';
import { cssParaImagem, pontoParaImagem } from './coordenadas.js';
import { anotacoesAutomaticas } from './anotacoes.js';

const JANELA_DUPLO_CLIQUE = 400;   // ms entre dois cliques no mesmo alvo
const JANELA_GATILHO = 2000;       // ms entre clique/Enter e a navegação que ele disparou
const PAPEIS_MARCAR = new Set(['checkbox', 'radio', 'switch']);
const TRANSICOES_GATILHO = new Set(['link', 'form_submit']);

/** @returns {{contador:number, urlAtual:string|null, ultimoClique:object|null, ultimoGatilho:object|null, ultimaEntrada:object|null}} */
export function criarEstadoRedutor(urlInicial = null) {
  return { contador: 0, urlAtual: urlInicial, ultimoClique: null, ultimoGatilho: null, ultimaEntrada: null };
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

/** Cria o passo completo (título, anotações) e incrementa o contador. */
function novoPasso(estado, o, opcoes) {
  estado.contador += 1;
  const passo = criarPasso({ ...o, tituloAuto: true });
  passo.titulo = gerarTitulo(passo, opcoes);
  passo.anotacoes = anotacoesAutomaticas(passo, { numero: estado.contador });
  return passo;
}

function passoDigitar(estado, payload, captura, confirmadoPor, opcoes) {
  const cap = montarCaptura(captura, payload, captura?.fonte === 'compartilhada' ? 'compartilhada' : 'confirmacao');
  return novoPasso(estado, {
    tipo: 'digitar',
    contexto: montarContexto(payload),
    evento: { valor: payload.sensivel ? null : payload.valor ?? null, sensivel: payload.sensivel === true, motivo: payload.motivo ?? null, confirmadoPor },
    alvo: montarAlvo(payload.alvo, payload, cap, null),
    captura: cap,
  }, opcoes);
}

const mesmoSeletor = (a, b) => (a ?? null) === (b ?? null);

/**
 * @param {object} estado @param {{tipo:string, mensagem?:object, captura?:object|null, url?:string, transicao?:string, em:number}} entrada
 * @param {{plataforma?:'mac'|'outro'}} [opcoes]
 * @returns {{estado:object, acoes:object[]}} nunca muta `estado`
 */
export function reduzir(estado, entrada, opcoes = {}) {
  const s = structuredClone(estado ?? criarEstadoRedutor());
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
      const gatilhoRecente = s.ultimoGatilho && em - s.ultimoGatilho.em < JANELA_GATILHO;
      if (s.ultimoGatilho && (gatilhoRecente || TRANSICOES_GATILHO.has(transicao))) {
        acoes.push({ tipo: 'atualizar', passoId: s.ultimoGatilho.passoId, campos: { resultado: { url } } });
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
