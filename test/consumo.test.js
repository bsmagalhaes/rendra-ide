// Barra de consumo do Claude Code na barra de título: nível de cor, percentual, dado antigo e tooltip.
// Dados literais e fictícios: nenhum teste lê a pasta ou os arquivos reais do usuário.
const test = require('node:test');
const assert = require('node:assert');
const { nivelDe, formatarPercentual, estadoConsumo } = require('../renderer/consumo');

const AGORA = Date.UTC(2026, 8, 30, 12, 0, 0);
const MIN = 60 * 1000;
const RESET = AGORA + 3 * 3600 * 1000;
const deps = { conta: 'Empresa Demo', plano: 'Max 5x', fmtResetIn: ts => (ts ? `Reinicia em ${ts}` : ''), fmtHora: () => '09:30' };
const limites = (session, weekly) => [
  { kind: 'session', percent: session, resetsAt: RESET },
  { kind: 'weekly_all', percent: weekly, resetsAt: RESET + 1000 },
];
const res = (session, weekly, fetchedAt = AGORA - MIN) => ({ limits: limites(session, weekly), fetchedAt, error: null });

test('sem dado nenhum a barra fica escondida (sem Claude Code, conta sem plano, ponte não instalada)', () => {
  const casos = [
    { limits: null, error: 'Ative a leitura de limites para ver os limites do seu plano', needsBridge: true },
    { limits: null, error: 'Aguardando o Claude Code: os limites aparecem assim que uma sessão do Claude Code atualizar a statusline' },
    undefined,
    null,
    { limits: [], fetchedAt: AGORA },
    { limits: [{ kind: 'spend', percent: 50, label: 'Limite de gasto' }], fetchedAt: AGORA },
  ];
  for (const c of casos) {
    const e = estadoConsumo(c, AGORA, deps);
    assert.strictEqual(e.visivel, false);
    assert.deepStrictEqual(e.itens, []);
  }
});

test('leitura normal: dois itens na ordem 5 Horas, Semanal, com texto e rótulos de acessibilidade', () => {
  const e = estadoConsumo(res(42, 27), AGORA, deps);
  assert.strictEqual(e.visivel, true);
  assert.ok(!('velho' in e), 'sem campo morto velho');
  assert.ok(e.itens.every(i => i.classe !== 'stale'));
  assert.deepStrictEqual(e.itens.map(i => i.rotulo), ['5 Horas', 'Semanal']);
  assert.deepStrictEqual(e.itens.map(i => i.texto), ['42%', '27%']);
  assert.deepStrictEqual(e.itens.map(i => i.percent), [42, 27]);
  assert.deepStrictEqual(e.itens.map(i => i.classe), ['ok', 'ok']);
  assert.deepStrictEqual(e.itens.map(i => i.ariaRotulo), ['Limite de 5 horas', 'Limite semanal']);
  assert.deepStrictEqual(e.itens.map(i => i.ariaTexto), ['42%', '27%']);
});

test('limiares de cor: 70 laranja, 90 vermelho', () => {
  const tabela = [[0, 'ok'], [69, 'ok'], [70, 'warn'], [89, 'warn'], [90, 'danger'], [100, 'danger']];
  for (const [p, nivel] of tabela) {
    assert.strictEqual(nivelDe(p), nivel, `nivelDe(${p})`);
    assert.strictEqual(estadoConsumo(res(p, 10), AGORA, deps).itens[0].classe, nivel, `classe do item com ${p}`);
  }
});

test('percentual fora de 0..100 é limitado e valor não numérico descarta o item', () => {
  assert.strictEqual(formatarPercentual(150), '100%');
  assert.strictEqual(formatarPercentual(-5), '0%');
  assert.strictEqual(formatarPercentual(41.6), '42%');
  const alto = estadoConsumo(res(150, -5), AGORA, deps);
  assert.deepStrictEqual(alto.itens.map(i => i.texto), ['100%', '0%']);
  assert.deepStrictEqual(alto.itens.map(i => i.percent), [100, 0]);
  const nan = estadoConsumo(res(NaN, 20), AGORA, deps);
  assert.deepStrictEqual(nan.itens.map(i => i.rotulo), ['Semanal']);
  const texto = estadoConsumo(res('abc', 20), AGORA, deps);
  assert.deepStrictEqual(texto.itens.map(i => i.rotulo), ['Semanal']);
  assert.strictEqual(estadoConsumo(res(NaN, 'abc'), AGORA, deps).visivel, false);
});

test('dado antigo: mais de 15 minutos fica em cinza e o tooltip diz a hora da leitura', () => {
  const limite = estadoConsumo(res(95, 80, AGORA - 15 * MIN), AGORA, deps);
  assert.ok(limite.itens.every(i => i.classe !== 'stale'));
  assert.deepStrictEqual(limite.itens.map(i => i.classe), ['danger', 'warn']);

  const velho = estadoConsumo(res(95, 80, AGORA - (15 * MIN + 1000)), AGORA, deps);
    assert.deepStrictEqual(velho.itens.map(i => i.classe), ['stale', 'stale']);
  assert.ok(velho.tooltip.includes('lido às 09:30'), velho.tooltip);
  assert.ok(velho.itens[0].ariaTexto.endsWith(', lido às 09:30'), velho.itens[0].ariaTexto);
  assert.strictEqual(velho.itens[0].texto, '95%');
});

test('sem prova de frescor (fetchedAt ausente ou inválido) conta como dado antigo', () => {
  for (const f of [null, undefined, NaN, 'ontem']) {
    const e = estadoConsumo({ limits: limites(10, 10), fetchedAt: f }, AGORA, deps);
        assert.deepStrictEqual(e.itens.map(i => i.classe), ['stale', 'stale']);
    assert.ok(!/undefined|NaN|null/.test(e.tooltip), e.tooltip);
  }
});

test('tooltip: conta e plano, depois o reinício de cada limite, uma linha cada', () => {
  const e = estadoConsumo(res(42, 27), AGORA, deps);
  assert.strictEqual(e.tooltip, ['Empresa Demo · Max 5x', `5 Horas: Reinicia em ${RESET}`, `Semanal: Reinicia em ${RESET + 1000}`].join('\n'));
});

test('tooltip: sem conta nem plano a primeira linha some; sem reinício a linha do limite some', () => {
  const semConta = estadoConsumo(res(42, 27), AGORA, { ...deps, conta: '', plano: '' });
  assert.strictEqual(semConta.tooltip.split('\n')[0], `5 Horas: Reinicia em ${RESET}`);
  assert.ok(!/undefined/.test(semConta.tooltip));
  const soPlano = estadoConsumo(res(42, 27), AGORA, { ...deps, conta: '' });
  assert.strictEqual(soPlano.tooltip.split('\n')[0], 'Max 5x');
  const semReset = estadoConsumo({ limits: [{ kind: 'session', percent: 42 }, { kind: 'weekly_all', percent: 27, resetsAt: RESET }], fetchedAt: AGORA }, AGORA, deps);
  assert.strictEqual(semReset.tooltip, ['Empresa Demo · Max 5x', `Semanal: Reinicia em ${RESET}`].join('\n'));
});

test('o tooltip nunca carrega o e-mail: só existe o que o chamador passa em conta e plano', () => {
  const e = estadoConsumo(res(42, 27), AGORA, { ...deps, conta: 'Empresa Demo' });
  assert.ok(!e.tooltip.includes('@'));
});

test('só um dos dois limites: mostra só o presente', () => {
  const soSessao = estadoConsumo({ limits: [{ kind: 'session', percent: 30, resetsAt: RESET }], fetchedAt: AGORA }, AGORA, deps);
  assert.deepStrictEqual(soSessao.itens.map(i => i.rotulo), ['5 Horas']);
  const soSemana = estadoConsumo({ limits: [{ kind: 'weekly_all', percent: 60 }], fetchedAt: AGORA }, AGORA, deps);
  assert.deepStrictEqual(soSemana.itens.map(i => i.rotulo), ['Semanal']);
  assert.strictEqual(soSemana.visivel, true);
});

test('só o primeiro de cada tipo conta; limite por modelo e gasto ficam de fora', () => {
  const e = estadoConsumo({
    limits: [
      { kind: 'session', percent: 10 }, { kind: 'session', percent: 99 },
      { kind: 'weekly_scoped', model: 'Opus', percent: 80 }, { kind: 'spend', percent: 50 },
      { kind: 'weekly_all', percent: 20 },
    ],
    fetchedAt: AGORA,
  }, AGORA, deps);
  assert.deepStrictEqual(e.itens.map(i => i.texto), ['10%', '20%']);
});
