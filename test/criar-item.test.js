// Criar arquivo e pasta pelo explorador: passa pelos handlers reais (dev:create-file e dev:create-dir
// de src/devcode.js) com um ipcMain e um store falsos, e o teste afirma o que ficou no disco.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerDevCode } = require('../src/devcode');
const { validarNome } = require('../renderer/novo-item');

const pastas = [];
const pasta = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-novo-')); pastas.push(p); return p; };
test.after(() => pastas.forEach(p => fs.rmSync(p, { recursive: true, force: true })));

// Abre a pasta como workspace (é assim que o app a coloca entre as pastas permitidas)
function montar(raiz) {
  const handlers = new Map();
  const dados = new Map([['devcode.workspaces', { list: [{ name: 'w', root: raiz }], active: 0 }]]);
  const ipcMain = { handle: (nome, fn) => handlers.set(nome, fn), on() {}, once() {}, removeHandler() {} };
  const store = { get: k => dados.get(k), set: (k, v) => dados.set(k, v), delete: k => dados.delete(k) };
  registerDevCode({ ipcMain, dialog: {}, store, getWindow: () => null });
  handlers.get('dev:load-workspaces')({});
  return {
    arquivo: (dir, nome) => handlers.get('dev:create-file')({}, dir, nome),
    pasta: (dir, nome) => handlers.get('dev:create-dir')({}, dir, nome),
  };
}

test('validarNome recusa vazio, separadores, ponto-ponto e item existente', () => {
  assert.ok(validarNome('', []));
  assert.ok(validarNome('   ', []));
  assert.ok(validarNome('a/b', []));
  assert.ok(validarNome('a\\b', []));
  assert.ok(validarNome('..', []));
  assert.ok(validarNome('.', []));
  assert.ok(validarNome('x.txt', ['X.TXT'], { insensivel: true }));
  assert.ok(validarNome('x.txt', ['x.txt']));
  assert.strictEqual(validarNome('x.txt', ['y.txt']), null);
  assert.strictEqual(validarNome('.gitignore', []), null);
});

test('cria o arquivo vazio dentro da pasta aberta e devolve o caminho', () => {
  const raiz = pasta();
  const t = montar(raiz);
  const r = t.arquivo(raiz, 'novo.txt');
  assert.deepStrictEqual(r, { ok: true, path: path.join(raiz, 'novo.txt') });
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'novo.txt'), 'utf8'), '');
});

test('cria a pasta dentro de uma subpasta da pasta aberta', () => {
  const raiz = pasta();
  fs.mkdirSync(path.join(raiz, 'sub'));
  const t = montar(raiz);
  const r = t.pasta(path.join(raiz, 'sub'), 'nova');
  assert.deepStrictEqual(r, { ok: true, path: path.join(raiz, 'sub', 'nova') });
  assert.ok(fs.statSync(path.join(raiz, 'sub', 'nova')).isDirectory());
});

test('recusa pai fora das pastas abertas e não grava nada', () => {
  const raiz = pasta(), fora = pasta();
  const t = montar(raiz);
  const a = t.arquivo(fora, 'x.txt');
  const d = t.pasta(fora, 'y');
  assert.strictEqual(a.ok, false);
  assert.strictEqual(d.ok, false);
  assert.match(a.error, /fora das pastas abertas/);
  assert.deepStrictEqual(fs.readdirSync(fora), []);
});

test('recusa nome com .. ou separador, mesmo que o caminho resultante caia fora', () => {
  const raiz = pasta(), fora = pasta();
  const t = montar(raiz);
  for (const nome of ['', '..', '../escapou.txt', `..\\${path.basename(fora)}\\x.txt`, 'a/b.txt', 'a\\b.txt']) {
    assert.strictEqual(t.arquivo(raiz, nome).ok, false, `arquivo ${JSON.stringify(nome)}`);
    assert.strictEqual(t.pasta(raiz, nome).ok, false, `pasta ${JSON.stringify(nome)}`);
  }
  assert.deepStrictEqual(fs.readdirSync(raiz), []);
  assert.deepStrictEqual(fs.readdirSync(fora), []);
});

test('não sobrescreve arquivo existente nem recria pasta existente', () => {
  const raiz = pasta();
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'conteudo');
  fs.mkdirSync(path.join(raiz, 'p'));
  const t = montar(raiz);
  const a = t.arquivo(raiz, 'a.txt');
  assert.strictEqual(a.ok, false);
  assert.match(a.error, /já existe/);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'a.txt'), 'utf8'), 'conteudo');
  assert.strictEqual(t.pasta(raiz, 'p').ok, false);
  assert.strictEqual(t.arquivo(raiz, 'p').ok, false);
  assert.strictEqual(t.pasta(raiz, 'a.txt').ok, false);
});
