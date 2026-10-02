// Canais IPC do RTK: o ambiente e o agente vêm do renderer e só valem se forem reais.
// Passa pelos handlers de verdade, com ipcMain, ambiente e wsl.exe falsos.
const test = require('node:test');
const assert = require('node:assert');
const { createRtkEnv } = require('../src/rtk-env');
const { registerRtkIpc } = require('../src/rtk-ipc');

function montar({ enable = true } = {}) {
  const handlers = new Map();
  const wslCalls = [];
  const ipcMain = { handle: (n, fn) => handlers.set(n, fn) };
  const env = createRtkEnv({
    platform: 'win32', env: {},
    execFile: (file, args, o, cb) => { wslCalls.push([file, ...args]); cb(null, '', ''); },
    listWslDistros: async () => [{ name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }],
  });
  const instalou = [];
  const ativou = [];
  registerRtkIpc({
    ipcMain, env,
    status: { status: async () => ({ ok: 'status' }), run: async k => ({ k }) },
    install: { install: async (e) => { instalou.push(e.id); return { ok: true }; } },
    enable: enable ? { enable: async (e, agent) => { ativou.push([e.id, agent]); return { ok: true }; } } : undefined,
  });
  return { call: (n, ...a) => handlers.get(n)({}, ...a), instalou, ativou, wslCalls, handlers };
}

test('rtk-install: ids reais passam; inexistente e com injeção são recusados sem tocar wsl.exe', async () => {
  const t = montar();
  assert.deepStrictEqual(await t.call('rtk-install', 'host'), { ok: true });
  assert.deepStrictEqual(await t.call('rtk-install', 'Ubuntu-24.04'), { ok: true });
  assert.deepStrictEqual(t.instalou, ['host', 'Ubuntu-24.04']);
  const antes = t.wslCalls.length;
  for (const ruim of ['Inexistente', 'Ubuntu;rm', '../x', '', undefined, { name: 'Ubuntu-24.04' }]) {
    const r = await t.call('rtk-install', ruim);
    assert.strictEqual(r.ok, false, String(ruim));
    assert.match(r.error, /inválido/);
  }
  assert.strictEqual(t.instalou.length, 2, 'nada foi instalado');
  assert.strictEqual(t.wslCalls.length, antes, 'wsl.exe não foi chamado');
});

test('rtk-enable: agente fora de claude|codex é recusado; ambiente inválido também', async () => {
  const t = montar();
  assert.deepStrictEqual(await t.call('rtk-enable', { env: 'host', agent: 'codex' }), { ok: true });
  assert.deepStrictEqual(await t.call('rtk-enable', { env: 'Ubuntu-24.04', agent: 'claude' }), { ok: true });
  for (const req of [{ env: 'host', agent: 'gemini' }, { env: 'host', agent: '__proto__' }, { env: 'host' }, null, { env: 'Ubuntu;rm', agent: 'codex' }, { env: 'Nao', agent: 'claude' }]) {
    const r = await t.call('rtk-enable', req);
    assert.strictEqual(r.ok, false, JSON.stringify(req));
  }
  assert.deepStrictEqual(t.ativou, [['host', 'codex'], ['Ubuntu-24.04', 'claude']]);
});

test('rtk-status e rtk-run seguem registrados', async () => {
  const t = montar({ enable: false });
  assert.deepStrictEqual(await t.call('rtk-status'), { ok: 'status' });
  assert.deepStrictEqual(await t.call('rtk-run', 'gain'), { k: 'gain' });
  assert.ok(!t.handlers.has('rtk-enable'));
});
