const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const rb = require('../src/rendra-browser');

test('a página do Rendra Browser é isolada: sem preload, sem Node, sandbox, sessão própria não persistente', () => {
  const p = rb.prefsPagina();
  assert.strictEqual(p.nodeIntegration, false);
  assert.strictEqual(p.contextIsolation, true);
  assert.strictEqual(p.sandbox, true);
  assert.strictEqual(p.webSecurity, true);
  assert.strictEqual(p.webviewTag, false);
  assert.ok(!('preload' in p), 'a página não pode ter preload');
  assert.strictEqual(p.partition, 'rendra-browser');
  assert.ok(!p.partition.startsWith('persist:'), 'sessão em memória');
  const j = rb.opcoesJanela(false).webPreferences;
  assert.ok(!('preload' in j) && j.nodeIntegration === false && j.contextIsolation === true && j.sandbox === true);
});

test('a barra tem o preload mínimo próprio, nunca o da IDE', () => {
  const b = rb.prefsBarra();
  assert.strictEqual(path.basename(b.preload), 'rendra-browser-preload.js');
  assert.strictEqual(b.nodeIntegration, false);
  assert.strictEqual(b.contextIsolation, true);
  assert.strictEqual(b.sandbox, true);
  const src = fs.readFileSync(b.preload, 'utf8');
  assert.ok(!/openExternal|get-usage-data|dev:|save-settings/.test(src), 'o preload da barra não expõe o IPC da IDE');
});

test('filtro de URL: só http(s), sem usuário e senha', () => {
  assert.strictEqual(rb.urlPermitida('https://exemplo.com/a?b=1'), 'https://exemplo.com/a?b=1');
  assert.strictEqual(rb.urlPermitida('http://127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x');
  for (const ruim of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'about:blank', 'chrome://gpu', 'ftp://a.com/x', 'blob:https://a.com/1', 'https://banco.com@mal.com/', 'C:\\Windows\\x.exe', '\\\\srv\\share', '', null, undefined, 42]) {
    assert.strictEqual(rb.urlPermitida(ruim), null, String(ruim));
  }
});

test('janela filha: nunca abre janela; http(s) vira navegação na mesma janela, o resto é negado', () => {
  assert.deepStrictEqual(rb.decideJanelaFilha('https://a.com/x'), { action: 'deny', navegarPara: 'https://a.com/x' });
  assert.deepStrictEqual(rb.decideJanelaFilha('file:///etc/passwd'), { action: 'deny', navegarPara: null });
  assert.deepStrictEqual(rb.decideJanelaFilha('javascript:1'), { action: 'deny', navegarPara: null });
});

test('permissões negadas e download cancelado na sessão do Rendra Browser', () => {
  const chamadas = {};
  const ses = {
    setPermissionRequestHandler: f => { chamadas.req = f; },
    setPermissionCheckHandler: f => { chamadas.check = f; },
    setDevicePermissionHandler: f => { chamadas.dev = f; },
    on: (ev, f) => { chamadas[ev] = f; },
  };
  rb.configuraSessao(ses);
  for (const perm of ['media', 'notifications', 'geolocation', 'camera', 'microphone']) {
    let resp = 'nada';
    chamadas.req({}, perm, r => { resp = r; });
    assert.strictEqual(resp, false, perm);
    assert.strictEqual(chamadas.check({}, perm), false, perm);
  }
  assert.strictEqual(chamadas.dev(), false);
  let cancelado = false;
  chamadas['will-download']({ preventDefault: () => { cancelado = true; } });
  assert.ok(cancelado, 'download cancelado');
});

test('app principal: só navega para a própria página', () => {
  const atual = 'file:///D:/app/renderer/index.html';
  assert.strictEqual(rb.navegacaoDoAppPermitida(atual, atual), true);
  assert.strictEqual(rb.navegacaoDoAppPermitida('https://exemplo.com/', atual), false);
  assert.strictEqual(rb.navegacaoDoAppPermitida('file:///C:/x.html', atual), false);
});

test('criarRendraBrowser recusa URL fora de http(s) sem tocar o Electron', () => {
  assert.strictEqual(rb.criarRendraBrowser({}, 'file:///x'), null);
  assert.strictEqual(rb.criarRendraBrowser({}, 'javascript:1'), null);
});

test('o main nega janelas e navegação não pedidas e expõe só a abertura confirmada', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /web-contents-created/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /will-navigate/);
  const dev = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'devcode.js'), 'utf8');
  assert.ok(!/window\.open\(|window\.confirm\(|[^.\w]confirm\(/.test(dev), 'o renderer não usa window.open nem confirm');
  assert.match(dev, /Abrir no Rendra Browser/);
  assert.match(dev, /Abrir no navegador padrão/);
});

// ── criarRendraBrowser com Electron falso: os bloqueios de navegação ─────────────────────────────────────────────
const { EventEmitter } = require('events');
function montarFalso(urlAtual = 'http://localhost/') {
  const wcs = [];
  class WC extends EventEmitter {
    constructor() { super(); this.id = wcs.push(this); this.hist = [urlAtual]; this.i = 0; this.carregou = []; this.navigationHistory = { canGoBack: () => this.i > 0, canGoForward: () => false, goBack: () => { this.i--; this.voltou = (this.voltou || 0) + 1; }, getActiveIndex: () => this.i, getEntryAtIndex: n => this.hist[n] ? { url: this.hist[n] } : null, goToIndex: n => { this.i = n; }, removeEntryAtIndex: n => { this.hist.splice(n, 1); } }; }
    getURL() { return this.hist[this.i]; } isDestroyed() { return false; } setWindowOpenHandler() {} send() {} close() {}
    loadURL(u) { this.carregou.push(u); return Promise.resolve(); } loadFile() {} getLastWebPreferences() { return {}; }
  }
  class Win extends EventEmitter { constructor() { super(); this.contentView = { addChildView() {} }; } removeMenu() {} getContentBounds() { return { width: 800, height: 600 }; } isDestroyed() { return false; } setTitle() {} once() {} }
  class View { constructor() { this.webContents = new WC(); } setBounds() {} }
  const ses = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, on() {} };
  const electron = { BrowserWindow: Win, WebContentsView: View, session: { fromPartition: () => ses }, ipcMain: { on() {}, removeListener() {} }, shell: {} };
  return { electron, wcs };
}
const tenta = (wc, ev, url) => { let barrou = false; wc.emit(ev, { preventDefault: () => { barrou = true; } }, url); return barrou; };

test('Rendra Browser: will-navigate e will-redirect cancelam o que não é http(s) e deixam passar http(s)', () => {
  const { electron, wcs } = montarFalso();
  assert.ok(rb.criarRendraBrowser(electron, 'http://localhost/'));
  const pagina = wcs[0];
  for (const ev of ['will-navigate', 'will-redirect']) {
    for (const ruim of ['file:///C:/Windows/win.ini', 'data:text/html,x', 'blob:http://localhost/abc', 'javascript:alert(1)', 'about:blank', 'http://u:p@localhost/', '']) assert.strictEqual(tenta(pagina, ev, ruim), true, `${ev} ${ruim}`);
    for (const bom of ['http://localhost/x', 'https://exemplo.com/a?b=1']) assert.strictEqual(tenta(pagina, ev, bom), false, `${ev} ${bom}`);
  }
});

test('Rendra Browser: about:blank que a página provoca (did-navigate) volta à página anterior e apaga a entrada; http(s) e página de erro ficam', () => {
  const { electron, wcs } = montarFalso();
  rb.criarRendraBrowser(electron, 'http://localhost/');
  const pagina = wcs[0];
  pagina.hist = ['http://localhost/', 'http://localhost/b']; pagina.i = 1;
  pagina.emit('did-navigate', {}, 'http://localhost/b');
  pagina.emit('did-navigate', {}, 'chrome-error://chromewebdata/');
  assert.deepStrictEqual([pagina.voltou || 0, pagina.carregou.length], [0, 1], 'http(s) e página de erro não desfazem nada (só o carregamento inicial)');
  pagina.hist.push('about:blank'); pagina.i = 2;
  pagina.emit('did-navigate', {}, 'about:blank');
  assert.strictEqual(pagina.i, 1, 'voltou para a página anterior');
  pagina.emit('did-navigate', {}, 'http://localhost/b'); // a volta termina: a entrada em branco é apagada
  assert.deepStrictEqual(pagina.hist, ['http://localhost/', 'http://localhost/b']);
  const sem = montarFalso();
  rb.criarRendraBrowser(sem.electron, 'http://localhost/');
  sem.wcs[0].emit('did-navigate', {}, 'about:blank'); // sem entrada anterior: recarrega a URL inicial
  assert.strictEqual(sem.wcs[0].carregou.at(-1), 'http://localhost/');
});
