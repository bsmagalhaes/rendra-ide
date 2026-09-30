// A barra de consumo relê só o arquivo da statusline (statuslineLimits): nunca passa por
// currentAccount, que lê credenciais e, no macOS, roda o processo `security` do Keychain.
// Home falso em pasta temporária (RENDRA_HOME) fixado antes do require; nada do usuário é lido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-limits-'));
process.env.RENDRA_HOME = HOME;
Object.defineProperty(process, 'platform', { value: 'darwin' }); // o caminho do Keychain só existe no macOS

let chamadasKeychain = 0;
childProcess.execFileSync = () => { chamadasKeychain++; throw new Error('sem Keychain no teste'); };

const { statuslineLimits, currentAccount } = require('../src/accounts');

const ARQUIVO = path.join(HOME, '.rendra-ide', 'claude-status.json');
const escreverStatus = json => { fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true }); fs.writeFileSync(ARQUIVO, JSON.stringify(json)); };
const apagarStatus = () => fs.rmSync(ARQUIVO, { force: true });

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

test('sem claude-status.json não há limites e a ponte é pedida', () => {
  apagarStatus();
  const r = statuslineLimits();
  assert.strictEqual(r.limits, null);
  assert.strictEqual(r.needsBridge, true);
});

test('arquivo sem rate_limits (conta sem plano) não devolve limites', () => {
  escreverStatus({ model: { display_name: 'Demo' } });
  assert.strictEqual(statuslineLimits().limits, null);
});

test('com rate_limits devolve 5 horas e semanal, e fetchedAt é o mtime do arquivo', () => {
  escreverStatus({ rate_limits: {
    five_hour: { used_percentage: 42, resets_at: 1790000000 },
    seven_day: { used_percentage: 27, resets_at: 1790500000 },
  } });
  const mtime = fs.statSync(ARQUIVO).mtimeMs;
  const r = statuslineLimits();
  assert.deepStrictEqual(r.limits.map(l => [l.kind, l.percent]), [['session', 42], ['weekly_all', 27]]);
  assert.strictEqual(r.limits[0].resetsAt, 1790000000 * 1000);
  assert.strictEqual(r.fetchedAt, mtime);
});

test('ler a statusline nunca toca o Keychain; só a leitura da conta toca', async () => {
  escreverStatus({ rate_limits: { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 20 } } });
  for (let i = 0; i < 5; i++) statuslineLimits();
  assert.strictEqual(chamadasKeychain, 0, 'statuslineLimits não pode chamar o processo security');
  const r = await currentAccount('statusline');
  assert.strictEqual(chamadasKeychain, 1, 'currentAccount lê as credenciais (e o espião prova que enxerga a chamada)');
  assert.strictEqual(r.limits.length, 2);
});
