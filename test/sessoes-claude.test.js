// Listagem das conversas do Claude Code por pasta: sandbox temporário e dados fictícios, nada real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listarClaude, pastaCodificada } = require('../src/sessoes-claude');

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const linha = o => JSON.stringify(o) + '\n';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-claude-'));
  const projects = path.join(dir, '.claude', 'projects');
  return { dir, projects, history: path.join(dir, '.claude', 'history.jsonl'), limpa: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// jsonl fictício com as chaves do Claude Code 2.1.x (F13)
function sessao(sb, pasta, n, { texto = `Pergunta ${n}`, mtime, extra = '', content } = {}) {
  const id = uuid(n);
  const corpo = linha({ type: 'last-prompt', leafUuid: 'x', sessionId: id })
    + linha({ type: 'mode', mode: 'normal', sessionId: id })
    + (texto === null ? '' : linha({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: content ?? texto }, uuid: `u${n}`, timestamp: '2026-10-03T10:00:00.000Z', cwd: 'D:\\x', sessionId: id }))
    + extra;
  const f = path.join(sb.projects, pasta, `${id}.jsonl`);
  escreve(f, corpo);
  if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return { id, f };
}

const CWD = 'D:\\SOEs\\Projeto-X';
const PASTA = 'D--SOEs-Projeto-X';

test('pastaCodificada troca tudo fora de [A-Za-z0-9] por hífen', () => {
  assert.strictEqual(pastaCodificada('D:\\SOEs\\Rendra-UI'), 'D--SOEs-Rendra-UI');
  assert.strictEqual(pastaCodificada('/mnt/d/SOEs/V-Agents'), '-mnt-d-SOEs-V-Agents');
});

test('lista só as conversas do cwd pedido, da mais nova para a mais antiga', async () => {
  const sb = sandbox();
  try {
    sessao(sb, PASTA, 1, { mtime: 1000000 });
    sessao(sb, PASTA, 2, { mtime: 3000000 });
    sessao(sb, PASTA, 3, { mtime: 2000000 });
    sessao(sb, 'D--SOEs-Outro', 4, { mtime: 9000000 });
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }] });
    assert.deepStrictEqual(r.itens.map(s => s.id), [uuid(2), uuid(3), uuid(1)]);
    assert.strictEqual(r.total, 3);
    assert.deepStrictEqual(Object.keys(r.itens[0]).sort(), ['id', 'provedor', 'quando', 'titulo']);
    assert.strictEqual(r.itens[0].provedor, 'claude');
    assert.strictEqual(r.itens[0].quando, 3000000);
    assert.strictEqual(r.itens[0].titulo, 'Pergunta 2');
  } finally { sb.limpa(); }
});

test('subpasta de subagente, memory/ e nome fora de uuid não aparecem', async () => {
  const sb = sandbox();
  try {
    const bom = sessao(sb, PASTA, 1);
    escreve(path.join(sb.projects, PASTA, uuid(1), 'subagents', `${uuid(9)}.jsonl`), linha({ type: 'user', message: { content: 'sub' } }));
    escreve(path.join(sb.projects, PASTA, 'memory', 'MEMORY.md'), 'x');
    escreve(path.join(sb.projects, PASTA, 'memory', `${uuid(8)}.jsonl`), linha({ type: 'user', message: { content: 'mem' } }));
    escreve(path.join(sb.projects, PASTA, 'nome-qualquer.jsonl'), linha({ type: 'user', message: { content: 'x' } }));
    escreve(path.join(sb.projects, PASTA, '$(calc).jsonl'), linha({ type: 'user', message: { content: 'x' } }));
    escreve(path.join(sb.projects, PASTA, `${'-'.repeat(36)}.jsonl`), linha({ type: 'user', message: { content: 'x' } }));
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }] });
    assert.deepStrictEqual(r.itens.map(s => s.id), [bom.id]);
  } finally { sb.limpa(); }
});

test('custom-title vence a primeira mensagem; título longo sai truncado', async () => {
  const sb = sandbox();
  try {
    sessao(sb, PASTA, 1, { extra: linha({ type: 'custom-title', customTitle: 'Meu nome salvo', sessionId: uuid(1) }) });
    sessao(sb, PASTA, 2, { texto: 'x'.repeat(500) });
    sessao(sb, PASTA, 3, { texto: 'primeira linha\nsegunda linha que não pode aparecer' });
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }] });
    const t = Object.fromEntries(r.itens.map(s => [s.id, s.titulo]));
    assert.strictEqual(t[uuid(1)], 'Meu nome salvo');
    assert.ok(t[uuid(2)].length <= 80);
    assert.strictEqual(t[uuid(3)], 'primeira linha');
  } finally { sb.limpa(); }
});

test('mensagem meta, comando do CLI e conteúdo em array: título só de mensagem real', async () => {
  const sb = sandbox();
  try {
    const id = uuid(1);
    const meta = linha({ type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: mensagens geradas localmente' }, sessionId: id })
      + linha({ type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' }, sessionId: id })
      + linha({ type: 'user', message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' }, sessionId: id })
      + linha({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'Pergunta em bloco' }] }, sessionId: id });
    escreve(path.join(sb.projects, PASTA, `${id}.jsonl`), meta);
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }] });
    assert.strictEqual(r.itens[0].titulo, 'Pergunta em bloco');
  } finally { sb.limpa(); }
});

test('sem texto no cabeçalho, o título vem do history.jsonl por sessionId, mesmo com outro project', async () => {
  const sb = sandbox();
  try {
    sessao(sb, PASTA, 1, { texto: null });
    sessao(sb, PASTA, 2, { texto: null });
    escreve(sb.history,
      linha({ display: 'Primeiro prompt da sessão 1', pastedContents: {}, timestamp: 1, project: 'D:\\SOEs\\OutraPasta', sessionId: uuid(1) })
      + linha({ display: 'Segundo prompt da sessão 1', pastedContents: {}, timestamp: 2, project: CWD, sessionId: uuid(1) })
      + linha({ display: 'Só do histórico 2', pastedContents: {}, timestamp: 3, project: CWD, sessionId: uuid(2) })
      + 'linha quebrada\n');
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }] });
    const t = Object.fromEntries(r.itens.map(s => [s.id, s.titulo]));
    assert.strictEqual(t[uuid(1)], 'Primeiro prompt da sessão 1');
    assert.strictEqual(t[uuid(2)], 'Só do histórico 2');
  } finally { sb.limpa(); }
});

test('sem nenhuma fonte de título, rótulo "Conversa sem título"', async () => {
  const sb = sandbox();
  try {
    sessao(sb, PASTA, 1, { texto: null });
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }] });
    assert.strictEqual(r.itens[0].titulo, 'Conversa sem título');
  } finally { sb.limpa(); }
});

test('cwd em /mnt com caixa diferente acha a pasta; em Linux nativo a caixa conta', async () => {
  const sb = sandbox();
  try {
    sessao(sb, '-mnt-d-SOEs-V-Agents', 1);
    sessao(sb, '-home-u-Pasta', 2);
    const a = await listarClaude({ cwd: '/mnt/d/soes/v-agents', raizes: [{ projects: sb.projects }] });
    assert.deepStrictEqual(a.itens.map(s => s.id), [uuid(1)]);
    const b = await listarClaude({ cwd: '/home/u/pasta', raizes: [{ projects: sb.projects }] });
    assert.deepStrictEqual(b.itens, []);
    const c = await listarClaude({ cwd: '/home/u/Pasta', raizes: [{ projects: sb.projects }] });
    assert.deepStrictEqual(c.itens.map(s => s.id), [uuid(2)]);
  } finally { sb.limpa(); }
});

test('leitura limitada: arquivo de 5 MB só tem 16 KB lidos, e só as 10 exibidas são abertas', async () => {
  const sb = sandbox();
  try {
    for (let n = 1; n <= 25; n++) sessao(sb, PASTA, n, { mtime: 1000000 + n * 1000, extra: n === 25 ? 'x'.repeat(5 * 1024 * 1024) : '' });
    const lidos = []; let abertos = 0;
    const fsp = { ...fs.promises, open: async (f, m) => { abertos++; const fh = await fs.promises.open(f, m); const read = fh.read.bind(fh); fh.read = async (b, o, len, pos) => { const r = await read(b, o, len, pos); lidos.push(r.bytesRead); return r; }; return fh; } };
    const t0 = Date.now();
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }], deps: { fsp } });
    assert.ok(Date.now() - t0 < 3000);
    assert.strictEqual(r.itens.length, 10);
    assert.strictEqual(r.total, 25);
    assert.strictEqual(abertos, 10, 'só as 10 mais recentes são abertas');
    assert.ok(Math.max(...lidos) <= 16384, `maior leitura ${Math.max(...lidos)}`);
    const todas = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }], todas: true, deps: { fsp } });
    assert.strictEqual(todas.itens.length, 25);
  } finally { sb.limpa(); }
});

test('raiz inexistente, ilegível ou pasta ausente devolve vazio sem lançar', async () => {
  const sb = sandbox();
  try {
    const a = await listarClaude({ cwd: CWD, raizes: [{ projects: path.join(sb.dir, 'nao-existe') }] });
    assert.deepStrictEqual(a, { itens: [], total: 0 });
    const b = await listarClaude({ cwd: CWD, raizes: [] });
    assert.deepStrictEqual(b, { itens: [], total: 0 });
    const c = await listarClaude({ cwd: '', raizes: [{ projects: sb.projects }] });
    assert.deepStrictEqual(c, { itens: [], total: 0 });
  } finally { sb.limpa(); }
});

test('estouro do tempo total devolve o que já foi lido, sem lançar', async () => {
  const sb = sandbox();
  try {
    for (let n = 1; n <= 3; n++) sessao(sb, PASTA, n, { mtime: 1000000 + n * 1000 });
    const fsp = { ...fs.promises, stat: () => new Promise(() => { /* pendurado, como um UNC travado */ }) };
    const t0 = Date.now();
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: sb.projects }], tempoMs: 300, deps: { fsp } });
    assert.ok(Date.now() - t0 < 2000);
    assert.deepStrictEqual(r.itens, []);
  } finally { sb.limpa(); }
});

test('várias raízes do mesmo ambiente: junta e remove id repetido', async () => {
  const a = sandbox(), b = sandbox();
  try {
    sessao(a, PASTA, 1, { mtime: 1000000 });
    sessao(b, PASTA, 2, { mtime: 2000000 });
    const r = await listarClaude({ cwd: CWD, raizes: [{ projects: a.projects }, { projects: b.projects }] });
    assert.deepStrictEqual(r.itens.map(s => s.id), [uuid(2), uuid(1)]);
  } finally { a.limpa(); b.limpa(); }
});
