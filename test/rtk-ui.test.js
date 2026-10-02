// Fiação estática da página RTK: o canal antigo codex-init sumiu, os novos têm chamador na tela
// e a nota antiga ("o RTK não separa por agente") não existe mais.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = ler('renderer/app.js');
const html = ler('renderer/index.html');
const preload = ler('preload.js');
const status = ler('src/rtk-status.js');

test('codex-init não é citado em lugar nenhum da IDE', () => {
  for (const [nome, txt] of [['renderer/app.js', app], ['renderer/index.html', html], ['preload.js', preload], ['main.js', ler('main.js')], ['src/rtk-status.js', status]]) {
    assert.ok(!txt.includes('codex-init'), `${nome} ainda cita codex-init`);
  }
  assert.ok(!html.includes('rtk-codex-enable'));
});

test('rtk-install e rtk-enable estão no preload e a tela chama os dois', () => {
  assert.match(preload, /rtkInstall:\s*\(envId\)\s*=>\s*ipcRenderer\.invoke\('rtk-install'/);
  assert.match(preload, /rtkEnable:\s*\(envId, agent\)\s*=>\s*ipcRenderer\.invoke\('rtk-enable'/);
  assert.match(app, /tm\.rtkInstall\(envId\)/);
  assert.match(app, /tm\.rtkEnable\(envId, agent\)/);
  assert.match(app, /RA\.confirmText\(agent, env\.label, files\)/, 'ativar pede confirmação listando os arquivos');
});

test('a nota antiga saiu e a nova diz que cada agente tem banco próprio', () => {
  assert.ok(!/não separa por agente/.test(html));
  assert.match(html, /Cada agente grava em um banco próprio e o total soma os sistemas/);
  assert.match(html, /histórico anterior à versão 1\.2\.0 está na conta do Claude Code/);
});

test('a tabela e o terminal dizem que leem o Claude Code neste sistema; os 12 botões de leitura continuam', () => {
  assert.match(html, /Por comando \(Claude Code, neste sistema\)/);
  assert.match(html, /Os botões leem o banco do Claude Code neste sistema\./);
  assert.strictEqual((html.match(/class="rtk-btn"/g) || []).length, 12);
});

test('o gráfico diário lê as cores dos tokens e o verde fixo saiu', () => {
  assert.match(app, /cssColor\('--orange'\)/);
  assert.match(app, /cssColor\('--codex'\)/);
  assert.ok(!app.includes('rgba(76,175,117,0.8)'));
});

test('rtk-agents.js é carregado antes de app.js', () => {
  assert.ok(html.indexOf('rtk-agents.js') > 0 && html.indexOf('rtk-agents.js') < html.indexOf('src="app.js"'));
});
