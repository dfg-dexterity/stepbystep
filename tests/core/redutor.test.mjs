import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarEstadoRedutor, reduzir } from '../../packages/core/redutor-eventos.js';
import { validarGuia, criarGuia } from '../../packages/core/modelo.js';
import { comum, capturaOk } from './util.mjs';

const ALVO_BOTAO = { papel: 'button', rotulo: 'Criar', fonteRotulo: 'texto', campo: null, tag: 'button', tipoInput: null, seletor: '#criar', rectCss: { x: 1270, y: 146, w: 72, h: 26 }, marcadoAntes: null, autocomplete: null, nome: null, id: 'criar' };
const ALVO_NOME = { papel: 'textbox', rotulo: 'Nome', fonteRotulo: 'label', campo: 'Nome', tag: 'input', tipoInput: 'text', seletor: '#nome', rectCss: { x: 350, y: 306, w: 400, h: 28 }, marcadoAntes: null, autocomplete: null, nome: 'nome', id: 'nome' };
const ALVO_CHECK = { papel: 'checkbox', rotulo: 'Aceito os termos', fonteRotulo: 'label', campo: null, tag: 'input', tipoInput: 'checkbox', seletor: '#aceito', rectCss: { x: 350, y: 480, w: 16, h: 16 }, marcadoAntes: false, autocomplete: null, nome: null, id: 'aceito' };

const preClique = (extra = {}) => ({ tipo: 'PRE_CLIQUE', mensagem: comum({ alvo: ALVO_BOTAO, pontoCss: { x: 1306, y: 159 }, botao: 'esquerdo', modificadores: [], digitacaoPendente: null, ...extra }), captura: capturaOk('img_m1x4k9zr02ab'), em: extra.em ?? 1000 });
const digitacaoPendente = (extra = {}) => comum({ alvo: ALVO_NOME, valor: 'ACME Ltda', sensivel: false, motivo: null, confirmadoPor: 'blur', em: 900, ...extra });

/** Aplica as ações num guia como o SW faria. */
function aplicar(guia, acoes) {
  for (const a of acoes) {
    if (a.tipo === 'criar') guia.passos.push(a.passo);
    else if (a.tipo === 'atualizar') {
      const p = guia.passos.find((x) => x.id === a.passoId);
      for (const [k, v] of Object.entries(a.campos)) {
        if (k === 'titulo') { if (p.tituloAuto) p.titulo = v; } else p[k] = v;
      }
    } else if (a.tipo === 'excluir') guia.passos = guia.passos.filter((x) => x.id !== a.passoId);
  }
  return guia;
}

test('estado inicial e imutabilidade', () => {
  const e0 = criarEstadoRedutor('https://a.b/');
  assert.equal(e0.contador, 0);
  assert.equal(e0.urlAtual, 'https://a.b/');
  assert.equal(e0.ultimoClique, null);
  assert.equal(e0.ultimoGatilho, null);
  const copia = structuredClone(e0);
  const { estado } = reduzir(e0, preClique());
  assert.deepEqual(e0, copia);
  assert.equal(estado.contador, 1);
  assert.notEqual(estado, e0);
  // serializável
  assert.deepEqual(JSON.parse(JSON.stringify(estado)), estado);
});

test('clique simples cria passo clicar com bbox convertido, título e anotações', () => {
  const { estado, acoes } = reduzir(criarEstadoRedutor(), preClique());
  assert.equal(acoes.length, 1);
  const p = acoes[0].passo;
  assert.equal(acoes[0].tipo, 'criar');
  assert.equal(p.tipo, 'clicar');
  assert.equal(p.titulo, 'Clique em «Criar»');
  assert.equal(p.tituloAuto, true);
  assert.deepEqual(p.evento, { botao: 'esquerdo', vezes: 1, modificadores: [] });
  assert.deepEqual(p.alvo.bbox, { x: 2540, y: 292, w: 144, h: 52 });
  assert.deepEqual(p.alvo.ponto, { x: 2612, y: 318 });
  assert.deepEqual(p.alvo.rectCss, ALVO_BOTAO.rectCss);
  assert.equal('marcadoAntes' in p.alvo, false);
  assert.deepEqual(p.captura, { imagemId: 'img_m1x4k9zr02ab', largura: 2880, altura: 1620, dpr: 2, viewport: { largura: 1440, altura: 810 }, escala: 2, fonte: 'pointerdown', faltante: false });
  assert.deepEqual(p.contexto, { url: 'https://app.exemplo.com/form', tituloPagina: 'Formulário', abaId: null, frameId: 0, scroll: { x: 0, y: 0 } });
  assert.deepEqual(p.anotacoes.map((a) => a.tipo), ['retangulo', 'marcador']);
  assert.deepEqual(p.anotacoes[0], { ...p.anotacoes[0], x: 2524, y: 276, w: 176, h: 84, cor: 'cerceta', auto: true });
  assert.equal(p.anotacoes[1].numero, 1);
  assert.deepEqual(estado.ultimoClique, { passoId: p.id, seletor: '#criar', url: 'https://app.exemplo.com/form', em: 1000, tipo: 'clicar' });
  assert.deepEqual(estado.ultimoGatilho, { passoId: p.id, em: 1000 });
  const guia = aplicar(criarGuia({ origem: { tipo: 'extensao' } }), acoes);
  assert.deepEqual(validarGuia(guia), { ok: true, erros: [] });
});

test('digitação pendente antes do clique vira passo digitar com a mesma imagem (compartilhada)', () => {
  const { estado, acoes } = reduzir(criarEstadoRedutor(), preClique({ digitacaoPendente: digitacaoPendente() }));
  assert.deepEqual(acoes.map((a) => a.tipo), ['criar', 'criar']);
  const [d, c] = acoes.map((a) => a.passo);
  assert.equal(d.tipo, 'digitar');
  assert.equal(d.titulo, 'Digite «ACME Ltda» no campo «Nome»');
  assert.deepEqual(d.evento, { valor: 'ACME Ltda', sensivel: false, motivo: null, confirmadoPor: 'clique' });
  assert.equal(d.captura.imagemId, 'img_m1x4k9zr02ab');
  assert.equal(d.captura.fonte, 'compartilhada');
  assert.equal(c.captura.fonte, 'pointerdown');
  assert.deepEqual(d.alvo.bbox, { x: 700, y: 612, w: 800, h: 56 });
  assert.equal(d.anotacoes.find((a) => a.tipo === 'marcador').numero, 1);
  assert.equal(c.anotacoes.find((a) => a.tipo === 'marcador').numero, 2);
  assert.equal(estado.contador, 2);
});

test('digitação sensível nunca guarda o valor e ganha desfoque', () => {
  const pendente = digitacaoPendente({ alvo: { ...ALVO_NOME, rotulo: 'Senha', campo: 'Senha', tipoInput: 'password', seletor: '#senha' }, valor: null, sensivel: true, motivo: 'input[type=password]' });
  const { acoes } = reduzir(criarEstadoRedutor(), { tipo: 'DIGITACAO', mensagem: { ...pendente, confirmadoPor: 'blur' }, captura: capturaOk('img_m1x4k9zr05ae', 'confirmacao'), em: 2000 });
  const p = acoes[0].passo;
  assert.equal(p.titulo, 'Digite sua senha no campo «Senha»');
  assert.equal(p.evento.valor, null);
  assert.equal(p.evento.sensivel, true);
  assert.equal(p.evento.confirmadoPor, 'blur');
  assert.equal(p.captura.fonte, 'confirmacao');
  assert.deepEqual(p.anotacoes.map((a) => a.tipo), ['desfoque', 'retangulo', 'marcador']);
  assert.equal(p.anotacoes[0].bloco, 16);
  // mesmo que o content script vaze o valor, o redutor descarta quando sensivel
  const vazado = reduzir(criarEstadoRedutor(), { tipo: 'DIGITACAO', mensagem: { ...pendente, valor: 'segredo', confirmadoPor: 'blur' }, captura: capturaOk(), em: 2000 });
  assert.equal(vazado.acoes[0].passo.evento.valor, null);
});

test('Enter com digitação pendente: digitar (captura própria) + tecla (compartilhada), ambos gatilho', () => {
  const entrada = { tipo: 'TECLA', mensagem: comum({ tecla: 'Enter', modificadores: [], alvo: ALVO_NOME, digitacaoPendente: digitacaoPendente() }), captura: capturaOk('img_m1x4k9zr05ae', 'confirmacao'), em: 3000 };
  const { estado, acoes } = reduzir(criarEstadoRedutor(), entrada);
  assert.deepEqual(acoes.map((a) => a.passo.tipo), ['digitar', 'tecla']);
  const [d, t] = acoes.map((a) => a.passo);
  assert.equal(d.evento.confirmadoPor, 'enter');
  assert.equal(d.captura.fonte, 'confirmacao');
  assert.equal(t.captura.imagemId, 'img_m1x4k9zr05ae');
  assert.equal(t.captura.fonte, 'compartilhada');
  assert.equal(t.titulo, 'Pressione Enter');
  assert.deepEqual(t.evento, { tecla: 'Enter', modificadores: [], atalho: 'Enter' });
  assert.equal(t.alvo, null);
  assert.deepEqual(t.anotacoes, []);
  assert.deepEqual(estado.ultimoGatilho, { passoId: t.id, em: 3000 });
  assert.equal(estado.contador, 2);
});

test('atalho de teclado vira passo tecla com atalho formatado por plataforma', () => {
  const entrada = { tipo: 'TECLA', mensagem: comum({ tecla: 's', modificadores: ['Ctrl'], alvo: null, digitacaoPendente: null }), captura: capturaOk(), em: 3000 };
  assert.equal(reduzir(criarEstadoRedutor(), entrada).acoes[0].passo.titulo, 'Pressione Ctrl+S');
  assert.equal(reduzir(criarEstadoRedutor(), entrada).acoes[0].passo.evento.atalho, 'Ctrl+S');
  assert.equal(reduzir(criarEstadoRedutor(), { ...entrada, mensagem: { ...entrada.mensagem, modificadores: ['Meta'] } }, { plataforma: 'mac' }).acoes[0].passo.titulo, 'Pressione ⌘S');
  const semCaptura = reduzir(criarEstadoRedutor(), { ...entrada, captura: null });
  assert.equal(semCaptura.acoes[0].passo.captura, null);
});

test('duplo clique < 400 ms mescla no passo anterior; > 400 ms cria outro', () => {
  let r = reduzir(criarEstadoRedutor(), preClique({ em: 1000 }));
  const primeiro = r.acoes[0].passo;
  r = reduzir(r.estado, preClique({ em: 1300 }));
  assert.equal(r.acoes.length, 1);
  assert.equal(r.acoes[0].tipo, 'atualizar');
  assert.equal(r.acoes[0].passoId, primeiro.id);
  assert.deepEqual(r.acoes[0].campos.evento, { botao: 'esquerdo', vezes: 2, modificadores: [] });
  assert.equal(r.acoes[0].campos.titulo, 'Dê dois cliques em «Criar»');
  assert.equal(r.estado.contador, 1);
  assert.equal(r.estado.ultimoGatilho.em, 1300);
  r = reduzir(r.estado, preClique({ em: 1900 }));
  assert.equal(r.acoes[0].tipo, 'criar');
  assert.equal(r.estado.contador, 2);
  // outro seletor dentro da janela não mescla
  let s = reduzir(criarEstadoRedutor(), preClique({ em: 1000 }));
  s = reduzir(s.estado, preClique({ em: 1200, alvo: { ...ALVO_BOTAO, seletor: '#outro' } }));
  assert.equal(s.acoes[0].tipo, 'criar');
});

test('clique + navegação em < 2 s preenche resultado.url; SPA também', () => {
  let r = reduzir(criarEstadoRedutor('https://app.exemplo.com/form'), preClique({ em: 1000 }));
  const clique = r.acoes[0].passo;
  r = reduzir(r.estado, { tipo: 'NAVEGACAO', url: 'https://app.exemplo.com/ok', transicao: 'link', em: 2500 });
  assert.deepEqual(r.acoes, [{ tipo: 'atualizar', passoId: clique.id, campos: { resultado: { url: 'https://app.exemplo.com/ok' } } }]);
  assert.equal(r.estado.urlAtual, 'https://app.exemplo.com/ok');
  // form_submit fora da janela ainda é atribuído ao gatilho
  r = reduzir(r.estado, { tipo: 'NAVEGACAO', url: 'https://app.exemplo.com/ok2', transicao: 'form_submit', em: 9000 });
  assert.equal(r.acoes[0].tipo, 'atualizar');
  // SPA com gatilho recente
  let s = reduzir(criarEstadoRedutor(), preClique({ em: 1000 }));
  s = reduzir(s.estado, { tipo: 'SPA', url: 'https://app.exemplo.com/#/lista', em: 1800 });
  assert.equal(s.acoes[0].tipo, 'atualizar');
  assert.deepEqual(s.acoes[0].campos, { resultado: { url: 'https://app.exemplo.com/#/lista' } });
  assert.equal(s.estado.urlAtual, 'https://app.exemplo.com/#/lista');
});

test('navegação digitada sem gatilho → capturarNavegacao → NAVEGACAO_CAPTURADA cria passo navegar', () => {
  let r = reduzir(criarEstadoRedutor(), { tipo: 'NAVEGACAO', url: 'https://fiori.empresa.com.br/ui#Shell-home', transicao: 'typed', em: 5000 });
  assert.deepEqual(r.acoes, [{ tipo: 'capturarNavegacao', url: 'https://fiori.empresa.com.br/ui#Shell-home', transicao: 'typed' }]);
  r = reduzir(r.estado, { tipo: 'NAVEGACAO_CAPTURADA', url: 'https://fiori.empresa.com.br/ui#Shell-home', transicao: 'typed', mensagem: { tituloPagina: 'Launchpad', abaId: 812, viewport: { largura: 1440, altura: 810 }, dpr: 2 }, captura: capturaOk('img_m1x4k9zr01aa', 'navegacao'), em: 5800 });
  const p = r.acoes[0].passo;
  assert.equal(p.tipo, 'navegar');
  assert.equal(p.titulo, 'Navegue para fiori.empresa.com.br/ui');
  assert.deepEqual(p.evento, { url: 'https://fiori.empresa.com.br/ui#Shell-home', transicao: 'typed' });
  assert.equal(p.captura.fonte, 'navegacao');
  assert.equal(p.captura.escala, 2);
  assert.deepEqual(p.contexto, { url: 'https://fiori.empresa.com.br/ui#Shell-home', tituloPagina: 'Launchpad', abaId: 812, frameId: 0, scroll: { x: 0, y: 0 } });
  assert.deepEqual(p.anotacoes, []);
  assert.equal(r.estado.contador, 1);
  // transição desconhecida vira 'outro'; reload e inicio ficam
  assert.equal(reduzir(criarEstadoRedutor(), { tipo: 'NAVEGACAO_CAPTURADA', url: 'https://a.b/', transicao: 'auto_subframe', captura: capturaOk(), em: 1 }).acoes[0].passo.evento.transicao, 'outro');
  assert.equal(reduzir(criarEstadoRedutor(), { tipo: 'NAVEGACAO_CAPTURADA', url: 'https://a.b/', transicao: 'inicio', captura: capturaOk(), em: 1 }).acoes[0].passo.evento.transicao, 'inicio');
  // gatilho antigo (> 2 s) também captura
  let s = reduzir(criarEstadoRedutor(), preClique({ em: 1000 }));
  s = reduzir(s.estado, { tipo: 'NAVEGACAO', url: 'https://x.y/', transicao: 'typed', em: 4000 });
  assert.equal(s.acoes[0].tipo, 'capturarNavegacao');
});

test('SPA sem gatilho só atualiza a url', () => {
  const r = reduzir(criarEstadoRedutor('https://a.b/'), { tipo: 'SPA', url: 'https://a.b/#x', em: 100 });
  assert.deepEqual(r.acoes, []);
  assert.equal(r.estado.urlAtual, 'https://a.b/#x');
});

test('reenvio da mesma mensagem (mesmo em e seletor) é descartado', () => {
  const r1 = reduzir(criarEstadoRedutor(), preClique({ em: 1000 }));
  const r2 = reduzir(r1.estado, preClique({ em: 1000 }));
  assert.deepEqual(r2.acoes, []);
  assert.deepEqual(r2.estado, r1.estado);
  const d1 = reduzir(criarEstadoRedutor(), { tipo: 'DIGITACAO', mensagem: digitacaoPendente({ em: 700 }), captura: capturaOk(), em: 700 });
  const d2 = reduzir(d1.estado, { tipo: 'DIGITACAO', mensagem: digitacaoPendente({ em: 700 }), captura: capturaOk(), em: 700 });
  assert.deepEqual(d2.acoes, []);
});

test('contador e numeração dos marcadores acompanham os passos criados', () => {
  let r = reduzir(criarEstadoRedutor(), { tipo: 'NAVEGACAO_CAPTURADA', url: 'https://a.b/', transicao: 'inicio', captura: capturaOk(), em: 1 });
  r = reduzir(r.estado, preClique({ em: 1000 }));
  r = reduzir(r.estado, { tipo: 'SELECAO', mensagem: comum({ alvo: { ...ALVO_NOME, papel: 'combobox', rotulo: 'País', campo: 'País', tag: 'select', tipoInput: null, seletor: '#pais' }, valor: 'BR', opcao: 'Brasil' }), captura: capturaOk('img_m1x4k9zr07ag', 'confirmacao'), em: 2000 });
  assert.equal(r.estado.contador, 3);
  const sel = r.acoes[0].passo;
  assert.equal(sel.tipo, 'selecionar');
  assert.equal(sel.titulo, 'Selecione «Brasil» em «País»');
  assert.deepEqual(sel.evento, { valor: 'BR', opcao: 'Brasil' });
  assert.equal(sel.captura.fonte, 'confirmacao');
  assert.equal(sel.anotacoes.find((a) => a.tipo === 'marcador').numero, 3);
});

test('checkbox/radio/switch no PRE_CLIQUE viram marcar invertendo marcadoAntes', () => {
  const r1 = reduzir(criarEstadoRedutor(), preClique({ alvo: ALVO_CHECK, pontoCss: { x: 358, y: 488 } }));
  const p1 = r1.acoes[0].passo;
  assert.equal(p1.tipo, 'marcar');
  assert.deepEqual(p1.evento, { marcado: true });
  assert.equal(p1.titulo, 'Marque «Aceito os termos»');
  assert.deepEqual(p1.alvo.bbox, { x: 700, y: 960, w: 32, h: 32 });
  const r2 = reduzir(criarEstadoRedutor(), preClique({ alvo: { ...ALVO_CHECK, marcadoAntes: true } }));
  assert.deepEqual(r2.acoes[0].passo.evento, { marcado: false });
  assert.equal(r2.acoes[0].passo.titulo, 'Desmarque «Aceito os termos»');
  const r3 = reduzir(criarEstadoRedutor(), preClique({ alvo: { ...ALVO_CHECK, papel: 'radio', marcadoAntes: true, rotulo: 'PJ' } }));
  assert.deepEqual(r3.acoes[0].passo.evento, { marcado: true });
  assert.equal(r3.acoes[0].passo.titulo, 'Selecione «PJ»');
  // segundo clique rápido no checkbox não é "duplo clique": cria outro passo (desmarca)
  const r4 = reduzir(r1.estado, preClique({ alvo: { ...ALVO_CHECK, marcadoAntes: true }, em: 1200 }));
  assert.equal(r4.acoes[0].tipo, 'criar');
  assert.deepEqual(r4.acoes[0].passo.evento, { marcado: false });
  // MARCACAO por teclado
  const r5 = reduzir(criarEstadoRedutor(), { tipo: 'MARCACAO', mensagem: comum({ alvo: ALVO_CHECK, marcado: true }), captura: capturaOk(), em: 10 });
  assert.equal(r5.acoes[0].passo.tipo, 'marcar');
  assert.deepEqual(r5.acoes[0].passo.evento, { marcado: true });
});

test('captura faltante: passo salvo sem imagem, sem bbox e sem anotações', () => {
  const { acoes } = reduzir(criarEstadoRedutor(), { ...preClique(), captura: { imagemId: null, faltante: true, motivo: 'Tabs cannot be edited right now' } });
  const p = acoes[0].passo;
  assert.equal(p.captura.faltante, true);
  assert.equal(p.captura.imagemId, null);
  assert.equal(p.captura.motivo, 'Tabs cannot be edited right now');
  assert.deepEqual(p.captura.viewport, { largura: 1440, altura: 810 });
  assert.equal(p.alvo.bbox, null);
  assert.deepEqual(p.alvo.rectCss, ALVO_BOTAO.rectCss);
  assert.deepEqual(p.anotacoes, []);
  const guia = aplicar(criarGuia({ origem: { tipo: 'extensao' } }), acoes);
  assert.deepEqual(validarGuia(guia), { ok: true, erros: [] });
});

test('rectCss null (iframe sem resposta) gera passo sem marcador', () => {
  const { acoes } = reduzir(criarEstadoRedutor(), preClique({ alvo: { ...ALVO_BOTAO, rectCss: null }, pontoCss: null }));
  const p = acoes[0].passo;
  assert.equal(p.alvo.bbox, null);
  assert.equal(p.alvo.ponto, null);
  assert.deepEqual(p.anotacoes, []);
});

test('sequência completa produz um guia válido', () => {
  const guia = criarGuia({ titulo: 'Formulário', origem: { tipo: 'extensao', versao: '0.1.0', plataforma: 'Chrome' } });
  let estado = criarEstadoRedutor();
  const passos = [
    { tipo: 'NAVEGACAO_CAPTURADA', url: 'https://app.exemplo.com/form', transicao: 'inicio', mensagem: { tituloPagina: 'Formulário', viewport: { largura: 1440, altura: 810 }, dpr: 2 }, captura: capturaOk('img_m1x4k9zr01aa', 'navegacao'), em: 0 },
    preClique({ em: 1000, digitacaoPendente: digitacaoPendente() }),
    { tipo: 'TECLA', mensagem: comum({ tecla: 'Enter', modificadores: [], alvo: ALVO_NOME, digitacaoPendente: null, em: 1500 }), captura: capturaOk('img_m1x4k9zr05ae'), em: 1500 },
    { tipo: 'NAVEGACAO', url: 'https://app.exemplo.com/ok', transicao: 'form_submit', em: 1700 },
    { tipo: 'PASSO_MANUAL', mensagem: { titulo: 'Confira o e-mail' }, em: 9000 },
  ];
  for (const entrada of passos) {
    const r = reduzir(estado, entrada);
    estado = r.estado;
    aplicar(guia, r.acoes);
  }
  assert.deepEqual(guia.passos.map((p) => p.tipo), ['navegar', 'digitar', 'clicar', 'tecla', 'manual']);
  assert.equal(guia.passos[3].resultado.url, 'https://app.exemplo.com/ok');
  assert.equal(guia.passos[4].titulo, 'Confira o e-mail');
  assert.equal(guia.passos[4].tituloAuto, false);
  assert.deepEqual(validarGuia(guia), { ok: true, erros: [] });
  assert.equal(estado.contador, 5);
});
