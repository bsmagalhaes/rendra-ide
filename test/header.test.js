// Every JS and CSS file the app runs starts with the signature header, with the current version
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { HEADER, shippedFiles } = require('../scripts/stamp');

const ROOT = path.join(__dirname, '..');
const { version } = require('../package.json');

test('o cabeçalho usa a versão do package.json', () => {
  assert.strictEqual(HEADER, `/*! Rendra IDE v${version} | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */`);
});

for (const rel of shippedFiles()) {
  test(`cabeçalho em ${rel}`, () => {
    const first = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/)[0];
    assert.strictEqual(first, HEADER, `rode "npm run stamp" (encontrado: ${first.slice(0, 80)})`);
  });
}
