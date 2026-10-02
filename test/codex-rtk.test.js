// Estado do Codex exposto à página do RTK: instalado/configurado no Windows OU numa distro WSL.
// Árvore falsa em pasta temporária; nenhum dado real é lido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { codexRtkState } = require('../src/codex-rtk');

function base() {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-crtk-'));
  return { win: path.join(b, 'win', '.codex'), wslSessions: path.join(b, 'distro', 'home', 'ana', '.codex', 'sessions') };
}

test('Codex só na distro WSL aparece como instalado', () => {
  const { win, wslSessions } = base();
  fs.mkdirSync(wslSessions, { recursive: true });
  const r = codexRtkState(win, [wslSessions]);
  assert.strictEqual(r.installed, true);
  assert.strictEqual(r.configured, false);
  assert.strictEqual(r.home, path.dirname(wslSessions));
});

test('RTK configurado só na distro conta como configurado', () => {
  const { win, wslSessions } = base();
  fs.mkdirSync(win, { recursive: true });
  fs.mkdirSync(wslSessions, { recursive: true });
  fs.writeFileSync(path.join(path.dirname(wslSessions), 'AGENTS.md'), '@RTK.md\n');
  const r = codexRtkState(win, [wslSessions]);
  assert.strictEqual(r.installed, true);
  assert.strictEqual(r.configured, true);
  assert.strictEqual(r.homes.length, 2);
});

test('sem Windows e sem distro: não instalado', () => {
  const { win } = base();
  const r = codexRtkState(win, []);
  assert.strictEqual(r.installed, false);
  assert.strictEqual(r.configured, false);
});
