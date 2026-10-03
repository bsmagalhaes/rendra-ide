// Orquestração do seletor: ambiente -> raízes -> listagens -> resposta com os campos fixos. Sandbox e dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listar, raizesDaDistro } = require('../src/sessoes-agentes');
const { _limpaCache } = require('../src/sessoes-codex');

const uuid = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`;
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const linha = o => JSON.stringify(o) + '\n';
const sandbox = () => { _limpaCache(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-t-agentes-')); return { dir, limpa: () => fs.rmSync(dir, { recursive: true, force: true }) }; };

function claude(projects, pasta, n, mtime, texto = `Pergunta ${n}`) {
  const id = uuid('8000', n);
  const f = path.join(projects, pasta, `${id}.jsonl`);
  escreve(f, linha({ type: 'user', message: { role: 'user', content: texto }, sessionId: id }));
  fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return id;
}
function codex(sessions, cwd, n, iso) {
  const id = uuid('9000', n);
  escreve(path.join(sessions, '2026', '10', '03', `rollout-2026-10-03T00-00-00-${id}.jsonl`), linha({ type: 'session_meta', payload: { id, cwd, timestamp: iso } }));
  return id;
}
const ambos = async () => ({ claude: true, codex: true });
const D = (o = {}) => ({ detectar: ambos, ...o });

test('ambiente Windows usa RENDRA_HOME/CODEX_HOME e settings.claudePath, e nunca toca a distro', async () => {
  const sb = sandbox();
  try {
    const home = path.join(sb.dir, 'home');
    const projects = path.join(home, '.claude', 'projects');
    const cwd = 'D:\\SOEs\\X';
    const idC = claude(projects, 'D--SOEs-X', 1, Date.parse('2026-10-03T12:00:00Z'));
    const idX = codex(path.join(sb.dir, 'codexhome', 'sessions'), cwd, 2, '2026-10-03T13:00:00.000Z');
    let wslChamado = 0;
    const r = await listar({ amb: { tipo: 'windows', distro: null, cwd }, settings: {}, deps: D({ env: { RENDRA_HOME: home, CODEX_HOME: path.join(sb.dir, 'codexhome') }, raizesWsl: async () => { wslChamado++; return { claude: [], codex: [] }; } }) });
    assert.deepStrictEqual(r.sessoes.map(s => [s.provedor, s.id]), [['codex', idX], ['claude', idC]]);
    assert.strictEqual(wslChamado, 0);
    assert.deepStrictEqual(Object.keys(r).sort(), ['mais', 'provedores', 'sessoes']);
    assert.deepStrictEqual(r.provedores, { claude: true, codex: true });
    // settings.claudePath tem prioridade (a mesma regra do scanner)
    const outro = path.join(sb.dir, 'outro', 'projects');
    const idO = claude(outro, 'D--SOEs-X', 3, Date.parse('2026-10-03T14:00:00Z'));
    const r2 = await listar({ amb: { tipo: 'windows', distro: null, cwd }, settings: { claudePath: outro }, deps: D({ env: { RENDRA_HOME: home, CODEX_HOME: path.join(sb.dir, 'codexhome') } }) });
    assert.deepStrictEqual(r2.sessoes.filter(s => s.provedor === 'claude').map(s => s.id), [idO]);
  } finally { sb.limpa(); }
});

test('ambiente da distro usa só as raízes dessa distro e nunca as do Windows', async () => {
  const sb = sandbox();
  try {
    const cwd = '/mnt/d/SOEs/X';
    const winHome = path.join(sb.dir, 'winhome');
    claude(path.join(winHome, '.claude', 'projects'), '-mnt-d-SOEs-X', 1, Date.parse('2026-10-03T12:00:00Z'), 'do Windows');
    codex(path.join(sb.dir, 'wincodex', 'sessions'), cwd, 2, '2026-10-03T12:00:00.000Z');
    const distroClaude = path.join(sb.dir, 'u', '.claude', 'projects');
    const distroCodex = path.join(sb.dir, 'u', '.codex', 'sessions');
    const idC = claude(distroClaude, '-mnt-d-SOEs-X', 5, Date.parse('2026-10-03T10:00:00Z'), 'da distro');
    const idX = codex(distroCodex, cwd, 6, '2026-10-03T11:00:00.000Z');
    let pedida = null;
    const r = await listar({ amb: { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd }, deps: D({
      env: { RENDRA_HOME: winHome, CODEX_HOME: path.join(sb.dir, 'wincodex') },
      raizesWsl: async d => { pedida = d; return { claude: [distroClaude], codex: [distroCodex] }; },
    }) });
    // com RENDRA_HOME o ambiente WSL é desligado (como o wslRoots): sandbox nunca alcança distro real
    assert.deepStrictEqual(r, { provedores: { claude: false, codex: false }, sessoes: [], mais: false });
    const r2 = await listar({ amb: { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd }, deps: D({
      env: { CODEX_HOME: path.join(sb.dir, 'wincodex'), HOME: winHome },
      raizesWsl: async d => { pedida = d; return { claude: [distroClaude], codex: [distroCodex] }; },
    }) });
    assert.strictEqual(pedida, 'Ubuntu-24.04');
    assert.deepStrictEqual(r2.sessoes.map(s => [s.provedor, s.id]), [['codex', idX], ['claude', idC]]);
    assert.ok(!r2.sessoes.some(s => s.titulo === 'do Windows'));
  } finally { sb.limpa(); }
});

test('provedor não instalado no ambiente some da lista e dos provedores', async () => {
  const sb = sandbox();
  try {
    const home = path.join(sb.dir, 'home');
    const cwd = 'D:\\SOEs\\X';
    const idC = claude(path.join(home, '.claude', 'projects'), 'D--SOEs-X', 1, Date.parse('2026-10-03T12:00:00Z'));
    codex(path.join(sb.dir, 'ch', 'sessions'), cwd, 2, '2026-10-03T13:00:00.000Z');
    const r = await listar({ amb: { tipo: 'windows', distro: null, cwd }, deps: { detectar: async () => ({ claude: true, codex: false }), env: { RENDRA_HOME: home, CODEX_HOME: path.join(sb.dir, 'ch') } } });
    assert.deepStrictEqual(r.provedores, { claude: true, codex: false });
    assert.deepStrictEqual(r.sessoes.map(s => s.id), [idC]);
    const nenhum = await listar({ amb: { tipo: 'windows', distro: null, cwd }, deps: { detectar: async () => ({ claude: false, codex: false }), env: { RENDRA_HOME: home, CODEX_HOME: path.join(sb.dir, 'ch') } } });
    assert.deepStrictEqual(nenhum, { provedores: { claude: false, codex: false }, sessoes: [], mais: false });
  } finally { sb.limpa(); }
});

test('12 conversas (7 Claude, 5 Codex): 10 mais novas em ordem, mais=true; todas devolve as 12', async () => {
  const sb = sandbox();
  try {
    const home = path.join(sb.dir, 'home');
    const cwd = 'D:\\SOEs\\X';
    for (let n = 1; n <= 7; n++) claude(path.join(home, '.claude', 'projects'), 'D--SOEs-X', n, Date.parse('2026-10-01T00:00:00Z') + n * 3600e3 * 2);
    for (let n = 1; n <= 5; n++) codex(path.join(sb.dir, 'ch', 'sessions'), cwd, 10 + n, new Date(Date.parse('2026-10-01T01:00:00Z') + n * 3600e3 * 2).toISOString());
    const env = { RENDRA_HOME: home, CODEX_HOME: path.join(sb.dir, 'ch') };
    const r = await listar({ amb: { tipo: 'windows', distro: null, cwd }, deps: D({ env }) });
    assert.strictEqual(r.sessoes.length, 10);
    assert.strictEqual(r.mais, true);
    assert.deepStrictEqual(r.sessoes.map(s => s.quando), [...r.sessoes.map(s => s.quando)].sort((a, b) => b - a));
    const t = await listar({ amb: { tipo: 'windows', distro: null, cwd }, todas: true, deps: D({ env }) });
    assert.strictEqual(t.sessoes.length, 12);
    assert.strictEqual(t.mais, false);
    // até 10: sem "mais"
    const pouco = await listar({ amb: { tipo: 'windows', distro: null, cwd: 'D:\\Outro' }, deps: D({ env }) });
    assert.deepStrictEqual(pouco.sessoes, []);
    assert.strictEqual(pouco.mais, false);
  } finally { sb.limpa(); }
});

test('raizesDaDistro varre /root e /home/* da raiz UNC da distro pedida, com o mesmo critério de wsl-roots', async () => {
  const sb = sandbox();
  try {
    const raiz = path.join(sb.dir, 'unc', 'Ubuntu-24.04');
    fs.mkdirSync(path.join(raiz, 'home', 'u', '.claude', 'projects'), { recursive: true });
    fs.mkdirSync(path.join(raiz, 'home', 'u', '.codex', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(raiz, 'home', 'sem', 'nada'), { recursive: true });
    fs.mkdirSync(path.join(raiz, 'root', '.claude', 'projects'), { recursive: true });
    const pedidos = [];
    const r = await raizesDaDistro('Ubuntu-24.04', { uncRoot: d => { pedidos.push(d); return path.join(sb.dir, 'unc', d); } });
    assert.deepStrictEqual(pedidos, ['Ubuntu-24.04']);
    assert.deepStrictEqual(r.claude.sort(), [path.join(raiz, 'home', 'u', '.claude', 'projects'), path.join(raiz, 'root', '.claude', 'projects')].sort());
    assert.deepStrictEqual(r.codex, [path.join(raiz, 'home', 'u', '.codex', 'sessions')]);
    assert.deepStrictEqual(await raizesDaDistro('Outra', { uncRoot: d => path.join(sb.dir, 'unc', d) }), { claude: [], codex: [] });
  } finally { sb.limpa(); }
});

test('resposta sem caminho de arquivo nem texto além do título', async () => {
  const sb = sandbox();
  try {
    const home = path.join(sb.dir, 'home');
    claude(path.join(home, '.claude', 'projects'), 'D--SOEs-X', 1, Date.now(), 'Meu título');
    const r = await listar({ amb: { tipo: 'windows', distro: null, cwd: 'D:\\SOEs\\X' }, deps: D({ env: { RENDRA_HOME: home, CODEX_HOME: path.join(sb.dir, 'ch') } }) });
    assert.deepStrictEqual(Object.keys(r.sessoes[0]).sort(), ['id', 'provedor', 'quando', 'titulo']);
    assert.ok(!JSON.stringify(r).includes(sb.dir.replace(/\\/g, '\\\\')));
    assert.ok(!JSON.stringify(r).includes('jsonl'));
  } finally { sb.limpa(); }
});
