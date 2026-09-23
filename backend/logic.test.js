const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUserRegistration, stampEditor } = require('./logic');

test('valida cadastro com senhas iguais', () => {
  const result = validateUserRegistration({
    name: 'Maria',
    email: 'maria@email.com',
    password: '123456',
    confirmPassword: '123456'
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
});

test('rejeita cadastro com senhas diferentes', () => {
  const result = validateUserRegistration({
    name: 'Maria',
    email: 'maria@email.com',
    password: '123456',
    confirmPassword: '654321'
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /senhas/i);
});

test('adiciona marcador de quem editou o item', () => {
  const item = stampEditor({ valor: 80 }, 'Catalina');

  assert.equal(item.updatedBy, 'Catalina');
  assert.ok(item.updatedAt);
});
