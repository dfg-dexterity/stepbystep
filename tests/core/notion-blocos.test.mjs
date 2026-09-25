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

test('richTextComDestaque casa o par mais externo; «» sem par ficam literais (títulos editados ou importados)', () => {
  const b = (content) => ({ type: 'text', text: { content }, annotations: { bold: true } });
  const n = (content) => ({ type: 'text', text: { content } });
  assert.deepEqual(richTextComDestaque('Digite ««ok»» no campo «Obs»'), [n('Digite '), b('««ok»»'), n(' no campo '), b('«Obs»')]);
  assert.deepEqual(richTextComDestaque('Clique em «Item »1«»'), [n('Clique em '), b('«Item »'), n('1'), b('«»')]);
  assert.deepEqual(richTextComDestaque('Digite «a»b» no campo «X»'), [n('Digite '), b('«a»'), n('b» no campo '), b('«X»')]);
  assert.deepEqual(richTextComDestaque('«aberto sem fechar'), [n('«aberto sem fechar')]);
  assert.deepEqual(richTextComDestaque('fecha» sem abrir «Nome»'), [n('fecha» sem abrir '), b('«Nome»')]);
  assert.deepEqual(richTextComDestaque('«a«b» c'), [n('«a'), b('«b»'), n(' c')]);
  assert.deepEqual(richTextComDestaque('«😀»'), [b('«😀»')]);
  // o texto concatenado é sempre o título original
  for (const t of ['Digite ««ok»» no campo «Obs»', 'Clique em «Item »1«»', '«a«b» c', 'x»»«']) {
    assert.equal(richTextComDestaque(t).map((p) => p.text.content).join(''), t);
  }
});

test('contarBlocos conta filhos recursivamente', () => {
  const folha = { object: 'block', type: 'paragraph', paragraph: { rich_text: [] } };
  assert.equal(contarBlocos(folha), 1);
  const item = { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [], children: [folha, folha] } };
  assert.equal(contarBlocos(item), 3);
});

test('guiaParaBlocos: callout de resumo, descrição, heading_3 "n. título" com destaque, descrição, callouts das notas, imagem e heading_2 para seção', () => {
  const g = lerFixture('guia-exemplo');
  const { titulo, blocos, origem } = guiaParaBlocos(g, { uploadIdDoPasso: (p) => (p.captura?.imagemId ? `up-${p.id}` : null), data: DATA_FIXA });
  assert.equal(titulo, 'Cadastrar fornecedor no SAP Fiori');
  assert.equal(blocos[0].type, 'callout');
  assert.deepEqual(blocos[0].callout.icon, { type: 'emoji', emoji: '📘' });
  assert.equal(blocos[0].callout.color, 'gray_background');
  assert.equal(texto(blocos[0].callout.rich_text), 'Diego · 9 passos · ≈ 2 min · 24/09/2026');
  assert.equal(blocos[1].type, 'paragraph');
  assert.equal(texto(blocos[1].paragraph.rich_text), g.descricao);
  // sem aninhamento: tudo de topo, uma sequência por passo
  assert.deepEqual(blocos.map((b) => b.type), [
    'callout', 'paragraph',
    'heading_3', 'image',                                  // 1 navegar
    'heading_3', 'callout', 'image',                       // 2 clicar + dica
    'heading_3', 'paragraph', 'image',                     // 3 digitar + descrição
    'heading_3', 'callout', 'image',                       // 4 senha + atenção
    'heading_3', 'image', 'heading_3', 'image', 'heading_3', 'image',   // 5, 6, 7
    'heading_2',                                           // seção
    'heading_3', 'image',                                  // 8
    'heading_3', 'paragraph', 'callout',                   // 9 manual sem imagem + descrição + nota
  ]);
  assert.deepEqual(origem, [-1, -1, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 9, 9]);
  for (const b of blocos) { assert.equal(b.object, 'block'); assert.equal('children' in b[b.type], false); }
  // título do passo: número no texto (seções não reiniciam nada) e alvo em negrito
  assert.deepEqual(blocos[4].heading_3.rich_text, [
    { type: 'text', text: { content: '2. ' } },
    { type: 'text', text: { content: 'Clique em ' } },
    { type: 'text', text: { content: '«Criar»' }, annotations: { bold: true } },
  ]);
  assert.deepEqual(blocos[6], { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: 'up-p_m1x4k9zr02ab' }, caption: [{ type: 'text', text: { content: 'Passo 2' } }] } });
  // notas: callout com emoji e cor por tipo, rótulo em negrito
  assert.deepEqual(blocos[5], { object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '💡' }, color: 'green_background', rich_text: [
    { type: 'text', text: { content: 'Dica: ' }, annotations: { bold: true } },
    { type: 'text', text: { content: 'O botão fica no canto superior direito da lista de parceiros.' } },
  ] } });
  assert.deepEqual([blocos[11].callout.icon.emoji, blocos[11].callout.color, texto(blocos[11].callout.rich_text)], ['⚠️', 'orange_background', 'Atenção: Nunca compartilhe sua senha: o campo sai desfocado no manual.']);
  assert.deepEqual([blocos[24].callout.icon.emoji, blocos[24].callout.color, texto(blocos[24].callout.rich_text)], ['📝', 'purple_background', 'Nota: Se o e-mail não chegar, confira a caixa de spam.']);
  assert.equal(texto(blocos[8].paragraph.rich_text), 'Use a razão social completa, sem abreviações.');
  assert.equal(texto(blocos[19].heading_2.rich_text), 'Conferência no SAP GUI');
  // passo depois da seção continua a numeração global
  assert.equal(texto(blocos[20].heading_3.rich_text), '8. Escolha o menu «Arquivo › Salvar»');
  assert.ok(JSON.stringify(blocos).indexOf('null') === -1, 'nunca null em campos opcionais');
});

test('passo sem imagem/descrição/notas vira só o heading_3; notas vazias ou de tipo desconhecido não saem', () => {
  const g = criarGuia({ titulo: 'T' });
  g.passos.push(criarPasso({ tipo: 'manual', titulo: 'Só texto', tituloAuto: false, notas: [{ id: 'n_m1x4k9zr01n1', tipo: 'dica', texto: ' ' }, { id: 'n_m1x4k9zr01n2', tipo: 'x', texto: 'a' }] }));
  g.passos.push(criarPasso({ tipo: 'clicar', titulo: 'Clique em «X»', captura: { imagemId: 'img_m1x4k9zr01aa', largura: 1, altura: 1, faltante: false } }));
  const { blocos } = guiaParaBlocos(g, { uploadIdDoPasso: () => null, data: DATA_FIXA });
  assert.deepEqual(blocos.map((b) => b.type), ['callout', 'heading_3', 'heading_3']);   // sem uploadId não há imagem
  assert.equal(texto(blocos[1].heading_3.rich_text), '1. Só texto');
  assert.equal(texto(blocos[2].heading_3.rich_text), '2. Clique em «X»');
  assert.match(texto(blocos[0].callout.rich_text), /^2 passos · ≈ 1 min · \d{2}\/\d{2}\/\d{4}$/);   // sem autor
  const semTitulo = guiaParaBlocos(criarGuia(), { uploadIdDoPasso: () => null });
  assert.equal(semTitulo.titulo, 'Manual sem título');
  assert.equal(semTitulo.blocos.length, 1);
});

test('texto > 2000 chars é fatiado dentro do bloco (descrições, título e nota)', () => {
  const g = criarGuia({ titulo: 'T', descricao: 'd'.repeat(2500) });
  g.passos.push(criarPasso({ tipo: 'manual', titulo: 'm'.repeat(3000), tituloAuto: false, descricao: 'x'.repeat(2001), notas: [{ id: 'n_m1x4k9zr01n1', tipo: 'atencao', texto: 'n'.repeat(4001) }] }));
  const { blocos } = guiaParaBlocos(g, { uploadIdDoPasso: () => null });
  assert.equal(blocos[1].paragraph.rich_text.length, 2);
  assert.equal(blocos[2].heading_3.rich_text.length, 3);        // "1. " + 2000 + 1000
  assert.equal(blocos[3].paragraph.rich_text.length, 2);
  assert.equal(blocos[4].callout.rich_text.length, 4);          // rótulo + 2000 + 2000 + 1
  for (const b of JSON.stringify(blocos).match(/"content":"[^"]*"/g)) assert.ok(b.length <= 2000 + 12);
});

test('250 passos → lotes ≤ 100 de topo e ≤ 1000 no total, na ordem', () => {
  const g = guiaComPassos(250, { comImagem: true, secoes: true });
  const { blocos } = guiaParaBlocos(g, { uploadIdDoPasso: () => 'up' });
  // callout + por passo heading_3 + image (+ paragraph nos ímpares) + 5 seções
  assert.equal(blocos.length, 1 + 250 * 2 + 125 + 5);
  const lotes = dividirEmLotes(blocos);
  assert.equal(lotes.flat().length, blocos.length);
  assert.deepEqual(lotes.flat(), blocos);
  for (const lote of lotes) {
    assert.ok(lote.length <= 100);
    assert.ok(lote.reduce((s, b) => s + contarBlocos(b), 0) <= 1000);
  }
  assert.deepEqual(lotes.map((l) => l.length), [100, 100, 100, 100, 100, 100, 31]);
  // limite total manda quando os filhos pesam
  const pesados = Array.from({ length: 30 }, () => ({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [], children: Array(99).fill({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }) } }));
  const lotesPesados = dividirEmLotes(pesados);
  assert.deepEqual(lotesPesados.map((l) => l.length), [10, 10, 10]);
  assert.deepEqual(dividirEmLotes([]), []);
  assert.deepEqual(dividirEmLotes(blocos.slice(0, 5), { maxTopo: 2 }).map((l) => l.length), [2, 2, 1]);
});
