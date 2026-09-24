// Classificação de campos sensíveis. Mesmas regras replicadas no content script da extensão
// (que não pode importar módulos): mudar aqui exige mudar lá.

const AUTOCOMPLETE_SENSIVEL = new Set([
  'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'current-password', 'new-password', 'one-time-code',
]);
const REGEX_NOME = /senha|password|passwd|token|secret|cvv|cvc|cart[ãa]o|cpf|cnpj/i;

/**
 * @param {{tipoInput?:string|null, autocomplete?:string|null, nome?:string|null, id?:string|null, campo?:string|null, papelNativo?:string|null}} d
 * @returns {{sensivel:boolean, motivo:string|null}}
 */
export function classificarCampo(d) {
  const desc = d ?? {};
  if (typeof desc.tipoInput === 'string' && desc.tipoInput.toLowerCase() === 'password') {
    return { sensivel: true, motivo: 'input[type=password]' };
  }
  if (typeof desc.autocomplete === 'string') {
    // autocomplete pode ter vários tokens ("section-x shipping cc-number"); vale o último token reconhecido
    const tokens = desc.autocomplete.trim().toLowerCase().split(/\s+/);
    const achado = tokens.find((t) => AUTOCOMPLETE_SENSIVEL.has(t));
    if (achado) return { sensivel: true, motivo: 'autocomplete=' + achado };
  }
  for (const chave of ['nome', 'id', 'campo']) {
    const valor = desc[chave];
    if (typeof valor !== 'string') continue;
    const m = REGEX_NOME.exec(valor);
    if (m) return { sensivel: true, motivo: 'nome:' + m[0].toLowerCase() };
  }
  if (desc.papelNativo === 'AXSecureTextField') return { sensivel: true, motivo: 'AXSecureTextField' };
  return { sensivel: false, motivo: null };
}
