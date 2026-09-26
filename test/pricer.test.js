// Costs are tokens × price per 1M tokens, taken from the bundled pricing.json
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const pricer = require('../src/pricer');
const table = require('../pricing.json');

pricer.setPricingFile(path.join(__dirname, 'nao-existe.json')); // bundled table only
const M = 1_000_000;
const price = model => table.claude.find(p => p.pattern === model);

test('Claude: entrada, saída, leitura e escrita de cache de 5 min e de 1 h', () => {
  const p = price('claude-opus-5-5');
  const cost = pricer.calcClaudeRecordCost({
    model: 'claude-opus-5-5', inputTokens: M, outputTokens: M, cacheReadTokens: M,
    cacheWriteTokens: 2 * M, cacheWrite1hTokens: M,
  });
  assert.ok(Math.abs(cost - (p.input + p.output + p.cacheRead + p.cacheWrite + p.cacheWrite1h)) < 1e-9);
});

test('Claude: modo rápido usa o preço rápido', () => {
  const p = price('claude-opus-5-5');
  const cost = pricer.calcClaudeRecordCost({ model: 'claude-opus-5-5', inputTokens: M, outputTokens: M, fast: true });
  assert.ok(Math.abs(cost - (p.fastInput + p.fastOutput)) < 1e-9);
});

test('Claude: o padrão mais longo vence (sonnet-5 não cai no default)', () => {
  const cost = pricer.calcClaudeRecordCost({ model: 'claude-sonnet-5-20260101', inputTokens: M, outputTokens: 0 });
  assert.strictEqual(cost, price('claude-sonnet-5').input);
});

test('Claude: buscas web cobradas por 1.000', () => {
  const base = pricer.calcClaudeRecordCost({ model: 'claude-sonnet-5', inputTokens: 0, outputTokens: 0 });
  const withSearch = pricer.calcClaudeRecordCost({ model: 'claude-sonnet-5', inputTokens: 0, outputTokens: 0, webSearches: 1000 });
  assert.strictEqual(withSearch - base, table.webSearchPer1k);
});
