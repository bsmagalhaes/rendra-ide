// Painel do editor recolhível: transições do estado "escondido" e rótulo do botão.
const test = require('node:test');
const assert = require('node:assert');
const { proximo, rotuloBotao } = require('../renderer/editor-panel');

test('alternar inverte; esconder força true; mostrar força false', () => {
  assert.strictEqual(proximo(false, 'alternar'), true);
  assert.strictEqual(proximo(true, 'alternar'), false);
  assert.strictEqual(proximo(false, 'esconder'), true);
  assert.strictEqual(proximo(true, 'esconder'), true);
  assert.strictEqual(proximo(false, 'mostrar'), false);
  assert.strictEqual(proximo(true, 'mostrar'), false);
});

test('abrir um arquivo reabre o painel escondido', () => {
  assert.strictEqual(proximo(true, 'arquivo-aberto'), false);
  assert.strictEqual(proximo(false, 'arquivo-aberto'), false);
});

test('restaurar as abas no arranque não reabre o painel escondido', () => {
  assert.strictEqual(proximo(true, 'arquivo-restaurado'), true);
  assert.strictEqual(proximo(false, 'arquivo-restaurado'), false);
});

test('estado não booleano vira booleano e evento desconhecido mantém', () => {
  assert.strictEqual(proximo(undefined, 'alternar'), true);
  assert.strictEqual(proximo(undefined, 'evento-que-nao-existe'), false);
  assert.strictEqual(proximo(null, 'arquivo-restaurado'), false);
  assert.strictEqual(proximo(true, 'evento-que-nao-existe'), true);
  assert.strictEqual(proximo(false, 'evento-que-nao-existe'), false);
  assert.strictEqual(proximo('true', 'arquivo-restaurado'), false, 'só o booleano true conta como escondido');
});

test('rótulo do botão nos dois estados', () => {
  assert.deepStrictEqual(rotuloBotao(true), { texto: 'Mostrar editor', pressionado: false });
  assert.deepStrictEqual(rotuloBotao(false), { texto: 'Esconder editor', pressionado: true });
  assert.deepStrictEqual(rotuloBotao(undefined), { texto: 'Esconder editor', pressionado: true });
});
