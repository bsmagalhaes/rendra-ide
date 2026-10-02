// Uso dos agentes rodando no terminal WSL: a IDE soma as sessões das distros às do Windows.
// Tudo em pasta temporária: a "distro" é uma árvore falsa, nenhum dado real do usuário é lido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { aggregateCodex } = require('../src/codex-parser');
const { aggregateClaude } = require('../src/claude-parser');
const { wslRoots, _limpaCache } = require('../src/wsl-roots');

const agora = () => new Date().toISOString();
const rollout = (total, id) => [
  { timestamp: agora(), type: 'session_meta', payload: { cwd: '/home/ana/loja', id } },
  { timestamp: agora(), type: 'turn_context', payload: { model: 'gpt-5-codex', cwd: '/home/ana/loja' } },
  { timestamp: agora(), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 10 }, last_token_usage: { input_tokens: total, output_tokens: 10 } } } },
].map(l => JSON.stringify(l)).join('\n') + '\n';
const claudeLine = (id, i, o) => JSON.stringify({ type: 'assistant', timestamp: agora(), message: { id, model: 'claude-sonnet-4-5', usage: { input_tokens: i, output_tokens: o } }, requestId: 'r' + id }) + '\n';

function cenario() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-wsl-'));
  const win = path.join(base, 'win');
  const distro = path.join(base, 'Ubuntu-X'); // raiz da distro (o "\wsl.localhost\Ubuntu-X")
  const dia = path.join('sessions', '2026', '10', '01');
  fs.mkdirSync(path.join(win, '.codex', dia), { recursive: true });
  fs.mkdirSync(path.join(distro, 'home', 'ana', '.codex', dia), { recursive: true });
  fs.mkdirSync(path.join(distro, 'home', 'ana', '.claude', 'projects', '-home-ana-loja'), { recursive: true });
  fs.mkdirSync(path.join(win, '.claude', 'projects', 'C--MeusProjetos-Desenvolvimento-site'), { recursive: true });
  fs.writeFileSync(path.join(win, '.codex', dia, 'rollout-a.jsonl'), rollout(100, 'a'));
  fs.writeFileSync(path.join(distro, 'home', 'ana', '.codex', dia, 'rollout-b.jsonl'), rollout(1000, 'b'));
  fs.writeFileSync(path.join(distro, 'home', 'ana', '.claude', 'projects', '-home-ana-loja', 's1.jsonl'), claudeLine('m1', 500, 50));
  fs.writeFileSync(path.join(win, '.claude', 'projects', 'C--MeusProjetos-Desenvolvimento-site', 's2.jsonl'), claudeLine('m2', 7, 3));
  const deps = { platform: 'win32', ttl: 0, listDistros: async () => [{ name: 'Ubuntu-X', state: 'Running' }, { name: 'Parada', state: 'Stopped' }], uncRoot: n => path.join(base, n) };
  return { base, win, distro, deps };
}

test('Codex: soma as sessões da distro WSL às do Windows', async () => {
  _limpaCache();
  const c = cenario();
  const r = await wslRoots(c.deps);
  assert.deepStrictEqual(r.codex, [path.join(c.distro, 'home', 'ana', '.codex', 'sessions')]);
  const total = aggregateCodex({ home: path.join(c.win, '.codex'), extraSessionDirs: r.codex });
  assert.strictEqual(total.totalTokens, 100 + 10 + 1000 + 10);
  assert.strictEqual(total.totalSessions, 2);
});

test('Codex: a mesma sessão vista duas vezes (mesmo arquivo) conta uma só', async () => {
  const c = cenario();
  const dia = path.join('sessions', '2026', '10', '01');
  fs.copyFileSync(path.join(c.win, '.codex', dia, 'rollout-a.jsonl'), path.join(c.distro, 'home', 'ana', '.codex', dia, 'rollout-a.jsonl'));
  const r = await wslRoots(c.deps);
  const total = aggregateCodex({ home: path.join(c.win, '.codex'), extraSessionDirs: r.codex });
  assert.strictEqual(total.totalTokens, 110 + 1010);
});

test('Codex: sem pasta no Windows, só com a distro, a página tem dados', async () => {
  const c = cenario();
  fs.rmSync(path.join(c.win, '.codex'), { recursive: true });
  const r = await wslRoots(c.deps);
  const total = aggregateCodex({ home: path.join(c.win, '.codex'), extraSessionDirs: r.codex });
  assert.strictEqual(total.available, true);
  assert.strictEqual(total.totalTokens, 1010);
});

test('Claude Code: soma os projetos da distro WSL aos do Windows', async () => {
  const c = cenario();
  const r = await wslRoots(c.deps);
  assert.deepStrictEqual(r.claude, [path.join(c.distro, 'home', 'ana', '.claude', 'projects')]);
  const total = aggregateClaude(path.join(c.win, '.claude', 'projects'), {}, r.claude);
  assert.strictEqual(total.totalTokens, 550 + 10);
  const nomes = total.projects.map(p => p.name).sort();
  assert.deepStrictEqual(nomes, ['loja', 'site']);
});

test('distro parada não é tocada (não acorda) e fora do Windows não há WSL', async () => {
  const c = cenario();
  const lidas = [];
  const r = await wslRoots({ ...c.deps, uncRoot: n => { lidas.push(n); return path.join(c.base, n); } });
  assert.deepStrictEqual(lidas, ['Ubuntu-X']);
  assert.deepStrictEqual(await wslRoots({ ...c.deps, platform: 'linux' }), { claude: [], codex: [] });
  assert.ok(r.codex.length === 1);
});

test('WSL desligado ou lento: falha silenciosa dentro do tempo limite', async () => {
  const c = cenario();
  const t = Date.now();
  const pendurada = await wslRoots({ ...c.deps, timeoutMs: 80, listDistros: () => new Promise(() => {}) });
  assert.deepStrictEqual(pendurada, { claude: [], codex: [] });
  assert.ok(Date.now() - t < 1500);
  assert.deepStrictEqual(await wslRoots({ ...c.deps, listDistros: async () => null }), { claude: [], codex: [] });
  assert.deepStrictEqual(await wslRoots({ ...c.deps, listDistros: async () => { throw new Error('x'); } }), { claude: [], codex: [] });
});

test('o resultado fica em cache pelo ttl (o scan periódico não repete o wsl.exe)', async () => {
  _limpaCache();
  const c = cenario();
  let n = 0;
  const d = { ...c.deps, ttl: 60000, listDistros: async () => { n++; return [{ name: 'Ubuntu-X', state: 'Running' }]; } };
  await wslRoots(d); await wslRoots(d);
  assert.strictEqual(n, 1);
});
