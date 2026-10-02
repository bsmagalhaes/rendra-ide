// Lista de assets que a release precisa ter antes de sair do rascunho (parecer C4).
const test = require('node:test');
const assert = require('node:assert');
const { checkAssets, expectedAssets } = require('../scripts/check-release-assets');

test('release completa com mac passa', () => {
  const r = checkAssets(expectedAssets({ mac: true }), { mac: true });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.faltando, []);
});

test('sem os segredos da Apple a lista esperada não tem mac, e mac sobrando é só aviso', () => {
  assert.strictEqual(checkAssets(expectedAssets({ mac: false }), { mac: false }).ok, true);
  const r = checkAssets([...expectedAssets({ mac: false }), 'Rendra-IDE-mac-x64.dmg'], { mac: false });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.inesperados, ['Rendra-IDE-mac-x64.dmg']);
});

test('asset faltando reprova e é nomeado', () => {
  const nomes = expectedAssets({ mac: true }).filter(n => n !== 'Rendra-IDE.deb');
  const r = checkAssets(nomes, { mac: true });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.faltando, ['Rendra-IDE.deb']);
});

test('o .zip.blockmap do mac é esperado, o do Windows e o do dmg reprovam', () => {
  const base = expectedAssets({ mac: true });
  assert.strictEqual(checkAssets(base, { mac: true }).ok, true);
  for (const ruim of ['Rendra-IDE-Setup.exe.blockmap', 'Rendra-IDE-mac-arm64.dmg.blockmap', 'x-1.3.0-x64.nsis.7z', 'Rendra-IDE-portable.exe', 'latest-mac.json']) {
    const r = checkAssets([...base, ruim], { mac: true });
    assert.strictEqual(r.ok, false, ruim);
    assert.deepStrictEqual(r.proibidos, [ruim]);
  }
});

test('a lista esperada não tem espaço no nome', () => {
  for (const n of expectedAssets({ mac: true })) assert.ok(!/\s/.test(n), n);
});

test('contrato da release: os nomes literais, sem e com mac', () => {
  const sem = ['Rendra-IDE-Setup.exe', 'latest.yml', 'Rendra-IDE.AppImage', 'Rendra-IDE.deb', 'latest-linux.yml'];
  const mac = [
    'Rendra-IDE-mac-arm64.dmg', 'Rendra-IDE-mac-arm64.zip', 'Rendra-IDE-mac-arm64.zip.blockmap',
    'Rendra-IDE-mac-x64.dmg', 'Rendra-IDE-mac-x64.zip', 'Rendra-IDE-mac-x64.zip.blockmap',
    'latest-mac.yml',
  ];
  assert.deepStrictEqual([...expectedAssets({ mac: false })].sort(), [...sem].sort());
  assert.deepStrictEqual([...expectedAssets({ mac: true })].sort(), [...sem, ...mac].sort());
  assert.strictEqual(expectedAssets({ mac: true }).length, 12);
});
