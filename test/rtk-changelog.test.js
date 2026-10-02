// CHANGELOG da versão do RTK por agente: a seção da versão existe, não está vazia, está em
// pt-BR sem travessão e não cita a pasta de trabalho interna (regra 5 do guarda-chuva Rendra).
// A 1.2.0 já foi publicada: a seção é a dela, mesmo com uma "## Próxima versão" de outra frente no CHANGELOG.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const texto = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
const secao = (() => {
  const m = /^## (1\.2\.0 · \d{2}\/\d{2}\/\d{4})\s*$/m.exec(texto);
  if (!m) return null;
  const resto = texto.slice(m.index + m[0].length);
  const fim = resto.search(/^## /m);
  return fim < 0 ? resto : resto.slice(0, fim);
})();

test('a seção da versão do RTK existe e não está vazia', () => {
  assert.ok(secao, 'faltou "## 1.2.0 · DD/MM/AAAA" no CHANGELOG.md');
  assert.ok(secao.trim().length > 200);
  assert.match(secao, /^### /m, 'tem subtítulo ###');
  assert.match(secao, /^- /m, 'tem itens');
});

test('descreve o que muda para o usuário', () => {
  for (const trecho of [/0\.50\.0/, /Windows, Linux/, /caminho absoluto/, /banco próprio/, /laranja/, /azul/, /WSL desligado/, /\/hooks/, /cópia de segurança/]) {
    assert.match(secao, trecho, String(trecho));
  }
});

test('sem travessão e sem citar o processo interno', () => {
  assert.ok(!/[—–]/.test(secao), 'a seção tem travessão (— ou –)');
  // os termos são montados por pedaços: nada rastreado pode citá-los (nem este teste)
  const interno = ['proces' + 'so/', 'docs/super' + 'powers'];
  for (const termo of interno) assert.ok(!texto.includes(termo), `o CHANGELOG cita ${termo}`);
});
