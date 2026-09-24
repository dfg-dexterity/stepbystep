// Bootstrap do editor: detecção de ambiente (extensão × hospedado), roteador por hash e ligação
// dos módulos. Nenhuma regra de negócio aqui: modelo, frases, render e exportadores vêm de ../core.
import { TOKENS_COR } from '../core/modelo.js';
import { obterConfig, salvarConfig, carregarGuia as lerGuiaDoBanco, excluirImagensOrfas } from '../core/armazenamento.js';
import { estado, on, carregarGuia, fecharGuia, passoAtual, definirFerramenta, ehEditavel } from './estado.js';
import * as historico from './historico.js';
import { montarBiblioteca } from './biblioteca.js';
import { montarListaPassos, inserirManual } from './lista-passos.js';
import { montarCanvas, limparBitmaps } from './canvas-anotacao.js';
import { ligarFerramentas, FERRAMENTAS, ICONES, opcoesFerramenta, focarNoAlvo, recortarAJanela, removerRecorte } from './ferramentas.js';
import { montarPainel, anexarImagemAoPasso, colarImagem, NOMES_COR } from './painel-passo.js';
import { exportarPacote, exportarMarkdown, exportarHtml, imprimir } from './exportar.js';
import { abrirNotion } from './notion-dialogo.js';
import { abrirMenu } from './componentes/menu.js';
import { abrirDialogo } from './componentes/dialogo.js';
import { avisar } from './componentes/aviso.js';

export const VERSAO = '0.1.0';
export const naExtensao = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
/** Base da API do Notion: direto na extensão (host_permissions), via proxy no editor hospedado. */
export let baseNotion = naExtensao ? 'https://api.notion.com' : '/api/notion';

const NIVEIS_ZOOM = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
const LIMITE_AVISO_ARMAZENAMENTO = 500 * 1024 * 1024;
const app = document.getElementById('app');
let tela = null; // { tipo: 'biblioteca'|'editor', id?, destruir }
let avisouArmazenamento = false;

const clonarTemplate = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);
const formatarBytes = (n) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB` : `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB`);

async function atualizarArmazenamento(elemento) {
  if (!elemento || !navigator.storage?.estimate) return;
  try {
    const { usage = 0 } = await navigator.storage.estimate();
    elemento.textContent = `${formatarBytes(usage)} em uso`;
    elemento.title = 'Espaço ocupado pelos guias e imagens neste navegador';
    if (usage > LIMITE_AVISO_ARMAZENAMENTO && !avisouArmazenamento) {
      avisouArmazenamento = true;
      avisar(`O armazenamento local passou de ${formatarBytes(LIMITE_AVISO_ARMAZENAMENTO)}. Exporte os guias antigos como .stepbystep.zip e exclua-os da biblioteca.`, { tipo: 'atencao', duracao: 12000 });
    }
  } catch { elemento.textContent = ''; }
}

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------
async function fecharTela() {
  if (!tela) return;
  const t = tela;
  tela = null;
  if (t.tipo === 'editor') {
    await historico.salvarAgora();
    const guia = estado.guia;
    t.destruir();
    limparBitmaps();
    fecharGuia();
    historico.limpar();
    document.body.classList.remove('modo-editor');
    if (guia) excluirImagensOrfas(guia).catch((e) => console.warn('Limpeza de imagens órfãs falhou', e));
  } else {
    t.destruir();
  }
}

async function abrirBiblioteca({ importar = false } = {}) {
  if (tela?.tipo === 'biblioteca') { if (importar) tela.abrirImportacao(); return; }
  await fecharTela();
  const raiz = clonarTemplate('tpl-biblioteca');
  app.replaceChildren(raiz);
  document.title = 'StepByStep — Biblioteca';
  document.getElementById('nav-biblioteca')?.setAttribute('aria-current', 'page');
  const bib = montarBiblioteca(raiz, { naExtensao, versao: VERSAO, abrirGuia: (id) => { location.hash = `#/guia/${encodeURIComponent(id)}`; } });
  tela = { tipo: 'biblioteca', destruir: bib.destruir, abrirImportacao: bib.abrirImportacao };
  atualizarArmazenamento(raiz.querySelector('#biblioteca-armazenamento'));
  if (importar) bib.abrirImportacao();
}

async function abrirEditor(id) {
  if (tela?.tipo === 'editor' && tela.id === id) return;
  await fecharTela();
  let guia = null;
  try { guia = await lerGuiaDoBanco(id); } catch (e) { console.error(e); }
  if (!guia) {
    avisar('Guia não encontrado na biblioteca deste navegador.', { tipo: 'erro' });
    location.hash = '#/';
    return;
  }
  const raiz = clonarTemplate('tpl-editor');
  app.replaceChildren(raiz);
  document.body.classList.add('modo-editor');
  document.getElementById('nav-biblioteca')?.removeAttribute('aria-current');
  historico.limpar();
  carregarGuia(guia);
  salvarConfig('editor.ultimoGuia', id).catch(() => {});
  const partes = ligarEditor(raiz);
  tela = { tipo: 'editor', id, destruir: partes.destruir };
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function ligarEditor(raiz) {
  const cancelamentos = [];
  const tituloGuia = raiz.querySelector('#guia-titulo');
  const resumo = raiz.querySelector('#editor-resumo');
  const contagem = raiz.querySelector('#lista-contagem');

  const canvas = montarCanvas(raiz.querySelector('#canvas-wrap'), {
    aoAnexar: (arquivo) => { const p = passoAtual(); if (p) anexarImagemAoPasso(p.id, arquivo); },
  });
  const ferramentas = ligarFerramentas(canvas);
  const lista = montarListaPassos(raiz.querySelector('#lista-passos'));
  const painel = montarPainel(raiz.querySelector('#painel-passo'));
  montarBarraFerramentas(raiz.querySelector('#ferramentas'), canvas, cancelamentos);
  ligarRodape(raiz, cancelamentos);
  ligarAbas(raiz);

  function sincronizarCabecalho() {
    const g = estado.guia;
    if (!g) return;
    if (document.activeElement !== tituloGuia && tituloGuia.value !== g.titulo) tituloGuia.value = g.titulo;
    const n = g.passos.length;
    const semImagem = g.passos.filter((p) => p.captura?.faltante).length;
    resumo.textContent = `${n} ${n === 1 ? 'passo' : 'passos'}${semImagem ? ` · ${semImagem} sem imagem` : ''}`;
    resumo.classList.toggle('dxt-badge--down', semImagem > 0);
    contagem.textContent = String(n);
    document.title = `${g.titulo || 'Guia'} — StepByStep`;
  }
  tituloGuia.addEventListener('input', () => historico.aplicar('editar título do guia', (g) => { g.titulo = tituloGuia.value; }, { coalescer: 'guia:titulo' }));
  cancelamentos.push(on('mudou', ({ motivo }) => { if (motivo === 'guia') sincronizarCabecalho(); }));
  sincronizarCabecalho();

  raiz.querySelector('#btn-novo-passo').addEventListener('click', () => {
    inserirManual(estado.passoAtualId, 'depois');
    ativarAba(raiz, 'detalhes', { soSeEstreito: true });
    raiz.querySelector('#passo-titulo')?.focus();
    raiz.querySelector('#passo-titulo')?.select();
  });

  const removerAtalhos = historico.instalarAtalhos();
  const aoColar = (e) => { if (!ehEditavel(e.target)) colarImagem(e); };
  document.addEventListener('paste', aoColar);

  return {
    destruir() {
      removerAtalhos();
      document.removeEventListener('paste', aoColar);
      for (const c of cancelamentos) c();
      ferramentas.destruir();
      lista.destruir();
      painel.destruir();
      canvas.destruir();
    },
  };
}

const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };

function montarBarraFerramentas(barra, canvas, cancelamentos) {
  // ferramentas
  const grupo = el('div', 'ferramentas-grupo');
  grupo.setAttribute('role', 'toolbar');
  grupo.setAttribute('aria-label', 'Ferramentas de anotação');
  const botoes = new Map();
  for (const f of FERRAMENTAS) {
    const b = el('button', 'ferramenta-btn');
    b.type = 'button';
    b.dataset.ferramenta = f.id;
    b.title = `${f.rotulo} — ${f.dica} (${f.tecla})`;
    b.setAttribute('aria-label', f.rotulo);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = ICONES[f.id] ?? '';
    b.append(el('kbd', '', f.tecla));
    b.addEventListener('click', () => definirFerramenta(f.id));
    grupo.append(b);
    botoes.set(f.id, b);
  }

  // cor das anotações novas
  const grupoCor = el('div', 'ferramentas-grupo');
  const cor = el('select', 'dxt-select dxt-select--sm');
  cor.id = 'ferramenta-cor';
  cor.title = 'Cor das anotações novas';
  cor.setAttribute('aria-label', 'Cor das anotações novas');
  for (const t of TOKENS_COR) { const o = el('option', '', NOMES_COR[t]); o.value = t; cor.append(o); }
  cor.value = opcoesFerramenta.cor;
  cor.addEventListener('change', () => { opcoesFerramenta.cor = cor.value; });
  const fundo = el('input');
  fundo.type = 'checkbox';
  fundo.id = 'ferramenta-fundo';
  fundo.checked = opcoesFerramenta.fundoTexto;
  fundo.addEventListener('change', () => { opcoesFerramenta.fundoTexto = fundo.checked; });
  const rotuloFundo = el('label', 'campo-check campo-check--mono');
  rotuloFundo.htmlFor = fundo.id;
  rotuloFundo.append(fundo, document.createTextNode(' Fundo no texto'));
  grupoCor.append(cor, rotuloFundo);

  // ações do recorte
  const grupoRecorte = el('div', 'ferramentas-grupo ferramentas-recorte');
  const btnFocar = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm', 'Focar no alvo');
  btnFocar.type = 'button'; btnFocar.id = 'btn-focar-alvo'; btnFocar.addEventListener('click', focarNoAlvo);
  const btnJanela = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm', 'Recortar à janela');
  btnJanela.type = 'button'; btnJanela.id = 'btn-recortar-janela'; btnJanela.addEventListener('click', recortarAJanela);
  const btnRemover = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm', 'Remover recorte');
  btnRemover.type = 'button'; btnRemover.id = 'btn-remover-recorte'; btnRemover.addEventListener('click', removerRecorte);
  grupoRecorte.append(btnFocar, btnJanela, btnRemover);

  // zoom
  const grupoZoom = el('div', 'ferramentas-grupo ferramentas-zoom');
  const menos = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm dxt-btn--icon', '−');
  menos.type = 'button'; menos.id = 'zoom-menos'; menos.title = 'Diminuir zoom';
  const valor = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm zoom-valor dxt-num', '100%');
  valor.type = 'button'; valor.id = 'zoom-valor'; valor.title = 'Ajustar à largura';
  const mais = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm dxt-btn--icon', '+');
  mais.type = 'button'; mais.id = 'zoom-mais'; mais.title = 'Aumentar zoom';
  const passoZoom = (direcao) => {
    const z = estado.zoom;
    const proximo = direcao > 0 ? NIVEIS_ZOOM.find((n) => n > z + 1e-6) : [...NIVEIS_ZOOM].reverse().find((n) => n < z - 1e-6);
    if (proximo !== undefined) canvas.definirZoomManual(proximo);
  };
  menos.addEventListener('click', () => passoZoom(-1));
  mais.addEventListener('click', () => passoZoom(1));
  valor.addEventListener('click', () => canvas.ajustarZoom());
  grupoZoom.append(menos, valor, mais);

  barra.append(grupo, grupoCor, grupoRecorte, grupoZoom);

  function atualizar() {
    for (const [id, b] of botoes) {
      const ativa = estado.ferramenta === id;
      b.classList.toggle('is-ativa', ativa);
      b.setAttribute('aria-pressed', String(ativa));
    }
    grupoRecorte.hidden = estado.ferramenta !== 'recorte';
    rotuloFundo.hidden = estado.ferramenta !== 'texto';   // só faz sentido para a ferramenta de texto
    valor.textContent = `${Math.round(estado.zoom * 100)}%`;
    valor.classList.toggle('is-ativa', canvas.emAjuste());
  }
  cancelamentos.push(on('mudou', ({ motivo }) => { if (motivo === 'ferramenta' || motivo === 'zoom' || motivo === 'guia') atualizar(); }));
  atualizar();
}

function ligarRodape(raiz, cancelamentos) {
  const btnDesfazer = raiz.querySelector('#btn-desfazer');
  const btnRefazer = raiz.querySelector('#btn-refazer');
  const btnSalvar = raiz.querySelector('#btn-salvar');
  const btnExportar = raiz.querySelector('#btn-exportar');
  const btnNotion = raiz.querySelector('#btn-notion');
  const estadoSalvamento = raiz.querySelector('#estado-salvamento');
  const armazenamento = raiz.querySelector('#armazenamento');

  function atualizarHistorico() {
    btnDesfazer.disabled = !historico.podeDesfazer();
    btnRefazer.disabled = !historico.podeRefazer();
    btnDesfazer.title = historico.podeDesfazer() ? `Desfazer: ${historico.descricaoDesfazer()} (Ctrl/⌘+Z)` : 'Nada para desfazer';
    btnRefazer.title = historico.podeRefazer() ? `Refazer: ${historico.descricaoRefazer()} (Ctrl/⌘+Shift+Z)` : 'Nada para refazer';
  }
  btnDesfazer.addEventListener('click', () => historico.desfazer());
  btnRefazer.addEventListener('click', () => historico.refazer());
  btnSalvar.addEventListener('click', async () => { await historico.salvarAgora(); avisar('Guia salvo neste navegador.', { tipo: 'sucesso', duracao: 2000 }); });
  cancelamentos.push(on('mudou', ({ motivo }) => { if (motivo === 'guia') atualizarHistorico(); }));
  cancelamentos.push(on('salvamento', ({ estado: s, em }) => {
    const hora = em ? new Date(em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    estadoSalvamento.textContent = s === 'salvando' ? 'Salvando…' : s === 'salvo' ? `Salvo ${hora}` : s === 'erro' ? 'Erro ao salvar' : 'Alterações pendentes';
    estadoSalvamento.classList.toggle('rodape-estado--erro', s === 'erro');
    if (s === 'erro') avisar('Não foi possível gravar o guia no navegador. Exporte um .stepbystep.zip para não perder o trabalho.', { tipo: 'erro' });
    if (s === 'salvo') atualizarArmazenamento(armazenamento);
  }));
  atualizarHistorico();
  atualizarArmazenamento(armazenamento);

  const executar = async (fn) => {
    try { await historico.salvarAgora(); await fn(); } catch (e) { console.error(e); avisar(e?.message || 'A exportação falhou.', { tipo: 'erro' }); }
  };
  btnExportar.addEventListener('click', () => abrirMenu(btnExportar, [
    { rotulo: 'Pacote .stepbystep.zip (backup)', acao: () => executar(() => exportarPacote(estado.guia)) },
    { rotulo: 'Markdown + imagens (.zip)…', acao: () => dialogoMarkdown(executar) },
    { rotulo: 'HTML autocontido', acao: () => executar(() => exportarHtml(estado.guia)) },
    { rotulo: 'Imprimir / salvar PDF', acao: () => {
      // a aba precisa abrir dentro da ativação do usuário; o conteúdo chega depois
      const janela = window.open('', '_blank');
      executar(() => imprimir(estado.guia, { janela }));
    } },
  ], { alinhar: 'direita' }));
  btnNotion.addEventListener('click', () => abrirNotion({ baseNotion, naExtensao }));
}

function dialogoMarkdown(executar) {
  const conteudo = el('div');
  conteudo.append(el('p', 'dialogo-mensagem', 'Gera um zip com README.md e as imagens dos passos já com recorte, desfoque e marcações aplicados (imagens/passo-NN.png).'));
  const check = el('input');
  check.type = 'checkbox';
  check.id = 'exportar-reduzir';
  const rotulo = el('label', 'campo-check');
  rotulo.htmlFor = check.id;
  rotulo.append(check, document.createTextNode(' Reduzir imagens a 1× (metade do tamanho das capturas Retina)'));
  conteudo.append(rotulo);
  const d = abrirDialogo({ titulo: 'Exportar Markdown + imagens', conteudo, botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Exportar', valor: 'exportar', primario: true }] });
  d.caixa.querySelector('.dialogo-botoes .dxt-btn:not(.dxt-btn--ghost)')?.setAttribute('id', 'exportar-markdown-confirmar');
  d.promessa.then((v) => { if (v === 'exportar') executar(() => exportarMarkdown(estado.guia, { reduzir1x: check.checked })); });
}

const ESTREITO = window.matchMedia('(max-width: 900px)');
function ativarAba(raiz, nome, { soSeEstreito = false } = {}) {
  if (soSeEstreito && !ESTREITO.matches) return;
  for (const b of raiz.querySelectorAll('.editor-abas button')) {
    const ativa = b.dataset.aba === nome;
    b.classList.toggle('is-ativa', ativa);
    b.setAttribute('aria-pressed', String(ativa));
  }
  for (const c of raiz.querySelectorAll('.editor-col')) c.classList.toggle('is-ativa', c.dataset.col === nome);
}
function ligarAbas(raiz) {
  for (const b of raiz.querySelectorAll('.editor-abas button')) b.addEventListener('click', () => ativarAba(raiz, b.dataset.aba));
}

// ---------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------
async function rotear() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/guia\/([^/?#]+)/);
  if (m) return abrirEditor(decodeURIComponent(m[1]));
  if (/^#\/importar/.test(hash)) return abrirBiblioteca({ importar: true });
  return abrirBiblioteca();
}

async function iniciar() {
  const ambiente = document.getElementById('ambiente');
  if (ambiente && naExtensao) { ambiente.hidden = false; ambiente.textContent = 'extensão'; }
  try {
    // permite apontar o Notion para outro endereço (ex.: servidor falso nos testes)
    const base = await obterConfig('notion.base');
    if (typeof base === 'string' && base) baseNotion = base;
  } catch (e) { console.warn('Config indisponível', e); }
  window.addEventListener('hashchange', () => { rotear().catch(erro); });
  await rotear();
}

function erro(e) {
  console.error(e);
  avisar(e?.message || 'Algo deu errado.', { tipo: 'erro' });
}

iniciar().catch(erro);
