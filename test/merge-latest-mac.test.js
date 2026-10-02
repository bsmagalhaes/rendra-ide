// Junção dos latest-mac.yml das duas arquiteturas (parecer C2): o canal precisa listar os dois zips.
const test = require('node:test');
const assert = require('node:assert');
const yaml = require('js-yaml');
const { mergeLatestMac, checkLatestMac } = require('../scripts/merge-latest-mac');

const yml = (arch, extra = {}) => yaml.dump({
  version: '1.3.0',
  files: [{ url: `Rendra-IDE-mac-${arch}.zip`, sha512: `sha-${arch}`, size: arch === 'arm64' ? 100 : 110, blockMapSize: 5 }],
  path: `Rendra-IDE-mac-${arch}.zip`,
  sha512: `sha-${arch}`,
  releaseDate: arch === 'arm64' ? '2026-10-02T10:00:00.000Z' : '2026-10-02T10:05:00.000Z',
  ...extra,
});

test('junta os dois zips, mantém versão e usa a data mais recente', () => {
  const doc = yaml.load(mergeLatestMac([yml('x64'), yml('arm64')]));
  assert.strictEqual(doc.version, '1.3.0');
  assert.deepStrictEqual(doc.files.map(f => f.url), ['Rendra-IDE-mac-arm64.zip', 'Rendra-IDE-mac-x64.zip']);
  assert.strictEqual(doc.files[1].sha512, 'sha-x64');
  assert.strictEqual(doc.files[1].size, 110);
  assert.strictEqual(doc.files[0].blockMapSize, 5);
  assert.strictEqual(doc.releaseDate, '2026-10-02T10:05:00.000Z');
  assert.strictEqual(doc.path, 'Rendra-IDE-mac-arm64.zip');
});

test('versões diferentes entre as arquiteturas reprovam', () => {
  assert.throws(() => mergeLatestMac([yml('arm64'), yml('x64').replace('1.3.0', '1.3.1')]), /versões diferentes/);
});

test('arquivo sem files reprova', () => {
  assert.throws(() => mergeLatestMac(['version: 1.3.0\n']), /sem lista/);
});

test('a conferência aceita o arquivo juntado e recusa o de uma arquitetura só', () => {
  assert.deepStrictEqual(checkLatestMac(mergeLatestMac([yml('arm64'), yml('x64')])), []);
  assert.deepStrictEqual(checkLatestMac(yml('arm64')), ['falta o zip x64 em latest-mac.yml']);
  assert.deepStrictEqual(checkLatestMac(yml('x64')), ['falta o zip arm64 em latest-mac.yml']);
});

test('o mesmo zip repetido não duplica a entrada', () => {
  const doc = yaml.load(mergeLatestMac([yml('arm64'), yml('arm64'), yml('x64')]));
  assert.strictEqual(doc.files.length, 2);
});

test('o ponto do .zip é literal: "-x64Xzip" não conta como zip x64', () => {
  const falso = yaml.dump({ version: '1.3.0', files: [{ url: 'Rendra-IDE-mac-x64Xzip', sha512: 's', size: 1 }, { url: 'Rendra-IDE-mac-arm64.zip', sha512: 's', size: 1 }] });
  assert.deepStrictEqual(checkLatestMac(falso), ['falta o zip x64 em latest-mac.yml']);
});
