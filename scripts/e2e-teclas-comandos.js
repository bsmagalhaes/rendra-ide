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

const LOOP = 'for($i=0;$i -lt 900;$i++){ Write-Output "tick$i"; Start-Sleep -Milliseconds 200 }';
const ultimoTick = async app => { const m = [...(await textoTerm(app)).matchAll(/tick(\d+)/g)].map(x => +x[1]); return m.length ? Math.max(...m) : -1; };
const avisoVisivel = app => app.ev(`(() => { const a = (${ULTIMO}).querySelector('.term-aviso'); return a && a.classList.contains('visible') ? a.textContent : null; })()`);
const bytes03 = async app => (await app.escritas()).filter(x => x.data.includes('\x03')).length;

caso('T4', async app => {
  console.log('\n[T4] Ctrl+C: 1 toque cola depois de 1 s, 2 avisam, 3 interrompem (tempo real, PowerShell com laço em andamento)');
  await novoTerminal(app);
  await foco(app);
  const marca = `colado-ctrlc-${Date.now() % 100000}`;
  await app.areaTexto(marca);
  await digita(app, LOOP); await enter(app);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].some(d => /tick3/.test(d.textContent))`, 15000, 'laço rodando');

  // 1 toque: nenhum \x03; antes de 1 s nada é colado; depois de 1 s o texto da área de transferência chega ao pty
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(500);
  let esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes('\x03')), '1 toque: nenhum \\x03 chega ao programa');
  afirma(!esc.some(x => x.data.includes(marca)), '1 toque, aos 500 ms: ainda não colou');
  await sleep(900);
  esc = await app.escritas();
  afirma(esc.some(x => x.data.includes(marca)), '1 toque, depois de 1 s: colou o texto da área de transferência');
  afirma(!esc.some(x => x.data.includes('\x03')), '1 toque: continua sem \\x03 depois da colagem');
  const t1 = await ultimoTick(app);
  await sleep(700);
  afirma(await ultimoTick(app) > t1, 'o programa seguiu rodando depois de 1 toque');

  // 2 toques: aviso na tela, sem colar, sem \x03; o aviso some em até 2 s; o programa segue
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(300);
  await tecla(app, CTRL_C);
  await sleep(150);
  const av = await avisoVisivel(app);
  afirma(av === 'aperte mais 1 vez para interromper', `2 toques: aviso "aperte mais 1 vez para interromper" no terminal (${JSON.stringify(av)})`);
  await fotografa(app, 'aviso-ctrl-c');
  await sleep(1200); // 1,65 s desde o primeiro toque: já passou de 1 s e o aviso continua, sem colar
  afirma(await avisoVisivel(app) !== null, 'o aviso continua visível aos 1,65 s');
  esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes(marca)), '2 toques: a colagem foi cancelada (nada colado)');
  await sleep(900); // 2,55 s
  afirma(await avisoVisivel(app) === null, 'sem o 3º toque o aviso some em até 2 s');
  esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes('\x03') || x.data.includes(marca)), '2 toques e silêncio: nada foi enviado ao programa');
  const t2 = await ultimoTick(app);
  await sleep(700);
  afirma(await ultimoTick(app) > t2, 'o programa segue rodando depois dos 2 toques');

  // 3 toques em menos de 2 s: um só \x03, o laço para, o prompt volta, o aviso some
  await app.zeraEscritas();
  await tecla(app, CTRL_C); await sleep(250);
  await tecla(app, CTRL_C); await sleep(250);
  await tecla(app, CTRL_C);
  await sleep(1200);
  afirma(await bytes03(app) === 1, `3 toques: exatamente um \\x03 chega ao programa (${await bytes03(app)})`);
  afirma(await avisoVisivel(app) === null, '3 toques: o aviso some');
  const t3 = await ultimoTick(app);
  await sleep(900);
  afirma(await ultimoTick(app) === t3, 'o laço parou de rodar (interrompido)');
  const txt = await textoTerm(app);
  afirma(txt.lastIndexOf('PS ') > txt.lastIndexOf(`tick${t3}`), 'o prompt do PowerShell voltou depois do último tick');
  esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes(marca)), '3 toques: nada foi colado');

  // segurar a tecla (autoRepeat) não conta como três toques
  await digita(app, LOOP); await enter(app);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].some(d => /tick2/.test(d.textContent))`, 15000, 'laço rodando de novo');
  await app.zeraEscritas();
  await tecla(app, CTRL_C, { soBaixo: true });
  for (let k = 0; k < 6; k++) { await tecla(app, CTRL_C, { repete: true, soBaixo: true }); await sleep(60); }
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 });
  await sleep(300);
  afirma(await bytes03(app) === 0, 'tecla segurada (repeat) não envia \\x03 nem conta como três toques');
  await sleep(2300);
  // interrompe o laço para deixar o terminal limpo
  await tecla(app, CTRL_C); await sleep(200); await tecla(app, CTRL_C); await sleep(200); await tecla(app, CTRL_C); await sleep(800);
});

caso('T4p', async app => {
  console.log('\n[T4p] painel de conversas aberto: nenhuma escrita direta nova (Ctrl+C, colar, Alt+V) e o clique na aba não devolve o foco ao xterm');
  await novoTerminal(app, { manterPainel: true });
  const tem = await app.espera(`!!(${ULTIMO}).querySelector('.term-agentes')`, 6000).catch(() => false);
  if (!tem) { pula('T4p', 'o painel de conversas não abriu (nenhum Claude Code ou Codex instalado nesta máquina)'); return; }
  const marca = `painel-${Date.now() % 100000}`;
  await app.areaTexto(marca);
  // clique na aba: o foco fica no painel
  const aba = await app.ev(`(() => { const r = (${ULTIMO.replace('.term-pane', '.term-pane')}) && document.querySelector('.ws.active .term-tab:last-of-type .term-pane-name').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await app.send('Input.dispatchMouseEvent', { type, x: aba.x, y: aba.y, button: 'left', clickCount: 1 });
  await sleep(300);
  const foc = await app.ev(`(() => { const a = document.activeElement; return { xterm: !!a.closest('.xterm'), painel: !!a.closest('.term-agentes') }; })()`);
  afirma(!foc.xterm && foc.painel, `clicar na aba com o painel aberto leva o foco ao painel, não ao xterm (${JSON.stringify(foc)})`);
  // mesmo forçando o foco no xterm, as teclas novas não escrevem no pty
  await app.ev(`(${ULTIMO}).querySelector('.xterm-helper-textarea').focus()`);
  await app.zeraEscritas();
  for (let k = 0; k < 3; k++) { await tecla(app, CTRL_C); await sleep(200); }
  await tecla(app, CTRL_V);
  await tecla(app, { key: 'v', code: 'KeyV', vk: 86, mods: ['alt'] });
  await sleep(1400);
  const esc = await app.escritas();
  const proibidos = esc.filter(x => x.data.includes('\x03') || x.data.includes('\x16') || x.data.includes('\x1bv') || x.data.includes(marca));
  afirma(proibidos.length === 0, `com o painel aberto: nenhum \\x03, \\x16, ESC v nem colagem chega ao pty (${JSON.stringify(proibidos)})`);
  await app.ev(`(${ULTIMO}).querySelector('.term-agentes button[data-nova="terminal"]').click()`);
  await sleep(300);
});

// posição (em px) de uma coluna de uma linha do terminal cuja linha inteira (sem espaços nas pontas) é `texto`
async function pontoNaLinha(app, texto) {
  return app.ev(`(() => {
    const nb = s => s.replace(/\\u00a0/g, ' ');
    const rows = [...(${ULTIMO}).querySelectorAll('.xterm-rows > div')];
    const row = rows.filter(r => nb(r.textContent).trim() === ${JSON.stringify(texto)}).at(-1);
    if (!row) return null;
    const sp = [...row.children].find(s => nb(s.textContent).includes(${JSON.stringify(texto)}));
    const r = sp.getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, cel: r.width / sp.textContent.length, dentro: nb(sp.textContent).indexOf(${JSON.stringify(texto)}) };
  })()`);
}
const mouse = (app, type, x, y, extra = {}) => app.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
// arrasta do meio da coluna `c0` até o meio da coluna `c1` (colunas dentro do texto), devagar, como a mão
async function arrasta(app, p, c0, c1) {
  const x = c => p.x + p.cel * (p.dentro + c);
  await mouse(app, 'mouseMoved', x(c0) + p.cel * 0.25, p.y);
  await mouse(app, 'mousePressed', x(c0) + p.cel * 0.25, p.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await mouse(app, 'mouseMoved', x(c0) + p.cel * 0.25 + (x(c1) - x(c0)) * k / 8, p.y, { button: 'left', buttons: 1 }); await sleep(30); }
  await mouse(app, 'mouseReleased', x(c1) + p.cel * 0.25, p.y, { button: 'left', buttons: 0, clickCount: 1 });
}
const toastAtual = app => app.ev(`(() => { const t = document.getElementById('toast'); return { texto: t.textContent, visivel: t.classList.contains('visible') }; })()`);
const realce = app => app.ev(`[...(${ULTIMO}).querySelectorAll('.xterm-selection div')].length`);

caso('T5', async app => {
  console.log('\n[T5] copiar ao marcar: marcar com o mouse copia, o realce fica e aparece "Copiado"; Ctrl+C com texto marcado só confirma');
  await novoTerminal(app);
  await foco(app);
  const LINHA = 'alfa-beta-gama-delta';
  await digita(app, `Write-Output "${LINHA}"`); await enter(app);
  await app.espera(`[...(${ULTIMO}).querySelectorAll('.xterm-rows > div')].some(d => d.textContent.replace(/\\u00a0/g, ' ').trim() === ${JSON.stringify(LINHA)})`, 10000, 'saída do comando');
  await sleep(500);
  const p = await pontoNaLinha(app, LINHA);
  afirma(!!p, 'achou a linha de saída no terminal');
  await app.areaTexto('antes-de-marcar');
  await app.ev(`window.__escritasClip = 0; (() => { const o = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = t => { window.__escritasClip++; return o(t); }; })(); true`);
  await app.ev(`document.getElementById('toast').classList.remove('visible')`);
  await app.zeraEscritas();
  await arrasta(app, p, 5, 14);
  await sleep(900);
  const copiado = await app.lerArea();
  afirma(copiado === 'beta-gama', `marcar "beta-gama" com o mouse copiou para a área de transferência (veio ${JSON.stringify(copiado)})`);
  afirma(await app.ev('window.__escritasClip') === 1, `um arraste copia uma vez só (${await app.ev('window.__escritasClip')} cópias)`);
  afirma(await realce(app) > 0, `o realce da seleção continua na tela (${await realce(app)} blocos)`);
  const to = await toastAtual(app);
  afirma(to.texto === 'Copiado' && to.visivel, `aviso discreto "Copiado" visível (${JSON.stringify(to)})`);
  await fotografa(app, 'copiado-ao-marcar');
  afirma(!(await app.escritas()).some(x => x.data.includes('beta-gama')), 'copiar não escreve nada no programa');

  // Ctrl+C com texto marcado: copia de novo, mostra "Copiado", não cola, não conta toque, não envia \x03
  await app.areaTexto('outro-texto-da-area');
  await app.ev(`document.getElementById('toast').classList.remove('visible')`);
  await app.zeraEscritas();
  await tecla(app, CTRL_C);
  await sleep(300);
  afirma(await app.lerArea() === 'beta-gama', 'Ctrl+C com texto marcado devolve a seleção à área de transferência');
  const to2 = await toastAtual(app);
  afirma(to2.texto === 'Copiado' && to2.visivel, `Ctrl+C com texto marcado mostra "Copiado" (${JSON.stringify(to2)})`);
  await sleep(1400);
  const esc = await app.escritas();
  afirma(!esc.some(x => x.data.includes('\x03') || x.data.includes('beta-gama') || x.data.includes('outro-texto')), `Ctrl+C com texto marcado não envia \\x03 nem cola, nem 1 s depois (${JSON.stringify(esc.map(x => x.data))})`);
  afirma(await realce(app) > 0, 'o realce segue depois do Ctrl+C');
  afirma(await avisoVisivel(app) === null, 'Ctrl+C com texto marcado não conta toque: nada de aviso de interromper');

  // limpar a seleção e marcar o mesmo texto de novo copia de novo
  await mouse(app, 'mousePressed', p.x + p.cel * 40, p.y - 60, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse(app, 'mouseReleased', p.x + p.cel * 40, p.y - 60, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  await app.areaTexto('limpou');
  await arrasta(app, p, 5, 14);
  await sleep(900);
  afirma(await app.lerArea() === 'beta-gama', 'depois de limpar, marcar o mesmo texto copia de novo');
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
