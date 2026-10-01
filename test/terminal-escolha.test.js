const test = require('node:test');
const assert = require('node:assert');
const { opcoesDeTerminal, caminhoNoWsl } = require('../renderer/terminal-escolha');

const ps = { key: 'powershell', label: 'PowerShell' };

test('sem WSL há uma opção só e o terminal abre direto', () => {
  assert.deepStrictEqual(opcoesDeTerminal(ps, { available: false, distros: [] }), [{ shell: 'powershell', label: 'Windows (PowerShell)' }]);
  assert.strictEqual(opcoesDeTerminal(ps, null).length, 1);
  assert.strictEqual(opcoesDeTerminal(ps, undefined).length, 1);
});

test('com WSL: Windows (PowerShell) e uma opção por distro', () => {
  const o = opcoesDeTerminal(ps, { available: true, distros: [{ name: 'Ubuntu' }, { name: 'Debian' }] });
  assert.deepStrictEqual(o.map(x => x.label), ['Windows (PowerShell)', 'WSL (Ubuntu)', 'WSL (Debian)']);
  assert.deepStrictEqual(o.map(x => x.shell), ['powershell', 'wsl:Ubuntu', 'wsl:Debian']);
});

test('o rótulo do Windows segue o shell padrão escolhido', () => {
  const o = opcoesDeTerminal({ key: 'gitbash', label: 'Git Bash' }, { available: true, distros: [{ name: 'Ubuntu' }] });
  assert.strictEqual(o[0].label, 'Windows (Git Bash)');
  assert.strictEqual(o[0].shell, 'gitbash');
});

test('caminho do Windows visto de dentro do WSL', () => {
  assert.strictEqual(caminhoNoWsl('C:\\projetos\\exemplo'), '/mnt/c/projetos/exemplo');
  assert.strictEqual(caminhoNoWsl('D:/a/b/'), '/mnt/d/a/b');
  assert.strictEqual(caminhoNoWsl('C:\\'), '/mnt/c');
  assert.strictEqual(caminhoNoWsl('\\\\wsl.localhost\\Ubuntu\\home'), null);
  assert.strictEqual(caminhoNoWsl(''), null);
});
