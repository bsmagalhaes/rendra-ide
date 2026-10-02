// Soma por agente entre ambientes (puro; dados fictícios)
const test = require('node:test');
const assert = require('node:assert');
const A = require('../renderer/rtk-agents');

const g = (saved, input, commands, daily = [], timeMs = 0) => ({
  summary: { total_commands: commands, total_input: input, total_output: input - saved, total_saved: saved, avg_savings_pct: 99, total_time_ms: timeMs, avg_time_ms: 0 },
  daily: daily.map(([date, s, c]) => ({ date, saved_tokens: s, commands: c })),
});
const env = (id, label, claude, codex, state = 'ok') => ({ id, label, state, agents: state === 'ok' ? { claude: { gain: claude, error: null }, codex: { gain: codex, error: null } } : {} });
const zero = () => g(0, 0, 0);

test('soma dois ambientes por agente; Claude e Codex nunca se misturam', () => {
  const r = A.aggregateAgents([
    env('host', 'Windows', g(1000, 2000, 10), g(100, 400, 2)),
    env('Ubuntu', 'Ubuntu-24.04', g(500, 1000, 5), g(50, 100, 1)),
  ]);
  assert.strictEqual(r.claude.total.saved, 1500);
  assert.strictEqual(r.claude.total.commands, 15);
  assert.strictEqual(r.codex.total.saved, 150);
  assert.strictEqual(r.codex.total.commands, 3);
  assert.strictEqual(r.claude.total.input, 3000);
});

test('pct é ponderado (saved/input), não a média simples dos ambientes', () => {
  // ambiente 1: 90% de 100; ambiente 2: 10% de 10.000. Média simples 50%; ponderado ~10,8%
  const r = A.aggregateAgents([
    env('a', 'A', g(90, 100, 1), zero()),
    env('b', 'B', g(1000, 10000, 1), zero()),
  ]);
  assert.ok(Math.abs(r.claude.total.pct - (1090 / 10100) * 100) < 1e-9);
  assert.ok(Math.abs(r.claude.total.pct - 50) > 30, 'não é a média de 90 e 10');
});

test('avgTimeMs = tempo total / comandos', () => {
  const r = A.aggregateAgents([env('a', 'A', g(10, 20, 4, [], 100), zero()), env('b', 'B', g(10, 20, 6, [], 300), zero())]);
  assert.strictEqual(r.claude.total.timeMs, 400);
  assert.strictEqual(r.claude.total.avgTimeMs, 40);
});

test('daily: união das datas com soma, mesmo com buraco, em ordem', () => {
  const r = A.aggregateAgents([
    env('a', 'A', g(30, 60, 3, [['2026-10-01', 10, 1], ['2026-10-03', 20, 2]]), zero()),
    env('b', 'B', g(5, 10, 1, [['2026-10-02', 5, 1], ['2026-10-03', 7, 1]]), zero()),
  ]);
  assert.deepStrictEqual(r.claude.daily, [
    { date: '2026-10-01', saved: 10, commands: 1 },
    { date: '2026-10-02', saved: 5, commands: 1 },
    { date: '2026-10-03', saved: 27, commands: 3 },
  ]);
});

test('distro desligada aparece no hover e não altera o total', () => {
  const r = A.aggregateAgents([
    env('host', 'Windows', g(1234, 2468, 56), zero()),
    env('Ubuntu-24.04', 'Ubuntu-24.04', null, null, 'wsl-off'),
    env('Debian', 'Debian', null, null, 'missing'),
  ]);
  assert.strictEqual(r.claude.total.saved, 1234);
  assert.deepStrictEqual(A.tooltipLines(r.claude), [
    'Windows: 1.234 tokens, 56 comandos',
    'Ubuntu-24.04: WSL desligado',
    'Debian: RTK ausente',
  ]);
});

test('agente sem dados vira zeros, não NaN', () => {
  const r = A.aggregateAgents([env('host', 'Windows', g(10, 20, 1), { summary: {}, daily: [] })]);
  assert.deepStrictEqual(r.codex.total, { commands: 0, input: 0, output: 0, saved: 0, pct: 0, timeMs: 0, avgTimeMs: 0 });
  assert.strictEqual(A.aggregateAgents([]).claude.total.saved, 0);
});

test('erro de leitura do agente num ambiente não soma e aparece no hover', () => {
  const e = env('host', 'Windows', g(10, 20, 1), zero());
  e.agents.codex.error = 'JSON inválido';
  const r = A.aggregateAgents([e]);
  assert.strictEqual(r.codex.total.saved, 0);
  assert.deepStrictEqual(A.tooltipLines(r.codex), ['Windows: erro ao ler']);
  assert.deepStrictEqual(A.tooltipLines(r.claude), ['Windows: 10 tokens, 1 comandos']);
});

test('combinedTotals soma os dois agentes e recalcula o pct', () => {
  const r = A.aggregateAgents([env('host', 'W', g(100, 200, 4), g(50, 400, 2))]);
  const c = A.combinedTotals(r);
  assert.strictEqual(c.saved, 150);
  assert.strictEqual(c.commands, 6);
  assert.strictEqual(c.input, 600);
  assert.strictEqual(c.pct, 25);
});

test('chartSeries: união das datas, 0 onde o agente não tem o dia', () => {
  const r = A.aggregateAgents([env('host', 'W', g(30, 60, 2, [['2026-10-01', 10, 1], ['2026-10-02', 20, 1]]), g(7, 14, 1, [['2026-10-02', 7, 1], ['2026-10-04', 0, 0]]))]);
  const s = A.chartSeries(r);
  assert.deepStrictEqual(s.labels, ['2026-10-01', '2026-10-02', '2026-10-04']);
  assert.deepStrictEqual(s.claude, [10, 20, 0]);
  assert.deepStrictEqual(s.codex, [0, 7, 0]);
});

test('números em pt-BR com ponto de milhar', () => {
  assert.strictEqual(A.fmtInt(1234567), '1.234.567');
  assert.strictEqual(A.fmtInt(999), '999');
});
