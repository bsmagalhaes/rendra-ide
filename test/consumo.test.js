// Barra de consumo do Claude Code na barra de título: nível de cor, percentual, dado antigo e tooltip.
// Dados literais e fictícios: nenhum teste lê a pasta ou os arquivos reais do usuário.
const test = require('node:test');
const assert = require('node:assert');
const { nivelDe, formatarPercentual, estadoConsumo } = require('../renderer/consumo');

const AGORA = Date.UTC(2026, 8, 30, 12, 0, 0);
const MIN = 60 * 1000;
const RESET = AGORA + 3 * 3600 * 1000;
const CONTA = { organization: 'Empresa Demo', name: 'Ana Demo', email: 'ana@exemplo.test' };
const deps = { conta: CONTA, plano: 'Max 5x', ambiente: 'Windows', fmtResetIn: ts => (ts ? `Reinicia em ${ts}` : ''), fmtHora: () => '09:30' };
const limites = (session, weekly) => [
  { kind: 'session', percent: session, resetsAt: RESET },
  { kind: 'weekly_all', percent: weekly, resetsAt: RESET + 1000 },
];
const res = (session, weekly, fetchedAt = AGORA - MIN) => ({ limits: limites(session, weekly), fetchedAt, error: null });

test('sem conta e sem dado nenhum a barra fica escondida (sem Claude Code, conta sem plano, ponte não instalada)', () => {
  const casos = [
    { limits: null, error: 'Ative a leitura de limites para ver os limites do seu plano', needsBridge: true },
    { limits: null, error: 'Aguardando o Claude Code: os limites aparecem assim que uma sessão do Claude Code atualizar a statusline' },
    undefined,
    null,
    { limits: [], fetchedAt: AGORA },
    { limits: [{ kind: 'spend', percent: 50, label: 'Limite de gasto' }], fetchedAt: AGORA },
  ];
  for (const c of casos) {
    const e = estadoConsumo(c, AGORA, { ...deps, conta: null }); // sem conta e sem limites a barra some (com conta, ver "conta sem limites")
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
  assert.strictEqual(estadoConsumo(res(NaN, 'abc'), AGORA, { ...deps, conta: null }).visivel, false);
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

test('tooltip: conta e plano, o e-mail inteiro, o ambiente, depois o reinício de cada limite, uma linha cada', () => {
  const e = estadoConsumo(res(42, 27), AGORA, deps);
  assert.strictEqual(e.tooltip, ['Empresa Demo · Max 5x', 'ana@exemplo.test', 'Ambiente: Windows', `5 Horas: Reinicia em ${RESET}`, `Semanal: Reinicia em ${RESET + 1000}`].join('\n'));
});

test('tooltip: sem plano, sem e-mail ou sem ambiente a linha some; sem reinício a linha do limite some', () => {
  const semPlano = estadoConsumo(res(42, 27), AGORA, { ...deps, plano: '' });
  assert.strictEqual(semPlano.tooltip.split('\n')[0], 'Empresa Demo');
  const soEmail = estadoConsumo(res(42, 27), AGORA, { ...deps, conta: { email: 'ana@exemplo.test' }, plano: '', ambiente: '' });
  assert.strictEqual(soEmail.tooltip.split('\n').slice(0, 2).join('|'), `ana@exemplo.test|5 Horas: Reinicia em ${RESET}`);
  assert.ok(!/undefined|null/.test(soEmail.tooltip));
  const semReset = estadoConsumo({ limits: [{ kind: 'session', percent: 42 }, { kind: 'weekly_all', percent: 27, resetsAt: RESET }], fetchedAt: AGORA }, AGORA, deps);
  assert.strictEqual(semReset.tooltip, ['Empresa Demo · Max 5x', 'ana@exemplo.test', 'Ambiente: Windows', `Semanal: Reinicia em ${RESET}`].join('\n'));
});

test('o tooltip carrega o e-mail completo da conta (a regra antiga de nunca mostrar o e-mail foi revogada de propósito)', () => {
  const e = estadoConsumo(res(42, 27), AGORA, deps);
  assert.ok(e.tooltip.includes('ana@exemplo.test'), e.tooltip);
  assert.strictEqual(e.email, 'ana@exemplo.test');
});

test('nome exibido: a organização; sem organização, o nome da pessoa; sem os dois, vazio', () => {
  assert.strictEqual(estadoConsumo(res(1, 1), AGORA, deps).nome, 'Empresa Demo');
  assert.strictEqual(estadoConsumo(res(1, 1), AGORA, { ...deps, conta: { name: 'Ana Demo', email: 'a@b.c' } }).nome, 'Ana Demo');
  assert.strictEqual(estadoConsumo(res(1, 1), AGORA, { ...deps, conta: { email: 'a@b.c' } }).nome, '');
  assert.strictEqual(estadoConsumo(res(1, 1), AGORA, { ...deps, conta: null }).email, '');
});

test('Codex só com o semanal mostra um item; o de 5 horas fica oculto', () => {
  const e = estadoConsumo({ limits: [{ kind: 'weekly_all', percent: 9, resetsAt: RESET }], fetchedAt: AGORA - MIN }, AGORA, { ...deps, provedor: 'codex', ambiente: 'Ubuntu-24.04' });
  assert.deepStrictEqual(e.itens.map(i => i.rotulo), ['Semanal']);
  assert.strictEqual(e.ariaGrupo, 'Consumo do plano do Codex');
  assert.strictEqual(e.provedor, 'codex');
  assert.ok(e.tooltip.includes('Ambiente: Ubuntu-24.04'));
});

test('o aria-label do grupo segue o provedor', () => {
  assert.strictEqual(estadoConsumo(res(1, 1), AGORA, deps).ariaGrupo, 'Consumo do plano do Claude Code');
  assert.strictEqual(estadoConsumo(res(1, 1), AGORA, { ...deps, provedor: 'codex' }).ariaGrupo, 'Consumo do plano do Codex');
});

test('dado de 16 minutos fica cinza para o Claude e para o Codex (mesma regra de 15 minutos)', () => {
  const velho = AGORA - 16 * MIN;
  for (const provedor of ['claude', 'codex']) {
    const e = estadoConsumo({ limits: [{ kind: 'weekly_all', percent: 40, resetsAt: RESET }], fetchedAt: velho }, AGORA, { ...deps, provedor });
    assert.strictEqual(e.itens[0].classe, 'stale', provedor);
    assert.ok(e.tooltip.includes('Dado antigo, lido às 09:30'), e.tooltip);
  }
});

test('conta sem limites: a barra fica visível com a conta e semDados; sem conta e sem limites, some', () => {
  for (const r of [null, undefined, { limits: null, error: 'x' }, { limits: [] }]) {
    const e = estadoConsumo(r, AGORA, deps);
    assert.strictEqual(e.visivel, true);
    assert.strictEqual(e.semDados, true);
    assert.deepStrictEqual(e.itens, []);
    assert.strictEqual(e.nome, 'Empresa Demo');
    assert.ok(e.tooltip.includes('ana@exemplo.test') && e.tooltip.includes('Sem dados de limite'), e.tooltip);
    assert.ok(!/Dado antigo/.test(e.tooltip));
    assert.strictEqual(estadoConsumo(r, AGORA, { ...deps, conta: null }).visivel, false);
  }
  assert.strictEqual(estadoConsumo({ limits: [{ kind: 'spend', percent: 5 }] }, AGORA, { ...deps, conta: {} }).visivel, false);
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

// ── Seletor de provedor + ambiente ──────────────────────────────────────────
const { opcoesSeletor } = require('../renderer/consumo');
const conta = org => ({ organization: org, name: 'Ana', email: 'ana@exemplo.test' });
const entrada = (id, provedor, ambiente, c = conta('Org'), limits = null) => ({ id, provedor, ambiente, conta: c, limits });
const CWIN = entrada('claude:local', 'claude', 'Windows');
const CUBU = entrada('claude:wsl:Ubuntu-24.04', 'claude', 'Ubuntu-24.04');
const XUBU = entrada('codex:wsl:Ubuntu-24.04', 'codex', 'Ubuntu-24.04');
const XWIN = entrada('codex:local', 'codex', 'Windows');

test('seletor: só o Claude do Windows gera uma opção e o seletor não aparece', () => {
  const r = opcoesSeletor([CWIN], null);
  assert.deepStrictEqual(r.opcoes.map(o => o.rotulo), ['Claude (Windows)']);
  assert.strictEqual(r.mostrarSeletor, false);
  assert.strictEqual(r.selecionada, 'claude:local');
});

test('seletor: três combinações geram os rótulos exatos, em ordem estável, com rótulo compacto e ambiente no tooltip', () => {
  const embaralhado = [XUBU, CUBU, CWIN];
  const r = opcoesSeletor(embaralhado, null);
  assert.deepStrictEqual(r.opcoes.map(o => o.rotulo), ['Claude (Windows)', 'Claude (Ubuntu-24.04)', 'Codex (Ubuntu-24.04)']);
  assert.deepStrictEqual(r.opcoes.map(o => o.rotuloCompacto), ['Claude', 'Claude', 'Codex']);
  assert.deepStrictEqual(r.opcoes.map(o => o.tooltipAmbiente), ['Claude (Windows)', 'Claude (Ubuntu-24.04)', 'Codex (Ubuntu-24.04)']);
  assert.deepStrictEqual(r.opcoes.map(o => o.id), ['claude:local', 'claude:wsl:Ubuntu-24.04', 'codex:wsl:Ubuntu-24.04']);
  assert.strictEqual(r.mostrarSeletor, true);
  assert.deepStrictEqual(opcoesSeletor([XUBU, XWIN, CWIN, CUBU], null).opcoes.map(o => o.id),
    ['claude:local', 'claude:wsl:Ubuntu-24.04', 'codex:local', 'codex:wsl:Ubuntu-24.04'], 'local antes das distros, Claude antes do Codex');
});

test('seletor: o id da opção não depende do rótulo', () => {
  const r = opcoesSeletor([entrada('claude:local', 'claude', 'macOS')], null);
  assert.strictEqual(r.opcoes[0].rotulo, 'Claude (macOS)');
  assert.strictEqual(r.opcoes[0].id, 'claude:local');
});

test('seletor: a escolha lembrada vale se ainda existe; se não existe, cai no Claude local', () => {
  assert.strictEqual(opcoesSeletor([CWIN, XUBU], 'codex:wsl:Ubuntu-24.04').selecionada, 'codex:wsl:Ubuntu-24.04');
  assert.strictEqual(opcoesSeletor([CWIN, XUBU], 'codex:wsl:Sumiu').selecionada, 'claude:local');
});

test('seletor: sem Claude local e sem lembrada cai na primeira opção; sem opções, null', () => {
  assert.strictEqual(opcoesSeletor([XUBU, CUBU], null).selecionada, 'claude:wsl:Ubuntu-24.04');
  const vazio = opcoesSeletor([], 'claude:local');
  assert.strictEqual(vazio.selecionada, null);
  assert.deepStrictEqual(vazio.opcoes, []);
  assert.strictEqual(vazio.mostrarSeletor, false);
});

test('seletor: ambiente sem conta e sem limites não aparece; com limites e sem conta aparece (modo api, sem login)', () => {
  const semNada = entrada('codex:local', 'codex', 'Windows', null, null);
  assert.deepStrictEqual(opcoesSeletor([CWIN, semNada], null).opcoes.map(o => o.id), ['claude:local']);
  const soLimites = entrada('claude:local', 'claude', 'Windows', null, [{ kind: 'session', percent: 42 }]);
  assert.deepStrictEqual(opcoesSeletor([soLimites], null).opcoes.map(o => o.id), ['claude:local']);
  assert.deepStrictEqual(opcoesSeletor([entrada('claude:local', 'claude', 'Windows', null, [])], null).opcoes, []);
});

test('seletor: opção lembrada some numa rodada (queda do ambiente) e volta na seguinte: a escolha não é perdida', () => {
  const lembrada = 'codex:wsl:Ubuntu-24.04';
  assert.strictEqual(opcoesSeletor([CWIN, XUBU], lembrada).selecionada, lembrada);
  assert.strictEqual(opcoesSeletor([CWIN], lembrada).selecionada, 'claude:local', 'ambiente fora: usa o padrão');
  assert.strictEqual(opcoesSeletor([CWIN, XUBU], lembrada).selecionada, lembrada, 'ambiente de volta: a mesma lembrada vale de novo');
});
