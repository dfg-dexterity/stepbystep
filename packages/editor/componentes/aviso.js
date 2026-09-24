// Avisos (toasts) em pt-BR: pilha no canto inferior direito, anunciada por aria-live.
// Sem framework: um <div> por aviso, removido ao expirar ou ao fechar.

let pilha = null;

function garantirPilha() {
  if (!pilha || !pilha.isConnected) {
    pilha = document.createElement('div');
    pilha.id = 'avisos';
    pilha.className = 'avisos';
    pilha.setAttribute('aria-live', 'polite');
    document.body.append(pilha);
  }
  return pilha;
}

/**
 * @param {string} mensagem
 * @param {{tipo?:'info'|'sucesso'|'atencao'|'erro', duracao?:number, acao?:{rotulo:string, executar:Function}}} [opcoes]
 *   duracao 0 = fica até fechar (ou até `atualizar`/`fechar`).
 * @returns {{fechar:Function, atualizar:(mensagem:string)=>void, elemento:HTMLElement}}
 */
export function avisar(mensagem, opcoes = {}) {
  const { tipo = 'info', acao } = opcoes;
  const duracao = opcoes.duracao ?? (tipo === 'erro' ? 8000 : 4000);
  const el = document.createElement('div');
  el.className = `aviso aviso--${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');

  const texto = document.createElement('span');
  texto.className = 'aviso-texto';
  texto.textContent = mensagem;
  el.append(texto);

  let timer = null;
  const fechar = () => { clearTimeout(timer); el.remove(); };

  if (acao) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aviso-acao';
    b.textContent = acao.rotulo;
    b.addEventListener('click', () => { fechar(); acao.executar(); });
    el.append(b);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'aviso-fechar';
  x.setAttribute('aria-label', 'Fechar aviso');
  x.textContent = '×';
  x.addEventListener('click', fechar);
  el.append(x);

  garantirPilha().append(el);
  if (duracao > 0) timer = setTimeout(fechar, duracao);

  return {
    fechar,
    atualizar(nova) { texto.textContent = nova; },
    elemento: el,
  };
}
