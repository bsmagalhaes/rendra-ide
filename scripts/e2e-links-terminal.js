// Prova de ponta a ponta dos links do terminal: app real em sandbox, janela oculta (RENDRA_E2E_HIDDEN=1) e
// shell.openExternal do main substituído por um registrador (via --inspect) ANTES de qualquer clique: nada abre o
// navegador. Fora do npm test. Uso: node scripts/e2e-links-terminal.js [--saida=<pasta da foto>]. Sai com 1 se falhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
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
  escreve(path.join(projeto, 'docs', 'spec', 'exemplo-vitrine.md'), '# Exemplo\nlinha 2\nlinha 3 alvo\nlinha 4\nlinha 5\n');
  fs.mkdirSync(path.join(projeto, 'docs', 'pasta-vazia'), { recursive: true });
  escreve(path.join(dir, 'fora', 'segredo.txt'), 'SEGREDO'); // alvo da junção que escapa da pasta aberta
  fs.symlinkSync(path.join(dir, 'fora'), path.join(projeto, 'jun'), 'junction');
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
    const dialogos = [];
    pagina.ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Page.javascriptDialogOpening') { dialogos.push(m.params.message); send('Page.handleJavaScriptDialog', { accept: false }).catch(() => { }); } });
    await send('Page.enable');
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
    await digita('Write-Host "veja docs/spec/exemplo-vitrine.md:3 aqui"');
    await digita('Write-Host "veja docs/spec/nao-existe-mesmo.md aqui"');
    await digita('Write-Host "veja jun/segredo.txt aqui"');
    await digita('Write-Host "veja docs/pasta-vazia/ aqui"');
    await sleep(600);

    let linhas = await ev(`[...document.querySelectorAll('.ws.active .xterm-rows > div')].map(d => d.textContent)`);
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
    if (pHttp) { await passa(pHttp); afirma(await titulo() === 'Clique para abrir (Ctrl+clique abre direto)', `hover na URL http mostra a dica (title="${await titulo()}")`); await fora(); afirma(await titulo() === '', 'ao sair do link, a dica some'); }
    // 4) hover: OSC 8 https
    const pOsc = await linha('clique aqui', 3);
    afirma(!!pOsc, 'linha com o hyperlink OSC 8 (texto "clique aqui")');
    if (pOsc) { await passa(pOsc); afirma(await titulo() === 'Clique para abrir (Ctrl+clique abre direto)', `hover no OSC 8 https mostra a dica (title="${await titulo()}")`); await fora(); }
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
      const clica = async (p, modifiers = 0) => { await passa(p); await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1, modifiers }); await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1, modifiers }); await sleep(600); };
      const modal = () => ev(`(() => { const o = document.getElementById('save-overlay'); return o.classList.contains('visible') ? { titulo: document.getElementById('save-title').textContent, url: document.querySelector('#save-body .link-url')?.textContent, botoes: [...document.querySelectorAll('#save-actions button')].map(b => b.textContent) } : null; })()`);
      const tecla = async key => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 13 }); await sleep(400); };
      const URL1 = 'https://exemplo.invalid/a?b=1&c=2';
      const antes = (await abertos()).length;
      // a) clique simples: confirmação, nada aberto
      await passa(pHttp); await clica(pHttp);
      let m = await modal();
      afirma(!!m && m.titulo === 'Abrir link?' && m.url === URL1 && m.botoes.join('|') === 'Cancelar|Abrir no Rendra Browser|Abrir no navegador padrão', `clique simples mostra a confirmação com a URL completa e as 3 opções: ${JSON.stringify(m)}`);
      afirma((await abertos()).length === antes, 'a confirmação sozinha não abre nada');
      const fotoM = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(SAIDA, { recursive: true }); fs.writeFileSync(path.join(SAIDA, 'confirmacao-link.png'), Buffer.from(fotoM.data, 'base64'));
      // b) Cancelar não abre
      await ev(`document.querySelector('#save-actions [data-choice="cancel"]').click()`); await sleep(300);
      afirma(!(await modal()) && (await abertos()).length === antes, 'Cancelar fecha a confirmação e não abre');
      // c) Esc não abre
      await clica(pHttp); afirma(!!(await modal()), 'segundo clique simples mostra a confirmação de novo');
      await tecla('Escape');
      afirma(!(await modal()) && (await abertos()).length === antes, 'Esc fecha a confirmação e não abre');
      // d) Abrir chama open-external com a URL
      await clica(pHttp);
      await ev(`document.querySelector('#save-actions [data-choice="open"]').click()`); await sleep(700);
      let lista = await abertos();
      afirma(!(await modal()) && lista.length === antes + 1 && lista[lista.length - 1] === URL1, `Abrir leva a URL ao open-external: ${JSON.stringify(lista)}`);
      // e) Ctrl+clique abre direto, sem confirmação
      await clica(pHttp, 2);
      lista = await abertos();
      afirma(!(await modal()) && lista.length === antes + 2 && lista[lista.length - 1] === URL1, `Ctrl+clique abre sem confirmação: ${JSON.stringify(lista)}`);
      // f) arrastar para selecionar (começa e termina dentro do link) não dispara nada
      await passa({ x: pHttp.x - 20, y: pHttp.y });
      await mouse('mousePressed', pHttp.x - 20, pHttp.y, { button: 'left', clickCount: 1 });
      for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', pHttp.x - 20 + k * 8, pHttp.y, { button: 'left', buttons: 1 }); await sleep(40); }
      await mouse('mouseReleased', pHttp.x + 28, pHttp.y, { button: 'left', clickCount: 1 }); await sleep(600);
      const sel = await ev(`(() => { const s = String(window.getSelection()); return s; })()`);
      afirma(!(await modal()) && (await abertos()).length === antes + 2, `arrastar sobre o link não mostra a confirmação nem abre (selecionado: "${String(sel).slice(0, 30)}")`);
      // g) Enter = navegador padrão
      const nEnter = (await abertos()).length;
      await clica(pHttp); afirma(!!(await modal()), 'clique simples mostra a confirmação (teste do Enter)');
      await tecla('Enter'); await sleep(500);
      lista = await abertos();
      afirma(!(await modal()) && lista.length === nEnter + 1 && lista[lista.length - 1] === URL1, `Enter na confirmação abre no navegador padrão: ${JSON.stringify(lista.slice(-2))}`);
      // h) Rendra Browser: janela isolada com uma URL local de teste
      const mev = expr => main.ev(`(async () => { const { BrowserWindow, session } = process.mainModule.require('electron'); const jr = () => BrowserWindow.getAllWindows().find(w => w.rendraBrowser); return JSON.stringify(await (async () => { ${expr} })()); })()`, { includeCommandLineAPI: true }).then(JSON.parse);
      const nJan = () => mev('return BrowserWindow.getAllWindows().length;');
      const janBase = await nJan();
      const paginasDo = async () => (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).filter(t => t.type === 'page').map(t => t.url);
      const paginasBase = await paginasDo();
      const srv = http.createServer((rq, rs) => { rs.setHeader('content-type', 'text/html; charset=utf-8'); rs.end(rq.url === '/filho' ? '<title>Filho</title><h1>filho</h1>' : '<title>Pagina local de teste</title><h1 id="h">ola rendra browser</h1><a id="l" target="_blank" href="/filho">filho</a>'); });
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const URL_LOCAL = `http://127.0.0.1:${srv.address().port}/`;
      try {
        await digita(`Write-Host "${URL_LOCAL}"`);
        linhas = await ev(`[...document.querySelectorAll('.ws.active .xterm-rows > div')].map(d => d.textContent)`);
        const pLocal = await linha(URL_LOCAL, 10);
        afirma(!!pLocal, 'linha com a URL local impressa no terminal');
        if (pLocal) {
          const nAb = (await abertos()).length;
          await clica(pLocal);
          afirma(!!(await modal()), 'clique na URL local mostra a confirmação');
          await ev(`document.querySelector('#save-actions [data-choice="rendra"]').click()`);
          let achou = false;
          for (let i = 0; i < 60 && !achou; i++) { await sleep(250); achou = await mev(`const w = jr(); return !!w && w.rendraBrowser.wc.getURL() === ${JSON.stringify(URL_LOCAL)};`); }
          afirma(achou, 'Rendra Browser abriu a URL local de teste');
          afirma((await nJan()) === janBase + 1, `só uma janela nova (${janBase} -> ${await nJan()})`);
          afirma((await abertos()).length === nAb, 'Rendra Browser não aciona o navegador padrão (open-external)');
          const rbEv = codigo => mev(`const w = jr(); const wc = w.rendraBrowser.wc; ${codigo}`);
          const info = await rbEv(`const pr = wc.getLastWebPreferences(); return { titulo: w.getTitle(), nodeInt: pr.nodeIntegration, ctx: pr.contextIsolation, sandbox: pr.sandbox, preload: !!pr.preload, propria: wc.session === session.fromPartition('rendra-browser'), persiste: wc.session.isPersistent(), isolado: await wc.executeJavaScript('[typeof window.rendra, typeof require, typeof process, typeof ipcRenderer].join(",")') };`);
          afirma(info.titulo === URL_LOCAL, `título da janela é a URL: ${info.titulo}`);
          afirma(info.nodeInt === false && info.ctx === true && info.sandbox === true && info.preload === false && info.propria === true, `página sem preload, nodeIntegration off, contextIsolation e sandbox on, sessão própria: ${JSON.stringify(info)}`);
          afirma(info.persiste === false, 'sessão do Rendra Browser não persiste');
          afirma(info.isolado === 'undefined,undefined,undefined,undefined', `a página não vê a IDE nem o Node: ${info.isolado}`);
          const perm = await rbEv(`return await wc.executeJavaScript('Notification.requestPermission()');`);
          afirma(perm === 'denied', `notificações negadas por padrão: ${perm}`);
          // janela filha (target=_blank) fica na mesma janela
          await rbEv(`await wc.executeJavaScript("document.getElementById('l').click()"); return 1;`);
          await sleep(1200);
          afirma((await nJan()) === janBase + 1 && (await rbEv('return wc.getURL();')) === URL_LOCAL + 'filho', 'link target=_blank abre na mesma janela, sem janela extra');
          // esquema não permitido é negado
          await rbEv(`wc.executeJavaScript("location.href='file:///C:/Windows/win.ini'").catch(() => {}); return 1;`);
          await sleep(800);
          afirma((await rbEv('return wc.getURL();')) === URL_LOCAL + 'filho', 'navegação para file: é negada');
          // barra: "Abrir no navegador padrão" e voltar
          const nAb2 = (await abertos()).length;
          await mev(`jr().rendraBrowser.barra.executeJavaScript("window.rb.comando('abrir-padrao')"); return 1;`);
          await sleep(700);
          lista = await abertos();
          afirma(lista.length === nAb2 + 1 && lista[lista.length - 1] === URL_LOCAL + 'filho', `barra: "Abrir no navegador padrão" chama open-external com a URL atual: ${lista[lista.length - 1]}`);
          await mev(`jr().rendraBrowser.barra.executeJavaScript("window.rb.comando('voltar')"); return 1;`);
          await sleep(1000);
          afirma((await rbEv('return wc.getURL();')) === URL_LOCAL, 'barra: voltar retorna à página anterior');
          const barraInfo = await mev(`return await jr().rendraBrowser.barra.executeJavaScript('({ url: document.getElementById("url").value, ro: document.getElementById("url").readOnly, botoes: [...document.querySelectorAll("button")].map(x => x.id) })');`);
          afirma(barraInfo.ro === true && barraInfo.botoes.join(',') === 'voltar,avancar,recarregar,abrir' && barraInfo.url === URL_LOCAL, `barra mínima com endereço só leitura: ${JSON.stringify(barraInfo)}`);
          // foto da barra e da página (a captura de janela fora da tela pode falhar em alguns ambientes: não reprova)
          const fotoR = await mev(`const w = jr(); try { const a = await w.rendraBrowser.barra.capturePage(); const b = await w.rendraBrowser.wc.capturePage(); return { barra: a.toPNG().toString('base64'), pagina: b.toPNG().toString('base64') }; } catch (e) { return null; }`).catch(() => null);
          if (fotoR) { fs.mkdirSync(SAIDA, { recursive: true }); fs.writeFileSync(path.join(SAIDA, 'rendra-browser-barra.png'), Buffer.from(fotoR.barra, 'base64')); fs.writeFileSync(path.join(SAIDA, 'rendra-browser-pagina.png'), Buffer.from(fotoR.pagina, 'base64')); }
          await mev(`BrowserWindow.getAllWindows().filter(w => w.rendraBrowser).forEach(w => w.destroy()); return 1;`);
          await sleep(400);
          afirma((await nJan()) === janBase, 'ao fechar o Rendra Browser, sobra só a janela da IDE');
        }
      } finally { srv.close(); }
      // i) nenhum diálogo nativo, nenhuma janela solta: window.open no renderer da IDE é negado
      const janAntesOpen = await nJan();
      await ev(`(() => { try { window.open('https://exemplo.invalid/solta'); } catch { } return 1; })()`);
      await sleep(800);
      afirma((await nJan()) === janAntesOpen, 'window.open no renderer da IDE não cria janela');
      const paginasFim = await paginasDo();
      afirma(paginasFim.length === paginasBase.length, `nenhuma página/janela extra além das ${paginasBase.length} da IDE (${paginasFim.length}): ${JSON.stringify(paginasFim.filter(u => !paginasBase.includes(u)))}`);
      afirma(dialogos.length === 0, `nenhum diálogo nativo (confirm/alert) apareceu em todo o teste: ${JSON.stringify(dialogos)}`);
      const n0 = (await abertos()).length;
      await fora(); await passa(pOsc);
      await mouse('mousePressed', pOsc.x, pOsc.y, { button: 'left', clickCount: 1, modifiers: 2 }); await mouse('mouseReleased', pOsc.x, pOsc.y, { button: 'left', clickCount: 1, modifiers: 2 }); await sleep(700);
      lista = await abertos();
      afirma(lista[lista.length - 1] === 'https://osc.invalid/x', `Ctrl+clique no OSC 8 abre a URL do hyperlink, não o texto: ${JSON.stringify(lista)}`);
      await clica(pOsc); m = await modal();
      afirma(!!m && m.url === 'https://osc.invalid/x' && (await abertos()).length === lista.length, `clique simples no OSC 8 confirma a URL do hyperlink: ${JSON.stringify(m)}`);
      await tecla('Escape');
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

    // 7b) caminhos de arquivo: existente vira link e abre no editor da lateral na linha; inexistente não sublinha
    const nAntes = stubOk ? (await abertos()).length : 0;
    const pCam = await linha('veja docs/spec/exemplo-vitrine.md:3 aqui', 14);
    const pNao = await linha('veja docs/spec/nao-existe-mesmo.md aqui', 14);
    const pJun = await linha('veja jun/segredo.txt aqui', 14);
        afirma(!!pCam && !!pNao, 'linhas com os caminhos impressas no terminal');
    const sublinhados = () => ev(`[...document.querySelectorAll('.ws.active .xterm-rows span')].filter(s => getComputedStyle(s).textDecorationLine.includes('underline')).map(s => s.textContent.replace(/ /g, ' '))`);
    if (pNao) {
      await passa(pNao);
      afirma(await titulo() === '' && !(await sublinhados()).some(t => /nao-existe/.test(t)), `caminho inexistente não vira link nem sublinha (title="${await titulo()}")`);
      await fora();
    }
    if (pJun) {
      await passa(pJun); await sleep(800); await passa(pJun);
      afirma(await titulo() === '' && !(await sublinhados()).some(t => /segredo/.test(t)), `junção que aponta para fora da pasta aberta não vira link (title="${await titulo()}")`);
      await fora();
    }
    if (pCam) {
      // a primeira conferência de existência é assíncrona (IPC): se o mouse saiu antes da resposta, passa de novo (agora em cache)
      for (let k = 0; k < 3; k++) { await passa(pCam); if (await titulo() === 'Clique para abrir no editor') break; await fora(); }
      afirma(await titulo() === 'Clique para abrir no editor', `caminho existente mostra a dica ao passar o mouse (title="${await titulo()}")`);
      const sub = await sublinhados();
      afirma(sub.some(t => /exemplo-vitrine/.test(t)), `caminho existente fica sublinhado no hover: ${JSON.stringify(sub.slice(0, 3))}`);
      const fotoC = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(SAIDA, { recursive: true }); fs.writeFileSync(path.join(SAIDA, 'caminho-hover.png'), Buffer.from(fotoC.data, 'base64'));
      await mouse('mousePressed', pCam.x, pCam.y, { button: 'left', clickCount: 1 }); await mouse('mouseReleased', pCam.x, pCam.y, { button: 'left', clickCount: 1 });
      await espera(`!![...document.querySelectorAll('.ws.active .dev-tab.active .dev-tab-name')].find(e => e.textContent === 'exemplo-vitrine.md')`, 15000, 'arquivo aberto no editor');
      afirma(true, 'clique no caminho existente abre o arquivo numa aba do editor');
      await espera(`(() => { const ed = window.monaco && monaco.editor.getEditors().find(e => (e.getModel()?.uri.path || '').endsWith('exemplo-vitrine.md')); return ed && ed.getPosition().lineNumber === 3; })()`, 8000, 'cursor na linha 3').catch(() => { });
      const linhaEd = await ev(`(() => { const ed = window.monaco && monaco.editor.getEditors().find(e => (e.getModel()?.uri.path || '').endsWith('exemplo-vitrine.md')); return ed ? ed.getPosition().lineNumber : null; })()`);
      afirma(linhaEd === 3, `o editor vai para a linha indicada (:3), linha atual ${linhaEd}`);
      afirma(!(await ev(`document.getElementById('save-overlay').classList.contains('visible')`)), 'caminho de arquivo abre sem confirmação');
      if (stubOk) afirma((await abertos()).length === nAntes, 'abrir caminho não aciona o navegador do sistema (open-external)');
      const fotoE = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SAIDA, 'caminho-aberto-no-editor.png'), Buffer.from(fotoE.data, 'base64'));
      await fora();
    }
    // o painel do editor pode ter mexido no layout: mede de novo antes da pasta
    linhas = await ev(`[...document.querySelectorAll('.ws.active .xterm-rows > div')].map(d => d.textContent)`);
    const pPasta = await linha('veja docs/pasta-vazia/ aqui', 10);
    afirma(!!pPasta, 'linha com a pasta impressa no terminal');
    if (pPasta) {
      await passa(pPasta);
      afirma(await titulo() === 'Clique para abrir no editor', 'pasta existente (com barra final) vira link');
      await mouse('mousePressed', pPasta.x, pPasta.y, { button: 'left', clickCount: 1 }); await mouse('mouseReleased', pPasta.x, pPasta.y, { button: 'left', clickCount: 1 });
      await espera(`!![...document.querySelectorAll('.ws.active .dev-node.dir')].find(n => /pasta-vazia$/.test(n.dataset.path))`, 10000, 'pasta revelada no explorador');
      afirma(true, 'clique na pasta revela a pasta no explorador (ancestrais expandidos)');
      await fora();
    }

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
