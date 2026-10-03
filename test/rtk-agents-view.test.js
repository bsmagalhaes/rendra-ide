// Visão da página RTK por agente: linhas por sistema, avisos e HTML (puro, dados fictícios)
const test = require('node:test');
const assert = require('node:assert');
const A = require('../renderer/rtk-agents');

const { TRUST_MSG: MSG } = require('../src/rtk-enable');
const ag = (o = {}) => ({ installed: true, hook: true, hookAbsolute: true, dbEnvConfigured: true, trust: 'trusted', trustMessage: null, error: null, gain: { summary: {}, daily: [] }, ...o });
const env = (id, label, agents, extra = {}) => ({ id, label, state: 'ok', version: '0.50.0', needsUpdate: false, agents: { claude: ag(), codex: ag(), ...agents }, ...extra });

test('sistema ativo: linha ok, sem ação e sem aviso', () => {
  const v = A.agentView([env('host', 'Windows', {})], 'claude');
  assert.deepStrictEqual(v.rows, [{ envId: 'host', label: 'Windows', action: null, tone: 'ok', text: 'RTK ativo' }]);
  assert.strictEqual(v.state, 'RTK ativo');
  assert.deepStrictEqual(v.warnings, []);
});

test('WSL desligado, RTK ausente, desatualizado e erro: texto certo e ação só onde cabe', () => {
  const v = A.agentView([
    { id: 'U', label: 'Ubuntu', state: 'wsl-off', agents: {} },
    { id: 'D', label: 'Debian', state: 'missing', agents: {} },
    env('host', 'Windows', {}, { needsUpdate: true, version: '0.48.0' }),
    { id: 'X', label: 'Fedora', state: 'error', agents: {} },
  ], 'codex');
  assert.deepStrictEqual(v.rows.map(r => [r.text, r.action && r.action.kind]), [
    ['WSL desligado', null], ['RTK ausente', 'install'], ['RTK 0.48.0 desatualizado', 'install'], ['erro ao ler', null],
  ]);
  assert.strictEqual(v.state, 'RTK não ativado');
});

test('hook ausente oferece Ativar; hook sem caminho absoluto ou sem banco no env oferece Concluir ativação', () => {
  const v = A.agentView([
    env('a', 'A', { claude: ag({ hook: false }) }),
    env('b', 'B', { claude: ag({ hookAbsolute: false }) }),
    env('c', 'C', { claude: ag({ dbEnvConfigured: false }) }),
    env('d', 'D', { claude: ag({ installed: false }) }),
    env('e', 'E', { claude: ag({ error: 'x' }) }),
  ], 'claude');
  assert.deepStrictEqual(v.rows.map(r => [r.text, r.action && r.action.label]), [
    ['RTK não ativado', 'Ativar'], ['ativação incompleta', 'Concluir ativação'], ['ativação incompleta', 'Concluir ativação'],
    ['Claude Code não instalado', null], ['erro ao ler o banco', null],
  ]);
  assert.strictEqual(v.state, 'RTK não ativado');
  const parcial = A.agentView([env('a', 'A', {}), env('b', 'B', { claude: ag({ hook: false }) })], 'claude');
  assert.strictEqual(parcial.state, 'RTK ativo em 1 de 2 sistemas');
});

test('aviso do /hooks: só no Codex, só com hook, só quando a aprovação falta (modified ou untrusted); trusted não avisa', () => {
  const aviso = (trust, extra = {}) => A.agentView([env('host', 'Windows', { codex: ag({ trust, trustMessage: trust === 'trusted' ? null : MSG, ...extra }) })], 'codex').warnings;
  assert.deepStrictEqual(aviso('trusted'), [], 'aprovado: nenhum aviso');
  for (const estado of ['modified', 'untrusted']) {
    const w = aviso(estado);
    assert.strictEqual(w.length, 1, estado);
    assert.strictEqual(w[0].kind, 'trust');
    assert.strictEqual(w[0].text, `Windows: ${MSG}`);
    assert.match(w[0].text, /\/hooks/);
    assert.match(w[0].text, /PreToolUse/);
    assert.match(w[0].text, /aperte t\b/);
  }
  assert.deepStrictEqual(aviso(null, { hook: false }), []);
  const claude = A.agentView([env('host', 'Windows', { claude: ag({ trust: 'untrusted' }) })], 'claude');
  assert.deepStrictEqual(claude.warnings, [], 'confiança é do Codex');
});

test('nenhum texto de writable_roots, sandbox ou trechos para copiar aparece na página', () => {
  const v = A.agentView([env('host', 'Windows', { codex: ag({ trust: 'untrusted', trustMessage: MSG, writableRootsSnippet: 'sandbox_mode = "workspace-write"' }) })], 'codex');
  const html = A.warningsHtml(v.warnings) + A.rowsHtml(v);
  assert.ok(!/writable_roots|sandbox|snippet|copy-snippet/i.test(html), html);
});

test('HTML das linhas: ação com data-attributes e texto escapado', () => {
  const v = A.agentView([env('Ub"<b>', 'U<b>', { claude: ag({ hook: false }) })], 'claude');
  const html = A.rowsHtml(v);
  assert.ok(html.includes('data-rtk-action="enable"') && html.includes('data-agent="claude"'));
  assert.ok(html.includes('U&lt;b&gt;') && !html.includes('U<b>'));
  assert.ok(html.includes('data-env="Ub&quot;&lt;b&gt;"'));
  assert.ok(!A.rowsHtml(A.agentView([env('host', 'W', {})], 'claude')).includes('<button'));
});

test('avisos do host (WinGet) viram avisos globais', () => {
  const w = A.globalWarnings([env('host', 'Windows', {}, { warnings: [{ kind: 'winget', text: 'Há um RTK 0.48.0 do WinGet. Rode: winget upgrade --id rtk-ai.rtk' }] }), { id: 'U', label: 'U', state: 'wsl-off' }]);
  assert.deepStrictEqual(w, [{ kind: 'winget', text: 'Há um RTK 0.48.0 do WinGet. Rode: winget upgrade --id rtk-ai.rtk' }]);
  assert.match(A.warningsHtml(w), /winget upgrade --id rtk-ai\.rtk/);
});

test('confirmação lista todos os arquivos tocados e diz o que muda no hook e no banco', () => {
  const t = A.confirmText('codex', 'Ubuntu-24.04', ['/h/.codex/hooks.json', '/h/.codex/config.toml', '/h/.codex/RTK.md', '/h/.codex/AGENTS.md']);
  for (const f of ['hooks.json', 'config.toml', 'RTK.md', 'AGENTS.md']) assert.ok(t.includes(`- /h/.codex/${f}`), f);
  assert.match(t, /cópia de segurança/);
  assert.match(t, /shell_environment_policy/);
  assert.match(t, /Ubuntu-24\.04/);
  const c = A.confirmText('claude', 'Windows', ['C:\\u\\.claude\\settings.json', 'C:\\u\\.claude\\CLAUDE.md']);
  assert.match(c, /env\.RTK_DB_PATH no settings\.json/);
  assert.ok(c.includes('CLAUDE.md'));
});

test('resultado da ativação mostra o que mudou, a cópia, o bloco acrescentado e o aviso do /hooks', () => {
  const t = A.resultText({
    ok: true,
    changes: [
      { file: '/h/.codex/config.toml', kind: 'modified', backup: '/h/.codex/config.toml.rendra-20261002-100000.bak', added: "[shell_environment_policy]\nset = { RTK_DB_PATH = '/x' }" },
      { file: '/h/.codex/RTK.md', kind: 'created', backup: null },
    ],
    notes: ['Banco do Codex criado em /x.'], trustMessage: MSG,
  }, 'codex', 'Windows');
  assert.match(t, /RTK ativado no Codex em Windows/);
  assert.match(t, /config\.toml \(alterado\)\n {2}cópia de segurança: \/h\/\.codex\/config\.toml\.rendra-20261002-100000\.bak/);
  assert.match(t, /\+ \[shell_environment_policy\]/);
  assert.match(t, /RTK\.md \(criado\)/);
  assert.match(t, /\/hooks/);
  assert.match(A.resultText({ ok: true, changes: [] }, 'claude', 'W'), /Nenhum arquivo precisou mudar/);
});

test('resultado de falha explica a causa e a saída (atualizar ou instalar)', () => {
  assert.match(A.resultText({ ok: false, error: 'disco cheio' }, 'codex', 'W'), /Não foi possível ativar o RTK no Codex em W: disco cheio/);
  assert.match(A.resultText({ ok: false, needsUpdate: true, error: 'velho' }, 'codex', 'W'), /Atualizar RTK/);
  assert.match(A.resultText({ ok: false, needsInstall: true, error: 'sem' }, 'codex', 'W'), /Instalar RTK/);
  assert.match(A.resultText(null, 'codex', 'W'), /sem resposta/);
});

test('falha da ativação mostra o que foi desfeito, o que não foi e onde ficaram as cópias', () => {
  const t = A.resultText({ ok: false, error: 'boom', rolledBack: { '/h/.codex/hooks.json': true, '/h/.codex/config.toml': false }, backups: ['/h/.codex/config.toml.rendra-1.bak'] }, 'codex', 'W');
  assert.ok(t.includes('Desfeito (voltaram ao que eram):\n- /h/.codex/hooks.json'));
  assert.ok(t.includes('Não restaurados (outra sessão mexeu neles depois):\n- /h/.codex/config.toml'));
  assert.ok(t.includes('Cópias de segurança que ficaram:\n- /h/.codex/config.toml.rendra-1.bak'));
});

test('texto da instalação: versão, PATH da distro e aviso do WinGet; falha e distro parada', () => {
  const ok = A.installText({ ok: true, rtk: '/home/bruno/.local/bin/rtk', version: '0.50.0', pathEdited: true, warnings: [{ text: 'Há um RTK 0.48.0 do WinGet.' }] }, 'Ubuntu');
  assert.match(ok, /RTK 0\.50\.0 instalado em Ubuntu: \/home\/bruno\/\.local\/bin\/rtk/);
  assert.match(ok, /~\/\.profile da distro/);
  assert.match(ok, /WinGet/);
  assert.match(A.installText({ ok: true, upToDate: true, version: '0.50.1' }, 'Windows'), /já está na versão 0\.50\.1/);
  assert.match(A.installText({ ok: false, state: 'wsl-off', error: 'desligada' }, 'U'), /não acorda distros/);
  assert.match(A.installText(null, 'U'), /sem resposta/);
});
