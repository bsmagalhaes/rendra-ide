// Visão da página RTK por agente: linhas por sistema, avisos e HTML (puro, dados fictícios)
const test = require('node:test');
const assert = require('node:assert');
const A = require('../renderer/rtk-agents');

const ag = (o = {}) => ({ installed: true, hook: true, hookAbsolute: true, dbEnvConfigured: true, trust: 'trusted-unverified', error: null, gain: { summary: {}, daily: [] }, writableRootsSnippet: 'sandbox_mode = "workspace-write"', ...o });
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

test('aviso do /hooks só no Codex, só com hook, e some quando a confiança está registrada', () => {
  const pendente = A.agentView([env('host', 'Windows', { codex: ag({ trust: 'pending' }) })], 'codex');
  assert.ok(pendente.warnings.some(w => w.kind === 'trust' && w.text === `Windows: ${A.TRUST_MSG}`));
  assert.match(A.TRUST_MSG, /^Abra o Codex e aprove o hook em \/hooks\. Sem isso o RTK não reescreve nenhum comando\.$/);
  const ok = A.agentView([env('host', 'Windows', {})], 'codex');
  assert.ok(!ok.warnings.some(w => w.kind === 'trust'));
  const semHook = A.agentView([env('host', 'Windows', { codex: ag({ hook: false, trust: null }) })], 'codex');
  assert.deepStrictEqual(semHook.warnings, []);
  const claude = A.agentView([env('host', 'Windows', { claude: ag({ trust: 'pending' }) })], 'claude');
  assert.deepStrictEqual(claude.warnings, [], 'confiança é do Codex');
});

test('snippet de writable_roots entra como aviso copiável com o texto escapado', () => {
  const v = A.agentView([env('host', 'Windows', { codex: ag({ writableRootsSnippet: 'writable_roots = ["C:\\\\x<y>"]' }) })], 'codex');
  const html = A.warningsHtml(v.warnings);
  assert.match(html, /<details class="rtk-warn snippet">/);
  assert.match(html, /data-rtk-action="copy-snippet"/);
  assert.ok(html.includes('&lt;y&gt;') && !html.includes('<y>'));
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
    notes: ['Banco do Codex criado em /x.'], trustMessage: A.TRUST_MSG,
  }, 'codex', 'Windows');
  assert.match(t, /RTK ativado no Codex em Windows/);
  assert.match(t, /config\.toml \(alterado\)\n {2}cópia de segurança: \/h\/\.codex\/config\.toml\.rendra-20261002-100000\.bak/);
  assert.match(t, /\+ \[shell_environment_policy\]/);
  assert.match(t, /RTK\.md \(criado\)/);
  assert.match(t, /Abra o Codex e aprove o hook em \/hooks/);
  assert.match(A.resultText({ ok: true, changes: [] }, 'claude', 'W'), /Nenhum arquivo precisou mudar/);
});

test('resultado de falha explica a causa e a saída (atualizar ou instalar)', () => {
  assert.match(A.resultText({ ok: false, error: 'disco cheio' }, 'codex', 'W'), /Não foi possível ativar o RTK no Codex em W: disco cheio/);
  assert.match(A.resultText({ ok: false, needsUpdate: true, error: 'velho' }, 'codex', 'W'), /Atualizar RTK/);
  assert.match(A.resultText({ ok: false, needsInstall: true, error: 'sem' }, 'codex', 'W'), /Instalar RTK/);
  assert.match(A.resultText(null, 'codex', 'W'), /sem resposta/);
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
