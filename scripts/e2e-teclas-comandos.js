// Prova de ponta a ponta das teclas do terminal e da página "Comandos": app real em sandbox, janela oculta
// (RENDRA_E2E_HIDDEN=1), home e dados em pasta temporária. A área de transferência é a do sistema, preparada
// e lida pelo main (--inspect) só durante a execução; a escrita no pty é espiada no main embrulhando o listener
// de `pty:write` (nada de produção muda). Tempo real: os timers de 1 s e 2 s do Ctrl+C são o objeto da prova.
// Fora do npm test: abre o Electron e leva minutos.
// Uso: node scripts/e2e-teclas-comandos.js [--saida=<pasta das capturas>] [--caso=T1,T2]. Sai com 1 se algo falhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const SAIDA = path.resolve(arg('saida') || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-teclas'));
const FILTRO = arg('caso') ? arg('caso').split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const puladas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };
const pula = (caso, motivo) => { console.log(`  - pulado: ${motivo}`); puladas.push(`${caso}: ${motivo}`); };
const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const WIN = process.platform === 'win32';
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

// PNG sólido gerado sem dependências (para colocar uma imagem na área de transferência)
function pngBase64(w, h) {
  const zlib = require('zlib');
  const crc32 = buf => { let crc = 0xffffffff; for (const b of buf) { let c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
  const pedaco = (tipo, dados) => { const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const td = Buffer.concat([Buffer.from(tipo), dados]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = []; for (let y = 0; y < h; y++) { linhas.push(Buffer.from([0])); linhas.push(Buffer.alloc(w * 3, 0xe8)); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pedaco('IHDR', ihdr), pedaco('IDAT', zlib.deflateSync(Buffer.concat(linhas))), pedaco('IEND', Buffer.alloc(0))]).toString('base64');
}

// ── Sandbox ─────────────────────────────────────────────────────────────────
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-teclas-'));
  const home = path.join(dir, 'home'), data = path.join(dir, 'data'), projeto = path.join(home, 'projetos', 'demo');
  escreve(path.join(projeto, 'a.txt'), 'arquivo a\n');
  escreve(path.join(projeto, 'b.txt'), 'arquivo b\n');
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list: [{ name: 'demo', custom: false, cols: 1, root: projeto, groups: [] }], active: 0 } },
  }, null, 2));
  return { dir, home, data, projeto, limpa: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* em uso */ } } };
}

// ── CDP ─────────────────────────────────────────────────────────────────────
function cliente(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pend = {}; let id = 0;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (!pend[m.id]) return; m.error ? pend[m.id].reject(new Error(m.error.message)) : pend[m.id].resolve(m.result); delete pend[m.id]; };
  const pronto = new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pend[i] = { resolve, reject }; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression, extra = {}) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description || ''}`.slice(0, 400));
    return r.result?.value;
  };
  return { ws, send, ev, pronto };
}
async function alvo(porta, tipo) {
  for (let i = 0; i < 80; i++) {
    try { const a = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); const t = a.find(x => !tipo || x.type === tipo); if (t) return t; } catch { /* iniciando */ }
    await sleep(500);
  }
  return null;
}

// ── App ─────────────────────────────────────────────────────────────────────
const REQ = `((process.mainModule && process.mainModule.require) || (typeof require === 'function' ? require : null))`;
async function abrir(sb) {
  const porta = 9400 + Math.floor(Math.random() * 400), portaMain = porta + 1000;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`, `--inspect=${portaMain}`], { cwd: ROOT, env, stdio: 'ignore' });
  console.log(`  electron pid ${proc.pid}`);
  const app = { proc, porta };
  const tMain = await alvo(portaMain);
  if (!tMain) throw new Error('inspector do main inacessível');
  app.main = cliente(tMain.webSocketDebuggerUrl); await app.main.pronto;
  const mev = (expr) => app.main.ev(expr, { includeCommandLineAPI: true });
  app.mev = mev;
  // o main só registra os canais quando termina de subir
  for (let i = 0; i < 100; i++) {
    const pronto = await mev(`(() => { const m = ${REQ}('electron').ipcMain; return m.listeners('pty:write').length > 0 && !!(m._invokeHandlers && m._invokeHandlers.get && m._invokeHandlers.get('dev:open-folder')); })()`).catch(() => false);
    if (pronto) break;
    await sleep(300);
  }
  // espia pty:write (bytes entregues ao programa) e dev:open-folder (sem diálogo real: devolve cancelado)
  const r = await mev(`(() => {
    const { ipcMain } = ${REQ}('electron');
    globalThis.__escritas = []; globalThis.__abrirPasta = 0;
    const ls = ipcMain.listeners('pty:write'); ipcMain.removeAllListeners('pty:write');
    ipcMain.on('pty:write', (e, m) => { globalThis.__escritas.push({ t: Date.now(), data: m && m.data }); for (const l of ls) l(e, m); });
    const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get && ipcMain._invokeHandlers.get('dev:open-folder');
    if (h) ipcMain._invokeHandlers.set('dev:open-folder', async () => { globalThis.__abrirPasta++; return null; });
    return JSON.stringify({ ls: ls.length, abrirPasta: !!h });
  })()`);
  app.espiao = JSON.parse(r);
  const tPag = await alvo(porta, 'page');
  if (!tPag) throw new Error('o app não abriu');
  app.pag = cliente(tPag.webSocketDebuggerUrl); await app.pag.pronto;
  const { send, ev } = app.pag;
  app.send = send; app.ev = ev;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  // janela oculta: sem isso o navigator.clipboard.readText rejeita com "Document is not focused"
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  app.espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await ev(expr)) return true; } catch { /* carregando */ } await sleep(120); } throw new Error(`tempo esgotado: ${msg}`); };
  // bytes entregues ao pty; as respostas automáticas do xterm (DA, foco, cores) começam com ESC e não contam como digitação
  app.escritas = async () => JSON.parse(await mev('JSON.stringify(globalThis.__escritas)')).filter(x => typeof x.data === 'string');
  app.zeraEscritas = () => mev('globalThis.__escritas.length = 0');
  app.abrirPasta = () => mev('globalThis.__abrirPasta');
  app.areaTexto = t => mev(`${REQ}('electron').clipboard.writeText(${JSON.stringify(t)})`);
  // só imagem (PNG gerado aqui, 8x8) na área de transferência do sistema, pela API do Electron 44
  app.areaImagem = () => mev(`(async () => { const { clipboard, ClipboardItem } = ${REQ}('electron'); clipboard.clear(); await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from('${pngBase64(8, 8)}', 'base64')], { type: 'image/png' }) })]); return true; })()`);
  app.lerArea = () => mev(`${REQ}('electron').clipboard.readText()`);
  app.fechar = async () => {
    try { app.pag.ws.close(); app.main.ws.close(); } catch { /* fechado */ }
    try { if (WIN) execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); } catch { /* já encerrou */ }
    await sleep(1500);
  };
  await app.espera(`!!document.querySelector('.ws.active')`, 40000, 'workspace ativo');
  return app;
}

// ── Passos reutilizáveis ────────────────────────────────────────────────────
const ULTIMO = `[...document.querySelectorAll('.ws.active .term-pane')].at(-1)`;
const PROMPT = alvoEl => `((${alvoEl}) ? [...(${alvoEl}).querySelectorAll('.xterm-rows > div')] : []).some(d => /[>$#]\\s*$/.test(d.textContent.replace(/\\u00a0/g, ' ').trimEnd()))`;
// texto do terminal; `junto` une as linhas (uma linha longa do prompt quebra no meio da palavra)
const textoTerm = (app, alvoEl = ULTIMO) => app.ev(`[...(${alvoEl}).querySelectorAll('.xterm-rows > div')].map(d => d.textContent.replace(/\\u00a0/g, ' ')).join('\\n')`);

// manterPainel: deixa aberto o painel de conversas (aparece quando há Claude Code ou Codex instalados); por padrão
// escolhe "Só o terminal", como o usuário faria, para o terminal receber teclas
async function novoTerminal(app, { manterPainel = false } = {}) {
  const antes = await app.ev(`document.querySelectorAll('.ws.active .term-pane').length`);
  await app.ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
  await sleep(500);
  if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
  await app.espera(`document.querySelectorAll('.ws.active .term-pane').length === ${antes + 1}`, 20000, 'terminal aberto');
  await app.espera(PROMPT(ULTIMO), 30000, 'prompt do shell');
  const painel = await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 6000).catch(() => false);
  if (painel && !manterPainel) { await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`); await sleep(300); }
  await sleep(600);
  return ULTIMO;
}
async function foco(app, alvoEl = ULTIMO) {
  const r = await app.ev(`(() => { const r = (${alvoEl}).querySelector('.term-pane-body').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  for (const type of ['mousePressed', 'mouseReleased']) await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await sleep(200);
  await app.ev(`(${alvoEl}).querySelector('.xterm-helper-textarea').focus()`); // garante o foco do xterm
  await sleep(100);
  return r;
}
// tecla com modificadores: { key, code, vk, mods: ['ctrl', 'shift'] }
async function tecla(app, { key, code, vk, mods = [], text }, { repete = false, soBaixo = false } = {}) {
  const modifiers = mods.reduce((a, m) => a | MOD[m], 0);
  await app.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text, autoRepeat: repete });
  if (!soBaixo) await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
}
const CTRL_V = { key: 'v', code: 'KeyV', vk: 86, mods: ['ctrl'] };
const CTRL_C = { key: 'c', code: 'KeyC', vk: 67, mods: ['ctrl'] };
const digita = async (app, t) => { await app.send('Input.insertText', { text: t }); };
const enter = async app => { for (const type of ['keyDown', 'keyUp']) await app.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined }); };
const fotografa = async (app, nome) => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const { data } = await app.send('Page.captureScreenshot', { format: 'png' });
  const arq = path.join(SAIDA, `${nome}.png`);
  fs.writeFileSync(arq, Buffer.from(data, 'base64'));
  console.log(`  captura: ${arq}`);
};

// ── Casos (cada tarefa acrescenta o seu) ────────────────────────────────────
const casos = [];
const caso = (nome, fn) => casos.push({ nome, fn });

caso('T1', async app => {
  console.log('\n[T1] Ctrl+V cola o texto da área de transferência real (antes falhava: availableFormats inexistente)');
  await novoTerminal(app);
  await foco(app);
  const marca = `colado-t1-${Date.now() % 100000}`;
  await app.areaTexto(`echo ${marca}`);
  await app.zeraEscritas();
  await tecla(app, CTRL_V);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].map(d => d.textContent.replace(/\u00a0/g, ' ')).join('').includes('echo ${marca}')`, 8000, 'texto colado no prompt').catch(() => { });
  afirma((await textoTerm(app)).split('\n').join('').includes(`echo ${marca}`), `Ctrl+V colou "${marca}" no prompt do terminal`);
  const esc = await app.escritas();
  afirma(esc.some(x => x.data.includes(`echo ${marca}`)), 'o texto colado chegou ao pty');
  afirma(!esc.some(x => x.data === '\x16'), 'com texto na área de transferência, nenhum \\x16 é enviado');
  // só imagem na área de transferência: o canal clip:has-image (corrigido) detecta e o \x16 vai ao programa
  await app.areaImagem();
  await app.zeraEscritas();
  await tecla(app, CTRL_V);
  await sleep(600);
  const esc2 = await app.escritas();
  afirma(esc2.some(x => x.data === '\x16'), 'só imagem na área de transferência: o Ctrl+V entrega \\x16 ao programa');
});

// ── Execução ────────────────────────────────────────────────────────────────
(async () => {
  const sb = sandbox();
  let app;
  try {
    app = await abrir(sb);
    afirma(app.espiao.ls >= 1 && app.espiao.abrirPasta, `espiões instalados no main: ${JSON.stringify(app.espiao)}`);
    for (const c of casos) {
      if (FILTRO && !FILTRO.some(f => c.nome === f)) continue;
      try { await c.fn(app); } catch (e) { afirma(false, `${c.nome} lançou: ${e.message}`); }
    }
  } catch (e) {
    afirma(false, `erro geral: ${e.stack || e.message}`);
  } finally {
    if (app) await app.fechar();
    sb.limpa();
  }
  console.log(`\n${falhas.length ? 'FALHOU' : 'OK'}: ${falhas.length} falha(s), ${puladas.length} pulado(s)`);
  for (const p of puladas) console.log(`  pulado: ${p}`);
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(falhas.length ? 1 : 0);
})();
