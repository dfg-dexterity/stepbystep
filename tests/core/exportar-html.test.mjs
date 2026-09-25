import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guiaParaHtml, escaparHtml, tituloComDestaqueHtml } from '../../packages/core/exportar-html.js';
import { criarGuia, criarPasso } from '../../packages/core/modelo.js';
import { FIXTURES, lerFixture } from './util.mjs';

const DATA_FIXA = new Date('2026-09-24T12:00:00Z');
const CSS = ':root { --dxt-base: #1B1B1B; }\n.passo { break-inside: avoid; }';
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgo=';

const opcoes = () => ({ imagemDataUrl: (p, i) => `${PLACEHOLDER}#${i}`, css: CSS, logoSvg: LOGO, data: DATA_FIXA });

test('snapshot: guia-exemplo.html', () => {
  const html = guiaParaHtml(lerFixture('guia-exemplo'), opcoes());
  const esperado = readFileSync(join(FIXTURES, 'esperado', 'guia-exemplo.html'), 'utf8');
  assert.equal(html, esperado);
});

test('documento autocontido: sem <script src>, sem <link>, css inline, imagens em data:', () => {
  const html = guiaParaHtml(lerFixture('guia-exemplo'), opcoes());
  assert.ok(!/<script\s+src/i.test(html));
  assert.ok(!/<link\b/i.test(html));
  assert.ok(html.includes(`<style>\n${CSS}\n</style>`));
  assert.equal((html.match(/src="data:image/g) ?? []).length, 8);
  assert.ok(html.includes(LOGO));
  assert.ok(html.startsWith('<!doctype html>\n<html lang="pt-BR">'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<title>Cadastrar fornecedor no SAP Fiori</title>'));
});

test('estrutura: cartões dos passos, título com o alvo em negrito, notas, seção como faixa e metadados', () => {
  const html = guiaParaHtml(lerFixture('guia-exemplo'), opcoes());
  assert.equal((html.match(/<li class="passo" data-tipo="/g) ?? []).length, 9);
  assert.equal((html.match(/<h2 class="secao">/g) ?? []).length, 1);
  assert.ok(html.includes('<h2 class="secao">Conferência no SAP GUI</h2>'));
  assert.ok(html.includes('<li class="passo" data-tipo="clicar" id="passo-2">\n      <h2><span class="numero">2</span> <span class="titulo">Clique em <strong>«Criar»</strong></span></h2>'));
  assert.ok(html.includes('<h2><span class="numero">8</span> <span class="titulo">Escolha o menu <strong>«Arquivo › Salvar»</strong></span></h2>'));
  assert.ok(html.includes('<span class="titulo">Digite <strong>«ACME Ltda»</strong> no campo <strong>«Nome»</strong></span>'));
  assert.ok(html.includes('<p class="passo-descricao">Use a razão social completa, sem abreviações.</p>'));
  assert.ok(html.includes(`<figure class="passo-imagem"><img src="${PLACEHOLDER}#1" alt="Passo 2 — Clique em «Criar»"></figure>`));
  assert.ok(html.includes('<ol class="passos">'));
  assert.ok(html.includes('<button type="button" class="no-print" onclick="window.print()">Imprimir / salvar PDF</button>'));
  // cabeçalho: autor · passos numerados (sem a seção) · tempo estimado · data do guia
  assert.ok(html.includes('<p class="meta"><span>Diego</span><span class="sep" aria-hidden="true"> · </span><span>9 passos</span><span class="sep" aria-hidden="true"> · </span><span>≈ 2 min</span><span class="sep" aria-hidden="true"> · </span><span>24/09/2026</span></p>'));
  // notas: caixa com rótulo por tipo, antes da imagem
  assert.ok(html.includes('<aside class="nota nota--dica" role="note">\n          <span class="nota-rotulo">Dica</span>\n          <p class="nota-texto">O botão fica no canto superior direito da lista de parceiros.</p>\n        </aside>'));
  assert.ok(html.includes('<aside class="nota nota--atencao" role="note">\n          <span class="nota-rotulo">Atenção</span>'));
  assert.ok(html.includes('<aside class="nota nota--nota" role="note">\n          <span class="nota-rotulo">Nota</span>'));
  assert.ok(html.indexOf('nota--dica') < html.indexOf(`${PLACEHOLDER}#1`));
});

test('notas vazias ou de tipo desconhecido não saem; texto da nota é escapado e mantém parágrafos', () => {
  const g = criarGuia({ titulo: 'T' });
  g.passos.push(criarPasso({ tipo: 'manual', titulo: 'Passo', tituloAuto: false, notas: [
    { id: 'n_m1x4k9zr01n1', tipo: 'dica', texto: '   ' },
    { id: 'n_m1x4k9zr01n2', tipo: 'perigo', texto: 'x' },
    { id: 'n_m1x4k9zr01n3', tipo: 'atencao', texto: 'Use <b>isto</b>\nlinha 2\n\nparágrafo 2' },
  ] }));
  const html = guiaParaHtml(g, opcoes());
  assert.equal((html.match(/<aside class="nota/g) ?? []).length, 1);
  assert.ok(html.includes('<p class="nota-texto">Use &lt;b&gt;isto&lt;/b&gt;<br>linha 2</p>\n          <p class="nota-texto">parágrafo 2</p>'));
  assert.ok(html.includes('<span>1 passo</span>'));
});

test('tituloComDestaqueHtml: só os pares «» mais externos ficam em negrito, com escape', () => {
  assert.equal(tituloComDestaqueHtml('Clique em «<Criar>» agora'), 'Clique em <strong>«&lt;Criar&gt;»</strong> agora');
  assert.equal(tituloComDestaqueHtml('«a«b» c'), '«a<strong>«b»</strong> c');
  assert.equal(tituloComDestaqueHtml('Pressione Enter'), 'Pressione Enter');
});

test('escapa HTML nos textos', () => {
  const g = criarGuia({ titulo: 'A <b>& "B"</b>' });
  g.passos.push(criarPasso({ tipo: 'manual', titulo: '<script>alert(1)</script>', tituloAuto: false, descricao: "x < y & z > 'w'" }));
  const html = guiaParaHtml(g, opcoes());
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<title>A &lt;b&gt;&amp; &quot;B&quot;&lt;/b&gt;</title>'));
  assert.ok(html.includes('x &lt; y &amp; z &gt; &#39;w&#39;'));
  assert.equal(escaparHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('passo sem imagem ou com data url nula não gera <img>', () => {
  const g = lerFixture('guia-exemplo');
  const html = guiaParaHtml(g, { ...opcoes(), imagemDataUrl: (p, i) => (i === 1 ? PLACEHOLDER : null) });
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  const vazio = guiaParaHtml(criarGuia(), { css: '' });
  assert.ok(vazio.includes('<h1>Manual sem título</h1>'));
  assert.ok(vazio.includes('<span>0 passos</span><span class="sep" aria-hidden="true"> · </span><span>≈ 1 min</span>'));
});
