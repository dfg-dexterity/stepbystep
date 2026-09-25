import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guiaParaMarkdown, nomeImagemExportada, formatarData, escaparMarkdown } from '../../packages/core/exportar-markdown.js';
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
  assert.equal(linhas[2], '_Diego · 9 passos · ≈ 2 min · 24/09/2026_');   // autor · passos (sem seção) · tempo · data do guia
  assert.equal(linhas[4], guia.descricao);
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

test('escaparMarkdown: pontuação de ênfase, link, HTML e código; início de linha de título, lista e citação', () => {
  assert.equal(escaparMarkdown('Clique em «a]b»'), 'Clique em «a\\]b»');
  assert.equal(escaparMarkdown('Itens [2'), 'Itens \\[2');
  assert.equal(escaparMarkdown('a*b_c`d~e|f&g\\h'), 'a\\*b\\_c\\`d\\~e\\|f\\&g\\\\h');
  assert.equal(escaparMarkdown('<img src=x onerror=alert(1)>'), '\\<img src=x onerror=alert(1)\\>');
  assert.equal(escaparMarkdown('# título\n- item\n+ outro\n> citação\n1. lista\n2) lista\n---\n=== '), '\\# título\n\\- item\n\\+ outro\n\\> citação\n1\\. lista\n2\\) lista\n\\---\n\\=== ');
  assert.equal(escaparMarkdown('  - recuado'), '  \\- recuado');
  assert.equal(escaparMarkdown('Arquivo › Salvar, e-mail 2.0 (v1): ok!'), 'Arquivo › Salvar, e-mail 2.0 (v1): ok!');
  assert.equal(escaparMarkdown(''), '');
  assert.equal(escaparMarkdown(null), '');
});

test('títulos, descrições e alt com [ ] * < saem literais e a imagem continua válida; caminho com espaço/parêntese é codificado', () => {
  const g = criarGuia({ titulo: 'Manual [beta] <v2>', descricao: '# não é título\n*nem ênfase*' });
  g.passos.push(criarPasso({ tipo: 'clicar', titulo: 'Clique em «Fechar ]»', descricao: '- não é lista', captura: { imagemId: 'img_m1x4k9zr01aa', largura: 1, altura: 1, faltante: false } }));
  g.passos.push(criarPasso({ tipo: 'clicar', titulo: 'Clique em «<img src=x onerror=alert(1)>»', captura: { imagemId: 'img_m1x4k9zr02ab', largura: 1, altura: 1, faltante: false } }));
  g.passos.push(criarPasso({ tipo: 'secao', titulo: 'Parte *2* [rev]', tituloAuto: false, descricao: '> sem citação' }));
  g.passos.push(criarPasso({ tipo: 'digitar', titulo: 'Digite «a_b» no campo «Itens [2»', captura: { imagemId: 'img_m1x4k9zr04ad', largura: 1, altura: 1, faltante: false } }));
  const md = guiaParaMarkdown(g, { data: DATA_FIXA, nomeImagem: (p, i) => (i === 3 ? 'pasta (1)/passo 03.png' : nomeImagemExportada(i + 1)) });
  const linhas = md.split('\n');
  assert.equal(linhas[0], '# Manual \\[beta\\] \\<v2\\>');
  assert.match(linhas[2], /^_3 passos · ≈ 1 min · \d{2}\/\d{2}\/\d{4}_$/);
  assert.equal(linhas[4], '\\# não é título');
  assert.equal(linhas[5], '\\*nem ênfase\\*');
  assert.ok(md.includes('\n## 1. Clique em «Fechar \\]»\n\n\\- não é lista\n\n![Passo 1 — Clique em «Fechar \\]»](imagens/passo-01.png)\n'));
  assert.ok(md.includes('\n## 2. Clique em «\\<img src=x onerror=alert(1)\\>»\n'));
  assert.ok(md.includes('![Passo 2 — Clique em «\\<img src=x onerror=alert(1)\\>»](imagens/passo-02.png)'));
  assert.ok(!/(^|[^\\])<img/.test(md), 'todo < sai escapado');
  assert.ok(md.includes('\n## Parte \\*2\\* \\[rev\\]\n\n\\> sem citação\n'));
  assert.ok(md.includes('![Passo 3 — Digite «a\\_b» no campo «Itens \\[2»](pasta%20%281%29/passo%2003.png)'));
  // toda imagem continua sendo uma imagem: alt sem colchete solto e destino sem espaço
  for (const m of md.matchAll(/!\[([^\]\\]|\\.)*\]\(([^\s()]+)\)/g)) assert.ok(m[2].endsWith('.png'), m[0]);
  assert.equal((md.match(/!\[/g) ?? []).length, 3);
  // o rodapé (itálico intencional) não é escapado
  assert.ok(md.endsWith('---\n_Gerado com StepByStep · Dexterity IT Solutions · 24/09/2026_\n'));
});

test('guia vazio e sem título', () => {
  const g = criarGuia();
  delete g.atualizadoEm;   // sem data no guia: a linha de metadados usa a data da exportação
  const md = guiaParaMarkdown(g, { data: DATA_FIXA });
  assert.equal(md, '# Manual sem título\n\n_0 passos · ≈ 1 min · 24/09/2026_\n\n---\n_Gerado com StepByStep · Dexterity IT Solutions · 24/09/2026_\n');
  g.passos.push(criarPasso({ tipo: 'secao', titulo: 'Só uma seção', tituloAuto: false, descricao: 'nota' }));
  assert.ok(guiaParaMarkdown(g, { data: DATA_FIXA }).includes('## Só uma seção\n\nnota\n'));
});

test('notas viram citações com rótulo em negrito, escapadas, depois da descrição e antes da imagem; vazias não saem', () => {
  const g = criarGuia({ titulo: 'T', autor: 'Ana_Maria' });
  g.passos.push(criarPasso({ tipo: 'clicar', titulo: 'Clique em «X»', descricao: 'Desc', captura: { imagemId: 'img_m1x4k9zr01aa', largura: 1, altura: 1, faltante: false }, notas: [
    { id: 'n_m1x4k9zr01n1', tipo: 'dica', texto: 'Use *Ctrl* + [X]' },
    { id: 'n_m1x4k9zr01n2', tipo: 'atencao', texto: '  ' },
    { id: 'n_m1x4k9zr01n3', tipo: 'nota', texto: 'Linha 1\n# linha 2\n\nfim' },
  ] }));
  const md = guiaParaMarkdown(g, { data: DATA_FIXA });
  assert.ok(md.includes('_Ana\\_Maria · 1 passo · ≈ 1 min · '), md.slice(0, 80));
  assert.ok(md.includes('## 1. Clique em «X»\n\nDesc\n\n> **Dica:** Use \\*Ctrl\\* + \\[X\\]\n\n> **Nota:** Linha 1\n> \\# linha 2\n>\n> fim\n\n![Passo 1'), md);
  assert.ok(!md.includes('Atenção'));
});
