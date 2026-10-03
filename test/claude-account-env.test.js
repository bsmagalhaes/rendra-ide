// Identidade do Claude por ambiente (Windows e distros WSL) e derivação do ambiente a partir dos
// caminhos de wslRoots. Homes e distros falsos em pasta temporária; nada do usuário é lido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME_IDE = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-env-ide-'));
process.env.RENDRA_HOME = HOME_IDE;
const { contaClaudeDoHome, currentAccount } = require('../src/accounts');
const { ambientesWsl } = require('../src/wsl-ambientes');
const { wslRoots, _limpaCache } = require('../src/wsl-roots');

const escreve = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o)); };
const conta = (org, extra = {}) => ({ oauthAccount: { emailAddress: 'ana@exemplo.test', displayName: 'Ana', fullName: 'Ana Demo', organizationName: org, userRateLimitTier: 'default_claude_max_5x', accessToken: 'SENTINELA-OAUTH', ...extra } });

test.after(() => fs.rmSync(HOME_IDE, { recursive: true, force: true }));

test('home com oauthAccount devolve organização, e-mail e plano; credenciais só dão plano e nível', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-env-a-'));
  escreve(path.join(home, '.claude.json'), conta('Empresa Demo'));
  escreve(path.join(home, '.claude', '.credentials.json'), { claudeAiOauth: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', accessToken: 'SENTINELA-ACESSO', refreshToken: 'SENTINELA-RENOVA' } });
  const r = await contaClaudeDoHome(home);
  assert.deepStrictEqual(r, { email: 'ana@exemplo.test', name: 'Ana', organization: 'Empresa Demo', plan: 'max', tier: 'default_claude_max_20x' });
  assert.ok(!JSON.stringify(r).includes('SENTINELA'), 'nenhum token no retorno');
});

test('sem credenciais plano e nível ficam vazios, sem erro; nível cai para o da conta', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-env-b-'));
  escreve(path.join(home, '.claude.json'), conta('Empresa Demo'));
  const r = await contaClaudeDoHome(home);
  assert.strictEqual(r.organization, 'Empresa Demo');
  assert.strictEqual(r.plan, '');
  assert.strictEqual(r.tier, 'default_claude_max_5x');
});

test('home sem oauthAccount, sem .claude.json ou com JSON quebrado devolve null', async () => {
  const semConta = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-env-c-'));
  escreve(path.join(semConta, '.claude.json'), { projects: {} });
  assert.strictEqual(await contaClaudeDoHome(semConta), null);
  assert.strictEqual(await contaClaudeDoHome(fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-env-d-'))), null);
  const quebrado = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-env-e-'));
  escreve(path.join(quebrado, '.claude.json'), '{ quebrado');
  assert.strictEqual(await contaClaudeDoHome(quebrado), null);
});

test('as distros derivadas de wslRoots trazem nome e home certos; só homes com projetos aparecem', async () => {
  _limpaCache();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-env-wsl-'));
  const distro = path.join(base, 'Ubuntu-24.04');
  const outra = path.join(base, 'Debian');
  escreve(path.join(distro, 'home', 'ana', '.claude', 'projects', 'x', 's.jsonl'), '{}\n');
  escreve(path.join(distro, 'home', 'ana', '.claude.json'), conta('Org Ubuntu'));
  escreve(path.join(distro, 'home', 'ana', '.codex', 'sessions', 'r.jsonl'), '{}\n');
  escreve(path.join(distro, 'home', 'sem', '.claude.json'), conta('Fora')); // sem projects nem sessions: não aparece (limitação)
  escreve(path.join(outra, 'root', '.codex', 'sessions', 'r.jsonl'), '{}\n');
  const deps = { platform: 'win32', ttl: 0, listDistros: async () => [{ name: 'Ubuntu-24.04', state: 'Running' }, { name: 'Debian', state: 'Running' }], uncRoot: n => path.join(base, n) };
  const roots = await wslRoots(deps);
  const amb = ambientesWsl(roots);
  const ordenado = amb.map(a => `${a.distro}|${path.relative(base, a.home)}|${a.claude}|${a.codexSessions ? path.relative(base, a.codexSessions) : ''}`).sort();
  assert.deepStrictEqual(ordenado, [
    `Debian|${path.join('Debian', 'root')}|false|${path.join('Debian', 'root', '.codex', 'sessions')}`,
    `Ubuntu-24.04|${path.join('Ubuntu-24.04', 'home', 'ana')}|true|${path.join('Ubuntu-24.04', 'home', 'ana', '.codex', 'sessions')}`,
  ].sort());
  const ubuntu = amb.find(a => a.distro === 'Ubuntu-24.04');
  assert.strictEqual((await contaClaudeDoHome(ubuntu.home)).organization, 'Org Ubuntu');
});

test('o caminho UNC real rende o nome da distro (4º segmento) e o home', () => {
  const amb = ambientesWsl({
    claude: ['\\\\wsl.localhost\\Ubuntu-24.04\\home\\bruno\\.claude\\projects'],
    codex: ['\\\\wsl.localhost\\Ubuntu-24.04\\home\\bruno\\.codex\\sessions', '\\\\wsl.localhost\\Ubuntu-24.04\\root\\.codex\\sessions'],
  });
  assert.deepStrictEqual(amb.map(a => [a.distro, a.home, a.claude, a.codexSessions]), [
    ['Ubuntu-24.04', '\\\\wsl.localhost\\Ubuntu-24.04\\home\\bruno', true, '\\\\wsl.localhost\\Ubuntu-24.04\\home\\bruno\\.codex\\sessions'],
    ['Ubuntu-24.04', '\\\\wsl.localhost\\Ubuntu-24.04\\root', false, '\\\\wsl.localhost\\Ubuntu-24.04\\root\\.codex\\sessions'],
  ]);
});

test('currentAccount continua devolvendo o mesmo formato de antes (e-mail, nome, organização, papel, plano, nível)', async () => {
  escreve(path.join(HOME_IDE, '.claude.json'), { oauthAccount: { emailAddress: 'voce@exemplo.test', displayName: 'Você', organizationName: 'Empresa Demo', organizationRole: 'admin', userRateLimitTier: 'default_claude_max_5x' } });
  escreve(path.join(HOME_IDE, '.claude', '.credentials.json'), { claudeAiOauth: { subscriptionType: 'max' } });
  const r = await currentAccount('statusline');
  assert.deepStrictEqual(r.account, { email: 'voce@exemplo.test', name: 'Você', organization: 'Empresa Demo', role: 'admin', plan: 'max', tier: 'default_claude_max_5x' });
  assert.strictEqual(r.limits, null); // sem claude-status.json: o resto do retorno também não mudou
});
