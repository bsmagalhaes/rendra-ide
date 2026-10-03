// Contrato da estrutura da barra de título: o seletor, a conta e os dois itens de limite ficam dentro
// de #consumo-bar, que fica entre .app-name e .title-bar-right. Lê o HTML do app (sem navegador).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const i = marca => html.indexOf(marca);
const inicio = i('<div id="consumo-bar"');
const fim = i('<div class="title-bar-right">');
const bloco = html.slice(inicio, fim);

test('#consumo-bar fica entre .app-name e .title-bar-right, dentro de #title-bar', () => {
  assert.ok(inicio > 0 && fim > inicio, 'bloco da barra encontrado');
  assert.ok(i('<div id="title-bar"') < i('<div class="app-name">') && i('<div class="app-name">') < inicio, '.app-name vem antes da barra');
  assert.ok(fim < i('</div>\n\n', fim) || fim > 0, '.title-bar-right vem depois');
});

test('o seletor, a organização, o e-mail, o "sem dados" e os dois itens estão dentro de #consumo-bar', () => {
  assert.match(bloco, /<select id="consumo-provedor"[^>]*aria-label="Provedor e ambiente"/);
  assert.match(bloco, /id="consumo-nome"/);
  assert.match(bloco, /id="consumo-email"/);
  assert.match(bloco, /id="consumo-semdados"/);
  assert.match(bloco, /class="consumo-item" data-kind="session"/);
  assert.match(bloco, /class="consumo-item" data-kind="weekly_all"/);
  assert.strictEqual((bloco.match(/class="consumo-item"/g) || []).length, 2);
  assert.ok(bloco.indexOf('consumo-provedor') < bloco.indexOf('data-kind="session"'), 'o seletor vem antes dos itens');
  assert.ok(bloco.indexOf('consumo-nome') < bloco.indexOf('consumo-email'), 'organização antes do e-mail');
});

test('a barra e seus controles começam escondidos e a barra segue como grupo acessível', () => {
  assert.match(bloco, /^<div id="consumo-bar" role="group" aria-label="Consumo do plano do Claude Code" hidden>/);
  for (const id of ['consumo-provedor', 'consumo-nome', 'consumo-email', 'consumo-semdados']) {
    assert.match(bloco, new RegExp(`id="${id}"[^>]*hidden`), `${id} começa escondido`);
  }
});

test('o CSS tira o seletor da área de arrasto (a barra é no-drag) e deixa o e-mail com reticências', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const barra = css.slice(css.indexOf('#consumo-bar {'), css.indexOf('#consumo-bar {') + 300);
  assert.match(barra, /-webkit-app-region:\s*no-drag/);
  assert.match(css, /\.consumo-nome,\s*\.consumo-email\s*\{[^}]*text-overflow:\s*ellipsis/);
});
