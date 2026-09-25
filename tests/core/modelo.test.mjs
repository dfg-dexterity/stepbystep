import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATO, VERSAO, TIPOS_PASSO, TIPOS_ANOTACAO, PAPEIS, CORES,
  criarGuia, criarPasso, criarAnotacao, validarGuia, migrarGuia, clonarGuia, renumerarMarcadores, numeroDoPasso,
  criarNota, notasDoPasso, zoomDoPasso, resumoDoGuia, TIPOS_NOTA, SEGUNDOS_POR_TIPO,
} from '../../packages/core/modelo.js';
import { validarId } from '../../packages/core/ids.js';
import { lerFixture } from './util.mjs';

const exemplo = () => lerFixture('guia-exemplo');
const mac = () => lerFixture('guia-mac');

test('constantes do formato', () => {
  assert.equal(FORMATO, 'stepbystep/guia');
  assert.equal(VERSAO, 1);
  assert.deepEqual(TIPOS_PASSO, ['navegar', 'clicar', 'digitar', 'selecionar', 'marcar', 'tecla', 'secao', 'manual']);
  assert.deepEqual(TIPOS_ANOTACAO, ['recorte', 'desfoque', 'retangulo', 'seta', 'marcador', 'texto']);
  assert.equal(PAPEIS.length, 11);
  assert.deepEqual(CORES, { cerceta: '#009994', cercetaClaro: '#00B3AC', ambar: '#FFA436', roxo: '#98569A', base: '#1B1B1B', off: '#F7F3E7', branco: '#FFFFFF' });
});

test('criarGuia gera guia válido e vazio', () => {
  const g = criarGuia({ titulo: 'Teste', origem: { tipo: 'extensao', versao: '0.1.0', plataforma: 'Chrome' }, autor: 'Diego' });
  assert.equal(validarGuia(g).ok, true);
  assert.ok(validarId(g.id) && g.id.startsWith('g_'));
  assert.equal(g.estado, 'gravando');
  assert.deepEqual(g.passos, []);
  assert.deepEqual(g.publicacoes, []);
  assert.equal(g.idioma, 'pt-BR');
  assert.equal(criarGuia().estado, 'concluido');
  assert.equal(criarGuia({ origem: { tipo: 'manual' } }).estado, 'concluido');
  assert.equal(criarGuia({ origem: { tipo: 'mac' } }).estado, 'gravando');
  assert.throws(() => criarGuia({ origem: { tipo: 'outro' } }), /Origem inválida/);
});

test('criarPasso gera passo válido com padrões', () => {
  const p = criarPasso({ tipo: 'manual' });
  assert.ok(validarId(p.id) && p.id.startsWith('p_'));
  assert.equal(p.titulo, '');
  assert.equal(p.tituloAuto, true);
  assert.equal(p.descricao, '');
  assert.equal(p.contexto, null);
  assert.deepEqual(p.anotacoes, []);
  assert.deepEqual(p.notas, []);
  assert.equal('zoom' in p, false);                   // sem override: herda do guia
  assert.equal(criarPasso({ tipo: 'clicar', zoom: 'tela' }).zoom, 'tela');
  assert.equal('zoom' in criarPasso({ tipo: 'clicar', zoom: 'zoom' }), false);
  assert.ok(!Number.isNaN(Date.parse(p.criadoEm)));
  const g = criarGuia();
  g.passos.push(p, criarPasso({ tipo: 'secao', titulo: 'Seção', tituloAuto: false }));
  assert.deepEqual(validarGuia(g), { ok: true, erros: [] });
  assert.throws(() => criarPasso({ tipo: 'clique' }), /Tipo de passo inválido/);
});

test('criarAnotacao gera anotação válida com padrões', () => {
  const r = criarAnotacao('retangulo', { x: 1, y: 2, w: 3, h: 4 });
  assert.ok(r.id.startsWith('a_'));
  assert.equal(r.auto, false);
  assert.equal(r.cor, 'cerceta');
  const m = criarAnotacao('marcador', { x: 10, y: 10, numero: 3, cor: 'ambar', auto: true });
  assert.equal(m.numero, 3);
  assert.equal(m.cor, 'ambar');
  assert.equal(m.auto, true);
  const t = criarAnotacao('texto', { x: 0, y: 0, texto: 'Oi', tamanho: 32 });
  assert.equal(t.fundo, null);
  const d = criarAnotacao('desfoque', { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(d.bloco, 8);
  const g = criarGuia();
  g.passos.push(criarPasso({ tipo: 'manual', anotacoes: [r, m, t, d, criarAnotacao('seta', { de: { x: 0, y: 0 }, para: { x: 5, y: 5 } }), criarAnotacao('recorte', { x: 0, y: 0, w: 1, h: 1 })] }));
  assert.deepEqual(validarGuia(g), { ok: true, erros: [] });
  assert.throws(() => criarAnotacao('circulo', {}), /Tipo de anotação inválido/);
});

test('validarGuia aceita os dois fixtures', () => {
  assert.deepEqual(validarGuia(exemplo()), { ok: true, erros: [] });
  assert.deepEqual(validarGuia(mac()), { ok: true, erros: [] });
});

test('validarGuia rejeita formato e versão desconhecidos', () => {
  const g1 = { ...exemplo(), formato: 'outro/guia' };
  const r1 = validarGuia(g1);
  assert.equal(r1.ok, false);
  assert.match(r1.erros[0], /^formato /);
  const g2 = { ...exemplo(), versao: 2 };
  const r2 = validarGuia(g2);
  assert.equal(r2.ok, false);
  assert.match(r2.erros[0], /^versao /);
  assert.equal(validarGuia(null).ok, false);
  assert.equal(validarGuia('x').ok, false);
});

test('validarGuia rejeita tipo de passo e de anotação inválidos', () => {
  const g = exemplo();
  g.passos[1].tipo = 'clique';
  g.passos[1].anotacoes[0].tipo = 'circulo';
  const r = validarGuia(g);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => e.startsWith('passos[1].tipo ')));
  assert.ok(r.erros.some((e) => e.startsWith('passos[1].anotacoes[0].tipo ')));
});

test('validarGuia rejeita dois recortes no mesmo passo', () => {
  const g = exemplo();
  g.passos[2].anotacoes.push({ id: 'a_m1x4k9zr03a9', tipo: 'recorte', auto: false, x: 0, y: 0, w: 10, h: 10 });
  const r = validarGuia(g);
  assert.equal(r.ok, false);
  assert.ok(r.erros.includes('passos[2].anotacoes deve ter no máximo um recorte'));
});

test('validarGuia rejeita ids duplicados', () => {
  const g = exemplo();
  g.passos[3].id = g.passos[1].id;
  const r = validarGuia(g);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => e.startsWith('passos[3].id ') && e.includes('repete')));
  const g2 = exemplo();
  g2.passos[1].anotacoes[1].id = g2.passos[1].anotacoes[0].id;
  assert.equal(validarGuia(g2).ok, false);
});

test('validarGuia rejeita coordenadas negativas e bloco zero', () => {
  const g = exemplo();
  g.passos[1].anotacoes[0].x = -1;
  g.passos[1].alvo.bbox.w = -5;
  g.passos[3].anotacoes[0].bloco = 0;
  const r = validarGuia(g);
  assert.equal(r.ok, false);
  assert.ok(r.erros.includes('passos[1].anotacoes[0].x deve ser número ≥ 0'));
  assert.ok(r.erros.includes('passos[1].alvo.bbox.w deve ser número ≥ 0'));
  assert.ok(r.erros.includes('passos[3].anotacoes[0].bloco deve ser > 0'));
});

test('validarGuia: faltante exige imagemId null; não faltante exige imagem', () => {
  const g = exemplo();
  g.passos[1].captura.faltante = true;
  let r = validarGuia(g);
  assert.equal(r.ok, false);
  assert.ok(r.erros.includes('passos[1].captura.imagemId deve ser null quando faltante'));
  g.passos[1].captura.imagemId = null;
  assert.equal(validarGuia(g).ok, true);
  const g2 = exemplo();
  g2.passos[1].captura.imagemId = null;
  r = validarGuia(g2);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => e.startsWith('passos[1].captura.imagemId ')));
});

test('validarGuia rejeita cor fora dos tokens e estado desconhecido', () => {
  const g = exemplo();
  g.passos[1].anotacoes[0].cor = '#009994';
  g.estado = 'pausado';
  const r = validarGuia(g);
  assert.ok(r.erros.some((e) => e.startsWith('passos[1].anotacoes[0].cor ')));
  assert.ok(r.erros.some((e) => e.startsWith('estado ')));
});

test('migrarGuia é idempotente e recusa formato desconhecido', () => {
  const g = exemplo();
  const m1 = migrarGuia(g);
  const m2 = migrarGuia(m1);
  assert.deepEqual(m1, g);
  assert.deepEqual(m2, m1);
  assert.notEqual(m1, g);
  assert.throws(() => migrarGuia({ formato: 'x', versao: 1 }), /Formato desconhecido/);
  assert.throws(() => migrarGuia(null), /Formato desconhecido/);
  assert.throws(() => migrarGuia({ formato: FORMATO, versao: 99 }), /não é suportada/);
  // completa campos opcionais ausentes
  const minimo = migrarGuia({ formato: FORMATO, versao: 1, id: 'g_m1x4k9zq7a2b', titulo: 'x', origem: { tipo: 'manual' }, estado: 'concluido', passos: [{ id: 'p_m1x4k9zr01aa', tipo: 'manual', titulo: 'a' }] });
  assert.deepEqual(minimo.publicacoes, []);
  assert.equal(minimo.passos[0].tituloAuto, false);
  assert.equal(validarGuia(minimo).ok, true);
});

test('clonarGuia remove imagens e não compartilha referências', () => {
  const g = exemplo();
  const c = clonarGuia(g);
  assert.equal('imagens' in c, false);
  assert.deepEqual(c.passos, g.passos);
  c.passos[0].titulo = 'mudou';
  assert.notEqual(g.passos[0].titulo, 'mudou');
});

test('numeroDoPasso ignora seções', () => {
  const g = exemplo();
  assert.equal(numeroDoPasso(g, 0), 1);
  assert.equal(numeroDoPasso(g, 6), 7);
  assert.equal(numeroDoPasso(g, 7), null);
  assert.equal(numeroDoPasso(g, 8), 8);
  assert.equal(numeroDoPasso(g, 9), 9);
  assert.equal(numeroDoPasso(g, 99), null);
});

test('renumerarMarcadores segue a ordem dos passos e preserva marcadores manuais', () => {
  const g = exemplo();
  g.passos[1].anotacoes.push({ id: 'a_m1x4k9zr02a9', tipo: 'marcador', auto: false, x: 5, y: 5, numero: 42, cor: 'roxo' });
  // move o passo "Clique em Criar" (índice 1) para o fim
  const [movido] = g.passos.splice(1, 1);
  g.passos.push(movido);
  renumerarMarcadores(g);
  assert.equal(movido.anotacoes[1].numero, 9);   // 10 passos, 1 seção → último numerado é 9
  assert.equal(movido.anotacoes[2].numero, 42);  // manual mantém
  assert.equal(g.passos[1].anotacoes.find((a) => a.tipo === 'marcador').numero, 2);
  assert.equal(validarGuia(g).ok, true);
});

test('notas, zoom e resumo: criarNota, validarGuia, notasDoPasso, zoomDoPasso e resumoDoGuia', () => {
  assert.equal(criarGuia().estilo.zoom, 'alvo');
  const n = criarNota('dica', 'Texto');
  assert.ok(validarId(n.id) && n.id.startsWith('n_'));
  assert.deepEqual({ tipo: n.tipo, texto: n.texto }, { tipo: 'dica', texto: 'Texto' });
  assert.throws(() => criarNota('perigo'), /Tipo de nota inválido/);
  assert.deepEqual(TIPOS_NOTA, ['dica', 'atencao', 'nota']);

  // o fixture tem notas nos passos 2, 4 e 9 e é válido
  const g = exemplo();
  assert.deepEqual(validarGuia(g), { ok: true, erros: [] });
  // ausentes são válidos (guias antigos e o Mac não gravam notas/zoom)
  const antigo = exemplo();
  delete antigo.estilo.zoom;
  for (const p of antigo.passos) { delete p.notas; delete p.zoom; }
  assert.equal(validarGuia(antigo).ok, true);
  assert.deepEqual(migrarGuia(antigo), antigo, 'migrar não precisa completar notas/zoom');

  const invalido = exemplo();
  invalido.estilo.zoom = 'perto';
  invalido.passos[0].zoom = 'longe';
  invalido.passos[1].notas.push({ id: 'n_m1x4k9zr02n9', tipo: 'perigo', texto: 'x' }, { id: 'n_m1x4k9zr02n1', tipo: 'nota', texto: '  ' }, { id: 'a_m1x4k9zr02n8', tipo: 'nota', texto: 'ok' });
  invalido.passos[2].notas = 'x';
  const r = validarGuia(invalido);
  assert.equal(r.ok, false);
  for (const trecho of ['estilo.zoom deve ser um de alvo, tela', 'passos[0].zoom deve ser alvo, tela ou null', 'passos[1].notas[1].tipo deve ser um de dica, atencao, nota',
    'passos[1].notas[2].texto deve ser texto não vazio', 'passos[1].notas[2].id repete o id "n_m1x4k9zr02n1" de passos[1].notas[0].id', 'passos[1].notas[3].id deve começar com "n_"', 'passos[2].notas deve ser uma lista']) {
    assert.ok(r.erros.includes(trecho), `${trecho}\n${r.erros.join('\n')}`);
  }
  const zoomNulo = exemplo();
  zoomNulo.passos[1].zoom = null;
  assert.equal(validarGuia(zoomNulo).ok, true);

  // notasDoPasso: só as exportáveis
  assert.deepEqual(notasDoPasso({ notas: [{ id: 'n_1', tipo: 'dica', texto: 'a' }, { id: 'n_2', tipo: 'dica', texto: ' ' }, { id: 'n_3', tipo: 'x', texto: 'b' }, null] }).map((x) => x.id), ['n_1']);
  assert.deepEqual(notasDoPasso({}), []);
  // zoomDoPasso: passo > guia > 'alvo'
  assert.equal(zoomDoPasso({}, {}), 'alvo');
  assert.equal(zoomDoPasso({}, { zoom: 'tela' }), 'tela');
  assert.equal(zoomDoPasso({ zoom: 'alvo' }, { zoom: 'tela' }), 'alvo');
  assert.equal(zoomDoPasso({ zoom: null }, { zoom: 'tela' }), 'tela');
  assert.equal(zoomDoPasso({ zoom: 'x' }, { zoom: 'y' }), 'alvo');

  // resumo: 9 passos numerados (a seção não conta); 5+5+10+10+3+6+6+5+15 = 65 s → 2 min
  assert.deepEqual(resumoDoGuia(g), { passos: 9, minutos: 2, autor: 'Diego', data: '2026-09-24T14:21:40.000Z' });
  assert.deepEqual(resumoDoGuia(criarGuia({ autor: '  Ana ' })), { passos: 0, minutos: 1, autor: 'Ana', data: resumoDoGuia(criarGuia()).data });
  const doze = criarGuia();
  for (let i = 0; i < 12; i++) doze.passos.push(criarPasso({ tipo: 'digitar' }));   // 120 s = 2 min exatos
  assert.equal(resumoDoGuia(doze).minutos, 2);
  doze.passos.push(criarPasso({ tipo: 'tecla' }));                                   // 123 s → 3 min
  assert.equal(resumoDoGuia(doze).minutos, 3);
  assert.equal(SEGUNDOS_POR_TIPO.manual, 15);
});
