// setup.js: asset do RTK por plataforma e arquitetura (puro, sem rede nem rtk real)
const test = require('node:test');
const assert = require('node:assert');
const setup = require('../src/setup');

test('asset do RTK por plataforma e CPU (nomes da release 0.50.0)', () => {
  assert.strictEqual(setup.rtkAssetName('win32', 'x64'), 'rtk-x86_64-pc-windows-msvc.zip');
  assert.strictEqual(setup.rtkAssetName('linux', 'x64'), 'rtk-x86_64-unknown-linux-musl.tar.gz');
  assert.strictEqual(setup.rtkAssetName('linux', 'arm64'), 'rtk-aarch64-unknown-linux-gnu.tar.gz');
  assert.strictEqual(setup.rtkAssetName('darwin', 'arm64'), 'rtk-aarch64-apple-darwin.tar.gz');
  assert.strictEqual(setup.rtkAssetName('darwin', 'x64'), 'rtk-x86_64-apple-darwin.tar.gz');
});

test('sem argumentos, o asset é o da máquina (comportamento de antes)', () => {
  assert.strictEqual(setup.rtkAssetName(), setup.rtkAssetName(process.platform, process.arch));
});

test('uname -m da distro vira o arch do rtkAssetName', () => {
  assert.strictEqual(setup.archFromUname('x86_64\n'), 'x64');
  assert.strictEqual(setup.archFromUname('aarch64'), 'arm64');
  assert.strictEqual(setup.archFromUname('riscv64'), null);
  assert.strictEqual(setup.rtkAssetName('linux', setup.archFromUname('aarch64')), 'rtk-aarch64-unknown-linux-gnu.tar.gz');
  assert.strictEqual(setup.rtkAssetName('linux', setup.archFromUname('x86_64')), 'rtk-x86_64-unknown-linux-musl.tar.gz');
});
