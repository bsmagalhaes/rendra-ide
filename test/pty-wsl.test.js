// pty:create com shell "wsl:<nome>": o nome vem do renderer e só vale se for uma distribuição
// instalada (listWslDistros). Passa pelo handler real, com a lista de distros e o node-pty falsos,
// e o teste afirma se o wsl.exe chegou a ser iniciado.
const test = require('node:test');
const assert = require('node:assert');
const { registerDevCode } = require('../src/devcode');

function montar(distros) {
  const handlers = new Map();
  const lancados = [];
  const ptyFalso = {
    spawn: (file, args) => { lancados.push({ file, args }); return { onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }; },
  };
  const ipcMain = { handle: (nome, fn) => handlers.set(nome, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: (k, d) => d, set() {}, delete() {} };
  registerDevCode({
    ipcMain, dialog: {}, store, getWindow: () => null,
    deps: { listWslDistros: async () => distros.map(name => ({ name, state: 'Running', version: 2, isDefault: false })), loadPty: () => ptyFalso, wakeWslDistro: async () => true },
  });
  return { criar: shell => handlers.get('pty:create')({}, { cols: 80, rows: 24, shell }), lancados };
}

test('wsl:<nome> de uma distro instalada abre o wsl.exe nela', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(['Ubuntu', 'Debian']);
  const r = await t.criar('wsl:Ubuntu');
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(t.lancados.length, 1);
  assert.strictEqual(t.lancados[0].file, 'wsl.exe');
  assert.deepStrictEqual(t.lancados[0].args.slice(0, 2), ['-d', 'Ubuntu']);
});

test('wsl:<nome> fora da lista é recusado e nada é iniciado', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(['Ubuntu']);
  for (const nome of ['Outra', 'Ubuntu -u root', '--exec calc', '', 'ubuntu2']) {
    const r = await t.criar(`wsl:${nome}`);
    assert.ok(r.error, `recusa wsl:${nome}`);
    assert.match(r.error, /WSL/);
  }
  assert.strictEqual(t.lancados.length, 0);
});

test('o nome da distro vale sem diferenciar maiúsculas e usa o nome da lista', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(['Ubuntu']);
  const r = await t.criar('wsl:ubuntu');
  assert.strictEqual(r.error, undefined);
  assert.deepStrictEqual(t.lancados[0].args.slice(0, 2), ['-d', 'Ubuntu']);
});
