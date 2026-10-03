// Decisão pura de tecla do terminal por sistema (renderer/terminal-keys.js, acaoDeTecla). Uma linha por célula da
// tabela: o handler do xterm só executa o que esta função decide.
const test = require('node:test');
const assert = require('node:assert');
const { acaoDeTecla, bytesColarImagem } = require('../renderer/terminal-keys');

const ev = (code, mods = [], extra = {}) => ({
  type: 'keydown', code, key: extra.key || code.replace(/^Key/, '').toLowerCase(), repeat: false,
  ctrlKey: mods.includes('ctrl'), shiftKey: mods.includes('shift'), altKey: mods.includes('alt'), metaKey: mods.includes('meta'), ...extra,
});
const tipo = (e, plat, shell, ctx) => acaoDeTecla(e, plat, shell, ctx).tipo;
const NIX = ['win32', 'linux'];

test('Shift+Enter envia ESC+CR em qualquer sistema', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.deepStrictEqual(acaoDeTecla(ev('Enter', ['shift'], { key: 'Enter' }), p), { tipo: 'enviar', bytes: '\x1b\r' });
  }
});

// ── Ctrl+C ──────────────────────────────────────────────────────────────────
test('Ctrl+C sem Shift, Alt e Meta é ctrlc em qualquer sistema, com Control (não Cmd) no macOS', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.deepStrictEqual(acaoDeTecla(ev('KeyC', ['ctrl']), p), { tipo: 'ctrlc', toque: true, selecao: false });
  }
});

test('Ctrl+C com texto marcado vem marcado como selecao: o handler copia e mostra "Copiado" em vez de contar o toque', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.deepStrictEqual(acaoDeTecla(ev('KeyC', ['ctrl']), p, 'bash', { temSelecao: true }), { tipo: 'ctrlc', toque: true, selecao: true });
  }
});

test('Ctrl+C segurado (repeat) é consumido e não conta como toque; nunca vira deixar (o xterm mandaria \\x03)', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.deepStrictEqual(acaoDeTecla(ev('KeyC', ['ctrl'], { repeat: true }), p), { tipo: 'ctrlc', toque: false, selecao: false });
  }
});

test('keyup e keypress do Ctrl+C também são consumidos, sem contar toque', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    for (const type of ['keyup', 'keypress']) {
      assert.deepStrictEqual(acaoDeTecla(ev('KeyC', ['ctrl'], { type }), p), { tipo: 'ctrlc', toque: false, selecao: false });
    }
  }
});

test('Ctrl+Alt+C, Ctrl+Shift+Alt+C e Meta+C não são o Ctrl+C da IDE', () => {
  assert.strictEqual(tipo(ev('KeyC', ['ctrl', 'alt']), 'linux'), 'deixar');
  assert.strictEqual(tipo(ev('KeyC', ['ctrl', 'shift', 'alt']), 'win32'), 'deixar');
  assert.strictEqual(tipo(ev('KeyC', ['meta']), 'darwin'), 'deixar'); // Cmd+C com seleção segue nativo
  assert.strictEqual(tipo(ev('KeyC', []), 'win32'), 'deixar');
});

test('Ctrl+Shift+C copia a seleção no Windows e no Linux; no macOS fica com o xterm', () => {
  for (const p of NIX) assert.strictEqual(tipo(ev('KeyC', ['ctrl', 'shift']), p), 'copiar-selecao');
  assert.strictEqual(tipo(ev('KeyC', ['ctrl', 'shift']), 'darwin'), 'deixar');
});

// ── Colar ───────────────────────────────────────────────────────────────────
test('Ctrl+V e Ctrl+Shift+V colam (texto ou imagem) no Windows e no Linux', () => {
  for (const p of NIX) {
    assert.strictEqual(tipo(ev('KeyV', ['ctrl']), p), 'colar');
    assert.strictEqual(tipo(ev('KeyV', ['ctrl', 'shift']), p), 'colar');
  }
});

test('macOS: Control+V segue ao programa como \\x16 (deixar), Cmd+V é a colagem nativa e Ctrl+Shift+V fica com o xterm', () => {
  assert.strictEqual(tipo(ev('KeyV', ['ctrl']), 'darwin'), 'deixar');
  assert.strictEqual(tipo(ev('KeyV', ['meta']), 'darwin'), 'nativo');
  assert.strictEqual(tipo(ev('KeyV', ['ctrl', 'shift']), 'darwin'), 'deixar');
});

test('Cmd+V só é nativo no macOS; a tecla Windows+V nos outros sistemas não é tratada', () => {
  assert.strictEqual(tipo(ev('KeyV', ['meta']), 'win32'), 'deixar');
  assert.strictEqual(tipo(ev('KeyV', ['meta']), 'linux'), 'deixar');
});

test('Alt+V cola imagem no Windows e no Linux; no macOS o Option fica como o do sistema (deixar)', () => {
  for (const p of NIX) assert.strictEqual(tipo(ev('KeyV', ['alt']), p), 'colar-imagem');
  assert.strictEqual(tipo(ev('KeyV', ['alt']), 'darwin'), 'deixar');
});

test('Alt+V entrega os bytes decididos por sistema e shell', () => {
  assert.deepStrictEqual(acaoDeTecla(ev('KeyV', ['alt']), 'win32', 'powershell'), { tipo: 'colar-imagem', bytes: bytesColarImagem('win32', 'powershell') });
  assert.deepStrictEqual(acaoDeTecla(ev('KeyV', ['alt']), 'linux', 'bash'), { tipo: 'colar-imagem', bytes: bytesColarImagem('linux', 'bash') });
});

test('Alt+Shift+V e Ctrl+Alt+V não colam imagem', () => {
  assert.strictEqual(tipo(ev('KeyV', ['alt', 'shift']), 'win32'), 'deixar');
  assert.strictEqual(tipo(ev('KeyV', ['ctrl', 'alt']), 'linux'), 'deixar');
});

test('só keydown é tratado: keyup e keypress de V e C (fora do Ctrl+C) ficam com o xterm', () => {
  for (const type of ['keyup', 'keypress']) {
    assert.strictEqual(tipo(ev('KeyV', ['ctrl'], { type }), 'win32'), 'deixar');
    assert.strictEqual(tipo(ev('KeyV', ['alt'], { type }), 'linux'), 'deixar');
    assert.strictEqual(tipo(ev('KeyC', ['ctrl', 'shift'], { type }), 'win32'), 'deixar');
  }
});

// ── O que continua indo ao programa ────────────────────────────────────────
test('Alt+Backspace, Option+Delete e Ctrl+Backspace ficam com o xterm (ESC DEL), em todos os sistemas', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    for (const mods of [['alt'], ['ctrl']]) assert.strictEqual(tipo(ev('Backspace', mods, { key: 'Backspace' }), p), 'deixar');
  }
});

test('Ctrl+L, Ctrl+O e Shift+PageUp/PageDown são do programa e do xterm, nunca da IDE dentro do terminal', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.strictEqual(tipo(ev('KeyL', ['ctrl']), p), 'deixar');
    assert.strictEqual(tipo(ev('PageUp', ['shift'], { key: 'PageUp' }), p), 'deixar');
    assert.strictEqual(tipo(ev('PageDown', ['shift'], { key: 'PageDown' }), p), 'deixar');
  }
  for (const p of NIX) assert.strictEqual(tipo(ev('KeyO', ['ctrl']), p), 'deixar'); // vai ao programa (o Claude usa para o transcript)
});

// ── Atalhos da IDE com o foco no terminal ───────────────────────────────────
test('Ctrl+Shift+T (Cmd+Shift+T no macOS) e Ctrl+Tab não viram bytes: são atalhos da IDE', () => {
  for (const p of NIX) {
    assert.deepStrictEqual(acaoDeTecla(ev('KeyT', ['ctrl', 'shift']), p), { tipo: 'atalho-ide', acao: 'novo-terminal' });
  }
  assert.deepStrictEqual(acaoDeTecla(ev('KeyT', ['meta', 'shift']), 'darwin'), { tipo: 'atalho-ide', acao: 'novo-terminal' });
  assert.strictEqual(tipo(ev('KeyT', ['ctrl', 'shift']), 'darwin'), 'deixar');
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.deepStrictEqual(acaoDeTecla(ev('Tab', ['ctrl'], { key: 'Tab' }), p), { tipo: 'atalho-ide', acao: 'proxima-aba' });
    assert.deepStrictEqual(acaoDeTecla(ev('Tab', ['ctrl', 'shift'], { key: 'Tab' }), p), { tipo: 'atalho-ide', acao: 'aba-anterior' });
  }
});

test('Cmd+O no macOS abre a pasta mesmo com o foco no terminal (o Control+O continua do programa)', () => {
  assert.deepStrictEqual(acaoDeTecla(ev('KeyO', ['meta']), 'darwin'), { tipo: 'atalho-ide', acao: 'abrir-pasta' });
  assert.strictEqual(tipo(ev('KeyO', ['ctrl']), 'darwin'), 'deixar');
});

test('tecla sem relação devolve deixar', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.strictEqual(tipo(ev('KeyA', ['ctrl']), p), 'deixar');
    assert.strictEqual(tipo(ev('Enter', [], { key: 'Enter' }), p), 'deixar');
  }
});

// ── bytesColarImagem ────────────────────────────────────────────────────────
test('bytesColarImagem: Linux e macOS enviam Ctrl+V; WSL também (o Claude liga os dois lá)', () => {
  for (const shell of ['zsh', 'bash', 'fish']) {
    assert.strictEqual(bytesColarImagem('linux', shell), '\x16');
    assert.strictEqual(bytesColarImagem('darwin', shell), '\x16');
  }
  assert.strictEqual(bytesColarImagem('win32', 'wsl'), '\x16');
});
