import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guiaParaBlocos, dividirEmLotes, richText, richTextComDestaque, contarBlocos } from '../../packages/core/notion-blocos.js';
import { criarGuia, criarPasso } from '../../packages/core/modelo.js';
import { lerFixture } from './util.mjs';

const DATA_FIXA = new Date('2026-09-24T12:00:00Z');
const texto = (rt) => rt.map((t) => t.text.content).join('');

function guiaComPassos(n, { comImagem = true, secoes = false } = {}) {
  const g = criarGuia({ titulo: 'Grande' });
  for (let i = 0; i < n; i++) {
    if (secoes && i % 50 === 0) g.passos.push(criarPasso({ tipo: 'secao', titulo: `Parte ${i / 50 + 1}`, tituloAuto: false }));
    g.passos.push(criarPasso({
      tipo: 'clicar', titulo: `Clique em «Botão ${i + 1}»`, descricao: i % 2 ? 'desc' : '',
      captura: comImagem ? { imagemId: 'img_m1x4k9zr01aa', largura: 10, altura: 10, escala: 1, fonte: 'pointerdown', faltante: false } : null,
    }));
  }
  return g;
}

test('richText fatia em 2000 caracteres e só inclui annotations quando há', () => {
  assert.deepEqual(richText('abc'), [{ type: 'text', text: { content: 'abc' } }]);
  assert.deepEqual(richText('abc', { bold: true }), [{ type: 'text', text: { content: 'abc' }, annotations: { bold: true } }]);
  const longo = 'x'.repeat(4500);
  const partes = richText(longo);
  assert.deepEqual(partes.map((p) => p.text.content.length), [2000, 2000, 500]);
  assert.deepEqual(richText(''), []);
  assert.deepEqual(richText(null), []);
  // conta pontos de código: emojis não são partidos
  assert.deepEqual(richText('😀'.repeat(2001)).map((p) => Array.from(p.text.content).length), [2000, 1]);
});

test('richTextComDestaque põe negrito só no que está entre «»', () => {
  const rt = richTextComDestaque('Digite «ACME Ltda» no campo «Nome»');
  assert.deepEqual(rt, [
    { type: 'text', text: { content: 'Digite ' } },
    { type: 'text', text: { content: '«ACME Ltda»' }, annotations: { bold: true } },
    { type: 'text', text: { content: ' no campo ' } },
    { type: 'text', text: { content: '«Nome»' }, annotations: { bold: true } },
  ]);
  assert.deepEqual(richTextComDestaque('Pressione Enter'), [{ type: 'text', text: { content: 'Pressione Enter' } }]);
  assert.deepEqual(richTextComDestaque('«Só»'), [{ type: 'text', text: { content: '«Só»' }, annotations: { bold: true } }]);
  assert.deepEqual(richTextComDestaque(''), []);
});

test('contarBlocos conta filhos recursivamente', () => {
  const folha = { object: 'block', type: 'paragraph', paragraph: { rich_text: [] } };
  assert.equal(contarBlocos(folha), 1);
  const item = { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [], children: [folha, folha] } };
  assert.equal(contarBlocos(item), 3);
});

test('guiaParaBlocos: callout, descrição, itens numerados com destaque, filhos e heading_2 para seção', () => {
  const g = lerFixture('guia-exemplo');
  const { titulo, blocos } = guiaParaBlocos(g, { uploadIdDoPasso: (p) => (p.captura?.imagemId ? `up-${p.id}` : null), data: DATA_FIXA });
  assert.equal(titulo, 'Cadastrar fornecedor no SAP Fiori');
  assert.equal(blocos[0].type, 'callout');
  assert.deepEqual(blocos[0].callout.icon, { type: 'emoji', emoji: '📘' });
  assert.equal(blocos[0].callout.color, 'gray_background');
  assert.equal(texto(blocos[0].callout.rich_text), 'Manual gerado com StepByStep · Dexterity IT Solutions · 10 passos · 24/09/2026');
  assert.equal(blocos[1].type, 'paragraph');
  assert.equal(texto(blocos[1].paragraph.rich_text), g.descricao);
  assert.equal(blocos.length, 2 + 10);
  // guia tem seção → prefixo "Passo n — "
  const clique = blocos[3];
  assert.equal(clique.type, 'numbered_list_item');
  assert.equal(texto(clique.numbered_list_item.rich_text), 'Passo 2 — Clique em «Criar»');
  assert.deepEqual(clique.numbered_list_item.rich_text, [
    { type: 'text', text: { content: 'Passo 2 — ' } },
    { type: 'text', text: { content: 'Clique em ' } },
    { type: 'text', text: { content: '«Criar»' }, annotations: { bold: true } },
  ]);
  assert.deepEqual(clique.numbered_list_item.children, [
    { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: 'up-p_m1x4k9zr02ab' }, caption: [{ type: 'text', text: { content: 'Passo 2' } }] } },
  ]);
  // descrição vem antes da imagem
  const digitar = blocos[4].numbered_list_item;
  assert.deepEqual(digitar.children.map((c) => c.type), ['paragraph', 'image']);
  assert.equal(texto(digitar.children[0].paragraph.rich_text), 'Use a razão social completa, sem abreviações.');
  // seção
  const secao = blocos[9];
  assert.equal(secao.type, 'heading_2');
  assert.equal(texto(secao.heading_2.rich_text), 'Conferência no SAP GUI');
  // passo depois da seção continua a numeração global
  assert.equal(texto(blocos[10].numbered_list_item.rich_text), 'Passo 8 — Escolha o menu «Arquivo › Salvar»');
  // manual sem imagem, com descrição: só o parágrafo
  const manual = blocos[11].numbered_list_item;
  assert.deepEqual(manual.children.map((c) => c.type), ['paragraph']);
  for (const b of blocos) assert.equal(b.object, 'block');
  assert.ok(JSON.stringify(blocos).indexOf('null') === -1, 'nunca null em campos opcionais');
});

test('manual sem imagem e sem descrição não tem children; sem seções não há prefixo', () => {
  const g = criarGuia({ titulo: 'T' });
  g.passos.push(criarPasso({ tipo: 'manual', titulo: 'Só texto', tituloAuto: false }));
  g.passos.push(criarPasso({ tipo: 'clicar', titulo: 'Clique em «X»', captura: { imagemId: 'img_m1x4k9zr01aa', largura: 1, altura: 1, faltante: false } }));
  const { blocos } = guiaParaBlocos(g, { uploadIdDoPasso: () => null, data: DATA_FIXA });
  assert.equal(blocos.length, 3);
  assert.equal('children' in blocos[1].numbered_list_item, false);
  assert.equal(texto(blocos[1].numbered_list_item.rich_text), 'Só texto');
  assert.equal(texto(blocos[2].numbered_list_item.rich_text), 'Clique em «X»');
  assert.equal('children' in blocos[2].numbered_list_item, false);  // sem uploadId não há imagem
  const semTitulo = guiaParaBlocos(criarGuia(), { uploadIdDoPasso: () => null });
  assert.equal(semTitulo.titulo, 'Manual sem título');
  assert.equal(semTitulo.blocos.length, 1);
});

test('texto > 2000 chars é fatiado dentro do bloco', () => {
  const g = criarGuia({ titulo: 'T', descricao: 'd'.repeat(2500) });
  g.passos.push(criarPasso({ tipo: 'manual', titulo: 'm'.repeat(3000), tituloAuto: false, descricao: 'x'.repeat(2001) }));
  const { blocos } = guiaParaBlocos(g, { uploadIdDoPasso: () => null });
  assert.equal(blocos[1].paragraph.rich_text.length, 2);
  assert.equal(blocos[2].numbered_list_item.rich_text.length, 2);
  assert.equal(blocos[2].numbered_list_item.children[0].paragraph.rich_text.length, 2);
  for (const b of JSON.stringify(blocos).match(/"content":"[^"]*"/g)) assert.ok(b.length <= 2000 + 12);
});

test('250 passos → lotes ≤ 100 de topo e ≤ 1000 no total, na ordem', () => {
  const g = guiaComPassos(250, { comImagem: true, secoes: true });
  const { blocos } = guiaParaBlocos(g, { uploadIdDoPasso: () => 'up' });
  assert.equal(blocos.length, 1 + 250 + 5);
  const lotes = dividirEmLotes(blocos);
  assert.equal(lotes.flat().length, blocos.length);
  assert.deepEqual(lotes.flat(), blocos);
  for (const lote of lotes) {
    assert.ok(lote.length <= 100);
    assert.ok(lote.reduce((s, b) => s + contarBlocos(b), 0) <= 1000);
  }
  assert.deepEqual(lotes.map((l) => l.length), [100, 100, 56]);
  // limite total manda quando os filhos pesam
  const pesados = Array.from({ length: 30 }, () => ({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [], children: Array(99).fill({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }) } }));
  const lotesPesados = dividirEmLotes(pesados);
  assert.deepEqual(lotesPesados.map((l) => l.length), [10, 10, 10]);
  assert.deepEqual(dividirEmLotes([]), []);
  assert.deepEqual(dividirEmLotes(blocos.slice(0, 5), { maxTopo: 2 }).map((l) => l.length), [2, 2, 1]);
});
