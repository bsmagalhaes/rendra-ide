// Listagem das conversas do Codex por pasta: sandbox temporário e rollouts fictícios, nada real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listarCodex, _limpaCache } = require('../src/sessoes-codex');

const uuid = n => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const linha = o => JSON.stringify(o) + '\n';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-codex-'));
  _limpaCache();
  return { dir, sessions: path.join(dir, '.codex', 'sessions'), home: path.join(dir, '.codex'), limpa: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// rollout fictício com a primeira linha session_meta (F20)
function rollout(sb, n, { cwd = '/mnt/d/SOEs/X', dia = '2026/10/03', hora = '10-00-00', ts, idMeta, payloadExtra = {}, nomeId, mtime } = {}) {
  const id = uuid(n);
  const iso = `${dia.replace(/\//g, '-')}T${hora}`;
  const payload = { id: idMeta ?? id, cwd, timestamp: ts ?? `${iso.slice(0, 10)}T${hora.replace(/-/g, ':')}.000Z`, originator: 'codex_cli', cli_version: '0.157.1', source: 'cli', ...payloadExtra };
  const f = path.join(sb.sessions, ...dia.split('/'), `rollout-${iso}-${nomeId ?? id}.jsonl`);
  escreve(f, linha({ timestamp: payload.timestamp, type: 'session_meta', payload }) + linha({ type: 'event_msg', payload: { type: 'user_message' } }));
  if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return { id, f };
}

const CWD = '/mnt/d/SOEs/X';
const lista = (sb, extra = {}) => listarCodex({ cwd: CWD, raizes: [{ sessions: sb.sessions }], ...extra });

test('só os rollouts do cwd pedido, da mais nova para a mais antiga, com os campos fixos', async () => {
  const sb = sandbox();
  try {
    rollout(sb, 1, { hora: '08-00-00' });
    rollout(sb, 2, { hora: '12-00-00' });
    rollout(sb, 3, { dia: '2026/10/02', hora: '09-00-00' });
    rollout(sb, 4, { cwd: '/mnt/d/SOEs/Outro' });
    const r = await lista(sb);
    assert.deepStrictEqual(r.itens.map(s => s.id), [uuid(2), uuid(1), uuid(3)]);
    assert.strictEqual(r.total, 3);
    assert.deepStrictEqual(Object.keys(r.itens[0]).sort(), ['id', 'provedor', 'quando', 'titulo']);
    assert.strictEqual(r.itens[0].provedor, 'codex');
    assert.strictEqual(r.itens[0].quando, Date.parse('2026-10-03T12:00:00.000Z'));
  } finally { sb.limpa(); }
});

test('/mnt/d/SOEs/X e /mnt/d/soes/x são a mesma pasta; Linux nativo diferencia caixa', async () => {
  const sb = sandbox();
  try {
    rollout(sb, 1, { cwd: '/mnt/d/soes/x' });
    rollout(sb, 2, { cwd: '/home/u/Pasta' });
    assert.deepStrictEqual((await lista(sb)).itens.map(s => s.id), [uuid(1)]);
    assert.deepStrictEqual((await listarCodex({ cwd: '/home/u/pasta', raizes: [{ sessions: sb.sessions }] })).itens, []);
    assert.deepStrictEqual((await listarCodex({ cwd: '/home/u/Pasta', raizes: [{ sessions: sb.sessions }] })).itens.map(s => s.id), [uuid(2)]);
  } finally { sb.limpa(); }
});

test('id do session_meta diferente do uuid do nome, id inválido e nome sem uuid são descartados', async () => {
  const sb = sandbox();
  try {
    rollout(sb, 1);
    rollout(sb, 2, { idMeta: uuid(99) });
    rollout(sb, 3, { idMeta: `${uuid(3)};calc`, nomeId: uuid(3) });
    rollout(sb, 4, { idMeta: '-'.repeat(36), nomeId: '-'.repeat(36) });
    escreve(path.join(sb.sessions, '2026', '10', '03', 'rollout-sem-uuid.jsonl'), linha({ type: 'session_meta', payload: { id: 'x', cwd: CWD } }));
    escreve(path.join(sb.sessions, '2026', '10', '03', 'outro-arquivo.jsonl'), linha({ type: 'session_meta', payload: { id: uuid(7), cwd: CWD } }));
    assert.deepStrictEqual((await lista(sb)).itens.map(s => s.id), [uuid(1)]);
  } finally { sb.limpa(); }
});

test('rollout de subagente não entra', async () => {
  const sb = sandbox();
  try {
    rollout(sb, 1);
    rollout(sb, 2, { payloadExtra: { subagent: 'review' } });
    rollout(sb, 3, { payloadExtra: { thread_spawn: { parent: 'x' } } });
    rollout(sb, 4, { payloadExtra: { source: { subagent: { thread_spawn: {} } } } });
    assert.deepStrictEqual((await lista(sb)).itens.map(s => s.id), [uuid(1)]);
  } finally { sb.limpa(); }
});

test('sem a pasta sessions/ devolve vazio', async () => {
  const sb = sandbox();
  try {
    assert.deepStrictEqual(await lista(sb), { itens: [], total: 0 });
    assert.deepStrictEqual(await listarCodex({ cwd: CWD, raizes: [] }), { itens: [], total: 0 });
    assert.deepStrictEqual(await listarCodex({ cwd: '', raizes: [{ sessions: sb.sessions }] }), { itens: [], total: 0 });
  } finally { sb.limpa(); }
});

test('título: history.jsonl por session_id, depois session_index, depois rótulo; trunca em 80', async () => {
  const sb = sandbox();
  try {
    rollout(sb, 1, { hora: '01-00-00' });
    rollout(sb, 2, { hora: '02-00-00' });
    rollout(sb, 3, { hora: '03-00-00' });
    rollout(sb, 4, { hora: '04-00-00' });
    escreve(path.join(sb.home, 'history.jsonl'),
      linha({ session_id: uuid(1), ts: 1, text: 'Primeiro prompt do 1' }) + linha({ session_id: uuid(1), ts: 2, text: 'Segundo do 1' })
      + linha({ session_id: uuid(4), ts: 3, text: 'y'.repeat(300) }) + 'quebrada\n');
    escreve(path.join(sb.home, 'session_index.jsonl'),
      linha({ id: uuid(2), thread_name: 'Nome do índice', updated_at: 'x' }) + linha({ id: uuid(1), thread_name: 'Perde para o history', updated_at: 'x' }));
    const t = Object.fromEntries((await lista(sb)).itens.map(s => [s.id, s.titulo]));
    assert.strictEqual(t[uuid(1)], 'Primeiro prompt do 1');
    assert.strictEqual(t[uuid(2)], 'Nome do índice');
    assert.strictEqual(t[uuid(3)], 'Conversa sem título');
    assert.ok(t[uuid(4)].length <= 80);
  } finally { sb.limpa(); }
});

test('lê só o começo: arquivo de 5 MB, session_meta de 40 KB e de mais de 64 KB', async () => {
  const sb = sandbox();
  try {
    const grande = rollout(sb, 1, { hora: '01-00-00' });
    fs.appendFileSync(grande.f, 'x'.repeat(5 * 1024 * 1024));
    rollout(sb, 2, { hora: '02-00-00', payloadExtra: { instructions: 'i'.repeat(40 * 1024) } });
    // acima do teto: a linha não fecha na janela, id/cwd/timestamp saem do prefixo
    const id3 = uuid(3);
    const f3 = path.join(sb.sessions, '2026', '10', '03', `rollout-2026-10-03T03-00-00-${id3}.jsonl`);
    escreve(f3, `{"timestamp":"2026-10-03T03:00:00.000Z","type":"session_meta","payload":{"id":"${id3}","cwd":"${CWD}","timestamp":"2026-10-03T03:00:00.000Z","instructions":"${'z'.repeat(80 * 1024)}"}}\n`);
    // acima do teto e sem prefixo reconhecível: descartado
    const id4 = uuid(4);
    escreve(path.join(sb.sessions, '2026', '10', '03', `rollout-2026-10-03T04-00-00-${id4}.jsonl`), `{"payload":{"instructions":"${'w'.repeat(80 * 1024)}","id":"${id4}","cwd":"${CWD}"}}\n`);
    const lidos = [];
    const fsp = { ...fs.promises, open: async (f, m) => { const fh = await fs.promises.open(f, m); const read = fh.read.bind(fh); fh.read = async (b, o, len, pos) => { const r = await read(b, o, len, pos); lidos.push(r.bytesRead); return r; }; return fh; } };
    const r = await lista(sb, { deps: { fsp } });
    assert.deepStrictEqual(r.itens.map(s => s.id).sort(), [uuid(1), uuid(2), uuid(3)].sort());
    assert.ok(Math.max(...lidos) <= 64 * 1024, `maior leitura ${Math.max(...lidos)}`);
  } finally { sb.limpa(); }
});

test('cache em memória por caminho+mtime+tamanho: a segunda listagem não reabre os rollouts', async () => {
  const sb = sandbox();
  try {
    rollout(sb, 1); rollout(sb, 2);
    let abertos = 0;
    const fsp = { ...fs.promises, open: async (f, m) => { if (/rollout-/.test(f)) abertos++; return fs.promises.open(f, m); } };
    await lista(sb, { deps: { fsp } });
    const primeira = abertos;
    assert.ok(primeira >= 2);
    const r = await lista(sb, { deps: { fsp } });
    assert.strictEqual(abertos, primeira, 'nada reaberto');
    assert.strictEqual(r.itens.length, 2);
    // arquivo alterado (tamanho/mtime novos) é relido
    fs.appendFileSync(path.join(sb.sessions, '2026', '10', '03', fs.readdirSync(path.join(sb.sessions, '2026', '10', '03'))[0]), 'mais\n');
    await lista(sb, { deps: { fsp } });
    assert.ok(abertos > primeira);
  } finally { sb.limpa(); }
});

test('limite de 10, "todas" e total', async () => {
  const sb = sandbox();
  try {
    for (let n = 1; n <= 14; n++) rollout(sb, n, { hora: `${String(n).padStart(2, '0')}-00-00` });
    const r = await lista(sb);
    assert.strictEqual(r.itens.length, 10);
    assert.strictEqual(r.total, 14);
    assert.strictEqual(r.itens[0].id, uuid(14));
    assert.strictEqual((await lista(sb, { todas: true })).itens.length, 14);
  } finally { sb.limpa(); }
});

test('tempo total estourado devolve o parcial sem lançar', async () => {
  const sb = sandbox();
  try {
    rollout(sb, 1);
    const fsp = { ...fs.promises, stat: () => new Promise(() => { /* UNC pendurado */ }) };
    const t0 = Date.now();
    const r = await lista(sb, { tempoMs: 300, deps: { fsp } });
    assert.ok(Date.now() - t0 < 2000);
    assert.deepStrictEqual(r.itens, []);
  } finally { sb.limpa(); }
});
