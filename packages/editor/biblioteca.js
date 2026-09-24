// Tela inicial: guias salvos (cartões), importar (arquivo/zip/pasta e arrastar), novo guia manual,
// banner âmbar de gravação interrompida.
import { listarGuias, excluirGuia, salvarGuia, carregarGuia } from '../core/armazenamento.js';
import { criarGuia } from '../core/modelo.js';
import { entradasDeInput, entradasDeDataTransfer, importarEntradas } from './importar.js';
import { abrirDialogo, confirmar, perguntar } from './componentes/dialogo.js';
import { avisar } from './componentes/aviso.js';

const NOMES_ORIGEM = { extensao: 'Extensão', mac: 'Mac', manual: 'Manual' };
const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };
const formatarData = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/** Diálogo "substituir ou duplicar" para conflito de id. */
function resolverConflito(existente) {
  const p = el('p', 'dialogo-mensagem');
  p.textContent = `Já existe um guia com este id na biblioteca: «${existente.titulo || 'Sem título'}» (${existente.passos?.length ?? 0} passos, ${formatarData(existente.atualizadoEm)}). Substituir o guia existente ou importar como uma cópia?`;
  return abrirDialogo({
    titulo: 'Guia já existe',
    conteudo: p,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Substituir', valor: 'substituir', perigo: true }, { rotulo: 'Duplicar', valor: 'duplicar', primario: true }],
  }).promessa;
}

/**
 * @param {HTMLElement} raiz
 * @param {{naExtensao:boolean, versao:string, abrirGuia:(id:string)=>void}} opcoes
 */
export function montarBiblioteca(raiz, opcoes) {
  const banner = raiz.querySelector('#biblioteca-banner');
  const lista = raiz.querySelector('#biblioteca-lista');
  const btnNovo = raiz.querySelector('#btn-novo-guia');
  const btnImportar = raiz.querySelector('#btn-importar');
  let destruido = false;

  async function renderizar() {
    let guias = [];
    try { guias = await listarGuias(); } catch (e) { console.error(e); avisar('Não foi possível ler a biblioteca (IndexedDB indisponível?).', { tipo: 'erro' }); }
    if (destruido) return;

    banner.replaceChildren();
    const interrompidos = guias.filter((g) => g.estado === 'gravando' || g.estado === 'interrompido');
    for (const g of interrompidos) {
      const b = el('div', 'banner banner--atencao');
      b.setAttribute('role', 'status');
      if (g.estado === 'gravando') {
        // o gravador ainda insere passos: abrir no editor gravaria por cima deles (o editor recusa; aqui nem se oferece)
        b.append(el('span', 'banner-texto', `Gravação em andamento — «${g.titulo || 'Sem título'}» (${g.qtdPassos} passos). Pare a gravação na extensão para editar.`));
        banner.append(b);
        continue;
      }
      b.append(el('span', 'banner-texto', `Gravação interrompida — «${g.titulo || 'Sem título'}» (${g.qtdPassos} passos)`));
      const abrir = el('button', 'dxt-btn dxt-btn--sm', 'Abrir');
      abrir.type = 'button';
      abrir.addEventListener('click', () => opcoes.abrirGuia(g.id));
      b.append(abrir);
      banner.append(b);
    }

    lista.replaceChildren();
    if (!guias.length) {
      const vazio = el('div', 'biblioteca-vazia');
      vazio.append(el('h2', '', 'Nenhum guia ainda'));
      const p = el('p');
      p.textContent = opcoes.naExtensao
        ? 'Clique no ícone da extensão numa página e escolha Iniciar gravação: cada clique e digitação vira um passo com a captura anotada. Também dá para importar uma pasta gravada pelo app Mac ou criar um guia manual.'
        : 'Grave com a extensão do Chrome, importe a pasta ou o .stepbystep.zip gravado pelo app Mac, ou crie um guia manual e anexe suas próprias capturas.';
      vazio.append(p);
      const acoes = el('div', 'dxt-controls');
      const imp = el('button', 'dxt-btn', 'Importar gravação');
      imp.type = 'button';
      imp.addEventListener('click', abrirImportacao);
      const novo = el('button', 'dxt-btn dxt-btn--ghost', 'Novo guia manual');
      novo.type = 'button';
      novo.addEventListener('click', novoGuia);
      acoes.append(imp, novo);
      vazio.append(acoes);
      lista.append(vazio);
      return;
    }
    const grade = el('div', 'dxt-grid biblioteca-grade');
    for (const g of guias) grade.append(cartao(g));
    lista.append(grade);
  }

  function cartao(g) {
    const c = el('article', 'guia-cartao dxt-hover-elevate');
    c.dataset.id = g.id;
    const topo = el('div', 'guia-cartao-topo');
    const origem = el('span', 'dxt-badge', NOMES_ORIGEM[g.origem?.tipo] ?? 'Guia');
    topo.append(origem);
    if (g.estado !== 'concluido') { const e = el('span', 'dxt-badge dxt-badge--down', g.estado === 'gravando' ? 'gravando' : 'interrompido'); topo.append(e); }
    const titulo = el('h2', 'guia-cartao-titulo', g.titulo || 'Sem título');
    const meta = el('p', 'guia-cartao-meta');
    const n = el('span', 'dxt-num', String(g.qtdPassos));
    meta.append(n, ` ${g.qtdPassos === 1 ? 'passo' : 'passos'} · ${formatarData(g.atualizadoEm)}`);
    const acoes = el('div', 'guia-cartao-acoes');
    const gravando = g.estado === 'gravando';
    const abrir = el('button', 'dxt-btn dxt-btn--sm', 'Abrir');
    abrir.type = 'button';
    abrir.disabled = gravando;
    if (gravando) abrir.title = 'Pare a gravação na extensão para editar este guia';
    abrir.addEventListener('click', () => opcoes.abrirGuia(g.id));
    const excluir = el('button', 'dxt-btn dxt-btn--ghost dxt-btn--sm', 'Excluir');
    excluir.type = 'button';
    excluir.addEventListener('click', async () => {
      const ok = await confirmar(`Excluir «${g.titulo || 'Sem título'}» e suas imagens? Esta ação não pode ser desfeita.`, { titulo: 'Excluir guia', ok: 'Excluir', perigo: true });
      if (!ok) return;
      await excluirGuia(g.id);
      avisar('Guia excluído.', { tipo: 'info' });
      renderizar();
    });
    acoes.append(abrir, excluir);
    c.append(topo, titulo, meta, acoes);
    c.addEventListener('dblclick', () => { if (!gravando) opcoes.abrirGuia(g.id); });
    return c;
  }

  async function novoGuia() {
    const titulo = await perguntar('Título do manual', { titulo: 'Novo guia manual', placeholder: 'Ex.: Cadastrar fornecedor no SAP', rotulo: 'Criar' });
    if (titulo === null) return;
    const guia = criarGuia({ titulo: titulo || 'Manual sem título', origem: { tipo: 'manual', versao: opcoes.versao, plataforma: navigator.platform || null } });
    await salvarGuia(guia);
    try { await navigator.storage?.persist?.(); } catch { /* opcional */ }
    opcoes.abrirGuia(guia.id);
  }

  function abrirImportacao() {
    const conteudo = el('div', 'importar');
    const solta = el('div', 'importar-solta');
    solta.id = 'importar-solta';
    solta.setAttribute('role', 'region');
    solta.setAttribute('aria-label', 'Área para arrastar arquivos');
    solta.append(el('p', 'importar-solta-titulo', 'Arraste aqui'));
    solta.append(el('p', 'importar-solta-texto', 'o .stepbystep.zip, o guide.json ou a pasta gravada pelo app Mac (guide.json + imagens/)'));
    const botoes = el('div', 'dxt-controls importar-botoes');
    const inputArquivo = el('input');
    inputArquivo.type = 'file';
    inputArquivo.id = 'importar-arquivo';
    inputArquivo.accept = '.zip,.json,application/zip,application/json';
    inputArquivo.hidden = true;
    const rotArquivo = el('label', 'dxt-btn', 'Escolher arquivo');
    rotArquivo.htmlFor = inputArquivo.id;
    const inputPasta = el('input');
    inputPasta.type = 'file';
    inputPasta.id = 'importar-pasta';
    inputPasta.setAttribute('webkitdirectory', '');
    inputPasta.multiple = true;
    inputPasta.hidden = true;
    const rotPasta = el('label', 'dxt-btn dxt-btn--ghost', 'Escolher pasta');
    rotPasta.htmlFor = inputPasta.id;
    botoes.append(rotArquivo, inputArquivo, rotPasta, inputPasta);
    const progresso = el('p', 'importar-progresso dxt-num');
    progresso.id = 'importar-progresso';
    progresso.setAttribute('aria-live', 'polite');
    conteudo.append(solta, botoes, progresso);

    const dialogo = abrirDialogo({ titulo: 'Importar guia', conteudo, botoes: [{ rotulo: 'Cancelar', valor: null }] });
    let ocupado = false;

    async function importar(entradas) {
      if (ocupado) return;
      ocupado = true;
      progresso.textContent = 'Lendo arquivos…';
      try {
        const r = await importarEntradas(entradas, {
          aoProgredir: ({ fase, atual, total }) => {
            progresso.textContent = fase === 'imagens' ? `Gravando imagem ${atual} de ${total}` : fase === 'salvando' ? 'Salvando guia…' : 'Lendo arquivos…';
          },
          resolverConflito,
        });
        dialogo.fechar('importado');
        avisar(`«${r.titulo || 'Sem título'}» importado com ${r.passos} passos.`, { tipo: 'sucesso' });
        for (const a of r.avisos) avisar(a, { tipo: 'atencao', duracao: 8000 });
        opcoes.abrirGuia(r.guiaId);
      } catch (e) {
        progresso.textContent = '';
        if (e?.message === 'Importação cancelada') return;   // o usuário desistiu no diálogo de conflito: não é erro
        console.error('Falha na importação', e);
        avisar(e?.message || 'Não foi possível importar.', { tipo: 'erro' });
      } finally {
        ocupado = false;
      }
    }

    inputArquivo.addEventListener('change', () => { const e = entradasDeInput(inputArquivo); inputArquivo.value = ''; if (e.length) importar(e); });
    inputPasta.addEventListener('change', () => { const e = entradasDeInput(inputPasta); inputPasta.value = ''; if (e.length) importar(e); });
    for (const tipo of ['dragenter', 'dragover']) solta.addEventListener(tipo, (e) => { e.preventDefault(); solta.classList.add('is-sobre'); });
    solta.addEventListener('dragleave', () => solta.classList.remove('is-sobre'));
    solta.addEventListener('drop', async (e) => {
      e.preventDefault();
      solta.classList.remove('is-sobre');
      const entradas = await entradasDeDataTransfer(e.dataTransfer);
      if (entradas.length) importar(entradas);
    });
    return dialogo;
  }

  btnNovo.addEventListener('click', novoGuia);
  btnImportar.addEventListener('click', abrirImportacao);
  renderizar();

  return {
    renderizar,
    abrirImportacao,
    destruir() { destruido = true; },
  };
}

export { carregarGuia };
