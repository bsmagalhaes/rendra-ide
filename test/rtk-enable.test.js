// Ativar o RTK em um agente: pastas temporárias, `rtk` falso que escreve o que o `rtk init` 0.50.0
// escreve (F12, F44, F54). Nenhum teste toca ~/.claude, ~/.codex, %APPDATA% nem a distro real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRtkEnv } = require('../src/rtk-env');
const { createRtkEnable } = require('../src/rtk-enable');
const { createRtkStatus } = require('../src/rtk-status');
const P = require('../src/rtk-paths');
const C = require('../src/rtk-config');

const LF = s => s.replace(/\r\n/g, '\n');
const fx = n => LF(fs.readFileSync(path.join(__dirname, 'fixtures', 'rtk', n), 'utf8'));
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const ORCA_HOOKS = fx('codex-hooks-orca.json');
const CONFIG_TOML = fx('codex-config.toml');
const CLAUDE_SEM_RTK = JSON.stringify({
  permissions: { allow: ['Bash(git status:*)'] },
  hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'orca-claude-hook', timeout: 10 }] }] },
}, null, 2) + '\n';

// ── harness ─────────────────────────────────────────────────────────────────
function ambiente({ distro = false, version = 'rtk 0.50.0', running = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-enable-'));
  const chamadas = [];
  const hostHome = path.join(tmp, 'home');
  const platform = distro ? 'win32' : process.platform;
  const procEnv = {
    LOCALAPPDATA: path.join(tmp, 'local'), XDG_DATA_HOME: path.join(tmp, 'local'),
    APPDATA: path.join(tmp, 'roaming'), XDG_CONFIG_HOME: path.join(tmp, 'roaming'),
  };
  // distro falsa: /home/ana vira tmp/wsl/Ubuntu/home/ana
  const unc = (d, p) => path.join(tmp, 'wsl', d, ...p.split('/').filter(Boolean));
  const toFs = (p, naDistro) => (naDistro ? unc('Ubuntu', p) : p);
  const rtkHost = path.join(hostHome, '.local', 'bin', process.platform === 'win32' ? 'rtk.exe' : 'rtk');
  const rtkDistro = '/home/ana/.local/bin/rtk';

  const lerJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
  const grava = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
  function simular(vars, argv, naDistro) {
    const j = argv.slice(1).join(' ');
    chamadas.push({ argv: argv.join(' '), db: vars.RTK_DB_PATH, vars, naDistro });
    if (j === '--version') return { out: version + '\n' };
    if (j === 'init -g --auto-patch') {
      const dir = toFs(vars.CLAUDE_CONFIG_DIR, naDistro);
      const f = path.join(dir, 'settings.json');
      const o = lerJson(f);
      o.hooks = o.hooks || {}; o.hooks.PreToolUse = o.hooks.PreToolUse || [];
      if (!o.hooks.PreToolUse.some(g => (g.hooks || []).some(h => P.isRtkHookCommand(h.command, 'claude')))) o.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] });
      grava(f, o);
      fs.writeFileSync(path.join(dir, 'RTK.md'), '<!-- rtk-owned -->\n');
      const cm = path.join(dir, 'CLAUDE.md');
      const cur = fs.existsSync(cm) ? fs.readFileSync(cm, 'utf8') : '';
      if (!cur.includes('@RTK.md')) fs.writeFileSync(cm, cur + '@RTK.md\n');
      return { out: '' };
    }
    if (j === 'init -g --codex') {
      const dir = toFs(vars.CODEX_HOME, naDistro);
      const f = path.join(dir, 'hooks.json');
      const o = lerJson(f);
      o.hooks = o.hooks || {}; o.hooks.PreToolUse = o.hooks.PreToolUse || [];
      if (!o.hooks.PreToolUse.some(g => (g.hooks || []).some(h => P.isRtkHookCommand(h.command, 'codex')))) o.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] });
      grava(f, o);
      fs.writeFileSync(path.join(dir, 'RTK.md'), '<!-- rtk-owned -->\n');
      const am = path.join(dir, 'AGENTS.md');
      const cur = fs.existsSync(am) ? fs.readFileSync(am, 'utf8') : '';
      if (!cur.includes('RTK.md')) fs.writeFileSync(am, cur + '@/abs/RTK.md\n');
      return { out: '' };
    }
    if (j === 'gain --all --format json') {
      const db = toFs(vars.RTK_DB_PATH, naDistro);
      if (!fs.existsSync(db)) { fs.mkdirSync(path.dirname(db), { recursive: true }); fs.writeFileSync(db, 'sqlite-vazio'); }
      return { out: JSON.stringify({ summary: { total_commands: 0, total_input: 0, total_output: 0, total_saved: 0, avg_savings_pct: 0, total_time_ms: 0, avg_time_ms: 0 }, daily: [], weekly: [], monthly: [] }) };
    }
    return { out: '' };
  }
  const execFile = (file, args, opts, cb) => {
    try {
      if (file === 'wsl.exe') {
        const i = args.indexOf('-e');
        let resto = args.slice(i + 1);
        const vars = {};
        if (resto[0] === 'env') { resto = resto.slice(1); while (resto[0] && /^[A-Z_]+=/.test(resto[0])) { const [k, ...v] = resto.shift().split('='); vars[k] = v.join('='); } }
        chamadas.push({ wsl: args.join(' ') });
        if (resto[0] === 'sh' && resto[2].includes('printf')) return cb(null, '/home/ana', '');
        if (resto[0] === 'sh' && resto[2].includes('command -v')) return cb(null, '', '');
        return cb(null, simular(vars, resto, true).out, '');
      }
      const vars = { ...opts.env };
      return cb(null, simular(vars, [file, ...args], false).out, '');
    } catch (err) { return cb(err, '', String(err.message)); }
  };
  const env = createRtkEnv({
    platform, env: procEnv, execFile, homedir: () => hostHome,
    listWslDistros: async () => [{ name: 'Ubuntu', state: running ? 'Running' : 'Stopped', version: 2, isDefault: true }],
    toWslUnc: unc, rtkPath: async () => rtkHost,
  });
  if (distro && running) { fs.mkdirSync(path.dirname(unc('Ubuntu', rtkDistro)), { recursive: true }); fs.writeFileSync(unc('Ubuntu', rtkDistro), 'bin'); }
  const caminho = (...p) => (distro ? unc('Ubuntu', ['', 'home', 'ana', ...p].join('/')) : path.join(hostHome, ...p));
  const dirsDe = () => ({
    claude: caminho('.claude'), codex: caminho('.codex'),
    claudeDb: distro ? unc('Ubuntu', '/home/ana/.local/share/rtk/history.db') : P.claudeDbPath({ platform, env: procEnv, home: hostHome }),
    codexDb: distro ? unc('Ubuntu', '/home/ana/.local/share/rtk/codex/history.db') : P.codexDbPath({ platform, env: procEnv, home: hostHome }),
  });
  if (!distro) { fs.mkdirSync(path.dirname(rtkHost), { recursive: true }); fs.writeFileSync(rtkHost, 'bin'); }
  return { tmp, env, chamadas, procEnv, d: dirsDe(), caminho, rtkHost, rtkDistro, distro, platform };
}
const limpar = t => fs.rmSync(t.tmp, { recursive: true, force: true });
const ler = f => fs.readFileSync(f, 'utf8');
const escrever = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
async function alvo(t) { return t.distro ? (await t.env.listEnvironments()).find(e => e.id === 'Ubuntu') : t.env.HOST; }
function ativador(t, { env = t.env, now = () => new Date(2026, 9, 2, 10, 0, 0).getTime() } = {}) {
  return createRtkEnable({ env, processEnv: t.procEnv, now, gitBash: async () => true });
}
const wslHome = '/home/ana';

// ── Claude ──────────────────────────────────────────────────────────────────
test('Claude no host: hook absoluto e env.RTK_DB_PATH; Orca e demais chaves iguais; banco do Claude intacto (hash)', async () => {
  const t = ambiente();
  try {
    escrever(path.join(t.d.claude, 'settings.json'), CLAUDE_SEM_RTK);
    escrever(t.d.claudeDb, 'historico-do-claude');
    const hashDb = sha(ler(t.d.claudeDb));
    const r = await ativador(t).enable(await alvo(t), 'claude');
    assert.strictEqual(r.ok, true, r.error);
    const antes = JSON.parse(CLAUDE_SEM_RTK);
    const depois = JSON.parse(ler(path.join(t.d.claude, 'settings.json')));
    assert.strictEqual(depois.env.RTK_DB_PATH, t.d.claudeDb);
    const abs = P.hookCommand(t.rtkHost, 'claude', t.platform, { gitBash: true }).command;
    assert.strictEqual(depois.hooks.PreToolUse[1].hooks[0].command, abs);
    assert.deepStrictEqual(depois.hooks.PreToolUse[0], antes.hooks.PreToolUse[0]);
    assert.deepStrictEqual(depois.permissions, antes.permissions);
    assert.strictEqual(sha(ler(t.d.claudeDb)), hashDb, 'o banco do Claude não mudou');
    assert.ok(t.chamadas.filter(c => c.db).every(c => c.db === t.d.claudeDb || c.db === t.d.codexDb));
    assert.ok(t.chamadas.filter(c => c.db).every(c => c.db === t.d.claudeDb), 'só o banco padrão do Claude foi usado');
    const ch = r.changes.map(c => path.basename(c.file)).sort();
    assert.deepStrictEqual(ch, ['CLAUDE.md', 'RTK.md', 'settings.json']);
    assert.strictEqual(r.changes.find(c => c.file.endsWith('settings.json')).kind, 'modified');
    assert.ok(ler(r.changes.find(c => c.file.endsWith('settings.json')).backup).includes('orca-claude-hook'), 'a cópia é o arquivo de antes');
  } finally { limpar(t); }
});

// ── Codex ───────────────────────────────────────────────────────────────────
function codexBase(t) {
  escrever(path.join(t.d.codex, 'hooks.json'), ORCA_HOOKS);
  escrever(path.join(t.d.codex, 'config.toml'), CONFIG_TOML.replace(/\/home\/ana/g, t.d.codex.replace(/\\/g, '/').replace(/\/\.codex$/, '')));
  escrever(path.join(t.d.codex, 'AGENTS.md'), '# Minhas regras\n');
}

test('Codex no host: oito eventos do Orca iguais, RTK no índice 1 com caminho absoluto, único acréscimo no config.toml é o bloco', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const tomlAntes = ler(path.join(t.d.codex, 'config.toml'));
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    const hooks = JSON.parse(ler(path.join(t.d.codex, 'hooks.json')));
    const orca = JSON.parse(ORCA_HOOKS);
    assert.strictEqual(Object.keys(hooks.hooks).length, 8);
    for (const ev of Object.keys(orca.hooks)) {
      if (ev === 'PreToolUse') assert.deepStrictEqual(hooks.hooks[ev][0], orca.hooks[ev][0]);
      else assert.deepStrictEqual(hooks.hooks[ev], orca.hooks[ev], ev);
    }
    assert.strictEqual(hooks.hooks.PreToolUse.length, 2);
    assert.strictEqual(hooks.hooks.PreToolUse[1].hooks[0].command, P.hookCommand(t.rtkHost, 'codex', t.platform, { gitBash: true }).command);
    const tomlDepois = ler(path.join(t.d.codex, 'config.toml'));
    assert.ok(tomlDepois.startsWith(tomlAntes), 'chaves [hooks.state] (inclui pre_tool_use:0:0 do Orca), trust_level e [tui] intactos');
    const absCmd = P.hookCommand(t.rtkHost, 'codex', t.platform, { gitBash: true }).command;
    const hashEsperado = C.codexHookHash({ matcher: 'Bash' }, { type: 'command', command: absCmd });
    const chave = `${path.join(t.d.codex, 'hooks.json')}:pre_tool_use:1:0`;
    assert.strictEqual(tomlDepois.slice(tomlAntes.length), `
[shell_environment_policy]
set = { RTK_DB_PATH = '${t.d.codexDb}' }

[hooks.state.'${chave}']
trusted_hash = "${hashEsperado}"
`);
    assert.ok(!tomlDepois.slice(tomlAntes.length).includes('enabled'), 'só trusted_hash');
    assert.ok(fs.existsSync(t.d.codexDb), 'banco do Codex criado');
    assert.strictEqual(r.trust, 'trusted');
    assert.strictEqual(r.trustMessage, null);
    assert.strictEqual(C.codexHookTrust(ler(path.join(t.d.codex, 'hooks.json')), tomlDepois, path.join(t.d.codex, 'hooks.json')).state, 'trusted');
    const toml = r.changes.find(c => c.file.endsWith('config.toml'));
    assert.match(toml.added, /\[shell_environment_policy\]/);
    assert.ok(ler(toml.backup) === tomlAntes);
    assert.ok(r.notes.some(n => n.includes('Banco do Codex criado')));
    assert.strictEqual(r.status, undefined, 'o resultado não carrega o status completo');
    assert.ok(t.chamadas.filter(c => c.db).every(c => c.db === t.d.codexDb), 'nenhum rtk com o banco do Claude');
  } finally { limpar(t); }
});

test('idempotência: duas ativações deixam os arquivos iguais e um só hook do RTK; a segunda não muda nada', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const a = ativador(t);
    const e = await alvo(t);
    const r1 = await a.enable(e, 'codex');
    const baks = () => fs.readdirSync(t.d.codex).filter(n => n.endsWith('.bak')).sort();
    const baksR1 = baks();
    const snap = ['hooks.json', 'config.toml', 'AGENTS.md', 'RTK.md'].map(n => ler(path.join(t.d.codex, n)));
    const r2 = await a.enable(e, 'codex');
    assert.strictEqual(r2.ok, true, r2.error);
    assert.deepStrictEqual(['hooks.json', 'config.toml', 'AGENTS.md', 'RTK.md'].map(n => ler(path.join(t.d.codex, n))), snap);
    assert.strictEqual(JSON.parse(snap[0]).hooks.PreToolUse.length, 2);
    assert.deepStrictEqual(r2.changes, []);
    assert.strictEqual(r1.trust, 'trusted');
    assert.strictEqual(r2.trust, 'trusted', 'reativar com o hook aprovado não regrava nada (C11)');
    assert.deepStrictEqual(baks(), baksR1, 'ativação sem alteração não deixa cópia nova');
  } finally { limpar(t); }
});

test('cópia de segurança nunca sobrescrita: a segunda ativação que altera algo guarda outra cópia e preserva a primeira (correção 4)', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const a = ativador(t); // `now` fixo: o mesmo carimbo nas duas ativações
    const e = await alvo(t);
    const r1 = await a.enable(e, 'codex');
    const bak1 = r1.changes.find(c => c.file.endsWith('hooks.json')).backup;
    const orig1 = ler(bak1);
    // outra mudança no hooks.json (comando volta ao literal) para forçar nova alteração
    const hj = path.join(t.d.codex, 'hooks.json');
    const o = JSON.parse(ler(hj)); o.hooks.PreToolUse[1].hooks[0].command = 'rtk hook codex'; escrever(hj, JSON.stringify(o, null, 2) + '\n');
    const r2 = await a.enable(e, 'codex');
    const bak2 = r2.changes.find(c => c.file.endsWith('hooks.json')).backup;
    assert.notStrictEqual(bak2, bak1);
    assert.strictEqual(ler(bak1), orig1, 'a primeira cópia continua intacta');
    assert.ok(ler(bak2).includes('"rtk hook codex"'));
  } finally { limpar(t); }
});

test('rollback: falha no config.toml devolve hooks.json, AGENTS.md e RTK.md ao conteúdo de antes, por hash (correção 4)', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const arquivos = ['hooks.json', 'config.toml', 'AGENTS.md'].map(n => path.join(t.d.codex, n));
    const antes = arquivos.map(f => sha(ler(f)));
    const falha = { ...t.env, writeFile: async (e, p, txt) => (p.endsWith('config.toml.rendra-tmp') ? { ok: false, error: 'disco cheio' } : t.env.writeFile(e, p, txt)) };
    const r = await ativador(t, { env: falha }).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /disco cheio/);
    assert.deepStrictEqual(arquivos.map(f => sha(ler(f))), antes);
    assert.ok(!fs.existsSync(path.join(t.d.codex, 'RTK.md')), 'arquivo criado pelo init é removido');
    assert.deepStrictEqual(fs.readdirSync(t.d.codex).filter(n => n.endsWith('.rendra-tmp') || n.endsWith('.bak')).sort(), [], 'sem lixo');
  } finally { limpar(t); }
});

test('rollback não restaura arquivo que outra sessão mexeu depois e avisa', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const hj = path.join(t.d.codex, 'hooks.json');
    const outra = '{"hooks":{"outra":"sessao"}}\n';
    const falha = { ...t.env, writeFile: async (e, p, txt) => {
      if (p.endsWith('config.toml.rendra-tmp')) { escrever(hj, outra); return { ok: false, error: 'falhou' }; }
      return t.env.writeFile(e, p, txt);
    } };
    const r = await ativador(t, { env: falha }).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Não restaurei .*hooks\.json/);
    assert.strictEqual(ler(hj), outra, 'o que a outra sessão gravou foi preservado');
  } finally { limpar(t); }
});

test('arquivo alterado entre leitura e escrita: retry e, persistindo, erro sem sobrescrever', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const toml = path.join(t.d.codex, 'config.toml');
    // muda uma vez logo depois da leitura: o retry lê a versão nova e grava por cima dela
    let vezes = 0;
    const umaVez = { ...t.env, readFile: async (e, p) => {
      const r = await t.env.readFile(e, p);
      if (p === toml && vezes++ === 0) fs.appendFileSync(toml, '\n[tui]\nnova = 1\n');
      return r;
    } };
    const r = await ativador(t, { env: umaVez }).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    const final = ler(toml);
    assert.ok(final.includes('nova = 1') && final.includes('[shell_environment_policy]'), 'a mudança da outra sessão sobreviveu e o bloco entrou');
  } finally { limpar(t); }
  const t2 = ambiente();
  try {
    codexBase(t2);
    const toml = path.join(t2.d.codex, 'config.toml');
    let n = 0;
    const sempre = { ...t2.env, readFile: async (e, p) => {
      const r = await t2.env.readFile(e, p);
      if (p === toml) fs.appendFileSync(toml, `# outra sessão ${++n}\n`);
      return r;
    } };
    const r = await ativador(t2, { env: sempre }).enable(await alvo(t2), 'codex');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /mudou enquanto/);
    assert.ok(!ler(toml).includes('[shell_environment_policy]'), 'não sobrescreveu');
    assert.ok(ler(toml).includes('# outra sessão'), 'o que a outra sessão gravou continua lá');
  } finally { limpar(t2); }
});

test('RTK velho: needsUpdate e nenhum init executado; RTK ausente: needsInstall', async () => {
  const t = ambiente({ version: 'rtk 0.48.0' });
  try {
    codexBase(t);
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.needsUpdate, true);
    assert.ok(!t.chamadas.some(c => c.argv && c.argv.includes('init')));
  } finally { limpar(t); }
  const t2 = ambiente();
  try {
    const sem = { ...t2.env, findRtk: async () => null };
    assert.strictEqual((await ativador(t2, { env: sem }).enable(await alvo(t2), 'claude')).needsInstall, true);
  } finally { limpar(t2); }
});

test('rtk init que falha: erro, nada gravado e cópias removidas', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const f = { ...t.env, run: async (e, argv, o) => (argv.includes('init') ? { ok: false, stdout: '', stderr: 'init quebrou' } : t.env.run(e, argv, o)) };
    const antes = ler(path.join(t.d.codex, 'hooks.json'));
    const r = await ativador(t, { env: f }).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /init quebrou/);
    assert.strictEqual(ler(path.join(t.d.codex, 'hooks.json')), antes);
    assert.deepStrictEqual(fs.readdirSync(t.d.codex).filter(n => n.endsWith('.bak')), []);
  } finally { limpar(t); }
});

// ── Distro ──────────────────────────────────────────────────────────────────
test('distro parada: recusa sem chamar wsl.exe', async () => {
  const t = ambiente({ distro: true, running: false });
  try {
    const r = await ativador(t).enable({ id: 'Ubuntu', kind: 'wsl', name: 'Ubuntu', running: false, label: 'Ubuntu' }, 'codex');
    assert.strictEqual(r.state, 'wsl-off');
    assert.strictEqual(t.chamadas.length, 0);
  } finally { limpar(t); }
});

test('distro Running: caminho absoluto da distro no hook, arquivos pelo UNC mapeado, banco do Codex da distro', async () => {
  const t = ambiente({ distro: true });
  try {
    codexBase(t);
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    const hooks = JSON.parse(ler(path.join(t.d.codex, 'hooks.json')));
    assert.strictEqual(hooks.hooks.PreToolUse[1].hooks[0].command, `${wslHome}/.local/bin/rtk hook codex`);
    assert.match(ler(path.join(t.d.codex, 'config.toml')), /RTK_DB_PATH = '\/home\/ana\/\.local\/share\/rtk\/codex\/history\.db'/);
    const wsl = t.chamadas.filter(c => c.wsl).map(c => c.wsl);
    assert.ok(wsl.every(l => l.startsWith('-d Ubuntu -e ')), wsl.join('\n'));
    assert.ok(wsl.every(l => !/(^| )-u /.test(l)));
    assert.ok(wsl.some(l => l.includes('init -g --codex')));
    assert.ok(fs.existsSync(t.d.codexDb), 'banco criado dentro da distro (mapeada)');
  } finally { limpar(t); }
});

test('os arquivos que a ativação toca estão listados por agente (correção 6)', async () => {
  const t = ambiente();
  try {
    const a = ativador(t);
    const dirs = await t.env.agentDirs(t.env.HOST);
    const nomes = (ag) => a.plannedFiles(ag, dirs, t.procEnv).map(f => path.basename(f)).sort();
    assert.deepStrictEqual(nomes('claude'), ['CLAUDE.md', 'RTK.md', 'filters.toml', 'settings.json']);
    assert.deepStrictEqual(nomes('codex'), ['AGENTS.md', 'RTK.md', 'config.toml', 'hooks.json']);
    const st = createRtkStatus({ env: t.env, processEnv: t.procEnv, runRtk: async () => ({ ok: true, output: '' }) });
    const e = await st.inspect(t.env.HOST);
    assert.deepStrictEqual(e.agents.codex.files.map(f => path.basename(f)).sort(), nomes('codex'));
  } finally { limpar(t); }
});

// ── T3: aprovação do hook na ativação (Windows, WSL), com backup e rollback ──
const hashDe = cmd => C.codexHookHash({ matcher: 'Bash' }, { type: 'command', command: cmd });
const chaveDe = (t, g = 1, i = 0) => `${path.join(t.d.codex, 'hooks.json')}:pre_tool_use:${g}:${i}`;

test('aprovação: hash antigo na mesma chave é trocado (uma só tabela) e o resto do config.toml fica', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const toml = path.join(t.d.codex, 'config.toml');
    escrever(toml, ler(toml) + `\n[hooks.state.'${chaveDe(t)}']\nenabled = true\ntrusted_hash = "sha256:velho"\n`);
    const antes = ler(toml);
    assert.strictEqual(C.codexHookTrust(ler(path.join(t.d.codex, 'hooks.json')), antes, path.join(t.d.codex, 'hooks.json')).state, 'no-hook');
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    const depois = ler(toml);
    assert.strictEqual(r.trust, 'trusted');
    assert.strictEqual(depois.split(`[hooks.state.'${chaveDe(t)}']`).length - 1, 1, 'nenhuma tabela duplicada');
    assert.ok(depois.includes(`enabled = true\ntrusted_hash = "${hashDe(P.hookCommand(t.rtkHost, 'codex', t.platform, { gitBash: true }).command)}"`));
    assert.ok(depois.includes('[tui]') && depois.includes('trust_level = "trusted"'));
  } finally { limpar(t); }
});

test('aprovação: só entradas do RTK; outro handler do mesmo grupo (1:0) não recebe hooks.state e o RTK (1:1) sim', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const hj = path.join(t.d.codex, 'hooks.json');
    const o = JSON.parse(ler(hj));
    o.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo de-outro-programa' }, { type: 'command', command: 'rtk hook codex' }] });
    escrever(hj, JSON.stringify(o, null, 2) + '\n');
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    const toml = ler(path.join(t.d.codex, 'config.toml'));
    assert.ok(toml.includes(`'${chaveDe(t, 1, 1)}'`), 'o RTK está em 1:1');
    assert.ok(!toml.includes(`'${chaveDe(t, 1, 0)}'`), 'o handler alheio (1:0) não é aprovado');
    assert.strictEqual(r.trust, 'trusted');
  } finally { limpar(t); }
});

test('aprovação: config.toml em forma que a IDE não edita não quebra a ativação; o hook fica pendente com o texto do /hooks', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const toml = path.join(t.d.codex, 'config.toml');
    const estranho = 'hooks.state."x".trusted_hash = "sha256:y"\nmodel = "m"\n';
    escrever(toml, estranho);
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(ler(toml), `${estranho}\n[shell_environment_policy]\nset = { RTK_DB_PATH = '${t.d.codexDb}' }\n`);
    assert.strictEqual(r.trust, 'untrusted');
    assert.match(r.trustMessage, /\/hooks.*PreToolUse.*\bt\b/);
  } finally { limpar(t); }
});

test('rollback depois da escrita do config.toml: a falha tardia devolve hooks.json e config.toml (com a aprovação) ao que eram, por hash', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const toml = path.join(t.d.codex, 'config.toml');
    escrever(toml, ler(toml) + 'sandbox_mode = "workspace-write"\n');
    const arquivos = ['hooks.json', 'config.toml', 'AGENTS.md'].map(n => path.join(t.d.codex, n));
    const antes = arquivos.map(f => sha(ler(f)));
    const falha = { ...t.env, run: async (e, argv, o) => (argv.includes('gain') ? { ok: false, stdout: '', stderr: 'banco quebrou' } : t.env.run(e, argv, o)) };
    const r = await ativador(t, { env: falha }).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /rtk gain/);
    assert.deepStrictEqual(arquivos.map(f => sha(ler(f))), antes);
    assert.ok(!ler(toml).includes('trusted_hash = "sha256:' + hashDe('rtk hook codex').slice(7)));
    assert.deepStrictEqual(fs.readdirSync(t.d.codex).filter(n => n.endsWith('.rendra-tmp') || n.endsWith('.bak')), [], 'sem lixo');
  } finally { limpar(t); }
});

test('falha injetada na gravação do config.toml: hooks.json, config.toml e AGENTS.md voltam byte a byte e nada fica aprovado', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const arquivos = ['hooks.json', 'config.toml', 'AGENTS.md'].map(n => path.join(t.d.codex, n));
    const bytes = arquivos.map(f => fs.readFileSync(f));
    const falha = { ...t.env, writeFile: async (e, p, txt) => (p.endsWith('config.toml.rendra-tmp') ? { ok: false, error: 'disco cheio' } : t.env.writeFile(e, p, txt)) };
    const r = await ativador(t, { env: falha }).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, false);
    arquivos.forEach((f, i) => assert.ok(fs.readFileSync(f).equals(bytes[i]), f));
  } finally { limpar(t); }
});

test('CODEX_HOME apontando para uma junção: a chave gravada usa o destino (caminho canônico), como o Codex', async () => {
  const t = ambiente();
  try {
    const real = path.join(t.tmp, 'codex-real');
    const link = path.join(t.tmp, 'codex-link');
    fs.mkdirSync(real, { recursive: true });
    fs.symlinkSync(real, link, 'junction');
    t.procEnv.CODEX_HOME = link;
    escrever(path.join(real, 'hooks.json'), ORCA_HOOKS);
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    const canonico = fs.realpathSync.native(real);
    const toml = ler(path.join(real, 'config.toml'));
    assert.ok(toml.includes(`[hooks.state.'${path.join(canonico, 'hooks.json')}:pre_tool_use:1:0']`), toml);
    assert.ok(!toml.includes(link), 'o apelido da junção não entra na chave');
    assert.strictEqual(r.trust, 'trusted');
  } finally { limpar(t); }
});

test('distro WSL: a aprovação usa a chave e o hash do comando da distro (/home/ana/.local/bin/rtk hook codex)', async () => {
  const t = ambiente({ distro: true });
  try {
    codexBase(t);
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    const toml = ler(path.join(t.d.codex, 'config.toml'));
    assert.ok(toml.includes(`[hooks.state.'${wslHome}/.codex/hooks.json:pre_tool_use:1:0']\ntrusted_hash = "${hashDe(`${wslHome}/.local/bin/rtk hook codex`)}"\n`), toml);
    assert.strictEqual(r.trust, 'trusted');
    const r2 = await ativador(t).enable(await alvo(t), 'codex');
    assert.deepStrictEqual(r2.changes, [], 'reativar não regrava');
  } finally { limpar(t); }
});

// ── T6: writable_roots junto, na mesma escrita ──
const ROOTS = '/home/ana/.local/share/rtk/codex';
async function wslCom(tomlInicial) {
  const t = ambiente({ distro: true });
  codexBase(t);
  escrever(path.join(t.d.codex, 'config.toml'), tomlInicial);
  const r = await ativador(t).enable(await alvo(t), 'codex');
  return { t, r, toml: ler(path.join(t.d.codex, 'config.toml')) };
}

test('writable_roots (WSL): com workspace-write acrescenta a tabela; o sandbox_mode original fica byte a byte', async () => {
  const ini = 'sandbox_mode = "workspace-write"\nmodel = "m"\n';
  const { t, r, toml } = await wslCom(ini);
  try {
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(toml.startsWith(ini));
    assert.ok(toml.endsWith(`[sandbox_workspace_write]\nwritable_roots = ['${ROOTS}']\n`), toml);
    assert.strictEqual(toml.split('sandbox_mode').length - 1, 1);
    assert.ok(r.notes.some(n => /liberada/.test(n)));
    const r2 = await ativador(t).enable(await alvo(t), 'codex');
    assert.deepStrictEqual(r2.changes, [], 'segunda ativação: nada muda');
  } finally { limpar(t); }
});
test('writable_roots (WSL): read-only, sem sandbox_mode ou perfil não gravam nada', async () => {
  for (const ini of ['sandbox_mode = "read-only"\n', 'model = "m"\n', 'sandbox_mode = "workspace-write"\nprofile = "p"\n']) {
    const { t, r, toml } = await wslCom(ini);
    try {
      assert.strictEqual(r.ok, true, r.error);
      assert.ok(!toml.includes('sandbox_workspace_write'), ini);
      assert.ok(!r.notes.some(n => /liberada/.test(n)));
    } finally { limpar(t); }
  }
});
test('writable_roots (WSL): tabela existente com outros caminhos preserva os demais; com o caminho já presente não duplica', async () => {
  const ini = (arr) => `sandbox_mode = "workspace-write"\n\n[sandbox_workspace_write]\nwritable_roots = ${arr}\n`;
  const a = await wslCom(ini("['/outra']"));
  try { assert.ok(a.toml.includes(`writable_roots = ['/outra', '${ROOTS}']`), a.toml); } finally { limpar(a.t); }
  const b = await wslCom(ini(`['${ROOTS}']`));
  try { assert.strictEqual(b.toml.split(`'${ROOTS}'`).length - 1, 1, 'sem duplicar'); } finally { limpar(b.t); }
});
test('writable_roots (WSL): falha na gravação desfaz tudo, inclusive a tabela nova', async () => {
  const t = ambiente({ distro: true });
  try {
    codexBase(t);
    const toml = path.join(t.d.codex, 'config.toml');
    escrever(toml, 'sandbox_mode = "workspace-write"\n');
    const antes = fs.readFileSync(toml);
    const falha = { ...t.env, run: async (e, argv, o) => (argv.includes('gain') ? { ok: false, stdout: '', stderr: 'x' } : t.env.run(e, argv, o)) };
    const r = await ativador(t, { env: falha }).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, false);
    assert.ok(fs.readFileSync(toml).equals(antes));
  } finally { limpar(t); }
});
test('writable_roots (host): no Windows nunca grava, mesmo com workspace-write; em Linux e macOS grava', async () => {
  const t = ambiente();
  try {
    codexBase(t);
    const toml = path.join(t.d.codex, 'config.toml');
    escrever(toml, 'sandbox_mode = "workspace-write"\n');
    const r = await ativador(t).enable(await alvo(t), 'codex');
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(ler(toml).includes('sandbox_workspace_write'), process.platform !== 'win32');
  } finally { limpar(t); }
});

test('textos devolvidos pela ativação (notas e aviso) sem jargão nem travessão; a pendência cita /hooks, PreToolUse e t', async () => {
  const TECNICO = /hash|sandbox|writable_roots|trusted_hash|hooks\.state/i;
  const sweep = r => [...r.notes, r.trustMessage || ''].forEach(x => { assert.ok(!TECNICO.test(x), x); assert.ok(!/[—–]/.test(x), x); });
  const t = ambiente({ distro: true });
  try {
    codexBase(t);
    escrever(path.join(t.d.codex, 'config.toml'), 'sandbox_mode = "workspace-write"\n');
    const ok = await ativador(t).enable(await alvo(t), 'codex');
    sweep(ok);
    assert.ok(ok.notes.some(n => /aprovado/.test(n)));
    assert.strictEqual(ok.trustMessage, null);
  } finally { limpar(t); }
  const t2 = ambiente();
  try {
    codexBase(t2);
    escrever(path.join(t2.d.codex, 'config.toml'), 'hooks = { state = {} }\n');
    const pend = await ativador(t2).enable(await alvo(t2), 'codex');
    sweep(pend);
    assert.match(pend.trustMessage, /\/hooks/);
    assert.match(pend.trustMessage, /PreToolUse/);
    assert.match(pend.trustMessage, /aperte t\b/);
  } finally { limpar(t2); }
});

// ── T10: guarda de isolamento (nada do dono, nada do ~/.codex real) ─────────
test('guarda: todo caminho do teste fica sob a pasta temporária e nunca sob o ~/.codex real', async () => {
  const sob = (p, base) => { const r = path.relative(path.resolve(base).toLowerCase(), path.resolve(p).toLowerCase()); return !r.startsWith('..') && !path.isAbsolute(r); };
  const real = path.join(os.homedir(), '.codex');
  for (const distro of [false, true]) {
    const t = ambiente({ distro });
    try {
      codexBase(t);
      const r = await ativador(t).enable(await alvo(t), 'codex');
      assert.strictEqual(r.ok, true, r.error);
      const fsDe = p => (distro ? path.join(t.tmp, 'wsl', 'Ubuntu', ...p.split('/').filter(Boolean)) : p); // caminho dentro da distro vira pasta temporária
      const tocados = [t.d.codex, t.d.codexDb, t.d.claude, ...r.changes.map(c => fsDe(c.file)), ...r.changes.map(c => c.backup).filter(Boolean).map(fsDe)];
      for (const p of tocados) {
        assert.ok(sob(p, t.tmp), `${p} fora da pasta temporária`);
        assert.ok(!sob(p, real), `${p} aponta para o ~/.codex real`);
      }
      assert.ok(t.chamadas.filter(c => c.vars && c.vars.CODEX_HOME).every(c => sob(toFsPath(t, c), t.tmp)), 'CODEX_HOME passado ao rtk falso está no sandbox');
    } finally { limpar(t); }
  }
});
const toFsPath = (t, c) => (c.naDistro ? path.join(t.tmp, 'wsl', 'Ubuntu', ...c.vars.CODEX_HOME.split('/').filter(Boolean)) : c.vars.CODEX_HOME);

test('guarda: nenhum arquivo do repositório cita o ~/.codex do dono (o repositório é público)', () => {
  const proibidos = [new RegExp(['Users', 'Tia' + 'go'].join('[\\\\/]+')), new RegExp(['home', 'bru' + 'no', '\\.codex'].join('/'))];
  const raiz = path.join(__dirname, '..');
  const achados = [];
  // só os arquivos versionados: artefatos locais ignorados pelo git (dist/, builder-debug.yml) não contam
  const lista = require('child_process').execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64e6 }).split('\0').filter(Boolean);
  for (const rel of lista) {
    const p = path.join(raiz, rel);
    if (!/\.(js|json|md|html|css|toml|yml|yaml|txt)$/.test(rel) || !fs.existsSync(p) || fs.statSync(p).size >= 2e6) continue;
    if (proibidos.some(re => re.test(fs.readFileSync(p, 'utf8')))) achados.push(rel);
  }
  assert.deepStrictEqual(achados, []);
});
