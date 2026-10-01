// Modal de Novidades da primeira abertura depois de atualizar: regras puras (quando abrir, que
// trecho do CHANGELOG mostrar). O comportamento na tela (só fecha pelo botão) é afirmado no e2e.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { deveAbrir, secao } = require('../renderer/novidades');

test('abre só quando a versão vista existe e é diferente da atual', () => {
  assert.strictEqual(deveAbrir('1.1.4', '1.1.5'), true);
  assert.strictEqual(deveAbrir('1.1.5', '1.1.5'), false, 'já viu esta versão');
  assert.strictEqual(deveAbrir(null, '1.1.5'), false, 'instalação nova não tem o que comparar');
  assert.strictEqual(deveAbrir('', '1.1.5'), false);
  assert.strictEqual(deveAbrir('1.1.4', ''), false);
  assert.strictEqual(deveAbrir('1.1.4', null), false);
});

test('mostra uma vez por versão: depois de marcada como vista não abre de novo', () => {
  let guardada = '1.1.4';
  assert.strictEqual(deveAbrir(guardada, '1.1.5'), true);
  guardada = '1.1.5'; // o botão Fechar grava a versão
  assert.strictEqual(deveAbrir(guardada, '1.1.5'), false);
});

test('secao devolve só o trecho da versão pedida', () => {
  const md = '# Novidades\n\n## Próxima versão\n- futuro\n\n## 1.1.5 · 02/10/2026\n### A\n- novo\n\n## 1.1.4 · 01/10/2026\n- antigo\n';
  assert.strictEqual(secao(md, '1.1.5'), '### A\n- novo');
  assert.strictEqual(secao(md, '1.1.4'), '- antigo');
  assert.strictEqual(secao(md, '9.9.9'), '');
  assert.strictEqual(secao(md.replace(/\n/g, '\r\n'), '1.1.4'), '- antigo');
});

test('o index.html tem o modal e o botão de nova versão, e o modal não tem fechamento por fora', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="novidades-overlay"/);
  assert.match(html, /id="novidades-fechar"/);
  assert.match(html, /id="nav-update"[^>]*hidden/);
  assert.match(html, /<script src="novidades\.js">/);
});
