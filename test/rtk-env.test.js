// Adaptador de ambiente do RTK: host e distros WSL, com listWslDistros, wsl.exe e execFile falsos.
// Nenhum teste exige wsl.exe nem rtk instalados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRtkEnv } = require('../src/rtk-env');

function montar({ distros = [], platform = 'win32', env = {}, respostas = {}, hostRtk = null, fsFalso } = {}) {
  const chamadas = [];
  const execFile = (file, args, opts, cb) => {
    chamadas.push({ file, args, env: opts.env });
    const chave = args.join(' ');
    const r = Object.entries(respostas).find(([k]) => chave.includes(k))?.[1];
    if (r instanceof Error) return cb(r, '', '');
    cb(null, r ?? '', '');
  };
  const e = createRtkEnv({
    platform, env, execFile, homedir: () => (platform === 'win32' ? 'C:\\Users\\ana' : '/home/ana'),
    listWslDistros: async () => distros,
    toWslUnc: (d, p) => `\\\\wsl.localhost\\${d}${p.replace(/\//g, '\\')}`,
    rtkPath: async () => hostRtk, fs: fsFalso,
  });
  return { e, chamadas };
}
const DISTRO = (name, state = 'Running') => ({ name, state, version: 2, isDefault: false });

test('lista o host e uma entrada por distro; Stopped fica running:false', async () => {
  const { e } = montar({ distros: [DISTRO('Ubuntu-24.04'), DISTRO('Debian', 'Stopped')] });
  const l = await e.listEnvironments();
  assert.deepStrictEqual(l.map(x => [x.id, x.kind, x.running]), [['host', 'host', true], ['Ubuntu-24.04', 'wsl', true], ['Debian', 'wsl', false]]);
  assert.strictEqual(l[0].label, 'Windows');
});

test('listWslDistros devolvendo null: só o host; fora do Windows: só o host', async () => {
  const a = montar({ distros: null });
  assert.strictEqual((await a.e.listEnvironments()).length, 1);
  const b = montar({ platform: 'linux', distros: [DISTRO('X')] });
  assert.deepStrictEqual((await b.e.listEnvironments()).map(x => x.label), ['Linux']);
});

test('RENDRA_HOME ou RENDRA_NO_WSL: só o host (correção 9)', async () => {
  for (const env of [{ RENDRA_HOME: 'x' }, { RENDRA_NO_WSL: '1' }]) {
    const { e } = montar({ distros: [DISTRO('Ubuntu')], env });
    assert.strictEqual((await e.listEnvironments()).length, 1, JSON.stringify(env));
  }
});

test('distro parada: zero chamadas de execução e estado wsl-off; não lê arquivo nem acha rtk', async () => {
  const { e, chamadas } = montar({ distros: [DISTRO('Debian', 'Stopped')] });
  const d = (await e.listEnvironments())[1];
  const r = await e.run(d, ['/home/a/.local/bin/rtk', '--version']);
  assert.deepStrictEqual([r.ok, r.state], [false, 'wsl-off']);
  assert.strictEqual(await e.findRtk(d), null);
  assert.strictEqual(await e.homeOf(d), null);
  assert.strictEqual((await e.readFile(d, '/home/a/x')).state, 'wsl-off');
  assert.strictEqual((await e.writeFile(d, '/home/a/x', 'y')).state, 'wsl-off');
  assert.strictEqual(chamadas.length, 0, 'wsl.exe nunca foi chamado');
});

test('distro Running: a linha usa -d, -e, env K=V e o binário; sem -u e sem --', async () => {
  const { e, chamadas } = montar({ distros: [DISTRO('Ubuntu-24.04')] });
  const d = (await e.listEnvironments())[1];
  await e.run(d, ['/home/bruno/.local/bin/rtk', 'gain', '--all', '--format', 'json'], { env: { RTK_DB_PATH: '/home/bruno/.local/share/rtk/codex/history.db' } });
  assert.strictEqual(chamadas.length, 1);
  const { file, args } = chamadas[0];
  assert.strictEqual(file, 'wsl.exe');
  assert.deepStrictEqual(args, ['-d', 'Ubuntu-24.04', '-e', 'env', 'RTK_DB_PATH=/home/bruno/.local/share/rtk/codex/history.db',
    '/home/bruno/.local/bin/rtk', 'gain', '--all', '--format', 'json']);
  assert.ok(!args.includes('-u') && !args.includes('--'));
});

test('home da distro chega como um único argumento intacto, mesmo com espaço e $()', async () => {
  const { e, chamadas } = montar({ distros: [DISTRO('Ubuntu')], respostas: { 'printf %s': '/home/a b/$(x)' } });
  const d = (await e.listEnvironments())[1];
  assert.strictEqual(await e.homeOf(d), '/home/a b/$(x)');
  assert.deepStrictEqual(chamadas[0].args, ['-d', 'Ubuntu', '-e', 'sh', '-c', 'printf %s "$HOME"']);
  const dirs = await e.agentDirs(d);
  assert.strictEqual(dirs.claudeDir, '/home/a b/$(x)/.claude');
  await e.run(d, ['/home/a b/$(x)/.local/bin/rtk', '--version'], { env: { RTK_DB_PATH: '/home/a b/$(x)/h.db' } });
  const args = chamadas[1].args;
  assert.ok(args.includes('/home/a b/$(x)/.local/bin/rtk'));
  assert.ok(args.includes('RTK_DB_PATH=/home/a b/$(x)/h.db'));
  assert.ok(!args.includes('-c'), 'nenhum script montado por string');
});

test('home da distro é lido uma vez dentro do prazo do cache', async () => {
  const { e, chamadas } = montar({ distros: [DISTRO('Ubuntu')], respostas: { 'printf %s': '/home/bruno' } });
  const d = (await e.listEnvironments())[1];
  await e.homeOf(d); await e.homeOf(d); await e.agentDirs(d);
  assert.strictEqual(chamadas.length, 1);
});

test('home que não é caminho absoluto é recusado', async () => {
  const { e } = montar({ distros: [DISTRO('Ubuntu')], respostas: { 'printf %s': 'erro qualquer' } });
  assert.strictEqual(await e.homeOf((await e.listEnvironments())[1]), null);
});

test('estouro de tempo vira estado error e não derruba os outros ambientes', async () => {
  const lento = Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' });
  const { e } = montar({ distros: [DISTRO('A'), DISTRO('B')], respostas: { '-d A': lento, '-d B': 'ok' } });
  const [, a, b] = await e.listEnvironments();
  const ra = await e.run(a, ['/x/rtk', '--version']);
  assert.deepStrictEqual([ra.ok, ra.state, ra.timedOut], [false, 'error', true]);
  const rb = await e.run(b, ['/x/rtk', '--version']);
  assert.strictEqual(rb.ok, true);
});

test('o host roda o programa direto, com NO_COLOR e as variáveis pedidas', async () => {
  const { e, chamadas } = montar({});
  await e.run(e.HOST, ['C:\\rtk.exe', 'gain'], { env: { RTK_DB_PATH: 'C:\\db\\h.db' } });
  assert.strictEqual(chamadas[0].file, 'C:\\rtk.exe');
  assert.deepStrictEqual(chamadas[0].args, ['gain']);
  assert.strictEqual(chamadas[0].env.RTK_DB_PATH, 'C:\\db\\h.db');
  assert.strictEqual(chamadas[0].env.NO_COLOR, '1');
});

test('resolveEnvironment: só ids que a listagem devolve; nomes estranhos recusados sem chamar wsl.exe', async () => {
  const { e, chamadas } = montar({ distros: [DISTRO('Ubuntu')] });
  assert.strictEqual((await e.resolveEnvironment('host')).kind, 'host');
  assert.strictEqual((await e.resolveEnvironment('Ubuntu')).kind, 'wsl');
  for (const ruim of ['Inexistente', 'Ubuntu;rm', '../x', '', null, 42, 'Ubuntu ']) {
    assert.strictEqual(await e.resolveEnvironment(ruim), null, String(ruim));
  }
  assert.strictEqual(chamadas.length, 0);
});

test('binário da distro: .local/bin primeiro; senão command -v (correção 10)', async () => {
  const existentes = new Set();
  const fsFalso = { existsSync: p => existentes.has(p) };
  const { e, chamadas } = montar({
    distros: [DISTRO('Ubuntu')], fsFalso,
    respostas: { 'printf %s': '/home/bruno', 'command -v rtk': '/usr/bin/rtk\n' },
  });
  const d = (await e.listEnvironments())[1];
  assert.strictEqual(await e.findRtk(d), '/usr/bin/rtk');
  assert.ok(chamadas.some(c => c.args.join(' ').includes('command -v rtk')));
  existentes.add('\\\\wsl.localhost\\Ubuntu\\home\\bruno\\.local\\bin\\rtk');
  assert.strictEqual(await e.findRtk(d), '/home/bruno/.local/bin/rtk');
});

test('binário da distro ausente em toda parte: null', async () => {
  const { e } = montar({ distros: [DISTRO('Ubuntu')], fsFalso: { existsSync: () => false }, respostas: { 'printf %s': '/home/bruno', 'command -v rtk': '' } });
  assert.strictEqual(await e.findRtk((await e.listEnvironments())[1]), null);
});

test('pastas dos agentes do host honram CLAUDE_CONFIG_DIR e CODEX_HOME; senão ~/.claude e ~/.codex', async () => {
  const a = montar({ platform: 'linux', env: { CLAUDE_CONFIG_DIR: '/c/claude', CODEX_HOME: '/c/codex' } });
  const da = await a.e.agentDirs(a.e.HOST);
  assert.deepStrictEqual([da.claudeDir, da.codexDir], ['/c/claude', '/c/codex']);
  const b = montar({ platform: 'linux' });
  const db = await b.e.agentDirs(b.e.HOST);
  assert.deepStrictEqual([db.claudeDir, db.codexDir], ['/home/ana/.claude', '/home/ana/.codex']);
});

test('arquivos do host: grava, relê e confere; falha devolve o erro sem tentar outro caminho', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-env-'));
  try {
    const { e } = montar({ platform: process.platform, fsFalso: fs });
    const p = path.join(tmp, 'a', 'b.json');
    assert.deepStrictEqual(await e.writeFile(e.HOST, p, '{"x":1}'), { ok: true });
    assert.strictEqual((await e.readFile(e.HOST, p)).text, '{"x":1}');
    assert.ok(await e.exists(e.HOST, p));
    assert.strictEqual((await e.stat(e.HOST, p)).size, 7);
    assert.strictEqual((await e.readFile(e.HOST, path.join(tmp, 'nada'))).missing, true);
    const ruim = await e.writeFile(e.HOST, path.join(p, 'dentro-de-arquivo'), 'x');
    assert.strictEqual(ruim.ok, false);
    assert.ok(ruim.error);
    assert.deepStrictEqual(await e.rename(e.HOST, p, p + '.old'), { ok: true });
    assert.ok(!await e.exists(e.HOST, p));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('escrita na distro por UNC é relida e comparada', async () => {
  let gravado = null;
  const fsFalso = {
    mkdirSync() {}, writeFileSync: (p, t) => { gravado = t; },
    readFileSync: () => 'conteúdo diferente do gravado',
  };
  const { e } = montar({ distros: [DISTRO('Ubuntu')], fsFalso });
  const r = await e.writeFile((await e.listEnvironments())[1], '/home/ana/.codex/config.toml', 'abc');
  assert.strictEqual(gravado, 'abc');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /não confere/);
});
