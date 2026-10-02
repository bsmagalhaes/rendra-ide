// Configuração do electron-builder (bloco "build" do package.json): afirmada como texto/JSON,
// porque o efeito (nomes dos assets, o que entra no pacote) é decidido aqui.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const b = pkg.build;
const alvo = t => (typeof t === 'string' ? t : t.target);

test('Windows: só NSIS x64, sem portable, sem pacote diferencial', () => {
  assert.deepStrictEqual(b.win.target.map(alvo), ['nsis']);
  const nsis = b.win.target[0];
  assert.deepStrictEqual(typeof nsis === 'string' ? ['x64'] : nsis.arch, ['x64']);
  assert.strictEqual(b.nsis.differentialPackage, false);
});

test('Windows: instalação por usuário e dados do usuário preservados', () => {
  assert.notStrictEqual(b.nsis.deleteAppDataOnUninstall, true);
  assert.notStrictEqual(b.nsis.perMachine, true);
  assert.strictEqual(b.nsis.oneClick, false);
  assert.strictEqual(b.nsis.runAfterFinish, true);
});

test('nomes dos assets fixos e sem espaço, por sistema', () => {
  assert.strictEqual(b.win.artifactName, 'Rendra-IDE-Setup.${ext}');
  assert.strictEqual(b.linux.artifactName, 'Rendra-IDE.${ext}');
  assert.strictEqual(b.mac.artifactName, 'Rendra-IDE-mac-${arch}.${ext}');
  for (const n of [b.win.artifactName, b.linux.artifactName, b.mac.artifactName]) assert.ok(!/\s/.test(n), n);
});

test('macOS: dmg e zip sem arch na config (a arquitetura vem do --arm64 ou --x64 do job)', () => {
  assert.deepStrictEqual(b.mac.target.map(alvo), ['dmg', 'zip']);
  for (const t of b.mac.target) assert.ok(typeof t === 'string' || t.arch === undefined, 'mac.target com arch');
});

test('macOS: hardened runtime ligado, notarização e entitlements próprios fora do package.json', () => {
  assert.strictEqual(b.mac.hardenedRuntime, true);
  assert.notStrictEqual(b.mac.notarize, false);
  assert.strictEqual(b.mac.notarize, undefined);
  assert.strictEqual(b.mac.entitlements, undefined);
  assert.strictEqual(b.mac.entitlementsInherit, undefined);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'build', 'entitlements.mac.plist')));
});

test('macOS: o dmg não escreve blockmap (só o zip é usado pelo updater)', () => {
  assert.strictEqual(b.dmg.writeUpdateInfo, false);
});

test('Linux: AppImage e deb x64, com nome de pacote e executável sem espaço', () => {
  assert.deepStrictEqual(b.linux.target.map(alvo).sort(), ['AppImage', 'deb']);
  assert.strictEqual(b.deb.packageName, 'rendra-ide');
  assert.strictEqual(b.linux.executableName, 'rendra-ide');
});

test('exclusões: Monaco só com min/vs e sem .pdb do node-pty', () => {
  for (const ex of [
    '!node_modules/monaco-editor/esm/**',
    '!node_modules/monaco-editor/dev/**',
    '!node_modules/monaco-editor/min-maps/**',
    '!node_modules/@lydell/**/*.pdb',
  ]) assert.ok(b.files.includes(ex), `falta ${ex} em build.files`);
  assert.ok(!b.files.some(f => /monaco-editor\/min(\/|$)/.test(f) && f.startsWith('!')), 'não pode excluir monaco-editor/min');
});

test('publicação: GitHub, rascunho (padrão) criado pelo electron-builder', () => {
  const p = b.publish[0];
  assert.strictEqual(p.provider, 'github');
  assert.ok(p.releaseType === undefined || p.releaseType === 'draft');
});

test('o renderer ainda carrega o Monaco de min/vs', () => {
  const dev = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'devcode.js'), 'utf8');
  assert.match(dev, /monaco-editor\/min\/vs/);
});
