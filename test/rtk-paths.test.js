// Caminhos do RTK, versão mínima e citação do hook (puro: nada toca o disco nem o rtk real)
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/rtk-paths');

const WIN = { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, home: 'C:\\Users\\ana' };
const LIN = { platform: 'linux', env: {}, home: '/home/ana' };

test('pasta de dados do RTK por plataforma (F20)', () => {
  assert.strictEqual(P.rtkDataDir(WIN), 'C:\\Users\\ana\\AppData\\Local\\rtk');
  assert.strictEqual(P.rtkDataDir({ ...WIN, env: {} }), 'C:\\Users\\ana\\AppData\\Local\\rtk');
  assert.strictEqual(P.rtkDataDir(LIN), '/home/ana/.local/share/rtk');
  assert.strictEqual(P.rtkDataDir({ ...LIN, env: { XDG_DATA_HOME: '/dados' } }), '/dados/rtk');
  assert.strictEqual(P.rtkDataDir({ platform: 'darwin', env: {}, home: '/Users/ana' }), '/Users/ana/Library/Application Support/rtk');
});

test('banco do Claude é o padrão do RTK; o do Codex fica em subpasta própria', () => {
  assert.strictEqual(P.claudeDbPath(WIN), 'C:\\Users\\ana\\AppData\\Local\\rtk\\history.db');
  assert.strictEqual(P.claudeDbPath(LIN), '/home/ana/.local/share/rtk/history.db');
  assert.strictEqual(P.codexDbDir(LIN), '/home/ana/.local/share/rtk/codex');
  assert.strictEqual(P.codexDbPath(LIN), '/home/ana/.local/share/rtk/codex/history.db');
  assert.strictEqual(P.codexDbPath(WIN), 'C:\\Users\\ana\\AppData\\Local\\rtk\\codex\\history.db');
  assert.notStrictEqual(P.codexDbPath(LIN), P.claudeDbPath(LIN));
});

test('versão: comparação numérica, não de texto', () => {
  assert.strictEqual(P.RTK_MIN, '0.50.0');
  assert.strictEqual(P.parseRtkVersion('rtk 0.50.0\n'), '0.50.0');
  assert.strictEqual(P.parseRtkVersion('lixo'), null);
  assert.ok(P.compareVersions('0.48.0', '0.50.0') < 0);
  assert.strictEqual(P.compareVersions('0.50.0', '0.50.0'), 0);
  assert.ok(P.compareVersions('0.50.1', '0.50.0') > 0);
  assert.ok(P.compareVersions('0.9.0', '0.50.0') < 0, '0.9.0 é menor que 0.50.0 (texto diria o contrário)');
  assert.ok(P.compareVersions('0.100.0', '0.50.0') > 0);
});

test('hook no Windows: sem aspas quando o caminho é simples (correção 3)', () => {
  const r = P.hookCommand('C:\\Users\\ana\\.local\\bin\\rtk.exe', 'claude', 'win32');
  assert.strictEqual(r.command, 'C:/Users/ana/.local/bin/rtk.exe hook claude');
  assert.strictEqual(P.hookCommand('C:/Users/ana/.local/bin/rtk.exe', 'codex', 'win32').command, 'C:/Users/ana/.local/bin/rtk.exe hook codex');
});

test('hook no Windows com espaço: aspas só se o Git Bash existe; senão recusa com nota', () => {
  const p = 'C:\\Users\\ana maria\\.local\\bin\\rtk.exe';
  const com = P.hookCommand(p, 'codex', 'win32', { gitBash: true });
  assert.strictEqual(com.command, '"C:/Users/ana maria/.local/bin/rtk.exe" hook codex');
  const sem = P.hookCommand(p, 'codex', 'win32', { gitBash: false });
  assert.strictEqual(sem.command, null);
  assert.match(sem.note, /espaço/);
});

test('hook no Linux e WSL: caminho absoluto; espaço entre aspas; caractere perigoso recusado', () => {
  assert.strictEqual(P.hookCommand('/home/ana/.local/bin/rtk', 'codex', 'linux').command, '/home/ana/.local/bin/rtk hook codex');
  assert.strictEqual(P.hookCommand('/home/a b/.local/bin/rtk', 'claude', 'linux').command, '"/home/a b/.local/bin/rtk" hook claude');
  for (const ruim of ['/home/$(x)/rtk', '/home/a"b/rtk', '/home/`x`/rtk', '/home/a\\b/rtk']) {
    const r = P.hookCommand(ruim, 'claude', 'linux');
    assert.strictEqual(r.command, null, ruim);
    assert.ok(r.note);
  }
  assert.strictEqual(P.hookCommand('rtk', 'claude', 'linux').command, null, 'caminho relativo não vale');
});

test('isRtkHookCommand reproduz o critério do RTK (F45)', () => {
  const ok = c => P.isRtkHookCommand(c, 'codex');
  assert.ok(ok('rtk hook codex'));
  assert.ok(ok('"C:/Program Files/x/rtk.exe" hook codex'));
  assert.ok(ok('"C:\\Program Files\\x\\rtk.exe" hook codex'));
  assert.ok(ok('C:/Users/x/.local/bin/rtk.exe hook codex'));
  assert.ok(ok('/home/ana/.local/bin/rtk hook codex'));
  assert.ok(!ok('rtk hook claude'), 'outro agente');
  assert.ok(!ok('command -v rtk >/dev/null 2>&1 && rtk hook claude || true'));
  assert.ok(!P.isRtkHookCommand('command -v rtk >/dev/null 2>&1 && rtk hook claude || true', 'claude'));
  assert.ok(!ok('/usr/bin/outro hook codex'));
  assert.ok(!ok('rtk hook codex extra'));
  assert.ok(P.isRtkHookCommand('rtk hook claude', 'claude'));
});
