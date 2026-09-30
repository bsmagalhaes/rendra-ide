// Shift+Enter quebra a linha nas CLIs de IA (Claude Code, Codex) em qualquer sistema:
// o terminal envia ESC + CR, a mesma sequência que o xterm.js já envia para Alt+Enter
const test = require('node:test');
const assert = require('node:assert');
const { sequenciaDeTecla } = require('../renderer/terminal-keys');

const enter = (extra = {}) => ({ type: 'keydown', key: 'Enter', code: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra });
const NOVA_LINHA = '\x1b\r';

for (const plataforma of ['win32', 'darwin', 'linux']) {
  test(`Shift+Enter envia ESC+CR em ${plataforma}`, () => {
    assert.strictEqual(sequenciaDeTecla(enter({ shiftKey: true }), plataforma), NOVA_LINHA);
  });

  test(`Enter sozinho, Ctrl, Cmd e Alt+Enter ficam com o xterm em ${plataforma}`, () => {
    assert.strictEqual(sequenciaDeTecla(enter(), plataforma), null);
    assert.strictEqual(sequenciaDeTecla(enter({ ctrlKey: true }), plataforma), null);
    assert.strictEqual(sequenciaDeTecla(enter({ metaKey: true }), plataforma), null);
    assert.strictEqual(sequenciaDeTecla(enter({ altKey: true }), plataforma), null);
  });

  test(`keyup e keypress não geram sequência em ${plataforma}`, () => {
    assert.strictEqual(sequenciaDeTecla(enter({ shiftKey: true, type: 'keyup' }), plataforma), null);
    assert.strictEqual(sequenciaDeTecla(enter({ shiftKey: true, type: 'keypress' }), plataforma), null);
  });
}

test('Shift com outras teclas e Shift+Enter combinado com modificadores não mudam', () => {
  assert.strictEqual(sequenciaDeTecla(enter({ shiftKey: true, key: 'a', code: 'KeyA' }), 'linux'), null);
  assert.strictEqual(sequenciaDeTecla(enter({ shiftKey: true, ctrlKey: true }), 'linux'), null);
  assert.strictEqual(sequenciaDeTecla(enter({ shiftKey: true, altKey: true }), 'win32'), null);
  assert.strictEqual(sequenciaDeTecla(enter({ shiftKey: true, metaKey: true }), 'darwin'), null);
});
