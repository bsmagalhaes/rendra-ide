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

// ── T1: hash de confiança (mesmo algoritmo do Codex; vetores calculados pelo Codex real) ──
const CMD_WIN = 'C:/Users/ana/.local/bin/rtk.exe hook codex';
const CMD_LIN = '/home/ana/.local/bin/rtk hook codex';
const grp = (matcher, command, extra = {}) => ({
  group: matcher == null ? { hooks: [] } : { matcher, hooks: [] },
  handler: { type: 'command', command, ...extra },
});
const hashOf = (matcher, command, extra) => { const g = grp(matcher, command, extra); return C.codexHookHash(g.group, g.handler); };
const jsonOf = (matcher, command, extra) => { const g = grp(matcher, command, extra); return C.codexHookIdentityJson(g.group, g.handler); };

test('hash V1: Bash, comando Windows, timeout implícito 600 (JSON canônico conferido antes do SHA)', () => {
  assert.strictEqual(jsonOf('Bash', CMD_WIN),
    '{"event_name":"pre_tool_use","hooks":[{"async":false,"command":"C:/Users/ana/.local/bin/rtk.exe hook codex","timeout":600,"type":"command"}],"matcher":"Bash"}');
  assert.strictEqual(hashOf('Bash', CMD_WIN), 'sha256:2e2f4b6959b8577bc2b51a00d835c355d9c2b748cc3d601f26181f2acf909223');
});
test('hash V2: sem matcher a chave matcher não entra', () => {
  assert.strictEqual(jsonOf(null, CMD_WIN),
    '{"event_name":"pre_tool_use","hooks":[{"async":false,"command":"C:/Users/ana/.local/bin/rtk.exe hook codex","timeout":600,"type":"command"}]}');
  assert.strictEqual(hashOf(null, CMD_WIN), 'sha256:2323418dc56bdf7ca075e9802865d78b566911bdd5140c2f1ae6aa8a38c3a0db');
});
test('hash V3 e V4: comando Linux com timeout explícito', () => {
  assert.strictEqual(hashOf('Bash', CMD_LIN, { timeout: 30 }), 'sha256:428c25edc3548411432f1508f10af45c0179620fa235dce51d0b4858ce97fc48');
  assert.strictEqual(hashOf(null, CMD_LIN, { timeout: 10 }), 'sha256:c29345a85710ac03409cc7066461a4dcb7721f13a32a01b125273c0a8bb37133');
});
test('hash V5: timeout 600 explícito é a mesma identidade do implícito', () => {
  assert.strictEqual(hashOf('Bash', CMD_WIN, { timeout: 600 }), hashOf('Bash', CMD_WIN));
});
test('hash V6: acento e espaço no caminho (UTF-8), vindo do Codex real', () => {
  assert.strictEqual(hashOf('Bash', '"C:/Users/João Silva/.local/bin/rtk.exe" hook codex'),
    'sha256:bfcac5fa1128f58d6475b4e4a54b9101120a7851b15d512e16d67e05cf5ca508');
});
test('hash: timeout, matcher e comando diferentes mudam o hash; timeout mínimo é 1', () => {
  const base = hashOf('Bash', CMD_WIN);
  assert.notStrictEqual(hashOf('Bash', CMD_WIN, { timeout: 30 }), base);
  assert.notStrictEqual(hashOf(null, CMD_WIN), base);
  assert.notStrictEqual(hashOf('Bash', 'rtk hook codex'), base);
  assert.strictEqual(hashOf('Bash', CMD_WIN, { timeout: 0 }), hashOf('Bash', CMD_WIN, { timeout: 1 }));
});
test('hash: async, statusMessage e additionalContextLimit (só se diferente de 2500) entram', () => {
  const j = jsonOf('Bash', CMD_WIN, { async: true, statusMessage: 'oi', additionalContextLimit: 100 });
  assert.match(j, /"additionalContextLimit":100/);
  assert.match(j, /"async":true/);
  assert.match(j, /"statusMessage":"oi"/);
  assert.ok(!jsonOf('Bash', CMD_WIN, { additionalContextLimit: 2500 }).includes('additionalContextLimit'));
});

// ── T2 e T4: gravação de hooks.state e estado por comparação de hash ─────────
const HJ = '/home/ana/.codex/hooks.json';
const RTK_KEY = `${HJ}:pre_tool_use:1:0`;
const rtkEntry = text => { const e = C.rtkHookEntries(JSON.parse(text), 'codex')[0]; return { group: e.group, handler: e.hook }; };
const RTK_HASH = (() => { const e = rtkEntry(AFTER_INIT); return C.codexHookHash(e.group, e.handler); })();
const tabela = (key, hash, extra = '') => `[hooks.state.${key.includes("'") ? JSON.stringify(key) : `'${key}'`}]\n${extra}trusted_hash = "${hash}"\n`;
const sem = (re, t) => t.split('\n').filter(l => !re.test(l)).join('\n');

test('upsert: config vazio ganha só a tabela da chave com trusted_hash, sem enabled', () => {
  const r = C.upsertHookTrust('', RTK_KEY, RTK_HASH);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.text, `[hooks.state.'${RTK_KEY}']\ntrusted_hash = "${RTK_HASH}"\n`);
  assert.ok(!r.text.includes('enabled'));
});

test('upsert: hash antigo na mesma chave é trocado e não nasce segunda tabela; as outras linhas ficam', () => {
  const antes = `a = 1\n\n[hooks.state.'${RTK_KEY}']\nenabled = true\ntrusted_hash = "sha256:velho"\n\n[tui]\ntheme = "dark"\n`;
  const r = C.upsertHookTrust(antes, RTK_KEY, RTK_HASH);
  assert.strictEqual(r.text, antes.replace('sha256:velho', RTK_HASH));
  assert.strictEqual(r.text.split('[hooks.state.').length - 1, 1);
  assert.strictEqual(C.upsertHookTrust(r.text, RTK_KEY, RTK_HASH).changed, false, 'mesmo hash não regrava');
  const semHash = `[hooks.state.'${RTK_KEY}']\nenabled = true\n`;
  assert.strictEqual(C.upsertHookTrust(semHash, RTK_KEY, RTK_HASH).text, `[hooks.state.'${RTK_KEY}']\ntrusted_hash = "${RTK_HASH}"\nenabled = true\n`);
});

test('upsert: chave do Windows (barra invertida) e chave com aspa simples saem em grafia que o leitor devolve igual (ida e volta)', () => {
  const win = 'C:\\Users\\ana\\.codex\\hooks.json:pre_tool_use:1:0';
  const asp = "C:\\Users\\o'neil\\.codex\\hooks.json:pre_tool_use:1:0";
  for (const key of [win, asp]) {
    const r = C.upsertHookTrust('', key, RTK_HASH);
    assert.ok(r.changed);
    assert.strictEqual(C.readHookState(r.text).entries.get(key).hash, RTK_HASH, key);
  }
  assert.match(C.upsertHookTrust('', win, RTK_HASH).text, /^\[hooks\.state\.'C:\\Users\\ana\\\.codex\\hooks\.json:pre_tool_use:1:0'\]/);
  assert.match(C.upsertHookTrust('', asp, RTK_HASH).text, /^\[hooks\.state\."C:\\\\Users\\\\o'neil\\\\\.codex\\\\hooks\.json:pre_tool_use:1:0"\]/);
});

test('upsert: chaves que só diferem na caixa são distintas (Linux)', () => {
  const baixa = '/home/ana/.codex/hooks.json:pre_tool_use:1:0';
  const alta = '/home/Ana/.codex/hooks.json:pre_tool_use:1:0';
  const t1 = C.upsertHookTrust('', baixa, 'sha256:1').text;
  const t2 = C.upsertHookTrust(t1, alta, 'sha256:2');
  assert.ok(t2.changed);
  const s = C.readHookState(t2.text);
  assert.strictEqual(s.entries.get(baixa).hash, 'sha256:1');
  assert.strictEqual(s.entries.get(alta).hash, 'sha256:2');
});

test('upsert: conteúdo alheio preservado byte a byte (fixture com os oito hooks do Orca) e a tabela nova vai ao fim', () => {
  const r = C.upsertHookTrust(TOML, RTK_KEY, RTK_HASH);
  assert.ok(r.text.startsWith(TOML));
  assert.strictEqual(r.text.slice(TOML.length), `\n[hooks.state.'${RTK_KEY}']\ntrusted_hash = "${RTK_HASH}"\n`);
  const semFim = C.upsertHookTrust('a = 1', RTK_KEY, RTK_HASH).text;
  assert.strictEqual(semFim, `a = 1\n\n[hooks.state.'${RTK_KEY}']\ntrusted_hash = "${RTK_HASH}"\n`);
});

test('upsert: CRLF continua CRLF', () => {
  const r = C.upsertHookTrust('a = 1\r\n', RTK_KEY, RTK_HASH);
  assert.strictEqual(r.text, `a = 1\r\n\r\n[hooks.state.'${RTK_KEY}']\r\ntrusted_hash = "${RTK_HASH}"\r\n`);
  const troca = C.upsertHookTrust(r.text, RTK_KEY, 'sha256:novo');
  assert.strictEqual(troca.text, r.text.replace(RTK_HASH, 'sha256:novo'));
  assert.ok(!/[^\r]\n/.test(troca.text));
});

test('upsert: forma de hooks.state que a IDE não lê não é editada (texto idêntico, changed false), nunca TOML duplicado', () => {
  const formas = {
    'tabela inline em [hooks]': `[hooks]\nstate = { '${RTK_KEY}' = { trusted_hash = "sha256:x" } }\n`,
    'chave pontilhada na raiz': `hooks.state."${RTK_KEY}".trusted_hash = "sha256:x"\n`,
    'hooks inline na raiz': 'hooks = { state = {} }\n',
    'cabeçalho com espaços': `[ hooks.state.'${RTK_KEY}' ]\ntrusted_hash = "sha256:x"\n`,
    'cabeçalho com aspas em hooks': `["hooks".state.'${RTK_KEY}']\ntrusted_hash = "sha256:x"\n`,
    'escape além de \\\\ e \\"': '[hooks.state."C:\\u0041\\\\x.json:pre_tool_use:1:0"]\ntrusted_hash = "sha256:x"\n',
    'subtabela de uma chave': `[hooks.state.'${RTK_KEY}'.extra]\nx = 1\n`,
    'chave repetida': `${tabela(RTK_KEY, 'sha256:1')}\n${tabela(RTK_KEY, 'sha256:2')}`,
    'conteúdo sob [hooks.state]': `[hooks.state]\n'${RTK_KEY}' = { trusted_hash = "sha256:x" }\n`,
    'trusted_hash em forma estranha': `[hooks.state.'${RTK_KEY}']\ntrusted_hash = """sha256:x"""\n`,
  };
  for (const [nome, t] of Object.entries(formas)) {
    const r = C.upsertHookTrust(t, RTK_KEY, RTK_HASH);
    assert.strictEqual(r.changed, false, nome);
    assert.strictEqual(r.recognized, false, nome);
    assert.strictEqual(r.text, t, nome);
    assert.strictEqual(C.applyCodexTrust(t, [{ key: RTK_KEY, hash: RTK_HASH }]).changed, false, nome);
  }
});

test('leitura: string multilinha e [hooks] sem state não confundem o leitor; [hooks.state] vazio é aceito', () => {
  const t = `msg = """\n[hooks.state.'x']\ntrusted_hash = "sha256:no"\n"""\n[hooks]\nPreToolUse = 1\n\n[hooks.state]\n\n${tabela(RTK_KEY, 'sha256:ok')}`;
  const s = C.readHookState(t);
  assert.strictEqual(s.recognized, true);
  assert.deepStrictEqual([...s.entries.keys()], [RTK_KEY]);
  assert.strictEqual(C.upsertHookTrust(t, RTK_KEY, RTK_HASH).changed, true);
});

test('upsert só edita a chave pedida: as outras tabelas hooks.state ficam intactas', () => {
  const orca = `/home/ana/.codex/hooks.json:pre_tool_use:0:0`;
  const base = `${tabela(orca, 'sha256:orca', 'enabled = true\n')}`;
  const r = C.applyCodexTrust(base, [{ key: RTK_KEY, hash: RTK_HASH }]);
  assert.ok(r.text.startsWith(base));
  assert.strictEqual(C.readHookState(r.text).entries.get(orca).hash, 'sha256:orca');
});

// T4: trusted, modified, untrusted por comparação do hash real
const comTabela = (hash, key = RTK_KEY) => `${TOML}\n${tabela(key, hash, 'enabled = true\n')}`;
const trustOf = (hooks, toml, path = HJ) => C.codexHookTrust(hooks, toml, path);
const setRtk = (fn) => { const o = JSON.parse(AFTER_INIT); fn(o.hooks.PreToolUse[1]); return JSON.stringify(o, null, 2); };

test('confiança: trusted quando o hash gravado é o do comando atual; a chave do Orca (0:0) não conta', () => {
  assert.deepStrictEqual(trustOf(AFTER_INIT, comTabela(RTK_HASH)), { state: 'trusted', key: RTK_KEY, entries: [{ key: RTK_KEY, state: 'trusted' }] });
  assert.strictEqual(trustOf(AFTER_INIT, TOML).state, 'untrusted');
});
test('confiança: modified com hash antigo, timeout alterado e matcher removido', () => {
  assert.strictEqual(trustOf(AFTER_INIT, comTabela('sha256:velho')).state, 'modified');
  assert.strictEqual(trustOf(setRtk(g => { g.hooks[0].timeout = 30; }), comTabela(RTK_HASH)).state, 'modified');
  assert.strictEqual(trustOf(setRtk(g => { delete g.matcher; }), comTabela(RTK_HASH)).state, 'modified');
  assert.strictEqual(trustOf(setRtk(g => { g.hooks[0].command = '/home/ana/.local/bin/rtk hook codex'; }), comTabela(RTK_HASH)).state, 'modified');
});
test('confiança: untrusted sem tabela, com tabela sem hash e com grupo inserido antes (a chave muda)', () => {
  assert.strictEqual(trustOf(AFTER_INIT, TOML).state, 'untrusted');
  assert.strictEqual(trustOf(AFTER_INIT, `${TOML}\n[hooks.state.'${RTK_KEY}']\nenabled = true\n`).state, 'untrusted');
  const o = JSON.parse(AFTER_INIT);
  o.hooks.PreToolUse.unshift({ hooks: [{ type: 'command', command: 'echo x' }] });
  const t = JSON.stringify(o, null, 2);
  const r = trustOf(t, comTabela(RTK_HASH));
  assert.strictEqual(r.key, `${HJ}:pre_tool_use:2:0`);
  assert.strictEqual(r.state, 'untrusted', 'a confiança do índice 1 não vale para o 2');
});
test('confiança: chave só com caixa diferente no Linux não conta como trusted; no Windows a chave também é exata', () => {
  assert.strictEqual(trustOf(AFTER_INIT, comTabela(RTK_HASH, `/home/Ana/.codex/hooks.json:pre_tool_use:1:0`)).state, 'untrusted');
  const w = 'C:\\Users\\Ana\\.codex\\hooks.json';
  const kw = `${w}:pre_tool_use:1:0`;
  assert.strictEqual(trustOf(AFTER_INIT, C.upsertHookTrust('', kw, RTK_HASH).text, w).state, 'trusted');
  assert.strictEqual(trustOf(AFTER_INIT, C.upsertHookTrust('', kw.toLowerCase(), RTK_HASH).text, w).state, 'untrusted');
  const dupla = `"C:\\\\Users\\\\Ana\\\\.codex\\\\hooks.json:pre_tool_use:1:0"`;
  assert.strictEqual(trustOf(AFTER_INIT, `[hooks.state.${dupla}]\ntrusted_hash = "${RTK_HASH}"\n`, w).state, 'trusted', 'grafia básica escapada também vale');
});
test('confiança: config.toml em forma que a IDE não lê vira untrusted (nunca "trusted" por palpite)', () => {
  assert.strictEqual(trustOf(AFTER_INIT, `hooks.state."${RTK_KEY}".trusted_hash = "${RTK_HASH}"\n`).state, 'untrusted');
});
test('confiança: mais de uma entrada do RTK recebe uma chave cada e vale o pior estado; outro handler do mesmo grupo não recebe', () => {
  const o = JSON.parse(AFTER_INIT);
  o.hooks.PreToolUse[1].hooks.unshift({ type: 'command', command: 'echo outro' }); // RTK vira 1:1
  o.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] }); // RTK 2:0
  const t = JSON.stringify(o, null, 2);
  const alvos = C.rtkTrustTargets(t, HJ);
  assert.deepStrictEqual(alvos.map(a => a.key), [`${HJ}:pre_tool_use:1:1`, `${HJ}:pre_tool_use:2:0`]);
  const r = C.applyCodexTrust(TOML, alvos);
  assert.strictEqual(r.recognized, true);
  assert.ok(!r.text.includes(':pre_tool_use:1:0'), 'o handler "echo outro" (1:0) não é aprovado');
  assert.strictEqual(trustOf(t, r.text).state, 'trusted');
  const meio = C.upsertHookTrust(TOML, alvos[0].key, alvos[0].hash).text;
  assert.strictEqual(trustOf(t, meio).state, 'untrusted');
  const velho = C.upsertHookTrust(r.text, alvos[1].key, 'sha256:velho').text;
  assert.strictEqual(trustOf(t, velho).state, 'modified');
});
test('confiança: sem hook do RTK é no-hook', () => {
  assert.strictEqual(trustOf(ORCA_HOOKS, TOML).state, 'no-hook');
});

// ── T6: writable_roots só em forma simples, só com workspace-write, nunca no Windows ──
const DB_DIR = '/home/ana/.local/share/rtk/codex';
const wr = (t, o = {}) => C.patchWritableRoots(t, DB_DIR, { platform: 'linux', ...o });
const WW = 'model = "x"\nsandbox_mode = "workspace-write"\n';

test('writable_roots: no Windows nunca grava, mesmo com workspace-write', () => {
  assert.strictEqual(wr(WW, { platform: 'win32' }).changed, false);
});
test('writable_roots: sem sandbox_mode, read-only, perfil ou permissões o arquivo não muda', () => {
  const sem = [
    'model = "x"\n',
    'sandbox_mode = "read-only"\n',
    'sandbox_mode = "danger-full-access"\n',
    `${WW}profile = "p"\n`,
    `${WW}default_permissions = "x"\n`,
    `${WW}\n[permissions.x]\na = 1\n`,
    '[profiles.p]\nsandbox_mode = "workspace-write"\n',
    '[tui]\nsandbox_mode = "workspace-write"\n',
  ];
  for (const t of sem) { const r = wr(t); assert.strictEqual(r.changed, false, t); assert.strictEqual(r.text, t); }
});
test('writable_roots: sem a tabela, acrescenta ao fim e o sandbox_mode original fica byte a byte', () => {
  const t = `${WW}\n[tui]\ntheme = "dark"\n`;
  const r = wr(t);
  assert.ok(r.changed);
  assert.ok(r.text.startsWith(t));
  assert.strictEqual(r.text.slice(t.length), `\n[sandbox_workspace_write]\nwritable_roots = ['${DB_DIR}']\n`);
  assert.strictEqual(r.text.split('sandbox_mode').length - 1, 1, 'nenhum sandbox_mode novo');
  assert.strictEqual(wr('sandbox_mode = \'workspace-write\'').text, `sandbox_mode = 'workspace-write'\n\n[sandbox_workspace_write]\nwritable_roots = ['${DB_DIR}']\n`);
  assert.strictEqual(wr(r.text).changed, false, 'de novo não muda');
});
test('writable_roots: tabela exata sem writable_roots recebe a linha logo abaixo do cabeçalho', () => {
  const t = `${WW}\n[sandbox_workspace_write]\nnetwork_access = true\n\n[tui]\nx = 1\n`;
  const r = wr(t);
  assert.strictEqual(r.text, t.replace('[sandbox_workspace_write]\n', `[sandbox_workspace_write]\nwritable_roots = ['${DB_DIR}']\n`));
});
test('writable_roots: array de uma linha só com strings simples recebe o caminho ao fim, sem duplicar e sem perder os outros', () => {
  const um = (arr, extra = '') => `${WW}\n[sandbox_workspace_write]\nwritable_roots = ${arr}${extra}\nnetwork_access = true\n`;
  assert.strictEqual(wr(um("['/a', \"/b\"]")).text, um(`['/a', "/b", '${DB_DIR}']`));
  assert.strictEqual(wr(um('[]')).text, um(`['${DB_DIR}']`));
  assert.strictEqual(wr(um("['/a',]")).text, um(`['/a', '${DB_DIR}']`));
  assert.strictEqual(wr(um("['/a']", ' # nota')).text, um(`['/a', '${DB_DIR}']`, ' # nota'));
  assert.strictEqual(wr(um(`['${DB_DIR}']`)).changed, false);
  assert.strictEqual(wr(um(`["${DB_DIR}"]`)).changed, false, 'comparação pelo valor decodificado');
});
test('writable_roots: qualquer outra forma não é editada, sem erro', () => {
  const formas = [
    `${WW}\n[sandbox_workspace_write]\nwritable_roots = [\n  '/a',\n]\n`,
    `${WW}\n[sandbox_workspace_write]\nwritable_roots = ['/a', # comentário\n  '/b']\n`,
    `${WW}\nsandbox_workspace_write = { writable_roots = ['/a'] }\n`,
    `${WW}\nsandbox_workspace_write.writable_roots = ['/a']\n`,
    `${WW}\n[sandbox_workspace_write]\nwritable_roots = ['/a']\n\n[sandbox_workspace_write]\nnetwork_access = true\n`,
    `${WW}\n[sandbox_workspace_write]\nwritable_roots = ['\\u0041']\n`.replace("'\\u0041'", '"\\u0041"'),
    `${WW}\n[sandbox_workspace_write]\n"writable_roots" = ['/a']\n`,
    `${WW}\n[ sandbox_workspace_write ]\nwritable_roots = ['/a']\n`,
  ];
  for (const t of formas) { const r = wr(t); assert.strictEqual(r.changed, false, t); assert.strictEqual(r.text, t); }
});
test('writable_roots: CRLF continua CRLF', () => {
  const r = wr('sandbox_mode = "workspace-write"\r\n');
  assert.strictEqual(r.text, `sandbox_mode = "workspace-write"\r\n\r\n[sandbox_workspace_write]\r\nwritable_roots = ['${DB_DIR}']\r\n`);
});

test("lineInfo: ''' dentro de string de uma linha ou comentário não abre trecho multilinha (sem tabela duplicada)", () => {
  const t = `x = "a'''b"
y = 'c"""d' # '''
enabled = false

${tabela(RTK_KEY, 'sha256:velho')}`;
  const s = C.readHookState(t);
  assert.strictEqual(s.recognized, true);
  assert.strictEqual(s.entries.get(RTK_KEY).hash, 'sha256:velho');
  const r = C.upsertHookTrust(t, RTK_KEY, RTK_HASH);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.text.split(RTK_KEY).length - 1, 1, 'a tabela do RTK aparece uma vez só');
  assert.ok(r.text.includes(RTK_HASH));
  const verdadeiro = `m = """
[hooks.state.'x']
"""
`;
  assert.strictEqual(C.readHookState(verdadeiro).recognized, true, 'multilinha de verdade segue protegida');
});
