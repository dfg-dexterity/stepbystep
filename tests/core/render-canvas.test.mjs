import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medidas, desenharPasso } from '../../packages/core/render-canvas.js';
import { CORES } from '../../packages/core/modelo.js';
import { criarCtxFalso, metodos, lerFixture } from './util.mjs';

const FONTE = { marca: 'bitmap' };
const IMAGEM = { largura: 2880, altura: 1620, fonte: FONTE };

function passoCompleto() {
  const g = lerFixture('guia-exemplo');
  const p = structuredClone(g.passos[2]); // recorte, retângulo auto, marcador auto, seta, texto
  p.anotacoes.push({ id: 'a_m1x4k9zr03a6', tipo: 'desfoque', auto: false, x: 800, y: 700, w: 100, h: 40, bloco: 16 });
  return p;
}

function criarCanvasFalso(registro) {
  return (w, h) => {
    const ctx = criarCtxFalso('pequeno');
    registro.push({ w, h, ctx });
    return { getContext: () => ctx, width: w, height: h };
  };
}

test('medidas proporcionais à escala', () => {
  const m = medidas({ captura: { escala: 2 } });
  assert.equal(m.e, 2);
  assert.equal(m.espessuraRect, 6);
  assert.equal(m.raioMarcador, 32);
  assert.equal(m.hasteSeta, 8);
  assert.equal(m.pontaSeta, 32);
  assert.equal(m.tamanhoTexto, 32);
  assert.equal(m.fonteMarcador, '600 40px "Barlow Condensed"');
  assert.equal(m.fonteTexto(32), '600 32px Figtree');
  assert.equal(medidas({ captura: null }).e, 1);
  assert.equal(medidas({}).espessuraRect, 3);
});

test('ordem das operações: scale → translate → drawImage → desfoque → holofote evenodd → retângulo → seta → texto → marcador', () => {
  const ctx = criarCtxFalso();
  const canvases = [];
  const p = passoCompleto();
  desenharPasso(ctx, IMAGEM, p, { escala: 1, estilo: { cor: 'cerceta', escurecerFora: true }, criarCanvas: criarCanvasFalso(canvases) });
  const seq = metodos(ctx);
  assert.equal(seq[0], 'save');
  assert.equal(seq[1], 'scale');
  assert.equal(seq[2], 'translate');
  assert.equal(seq[3], 'drawImage');
  const idx = (nome, aPartir = 0) => seq.indexOf(nome, aPartir);
  const iDesfoque = idx('drawImage', 4);         // desenha o canvas pequeno de volta
  const iClip = idx('clip');
  const iRect = idx('strokeRect');
  const iSeta = idx('stroke', iClip + 1);
  const iTexto = idx('fillText');
  const iMarcador = idx('arc');
  assert.ok(iDesfoque > 3 && iDesfoque < iClip, 'desfoque antes do holofote');
  assert.ok(iClip < iRect, 'holofote antes do retângulo');
  assert.ok(iRect < iSeta, 'retângulo antes da seta');
  assert.ok(iSeta < iTexto, 'seta antes do texto');
  assert.ok(iTexto < iMarcador, 'texto antes do marcador');
  assert.equal(seq.at(-1), 'restore');
  assert.deepEqual(ctx.chamadas.find((c) => c[0] === 'clip'), ['clip', 'evenodd']);
});

test('recorte entra como translate sem alterar coordenadas das anotações', () => {
  const ctx = criarCtxFalso();
  const p = passoCompleto();
  desenharPasso(ctx, IMAGEM, p, { escala: 0.5, criarCanvas: criarCanvasFalso([]) });
  assert.deepEqual(ctx.chamadas.find((c) => c[0] === 'scale'), ['scale', 0.5, 0.5]);
  assert.deepEqual(ctx.chamadas.find((c) => c[0] === 'translate'), ['translate', -400, -400]);
  assert.deepEqual(ctx.chamadas.find((c) => c[0] === 'drawImage'), ['drawImage', FONTE, 0, 0, 2880, 1620]);
  assert.deepEqual(ctx.chamadas.find((c) => c[0] === 'strokeRect'), ['strokeRect', 684, 596, 832, 88]);
  const arcos = ctx.chamadas.filter((c) => c[0] === 'arc');
  assert.equal(arcos.length, 3);
  assert.deepEqual(arcos[0].slice(1, 4), [1516, 596, 32]);       // raio 16·2
  assert.deepEqual(arcos[1].slice(1, 4), [1516, 596, 34]);       // anel branco 2e centrado em r+e
  assert.deepEqual(arcos[2].slice(1, 4), [1516, 596, 37]);       // fio base 1e
  // holofote: área do recorte e retângulo auto, preenchimento translúcido
  const rects = ctx.chamadas.filter((c) => c[0] === 'rect');
  assert.deepEqual(rects, [['rect', 400, 400, 1600, 800], ['rect', 684, 596, 832, 88]]);
  assert.deepEqual(ctx.chamadas.find((c) => c[0] === 'fillRect'), ['fillRect', 400, 400, 1600, 800]);
  // sem recorte: translate(0,0) e holofote sobre a imagem inteira
  const ctx2 = criarCtxFalso();
  desenharPasso(ctx2, IMAGEM, p, { escala: 1, incluirRecorte: false, criarCanvas: criarCanvasFalso([]) });
  assert.deepEqual(ctx2.chamadas.find((c) => c[0] === 'translate'), ['translate', -0, -0]);
  assert.deepEqual(ctx2.chamadas.find((c) => c[0] === 'rect'), ['rect', 0, 0, 2880, 1620]);
});

test('geometria proporcional à escala da captura', () => {
  const ctx = criarCtxFalso();
  const p = passoCompleto();
  desenharPasso(ctx, IMAGEM, p, { escala: 1, criarCanvas: criarCanvasFalso([]) });
  const larguras = ctx.chamadas.filter((c) => c[0] === 'set' && c[1] === 'lineWidth').map((c) => c[2]);
  assert.deepEqual(larguras, [6, 8, 4, 2]);   // retângulo 3e, haste 4e, anel 2e, fio 1e (e = 2)
  const fontes = ctx.chamadas.filter((c) => c[0] === 'set' && c[1] === 'font').map((c) => c[2]);
  assert.deepEqual(fontes, ['600 32px Figtree', '600 40px "Barlow Condensed"']);
  // texto: fundo off medido pelo measureText (10 px/char) com folga 8, depois o texto
  const fills = ctx.chamadas.filter((c) => c[0] === 'fillRect');
  assert.deepEqual(fills[1], ['fillRect', 1710 - 8, 920 - 8, 120 + 16, 40 + 16]);
  assert.deepEqual(ctx.chamadas.find((c) => c[0] === 'fillText'), ['fillText', 'Razão social', 1710, 920]);
  // seta: haste de `de` até a base da ponta; ponta de 32
  const moves = ctx.chamadas.filter((c) => c[0] === 'moveTo');
  assert.deepEqual(moves[0], ['moveTo', 1700, 900]);
  assert.deepEqual(moves[1], ['moveTo', 1520, 680]);          // vértice da ponta
  // escala 1: mesma geometria com medidas menores
  const ctx1 = criarCtxFalso();
  const p1 = structuredClone(p); p1.captura.escala = 1;
  desenharPasso(ctx1, IMAGEM, p1, { escala: 1, criarCanvas: criarCanvasFalso([]) });
  assert.deepEqual(ctx1.chamadas.filter((c) => c[0] === 'set' && c[1] === 'lineWidth').map((c) => c[2]), [3, 4, 2, 1]);
});

test('desfoque usa canvas pequeno sem suavização', () => {
  const ctx = criarCtxFalso();
  const canvases = [];
  desenharPasso(ctx, IMAGEM, passoCompleto(), { escala: 1, criarCanvas: criarCanvasFalso(canvases) });
  assert.equal(canvases.length, 1);
  assert.deepEqual([canvases[0].w, canvases[0].h], [Math.ceil(100 / 16), Math.ceil(40 / 16)]);
  const pequeno = canvases[0].ctx.chamadas;
  assert.deepEqual(pequeno[0], ['set', 'imageSmoothingEnabled', false]);
  assert.deepEqual(pequeno[1], ['drawImage', FONTE, 800, 700, 100, 40, 0, 0, 7, 3]);
  const volta = ctx.chamadas.filter((c) => c[0] === 'drawImage')[1];
  assert.deepEqual(volta.slice(2), [0, 0, 7, 3, 800, 700, 100, 40]);
  const suav = ctx.chamadas.filter((c) => c[0] === 'set' && c[1] === 'imageSmoothingEnabled').map((c) => c[2]);
  assert.deepEqual(suav, [false, true]);
});

test('cores resolvidas de CORES; auto usa estilo.cor', () => {
  const ctx = criarCtxFalso();
  desenharPasso(ctx, IMAGEM, passoCompleto(), { escala: 1, estilo: { cor: 'ambar', escurecerFora: false }, criarCanvas: criarCanvasFalso([]) });
  const strokes = ctx.chamadas.filter((c) => c[0] === 'set' && c[1] === 'strokeStyle').map((c) => c[2]);
  assert.equal(strokes[0], CORES.ambar);                       // retângulo auto segue estilo.cor
  assert.equal(strokes[1], CORES.ambar);                       // seta manual com cor 'ambar'
  assert.deepEqual(strokes.slice(2), [CORES.branco, CORES.base]);
  const fills = ctx.chamadas.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2]);
  assert.deepEqual(fills, [CORES.ambar, CORES.off, CORES.base, CORES.ambar, CORES.branco]); // seta, fundo texto, texto, marcador, número
  assert.equal(ctx.chamadas.some((c) => c[0] === 'clip'), false);   // escurecerFora false → sem holofote
  // marcador manual mantém a própria cor
  const ctx2 = criarCtxFalso();
  desenharPasso(ctx2, IMAGEM, { captura: { escala: 1 }, anotacoes: [{ id: 'a_m1x4k9zr02a1', tipo: 'marcador', auto: false, x: 10, y: 10, numero: 3, cor: 'roxo' }] }, { estilo: { cor: 'ambar', escurecerFora: true } });
  assert.equal(ctx2.chamadas.find((c) => c[0] === 'set' && c[1] === 'fillStyle')[2], CORES.roxo);
  assert.deepEqual(ctx2.chamadas.find((c) => c[0] === 'fillText'), ['fillText', '3', 10, 10]);
});

test('passo sem anotações e sem criarCanvas só desenha a imagem', () => {
  const ctx = criarCtxFalso();
  desenharPasso(ctx, IMAGEM, { captura: { escala: 2 }, anotacoes: [] }, {});
  assert.deepEqual(metodos(ctx), ['save', 'scale', 'translate', 'drawImage', 'restore']);
  // desfoque sem criarCanvas é ignorado em vez de quebrar
  const ctx2 = criarCtxFalso();
  desenharPasso(ctx2, IMAGEM, { captura: { escala: 2 }, anotacoes: [{ id: 'a_m1x4k9zr02a1', tipo: 'desfoque', auto: true, x: 0, y: 0, w: 10, h: 10, bloco: 8 }] }, {});
  assert.deepEqual(metodos(ctx2), ['save', 'scale', 'translate', 'drawImage', 'restore']);
});
