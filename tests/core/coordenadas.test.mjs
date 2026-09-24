import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escalas, cssParaImagem, pontoParaImagem, somarDeslocamentos, limitarAImagem, centro, posicaoMarcador, recorteFocado,
} from '../../packages/core/coordenadas.js';

const VIEWPORT = { largura: 1440, altura: 810 };

test('escalas 1, 1,25, 1,5 e 2', () => {
  for (const s of [1, 1.25, 1.5, 2]) {
    const imagem = { largura: 1440 * s, altura: 810 * s };
    const { sx, sy } = escalas(imagem, VIEWPORT);
    assert.ok(Math.abs(sx - s) < 1e-9 && Math.abs(sy - s) < 1e-9);
    assert.deepEqual(cssParaImagem({ x: 100, y: 50, w: 40, h: 20 }, VIEWPORT, imagem), { x: Math.round(100 * s), y: Math.round(50 * s), w: Math.round(40 * s), h: Math.round(20 * s) });
  }
});

test('escala medida no bitmap, não no dpr (zoom do navegador)', () => {
  // dpr 2 mas captura veio em 1x (ambiente de teste) → escala 1
  const imagem = { largura: 1440, altura: 810 };
  assert.deepEqual(cssParaImagem({ x: 1270, y: 146, w: 72, h: 26 }, VIEWPORT, imagem), { x: 1270, y: 146, w: 72, h: 26 });
  // zoom 110% com dpr 2: bitmap 2880 para viewport 1309 → escala 2,2
  const zoom = { largura: 1309, altura: 736 };
  const r = cssParaImagem({ x: 100, y: 100, w: 100, h: 50 }, zoom, { largura: 2880, altura: 1620 });
  assert.deepEqual(r, { x: 220, y: 220, w: 220, h: 110 });
});

test('fixture: rectCss → bbox da seção 3.4', () => {
  const imagem = { largura: 2880, altura: 1620 };
  assert.deepEqual(cssParaImagem({ x: 1270, y: 146, w: 72, h: 26 }, VIEWPORT, imagem), { x: 2540, y: 292, w: 144, h: 52 });
  assert.deepEqual(cssParaImagem({ x: 350, y: 306, w: 400, h: 28 }, VIEWPORT, imagem), { x: 700, y: 612, w: 800, h: 56 });
  assert.deepEqual(pontoParaImagem({ x: 1306, y: 159 }, VIEWPORT, imagem), { x: 2612, y: 318 });
});

test('deslocamento de iframe aninhado em 2 níveis com borda', () => {
  // botão em (10,10) no iframe interno; iframe interno em (100,50) + borda 2 no iframe externo; externo em (200,300) + borda 1 no topo
  const rect = somarDeslocamentos({ x: 10, y: 10, w: 80, h: 30 }, [{ x: 100 + 2, y: 50 + 2 }, { x: 200 + 1, y: 300 + 1 }]);
  assert.deepEqual(rect, { x: 313, y: 363, w: 80, h: 30 });
  assert.deepEqual(somarDeslocamentos({ x: 1, y: 2, w: 3, h: 4 }, []), { x: 1, y: 2, w: 3, h: 4 });
  const bbox = cssParaImagem(rect, VIEWPORT, { largura: 2880, altura: 1620 });
  assert.deepEqual(bbox, { x: 626, y: 726, w: 160, h: 60 });
});

test('bbox parcialmente fora é limitado; totalmente fora fica com w/h 0', () => {
  const imagem = { largura: 2880, altura: 1620 };
  assert.deepEqual(cssParaImagem({ x: -20, y: 800, w: 100, h: 40 }, VIEWPORT, imagem), { x: 0, y: 1600, w: 160, h: 20 });
  assert.deepEqual(cssParaImagem({ x: 1500, y: 10, w: 100, h: 40 }, VIEWPORT, imagem), { x: 2880, y: 20, w: 0, h: 80 });
  assert.deepEqual(cssParaImagem({ x: 10, y: -100, w: 100, h: 40 }, VIEWPORT, imagem), { x: 20, y: 0, w: 200, h: 0 });
  assert.deepEqual(limitarAImagem({ x: -5, y: -5, w: 10, h: 10 }, { largura: 100, altura: 100 }), { x: 0, y: 0, w: 5, h: 5 });
  assert.deepEqual(pontoParaImagem({ x: 2000, y: -3 }, VIEWPORT, imagem), { x: 2880, y: 0 });
});

test('centro', () => {
  assert.deepEqual(centro({ x: 10, y: 20, w: 30, h: 40 }), { x: 25, y: 40 });
});

test('posicaoMarcador no canto superior direito, empurrado para dentro perto das bordas', () => {
  const imagem = { largura: 2880, altura: 1620 };
  assert.deepEqual(posicaoMarcador({ x: 2524, y: 276, w: 176, h: 84 }, imagem, 32), { x: 2700, y: 276 });
  assert.deepEqual(posicaoMarcador({ x: 2800, y: 10, w: 80, h: 40 }, imagem, 32), { x: 2848, y: 32 });   // canto superior direito
  assert.deepEqual(posicaoMarcador({ x: 0, y: 1600, w: 10, h: 20 }, imagem, 32), { x: 32, y: 1588 });    // canto inferior esquerdo
  assert.deepEqual(posicaoMarcador({ x: 0, y: 0, w: 10, h: 10 }, { largura: 40, altura: 40 }, 32), { x: 20, y: 20 }); // imagem menor que o círculo
});

test('recorteFocado: ≥ 40 % da largura, 16:10, dentro da imagem, centrado no alvo', () => {
  const imagem = { largura: 2880, altura: 1620 };
  const bbox = { x: 1400, y: 800, w: 100, h: 40 };
  const r = recorteFocado(bbox, imagem, { escala: 2 });
  assert.equal(r.w, 1152);                        // 40 % de 2880 > 100 + 2·240
  assert.equal(r.h, 720);                         // 16:10
  assert.deepEqual([r.x, r.y], [1450 - 576, 820 - 360]);
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= imagem.largura && r.y + r.h <= imagem.altura);
});

test('recorteFocado: alvo largo e perto da borda', () => {
  const imagem = { largura: 2880, altura: 1620 };
  const r = recorteFocado({ x: 1800, y: 100, w: 1000, h: 60 }, imagem, { margem: 120 });
  assert.equal(r.w, 1240);                         // bbox.w + 2·margem > 40 %
  assert.equal(r.h, 775);
  assert.equal(r.x + r.w, 2880);                   // encostou na borda direita
  assert.equal(r.y, 0);
  // alvo alto: a altura manda e a largura acompanha 16:10
  const alto = recorteFocado({ x: 100, y: 100, w: 50, h: 900 }, imagem, { margem: 120 });
  assert.equal(alto.h, 1140);
  assert.equal(alto.w, 1824);
  // imagem pequena: recorte nunca ultrapassa a imagem
  const pequena = recorteFocado({ x: 10, y: 10, w: 20, h: 20 }, { largura: 300, altura: 100 }, { margem: 120 });
  assert.deepEqual(pequena, { x: 0, y: 0, w: 160, h: 100 });
  // margem padrão = 120·escala (escala 1)
  assert.equal(recorteFocado({ x: 0, y: 0, w: 1000, h: 10 }, { largura: 2000, altura: 2000 }).w, 1240);
});

test('recorteFocado nunca sai da imagem por arredondamento (w = 0,4·W com h fracionário em ,5)', () => {
  // W = 2890 → w = 1156, h = 722,5; alvo no rodapé: y = H − 722,5 = 277,5 e h arredondariam ambos para cima (y + h = 1001)
  const imagem = { largura: 2890, altura: 1000 };
  const r = recorteFocado({ x: 2800, y: 950, w: 50, h: 40 }, imagem, { margem: 120 });
  assert.equal(r.y + r.h, 1000);
  assert.equal(r.x + r.w, 2890);
  assert.deepEqual(r, { x: 1734, y: 278, w: 1156, h: 722 });
  // canto superior esquerdo e alvo no meio: mesma largura, borda inferior calculada pela soma
  assert.deepEqual(recorteFocado({ x: 0, y: 0, w: 50, h: 40 }, imagem, { margem: 120 }), { x: 0, y: 0, w: 1156, h: 723 });
  const meio = recorteFocado({ x: 1400, y: 500, w: 50, h: 40 }, imagem, { margem: 120 });
  assert.ok(meio.x >= 0 && meio.y >= 0 && meio.x + meio.w <= 2890 && meio.y + meio.h <= 1000);
  assert.equal(meio.h, Math.round(520 + 361.25) - Math.round(520 - 361.25));
  // varredura: alvos em todas as bordas de várias imagens ficam sempre dentro e com tamanho inteiro
  for (const W of [1000, 1440, 2890, 3456]) for (const H of [777, 1000, 1620, 2234]) {
    for (const bbox of [{ x: 0, y: 0, w: 10, h: 10 }, { x: W - 10, y: H - 10, w: 10, h: 10 }, { x: W / 2, y: H - 5, w: 20, h: 5 }, { x: W - 5, y: H / 2, w: 5, h: 20 }]) {
      const rec = recorteFocado(bbox, { largura: W, altura: H }, { escala: 2 });
      assert.ok(rec.x >= 0 && rec.y >= 0 && rec.x + rec.w <= W && rec.y + rec.h <= H, JSON.stringify({ W, H, bbox, rec }));
      for (const v of Object.values(rec)) assert.ok(Number.isInteger(v));
    }
  }
});

test('casos Mac: display secundário com origem negativa e escalas mistas', () => {
  // display 2 (Retina 2x) à esquerda do principal: limites Quartz x=-1728, y=-200, 1728×1117 pt
  const display = { x: -1728, y: -200, w: 1728, h: 1117 };
  const rectQuartz = { x: -1600, y: -100, w: 90, h: 22 };
  const rectCss = somarDeslocamentos(rectQuartz, [{ x: -display.x, y: -display.y }]);
  assert.deepEqual(rectCss, { x: 128, y: 100, w: 90, h: 22 });
  const imagem2x = { largura: 3456, altura: 2234 };
  assert.deepEqual(cssParaImagem(rectCss, { largura: 1728, altura: 1117 }, imagem2x), { x: 256, y: 200, w: 180, h: 44 });
  // display 1x: mesmo rect em pontos vira o mesmo em px
  const imagem1x = { largura: 1920, altura: 1080 };
  assert.deepEqual(cssParaImagem({ x: 128, y: 100, w: 90, h: 22 }, { largura: 1920, altura: 1080 }, imagem1x), { x: 128, y: 100, w: 90, h: 22 });
  // ponto fora do display (clique no outro monitor) é limitado
  assert.deepEqual(pontoParaImagem({ x: -10, y: 50 }, { largura: 1728, altura: 1117 }, imagem2x), { x: 0, y: 100 });
});
