// Escritores de configuração dos agentes (puros). Fixtures fictícias no formato que o
// `rtk init` 0.50.0 e o Orca gravam (F3, F5, F44, F54, F55); nenhum teste chama o rtk real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/rtk-config');

// autocrlf pode converter as fixtures no checkout do Windows: os testes partem de LF
const fx = n => fs.readFileSync(path.join(__dirname, 'fixtures', 'rtk', n), 'utf8').replace(/\r\n/g, '\n');
const ORCA_HOOKS = fx('codex-hooks-orca.json');
const AFTER_INIT = fx('codex-hooks-after-init.json');
const CLAUDE = fx('claude-settings-after-init.json');
const TOML = fx('codex-config.toml');
const ABS_LIN = '/home/ana/.local/bin/rtk';
const ABS_WIN = 'C:\\Users\\ana\\.local\\bin\\rtk.exe';

test('hasRtkHook / isAbsoluteHook leem o hooks.json, não o AGENTS.md', () => {
  assert.strictEqual(C.hasRtkHook(ORCA_HOOKS, 'codex'), false);
  assert.strictEqual(C.hasRtkHook(AFTER_INIT, 'codex'), true);
  assert.strictEqual(C.isAbsoluteHook(AFTER_INIT, 'codex'), false);
  const abs = C.patchCodexHooks(AFTER_INIT, ABS_LIN, { platform: 'linux' }).text;
  assert.strictEqual(C.isAbsoluteHook(abs, 'codex'), true);
  assert.strictEqual(C.hasRtkHook(CLAUDE, 'claude'), true);
  assert.strictEqual(C.hasRtkHook('lixo', 'claude'), false);
});

test('Codex: hook vira absoluto e o resto do arquivo fica igual (deepStrictEqual)', () => {
  const r = C.patchCodexHooks(AFTER_INIT, ABS_LIN, { platform: 'linux' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.hookChanged, true);
  const antes = JSON.parse(AFTER_INIT);
  const depois = JSON.parse(r.text);
  assert.strictEqual(depois.hooks.PreToolUse[1].hooks[0].command, '/home/ana/.local/bin/rtk hook codex');
  assert.strictEqual(depois.hooks.PreToolUse[1].matcher, 'Bash');
  depois.hooks.PreToolUse[1].hooks[0].command = 'rtk hook codex';
  assert.deepStrictEqual(depois, antes, 'só o comando do grupo do RTK mudou');
  assert.strictEqual(Object.keys(depois.hooks).length, 8);
  assert.strictEqual(r.text.endsWith('\n'), true);
  assert.match(r.text, /^\{\n {2}"hooks"/, 'mesma indentação do arquivo lido');
});

test('Codex: segunda execução não muda nada e não duplica a entrada', () => {
  const um = C.patchCodexHooks(AFTER_INIT, ABS_LIN, { platform: 'linux' });
  const dois = C.patchCodexHooks(um.text, ABS_LIN, { platform: 'linux' });
  assert.strictEqual(dois.changed, false);
  assert.strictEqual(dois.hookChanged, false);
  assert.strictEqual(dois.text, um.text);
  assert.strictEqual(JSON.parse(dois.text).hooks.PreToolUse.length, 2);
});

test('Codex: hook ausente devolve nota e não cria entrada', () => {
  const r = C.patchCodexHooks(ORCA_HOOKS, ABS_LIN, { platform: 'linux' });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, ORCA_HOOKS);
  assert.match(r.notes.join(' '), /não encontrado/);
});

test('Codex: preserva indentação por tabulação e fim de linha CRLF', () => {
  const tab = JSON.stringify(JSON.parse(AFTER_INIT), null, '\t');
  assert.match(C.patchCodexHooks(tab, ABS_LIN, { platform: 'linux' }).text, /^\{\n\t"hooks"/);
  const crlf = AFTER_INIT.replace(/\n/g, '\r\n');
  const r = C.patchCodexHooks(crlf, ABS_LIN, { platform: 'linux' }).text;
  assert.ok(r.includes('\r\n') && !/[^\r]\n/.test(r));
});

test('Windows: sem aspas quando o caminho é simples; com espaço sem Git Bash mantém o literal e avisa', () => {
  const r = C.patchCodexHooks(AFTER_INIT, ABS_WIN, { platform: 'win32' });
  assert.strictEqual(JSON.parse(r.text).hooks.PreToolUse[1].hooks[0].command, 'C:/Users/ana/.local/bin/rtk.exe hook codex');
  const sp = C.patchCodexHooks(AFTER_INIT, 'C:\\Users\\ana maria\\.local\\bin\\rtk.exe', { platform: 'win32', gitBash: false });
  assert.strictEqual(sp.changed, false);
  assert.match(sp.notes.join(' '), /espaço/);
  const com = C.patchCodexHooks(AFTER_INIT, 'C:\\Users\\ana maria\\.local\\bin\\rtk.exe', { platform: 'win32', gitBash: true });
  assert.strictEqual(JSON.parse(com.text).hooks.PreToolUse[1].hooks[0].command, '"C:/Users/ana maria/.local/bin/rtk.exe" hook codex');
});

test('Claude: hook absoluto e env.RTK_DB_PATH; hooks do Orca e demais chaves intactos, ordem mantida', () => {
  const db = '/home/ana/.local/share/rtk/history.db';
  const r = C.patchClaudeSettings(CLAUDE, { dbPath: db, absRtk: ABS_LIN, platform: 'linux' });
  assert.strictEqual(r.changed, true);
  const antes = JSON.parse(CLAUDE);
  const depois = JSON.parse(r.text);
  assert.strictEqual(depois.env.RTK_DB_PATH, db);
  assert.strictEqual(depois.hooks.PreToolUse[1].hooks[0].command, '/home/ana/.local/bin/rtk hook claude');
  assert.deepStrictEqual(depois.hooks.PreToolUse[0], antes.hooks.PreToolUse[0], 'grupo do Orca igual');
  assert.deepStrictEqual(depois.hooks.Stop, antes.hooks.Stop);
  assert.deepStrictEqual(depois.permissions, antes.permissions);
  assert.deepStrictEqual(depois.statusLine, antes.statusLine);
  assert.strictEqual(depois.hooks.PreToolUse.length, 2);
  assert.deepStrictEqual(Object.keys(depois).slice(0, 3), ['permissions', 'statusLine', 'hooks'], 'ordem das chaves mantida');
  assert.strictEqual(C.claudeDbEnv(r.text), db);
  const dois = C.patchClaudeSettings(r.text, { dbPath: db, absRtk: ABS_LIN, platform: 'linux' });
  assert.strictEqual(dois.changed, false);
  assert.strictEqual(dois.text, r.text);
});

test('Claude: sem o grupo do RTK não cria o grupo; não toca o hook de projeto', () => {
  const lit = 'command -v rtk >/dev/null 2>&1 && rtk hook claude || true';
  const sem = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: lit }] }] } }, null, 2);
  const r = C.patchClaudeSettings(sem, { dbPath: '/x/history.db', absRtk: ABS_LIN, platform: 'linux' });
  const o = JSON.parse(r.text);
  assert.strictEqual(o.hooks.PreToolUse.length, 1);
  assert.strictEqual(o.hooks.PreToolUse[0].hooks[0].command, lit);
  assert.match(r.notes.join(' '), /não encontrado/);
});

test('config.toml sem a tabela: acrescenta o bloco e as linhas anteriores ficam idênticas (byte a byte)', () => {
  const db = '/home/ana/.local/share/rtk/codex/history.db';
  const r = C.patchCodexConfigToml(TOML, db);
  assert.strictEqual(r.changed, true);
  assert.ok(r.text.startsWith(TOML), 'prefixo idêntico: trusted_hash, trust_level e [hooks.state] intactos');
  assert.strictEqual(r.text.slice(TOML.length), `\n[shell_environment_policy]\nset = { RTK_DB_PATH = '${db}' }\n`);
  assert.match(r.notes.join(' '), /shell_environment_policy/);
  assert.strictEqual(C.codexDbEnv(r.text), db);
  const dois = C.patchCodexConfigToml(r.text, db);
  assert.strictEqual(dois.changed, false);
  assert.strictEqual(dois.text, r.text);
});

test('config.toml sem quebra de linha final: acrescenta a quebra antes do bloco', () => {
  const semFim = TOML.replace(/\n+$/, '');
  const r = C.patchCodexConfigToml(semFim, '/d/history.db');
  assert.ok(r.text.startsWith(semFim + '\n\n[shell_environment_policy]'));
  assert.strictEqual(C.patchCodexConfigToml('', '/d/history.db').text, "[shell_environment_policy]\nset = { RTK_DB_PATH = '/d/history.db' }\n");
});

test('config.toml com a tabela e outro valor: não edita e devolve o trecho', () => {
  const t = TOML + "\n[shell_environment_policy]\nset = { FOO = 'bar' }\n";
  const r = C.patchCodexConfigToml(t, '/d/history.db');
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, t);
  assert.match(r.snippet, /RTK_DB_PATH/);
  const pontilhado = 'shell_environment_policy.inherit = "all"\n' + TOML;
  assert.strictEqual(C.patchCodexConfigToml(pontilhado, '/d/history.db').changed, false, 'notação pontuada conta como já existente');
  const certo = TOML + "\n[shell_environment_policy]\nset = { RTK_DB_PATH = '/d/history.db' }\n";
  assert.strictEqual(C.patchCodexConfigToml(certo, '/d/history.db').snippet, null);
});

test('config.toml: caminho do Windows com barra invertida vira TOML válido; aspa simples usa string básica', () => {
  const win = 'C:\\Users\\ana\\AppData\\Local\\rtk\\codex\\history.db';
  const r = C.patchCodexConfigToml('', win);
  assert.ok(r.text.includes("set = { RTK_DB_PATH = 'C:\\Users\\ana\\AppData\\Local\\rtk\\codex\\history.db' }"));
  assert.strictEqual(C.codexDbEnv(r.text), win);
  const aspa = C.patchCodexConfigToml('', "C:\\Users\\o'neil\\history.db");
  assert.ok(aspa.text.includes('RTK_DB_PATH = "C:\\\\Users\\\\o\'neil\\\\history.db"'));
  assert.strictEqual(C.codexDbEnv(aspa.text), "C:\\Users\\o'neil\\history.db");
});

test('config.toml com CRLF mantém CRLF no bloco novo', () => {
  const r = C.patchCodexConfigToml('a = 1\r\n', '/d/h.db');
  assert.strictEqual(r.text, "a = 1\r\n\r\n[shell_environment_policy]\r\nset = { RTK_DB_PATH = '/d/h.db' }\r\n");
});

const HJ = '/home/ana/.codex/hooks.json';
const withKey = (key, body = 'trusted_hash = "sha256:abc"') => `${TOML}\n[hooks.state."${key}"]\nenabled = true\n${body}\n`;

test('confiança: chave ausente é pending', () => {
  assert.deepStrictEqual(C.codexHookTrust(AFTER_INIT, TOML, HJ), { state: 'pending', key: `${HJ}:pre_tool_use:1:0` });
});
test('confiança: chave do RTK presente é trusted-unverified; a do Orca (0:0) não conta', () => {
  assert.strictEqual(C.codexHookTrust(AFTER_INIT, withKey(`${HJ}:pre_tool_use:1:0`), HJ).state, 'trusted-unverified');
  assert.strictEqual(C.codexHookTrust(AFTER_INIT, TOML, HJ).state, 'pending');
});
test('confiança: changedNow força pending mesmo com a chave', () => {
  assert.strictEqual(C.codexHookTrust(AFTER_INIT, withKey(`${HJ}:pre_tool_use:1:0`), HJ, { changedNow: true }).state, 'pending');
});
test('confiança: entrada sem trusted_hash é pending', () => {
  assert.strictEqual(C.codexHookTrust(AFTER_INIT, withKey(`${HJ}:pre_tool_use:1:0`, ''), HJ).state, 'pending');
});
test('confiança: hook do RTK em índice diferente de zero acompanha o índice', () => {
  const o = JSON.parse(AFTER_INIT);
  o.hooks.PreToolUse.unshift({ hooks: [{ type: 'command', command: 'echo x' }] });
  const t = JSON.stringify(o, null, 2);
  assert.strictEqual(C.codexHookTrust(t, TOML, HJ).key, `${HJ}:pre_tool_use:2:0`);
  assert.strictEqual(C.codexHookTrust(t, withKey(`${HJ}:pre_tool_use:1:0`), HJ).state, 'pending', 'a confiança do índice 1 não vale para o 2');
});
test('confiança: caixa e separador do caminho são tolerados (Windows)', () => {
  const w = 'C:\\Users\\Ana\\.codex\\hooks.json';
  const t1 = '[hooks.state."c:/users/ana/.codex/hooks.json:pre_tool_use:1:0"]\ntrusted_hash = "sha256:abc"\n';
  assert.strictEqual(C.codexHookTrust(AFTER_INIT, t1, w).state, 'trusted-unverified');
  const t2 = '[hooks.state."C:\\\\Users\\\\Ana\\\\.codex\\\\hooks.json:pre_tool_use:1:0"]\ntrusted_hash = "sha256:abc"\n';
  assert.strictEqual(C.codexHookTrust(AFTER_INIT, t2, w).state, 'trusted-unverified');
});
test('confiança: sem hook do RTK é no-hook', () => {
  assert.strictEqual(C.codexHookTrust(ORCA_HOOKS, TOML, HJ).state, 'no-hook');
});
