const test = require('node:test');
const assert = require('node:assert');
const { compareVersions, changelogSection } = require('../src/git-updater');

test('compara versões numericamente', () => {
  assert.strictEqual(compareVersions('1.10.0', '1.9.3'), 1);
  assert.strictEqual(compareVersions('1.1.0', '1.1.0'), 0);
  assert.strictEqual(compareVersions('1.0.9', '1.1.0'), -1);
  assert.strictEqual(compareVersions('2.0.0-beta.1', '2.0.0'), 0);
});

test('extrai a seção de uma versão do CHANGELOG', () => {
  const md = '# Novidades\n\n## 1.2.0 · 01/10/2026\n\n### App\n- Novo\n\n## 1.1.0 · 26/09/2026\n\n- Antigo\n';
  assert.strictEqual(changelogSection(md, '1.2.0'), '### App\n- Novo');
  assert.strictEqual(changelogSection(md, '1.1.0'), '- Antigo');
  assert.strictEqual(changelogSection(md, '1.1'), '');
});

test('o CHANGELOG tem a seção da versão atual', () => {
  const fs = require('fs');
  const path = require('path');
  const { version } = require('../package.json');
  const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  assert.ok(changelogSection(md, version), `falta "## ${version} · DD/MM/AAAA" no CHANGELOG.md`);
});
