// Copiar ao marcar (T5): a decisão pura. O resto (estabilizador, realce mantido, aviso "Copiado") é fiação e e2e.
const test = require('node:test');
const assert = require('node:assert');
const { deveCopiar } = require('../renderer/terminal-keys');

test('texto novo copia', () => {
  assert.strictEqual(deveCopiar('alfa', ''), true);
  assert.strictEqual(deveCopiar('alfa', 'beta'), true);
});

test('texto vazio não copia (seleção limpa)', () => {
  assert.strictEqual(deveCopiar('', ''), false);
  assert.strictEqual(deveCopiar('', 'alfa'), false);
  assert.strictEqual(deveCopiar(undefined, 'alfa'), false);
});

test('o mesmo texto não copia de novo (vários eventos de seleção por arraste)', () => {
  assert.strictEqual(deveCopiar('alfa', 'alfa'), false);
});

test('a seleção ampliada ou trocada copia de novo', () => {
  assert.strictEqual(deveCopiar('alfa beta', 'alfa'), true);
  assert.strictEqual(deveCopiar('gama', 'alfa beta'), true);
});
