// Gera os fixtures de teste: tests/fixtures/guia-exemplo/** (guide.json da seção 3.4 da
// especificação + PNGs) e tests/fixtures/guia-mac/** (pasta como o app Mac grava).
// Os PNGs são bitmaps simples (fundo escuro, janela e alvos claros) codificados sem dependências.
// Idempotente: sobrescreve os arquivos. Uso: `npm run fixtures`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codificarPng } from './png-minimo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(RAIZ, 'tests', 'fixtures');

// ---------------------------------------------------------------------------
// guia-exemplo: cópia literal do exemplo da especificação (seção 3.4)
// ---------------------------------------------------------------------------
const CAPTURA_WEB = (imagemId, fonte) => ({
  imagemId, largura: 2880, altura: 1620, dpr: 2, viewport: { largura: 1440, altura: 810 }, escala: 2, fonte, faltante: false,
});

export const GUIA_EXEMPLO = {
  formato: 'stepbystep/guia',
  versao: 1,
  id: 'g_m1x4k9zq7a2b',
  titulo: 'Cadastrar fornecedor no SAP Fiori',
  descricao: 'Como criar um parceiro de negócios do tipo fornecedor pelo app Manage Business Partner.',
  idioma: 'pt-BR',
  autor: 'Diego',
  criadoEm: '2026-09-24T14:03:11.000Z',
  atualizadoEm: '2026-09-24T14:21:40.000Z',
  origem: { tipo: 'extensao', versao: '0.1.0', plataforma: 'Chrome 130 / macOS 15' },
  estilo: { cor: 'cerceta', escurecerFora: true },
  estado: 'concluido',
  publicacoes: [],
  passos: [
    {
      id: 'p_m1x4k9zr01aa',
      tipo: 'navegar',
      titulo: 'Navegue para fiori.empresa.com.br/ui',
      tituloAuto: true,
      descricao: '',
      criadoEm: '2026-09-24T14:03:12.100Z',
      contexto: { url: 'https://fiori.empresa.com.br/ui#Shell-home', tituloPagina: 'Launchpad', abaId: 812, frameId: 0, scroll: { x: 0, y: 0 } },
      evento: { url: 'https://fiori.empresa.com.br/ui#Shell-home', transicao: 'inicio' },
      alvo: null,
      captura: CAPTURA_WEB('img_m1x4k9zr01aa', 'navegacao'),
      resultado: null,
      anotacoes: [],
    },
    {
      id: 'p_m1x4k9zr02ab',
      tipo: 'clicar',
      titulo: 'Clique em «Criar»',
      tituloAuto: true,
      descricao: '',
      criadoEm: '2026-09-24T14:03:20.400Z',
      contexto: { url: 'https://fiori.empresa.com.br/ui#BusinessPartner-manage', tituloPagina: 'Manage Business Partner', abaId: 812, frameId: 0, scroll: { x: 0, y: 0 } },
      evento: { botao: 'esquerdo', vezes: 1, modificadores: [] },
      alvo: {
        papel: 'button', papelNativo: null, rotulo: 'Criar', fonteRotulo: 'texto', campo: null,
        tag: 'button', tipoInput: null, seletor: '#__button12-inner',
        rectCss: { x: 1270, y: 146, w: 72, h: 26 },
        bbox: { x: 2540, y: 292, w: 144, h: 52 },
        ponto: { x: 2612, y: 318 },
        frame: { id: 0, url: null }, menu: null, janelaBbox: null,
      },
      captura: CAPTURA_WEB('img_m1x4k9zr02ab', 'pointerdown'),
      resultado: { url: 'https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create' },
      anotacoes: [
        { id: 'a_m1x4k9zr02a1', tipo: 'retangulo', auto: true, x: 2524, y: 276, w: 176, h: 84, cor: 'cerceta' },
        { id: 'a_m1x4k9zr02a2', tipo: 'marcador', auto: true, x: 2700, y: 276, numero: 2, cor: 'cerceta' },
      ],
      notas: [
        { id: 'n_m1x4k9zr02n1', tipo: 'dica', texto: 'O botão fica no canto superior direito da lista de parceiros.' },
      ],
    },
    {
      id: 'p_m1x4k9zr03ac',
      tipo: 'digitar',
      titulo: 'Digite «ACME Ltda» no campo «Nome»',
      tituloAuto: false,
      descricao: 'Use a razão social completa, sem abreviações.',
      criadoEm: '2026-09-24T14:03:31.000Z',
      contexto: { url: 'https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create', tituloPagina: 'Novo parceiro', abaId: 812, frameId: 0, scroll: { x: 0, y: 240 } },
      evento: { valor: 'ACME Ltda', sensivel: false, motivo: null, confirmadoPor: 'clique' },
      alvo: { papel: 'textbox', papelNativo: null, rotulo: 'Nome', fonteRotulo: 'label', campo: 'Nome', tag: 'input', tipoInput: 'text', seletor: '#nome', rectCss: { x: 350, y: 306, w: 400, h: 28 }, bbox: { x: 700, y: 612, w: 800, h: 56 }, ponto: null, frame: { id: 0, url: null }, menu: null, janelaBbox: null },
      captura: CAPTURA_WEB('img_m1x4k9zr04ad', 'compartilhada'),
      resultado: null,
      anotacoes: [
        { id: 'a_m1x4k9zr03a1', tipo: 'recorte', auto: false, x: 400, y: 400, w: 1600, h: 800 },
        { id: 'a_m1x4k9zr03a2', tipo: 'retangulo', auto: true, x: 684, y: 596, w: 832, h: 88, cor: 'cerceta' },
        { id: 'a_m1x4k9zr03a3', tipo: 'marcador', auto: true, x: 1516, y: 596, numero: 3, cor: 'cerceta' },
        { id: 'a_m1x4k9zr03a4', tipo: 'seta', auto: false, de: { x: 1700, y: 900 }, para: { x: 1520, y: 680 }, cor: 'ambar' },
        { id: 'a_m1x4k9zr03a5', tipo: 'texto', auto: false, x: 1710, y: 920, texto: 'Razão social', tamanho: 32, cor: 'base', fundo: 'off' },
      ],
    },
    {
      id: 'p_m1x4k9zr05ae',
      tipo: 'digitar',
      titulo: 'Digite sua senha no campo «Senha»',
      tituloAuto: true,
      descricao: '',
      criadoEm: '2026-09-24T14:03:40.000Z',
      contexto: { url: 'https://sso.empresa.com.br/login', tituloPagina: 'Entrar', abaId: 812, frameId: 0, scroll: { x: 0, y: 0 } },
      evento: { valor: null, sensivel: true, motivo: 'input[type=password]', confirmadoPor: 'enter' },
      alvo: { papel: 'textbox', papelNativo: null, rotulo: 'Senha', fonteRotulo: 'label', campo: 'Senha', tag: 'input', tipoInput: 'password', seletor: '#senha', rectCss: { x: 350, y: 386, w: 400, h: 28 }, bbox: { x: 700, y: 772, w: 800, h: 56 }, ponto: null, frame: { id: 0, url: null }, menu: null, janelaBbox: null },
      captura: CAPTURA_WEB('img_m1x4k9zr05ae', 'confirmacao'),
      resultado: null,
      anotacoes: [
        { id: 'a_m1x4k9zr05a1', tipo: 'desfoque', auto: true, x: 700, y: 772, w: 800, h: 56, bloco: 16 },
        { id: 'a_m1x4k9zr05a2', tipo: 'retangulo', auto: true, x: 684, y: 756, w: 832, h: 88, cor: 'cerceta' },
        { id: 'a_m1x4k9zr05a3', tipo: 'marcador', auto: true, x: 1516, y: 756, numero: 4, cor: 'cerceta' },
      ],
      notas: [
        { id: 'n_m1x4k9zr05n1', tipo: 'atencao', texto: 'Nunca compartilhe sua senha: o campo sai desfocado no manual.' },
      ],
    },
    {
      id: 'p_m1x4k9zr06af',
      tipo: 'tecla',
      titulo: 'Pressione Enter',
      tituloAuto: true,
      descricao: '',
      criadoEm: '2026-09-24T14:03:40.300Z',
      contexto: { url: 'https://sso.empresa.com.br/login', tituloPagina: 'Entrar', abaId: 812, frameId: 0, scroll: { x: 0, y: 0 } },
      evento: { tecla: 'Enter', modificadores: [], atalho: 'Enter' },
      alvo: null,
      captura: CAPTURA_WEB('img_m1x4k9zr05ae', 'compartilhada'),
      resultado: { url: 'https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create' },
      anotacoes: [],
    },
    {
      id: 'p_m1x4k9zr07ag',
      tipo: 'selecionar',
      titulo: 'Selecione «Brasil» em «País»',
      tituloAuto: true,
      descricao: '',
      criadoEm: '2026-09-24T14:03:52.000Z',
      contexto: { url: 'https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create', tituloPagina: 'Novo parceiro', abaId: 812, frameId: 0, scroll: { x: 0, y: 240 } },
      evento: { valor: 'BR', opcao: 'Brasil' },
      alvo: { papel: 'combobox', papelNativo: null, rotulo: 'País', fonteRotulo: 'label', campo: 'País', tag: 'select', tipoInput: null, seletor: '#pais', rectCss: { x: 350, y: 436, w: 400, h: 28 }, bbox: { x: 700, y: 872, w: 800, h: 56 }, ponto: null, frame: { id: 0, url: null }, menu: null, janelaBbox: null },
      captura: CAPTURA_WEB('img_m1x4k9zr07ag', 'confirmacao'),
      resultado: null,
      anotacoes: [
        { id: 'a_m1x4k9zr07a1', tipo: 'retangulo', auto: true, x: 684, y: 856, w: 832, h: 88, cor: 'cerceta' },
        { id: 'a_m1x4k9zr07a2', tipo: 'marcador', auto: true, x: 1516, y: 856, numero: 6, cor: 'cerceta' },
      ],
    },
    {
      id: 'p_m1x4k9zr08ah',
      tipo: 'marcar',
      titulo: 'Marque «Aceito os termos»',
      tituloAuto: true,
      descricao: '',
      criadoEm: '2026-09-24T14:04:01.000Z',
      contexto: { url: 'https://fiori.empresa.com.br/ui#BusinessPartner-manage&/create', tituloPagina: 'Novo parceiro', abaId: 812, frameId: 0, scroll: { x: 0, y: 240 } },
      evento: { marcado: true },
      alvo: { papel: 'checkbox', papelNativo: null, rotulo: 'Aceito os termos', fonteRotulo: 'label', campo: null, tag: 'input', tipoInput: 'checkbox', seletor: '#aceito', rectCss: { x: 350, y: 480, w: 16, h: 16 }, bbox: { x: 700, y: 960, w: 32, h: 32 }, ponto: { x: 716, y: 976 }, frame: { id: 0, url: null }, menu: null, janelaBbox: null },
      captura: CAPTURA_WEB('img_m1x4k9zr08ah', 'pointerdown'),
      resultado: null,
      anotacoes: [
        { id: 'a_m1x4k9zr08a1', tipo: 'retangulo', auto: true, x: 684, y: 944, w: 64, h: 64, cor: 'cerceta' },
        { id: 'a_m1x4k9zr08a2', tipo: 'marcador', auto: true, x: 748, y: 944, numero: 7, cor: 'cerceta' },
      ],
    },
    {
      id: 'p_m1x4k9zr09ai',
      tipo: 'secao',
      titulo: 'Conferência no SAP GUI',
      tituloAuto: false,
      descricao: '',
      criadoEm: '2026-09-24T14:10:00.000Z',
      contexto: null, evento: null, alvo: null, captura: null, resultado: null, anotacoes: [],
    },
    {
      id: 'p_m1x4k9zr10aj',
      tipo: 'clicar',
      titulo: 'Escolha o menu «Arquivo › Salvar»',
      tituloAuto: true,
      descricao: '',
      criadoEm: '2026-09-24T14:12:10.000Z',
      contexto: { app: 'SAP GUI', bundleId: 'com.sap.platin', janela: 'ME21N — Criar pedido', tela: { id: 2, largura: 1728, altura: 1117, escala: 2 } },
      evento: { botao: 'esquerdo', vezes: 1, modificadores: [] },
      alvo: { papel: 'menuitem', papelNativo: 'AXMenuItem', rotulo: 'Salvar', fonteRotulo: 'ax', campo: null, tag: null, tipoInput: null, seletor: null, rectCss: { x: 120, y: 62, w: 180, h: 22 }, bbox: { x: 240, y: 124, w: 360, h: 44 }, ponto: { x: 300, y: 146 }, frame: null, menu: 'Arquivo › Salvar', janelaBbox: { x: 80, y: 100, w: 3200, h: 2000 } },
      captura: { imagemId: 'img_m1x4k9zr10aj', largura: 3456, altura: 2234, dpr: 2, viewport: { largura: 1728, altura: 1117 }, escala: 2, fonte: 'pointerdown', faltante: false },
      resultado: null,
      anotacoes: [
        { id: 'a_m1x4k9zr10a1', tipo: 'recorte', auto: true, x: 80, y: 0, w: 3200, h: 2100 },
        { id: 'a_m1x4k9zr10a2', tipo: 'retangulo', auto: true, x: 224, y: 108, w: 392, h: 76, cor: 'cerceta' },
        { id: 'a_m1x4k9zr10a3', tipo: 'marcador', auto: true, x: 616, y: 108, numero: 8, cor: 'cerceta' },
      ],
    },
    {
      id: 'p_m1x4k9zr11ak',
      tipo: 'manual',
      titulo: 'Confira o e-mail de confirmação',
      tituloAuto: false,
      descricao: 'O sistema envia o número do parceiro em até 5 minutos.',
      criadoEm: '2026-09-24T14:20:00.000Z',
      contexto: null, evento: null, alvo: null, captura: null, resultado: null, anotacoes: [],
      notas: [
        { id: 'n_m1x4k9zr11n1', tipo: 'nota', texto: 'Se o e-mail não chegar, confira a caixa de spam.' },
      ],
    },
  ],
  imagens: {
    img_m1x4k9zr01aa: { arquivo: 'imagens/img_m1x4k9zr01aa.png', largura: 2880, altura: 1620, mime: 'image/png' },
    img_m1x4k9zr02ab: { arquivo: 'imagens/img_m1x4k9zr02ab.png', largura: 2880, altura: 1620, mime: 'image/png' },
    img_m1x4k9zr04ad: { arquivo: 'imagens/img_m1x4k9zr04ad.png', largura: 2880, altura: 1620, mime: 'image/png' },
    img_m1x4k9zr05ae: { arquivo: 'imagens/img_m1x4k9zr05ae.png', largura: 2880, altura: 1620, mime: 'image/png' },
    img_m1x4k9zr07ag: { arquivo: 'imagens/img_m1x4k9zr07ag.png', largura: 2880, altura: 1620, mime: 'image/png' },
    img_m1x4k9zr08ah: { arquivo: 'imagens/img_m1x4k9zr08ah.png', largura: 2880, altura: 1620, mime: 'image/png' },
    img_m1x4k9zr10aj: { arquivo: 'imagens/img_m1x4k9zr10aj.png', largura: 3456, altura: 2234, mime: 'image/png' },
  },
};

// ---------------------------------------------------------------------------
// guia-mac: pasta como o app Mac grava (titulo "" + tituloAuto true, recorte auto pela janela)
// ---------------------------------------------------------------------------
const TELA_MAC = { id: 2, largura: 1728, altura: 1117, escala: 2 };
const JANELA_MAC = { x: 160, y: 90, w: 3000, h: 1900 };
const CONTEXTO_MAC = (janela) => ({ app: 'SAP GUI', bundleId: 'com.sap.platin', janela, tela: TELA_MAC });
const CAPTURA_MAC = (imagemId, fonte) => ({
  imagemId, largura: 3456, altura: 2234, dpr: 2, viewport: { largura: 1728, altura: 1117 }, escala: 2, fonte, faltante: false,
});
const ALVO_MAC = (o) => ({
  papel: 'generic', papelNativo: null, rotulo: null, fonteRotulo: 'nenhum', campo: null, tag: null, tipoInput: null, seletor: null,
  rectCss: null, bbox: null, ponto: null, frame: null, menu: null, janelaBbox: JANELA_MAC, ...o,
});
const PASSO_MAC = (o) => ({ titulo: '', tituloAuto: true, descricao: '', resultado: null, anotacoes: [], ...o });

export const GUIA_MAC = {
  formato: 'stepbystep/guia',
  versao: 1,
  id: 'g_m1x7q2mac0aa',
  titulo: 'Gravação — SAP GUI',
  descricao: '',
  idioma: 'pt-BR',
  autor: '',
  criadoEm: '2026-09-24T17:12:00.000Z',
  atualizadoEm: '2026-09-24T17:14:30.000Z',
  origem: { tipo: 'mac', versao: '0.1.0', plataforma: 'macOS 15.0' },
  estilo: { cor: 'cerceta', escurecerFora: true },
  estado: 'concluido',
  publicacoes: [],
  passos: [
    PASSO_MAC({
      id: 'p_m1x7q2mac01a', tipo: 'navegar', criadoEm: '2026-09-24T17:12:01.000Z',
      contexto: CONTEXTO_MAC('SAP Easy Access'),
      evento: { app: 'SAP GUI' },
      alvo: null,
      captura: CAPTURA_MAC('img_m1x7q2mac01a', 'navegacao'),
    }),
    PASSO_MAC({
      id: 'p_m1x7q2mac02b', tipo: 'clicar', criadoEm: '2026-09-24T17:12:08.000Z',
      contexto: CONTEXTO_MAC('SAP Easy Access'),
      evento: { botao: 'esquerdo', vezes: 1, modificadores: [] },
      alvo: ALVO_MAC({
        papel: 'menuitem', papelNativo: 'AXMenuItem', rotulo: 'Novo', fonteRotulo: 'ax',
        rectCss: { x: 96, y: 58, w: 200, h: 22 }, bbox: { x: 192, y: 116, w: 400, h: 44 }, ponto: { x: 260, y: 138 },
        menu: 'Arquivo › Novo',
      }),
      captura: CAPTURA_MAC('img_m1x7q2mac02b', 'pointerdown'),
      anotacoes: [{ id: 'a_m1x7q2mac02a1', tipo: 'recorte', auto: true, x: 160, y: 0, w: 3000, h: 1990 }],
    }),
    PASSO_MAC({
      id: 'p_m1x7q2mac03c', tipo: 'clicar', criadoEm: '2026-09-24T17:12:15.000Z',
      contexto: CONTEXTO_MAC('ME21N — Criar pedido'),
      evento: { botao: 'esquerdo', vezes: 1, modificadores: [] },
      alvo: ALVO_MAC({
        papel: 'button', papelNativo: 'AXButton', rotulo: 'Executar', fonteRotulo: 'ax',
        rectCss: { x: 240, y: 140, w: 90, h: 26 }, bbox: { x: 480, y: 280, w: 180, h: 52 }, ponto: { x: 570, y: 306 },
      }),
      captura: CAPTURA_MAC('img_m1x7q2mac03c', 'pointerdown'),
      anotacoes: [{ id: 'a_m1x7q2mac03a1', tipo: 'recorte', auto: true, x: 160, y: 90, w: 3000, h: 1900 }],
    }),
    PASSO_MAC({
      id: 'p_m1x7q2mac04d', tipo: 'digitar', criadoEm: '2026-09-24T17:12:31.000Z',
      contexto: CONTEXTO_MAC('ME21N — Criar pedido'),
      evento: { valor: '4500001234', sensivel: false, motivo: null, confirmadoPor: 'enter' },
      alvo: ALVO_MAC({
        papel: 'textbox', papelNativo: 'AXTextField', rotulo: 'Pedido', fonteRotulo: 'ax', campo: 'Pedido',
        rectCss: { x: 300, y: 260, w: 220, h: 24 }, bbox: { x: 600, y: 520, w: 440, h: 48 },
      }),
      captura: CAPTURA_MAC('img_m1x7q2mac04d', 'confirmacao'),
      anotacoes: [{ id: 'a_m1x7q2mac04a1', tipo: 'recorte', auto: true, x: 160, y: 90, w: 3000, h: 1900 }],
    }),
    PASSO_MAC({
      id: 'p_m1x7q2mac05e', tipo: 'tecla', criadoEm: '2026-09-24T17:12:31.200Z',
      contexto: CONTEXTO_MAC('ME21N — Criar pedido'),
      evento: { tecla: 'Enter', modificadores: [], atalho: 'Enter' },
      alvo: null,
      captura: CAPTURA_MAC('img_m1x7q2mac04d', 'compartilhada'),
    }),
    PASSO_MAC({
      id: 'p_m1x7q2mac06f', tipo: 'tecla', criadoEm: '2026-09-24T17:13:02.000Z',
      contexto: CONTEXTO_MAC('ME21N — Criar pedido'),
      evento: { tecla: 'S', modificadores: ['Meta'], atalho: '⌘S' },
      alvo: null,
      captura: CAPTURA_MAC('img_m1x7q2mac06f', 'pointerdown'),
    }),
    PASSO_MAC({
      id: 'p_m1x7q2mac07g', tipo: 'digitar', criadoEm: '2026-09-24T17:14:20.000Z',
      contexto: CONTEXTO_MAC('Autenticação'),
      evento: { valor: null, sensivel: true, motivo: 'AXSecureTextField', confirmadoPor: 'tempo' },
      alvo: ALVO_MAC({
        papel: 'textbox', papelNativo: 'AXSecureTextField', rotulo: 'Senha', fonteRotulo: 'ax', campo: 'Senha',
        rectCss: { x: 700, y: 500, w: 260, h: 24 }, bbox: { x: 1400, y: 1000, w: 520, h: 48 },
        janelaBbox: { x: 1100, y: 800, w: 1200, h: 600 },
      }),
      captura: CAPTURA_MAC('img_m1x7q2mac07g', 'confirmacao'),
      anotacoes: [{ id: 'a_m1x7q2mac07a1', tipo: 'recorte', auto: true, x: 1100, y: 800, w: 1200, h: 600 }],
    }),
  ],
  imagens: {
    img_m1x7q2mac01a: { arquivo: 'imagens/img_m1x7q2mac01a.png', largura: 3456, altura: 2234, mime: 'image/png' },
    img_m1x7q2mac02b: { arquivo: 'imagens/img_m1x7q2mac02b.png', largura: 3456, altura: 2234, mime: 'image/png' },
    img_m1x7q2mac03c: { arquivo: 'imagens/img_m1x7q2mac03c.png', largura: 3456, altura: 2234, mime: 'image/png' },
    img_m1x7q2mac04d: { arquivo: 'imagens/img_m1x7q2mac04d.png', largura: 3456, altura: 2234, mime: 'image/png' },
    img_m1x7q2mac06f: { arquivo: 'imagens/img_m1x7q2mac06f.png', largura: 3456, altura: 2234, mime: 'image/png' },
    img_m1x7q2mac07g: { arquivo: 'imagens/img_m1x7q2mac07g.png', largura: 3456, altura: 2234, mime: 'image/png' },
  },
};

// ---------------------------------------------------------------------------
// Desenho dos bitmaps
// ---------------------------------------------------------------------------
const COR_FUNDO = [27, 27, 27, 255];      // #1B1B1B
const COR_JANELA = [46, 46, 46, 255];     // janela um pouco mais clara
const COR_ALVO = [247, 243, 231, 255];    // #F7F3E7

function preencher(rgba, largura, altura, rect, cor) {
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(largura, rect.x + rect.w), y1 = Math.min(altura, rect.y + rect.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * largura + x) * 4;
      rgba[i] = cor[0]; rgba[i + 1] = cor[1]; rgba[i + 2] = cor[2]; rgba[i + 3] = cor[3];
    }
  }
}

/** Bitmap com fundo escuro, uma "janela" e retângulos claros nos alvos. */
export function desenharBitmap(largura, altura, { janela = null, alvos = [] } = {}) {
  const rgba = new Uint8Array(largura * altura * 4);
  preencher(rgba, largura, altura, { x: 0, y: 0, w: largura, h: altura }, COR_FUNDO);
  if (janela) preencher(rgba, largura, altura, janela, COR_JANELA);
  for (const a of alvos) preencher(rgba, largura, altura, a, COR_ALVO);
  return rgba;
}

/** Gera os PNGs de um guia a partir dos bboxes dos passos que usam cada imagem. */
function gerarImagens(guia, pasta) {
  mkdirSync(join(pasta, 'imagens'), { recursive: true });
  const tamanhos = {};
  for (const [id, info] of Object.entries(guia.imagens)) {
    const passos = guia.passos.filter((p) => p.captura?.imagemId === id);
    const alvos = passos.map((p) => p.alvo?.bbox).filter(Boolean);
    const janela = passos.map((p) => p.alvo?.janelaBbox).find(Boolean) ?? null;
    const rgba = desenharBitmap(info.largura, info.altura, { janela, alvos });
    const png = codificarPng({ largura: info.largura, altura: info.altura, rgba });
    writeFileSync(join(pasta, info.arquivo), png);
    tamanhos[info.arquivo] = png.length;
  }
  return tamanhos;
}

export function gerarFixtures() {
  const pastaExemplo = join(FIXTURES, 'guia-exemplo');
  mkdirSync(pastaExemplo, { recursive: true });
  writeFileSync(join(pastaExemplo, 'guide.json'), JSON.stringify(GUIA_EXEMPLO, null, 2) + '\n');
  const t1 = gerarImagens(GUIA_EXEMPLO, pastaExemplo);

  const pastaMac = join(FIXTURES, 'guia-mac');
  mkdirSync(pastaMac, { recursive: true });
  writeFileSync(join(pastaMac, 'guide.json'), JSON.stringify(GUIA_MAC, null, 2) + '\n');
  // journal do Mac: uma linha JSON por passo, na ordem em que foram gravados
  writeFileSync(join(pastaMac, 'eventos.ndjson'), GUIA_MAC.passos.map((p) => JSON.stringify(p)).join('\n') + '\n');
  const t2 = gerarImagens(GUIA_MAC, pastaMac);
  return { 'guia-exemplo': t1, 'guia-mac': t2 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const resultado = gerarFixtures();
  for (const [pasta, tamanhos] of Object.entries(resultado)) {
    for (const [arquivo, bytes] of Object.entries(tamanhos)) console.log(`${pasta}/${arquivo}: ${bytes} bytes`);
  }
}
