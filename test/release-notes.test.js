// Notas da release: estável exige a seção da versão; pré-release cai na versão-base ou na "Próxima versão".
const test = require('node:test');
const assert = require('node:assert');
const { releaseNotes } = require('../scripts/release-notes');

const md = '# Novidades\n\n## Próxima versão\n### Futuro\n- coisa\n\n## 1.3.0 · 03/10/2026\n### Instaladores\n- item\n\n## 1.2.1 · 02/10/2026\n- antigo\n';

test('versão estável usa a própria seção e traz o link do README', () => {
  const n = releaseNotes(md, '1.3.0', 'bsmagalhaes/rendra-ui-ide');
  assert.match(n, /### Instaladores/);
  assert.doesNotMatch(n, /Futuro|antigo/);
  assert.match(n, /github\.com\/bsmagalhaes\/rendra-ui-ide#instalação/);
});

test('versão estável sem seção devolve null (o job falha)', () => {
  assert.strictEqual(releaseNotes(md, '1.4.0', 'a/b'), null);
});

test('pré-release usa a seção da versão-base, ou a Próxima versão, ou um aviso de teste', () => {
  assert.match(releaseNotes(md, '1.3.0-rc.1', 'a/b'), /### Instaladores/);
  assert.match(releaseNotes(md, '1.3.0-rc.1', 'a/b'), /Pré-lançamento de teste/);
  assert.match(releaseNotes(md, '1.9.0-rc.1', 'a/b'), /### Futuro/);
  assert.match(releaseNotes('# Novidades\n', '1.9.0-rc.1', 'a/b'), /Não use em produção/);
});
