// Atalhos da IDE por sistema (renderer/atalhos-ide.js): novo terminal, abrir pasta e troca de aba do editor.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { acaoDeAtalhoIde, proximaAba } = require('../renderer/atalhos-ide');

const ev = (code, mods = [], extra = {}) => ({
  type: 'keydown', code, repeat: false,
  ctrlKey: mods.includes('ctrl'), shiftKey: mods.includes('shift'), altKey: mods.includes('alt'), metaKey: mods.includes('meta'), ...extra,
});
const FORA = { foraDoTerminal: true };

test('novo terminal: Ctrl+Shift+T no Windows e no Linux, Cmd+Shift+T no macOS', () => {
  for (const p of ['win32', 'linux']) assert.strictEqual(acaoDeAtalhoIde(ev('KeyT', ['ctrl', 'shift']), p), 'novo-terminal');
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyT', ['meta', 'shift']), 'darwin'), 'novo-terminal');
});

test('novo terminal: Ctrl+T sem Shift, Ctrl+Shift+T no macOS, Cmd+Shift+T fora do macOS e Alt não valem', () => {
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyT', ['ctrl']), 'win32'), null);
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyT', ['ctrl', 'shift']), 'darwin'), null);
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyT', ['meta', 'shift']), 'linux'), null);
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyT', ['ctrl', 'shift', 'alt']), 'win32'), null);
});

test('abrir pasta: Ctrl+O só com o foco fora do terminal no Windows e no Linux', () => {
  for (const p of ['win32', 'linux']) {
    assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['ctrl']), p, FORA), 'abrir-pasta');
    assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['ctrl']), p, { foraDoTerminal: false }), null);
    assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['ctrl']), p), null);
  }
});

test('abrir pasta: o Ctrl+O nunca é da IDE dentro do terminal, e Ctrl+Shift+O não existe', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['ctrl']), p, { foraDoTerminal: false }), null);
    assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['ctrl', 'shift']), p, FORA), null);
  }
});

test('abrir pasta no macOS: Cmd+O vale em qualquer foco; Control+O não é da IDE', () => {
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['meta']), 'darwin'), 'abrir-pasta');
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['meta']), 'darwin', FORA), 'abrir-pasta');
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyO', ['ctrl']), 'darwin', FORA), null);
});

test('Ctrl+Tab e Ctrl+Shift+Tab trocam de aba nos três sistemas (Cmd+Tab é do macOS e não é tratado)', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.strictEqual(acaoDeAtalhoIde(ev('Tab', ['ctrl']), p), 'proxima-aba');
    assert.strictEqual(acaoDeAtalhoIde(ev('Tab', ['ctrl', 'shift']), p), 'aba-anterior');
    assert.strictEqual(acaoDeAtalhoIde(ev('Tab', ['meta']), p), null);
    assert.strictEqual(acaoDeAtalhoIde(ev('Tab', []), p), null);
    assert.strictEqual(acaoDeAtalhoIde(ev('Tab', ['ctrl', 'alt']), p), null);
  }
});

test('só keydown conta; repeat devolve a ação (o chamador consome a tecla e não repete a ação)', () => {
  assert.strictEqual(acaoDeAtalhoIde(ev('KeyT', ['ctrl', 'shift'], { type: 'keyup' }), 'win32'), null);
  assert.strictEqual(acaoDeAtalhoIde(ev('Tab', ['ctrl'], { repeat: true }), 'linux'), 'proxima-aba');
  assert.strictEqual(acaoDeAtalhoIde(null, 'linux'), null);
});

test('proximaAba: circular nos dois sentidos', () => {
  const abas = ['a', 'b', 'c'];
  assert.strictEqual(proximaAba(abas, 'a', 1), 'b');
  assert.strictEqual(proximaAba(abas, 'c', 1), 'a');
  assert.strictEqual(proximaAba(abas, 'a', -1), 'c');
  assert.strictEqual(proximaAba(abas, 'b', -1), 'a');
});

test('proximaAba: sem abas, com uma só ou com aba ativa desconhecida não faz nada', () => {
  assert.strictEqual(proximaAba([], null, 1), null);
  assert.strictEqual(proximaAba(['a'], 'a', 1), null);
  assert.strictEqual(proximaAba(['a', 'b'], 'z', 1), null);
  assert.strictEqual(proximaAba(undefined, 'a', 1), null);
});

test('o módulo é carregado no index.html antes do terminal-keys e do devcode', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const pos = n => html.indexOf(`src="${n}"`);
  assert.ok(pos('atalhos-ide.js') > 0, 'atalhos-ide.js não está no index.html');
  assert.ok(pos('atalhos-ide.js') < pos('terminal-keys.js'));
  assert.ok(pos('atalhos-ide.js') < pos('devcode.js'));
});
