// Origem da atualização: git (clone), updater (instalador), store (Microsoft Store) ou none.
const test = require('node:test');
const assert = require('node:assert');
const { selectUpdateSource, initialState, canInstall } = require('../src/update-source');

test('sem empacotar, clone usa git e sem clone não atualiza', () => {
  assert.strictEqual(selectUpdateSource({ isPackaged: false, windowsStore: false, isClone: true }), 'git');
  assert.strictEqual(selectUpdateSource({ isPackaged: false, windowsStore: false, isClone: false }), 'none');
});

test('empacotado usa o updater (NSIS, AppImage, deb e zip do mac)', () => {
  assert.strictEqual(selectUpdateSource({ isPackaged: true, windowsStore: false, isClone: false }), 'updater');
  // um .git ao lado do app instalado não muda a origem
  assert.strictEqual(selectUpdateSource({ isPackaged: true, windowsStore: false, isClone: true }), 'updater');
});

test('empacotado pela Microsoft Store não usa o updater: precedência de windowsStore', () => {
  assert.strictEqual(selectUpdateSource({ isPackaged: true, windowsStore: true, isClone: false }), 'store');
  assert.strictEqual(selectUpdateSource({ isPackaged: true, windowsStore: true, isClone: true }), 'store');
});

test('windowsStore sem empacotar não vira store', () => {
  assert.strictEqual(selectUpdateSource({ isPackaged: false, windowsStore: true, isClone: true }), 'git');
});

test('estado inicial do modo store e do modo none', () => {
  assert.deepStrictEqual(initialState('store'), { state: 'idle', mode: 'store' });
  assert.deepStrictEqual(initialState('none'), { state: 'idle', mode: 'none' });
  assert.deepStrictEqual(initialState('updater'), { state: 'idle' });
});

test('instalar é no-op nos modos store e none', () => {
  assert.strictEqual(canInstall('store'), false);
  assert.strictEqual(canInstall('none'), false);
  assert.strictEqual(canInstall('git'), true);
  assert.strictEqual(canInstall('updater'), true);
});
