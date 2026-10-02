// Botão "Nova versão" e texto de progresso: função pura que o renderer usa (sem DOM).
const test = require('node:test');
const assert = require('node:assert');
const { updateUi, precisaConfirmar } = require('../renderer/update-ui');

test('disponível e pronta mostram o botão, com o título de cada estado', () => {
  const a = updateUi({ state: 'available', version: '1.3.0', mode: 'git' });
  assert.strictEqual(a.mostrarBotao, true);
  assert.strictEqual(a.titulo, 'Versão 1.3.0 disponível: clique para atualizar');
  const r = updateUi({ state: 'ready', version: '1.3.0' });
  assert.strictEqual(r.mostrarBotao, true);
  assert.strictEqual(r.titulo, 'Versão 1.3.0 baixada: clique para reiniciar e atualizar');
});

test('baixando mostra o progresso e esconde o botão', () => {
  const d = updateUi({ state: 'downloading', version: '1.3.0', percent: 42 });
  assert.strictEqual(d.mostrarBotao, false);
  assert.strictEqual(d.mostrarStatus, true);
  assert.strictEqual(d.textoStatus, 'Baixando a versão 1.3.0 · 42%…');
  assert.strictEqual(updateUi({ state: 'downloading', version: '1.3.0' }).textoStatus, 'Baixando a versão 1.3.0…');
});

test('idle, erro e estado vazio não mostram nada', () => {
  for (const s of [{ state: 'idle' }, { state: 'error', error: 'x' }, null, undefined]) {
    const u = updateUi(s);
    assert.strictEqual(u.mostrarBotao, false);
    assert.strictEqual(u.mostrarStatus, false);
  }
});

test('modos store e none nunca mostram "Nova versão", nem se o estado vier como disponível', () => {
  for (const mode of ['store', 'none']) {
    for (const state of ['available', 'ready', 'downloading', 'idle']) {
      const u = updateUi({ state, mode, version: '9.9.9' });
      assert.strictEqual(u.mostrarBotao, false, `${mode}/${state}`);
      assert.strictEqual(u.mostrarStatus, false, `${mode}/${state}`);
    }
  }
});

test('o confirm() só existe no modo git', () => {
  assert.strictEqual(precisaConfirmar({ mode: 'git' }), true);
  assert.strictEqual(precisaConfirmar({ state: 'ready' }), false);
  assert.strictEqual(precisaConfirmar({ mode: 'store' }), false);
  assert.strictEqual(precisaConfirmar(null), false);
});
