// ConPTY embarcado do node-pty: opções passadas ao pty.spawn conforme a configuração e o sistema.
// Passa pelo handler real de pty:create, com o node-pty falso; o teste afirma o que o spawn recebeu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { registerDevCode, opcoesConpty } = require('../src/devcode');

function montar(settings) {
  const handlers = new Map();
  const opcoes = [];
  const ptyFalso = { spawn: (_f, _a, o) => { opcoes.push(o); return { onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }; } };
  const ipcMain = { handle: (n, fn) => handlers.set(n, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: (k, d) => (k === 'settings' && settings ? settings : d), set() {}, delete() {} };
  registerDevCode({ ipcMain, dialog: {}, store, getWindow: () => null, deps: { loadPty: () => ptyFalso, listWslDistros: async () => [], wakeWslDistro: async () => true } });
  return { criar: () => handlers.get('pty:create')({}, { cols: 80, rows: 24 }), opcoes };
}

test('opcoesConpty: no Windows vale a configuração, padrão ligado', () => {
  assert.deepStrictEqual(opcoesConpty(true, {}), { useConptyDll: true });
  assert.deepStrictEqual(opcoesConpty(true, undefined), { useConptyDll: true });
  assert.deepStrictEqual(opcoesConpty(true, { conptyDll: true }), { useConptyDll: true });
  assert.deepStrictEqual(opcoesConpty(true, { conptyDll: false }), { useConptyDll: false });
});

test('opcoesConpty: Linux e macOS não recebem nenhuma opção de ConPTY', () => {
  assert.deepStrictEqual(opcoesConpty(false, {}), {});
  assert.deepStrictEqual(opcoesConpty(false, { conptyDll: false }), {});
});

test('pty:create passa useConptyDll ao node-pty (padrão ligado), sem a opção obsoleta useConpty', { skip: process.platform !== 'win32' }, async () => {
  const t = montar(null);
  const r = await t.criar();
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(t.opcoes[0].useConptyDll, true);
  assert.ok(!('useConpty' in t.opcoes[0]));
});

test('pty:create com a opção desligada nas Configurações usa o ConPTY do sistema', { skip: process.platform !== 'win32' }, async () => {
  const t = montar({ conptyDll: false });
  await t.criar();
  assert.strictEqual(t.opcoes[0].useConptyDll, false);
});

test('fora do Windows o spawn não recebe useConptyDll', { skip: process.platform === 'win32' }, async () => {
  const t = montar({ conptyDll: true });
  await t.criar();
  assert.ok(!('useConptyDll' in t.opcoes[0]));
});

test('o pacote desempacota o node-pty (conpty.dll e OpenConsole.exe saem do asar)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.asarUnpack.includes('node_modules/@lydell/**'));
});

test('a configuração conptyDll tem padrão ligado e controle nas Configurações', () => {
  const raiz = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(raiz, 'main.js'), 'utf8'), /conptyDll: true/);
  assert.match(fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8'), /id="s-conpty"/);
  assert.match(fs.readFileSync(path.join(raiz, 'renderer', 'app.js'), 'utf8'), /conptyDll:\s+document\.getElementById\('s-conpty'\)\.checked/);
});
