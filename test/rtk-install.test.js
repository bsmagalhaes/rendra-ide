// Instalação e atualização do RTK por ambiente: downloads, fs e wsl.exe falsos.
// Nada baixa, grava no home real nem executa o rtk real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { swapBinary, createRtkInstall } = require('../src/rtk-install');
const setup = require('../src/setup');

// ── swapBinary com fs em memória ────────────────────────────────────────────
function memfs({ busy = new Set(), noRemove = new Set(), failCopyOnce = false } = {}) {
  const files = new Map();
  let falhou = false;
  const err = (code, m) => Object.assign(new Error(`${code}: ${m}`), { code });
  return {
    files,
    existsSync: p => files.has(p),
    readdirSync: dir => [...files.keys()].filter(k => k.startsWith(dir + (dir.includes('\\') ? '\\' : '/'))).map(k => k.slice(dir.length + 1)),
    renameSync: (a, b) => { if (!files.has(a)) throw err('ENOENT', a); if (files.has(b) && busy.has(b)) throw err('EEXIST', b); files.set(b, files.get(a)); files.delete(a); },
    copyFileSync: (a, b) => {
      if (busy.has(b) && files.has(b)) throw err('EBUSY', b);
      if (failCopyOnce && !falhou) { falhou = true; files.set(b, 'meia-copia'); throw err('EIO', 'falha na cópia'); }
      files.set(b, files.get(a));
    },
    rmSync: p => { if (noRemove.has(p)) throw err('EPERM', p); files.delete(p); },
    chmodSync() {},
  };
}
const TARGET = 'C:\\Users\\ana\\.local\\bin\\rtk.exe';
const SRC = 'C:\\tmp\\rtk-novo.exe';

test('Windows: rtk.exe em uso (EBUSY na cópia direta): a troca por .old conclui e o novo fica no nome original', () => {
  const m = memfs();
  m.files.set(TARGET, 'antigo'); m.files.set(SRC, 'novo');
  // simula o Windows: copiar por cima do exe existente falha com EBUSY
  const orig = m.copyFileSync;
  m.copyFileSync = (a, b) => { if (b === TARGET && m.files.has(TARGET)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return orig(a, b); };
  assert.throws(() => m.copyFileSync(SRC, TARGET), /EBUSY/, 'a cópia direta falha (o que a versão antiga fazia)');
  swapBinary(TARGET, SRC, { fs: m, platform: 'win32', now: () => 1 });
  assert.strictEqual(m.files.get(TARGET), 'novo');
  assert.ok(![...m.files.keys()].some(k => k.includes('.old')), 'o .old foi apagado');
});

test('Windows: se a cópia falhar, o binário antigo volta ao nome original', () => {
  const m = memfs({ failCopyOnce: true });
  m.files.set(TARGET, 'antigo'); m.files.set(SRC, 'novo');
  assert.throws(() => swapBinary(TARGET, SRC, { fs: m, platform: 'win32', now: () => 2 }), /falha na cópia/);
  assert.strictEqual(m.files.get(TARGET), 'antigo');
  assert.ok(![...m.files.keys()].some(k => k.includes('.old')));
});

test('Windows: .old em uso (EPERM) não derruba a instalação e um .old antigo preso não impede a troca (correção 7)', () => {
  const preso = `${TARGET}.old-0`;
  const m = memfs({ noRemove: new Set([preso]) });
  m.files.set(TARGET, 'antigo'); m.files.set(SRC, 'novo'); m.files.set(preso, 'preso');
  swapBinary(TARGET, SRC, { fs: m, platform: 'win32', now: () => 5 });
  assert.strictEqual(m.files.get(TARGET), 'novo');
  assert.strictEqual(m.files.get(preso), 'preso', 'o preso continua lá, ignorado');
  // o .old novo (também apagável) foi limpo; só o preso sobrou
  assert.deepStrictEqual([...m.files.keys()].filter(k => k.includes('.old')), [preso]);
});

test('Windows: destino que não existe é só copiado', () => {
  const m = memfs();
  m.files.set(SRC, 'novo');
  swapBinary(TARGET, SRC, { fs: m, platform: 'win32' });
  assert.strictEqual(m.files.get(TARGET), 'novo');
});

test('Linux: copia ao lado e renomeia por cima; falha não deixa arquivo temporário', () => {
  const m = memfs();
  m.files.set('/h/.local/bin/rtk', 'antigo'); m.files.set('/tmp/rtk', 'novo');
  swapBinary('/h/.local/bin/rtk', '/tmp/rtk', { fs: m, platform: 'linux', now: () => 9 });
  assert.strictEqual(m.files.get('/h/.local/bin/rtk'), 'novo');
  assert.deepStrictEqual([...m.files.keys()].sort(), ['/h/.local/bin/rtk', '/tmp/rtk']);
  const f = memfs({ failCopyOnce: true });
  f.files.set('/h/.local/bin/rtk', 'antigo'); f.files.set('/tmp/rtk', 'novo');
  assert.throws(() => swapBinary('/h/.local/bin/rtk', '/tmp/rtk', { fs: f, platform: 'linux', now: () => 9 }));
  assert.strictEqual(f.files.get('/h/.local/bin/rtk'), 'antigo');
  assert.ok(![...f.files.keys()].some(k => k.includes('.new-')));
});

// ── fetchRtkRelease: checksum ───────────────────────────────────────────────
test('checksum errado aborta sem extrair nem deixar pasta temporária', async () => {
  // só as pastas do próprio fetchRtkRelease (rtk-XXXXXX); outros testes criam rtk-<nome>-XXXXXX em paralelo
  const dele = n => /^rtk-[A-Za-z0-9]{6}$/.test(n);
  const antes = new Set(fs.readdirSync(os.tmpdir()).filter(dele));
  const corpo = Buffer.from('conteudo do pacote');
  const ruim = 'f'.repeat(64);
  let extraiu = false;
  const resp = {
    'https://x/asset.tar.gz': { arrayBuffer: async () => corpo, ok: true },
    'https://x/checksums.txt': { text: async () => `${ruim}  rtk-x86_64-unknown-linux-musl.tar.gz\n`, ok: true },
  };
  await assert.rejects(setup.fetchRtkRelease(() => {}, 'rtk-x86_64-unknown-linux-musl.tar.gz', 'rtk', {
    latestRelease: async () => ({ tag_name: 'v0.50.0', assets: [{ name: 'rtk-x86_64-unknown-linux-musl.tar.gz', browser_download_url: 'https://x/asset.tar.gz' }, { name: 'checksums.txt', browser_download_url: 'https://x/checksums.txt' }] }),
    fetch: async url => resp[url],
    extract: async () => { extraiu = true; },
  }), /Checksum/);
  assert.strictEqual(extraiu, false);
  const depois = fs.readdirSync(os.tmpdir()).filter(n => dele(n) && !antes.has(n));
  assert.deepStrictEqual(depois, []);
});

test('checksum certo extrai e devolve o binário', async () => {
  const corpo = Buffer.from('pacote bom');
  const ok = crypto.createHash('sha256').update(corpo).digest('hex');
  const r = await setup.fetchRtkRelease(() => {}, 'a.tar.gz', 'rtk', {
    latestRelease: async () => ({ tag_name: 'v0.50.0', assets: [{ name: 'a.tar.gz', browser_download_url: 'u1' }, { name: 'checksums.txt', browser_download_url: 'u2' }] }),
    fetch: async url => (url === 'u1' ? { ok: true, arrayBuffer: async () => corpo } : { ok: true, text: async () => `${ok}  a.tar.gz\n` }),
    extract: async (_a, dir) => fs.writeFileSync(path.join(dir, 'rtk'), 'bin'),
  });
  try { assert.strictEqual(fs.readFileSync(r.found, 'utf8'), 'bin'); assert.strictEqual(r.tag, 'v0.50.0'); }
  finally { fs.rmSync(r.tmp, { recursive: true, force: true }); }
});

// ── install por ambiente, com ambiente falso ────────────────────────────────
function ambiente({ version = null, uname = 'x86_64\n', bashHasRtk = false, profile = null, fail = {}, hostPlatform = 'linux', whereOut = '', wingetVersion = 'rtk 0.48.0' } = {}) {
  const calls = [];
  const writes = [];
  const files = new Map(profile === null ? [] : [['/home/bruno/.profile', profile]]);
  const dl = { assets: [] };
  let movido = false; // depois do mv o binário novo responde 0.50.0
  const fake = {
    HOST: { id: 'host', kind: 'host', platform: hostPlatform, running: true },
    calls, writes, files, dl,
    findRtk: async () => (version ? '/home/bruno/.local/bin/rtk' : null),
    homeOf: async () => '/home/bruno',
    run: async (e, argv) => {
      calls.push(argv.join(' '));
      const k = argv.join(' ');
      if (fail[argv[0]]) return { ok: false, stdout: '', stderr: '' };
      if (argv.includes('--version')) return { ok: true, stdout: (argv[0].includes('WinGet') ? wingetVersion : (movido ? 'rtk 0.50.0' : (version || 'rtk 0.50.0'))) + '\n' };
      if (argv[0] === 'mv') movido = true;
      if (argv[0] === 'uname') return { ok: true, stdout: uname };
      if (argv[0] === 'bash') return { ok: true, stdout: bashHasRtk ? '/home/bruno/.local/bin/rtk\n' : '' };
      if (argv[0] === 'where.exe') return { ok: true, stdout: whereOut };
      return { ok: true, stdout: '' };
    },
    mkdirp: async () => ({ ok: true }),
    writeFile: async (e, p, data) => { writes.push(p); if (fail.write) return { ok: false, error: 'não confere' }; files.set(p, data); return { ok: true }; },
    readFile: async (e, p) => (files.has(p) ? { ok: true, text: files.get(p) } : { ok: false, text: null }),
    remove: async (e, p) => { files.delete(p); calls.push(`rm ${p}`); return { ok: true }; },
  };
  return fake;
}
const DISTRO = (running = true) => ({ id: 'Ubuntu-24.04', kind: 'wsl', name: 'Ubuntu-24.04', running });
function instalador(env, extra = {}) {
  const pedidos = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-teste-'));
  fs.writeFileSync(path.join(tmp, 'rtk'), Buffer.from('binario-falso'));
  const inst = createRtkInstall({
    env, now: () => 77, setup,
    fetchRtk: async (log, asset, bin) => { pedidos.push([asset, bin]); return { found: path.join(tmp, 'rtk'), tmp }; },
    ...extra,
  });
  return { inst, pedidos, tmp };
}

test('distro parada: wsl-off e zero chamadas e zero downloads', async () => {
  const env = ambiente();
  const { inst, pedidos } = instalador(env);
  const r = await inst.install(DISTRO(false));
  assert.strictEqual(r.state, 'wsl-off');
  assert.deepStrictEqual([env.calls.length, pedidos.length], [0, 0]);
});

test('versão já suficiente: zero downloads', async () => {
  const env = ambiente({ version: 'rtk 0.50.0' });
  const { inst, pedidos } = instalador(env);
  const r = await inst.install(DISTRO());
  assert.deepStrictEqual([r.ok, r.upToDate], [true, true]);
  assert.strictEqual(pedidos.length, 0);
});

test('arquitetura: x86_64 escolhe o musl; aarch64 escolhe o asset arm64', async () => {
  for (const [uname, esperado] of [['x86_64\n', 'rtk-x86_64-unknown-linux-musl.tar.gz'], ['aarch64\n', 'rtk-aarch64-unknown-linux-gnu.tar.gz']]) {
    const env = ambiente({ uname, version: 'rtk 0.48.0' });
    const { inst, pedidos } = instalador(env);
    await inst.install(DISTRO());
    assert.deepStrictEqual(pedidos[0], [esperado, 'rtk'], uname);
  }
});

test('arquitetura desconhecida: erro claro, nada baixado', async () => {
  const env = ambiente({ uname: 'riscv64\n' });
  const { inst, pedidos } = instalador(env);
  const r = await inst.install(DISTRO());
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Arquitetura/);
  assert.strictEqual(pedidos.length, 0);
});

test('distro: o destino é <home>/.local/bin/rtk, gravado em temporário e posto no lugar por mv (nunca binário pela metade)', async () => {
  const env = ambiente({ version: 'rtk 0.48.0', bashHasRtk: true });
  const { inst } = instalador(env);
  const r = await inst.install(DISTRO());
  assert.deepStrictEqual([r.ok, r.rtk], [true, '/home/bruno/.local/bin/rtk']);
  assert.deepStrictEqual(env.writes, ['/home/bruno/.local/bin/.rtk-new-77']);
  const iChmod = env.calls.findIndex(c => c.startsWith('chmod +x'));
  const iMv = env.calls.findIndex(c => c === 'mv -f /home/bruno/.local/bin/.rtk-new-77 /home/bruno/.local/bin/rtk');
  assert.ok(iChmod >= 0 && iMv > iChmod, 'chmod antes do mv');
  assert.ok(env.calls.every(c => !c.startsWith('sh -c')), 'nada de script montado');
});

test('distro: falha ao gravar não deixa temporário nem faz mv', async () => {
  const env = ambiente({ fail: { write: true } });
  const { inst } = instalador(env);
  const r = await inst.install(DISTRO());
  assert.strictEqual(r.ok, false);
  assert.ok(env.calls.some(c => c.startsWith('rm /home/bruno/.local/bin/.rtk-new-')));
  assert.ok(!env.calls.some(c => c.startsWith('mv ')));
});

test('PATH: só edita o ~/.profile quando command -v rtk falha, e a edição é idempotente', async () => {
  const sem = ambiente({ bashHasRtk: false, profile: 'umask 022\n' });
  let r = await instalador(sem).inst.install(DISTRO());
  assert.strictEqual(r.pathEdited, true);
  const prof = sem.files.get('/home/bruno/.profile');
  assert.match(prof, /^umask 022\n\n# added by Rendra IDE \(RTK\)\nexport PATH="\$HOME\/\.local\/bin:\$PATH"\n$/);
  // segunda instalação: agora o profile já cita .local/bin, não duplica
  const de_novo = ambiente({ bashHasRtk: false, profile: prof, version: 'rtk 0.48.0' });
  r = await instalador(de_novo).inst.install(DISTRO());
  assert.strictEqual(r.pathEdited, false);
  assert.strictEqual(de_novo.files.get('/home/bruno/.profile'), prof);
  // rtk já no PATH: o profile nem é lido
  const ok = ambiente({ bashHasRtk: true, profile: 'x\n' });
  r = await instalador(ok).inst.install(DISTRO());
  assert.strictEqual(r.pathEdited, false);
  assert.strictEqual(ok.files.get('/home/bruno/.profile'), 'x\n');
});

test('host: usa setup.installRtk e confere a versão; versão ainda velha vira erro com a causa provável', async () => {
  const env = ambiente({ version: 'rtk 0.48.0' });
  let instalou = 0;
  const { inst } = instalador(env, { setup: { installRtk: async () => { instalou++; } } });
  const r = await inst.install(env.HOST);
  assert.strictEqual(instalou, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /0\.48\.0.*PATH/s);
});

test('WinGet defasado: aviso só com mais de um caminho e versão velha, só orienta', async () => {
  const wg = 'C:\\Users\\ana\\AppData\\Local\\Microsoft\\WinGet\\Packages\\rtk-ai.rtk\\rtk.exe';
  const dois = ambiente({ hostPlatform: 'win32', whereOut: `C:\\Users\\ana\\.local\\bin\\rtk.exe\r\n${wg}\r\n`, wingetVersion: 'rtk 0.48.0' });
  const w = await instalador(dois).inst.hostWarnings();
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].command, 'winget upgrade --id rtk-ai.rtk');
  assert.ok(w[0].text.includes('winget upgrade --id rtk-ai.rtk'));
  const so1 = ambiente({ hostPlatform: 'win32', whereOut: `${wg}\r\n` });
  assert.deepStrictEqual(await instalador(so1).inst.hostWarnings(), []);
  const novo = ambiente({ hostPlatform: 'win32', whereOut: `C:\\a\\rtk.exe\r\n${wg}\r\n`, wingetVersion: 'rtk 0.50.0' });
  assert.deepStrictEqual(await instalador(novo).inst.hostWarnings(), []);
  const linux = ambiente({ hostPlatform: 'linux', whereOut: `/a/rtk\n${wg}\n` });
  assert.deepStrictEqual(await instalador(linux).inst.hostWarnings(), []);
  assert.ok(!dois.calls.some(c => /winget (upgrade|install)/.test(c) && !c.includes('where')), 'nunca executa o winget');
});
