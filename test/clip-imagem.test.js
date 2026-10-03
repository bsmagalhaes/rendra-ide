// T1: o Ctrl+V do terminal estava quebrado porque o canal clip:has-image chamava clipboard.availableFormats(),
// que não existe no Electron 44. A detecção de imagem agora usa clipboard.read() (API do Electron 44)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { temImagem } = require('../src/clip-imagem');

const ROOT = path.join(__dirname, '..');
const lerFonte = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// clipboard falso no formato do Electron 44: só read(), sem availableFormats (F12)
const clip = tipos => ({ read: async () => (tipos === null ? [] : [{ types: tipos }]) });

test('com image/png na área de transferência devolve true', async () => {
  assert.strictEqual(await temImagem(clip(['text/plain', 'image/png'])), true);
});

test('só texto devolve false', async () => {
  assert.strictEqual(await temImagem(clip(['text/plain'])), false);
});

test('área de transferência vazia devolve false', async () => {
  assert.strictEqual(await temImagem(clip(null)), false);
});

test('read() rejeitando devolve false, nunca lança', async () => {
  assert.strictEqual(await temImagem({ read: async () => { throw new Error('sem acesso'); } }), false);
});

test('clipboard sem read() devolve false', async () => {
  assert.strictEqual(await temImagem({}), false);
  assert.strictEqual(await temImagem(null), false);
});

test('funciona com um objeto sem availableFormats, como o Electron 44', async () => {
  const c = clip(['image/png']);
  assert.strictEqual(typeof c.availableFormats, 'undefined');
  assert.strictEqual(await temImagem(c), true);
});

test('fiação: o canal clip:has-image não chama availableFormats e usa temImagem', () => {
  const src = lerFonte('src/devcode.js');
  assert.ok(!src.includes('availableFormats'), 'src/devcode.js ainda chama availableFormats');
  const i = src.indexOf("'clip:has-image'");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 300), /temImagem\(/);
});

test('fiação: o ramo do Ctrl+V trata a rejeição do canal e cai na colagem de texto', () => {
  const src = lerFonte('renderer/devcode.js');
  const i = src.indexOf('dev.clipboardHasImage()');
  assert.ok(i > 0);
  const trecho = src.slice(i, i + 400);
  assert.match(trecho, /\.catch\(/);
  assert.match(trecho, /pasteText\(\)/);
});
