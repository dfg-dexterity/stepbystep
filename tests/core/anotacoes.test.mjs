import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarAnotacoes, separarRecorte, areaSaida, areaEfetiva, pontaDaSeta, bboxDaAnotacao, hitTest, moverAnotacao, anotacoesAutomaticas,
} from '../../packages/core/anotacoes.js';
import { medidas } from '../../packages/core/render-canvas.js';
import { validarId } from '../../packages/core/ids.js';
import { recorteFocado } from '../../packages/core/coordenadas.js';
import { lerFixture } from './util.mjs';

const semIds = (lista) => lista.map(({ id, ...resto }) => resto);

test('normalizarAnotacoes garante id, auto, cor e um só recorte (o último)', () => {
  const lista = normalizarAnotacoes([
    { tipo: 'recorte', x: 0, y: 0, w: 10, h: 10 },
    { id: 'errado', tipo: 'retangulo', x: 1, y: 1, w: 2, h: 2, cor: '#fff' },
    { id: 'a_m1x4k9zr02a1', tipo: 'marcador', auto: 1, x: 5, y: 5, numero: 0 },
    { tipo: 'recorte', x: 5, y: 5, w: 20, h: 20 },
    { tipo: 'texto', x: 0, y: 0, texto: null, tamanho: 0, fundo: 'verde' },
    { tipo: 'desfoque', x: 0, y: 0, w: 4, h: 4 },
    { tipo: 'circulo', x: 0, y: 0 },
    null,
  ]);
  assert.deepEqual(lista.map((a) => a.tipo), ['retangulo', 'marcador', 'recorte', 'texto', 'desfoque']);
  for (const a of lista) { assert.ok(validarId(a.id) && a.id.startsWith('a_'), a.id); assert.equal(typeof a.auto, 'boolean'); }
  assert.equal(lista[0].cor, 'cerceta');
  assert.equal(lista[1].id, 'a_m1x4k9zr02a1');
  assert.equal(lista[1].auto, true);
  assert.equal(lista[1].numero, 1);
  assert.deepEqual(lista[2], { ...lista[2], x: 5, y: 5, w: 20, h: 20 });
  assert.deepEqual(lista[3], { ...lista[3], texto: '', tamanho: 16, fundo: null, cor: 'cerceta' });
  assert.equal(lista[4].bloco, 8);
  assert.deepEqual(normalizarAnotacoes(null), []);
});

test('separarRecorte e areaSaida', () => {
  const g = lerFixture('guia-exemplo');
  const { recorte, demais } = separarRecorte(g.passos[2].anotacoes);
  assert.equal(recorte.id, 'a_m1x4k9zr03a1');
  assert.equal(demais.length, 4);
  const imagem = { largura: 2880, altura: 1620 };
  assert.deepEqual(areaSaida(imagem, recorte), { x: 400, y: 400, w: 1600, h: 800 });
  assert.deepEqual(areaSaida(imagem, null), { x: 0, y: 0, w: 2880, h: 1620 });
  assert.deepEqual(areaSaida(imagem, { x: 2000, y: 1000, w: 2000, h: 2000 }), { x: 2000, y: 1000, w: 880, h: 620 });
  assert.deepEqual(areaSaida(imagem, { x: 5000, y: 0, w: 10, h: 10 }), { x: 0, y: 0, w: 2880, h: 1620 }); // fora → inteira
});

test('pontaDaSeta: vértice em `para`, base perpendicular à direção', () => {
  const [p0, p1, p2] = pontaDaSeta({ x: 0, y: 0 }, { x: 100, y: 0 }, 16);
  assert.deepEqual(p0, { x: 100, y: 0 });
  assert.deepEqual([p1.x, Math.abs(p1.y)], [84, 8]);
  assert.deepEqual([p2.x, Math.abs(p2.y)], [84, 8]);
  assert.equal(p1.y, -p2.y);
  // 45°
  const [q0, q1, q2] = pontaDaSeta({ x: 0, y: 0 }, { x: 100, y: 100 }, 16);
  assert.deepEqual(q0, { x: 100, y: 100 });
  const base = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
  assert.ok(Math.abs(Math.hypot(base.x - 100, base.y - 100) - 16) < 1e-9);
  assert.ok(Math.abs(base.x - base.y) < 1e-9);
  assert.ok(Math.abs(Math.hypot(q1.x - q2.x, q1.y - q2.y) - 16) < 1e-9);
  // seta degenerada não dá NaN
  const d = pontaDaSeta({ x: 5, y: 5 }, { x: 5, y: 5 }, 16);
  assert.ok(d.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('bboxDaAnotacao inclui espessura e raio', () => {
  const m = medidas({ captura: { escala: 2 } });
  assert.deepEqual(bboxDaAnotacao({ tipo: 'retangulo', x: 100, y: 100, w: 50, h: 20 }, m), { x: 97, y: 97, w: 56, h: 26 });
  assert.deepEqual(bboxDaAnotacao({ tipo: 'marcador', x: 100, y: 100 }, m), { x: 62, y: 62, w: 76, h: 76 });
  assert.deepEqual(bboxDaAnotacao({ tipo: 'recorte', x: 1, y: 2, w: 3, h: 4 }, m), { x: 1, y: 2, w: 3, h: 4 });
  const s = bboxDaAnotacao({ tipo: 'seta', de: { x: 0, y: 0 }, para: { x: 100, y: 0 } }, m);
  assert.deepEqual(s, { x: -4, y: -20, w: 108, h: 40 });
  const t = bboxDaAnotacao({ tipo: 'texto', x: 10, y: 10, texto: 'abcd', tamanho: 32, fundo: 'off' }, m);
  assert.deepEqual(t, { x: 2, y: 2, w: 4 * 32 * 0.55 + 16, h: 40 + 16 });
});

test('hitTest com tolerância', () => {
  const m = medidas({ captura: { escala: 1 } });
  const ret = { tipo: 'retangulo', x: 100, y: 100, w: 50, h: 20 };
  assert.equal(hitTest(ret, { x: 120, y: 110 }, 0, m), true);
  assert.equal(hitTest(ret, { x: 160, y: 110 }, 0, m), false);
  assert.equal(hitTest(ret, { x: 160, y: 110 }, 10, m), true);
  const marc = { tipo: 'marcador', x: 100, y: 100 };
  assert.equal(hitTest(marc, { x: 100 + 18, y: 100 }, 0, m), true);   // raio 16 + anel 3
  assert.equal(hitTest(marc, { x: 100 + 25, y: 100 }, 0, m), false);
  assert.equal(hitTest(marc, { x: 100 + 25, y: 100 }, 8, m), true);
  const seta = { tipo: 'seta', de: { x: 0, y: 0 }, para: { x: 100, y: 0 } };
  assert.equal(hitTest(seta, { x: 50, y: 1 }, 0, m), true);
  assert.equal(hitTest(seta, { x: 50, y: 6 }, 0, m), false);
  assert.equal(hitTest(seta, { x: 50, y: 6 }, 5, m), true);
  assert.equal(hitTest(seta, { x: 90, y: 6 }, 0, m), true);           // dentro da ponta
  assert.equal(hitTest({ tipo: 'recorte', x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 }, 0, m), true);
});

test('moverAnotacao devolve nova anotação', () => {
  const r = { id: 'a_x', tipo: 'retangulo', x: 1, y: 2, w: 3, h: 4 };
  const m = moverAnotacao(r, 10, 20);
  assert.deepEqual(m, { id: 'a_x', tipo: 'retangulo', x: 11, y: 22, w: 3, h: 4 });
  assert.equal(r.x, 1);
  const s = moverAnotacao({ tipo: 'seta', de: { x: 0, y: 0 }, para: { x: 5, y: 5 } }, 1, 1);
  assert.deepEqual(s, { tipo: 'seta', de: { x: 1, y: 1 }, para: { x: 6, y: 6 } });
});

test('anotacoesAutomaticas reproduz as anotações auto do fixture', () => {
  const g = lerFixture('guia-exemplo');
  const auto = (p) => semIds(p.anotacoes.filter((a) => a.auto));
  for (const i of [1, 2, 3, 5, 6, 8]) {
    const p = g.passos[i];
    const numero = p.anotacoes.find((a) => a.tipo === 'marcador').numero;
    assert.deepEqual(semIds(anotacoesAutomaticas(p, { numero })), auto(p), `passo ${i}`);
  }
  assert.deepEqual(anotacoesAutomaticas(g.passos[0], { numero: 1 }), []);   // navegar
  assert.deepEqual(anotacoesAutomaticas(g.passos[4], { numero: 5 }), []);   // tecla
  assert.deepEqual(anotacoesAutomaticas(g.passos[7], { numero: 1 }), []);   // secao
  assert.deepEqual(anotacoesAutomaticas(g.passos[9], { numero: 9 }), []);   // manual
  for (const a of anotacoesAutomaticas(g.passos[1], { numero: 2 })) assert.ok(validarId(a.id));
});

test('anotacoesAutomaticas: recorte pela janela no Mac (com e sem menu)', () => {
  const m = lerFixture('guia-mac');
  const menu = anotacoesAutomaticas(m.passos[1], { numero: 2 });
  assert.deepEqual(semIds(menu)[0], { tipo: 'recorte', auto: true, x: 160, y: 0, w: 3000, h: 1990 });
  assert.deepEqual(menu.map((a) => a.tipo), ['recorte', 'retangulo', 'marcador']);
  const botao = anotacoesAutomaticas(m.passos[2], { numero: 3 });
  assert.deepEqual(semIds(botao)[0], { tipo: 'recorte', auto: true, x: 160, y: 90, w: 3000, h: 1900 });
  const senha = anotacoesAutomaticas(m.passos[6], { numero: 7 });
  assert.deepEqual(senha.map((a) => a.tipo), ['recorte', 'desfoque', 'retangulo', 'marcador']);
  assert.deepEqual(semIds(senha)[0], { tipo: 'recorte', auto: true, x: 1100, y: 800, w: 1200, h: 600 });
  assert.equal(senha[1].bloco, 16);
  // janela não contém o alvo → recorte engloba os dois
  const p = structuredClone(m.passos[2]);
  p.alvo.janelaBbox = { x: 1000, y: 1000, w: 500, h: 500 };
  assert.deepEqual(semIds(anotacoesAutomaticas(p, { numero: 1 }))[0], { tipo: 'recorte', auto: true, x: 480, y: 280, w: 1020, h: 1220 });
});

test('anotacoesAutomaticas: bbox null, w 0, captura faltante ou sem escala', () => {
  const base = { tipo: 'clicar', evento: { botao: 'esquerdo', vezes: 1, modificadores: [] }, captura: { imagemId: 'img_m1x4k9zr02ab', largura: 100, altura: 100, escala: 1, faltante: false } };
  assert.deepEqual(anotacoesAutomaticas({ ...base, alvo: { papel: 'button', bbox: null } }, { numero: 1 }), []);
  assert.deepEqual(anotacoesAutomaticas({ ...base, alvo: { papel: 'button', bbox: { x: 10, y: 10, w: 0, h: 0 } } }, { numero: 1 }), []);
  assert.deepEqual(anotacoesAutomaticas({ ...base, captura: { imagemId: null, faltante: true }, alvo: { papel: 'button', bbox: { x: 1, y: 1, w: 5, h: 5 } } }, { numero: 1 }), []);
  // folga limitada à imagem e marcador empurrado para dentro
  const r = anotacoesAutomaticas({ ...base, alvo: { papel: 'button', bbox: { x: 0, y: 0, w: 96, h: 20 } } }, { numero: 4 });
  assert.deepEqual(semIds(r), [
    { tipo: 'retangulo', auto: true, x: 0, y: 0, w: 100, h: 28, cor: 'cerceta' },
    { tipo: 'marcador', auto: true, x: 84, y: 16, numero: 4, cor: 'cerceta' },
  ]);
});

test('areaEfetiva: recorte manual manda; senão zoom no alvo (padrão), com override por passo; sem alvo ou «tela» → imagem inteira', () => {
  const g = lerFixture('guia-exemplo');
  const imagem = { largura: 2880, altura: 1620 };
  const inteira = { x: 0, y: 0, w: 2880, h: 1620 };
  const clique = g.passos[1];                                     // alvo 2540,292 144×52, sem recorte
  const focado = recorteFocado(clique.alvo.bbox, imagem, { escala: 2 });
  // guia antigo (estilo sem zoom) = 'alvo': vale para o que já foi gravado, sem tocar no guia
  assert.deepEqual(areaEfetiva(clique, imagem, g.estilo), focado);
  assert.deepEqual(areaEfetiva(clique, imagem, undefined), focado);
  assert.deepEqual(areaEfetiva(clique, imagem, { ...g.estilo, zoom: 'alvo' }), focado);
  assert.deepEqual(areaEfetiva(clique, imagem, { ...g.estilo, zoom: 'tela' }), inteira);
  // override do passo vence o guia; null herda
  assert.deepEqual(areaEfetiva({ ...clique, zoom: 'tela' }, imagem, { zoom: 'alvo' }), inteira);
  assert.deepEqual(areaEfetiva({ ...clique, zoom: 'alvo' }, imagem, { zoom: 'tela' }), focado);
  assert.deepEqual(areaEfetiva({ ...clique, zoom: null }, imagem, { zoom: 'tela' }), inteira);
  // o retângulo e o marcador automáticos ficam dentro da área ampliada
  const [ret, marc] = clique.anotacoes;
  assert.ok(ret.x >= focado.x && ret.y >= focado.y && ret.x + ret.w <= focado.x + focado.w && ret.y + ret.h <= focado.y + focado.h, JSON.stringify(focado));
  const raio = medidas(clique).raioMarcador + 3 * 2;
  assert.ok(marc.x + raio <= focado.x + focado.w && marc.y - raio >= focado.y, 'marcador inteiro na área');
  // recorte explícito manda, mesmo com zoom 'alvo' (e é limitado à imagem como areaSaida)
  const digitar = g.passos[2];
  assert.deepEqual(areaEfetiva(digitar, imagem, { zoom: 'alvo' }), { x: 400, y: 400, w: 1600, h: 800 });
  assert.deepEqual(areaEfetiva({ ...digitar, zoom: 'tela' }, imagem, {}), { x: 400, y: 400, w: 1600, h: 800 });
  // sem alvo (navegar, tecla), bbox nulo, vazio ou fora da imagem → inteira
  assert.deepEqual(areaEfetiva(g.passos[0], imagem, {}), inteira);
  assert.deepEqual(areaEfetiva(g.passos[4], imagem, {}), inteira);
  assert.deepEqual(areaEfetiva({ ...clique, alvo: { ...clique.alvo, bbox: null } }, imagem, {}), inteira);
  assert.deepEqual(areaEfetiva({ ...clique, alvo: { ...clique.alvo, bbox: { x: 10, y: 10, w: 0, h: 5 } } }, imagem, {}), inteira);
  assert.deepEqual(areaEfetiva({ ...clique, alvo: { ...clique.alvo, bbox: { x: 5000, y: 10, w: 20, h: 20 } } }, imagem, {}), inteira);
  // a área fica sempre dentro da imagem, perto das bordas também
  const canto = areaEfetiva({ ...clique, alvo: { ...clique.alvo, bbox: { x: 2860, y: 1600, w: 20, h: 20 } } }, imagem, {});
  assert.ok(canto.x >= 0 && canto.y >= 0 && canto.x + canto.w <= 2880 && canto.y + canto.h <= 1620, JSON.stringify(canto));
  assert.ok(canto.w < 2880);
});
