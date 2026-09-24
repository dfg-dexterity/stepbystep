import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarCampo } from '../../packages/core/mascara.js';

test('input[type=password]', () => {
  assert.deepEqual(classificarCampo({ tipoInput: 'password' }), { sensivel: true, motivo: 'input[type=password]' });
  assert.deepEqual(classificarCampo({ tipoInput: 'PASSWORD', nome: 'x' }), { sensivel: true, motivo: 'input[type=password]' });
});

test('autocomplete sensível', () => {
  assert.deepEqual(classificarCampo({ tipoInput: 'text', autocomplete: 'cc-number' }), { sensivel: true, motivo: 'autocomplete=cc-number' });
  assert.deepEqual(classificarCampo({ autocomplete: 'section-pagto shipping cc-csc' }), { sensivel: true, motivo: 'autocomplete=cc-csc' });
  for (const a of ['cc-exp', 'cc-exp-month', 'cc-exp-year', 'current-password', 'new-password', 'one-time-code']) {
    assert.deepEqual(classificarCampo({ autocomplete: a }), { sensivel: true, motivo: 'autocomplete=' + a });
  }
  assert.deepEqual(classificarCampo({ autocomplete: 'email' }), { sensivel: false, motivo: null });
});

test('nome, id e rótulo do campo', () => {
  assert.deepEqual(classificarCampo({ nome: 'cpf' }), { sensivel: true, motivo: 'nome:cpf' });
  assert.deepEqual(classificarCampo({ id: 'inputCartaoNumero' }), { sensivel: true, motivo: 'nome:cartao' });
  assert.deepEqual(classificarCampo({ campo: 'Senha' }), { sensivel: true, motivo: 'nome:senha' });
  assert.deepEqual(classificarCampo({ campo: 'Número do cartão' }), { sensivel: true, motivo: 'nome:cartão' });
  assert.deepEqual(classificarCampo({ nome: 'user_passwd' }), { sensivel: true, motivo: 'nome:passwd' });
  assert.deepEqual(classificarCampo({ nome: 'apiToken' }), { sensivel: true, motivo: 'nome:token' });
  assert.deepEqual(classificarCampo({ nome: 'cnpjEmpresa' }), { sensivel: true, motivo: 'nome:cnpj' });
  assert.deepEqual(classificarCampo({ id: 'cvv' }), { sensivel: true, motivo: 'nome:cvv' });
});

test('AXSecureTextField (Mac)', () => {
  assert.deepEqual(classificarCampo({ papelNativo: 'AXSecureTextField' }), { sensivel: true, motivo: 'AXSecureTextField' });
  assert.deepEqual(classificarCampo({ papelNativo: 'AXTextField', campo: 'Pedido' }), { sensivel: false, motivo: null });
});

test('casos negativos', () => {
  assert.deepEqual(classificarCampo({ tipoInput: 'text', nome: 'nome', id: 'nome', campo: 'Nome', autocomplete: 'name' }), { sensivel: false, motivo: null });
  assert.deepEqual(classificarCampo({ tipoInput: 'email', campo: 'E-mail' }), { sensivel: false, motivo: null });
  assert.deepEqual(classificarCampo({}), { sensivel: false, motivo: null });
  assert.deepEqual(classificarCampo(null), { sensivel: false, motivo: null });
  assert.deepEqual(classificarCampo({ campo: 'Compensação' }), { sensivel: false, motivo: null }); // "senha" não aparece
});

test('prioridade: tipo antes de autocomplete antes de nome', () => {
  assert.equal(classificarCampo({ tipoInput: 'password', autocomplete: 'cc-number', nome: 'cpf' }).motivo, 'input[type=password]');
  assert.equal(classificarCampo({ tipoInput: 'text', autocomplete: 'cc-number', nome: 'cpf' }).motivo, 'autocomplete=cc-number');
});
