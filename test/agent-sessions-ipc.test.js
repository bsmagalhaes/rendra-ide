// Canal dev:agent-sessions pelo handler real, com a lista de distros e o orquestrador falsos: o ambiente sai do
// main (pasta aberta, wslFor, lista de distros), nunca do que o renderer manda.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerDevCode } = require('../src/devcode');
const { caminhoNoWsl } = require('../renderer/terminal-escolha');

const win = { skip: process.platform !== 'win32' };

function montar({ workspaces = [], distros = [{ name: 'Ubuntu-24.04', state: 'Running' }] } = {}) {
  const handlers = new Map();
  const chamadas = [];
  let listagens = 0;
  const ipcMain = { handle: (nome, fn) => handlers.set(nome, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: (k, d) => (k === 'devcode.workspaces' ? { list: workspaces, active: 0 } : d), set() {}, delete() {} };
  const resposta = { provedores: { claude: true, codex: false }, sessoes: [{ provedor: 'claude', id: 'x', titulo: 't', quando: 1 }], mais: false };
  registerDevCode({
    ipcMain, dialog: {}, store, getWindow: () => null,
    deps: {
      listWslDistros: async () => { listagens++; return distros.map(d => ({ ...d, version: 2, isDefault: false })); },
      loadPty: () => ({ spawn() { throw new Error('não deve abrir pty'); } }),
      wakeWslDistro: async () => true,
      sessoesAgentes: { listar: async args => { chamadas.push(args); return resposta; } },
    },
  });
  handlers.get('dev:load-workspaces')();
  return { pedir: req => handlers.get('dev:agent-sessions')({}, req), chamadas, listagens: () => listagens, resposta };
}

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-ipc-'));

test('cwd vazio (terminal avulso) devolve lista vazia e não chama o orquestrador', async () => {
  const t = montar();
  for (const cwd of [undefined, null, '', 42]) {
    const r = await t.pedir({ shell: 'powershell', cwd });
    assert.deepStrictEqual(r, { provedores: { claude: false, codex: false }, sessoes: [], mais: false });
  }
  assert.strictEqual(t.chamadas.length, 0);
});

test('cwd fora das pastas abertas é recusado', async () => {
  const aberta = temp(), fora = temp();
  try {
    const t = montar({ workspaces: [{ root: aberta }] });
    const r = await t.pedir({ shell: 'powershell', cwd: fora });
    assert.ok(r.error);
    assert.deepStrictEqual(r.sessoes, []);
    assert.strictEqual(t.chamadas.length, 0);
  } finally { fs.rmSync(aberta, { recursive: true, force: true }); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('shell Windows: ambiente windows com o cwd; o `wsl` forjado no pedido é ignorado', async () => {
  const dir = temp();
  try {
    const t = montar({ workspaces: [{ root: dir }] });
    const r = await t.pedir({ shell: 'powershell', cwd: dir, wsl: { distro: 'Ubuntu-24.04', linuxPath: '/etc' }, amb: { tipo: 'wsl' } });
    assert.deepStrictEqual(r, t.resposta);
    assert.strictEqual(t.chamadas.length, 1);
    assert.deepStrictEqual(t.chamadas[0].amb, { tipo: 'windows', distro: null, cwd: path.resolve(dir) });
    assert.strictEqual(t.chamadas[0].todas, false);
    assert.strictEqual(t.chamadas[0].distroRodando, true);
    const todas = await t.pedir({ shell: 'powershell', cwd: dir, todas: true });
    assert.strictEqual(t.chamadas[1].todas, true);
    assert.deepStrictEqual(todas, t.resposta);
    await t.pedir({ shell: 'powershell', cwd: dir, todas: 'sim' });
    assert.strictEqual(t.chamadas[2].todas, false, 'só o booleano true vale');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('projeto do Windows com shell wsl:<distro> usa a pasta vista de dentro da distro e o nome da lista', win, async () => {
  const dir = temp();
  try {
    const t = montar({ workspaces: [{ root: dir }] });
    await t.pedir({ shell: 'wsl:ubuntu-24.04', cwd: dir });
    assert.deepStrictEqual(t.chamadas[0].amb, { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd: caminhoNoWsl(path.resolve(dir)) });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('shell wsl:<distro desconhecida> é recusado e nada é consultado', win, async () => {
  const dir = temp();
  try {
    const t = montar({ workspaces: [{ root: dir }] });
    for (const nome of ['Outra', 'Ubuntu-24.04 -u root', '--exec calc', '']) {
      const r = await t.pedir({ shell: `wsl:${nome}`, cwd: dir });
      assert.ok(r.error, nome);
      assert.deepStrictEqual(r.sessoes, []);
    }
    assert.strictEqual(t.chamadas.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('workspace WSL "via Windows": distro e linuxPath do workspace (não o /mnt recalculado), subpasta soma o relativo', win, async () => {
  const dir = temp();
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
    const t = montar({ workspaces: [{ root: dir, wsl: { distro: 'Ubuntu-24.04', linuxPath: '/mnt/personalizado/proj' } }] });
    await t.pedir({ shell: 'powershell', cwd: dir });
    assert.deepStrictEqual(t.chamadas[0].amb, { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd: '/mnt/personalizado/proj' });
    await t.pedir({ shell: 'wsl:Outra', cwd: path.join(dir, 'sub') });
    assert.deepStrictEqual(t.chamadas[1].amb, { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd: '/mnt/personalizado/proj/sub' }, 'o shell pedido não muda o ambiente de um workspace WSL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('workspace UNC da distro: linuxPath nativo', win, async () => {
  const unc = '\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\proj';
  const t = montar({ workspaces: [{ root: unc }] });
  await t.pedir({ shell: 'powershell', cwd: unc });
  assert.deepStrictEqual(t.chamadas[0].amb, { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd: '/home/u/proj' });
});

test('distro parada ou ausente da lista: o orquestrador recebe distroRodando falso, ou nada é chamado', win, async () => {
  const dir = temp();
  try {
    const parada = montar({ workspaces: [{ root: dir, wsl: { distro: 'Ubuntu-24.04', linuxPath: '/mnt/c/x' } }], distros: [{ name: 'Ubuntu-24.04', state: 'Stopped' }] });
    await parada.pedir({ shell: 'powershell', cwd: dir });
    assert.strictEqual(parada.chamadas[0].distroRodando, false);
    const ausente = montar({ workspaces: [{ root: dir, wsl: { distro: 'Sumiu', linuxPath: '/mnt/c/x' } }] });
    const r = await ausente.pedir({ shell: 'powershell', cwd: dir });
    assert.deepStrictEqual(r.sessoes, []);
    assert.strictEqual(ausente.chamadas.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('falha no orquestrador vira lista vazia, sem lançar', async () => {
  const dir = temp();
  try {
    const handlers = new Map();
    const ipcMain = { handle: (n, f) => handlers.set(n, f), on() {}, once() {}, removeHandler() {} };
    const store = { get: (k, d) => (k === 'devcode.workspaces' ? { list: [{ root: dir }], active: 0 } : d), set() {}, delete() {} };
    registerDevCode({ ipcMain, dialog: {}, store, getWindow: () => null, deps: { listWslDistros: async () => [], sessoesAgentes: { listar: async () => { throw new Error('quebrou'); } } } });
    handlers.get('dev:load-workspaces')();
    const r = await handlers.get('dev:agent-sessions')({}, { shell: 'powershell', cwd: dir });
    assert.deepStrictEqual(r, { provedores: { claude: false, codex: false }, sessoes: [], mais: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('o contrato do pty:create e do preload seguem: o canal novo só acrescenta', () => {
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const m of ['ptyCreate', 'ptyShells', 'ptyWrite', 'ptyResize', 'ptyKill', 'onPtyData', 'onPtyExit', 'wslInfo']) assert.match(pre, new RegExp(`${m}:`));
  assert.match(pre, /agentSessions: \(opts\) => ipcRenderer\.invoke\('dev:agent-sessions', opts\)/);
});
