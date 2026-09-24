import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guiaParaMarkdown, nomeImagemExportada, formatarData } from '../../packages/core/exportar-markdown.js';
import { criarGuia, criarPasso } from '../../packages/core/modelo.js';
import { FIXTURES, lerFixture } from './util.mjs';

// meio-dia UTC: é 24/09/2026 em qualquer fuso entre -12 e +11
export const DATA_FIXA = new Date('2026-09-24T12:00:00Z');

test('nomeImagemExportada: 2 dígitos, 3 a partir de 100', () => {
  assert.equal(nomeImagemExportada(1), 'imagens/passo-01.png');
  assert.equal(nomeImagemExportada(42), 'imagens/passo-42.png');
  assert.equal(nomeImagemExportada(99), 'imagens/passo-99.png');
  assert.equal(nomeImagemExportada(100), 'imagens/passo-100.png');
  assert.equal(nomeImagemExportada(123), 'imagens/passo-123.png');
});

test('formatarData dd/mm/aaaa', () => {
  assert.equal(formatarData(DATA_FIXA), '24/09/2026');
  assert.equal(formatarData(new Date(2026, 0, 5, 12)), '05/01/2026');
});

test('snapshot: guia-exemplo.md', () => {
  const guia = lerFixture('guia-exemplo');
  const md = guiaParaMarkdown(guia, { data: DATA_FIXA });
  const esperado = readFileSync(join(FIXTURES, 'esperado', 'guia-exemplo.md'), 'utf8');
  assert.equal(md, esperado);
});

test('estrutura: título, descrição, numeração que pula seções, imagens só onde há captura, rodapé', () => {
  const guia = lerFixture('guia-exemplo');
  const md = guiaParaMarkdown(guia, { data: DATA_FIXA });
  const linhas = md.split('\n');
  assert.equal(linhas[0], '# Cadastrar fornecedor no SAP Fiori');
  assert.equal(linhas[2], guia.descricao);
  assert.ok(md.includes('\n## 1. Navegue para fiori.empresa.com.br/ui\n'));
  assert.ok(md.includes('\n## 7. Marque «Aceito os termos»\n'));
  assert.ok(md.includes('\n## Conferência no SAP GUI\n'));      // seção sem número
  assert.ok(!md.includes('## 8. Conferência'));
  assert.ok(md.includes('\n## 8. Escolha o menu «Arquivo › Salvar»\n'));
  assert.ok(md.includes('\n## 9. Confira o e-mail de confirmação\n'));
  assert.ok(md.includes('![Passo 2 — Clique em «Criar»](imagens/passo-02.png)'));
  assert.ok(md.includes('![Passo 8 — Escolha o menu «Arquivo › Salvar»](imagens/passo-08.png)'));
  assert.equal((md.match(/!\[Passo/g) ?? []).length, 8);        // 10 passos − seção − manual sem imagem
  assert.ok(md.includes('Use a razão social completa, sem abreviações.'));
  assert.ok(md.endsWith('---\n_Gerado com StepByStep · Dexterity IT Solutions · 24/09/2026_\n'));
});

test('nomeImagem injetado pode omitir imagens', () => {
  const guia = lerFixture('guia-exemplo');
  const md = guiaParaMarkdown(guia, { data: DATA_FIXA, nomeImagem: (p, i) => (i === 1 ? 'x/y.png' : null) });
  assert.equal((md.match(/!\[/g) ?? []).length, 1);
  assert.ok(md.includes('](x/y.png)'));
});

test('guia vazio e sem título', () => {
  const g = criarGuia();
  const md = guiaParaMarkdown(g, { data: DATA_FIXA });
  assert.equal(md, '# Manual sem título\n\n---\n_Gerado com StepByStep · Dexterity IT Solutions · 24/09/2026_\n');
  g.passos.push(criarPasso({ tipo: 'secao', titulo: 'Só uma seção', tituloAuto: false, descricao: 'nota' }));
  assert.ok(guiaParaMarkdown(g, { data: DATA_FIXA }).includes('## Só uma seção\n\nnota\n'));
});
