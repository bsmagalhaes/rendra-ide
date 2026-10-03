// Prova de ponta a ponta dos links do terminal: app real em sandbox, janela oculta (RENDRA_E2E_HIDDEN=1) e
// shell.openExternal do main substituído por um registrador (via --inspect) ANTES de qualquer clique: nada abre o
// navegador. Fora do npm test. Uso: node scripts/e2e-links-terminal.js [--saida=<pasta da foto>]. Sai com 1 se falhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argSaida = (process.argv.find(a => a.startsWith('--saida=')) || '').slice(8);
const SAIDA = path.resolve(argSaida || process.env.RENDRA_E2E_OUT || path.join(os.tmpdir(), 'rendra-e2e-links'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const falhas = [];
const afirma = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas.push(m); return c; };

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-links-'));
  const home = path.join(dir, 'home'), data = path.join(dir, 'data'), projeto = path.join(home, 'projetos', 'demo');
  const escreve = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  escreve(path.join(projeto, 'a.txt'), 'a\n');
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
    devcode: { workspaces: { list: [{ name: 'demo', custom: false, cols: 1, root: projeto, groups: [] }], active: 0 } },
  }, null, 2));
  return { dir, home, data, projeto };
}

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

async function alvos(porta, tipo) {
  for (let i = 0; i < 80; i++) {
    try { const a = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); const t = a.find(x => !tipo || x.type === tipo); if (t) return t; } catch { /* iniciando */ }
    await sleep(500);
  }
  return null;
}

(async () => {
  const sb = sandbox();
  const porta = 9400 + Math.floor(Math.random() * 400), portaMain = porta + 1000;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`, `--inspect=${portaMain}`], { cwd: ROOT, env, stdio: 'ignore' });
  console.log(`electron pid ${proc.pid}`);
  let pagina, main;
  try {
    // 1) main: substitui shell.openExternal ANTES de qualquer clique
    const tMain = await alvos(portaMain);
    afirma(!!tMain, 'inspector do main acessível (--inspect)');
    let stubOk = false;
    if (tMain) {
      main = cliente(tMain.webSocketDebuggerUrl); await main.pronto;
      const r = await main.ev(`(() => { const req = (process.mainModule && process.mainModule.require) || (typeof require === 'function' ? require : null); if (!req) return 'sem require'; const { shell } = req('electron'); globalThis.__abertos = []; shell.openExternal = async u => { globalThis.__abertos.push(u); }; return shell.openExternal.toString().includes('__abertos') ? 'ok' : 'falhou'; })()`, { includeCommandLineAPI: true });
      stubOk = r === 'ok';
      afirma(stubOk, `shell.openExternal substituído no main: ${r}`);
    }
    const abertos = () => main.ev('JSON.stringify(globalThis.__abertos || null)').then(JSON.parse);

    // 2) página
    const tPag = await alvos(porta, 'page');
    if (!tPag) throw new Error('o app não abriu');
    pagina = cliente(tPag.webSocketDebuggerUrl); await pagina.pronto;
    const { send, ev } = pagina;
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const espera = async (expr, ms = 20000, msg = expr) => { const fim = Date.now() + ms; while (Date.now() < fim) { try { if (await ev(expr)) return true; } catch { } await sleep(150); } throw new Error(`tempo esgotado: ${msg}`); };
    await espera(`!!document.querySelector('.ws.active')`, 30000, 'workspace ativo');
    await ev(`(() => { const el = [...document.querySelectorAll('.ws.active [data-act="new-term"]')].find(e => e.offsetParent !== null); el.click(); return true; })()`);
    await sleep(500);
    if (await ev(`!!document.querySelector('.dev-term-menu')`)) await ev(`document.querySelector('.dev-term-menu button[data-i="0"]').click()`);
    await espera(`!!document.querySelector('.ws.active .term-pane')`, 20000, 'terminal aberto');
    const aba = await ev(`document.querySelector('.ws.active .term-tab')?.textContent || ''`);
    console.log(`  aba do terminal: ${aba.trim()}`);
    await espera(`[...document.querySelectorAll('.ws.active .xterm-rows > div')].some(d => /[>$]/.test(d.textContent))`, 20000, 'prompt do shell');
    await sleep(800);

    // foco no terminal e comandos (PowerShell)
    const corpo = await ev(`(() => { const r = document.querySelector('.ws.active .term-pane-body').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
    await mouse('mousePressed', corpo.x + corpo.w / 2, corpo.y + corpo.h / 2, { button: 'left', clickCount: 1 });
    await mouse('mouseReleased', corpo.x + corpo.w / 2, corpo.y + corpo.h / 2, { button: 'left', clickCount: 1 });
    await sleep(200);
    const enter = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); };
    const digita = async t => { await send('Input.insertText', { text: t }); await enter(); await sleep(900); };
    const E = '$([char]27)';
    await digita(`Write-Host "https://exemplo.invalid/a?b=1&c=2"`);
    await digita(`Write-Host "${E}]8;;https://osc.invalid/x${E}\\clique aqui${E}]8;;${E}\\"`);
    await digita(`Write-Host "${E}]8;;file:///C:/Windows/System32/calc.exe${E}\\arquivo local${E}]8;;${E}\\"`);
    await sleep(600);

    const linhas = await ev(`[...document.querySelectorAll('.ws.active .xterm-rows > div')].map(d => d.textContent)`);
    const cel = await ev(`document.querySelector('.ws.active .term-pane-body .xterm-char-measure-element').getBoundingClientRect().width`);
    console.log('  linhas:', JSON.stringify(linhas.filter(l => /invalid|clique|arquivo/.test(l))), 'cel', cel);
    const linha = async (texto, col) => {
      const nb = t => t.replace(/ /g, ' '); const i = linhas.findIndex(l => nb(l).trim() === texto);
      if (i < 0) return null;
      const r = await ev(`(() => { const row = document.querySelectorAll('.ws.active .xterm-rows > div')[${i}]; const nb = t => t.replace(/ /g, ' '); const s = [...row.children].find(s => nb(s.textContent).includes(${JSON.stringify(texto)})); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height, cel: r.width / s.textContent.length, dentro: nb(s.textContent).indexOf(${JSON.stringify(texto)}) }; })()`);
      const p = { x: r.x + r.cel * (r.dentro + col + 0.5), y: r.y + r.h / 2 };
      const sob = await ev(`(() => { const e = document.elementFromPoint(${p.x}, ${p.y}); return e ? e.tagName + '.' + e.className + ' "' + (e.textContent || '').slice(0, 30) + '"' : null; })()`);
      console.log(`  ponto para "${texto}": linha ${i}, (${p.x.toFixed(0)},${p.y.toFixed(0)}) sob: ${sob}`);
      return p;
    };
    const titulo = () => ev(`document.querySelector('.ws.active .term-pane-body').title`);
    const passa = async p => { for (let k = 6; k >= 0; k--) { await mouse('mouseMoved', p.x - k * 4, p.y + (k % 2)); await sleep(60); } await sleep(500); const sub = await ev(`[...document.querySelectorAll('.ws.active .xterm-rows span')].filter(s => getComputedStyle(s).textDecorationLine.includes('underline')).map(s => s.textContent).slice(0, 4)`); console.log(`  hover: title="${await titulo()}" sublinhados=${JSON.stringify(sub)}`); };
    const fora = async () => { await mouse('mouseMoved', corpo.x + corpo.w - 20, corpo.y + corpo.h - 10); await sleep(400); };

    // 3) hover: http no texto
    const pHttp = await linha('https://exemplo.invalid/a?b=1&c=2', 8);
    afirma(!!pHttp, 'linha com a URL http impressa no terminal');
    if (pHttp) { await passa(pHttp); afirma(await titulo() === 'Ctrl+clique para abrir o link', `hover na URL http mostra a dica (title="${await titulo()}")`); await fora(); afirma(await titulo() === '', 'ao sair do link, a dica some'); }
    // 4) hover: OSC 8 https
    const pOsc = await linha('clique aqui', 3);
    afirma(!!pOsc, 'linha com o hyperlink OSC 8 (texto "clique aqui")');
    if (pOsc) { await passa(pOsc); afirma(await titulo() === 'Ctrl+clique para abrir o link', `hover no OSC 8 https mostra a dica (title="${await titulo()}")`); await fora(); }
    // 5) OSC 8 file: não vira link
    const pFile = await linha('arquivo local', 3);
    afirma(!!pFile, 'linha com o OSC 8 file:');
    if (pFile) {
      await passa(pFile);
      afirma(await titulo() === '', `OSC 8 file: não vira link (title="${await titulo()}")`);
      const nSub = await ev(`[...document.querySelectorAll('.ws.active .xterm-rows span')].filter(s => s.textContent.replace(/\u00a0/g, ' ').includes('arquivo local') && (getComputedStyle(s).textDecorationLine.includes('underline') || /underline/.test(s.className))).length`);
      afirma(nSub === 0, `OSC 8 file: sem sublinhado (${nSub} spans sublinhados)`);
      await fora();
    }
    afirma(await ev(`[...document.querySelectorAll('.ws.active .xterm-rows > div')].some(d => d.textContent.replace(/\u00a0/g, ' ').includes('arquivo local'))`), 'o texto do OSC 8 file: continua visível');

    // 6) cliques, só com o stub confirmado
    if (stubOk && pHttp && pOsc) {
      const antes = (await abertos()).length;
      await passa(pHttp);
      await mouse('mousePressed', pHttp.x, pHttp.y, { button: 'left', clickCount: 1 }); await mouse('mouseReleased', pHttp.x, pHttp.y, { button: 'left', clickCount: 1 }); await sleep(500);
      afirma((await abertos()).length === antes, 'clique simples na URL não abre nada');
      await mouse('mousePressed', pHttp.x, pHttp.y, { button: 'left', clickCount: 1, modifiers: 2 }); await mouse('mouseReleased', pHttp.x, pHttp.y, { button: 'left', clickCount: 1, modifiers: 2 }); await sleep(700);
      let lista = await abertos();
      afirma(lista[lista.length - 1] === 'https://exemplo.invalid/a?b=1&c=2', `Ctrl+clique na URL http chega ao main com a URL inteira: ${JSON.stringify(lista)}`);
      await fora(); await passa(pOsc);
      await mouse('mousePressed', pOsc.x, pOsc.y, { button: 'left', clickCount: 1, modifiers: 2 }); await mouse('mouseReleased', pOsc.x, pOsc.y, { button: 'left', clickCount: 1, modifiers: 2 }); await sleep(700);
      lista = await abertos();
      afirma(lista[lista.length - 1] === 'https://osc.invalid/x', `Ctrl+clique no OSC 8 abre a URL do hyperlink, não o texto: ${JSON.stringify(lista)}`);
      await fora();
      // 7) IPC direto (como about.js/pricing.js e qualquer renderer): só http(s) passa
      const n = (await abertos()).length;
      const rFile = await ev(`window.rendra.openExternal('file:///C:/Windows/System32/calc.exe')`);
      const rJs = await ev(`window.rendra.openExternal('javascript:alert(1)')`);
      const rUnc = await ev(`window.rendra.openExternal('\\\\\\\\servidor\\\\share\\\\x.exe')`);
      const rCam = await ev(`window.rendra.openExternal('C:\\\\Windows\\\\System32\\\\calc.exe')`);
      const rData = await ev(`window.rendra.openExternal('data:text/html,<b>x</b>')`);
      lista = await abertos();
      afirma(rFile === false && rJs === false && rUnc === false && rCam === false && rData === false && lista.length === n, `IPC recusa file:/javascript:/UNC/caminho/data: (retornos ${rFile},${rJs},${rUnc},${rCam},${rData}; registrados ${lista.length - n})`);
      const rOk = await ev(`window.rendra.openExternal('https://brunomagalhaes.me/')`);
      lista = await abertos();
      afirma(lista[lista.length - 1] === 'https://brunomagalhaes.me/' && lista.length === n + 1, 'IPC aceita https (caminho do Sobre/Preços segue funcionando)');
    } else console.log('  (cliques pulados: stub do main não confirmado)');

    // 8) foto do painel do terminal (para olhar)
    fs.mkdirSync(SAIDA, { recursive: true });
    if (pHttp) await passa(pHttp);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: corpo.x, y: corpo.y, width: corpo.w, height: Math.min(corpo.h, 320), scale: 1 } });
    const foto = path.join(SAIDA, 'terminal-links.png');
    fs.writeFileSync(foto, Buffer.from(data, 'base64'));
    console.log(`  foto: ${foto}`);
  } catch (e) {
    falhas.push(`erro: ${e.message}`); console.log(`  ✗ erro: ${e.message}`);
  } finally {
    try { pagina?.ws.close(); main?.ws.close(); } catch { }
    try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { }
    await sleep(1200);
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { }
  }
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ${falhas.join('\n- ')}` : '\nTudo conferido.');
  process.exit(falhas.length ? 1 : 0);
})();
