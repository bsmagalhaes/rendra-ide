// Máquina de estados do Ctrl+C do terminal (renderer/terminal-keys.js). Regras do dono:
// 1 toque sem outro em 1 s: cola o que está copiado; 2 toques: avisa e espera o terceiro; 3 toques em até 2 s
// desde o primeiro: interrompe (um só \x03 ao programa); sem o terceiro, nada é enviado e o aviso some.
const test = require('node:test');
const assert = require('node:assert');
const { ctrlC, criarCtrlC } = require('../renderer/terminal-keys');

const { novoEstado, tocar, passar, proximoPrazo, ESPERA_COLAR, JANELA } = ctrlC;

// roda uma sequência de [tempo, 'toque'|'passa'] e devolve os efeitos com o tempo em que saíram
function roda(passos) {
  let estado = novoEstado();
  const saida = [];
  for (const [t, acao] of passos) {
    const r = (acao === 'toque' ? tocar : passar)(estado, t);
    estado = r.estado;
    for (const ef of r.efeitos) saida.push([t, ef]);
  }
  return { estado, saida };
}

test('as constantes são 1 s para colar e 2 s de janela', () => {
  assert.strictEqual(ESPERA_COLAR, 1000);
  assert.strictEqual(JANELA, 2000);
});

test('1 toque: nada acontece até 999 ms, a 1000 ms cola e o estado zera', () => {
  let r = roda([[0, 'toque'], [999, 'passa']]);
  assert.deepStrictEqual(r.saida, []);
  assert.strictEqual(proximoPrazo(r.estado, 999), 1);
  r = roda([[0, 'toque'], [1000, 'passa']]);
  assert.deepStrictEqual(r.saida, [[1000, 'colar']]);
  assert.strictEqual(r.estado.toques, 0);
  assert.strictEqual(proximoPrazo(r.estado, 1000), null);
});

test('o programa nunca recebe nada nos dois primeiros toques: nenhum efeito interromper', () => {
  const r = roda([[0, 'toque'], [400, 'toque'], [1500, 'passa'], [2500, 'passa']]);
  assert.ok(!r.saida.some(([, ef]) => ef === 'interromper'));
});

test('2 toques a 400 ms: avisa, cancela a colagem (nem a 1500 ms cola) e a 2000 ms esconde o aviso sem enviar', () => {
  const r = roda([[0, 'toque'], [400, 'toque'], [1000, 'passa'], [1500, 'passa'], [1999, 'passa'], [2000, 'passa']]);
  assert.deepStrictEqual(r.saida, [[400, 'avisar'], [2000, 'esconder-aviso']]);
  assert.strictEqual(r.estado.toques, 0);
});

test('3 toques a 0, 300 e 1900 ms: interrompe uma vez, esconde o aviso, zera', () => {
  const r = roda([[0, 'toque'], [300, 'toque'], [1900, 'toque']]);
  assert.deepStrictEqual(r.saida, [[300, 'avisar'], [1900, 'esconder-aviso'], [1900, 'interromper']]);
  assert.strictEqual(r.saida.filter(([, ef]) => ef === 'interromper').length, 1);
  assert.strictEqual(r.estado.toques, 0);
});

test('o 3º toque a 2000 ms não interrompe: o aviso some e o toque abre um ciclo novo', () => {
  const r = roda([[0, 'toque'], [300, 'toque'], [2000, 'toque']]);
  assert.deepStrictEqual(r.saida, [[300, 'avisar'], [2000, 'esconder-aviso']]);
  assert.strictEqual(r.estado.toques, 1);
  assert.strictEqual(r.estado.t0, 2000);
});

test('2º toque a 1000 ms ou depois: a colagem do 1º já saiu e o 2º começa ciclo novo', () => {
  const r = roda([[0, 'toque'], [1000, 'toque']]);
  assert.deepStrictEqual(r.saida, [[1000, 'colar']]);
  assert.strictEqual(r.estado.toques, 1);
  assert.strictEqual(r.estado.t0, 1000);
});

test('ciclo novo depois de interromper: um toque cola de novo a 1 s', () => {
  const r = roda([[0, 'toque'], [100, 'toque'], [200, 'toque'], [5000, 'toque'], [6000, 'passa']]);
  assert.deepStrictEqual(r.saida.map(([, ef]) => ef), ['avisar', 'esconder-aviso', 'interromper', 'colar']);
});

test('proximoPrazo: 1 s depois do 1º toque, 2 s depois do 1º com o aviso, nulo ocioso', () => {
  assert.strictEqual(proximoPrazo(novoEstado(), 0), null);
  const um = tocar(novoEstado(), 100).estado;
  assert.strictEqual(proximoPrazo(um, 300), 800);
  const dois = tocar(um, 400).estado;
  assert.strictEqual(proximoPrazo(dois, 500), 1600);
  assert.strictEqual(proximoPrazo(dois, 9000), 0);
});

// ── criarCtrlC com relógio e timers do node:test (sem esperar de verdade) ──────────────────────────────────
function montar(mock) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const chamadas = [];
  const c = criarCtrlC({
    aoColar: () => chamadas.push('colar'),
    aoAvisar: () => chamadas.push('avisar'),
    aoEsconder: () => chamadas.push('esconder'),
    aoInterromper: () => chamadas.push('interromper'),
  });
  return { c, chamadas };
}

test('criarCtrlC: 1 toque cola sozinho depois de 1 s, uma vez', t => {
  const { c, chamadas } = montar(t.mock);
  c.tocar();
  t.mock.timers.tick(999);
  assert.deepStrictEqual(chamadas, []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(chamadas, ['colar']);
  t.mock.timers.tick(5000);
  assert.deepStrictEqual(chamadas, ['colar']);
});

test('criarCtrlC: 2 toques avisam, não colam e o aviso some aos 2 s sem interromper', t => {
  const { c, chamadas } = montar(t.mock);
  c.tocar();
  t.mock.timers.tick(400);
  c.tocar();
  assert.deepStrictEqual(chamadas, ['avisar']);
  t.mock.timers.tick(1500);
  assert.deepStrictEqual(chamadas, ['avisar']);
  t.mock.timers.tick(100);
  assert.deepStrictEqual(chamadas, ['avisar', 'esconder']);
  t.mock.timers.tick(5000);
  assert.deepStrictEqual(chamadas, ['avisar', 'esconder']);
});

test('criarCtrlC: 3 toques em menos de 2 s interrompem uma vez, na ordem esconder e interromper', t => {
  const { c, chamadas } = montar(t.mock);
  c.tocar();
  t.mock.timers.tick(300);
  c.tocar();
  t.mock.timers.tick(1600);
  c.tocar();
  assert.deepStrictEqual(chamadas, ['avisar', 'esconder', 'interromper']);
  t.mock.timers.tick(5000);
  assert.deepStrictEqual(chamadas, ['avisar', 'esconder', 'interromper']);
});

test('criarCtrlC: cancelar entre o 1º toque e 1 s não cola nada (terminal fechado)', t => {
  const { c, chamadas } = montar(t.mock);
  c.tocar();
  t.mock.timers.tick(500);
  c.cancelar();
  t.mock.timers.tick(5000);
  assert.deepStrictEqual(chamadas, []);
});

test('criarCtrlC: cancelar com o aviso na tela não envia nada e não deixa timer pendente', t => {
  const { c, chamadas } = montar(t.mock);
  c.tocar();
  t.mock.timers.tick(100);
  c.tocar();
  c.cancelar();
  t.mock.timers.tick(5000);
  assert.deepStrictEqual(chamadas, ['avisar']);
});

test('criarCtrlC: depois de cancelar, um toque começa ciclo novo', t => {
  const { c, chamadas } = montar(t.mock);
  c.tocar();
  c.cancelar();
  c.tocar();
  t.mock.timers.tick(1000);
  assert.deepStrictEqual(chamadas, ['colar']);
});

// ── guarda da colagem agendada ──────────────────────────────────────────────────────────────────────────
const { podeColarDeCtrlC } = require('../renderer/terminal-keys');

test('podeColarDeCtrlC: só com o terminal vivo, sem painel e sem modal aberto', () => {
  assert.strictEqual(podeColarDeCtrlC({ vivo: true, painel: false, modalAberto: false }), true);
  assert.strictEqual(podeColarDeCtrlC({ vivo: true, painel: false, modalAberto: true }), false);
  assert.strictEqual(podeColarDeCtrlC({ vivo: true, painel: true, modalAberto: false }), false);
  assert.strictEqual(podeColarDeCtrlC({ vivo: false, painel: false, modalAberto: false }), false);
});

test('1 toque e um modal abre dentro do segundo: ao colar o estado é consultado de novo e nada é colado', () => {
  let modal = false, timer = null, colou = 0, t = 0;
  const c = criarCtrlC({
    agora: () => t,
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; },
    aoColar: () => { if (podeColarDeCtrlC({ vivo: true, painel: false, modalAberto: modal })) colou++; },
  });
  c.tocar();
  modal = true; // o overlay "Abrir link?" abriu
  t = 1000; timer();
  assert.strictEqual(colou, 0);
  // sem modal o mesmo caminho cola
  modal = false; t = 5000;
  c.tocar();
  t = 6000; timer();
  assert.strictEqual(colou, 1);
});
