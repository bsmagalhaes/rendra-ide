// Caminhos de arquivo no terminal: o reconhecedor (candidatos, positivos e negativos), a resolução para
// caminhos absolutos (Windows, WSL, relativos) e o handler real dev:resolve-path, que só aceita o que
// existe dentro das pastas abertas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acharCaminhos } = require('../renderer/caminhos-terminal');
const { candidatosDoCaminho } = require('../src/caminho-terminal');
const { registerDevCode } = require('../src/devcode');

const textos = linha => acharCaminhos(linha).map(a => a.texto);

test('reconhece caminhos relativos, absolutos Windows e Linux, com :linha e :coluna', () => {
  const esperado = {
    'veja docs/superpowers/specs/2026-10-03-modulo-vitrine-visao-macro-design.md agora': ['docs/superpowers/specs/2026-10-03-modulo-vitrine-visao-macro-design.md'],
    'erro em ./src/app.js:12:5 e ../x/y.ts:7': ['./src/app.js:12:5', '../x/y.ts:7'],
    'abri D:\\SOEs\\Rendra-UI\\CLAUDE.md. Feito': ['D:\\SOEs\\Rendra-UI\\CLAUDE.md'],
    'C:/Users/x/a.json:3': ['C:/Users/x/a.json:3'],
    'em /mnt/d/proj/src/a.js:40 e /home/bruno/p/b.py': ['/mnt/d/proj/src/a.js:40', '/home/bruno/p/b.py'],
    '"src\\util\\x.js"': ['src\\util\\x.js'],
    '(docs/a.md)': ['docs/a.md'],
    'pasta src/renderer/ e ./docs': ['src/renderer/', './docs'],
    'config em ./.github/workflows/ci.yml, ok': ['./.github/workflows/ci.yml'],
    '--file=docs/a.md': ['docs/a.md'],
  };
  for (const [linha, tokens] of Object.entries(esperado)) assert.deepStrictEqual(textos(linha), tokens, linha);
  const [a] = acharCaminhos('x ./src/app.js:12:5 y');
  assert.deepStrictEqual({ caminho: a.caminho, linha: a.linha, coluna: a.coluna, start: a.start, end: a.end }, { caminho: './src/app.js', linha: 12, coluna: 5, start: 2, end: 19 });
  assert.strictEqual(acharCaminhos('a docs/x.md:9')[0].coluna, null);
});

test('não reconhece URLs, palavras soltas, datas, e-mails nem texto sem barra ou extensão', () => {
  for (const linha of [
    'https://exemplo.com/a/b.html', 'http://localhost:3000/x/y.js:10', 'file:///C:/x/a.txt', 'ftp://h/a/b.txt', '//cdn.exemplo.com/a.js',
    'ssh://git@host/a/b.git', '\\\\servidor\\share\\a.txt',
    'palavra solta README.md', 'a.b.c', 'v1.2.3', 'and/or', 'input/output', '10/03/2026', '12:30:45', 'usuario@exemplo.com',
    '@scope/pacote', 'a/b', 'C:', '/', '/x', '', '   ',
  ]) {
    assert.deepStrictEqual(textos(linha), [], linha);
  }
  // a URL dentro de uma frase não vira caminho, mas o caminho ao lado vira
  assert.deepStrictEqual(textos('abra https://a.com/x/y.md e docs/y.md'), ['docs/y.md']);
  assert.deepStrictEqual(textos(null), []);
});

test('limita candidatos por linha e ignora token gigante', () => {
  assert.strictEqual(acharCaminhos(Array.from({ length: 50 }, (_, i) => `a/f${i}.js`).join(' ')).length, 20);
  assert.deepStrictEqual(acharCaminhos('a/' + 'x'.repeat(500) + '.js'), []);
});

test('candidatosDoCaminho: Windows, WSL e relativos', () => {
  const w = { isWin: true, cwd: 'D:\\proj\\sub', root: 'D:\\proj', home: 'C:\\Users\\b' };
  assert.deepStrictEqual(candidatosDoCaminho('docs/a.md', w), ['D:\\proj\\sub\\docs\\a.md', 'D:\\proj\\docs\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('..\\x\\a.md', w), ['D:\\proj\\x\\a.md', 'D:\\x\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('d:/proj/a.md', w), ['d:\\proj\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('/mnt/d/proj/src/a.js', w), ['D:\\proj\\src\\a.js']);
  assert.deepStrictEqual(candidatosDoCaminho('/c/Users/b/a.md', w), ['C:\\Users\\b\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('/home/b/p/a.md', w), []);
  assert.deepStrictEqual(candidatosDoCaminho('~/a.md', w), ['C:\\Users\\b\\a.md']);
  const unc = '\\\\wsl.localhost\\Ubuntu\\home\\b\\p';
  const wsl = { isWin: true, distro: 'Ubuntu', cwd: unc, root: unc, home: 'C:\\Users\\b' };
  assert.deepStrictEqual(candidatosDoCaminho('/home/b/p/a.md', wsl), [unc + '\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('src/a.md', wsl), [unc + '\\src\\a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('~/a.md', wsl), []);
  const l = { isWin: false, cwd: '/home/b/p/sub', root: '/home/b/p', home: '/home/b' };
  assert.deepStrictEqual(candidatosDoCaminho('./x/a.md', l), ['/home/b/p/sub/x/a.md', '/home/b/p/x/a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('/opt/a.md', l), ['/opt/a.md']);
  assert.deepStrictEqual(candidatosDoCaminho('~/a.md', l), ['/home/b/a.md']);
});

test('candidatosDoCaminho recusa entrada inválida', () => {
  for (const ruim of [null, undefined, 3, '', 'a/b\u0000.js', 'a/b\n.js', 'a/' + 'x'.repeat(2000) + '.js']) assert.deepStrictEqual(candidatosDoCaminho(ruim, { isWin: true, root: 'D:\\p' }), []);
});

// ── handler real ──────────────────────────────────────────────────────────────
const pastas = [];
const pasta = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-cam-')); pastas.push(p); return p; };
test.after(() => pastas.forEach(p => fs.rmSync(p, { recursive: true, force: true })));

function montar(raiz, deps = {}) {
  const handlers = new Map();
  const dados = new Map([['devcode.workspaces', { list: [{ name: 'w', root: raiz }], active: 0 }]]);
  registerDevCode({ ipcMain: { handle: (n, f) => handlers.set(n, f), on() {}, once() {}, removeHandler() {} }, dialog: {}, store: { get: k => dados.get(k), set: (k, v) => dados.set(k, v), delete: k => dados.delete(k) }, getWindow: () => null, deps });
  handlers.get('dev:load-workspaces')({});
  return (texto, cwd, root) => handlers.get('dev:resolve-path')({}, { texto, cwd, root });
}

test('dev:resolve-path: arquivo e pasta existentes dentro da pasta aberta; inexistente, fora e inválido não', async () => {
  const raiz = pasta(), fora = pasta();
  fs.mkdirSync(path.join(raiz, 'docs', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'specs', 'a.md'), 'x');
  fs.writeFileSync(path.join(raiz, 'b.txt'), 'x');
  fs.writeFileSync(path.join(fora, 'c.txt'), 'x');
  const resolve = montar(raiz);
  assert.deepStrictEqual(await resolve('docs/specs/a.md', raiz, raiz), { path: path.join(raiz, 'docs', 'specs', 'a.md'), isDir: false });
  assert.deepStrictEqual(await resolve('./b.txt', path.join(raiz, 'docs'), raiz), { path: path.join(raiz, 'b.txt'), isDir: false }); // cai na raiz
  assert.deepStrictEqual(await resolve('../b.txt', path.join(raiz, 'docs'), raiz), { path: path.join(raiz, 'b.txt'), isDir: false });
  assert.deepStrictEqual(await resolve('docs/specs/', raiz, raiz), { path: path.join(raiz, 'docs', 'specs'), isDir: true });
  assert.deepStrictEqual(await resolve(path.join(raiz, 'b.txt'), raiz, raiz), { path: path.join(raiz, 'b.txt'), isDir: false });
  assert.strictEqual(await resolve('docs/nao-existe.md', raiz, raiz), null);
  assert.strictEqual(await resolve(path.join(fora, 'c.txt'), raiz, raiz), null, 'fora das pastas abertas');
  assert.strictEqual(await resolve('../' + path.basename(fora) + '/c.txt', raiz, raiz), null, 'escapa pela raiz');
  assert.deepStrictEqual(await resolve('b.txt', fora, raiz), { path: path.join(raiz, 'b.txt'), isDir: false }, 'cwd fora da pasta aberta é ignorado, vale a raiz');
  assert.strictEqual(await resolve('b.txt', fora, fora), null, 'raiz e cwd fora das pastas abertas');
  for (const ruim of [null, undefined, 42, '', 'a/b\u0000.txt']) assert.strictEqual(await resolve(ruim, raiz, raiz), null);
});

test('dev:resolve-path: caminho Linux /mnt/<letra>/ vira o arquivo do Windows', { skip: process.platform !== 'win32' }, async () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'm.txt'), 'x');
  const resolve = montar(raiz);
  const linux = '/mnt/' + raiz[0].toLowerCase() + '/' + raiz.slice(3).replace(/\\/g, '/') + '/m.txt';
  assert.deepStrictEqual(await resolve(linux, raiz, raiz), { path: path.join(raiz, 'm.txt'), isDir: false });
  assert.strictEqual(await resolve('/home/ninguem/m.txt', raiz, raiz), null);
});
