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

// ── "Próxima versão": as entradas do RTK e do Codex ─────────────────────────
const { secao: secaoApp } = require('../renderer/novidades');
const proxima = (() => {
  const m = /^## Próxima versão\s*$/m.exec(texto);
  if (!m) return null;
  const resto = texto.slice(m.index + m[0].length);
  const fim = resto.search(/^## /m);
  return fim < 0 ? resto : resto.slice(0, fim);
})();

test('Próxima versão tem a seção "RTK e Codex" com as cinco entradas, em português do usuário e sem travessão', () => {
  assert.ok(proxima, 'faltou "## Próxima versão" logo abaixo de "# Novidades"');
  const i = proxima.indexOf('### RTK e Codex');
  assert.ok(i >= 0, 'faltou "### RTK e Codex"');
  const rtk = proxima.slice(i).split(/^### /m)[1];
  for (const trecho of [/já deixa o hook aprovado/, /aprovado, foi alterado ou ainda espera aprovação/, /workspace-write/, /só o Claude Code e o Codex/, /WinGet/, /PreToolUse/]) {
    assert.match(rtk, trecho, String(trecho));
  }
  assert.strictEqual(rtk.split('\n').filter(l => l.startsWith('- ')).length, 5);
  assert.ok(!/[—–]/.test(rtk), 'travessão na seção');
  assert.ok(!/hash|sandbox|writable_roots|trusted_hash/i.test(rtk), 'jargão na seção');
});

test('a página Novidades corta "Próxima versão" no próximo "## " e traz a seção do RTK', () => {
  const corte = secaoApp(texto, 'Próxima versão');
  assert.match(corte, /### RTK e Codex/);
  assert.ok(!/^## /m.test(corte), 'não passa do próximo título de versão');
  assert.ok(!corte.includes('Instalador do Mac'), 'não invade a 1.3.1');
  assert.ok(!corte.includes('## 1.3.1'));
});
