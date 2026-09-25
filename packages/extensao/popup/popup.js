// Popup: controles quando a barra não pode ser injetada (chrome://, Web Store, PDF),
// contador, últimos 10 guias e "Abrir editor". Só conversa com o SW por mensagens (5.4).
const $ = (id) => document.getElementById(id);
const LIMITE_GUIAS = 10;
const ESTADOS = { gravando: 'Gravando', interrompido: 'Interrompida', concluido: '' };

async function enviar(mensagem) {
  try {
    return (await chrome.runtime.sendMessage(mensagem)) ?? { ok: false, erro: 'Sem resposta' };
  } catch (e) {
    return { ok: false, erro: e?.message ?? String(e) };
  }
}

async function abaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba ?? null;
}

function urlEditor(guiaId) {
  return chrome.runtime.getURL(guiaId ? `editor/index.html#/guia/${guiaId}` : 'editor/index.html');
}

function avisar(texto) {
  const aviso = $('aviso');
  aviso.textContent = texto ?? '';
  aviso.hidden = !texto;
}

function renderEstado(e) {
  const gravando = !!e?.gravando;
  const pausado = gravando && !!e?.pausado;
  const situacao = $('situacao');
  situacao.textContent = !gravando ? 'Parado' : pausado ? 'Pausado' : 'Gravando';
  situacao.className = 'situacao' + (!gravando ? '' : pausado ? ' pausado' : ' gravando');
  const n = e?.contador ?? 0;
  $('contador').textContent = String(n);
  $('contador-rotulo').textContent = n === 1 ? 'passo' : 'passos';
  $('iniciar').hidden = gravando;
  $('pausar').hidden = !gravando || pausado;
  $('retomar').hidden = !gravando || !pausado;
  $('parar').hidden = !gravando;
}

function formatarData(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderGuias(guias) {
  const lista = $('lista');
  lista.replaceChildren();
  $('vazio').hidden = guias.length > 0;
  for (const g of guias) {
    const li = document.createElement('li');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'guia';
    // o editor recusa o guia em gravação (o SW ainda insere passos nele) e volta à biblioteca
    const gravando = g.estado === 'gravando';
    botao.disabled = gravando;
    botao.title = gravando ? 'Pare a gravação na extensão para editar este guia' : 'Abrir no editor';
    const titulo = document.createElement('span');
    titulo.className = 'guia-titulo';
    titulo.textContent = g.titulo || 'Sem título';
    const passos = document.createElement('span');
    passos.className = 'guia-passos';
    passos.textContent = `${g.qtdPassos ?? 0} ${g.qtdPassos === 1 ? 'passo' : 'passos'}`;
    const meta = document.createElement('span');
    meta.className = 'guia-meta';
    const origem = g.origem?.tipo === 'mac' ? 'Mac' : g.origem?.tipo === 'manual' ? 'Manual' : 'Navegador';
    meta.textContent = [origem, formatarData(g.atualizadoEm)].filter(Boolean).join(' · ');
    if (ESTADOS[g.estado]) {
      const estado = document.createElement('span');
      estado.className = 'guia-estado';
      estado.textContent = ` · ${ESTADOS[g.estado]}`;
      meta.append(estado);
    }
    botao.append(titulo, passos, meta);
    botao.addEventListener('click', () => chrome.tabs.create({ url: urlEditor(g.id) }));
    li.append(botao);
    lista.append(li);
  }
}

async function atualizar() {
  renderEstado(await enviar({ tipo: 'ESTADO' }));
  const r = await enviar({ tipo: 'LISTAR_GUIAS', limite: LIMITE_GUIAS });
  renderGuias(r.ok ? r.guias ?? [] : []);
}

async function acionar(botao, fn) {
  botao.disabled = true;
  avisar('');
  try {
    const r = await fn();
    if (r && !r.ok) avisar(r.erro || 'Não foi possível concluir a ação');
  } finally {
    botao.disabled = false;
    await atualizar();
  }
}

$('iniciar').addEventListener('click', () => acionar($('iniciar'), async () => {
  const aba = await abaAtiva();
  if (!aba) return { ok: false, erro: 'Nenhuma aba ativa' };
  return enviar({ tipo: 'INICIAR', abaId: aba.id });
}));
$('pausar').addEventListener('click', () => acionar($('pausar'), () => enviar({ tipo: 'PAUSAR' })));
$('retomar').addEventListener('click', () => acionar($('retomar'), () => enviar({ tipo: 'RETOMAR' })));
$('parar').addEventListener('click', () => acionar($('parar'), () => enviar({ tipo: 'PARAR' })));
$('abrir-editor').addEventListener('click', () => chrome.tabs.create({ url: urlEditor() }));

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area === 'session' && mudancas.gravacao) atualizar();
});

atualizar();
