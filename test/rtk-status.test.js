// rtk-status: estado por ambiente e agente, com rtk, wsl.exe e sistema de arquivos falsos
// (em memória). Nenhum teste lê ~/.claude, ~/.codex, history.db nem a distro real.
const test = require('node:test');
const assert = require('node:assert');
const { createRtkEnv } = require('../src/rtk-env');
const { createRtkStatus } = require('../src/rtk-status');
const P = require('../src/rtk-paths');
const C = require('../src/rtk-config');

const RTK_HASH = C.codexHookHash({ matcher: 'Bash' }, { type: 'command', command: 'rtk hook codex' });

const unc = (d, p) => `\\\\wsl.localhost\\${d}${p.replace(/\//g, '\\')}`;
const gainJson = saved => JSON.stringify({
  summary: { total_commands: 10, total_input: saved * 2, total_output: saved, total_saved: saved, avg_savings_pct: 50, total_time_ms: 100, avg_time_ms: 10 },
  daily: [{ date: '2026-10-01', commands: 10, input_tokens: saved * 2, output_tokens: saved, saved_tokens: saved, savings_pct: 50, total_time_ms: 100, avg_time_ms: 10 }],
  weekly: [], monthly: [],
});

// cenário: arquivos { caminho: texto }, versões e ganhos por RTK_DB_PATH
function montar({ platform = 'linux', distros = [], files = {}, version = 'rtk 0.50.0', wslVersion, gains = {}, hostRtk, wslRtk = true, procEnv = {} } = {}) {
  const chamadas = [];
  const arquivos = new Map(Object.entries(files));
  const fsFalso = {
    existsSync: p => arquivos.has(p),
    readFileSync: p => { if (!arquivos.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return arquivos.get(p); },
    statSync: p => ({ size: arquivos.get(p).length, mtimeMs: 1 }),
    mkdirSync() {}, writeFileSync() {}, renameSync() {}, rmSync() {},
  };
  const homeHost = platform === 'win32' ? 'C:\\Users\\ana' : '/home/ana';
  const execFile = (file, args, opts, cb) => {
    chamadas.push({ file, args, env: opts.env });
    const naDistro = file === 'wsl.exe';
    const dbPath = naDistro ? args.find(a => a.startsWith('RTK_DB_PATH='))?.slice(12) : opts.env.RTK_DB_PATH;
    const resto = naDistro ? args.slice(args.indexOf('-e') + 1).filter(a => a !== 'env' && !a.startsWith('RTK_DB_PATH=')) : args;
    if (naDistro && resto[0] === 'sh' && resto[2].includes('printf')) return cb(null, '/home/bruno', '');
    if (naDistro && resto[0] === 'sh' && resto[2].includes('command -v')) return cb(null, '', '');
    const ver = naDistro ? (wslVersion || version) : version;
    if (resto.includes('--version')) return cb(null, ver + '\n', '');
    if (resto.includes('gain')) {
      const g = gains[dbPath];
      if (g instanceof Error) return cb(g, '', 'boom');
      return cb(null, g ?? gainJson(0), '');
    }
    return cb(null, '', '');
  };
  const env = createRtkEnv({
    platform, env: procEnv, execFile, fs: fsFalso, homedir: () => homeHost,
    listWslDistros: async () => distros.map(([name, state]) => ({ name, state, version: 2, isDefault: false })),
    toWslUnc: unc,
    rtkPath: async () => (hostRtk === undefined ? (platform === 'win32' ? 'C:\\Users\\ana\\.local\\bin\\rtk.exe' : '/home/ana/.local/bin/rtk') : hostRtk),
  });
  if (wslRtk) arquivos.set(unc('Ubuntu-24.04', '/home/bruno/.local/bin/rtk'), 'bin');
  const hostRuns = [];
  const st = createRtkStatus({
    env, processEnv: procEnv,
    runRtk: async args => { hostRuns.push(args); return { ok: true, output: args[0] === 'init' ? '[ok] Hook: rtk hook claude\n' : '' }; },
    codexLegacy: async () => ({ installed: true, configured: false, home: '/h/.codex', homes: ['/h/.codex'] }),
  });
  return { st, chamadas, hostRuns, arquivos };
}

const LIN = { claude: P.claudeDbPath({ platform: 'linux', env: {}, home: '/home/ana' }), codex: P.codexDbPath({ platform: 'linux', env: {}, home: '/home/ana' }) };
const gainCalls = c => c.filter(x => x.args.includes('gain'));

test('(a) host sozinho com os dois bancos: duas leituras com RTK_DB_PATH diferentes, cada JSON no agente certo', async () => {
  const { st, chamadas } = montar({
    files: { [LIN.claude]: 'db', [LIN.codex]: 'db' },
    gains: { [LIN.claude]: gainJson(1000), [LIN.codex]: gainJson(400) },
  });
  const r = await st.status();
  assert.strictEqual(r.environments.length, 1);
  const a = r.environments[0].agents;
  assert.strictEqual(a.claude.gain.summary.total_saved, 1000);
  assert.strictEqual(a.codex.gain.summary.total_saved, 400);
  const dbs = gainCalls(chamadas).map(c => c.env.RTK_DB_PATH).sort();
  assert.deepStrictEqual(dbs, [LIN.claude, LIN.codex].sort());
  assert.notStrictEqual(LIN.claude, LIN.codex);
  assert.strictEqual(a.claude.dbPath, LIN.claude);
  assert.strictEqual(a.codex.dbPath, LIN.codex);
});

test('(b) Windows com distro Running: segundo ambiente com os dados da distro, chamada por wsl.exe -d', async () => {
  const wClaude = '/home/bruno/.local/share/rtk/history.db';
  const wCodex = '/home/bruno/.local/share/rtk/codex/history.db';
  const { st, chamadas } = montar({
    platform: 'win32', distros: [['Ubuntu-24.04', 'Running']], procEnv: { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' },
    files: { [unc('Ubuntu-24.04', wClaude)]: 'db', [unc('Ubuntu-24.04', wCodex)]: 'db' },
    gains: { [wClaude]: gainJson(7000), [wCodex]: gainJson(300) },
  });
  const r = await st.status();
  assert.deepStrictEqual(r.environments.map(e => [e.id, e.state]), [['host', 'ok'], ['Ubuntu-24.04', 'ok']]);
  const wsl = r.environments[1];
  assert.strictEqual(wsl.agents.claude.gain.summary.total_saved, 7000);
  assert.strictEqual(wsl.agents.codex.gain.summary.total_saved, 300);
  const viaWsl = chamadas.filter(c => c.file === 'wsl.exe' && c.args.includes('gain'));
  assert.strictEqual(viaWsl.length, 2);
  assert.ok(viaWsl.every(c => c.args.slice(0, 3).join(' ') === '-d Ubuntu-24.04 -e'));
  assert.ok(viaWsl.every(c => c.args.includes('/home/bruno/.local/bin/rtk')));
  assert.ok(chamadas.every(c => !c.args.includes('-u')));
});

test('(c) distro Stopped: wsl-off, agentes vazios, nenhuma chamada que execute rtk nem wsl.exe', async () => {
  const { st, chamadas } = montar({ platform: 'win32', distros: [['Ubuntu-24.04', 'Stopped']] });
  const r = await st.status();
  const d = r.environments[1];
  assert.deepStrictEqual([d.state, d.agents], ['wsl-off', {}]);
  assert.strictEqual(chamadas.filter(c => c.file === 'wsl.exe').length, 0);
});

test('(d) rtk ausente na distro: missing', async () => {
  const { st } = montar({ platform: 'win32', distros: [['Ubuntu-24.04', 'Running']], wslRtk: false });
  const d = (await st.status()).environments[1];
  assert.strictEqual(d.state, 'missing');
});

test('(e) versão 0.48.0 marca needsUpdate; 0.50.0 não', async () => {
  const velho = await montar({ version: 'rtk 0.48.0' }).st.status();
  assert.strictEqual(velho.environments[0].needsUpdate, true);
  assert.strictEqual(velho.environments[0].version, '0.48.0');
  assert.strictEqual(velho.version, 'rtk 0.48.0', 'o texto cru de antes continua no topo');
  const novo = await montar({}).st.status();
  assert.strictEqual(novo.environments[0].needsUpdate, false);
  assert.strictEqual(novo.min, '0.50.0');
});

test('(f) JSON inválido do Codex: erro só do Codex; Claude intacto', async () => {
  const { st } = montar({ files: { [LIN.claude]: 'db', [LIN.codex]: 'db' }, gains: { [LIN.claude]: gainJson(900), [LIN.codex]: 'isto não é json' } });
  const a = (await st.status()).environments[0].agents;
  assert.strictEqual(a.claude.error, null);
  assert.strictEqual(a.claude.gain.summary.total_saved, 900);
  assert.match(a.codex.error, /JSON/);
  assert.strictEqual(a.codex.gain.summary.total_saved, 0);
});

test('falha de execução de um agente vira erro só dele', async () => {
  const { st } = montar({ files: { [LIN.claude]: 'db', [LIN.codex]: 'db' }, gains: { [LIN.claude]: gainJson(5), [LIN.codex]: new Error('x') } });
  const a = (await st.status()).environments[0].agents;
  assert.strictEqual(a.claude.error, null);
  assert.ok(a.codex.error);
});

test('(g) Linux sem WSL: um ambiente', async () => {
  const r = await montar({ platform: 'linux', distros: [['Ubuntu', 'Running']] }).st.status();
  assert.strictEqual(r.environments.length, 1);
  assert.strictEqual(r.environments[0].label, 'Linux');
});

test('(h) rtk-run: codex-init e init -g são recusados; leitura segue valendo', async () => {
  const { st, hostRuns } = montar({});
  const r = await st.run('codex-init');
  assert.strictEqual(r.ok, false);
  assert.match(r.output, /não permitido/);
  assert.strictEqual((await st.run('init -g --codex')).ok, false);
  assert.strictEqual(hostRuns.length, 0, 'nada chegou ao rtk');
  const ok = await st.run('periods');
  assert.strictEqual(ok.command, 'rtk gain --all');
  assert.deepStrictEqual(hostRuns[0], ['gain', '--all']);
  assert.ok(!Object.values(require('../src/rtk-status').RTK_COMMANDS).some(a => a.includes('-g')));
});

test('(i) banco do Codex ausente: zeros e nenhuma leitura com o caminho dele (a leitura não cria arquivo)', async () => {
  const { st, chamadas } = montar({ files: { [LIN.claude]: 'db' }, gains: { [LIN.claude]: gainJson(50) } });
  const a = (await st.status()).environments[0].agents;
  assert.strictEqual(a.codex.gain.summary.total_saved, 0);
  assert.deepStrictEqual(a.codex.gain.daily, []);
  assert.strictEqual(a.codex.error, null);
  assert.ok(gainCalls(chamadas).every(c => c.env.RTK_DB_PATH !== LIN.codex));
  assert.strictEqual(gainCalls(chamadas).length, 1);
});

test('(j) o campo codex de antes continua com installed, configured, home e homes', async () => {
  const r = await montar({}).st.status();
  assert.deepStrictEqual(Object.keys(r.codex).sort(), ['configured', 'home', 'homes', 'installed']);
  assert.strictEqual(r.installed, true);
  assert.deepStrictEqual(r.checks, [{ ok: true, text: 'Hook: rtk hook claude' }]);
  assert.deepStrictEqual(r.byCommand, []);
});

test('estado do hook por agente: ausente, presente, absoluto, banco no env e confiança', async () => {
  const hj = '/home/ana/.codex/hooks.json';
  const base = {
    [LIN.claude]: 'db',
    '/home/ana/.claude/settings.json': JSON.stringify({ env: { RTK_DB_PATH: LIN.claude }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/home/ana/.local/bin/rtk hook claude' }] }] } }),
    [hj]: JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo orca' }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] }] } }),
    '/home/ana/.codex/config.toml': `[hooks.state."${hj}:pre_tool_use:1:0"]\nenabled = true\ntrusted_hash = "${RTK_HASH}"\n\n[shell_environment_policy]\nset = { RTK_DB_PATH = '${LIN.codex}' }\n`,
  };
  const a = (await montar({ files: base }).st.status()).environments[0].agents;
  assert.deepStrictEqual([a.claude.hook, a.claude.hookAbsolute, a.claude.dbEnvConfigured], [true, true, true]);
  assert.deepStrictEqual([a.codex.hook, a.codex.hookAbsolute, a.codex.dbEnvConfigured, a.codex.trust], [true, false, true, 'trusted']);
  assert.strictEqual(a.codex.writableRootsSnippet, undefined, 'o snippet de writable_roots saiu do estado (a IDE grava sozinha quando cabe)');

  const vazio = (await montar({}).st.status()).environments[0].agents;
  assert.deepStrictEqual([vazio.claude.hook, vazio.codex.hook, vazio.codex.trust, vazio.codex.dbEnvConfigured], [false, false, null, false]);
});

test('sem rtk no host: installed false, mas os ambientes seguem na resposta', async () => {
  const r = await montar({ hostRtk: null }).st.status();
  assert.strictEqual(r.installed, false);
  assert.strictEqual(r.environments[0].state, 'missing');
});

test('avisos do host (WinGet defasado) entram no ambiente do host', async () => {
  const m = montar({});
  const st = createRtkStatus({
    env: createRtkEnv({ platform: 'linux', env: {}, execFile: (f, a, o, cb) => cb(null, 'rtk 0.50.0\n', ''), fs: { existsSync: () => false }, homedir: () => '/home/ana', rtkPath: async () => '/home/ana/.local/bin/rtk' }),
    processEnv: {}, runRtk: async () => ({ ok: true, output: '' }),
    hostWarnings: async () => [{ kind: 'winget', command: 'winget upgrade --id rtk-ai.rtk' }],
  });
  const host = (await st.status()).environments[0];
  assert.strictEqual(host.warnings[0].kind, 'winget');
  assert.deepStrictEqual((await m.st.status()).environments[0].warnings, undefined);
});

test('installed por agente: a pasta do agente existe no ambiente', async () => {
  const a = (await montar({ files: { '/home/ana/.claude': 'dir' } }).st.status()).environments[0].agents;
  assert.deepStrictEqual([a.claude.installed, a.codex.installed], [true, false]);
});

test('estado do Codex: trusted sem texto de aviso; modified e untrusted com o texto do /hooks (fonte única em src/rtk-enable.js)', async () => {
  const hj = '/home/ana/.codex/hooks.json';
  const hooks = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] }] } });
  const tom = h => (h ? `[hooks.state.'${hj}:pre_tool_use:0:0']\ntrusted_hash = "${h}"\n` : '');
  const estado = async toml => (await montar({ files: { [hj]: hooks, '/home/ana/.codex/config.toml': toml } }).st.status()).environments[0].agents.codex;
  const { TRUST_MSG } = require('../src/rtk-enable');
  const t = await estado(tom(RTK_HASH));
  assert.deepStrictEqual([t.trust, t.trustMessage], ['trusted', null]);
  const m = await estado(tom('sha256:velho'));
  assert.deepStrictEqual([m.trust, m.trustMessage], ['modified', TRUST_MSG]);
  const u = await estado('');
  assert.deepStrictEqual([u.trust, u.trustMessage], ['untrusted', TRUST_MSG]);
  const semHook = (await montar({}).st.status()).environments[0].agents.codex;
  assert.deepStrictEqual([semHook.trust, semHook.trustMessage], [null, null]);
});

test('com CODEX_HOME a chave usa o caminho canônico (junção ou link): o destino, não o apelido', async () => {
  const real = '/dados/codex-real';
  const hooks = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] }] } });
  const files = {
    '/home/ana/apelido/hooks.json': hooks,
    '/home/ana/apelido/config.toml': `[hooks.state.'${real}/hooks.json:pre_tool_use:0:0']\ntrusted_hash = "${RTK_HASH}"\n`,
  };
  const resolve = p => (p === '/home/ana/apelido' ? real : p);
  const fsx = {
    existsSync: p => p in files, readFileSync: p => files[p], statSync: () => ({ size: 1, mtimeMs: 1 }),
    realpathSync: Object.assign(resolve, { native: resolve }),
  };
  const procEnv = { CODEX_HOME: '/home/ana/apelido' };
  const env = createRtkEnv({ platform: 'linux', env: procEnv, fs: fsx, homedir: () => '/home/ana', rtkPath: async () => '/home/ana/.local/bin/rtk', execFile: (f, a, o, cb) => cb(null, 'rtk 0.50.0\n', '') });
  const st = createRtkStatus({ env, processEnv: procEnv, runRtk: async () => ({ ok: true, output: '' }) });
  assert.strictEqual((await st.status()).environments[0].agents.codex.trust, 'trusted');
  // sem CODEX_HOME a pasta padrão é usada como está, sem canonizar
  const env2 = createRtkEnv({ platform: 'linux', env: {}, fs: fsx, homedir: () => '/home/ana', rtkPath: async () => '/x', execFile: (f, a, o, cb) => cb(null, '', '') });
  assert.strictEqual(await env2.codexKeyDir(env2.HOST, { codexDir: '/home/ana/apelido' }), '/home/ana/apelido');
  assert.strictEqual(await env.codexKeyDir(env.HOST, { codexDir: '/home/ana/apelido' }), real);
});
