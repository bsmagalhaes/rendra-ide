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

// ── decidirColagem (T6) ──
const { decidirColagem } = require('../renderer/terminal-keys');

test('decidirColagem: texto e imagem juntos dá texto (texto vence)', () => {
  assert.strictEqual(decidirColagem('abc', true), 'texto');
});
test('decidirColagem: só imagem dá imagem (o \x16 vai ao programa)', () => {
  assert.strictEqual(decidirColagem('', true), 'imagem');
  assert.strictEqual(decidirColagem(undefined, true), 'imagem');
});
test('decidirColagem: só texto dá texto', () => {
  assert.strictEqual(decidirColagem('abc', false), 'texto');
});
test('decidirColagem: nada na área de transferência dá texto vazio, sem efeito', () => {
  assert.strictEqual(decidirColagem('', false), 'texto');
  assert.strictEqual(decidirColagem(null, false), 'texto');
});
