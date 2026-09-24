import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guiaParaHtml, escaparHtml } from '../../packages/core/exportar-html.js';
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

test('estrutura dos passos e da seção', () => {
  const html = guiaParaHtml(lerFixture('guia-exemplo'), opcoes());
  assert.equal((html.match(/<li class="passo" data-tipo="/g) ?? []).length, 9);
  assert.equal((html.match(/<h2 class="secao">/g) ?? []).length, 1);
  assert.ok(html.includes('<h2 class="secao">Conferência no SAP GUI</h2>'));
  assert.ok(html.includes('<li class="passo" data-tipo="clicar">\n      <h2><span class="numero">2</span> Clique em «Criar»</h2>'));
  assert.ok(html.includes('<h2><span class="numero">8</span> Escolha o menu «Arquivo › Salvar»</h2>'));
  assert.ok(html.includes('<p>Use a razão social completa, sem abreviações.</p>'));
  assert.ok(html.includes(`<img src="${PLACEHOLDER}#1" alt="Passo 2 — Clique em «Criar»">`));
  assert.ok(html.includes('<ol class="passos">'));
  assert.ok(html.includes('<button type="button" class="no-print" onclick="window.print()">Imprimir / salvar PDF</button>'));
  assert.ok(html.includes('<span class="numero">10</span> passos · 24/09/2026'));
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
  assert.ok(vazio.includes('<span class="numero">0</span> passos'));
});
