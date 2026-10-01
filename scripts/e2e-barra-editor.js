// Prova de ponta a ponta da barra de consumo do Claude Code (barra de título) e do painel do editor
// recolhível da IDE, com o app real rodando em sandbox: uma pasta temporária com home falso
// (RENDRA_HOME) e dados falsos (RENDRA_DATA_DIR). Nada do usuário é lido nem gravado.
// Fora do `npm test`: abre o Electron e leva minutos (o cenário `ritmo` espera o timer de 60 s).
// A janela abre fora da tela e sem foco (RENDRA_E2E_HIDDEN=1, ligado pelo próprio script).
//
//   node scripts/e2e-barra-editor.js                        todos os cenários
//   node scripts/e2e-barra-editor.js --cenario=normal,velho  só esses
//   node scripts/e2e-barra-editor.js --saida=<pasta>        onde gravar as capturas
//                                                           (ou RENDRA_E2E_OUT; padrão: pasta temporária)
// Sai com código diferente de zero se qualquer asserção falhar.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Argumentos ──────────────────────────────────────────────────────────────
const arg = nome => (process.argv.find(a => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const SAIDA = path.resolve(arg('saida') || process.env.RENDRA_E2E_OUT
  || path.join(os.tmpdir(), `rendra-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const ESCOLHIDOS = arg('cenario') ? arg('cenario').split(',').map(s => s.trim()).filter(Boolean) : null;

// ── Asserções ───────────────────────────────────────────────────────────────
const falhas = [];
let cenarioAtual = '';
function afirma(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); return true; }
  falhas.push(`[${cenarioAtual}] ${msg}`);
  console.log(`  ✗ ${msg}`);
  return false;
}
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

// ── Contraste (WCAG) ────────────────────────────────────────────────────────
function rgbDe(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`cor não reconhecida: ${css}`);
  const [r, g, b, a] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { r, g, b, a: a === undefined ? 1 : a };
}
function luminancia({ r, g, b }) {
  const f = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(css1, css2) {
  const l1 = luminancia(rgbDe(css1)), l2 = luminancia(rgbDe(css2));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── Sandbox ─────────────────────────────────────────────────────────────────
const DIA = 86400000;
const escreve = (arquivo, texto) => { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, texto); };

// opts: status ({ five, seven } | null), idadeMs, semRateLimits, conta (padrão true), settings, workspaces
function criarSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-'));
  const home = path.join(dir, 'home');
  const data = path.join(dir, 'data');
  const projeto = path.join(home, 'projetos', 'demo');
  escreve(path.join(projeto, 'a.txt'), 'primeiro arquivo\nlinha dois\n');
  escreve(path.join(projeto, 'b.txt'), 'segundo arquivo\n');
  escreve(path.join(projeto, 'sub', 'c.txt'), 'terceiro arquivo\n');
  const sb = { dir, home, data, projeto, statusFile: path.join(home, '.rendra-ide', 'claude-status.json') };

  if (opts.conta !== false) {
    escreve(path.join(home, '.claude.json'), JSON.stringify({
      oauthAccount: { emailAddress: 'voce@exemplo.com', displayName: 'Você', organizationName: 'Empresa Demo' },
    }));
    if (!opts.semCredenciais) {
      escreve(path.join(home, '.claude', '.credentials.json'), JSON.stringify({
        claudeAiOauth: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' },
      }));
    }
    escreve(path.join(home, '.claude', 'settings.json'), JSON.stringify({
      statusLine: { type: 'command', command: 'sh "$HOME/.rendra-ide/statusline.sh"' },
    }, null, 2));
  }
  if (opts.semRateLimits) escreve(sb.statusFile, JSON.stringify({ model: { display_name: 'Demo' } }));
  else if (opts.status) escreverStatus(sb, opts.status, opts.idadeMs || 0);

  const workspaces = (opts.workspaces || [{ name: 'demo', cols: 2 }]).map(w => ({
    name: w.name, custom: false, cols: w.cols || 1, root: projeto,
    // '@a.txt' vira o caminho do arquivo dentro do projeto de demonstração
    groups: (w.groups || []).map(g => ({ tabs: g.tabs.map(t => (t[0] === '@' ? path.join(projeto, t.slice(1)) : t)), active: g.active && g.active[0] === '@' ? path.join(projeto, g.active.slice(1)) : g.active })),
    ...(w.editorHidden === undefined ? {} : { editorHidden: w.editorHidden }),
  }));
  const config = {
    settings: { refreshInterval: 600, ...(opts.settings || {}) },
    filters: { days: 30, projects: [] },
    setup: { dismissed: true },
    devcode: { workspaces: { list: workspaces, active: opts.ativo || 0 } },
  };
  escreve(path.join(data, 'rendra-config.json'), JSON.stringify(config, null, 2));
  return sb;
}

// O `fetchedAt` do app é o mtime do arquivo: a idade do dado é a idade do arquivo
function escreverStatus(sb, { five, seven }, idadeMs = 0) {
  const agora = Date.now();
  const rate_limits = {};
  if (five !== undefined) rate_limits.five_hour = { used_percentage: five, resets_at: Math.floor((agora + 2.5 * 3600000) / 1000) };
  if (seven !== undefined) rate_limits.seven_day = { used_percentage: seven, resets_at: Math.floor((agora + 3.2 * DIA) / 1000) };
  escreve(sb.statusFile, JSON.stringify({ rate_limits }));
  const quando = new Date(agora - idadeMs);
  fs.utimesSync(sb.statusFile, quando, quando);
}
const apagarStatus = sb => { try { fs.rmSync(sb.statusFile); } catch { /* já não existe */ } };
const lerConfig = sb => JSON.parse(fs.readFileSync(path.join(sb.data, 'rendra-config.json'), 'utf8'));

// ── App em execução, controlado por CDP ─────────────────────────────────────
async function conectar(porta) {
  let alvos = [];
  for (let i = 0; i < 80; i++) {
    try { alvos = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); if (alvos.some(t => t.type === 'page')) break; } catch { /* iniciando */ }
    await sleep(500);
  }
  const pagina = alvos.find(t => t.type === 'page');
  if (!pagina) throw new Error('o app não abriu');
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  const pendentes = {};
  let id = 0;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (!pendentes[m.id]) return;
    if (m.error) pendentes[m.id].reject(new Error(m.error.message)); else pendentes[m.id].resolve(m.result);
    delete pendentes[m.id];
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pendentes[i] = { resolve, reject };
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async expressao => {
    const r = await send('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description || ''}`.slice(0, 400));
    return r.result?.value;
  };
  return { ws, send, ev };
}

async function abrir(sb, { w = 1920, h = 1080, semTerminal = false } = {}) {
  const porta = 9400 + Math.floor(Math.random() * 400);
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  // O home real continua (shells e Chromium precisam dele); o app lê o home falso via RENDRA_HOME
  const env = { ...process.env, RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home, CODEX_HOME: path.join(sb.home, '.codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`], { cwd: ROOT, env, stdio: 'ignore' });
  const { ws, send, ev } = await conectar(porta);
  const app = { sb, proc, ws, send, ev, w, h, semTerminal };
  sb.appAtual = app;

  app.tamanho = async (nw, nh) => {
    app.w = nw; app.h = nh;
    await send('Emulation.setDeviceMetricsOverride', { width: nw, height: nh, deviceScaleFactor: 1, mobile: false });
    await sleep(350);
  };
  // Espera a expressão ficar verdadeira (em JS da página)
  app.espera = async (expr, ms = 20000, msg = expr) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      try { if (await ev(expr)) return true; } catch { /* página ainda carregando */ }
      await sleep(150);
    }
    throw new Error(`tempo esgotado esperando: ${msg}`);
  };
  app.clica = async seletor => {
    const ok = await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(seletor)})].find(e => e.offsetParent !== null) || document.querySelector(${JSON.stringify(seletor)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`não achei para clicar: ${seletor}`);
  };
  // Retângulo do primeiro elemento que casa (null se não existe)
  app.caixa = seletor => ev(`(() => { const el = document.querySelector(${JSON.stringify(seletor)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
  app.estilo = (seletor, prop) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(seletor)}))[${JSON.stringify(prop)}]`);
  app.texto = seletor => ev(`document.querySelector(${JSON.stringify(seletor)})?.textContent ?? null`);
  app.pagina = async nome => { await app.clica(`[data-page=${nome}]`); await sleep(700); };
  // Captura com o texto dos terminais escondido (o perfil do shell imprime caminhos com o nome do usuário)
  app.digita = text => send('Input.insertText', { text });
  app.tecla = async (key, { ctrl } = {}) => {
    const base = { key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), modifiers: ctrl ? 2 : 0 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  app.foto = async (nome, clip) => {
    fs.mkdirSync(SAIDA, { recursive: true });
    await ev(`(() => { let s = document.getElementById('e2e-oculta'); if (!s) { s = document.createElement('style'); s.id = 'e2e-oculta'; document.head.appendChild(s); } s.textContent = '.xterm-screen{visibility:hidden !important}'; })()`);
    await sleep(350);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { scale: 1, ...clip } } : {}) });
    await ev(`document.getElementById('e2e-oculta')?.remove()`);
    const arquivo = path.join(SAIDA, `${nome}.png`);
    fs.writeFileSync(arquivo, Buffer.from(data, 'base64'));
    console.log(`  📷 ${arquivo}`);
    return arquivo;
  };
  app.fechar = async () => {
    try { ws.close(); } catch { /* fechado */ }
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else proc.kill();
    } catch { /* já encerrou */ }
    await sleep(1500);
  };
  // Reinicia o app com o MESMO diretório de dados (não pelo botão fechar: o processo é morto)
  app.reiniciar = async () => {
    const { w: ow, h: oh } = app;
    await app.fechar();
    const novo = await abrir(sb, { w: ow, h: oh, semTerminal: app.semTerminal });
    return novo;
  };

  await app.tamanho(w, h);
  await app.espera(`!!document.querySelector('.ws.active')`, 30000, 'workspace ativo');
  // Nenhum terminal abre sozinho: os cenários que medem terminais pedem um, como o usuário faria
  if (!semTerminal) await abrirTerminal(app);
  await sleep(800);
  return app;
}

// Clica em "novo terminal" (no workspace ativo ou na página Terminal); se a máquina tiver WSL aparece o
// menu, e a primeira opção é sempre o Windows
async function abrirTerminal(app, escopo = '.ws.active') {
  await app.clica(`${escopo} [data-act="new-term"]`);
  await sleep(500);
  if (await app.ev(`!!document.querySelector('.dev-term-menu')`)) await app.clica('.dev-term-menu button[data-i="0"]');
  await app.espera(`!!document.querySelector('${escopo} .term-pane')`, 20000, 'terminal aberto');
}

async function comApp(opts, fn) {
  const sb = criarSandbox(opts);
  let app = null;
  try {
    app = await abrir(sb, { ...opts.janela, semTerminal: opts.semTerminal });
    await fn(app, sb);
  } finally {
    // o app pode ter sido reiniciado dentro do cenário: fecha o último
    const atual = sb.appAtual || app;
    if (atual) await atual.fechar();
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { /* temp, o sistema limpa depois */ }
  }
}

// ── CENÁRIOS ────────────────────────────────────────────────────────────────
const CENARIOS = {};

// A barra existe na estrutura, no lugar certo, e fica escondida sem dado (sem Claude Code, conta sem
// plano, ponte não instalada)
async function estruturaEscondida(app) {
  const info = await app.ev(`(() => {
    const barra = document.getElementById('consumo-bar');
    if (!barra) return null;
    const r = barra.getBoundingClientRect();
    return {
      pai: barra.parentElement?.id,
      antes: barra.previousElementSibling?.className,
      depois: barra.nextElementSibling?.className,
      display: getComputedStyle(barra).display,
      largura: r.width,
    };
  })()`);
  if (!afirma(!!info, '#consumo-bar existe no DOM')) return;
  afirma(info.pai === 'title-bar', '#consumo-bar está dentro de #title-bar');
  afirma(info.antes === 'app-name', 'vem logo depois de .app-name');
  afirma(info.depois === 'title-bar-right', 'vem logo antes de .title-bar-right');
  afirma(info.display === 'none' && info.largura === 0, `não está visível (display ${info.display}, largura ${info.largura})`);
}

CENARIOS['sem-dado'] = async () => {
  // 1) nunca houve Claude Code: nenhum claude-status.json
  await comApp({ status: null }, async app => {
    await sleep(1500);
    await estruturaEscondida(app);
  });
  // 2) conta sem plano: o arquivo existe mas sem rate_limits
  await comApp({ semRateLimits: true }, async app => {
    await sleep(1500);
    await estruturaEscondida(app);
  });
};

// ── Barra de consumo: leitura e ajudantes ───────────────────────────────────
const COR = { verde: 'rgb(76, 175, 117)', laranja: 'rgb(232, 101, 10)', vermelho: 'rgb(229, 72, 77)', muted: 'rgb(176, 176, 176)', dim: 'rgb(112, 112, 112)' };
const LER_BARRA = `(() => {
  const b = document.getElementById('consumo-bar');
  if (!b) return null;
  const cs = e => getComputedStyle(e);
  const r = b.getBoundingClientRect();
  return {
    visivel: !b.hidden && cs(b).display !== 'none' && r.width > 0,
    title: b.title, texto: b.textContent,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right },
    fundo: cs(document.getElementById('title-bar')).backgroundColor,
    itens: [...b.querySelectorAll('.consumo-item')].filter(i => !i.hidden).map(i => {
      const pb = i.querySelector('[role=progressbar]'), fill = i.querySelector('.consumo-fill');
      const rot = i.querySelector('.consumo-rotulo'), pct = i.querySelector('.consumo-pct');
      return {
        rotulo: rot.textContent, pct: pct.textContent, classe: i.className,
        now: pb.getAttribute('aria-valuenow'), min: pb.getAttribute('aria-valuemin'), max: pb.getAttribute('aria-valuemax'),
        label: pb.getAttribute('aria-label'), valuetext: pb.getAttribute('aria-valuetext'),
        fillW: fill.getBoundingClientRect().width, trilhoW: pb.getBoundingClientRect().width,
        fillBg: cs(fill).backgroundColor, trilhoBg: cs(pb).backgroundColor, pctCor: cs(pct).color, rotCor: cs(rot).color,
      };
    }),
  };
})()`;
const lerBarra = app => app.ev(LER_BARRA);
const barraVisivel = app => app.espera(`(() => { const b = document.getElementById('consumo-bar'); return !!b && !b.hidden && b.getBoundingClientRect().width > 0; })()`, 20000, 'barra de consumo visível');
const barraEscondida = (app, ms = 20000) => app.espera(`(() => { const b = document.getElementById('consumo-bar'); return !!b && (b.hidden || b.getBoundingClientRect().width === 0); })()`, ms, 'barra de consumo escondida');
const barraTem = (app, pcts, ms = 20000) => app.espera(`[...document.querySelectorAll('#consumo-bar .consumo-item:not([hidden]) .consumo-pct')].map(e => e.textContent).join(',') === ${JSON.stringify(pcts.join(','))}`, ms, `barra mostrando ${pcts.join(', ')}`);
const atualiza = app => app.clica('#btn-refresh');
const horaLocal = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

CENARIOS['normal'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 60000, janela: { w: 1366, h: 768 } }, async app => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-bar').title.includes('Empresa Demo')`, 20000, 'tooltip com a conta');
    await sleep(800); // transição da largura (0,4 s)
    const b = await lerBarra(app);
    afirma(b.itens.map(i => i.rotulo).join('|') === '5 Horas|Semanal', `rótulos: ${b.itens.map(i => i.rotulo).join(' | ')}`);
    afirma(b.itens.map(i => i.pct).join('|') === '42%|27%', `percentuais: ${b.itens.map(i => i.pct).join(' | ')}`);
    afirma(b.itens.map(i => i.now).join('|') === '42|27', 'aria-valuenow 42 e 27');
    afirma(b.itens.every(i => i.min === '0' && i.max === '100'), 'aria-valuemin 0 e aria-valuemax 100');
    afirma(b.itens.map(i => i.label).join('|') === 'Limite de 5 horas|Limite semanal', `aria-label: ${b.itens.map(i => i.label).join(' | ')}`);
    afirma(perto(b.itens[0].fillW, b.itens[0].trilhoW * 0.42, 1) && perto(b.itens[1].fillW, b.itens[1].trilhoW * 0.27, 1),
      `preenchimento ${b.itens[0].fillW.toFixed(1)} de ${b.itens[0].trilhoW} px (42%) e ${b.itens[1].fillW.toFixed(1)} (27%)`);
    afirma(b.itens.every(i => i.fillBg === COR.verde), `cor do preenchimento é o verde (${b.itens[0].fillBg})`);
    afirma(b.title.includes('Empresa Demo') && b.title.includes('Max 5x') && b.title.includes('Reinicia em'), `tooltip: ${JSON.stringify(b.title)}`);
    afirma(!b.title.includes('@') && !b.texto.includes('@') && !/voce/i.test(b.title), 'nem o tooltip nem a barra trazem o e-mail');
    await app.foto('normal-1366x768');
    // regressão da página Claude: um limite normal continua sem classe de nível
    await app.pagina('claude');
    const fills = await app.ev(`[...document.querySelectorAll('#limits-list .limit-fill')].map(e => e.className.trim())`);
    afirma(fills.join('|') === 'limit-fill|limit-fill', `página Claude sem classe de nível em 42% e 27%: ${JSON.stringify(fills)}`);
  });
};

CENARIOS['niveis'] = async () => {
  await comApp({ status: { five: 75, seven: 95 }, idadeMs: 30000 }, async app => {
    await barraVisivel(app);
    await sleep(800);
    const b = await lerBarra(app);
    afirma(b.itens[0].fillBg === COR.laranja, `75% é laranja (${b.itens[0].fillBg})`);
    afirma(b.itens[1].fillBg === COR.vermelho, `95% é vermelho (${b.itens[1].fillBg})`);
    afirma(b.itens.map(i => i.classe.includes('warn') + '/' + i.classe.includes('danger')).join('|') === 'true/false|false/true', `classes: ${b.itens.map(i => i.classe).join(' | ')}`);
    await app.pagina('claude');
    const pag = await app.ev(`[...document.querySelectorAll('#limits-list .limit-row')].map(r => ({ fill: r.querySelector('.limit-fill').className.trim(), pct: r.querySelector('.limit-pct').className.trim(), texto: r.querySelector('.limit-pct').textContent }))`);
    afirma(pag.length === 2 && pag[0].fill === 'limit-fill warn' && pag[1].fill === 'limit-fill danger', `página Claude: ${JSON.stringify(pag.map(p => p.fill))}`);
    afirma(pag[0].pct === 'limit-pct warn' && pag[1].pct === 'limit-pct danger', `página Claude, percentuais: ${JSON.stringify(pag.map(p => p.pct))}`);
    await app.foto('niveis-pagina-claude-75-95');
    await app.pagina('devcode');
    await app.foto('niveis-ide-75-95');
  });
};

CENARIOS['velho'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 20 * 60000, janela: { w: 1366, h: 768 } }, async (app, sb) => {
    await barraVisivel(app);
    await app.espera(`document.getElementById('consumo-bar').title.includes('Empresa Demo')`, 20000, 'tooltip com a conta');
    await sleep(800);
    const mtime = fs.statSync(sb.statusFile).mtimeMs;
    const hora = horaLocal(mtime);
    const b = await lerBarra(app);
    afirma(b.itens.map(i => i.pct).join('|') === '42%|27%', 'os percentuais continuam à vista');
    afirma(b.itens.every(i => i.pctCor === COR.muted), `percentual em cinza (${b.itens[0].pctCor})`);
    afirma(b.itens.every(i => i.fillBg === COR.muted), `preenchimento sem a cor de nível (${b.itens[0].fillBg})`);
    afirma(b.itens.every(i => i.classe.includes('stale')), 'classe stale nos dois itens');
    afirma(b.title.includes(`lido às ${hora}`), `tooltip com a hora da leitura (${hora}): ${JSON.stringify(b.title)}`);
    afirma(b.itens.every(i => i.valuetext.endsWith(`, lido às ${hora}`)), `aria-valuetext: ${JSON.stringify(b.itens[0].valuetext)}`);
    await app.foto('velho-1366x768');
  });
};

CENARIOS['contraste'] = async () => {
  await comApp({ status: { five: 50, seven: 50 }, idadeMs: 30000 }, async (app, sb) => {
    await barraVisivel(app);
    await sleep(800);
    const verifica = async nome => {
      const b = await lerBarra(app);
      afirma(b.itens.length === 2, `${nome}: dois itens`);
      for (const i of b.itens) {
        const cr = contraste(i.rotCor, b.fundo), cp = contraste(i.pctCor, b.fundo), cf = contraste(i.fillBg, i.trilhoBg);
        afirma(cr >= 4.5, `${nome}, ${i.rotulo}: rótulo ${cr.toFixed(1)}:1 (mínimo 4,5)`);
        afirma(cp >= 4.5, `${nome}, ${i.rotulo}: percentual ${cp.toFixed(1)}:1 (mínimo 4,5)`);
        afirma(cf >= 3, `${nome}, ${i.rotulo}: preenchimento sobre o trilho ${cf.toFixed(1)}:1 (mínimo 3)`);
      }
    };
    await verifica('ok');
    escreverStatus(sb, { five: 75, seven: 75 }, 30000);
    await atualiza(app); await barraTem(app, ['75%', '75%'], 15000); await sleep(600);
    await verifica('warn');
    escreverStatus(sb, { five: 95, seven: 95 }, 30000);
    await atualiza(app); await barraTem(app, ['95%', '95%'], 15000); await sleep(600);
    await verifica('danger');
    escreverStatus(sb, { five: 95, seven: 95 }, 20 * 60000);
    await atualiza(app);
    await app.espera(`document.querySelector('#consumo-bar .consumo-item').classList.contains('stale')`, 15000, 'estado antigo');
    await sleep(600);
    await verifica('stale');
  });
};

CENARIOS['refresh'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async (app, sb) => {
    await barraVisivel(app);
    await barraTem(app, ['42%', '27%']);
    // longe do tick de 60 s: assim só o clique em ↻ pode explicar a mudança
    await app.espera(`(() => { const m = performance.now() % 60000; return m > 12000 && m < 40000; })()`, 60000, 'meio do intervalo do timer');
    escreverStatus(sb, { five: 63, seven: 27 }, 30000);
    const t0 = Date.now();
    await atualiza(app);
    await barraTem(app, ['63%', '27%'], 6000);
    afirma(Date.now() - t0 < 6000, `a barra mudou ${Date.now() - t0} ms depois do clique em ↻, sem esperar o timer`);
  });
};

CENARIOS['ritmo'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async (app, sb) => {
    await barraVisivel(app);
    await barraTem(app, ['42%', '27%']);
    // 1) o dado muda sem ninguém clicar em nada: o timer de 60 s traz o novo valor
    escreverStatus(sb, { five: 88, seven: 27 }, 30000);
    let t = Date.now();
    await barraTem(app, ['88%', '27%'], 70000);
    afirma(true, `a barra passou a 88% sozinha, em ${Math.round((Date.now() - t) / 1000)} s`);
    await sleep(700);
    afirma((await lerBarra(app)).itens[0].fillBg === COR.laranja, '88% ficou laranja');
    // 2) o dado some: a barra some
    apagarStatus(sb);
    t = Date.now();
    await barraEscondida(app, 70000);
    afirma(true, `a barra sumiu sozinha sem o arquivo, em ${Math.round((Date.now() - t) / 1000)} s`);
    // 3) o dado volta: a barra volta
    escreverStatus(sb, { five: 10, seven: 20 }, 30000);
    t = Date.now();
    await barraTem(app, ['10%', '20%'], 70000);
    afirma(true, `a barra voltou sozinha com o arquivo, em ${Math.round((Date.now() - t) / 1000)} s`);
  });
};

CENARIOS['larguras'] = async () => {
  await comApp({ status: { five: 100, seven: 100 }, idadeMs: 30000 }, async app => {
    await barraVisivel(app);
    for (const [w, h] of [[1920, 1080], [1366, 768], [960, 720], [580, 480]]) {
      await app.tamanho(w, h);
      await sleep(600);
      const m = await app.ev(`(() => {
        const r = s => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { x: x.x, r: x.right, y: x.y, b: x.bottom, w: x.width, h: x.height }; };
        return { nome: r('.app-name'), barra: r('#consumo-bar'), dir: r('.title-bar-right'), titulo: r('#title-bar'), grade: r('.ws.active .dev-term-grid'),
                 itens: [...document.querySelectorAll('#consumo-bar .consumo-item')].map(i => { const x = i.getBoundingClientRect(); return { y: x.y, h: x.height }; }),
                 rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      })()`);
      const tag = `${w}x${h}`;
      afirma(m.barra.x >= m.nome.r && m.barra.r <= m.dir.x, `${tag}: a barra (${m.barra.x.toFixed(0)}..${m.barra.r.toFixed(0)}) cabe entre o nome (fim ${m.nome.r.toFixed(0)}) e os botões (início ${m.dir.x.toFixed(0)}); ${m.barra.w.toFixed(0)} px, sobram ${(m.dir.x - m.nome.r - m.barra.w).toFixed(0)} px`);
      afirma(m.itens.every(i => i.h <= 20 && perto(i.y, m.itens[0].y, 1)), `${tag}: cada item numa linha só (altura ${m.itens.map(i => i.h.toFixed(0)).join('/')})`);
      afirma(m.titulo.h <= 41, `${tag}: a barra de título continua com ${m.titulo.h.toFixed(0)} px`);
      afirma(perto(m.grade.h, h - 128, 2), `${tag}: a grade de terminais mantém ${m.grade.h.toFixed(0)} px (altura ${h} - 128)`);
      afirma(!m.rolagem, `${tag}: sem rolagem horizontal`);
      await app.foto(`larguras-${tag}`);
    }
  });
};

CENARIOS['outras-paginas'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async app => {
    await barraVisivel(app);
    for (const pagina of ['devcode', 'terminal', 'claude', 'rtk', 'codex', 'precos', 'novidades', 'sobre']) {
      await app.pagina(pagina);
      const b = await lerBarra(app);
      afirma(b.visivel && b.itens.length === 2, `página ${pagina}: a barra continua visível`);
    }
  });
};

// D-A: a barra lê só o arquivo da statusline, mesmo no modo `api` das Configurações e sem login
CENARIOS['modo-api'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, semCredenciais: true, settings: { limitsSource: 'api' } }, async app => {
    await barraVisivel(app);
    await barraTem(app, ['42%', '27%']);
    afirma(true, 'no modo api, sem login, a barra mostra 42% e 27% (lê só a statusline)');
    await app.pagina('claude');
    await app.espera(`document.getElementById('limits-list').textContent.includes('Sem login ativo no Claude Code')`, 15000, 'card da página Claude sem login');
    afirma(true, 'a página Claude, pelo canal claude-account, diz "Sem login ativo no Claude Code" (sem rede)');
  });
};

// ── Painel do editor: leitura e ajudantes ───────────────────────────────────
const LER_PAINEL = `(() => {
  const ws = document.querySelector('.ws.active');
  const r = e => { if (!e) return null; const x = e.getBoundingClientRect(); return { x: x.x, y: x.y, w: x.width, h: x.height, r: x.right, b: x.bottom }; };
  const ed = ws.querySelector('.dev-editors');
  const sp = ws.querySelector('.dev-splitter[data-split=editor]');
  const btn = ws.querySelector('[data-acao=alternar-editor]');
  const ativo = document.activeElement;
  const paineis = [...ws.querySelectorAll('.term-pane')];
  return {
    escondido: ws.classList.contains('editor-hidden'),
    ed: r(ed), edDisplay: getComputedStyle(ed).display, spDisplay: getComputedStyle(sp).display,
    terms: r(ws.querySelector('.dev-terms')),
    corpo: r(ws.querySelector('.term-pane-body')), tela: r(ws.querySelector('.term-pane-body .xterm-screen')),
    host: r(ws.querySelector('.dev-editor-host')), monaco: r(ws.querySelector('.monaco-editor')),
    abas: [...ws.querySelectorAll('.dev-tab')].map(t => ({ nome: t.querySelector('.dev-tab-name').textContent, sujo: t.classList.contains('dirty'), marca: t.querySelector('.dev-tab-close').textContent, ativa: t.classList.contains('active') })),
    botao: btn && { pressed: btn.getAttribute('aria-pressed'), title: btn.title, label: btn.getAttribute('aria-label') },
    temX: !!ws.querySelector('[data-acao=esconder-editor]'),
    modal: document.getElementById('save-overlay').classList.contains('visible'),
    noEditor: !!ativo.closest('.dev-editors'), ativoTag: ativo.tagName,
    ativoPainel: paineis.findIndex(p => p.contains(ativo)),
    focadoPainel: paineis.findIndex(p => p.classList.contains('focused')),
    primeiroPainel: 0,
    wsW: r(ws).w,
  };
})()`;
const lerPainel = app => app.ev(LER_PAINEL);
const esperaFrames = () => sleep(500);
const abrirArquivo = async (app, nome) => {
  await app.ev(`[...document.querySelectorAll('.ws.active .dev-node')].find(n => n.querySelector('.dev-node-name')?.textContent === ${JSON.stringify(nome)})?.click()`);
  await app.espera(`[...document.querySelectorAll('.ws.active .dev-tab.active .dev-tab-name')].some(e => e.textContent === ${JSON.stringify(nome)})`, 15000, `aba ${nome} ativa`);
  await app.espera(`!!document.querySelector('.ws.active .monaco-editor')`, 15000, 'Monaco criado');
  await sleep(300);
};
const alternarEditor = async app => { await app.clica('.ws.active [data-acao="alternar-editor"]'); await esperaFrames(); };
const textoDoModelo = (app, nome) => app.ev(`window.monaco?.editor.getModels().find(m => m.uri.path.endsWith('/${nome}'))?.getValue() ?? null`);
const esperaConfig = async (sb, cond, ms = 6000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { try { if (cond(lerConfig(sb).devcode.workspaces)) return true; } catch { /* arquivo sendo gravado */ } await sleep(200); }
  return false;
};
const sobra = p => p.corpo.w - p.tela.w; // folga à direita do xterm dentro do painel

CENARIOS['painel-esconde'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async app => {
    await abrirArquivo(app, 'a.txt');
    await app.digita('x');
    await sleep(300);
    const antes = await lerPainel(app);
    afirma(!antes.escondido && antes.ed.w > 400, `painel visível com ${antes.ed.w.toFixed(0)} px`);
    afirma(antes.abas.length === 1 && antes.abas[0].nome === 'a.txt' && antes.abas[0].sujo && antes.abas[0].marca === '●', `aba a.txt com ● (${JSON.stringify(antes.abas)})`);
    afirma(antes.botao.pressed === 'true' && antes.botao.title === 'Esconder editor' && antes.botao.label === 'Esconder editor', `botão: ${JSON.stringify(antes.botao)}`);
    await app.foto('painel-visivel-1920x1080');

    // 1) botão do cabeçalho dos terminais esconde
    await alternarEditor(app);
    const depois = await lerPainel(app);
    afirma(depois.escondido && depois.edDisplay === 'none' && depois.ed.w === 0, `coluna do editor sumiu (display ${depois.edDisplay}, ${depois.ed.w} px)`);
    afirma(depois.spDisplay === 'none', 'o splitter do editor também sumiu (não dá para arrastar)');
    afirma(depois.abas.length === 1 && depois.abas[0].nome === 'a.txt' && depois.abas[0].sujo && depois.abas[0].marca === '●', 'a aba a.txt e o ● continuam no DOM: nada foi fechado');
    afirma(!depois.modal, 'nenhuma pergunta de salvar apareceu');
    afirma(await textoDoModelo(app, 'a.txt') === 'xprimeiro arquivo\nlinha dois\n', 'o texto digitado continua no modelo do Monaco');
    afirma(depois.terms.w > 1350 && antes.terms.w < 950, `terminais foram de ${antes.terms.w.toFixed(0)} para ${depois.terms.w.toFixed(0)} px`);
    afirma(depois.tela.w > antes.tela.w + 350 && sobra(depois) < 24, `xterm reajustado: tela ${antes.tela.w.toFixed(0)} -> ${depois.tela.w.toFixed(0)} px, folga ${sobra(depois).toFixed(0)} px`);
    afirma(depois.botao.pressed === 'false' && depois.botao.title === 'Mostrar editor' && depois.botao.label === 'Mostrar editor', `botão: ${JSON.stringify(depois.botao)}`);
    await app.foto('painel-escondido-1920x1080');

    // 2) o mesmo botão mostra de volta, na largura salva
    await alternarEditor(app);
    const volta = await lerPainel(app);
    afirma(!volta.escondido && perto(volta.ed.w, antes.ed.w, 2), `coluna voltou com ${volta.ed.w.toFixed(0)} px (antes ${antes.ed.w.toFixed(0)})`);
    afirma(volta.abas[0]?.sujo && volta.abas[0].marca === '●', 'a aba a.txt continua com ●');
    afirma(await textoDoModelo(app, 'a.txt') === 'xprimeiro arquivo\nlinha dois\n', 'o texto digitado continua intacto');
    afirma(volta.monaco && volta.monaco.w > 100 && volta.monaco.h > 100 && perto(volta.monaco.w, volta.host.w, 2) && perto(volta.monaco.h, volta.host.h, 2),
      `Monaco ${volta.monaco?.w.toFixed(0)}x${volta.monaco?.h.toFixed(0)} px, igual ao host ${volta.host.w.toFixed(0)}x${volta.host.h.toFixed(0)}`);
    afirma(perto(volta.terms.w, antes.terms.w, 2) && sobra(volta) < 24, `terminais voltaram a ${volta.terms.w.toFixed(0)} px, folga ${sobra(volta).toFixed(0)} px`);

    const iconeEsconder = await app.ev(`(() => { const b = document.querySelector('.ws.active [data-acao="esconder-editor"]'); return { texto: b.textContent.trim(), svg: !!b.querySelector('svg'), title: b.title }; })()`);
    afirma(iconeEsconder.texto === '' && iconeEsconder.svg && iconeEsconder.title === 'Esconder painel do editor', `Esconder painel usa seta, não ✕ (${JSON.stringify(iconeEsconder)})`);

    // 3) o ✕ da coluna esconde, e o foco vai para um terminal (nunca para o editor escondido)
    await app.ev(`document.querySelector('.ws.active [data-acao="esconder-editor"]').focus()`);
    afirma((await lerPainel(app)).noEditor, 'antes: o foco está no ✕, dentro da coluna do editor');
    await app.clica('.ws.active [data-acao="esconder-editor"]');
    await esperaFrames();
    const viaX = await lerPainel(app);
    afirma(viaX.escondido && viaX.ed.w === 0, 'o ✕ escondeu a coluna');
    afirma(!viaX.noEditor && viaX.ativoTag !== 'BODY' && viaX.ativoPainel === 0 && viaX.focadoPainel === 0,
      `foco em vez disso no primeiro terminal vivo (activeElement ${viaX.ativoTag}, painel ${viaX.ativoPainel}, .focused ${viaX.focadoPainel})`);
    await app.foto('painel-escondido-via-x');

    // 4) se o foco já estava no botão do cabeçalho, ele fica lá (uso por teclado)
    await app.ev(`document.querySelector('.ws.active [data-acao="alternar-editor"]').focus()`);
    await app.clica('.ws.active [data-acao="alternar-editor"]');
    await esperaFrames();
    const mostrou = await lerPainel(app);
    afirma(!mostrou.escondido, 'o botão mostrou de novo');
    afirma(await app.ev(`document.activeElement === document.querySelector('.ws.active [data-acao="alternar-editor"]')`), 'o foco ficou no botão');
  });
};

CENARIOS['painel-reabre'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000 }, async app => {
    await abrirArquivo(app, 'a.txt');
    const inicial = await lerPainel(app);
    await alternarEditor(app);
    afirma((await lerPainel(app)).escondido, 'painel escondido');
    // abrir outro arquivo pelo explorador reabre o painel, na largura salva
    await abrirArquivo(app, 'b.txt');
    await sleep(500);
    const p = await lerPainel(app);
    afirma(!p.escondido && perto(p.ed.w, inicial.ed.w, 2), `o painel reapareceu com ${p.ed.w.toFixed(0)} px (salva: ${inicial.ed.w.toFixed(0)})`);
    afirma(p.abas.some(a => a.nome === 'b.txt' && a.ativa), `aba b.txt ativa (${JSON.stringify(p.abas.map(a => a.nome))})`);
    afirma(p.noEditor, 'o foco está no editor (o arquivo foi aberto para editar)');
    afirma(p.monaco && p.monaco.w > 100 && p.monaco.h > 100 && perto(p.monaco.w, p.host.w, 2), `Monaco ${p.monaco?.w.toFixed(0)}x${p.monaco?.h.toFixed(0)} px`);
    afirma(p.botao.pressed === 'true', 'o botão voltou ao estado "esconder"');
    await app.foto('painel-reabre-1920x1080');
  });
  // desde "nunca abriu arquivo": Monaco ainda nem foi carregado
  await comApp({ workspaces: [{ name: 'demo', cols: 2, editorHidden: true }] }, async app => {
    const zero = await lerPainel(app);
    afirma(zero.escondido && zero.ed.w === 0 && zero.abas.length === 0, 'começa escondido, sem abas');
    await app.clica('.ws.active .dev-node.file .dev-node-name');
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 15000, 'aba aberta');
    await app.espera(`!!document.querySelector('.ws.active .monaco-editor')`, 15000, 'Monaco criado');
    await sleep(600);
    const p = await lerPainel(app);
    afirma(!p.escondido && p.ed.w > 400, `abrir um arquivo reabriu o painel (${p.ed.w.toFixed(0)} px)`);
    afirma(p.monaco && p.monaco.w > 100 && p.monaco.h > 100 && perto(p.monaco.w, p.host.w, 2) && perto(p.monaco.h, p.host.h, 2), `editor renderizado com ${p.monaco?.w.toFixed(0)}x${p.monaco?.h.toFixed(0)} px`);
  });
};

CENARIOS['painel-arranque'] = async () => {
  await comApp({}, async (app, sb) => {
    await abrirArquivo(app, 'a.txt');
    await alternarEditor(app);
    afirma(await esperaConfig(sb, w => w.list[0].editorHidden === true && w.list[0].groups[0]?.tabs.length === 1), 'o store gravou o painel escondido com a aba aberta');
    await sleep(500);
    const novo = await app.reiniciar();
    await novo.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba restaurada');
    await sleep(800);
    const p = await lerPainel(novo);
    afirma(p.escondido && p.ed.w === 0, 'reabriu com o painel ESCONDIDO');
    afirma(p.abas.length === 1 && p.abas[0].nome === 'a.txt', 'a aba a.txt foi restaurada por baixo');
    afirma(p.terms.w > 1350 && sobra(p) < 24, `terminais ocupando o espaço (${p.terms.w.toFixed(0)} px, folga ${sobra(p).toFixed(0)})`);
    await alternarEditor(novo);
    const m = await lerPainel(novo);
    afirma(!m.escondido && m.ed.w > 400, `mostrar: coluna com ${m.ed.w.toFixed(0)} px`);
    afirma(m.monaco && m.monaco.w > 100 && m.monaco.h > 100 && perto(m.monaco.w, m.host.w, 2) && perto(m.monaco.h, m.host.h, 2),
      `Monaco criado escondido agora com ${m.monaco?.w.toFixed(0)}x${m.monaco?.h.toFixed(0)} px (host ${m.host.w.toFixed(0)}x${m.host.h.toFixed(0)})`);
    await novo.foto('painel-arranque-mostrado');
  });
};

CENARIOS['persistencia'] = async () => {
  // 1) store da versão antiga (sem o campo): abre com os dois visíveis e as abas restauradas
  await comApp({ workspaces: [
    { name: 'A', cols: 2, groups: [{ tabs: ['@a.txt'], active: '@a.txt' }], editorHidden: undefined },
    { name: 'B', cols: 1, groups: [{ tabs: ['@b.txt'], active: '@b.txt' }] },
  ] }, async (app, sb) => {
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba do primeiro workspace');
    const p1 = await lerPainel(app);
    afirma(!p1.escondido && p1.ed.w > 400 && p1.abas[0]?.nome === 'a.txt', 'store antigo: o primeiro abre com o painel visível e a aba restaurada');
    await alternarEditor(app);
    afirma(await esperaConfig(sb, w => w.list[0].editorHidden === true && w.list[1].editorHidden === false), 'gravou editorHidden: true no primeiro e false no segundo');
    await app.clica('.ws-tab:nth-child(2)');
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 15000, 'aba do segundo workspace');
    await sleep(600);
    const p2 = await lerPainel(app);
    afirma(!p2.escondido && p2.ed.w > 400 && p2.abas[0]?.nome === 'b.txt', 'o estado é por workspace: o segundo continua visível');
    await sleep(500);
    const novo = await app.reiniciar();
    await novo.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba restaurada depois de reiniciar');
    await sleep(600);
    // o app reabre no workspace que estava ativo (o segundo); confere os dois
    const seg = await lerPainel(novo);
    afirma(!seg.escondido, 'depois de reiniciar, o segundo (ativo) abre visível');
    await novo.clica('.ws-tab:nth-child(1)');
    await sleep(800);
    const pri = await lerPainel(novo);
    afirma(pri.escondido && pri.abas[0]?.nome === 'a.txt', 'depois de reiniciar, o primeiro abre escondido, com a aba restaurada');
  });
  // 2) B3: um workspace escondido e nunca ativado na sessão não perde o estado na primeira gravação
  await comApp({ workspaces: [
    { name: 'A', cols: 1, groups: [{ tabs: ['@a.txt'], active: '@a.txt' }], editorHidden: false },
    { name: 'B', cols: 1, groups: [{ tabs: ['@b.txt'], active: '@b.txt' }], editorHidden: true },
  ], ativo: 0 }, async (app, sb) => {
    await app.espera(`!!document.querySelector('.ws.active .dev-tab')`, 20000, 'aba do workspace ativo');
    await sleep(1500); // bem mais que os 300 ms do debounce do persist
    const w = lerConfig(sb).devcode.workspaces;
    afirma(w.list[0].editorHidden === false && w.list[1].editorHidden === true, `sem clicar em B, o store segue com B escondido (${JSON.stringify(w.list.map(x => x.editorHidden))})`);
    await app.clica('.ws-tab:nth-child(2)');
    await app.espera(`document.querySelector('.ws.active .dev-tab')?.textContent.includes('b.txt')`, 15000, 'workspace B ativo');
    await sleep(600);
    const p = await lerPainel(app);
    afirma(p.escondido && p.ed.w === 0, 'ao abrir B, o painel dele está escondido');
    await sleep(1000);
    const w2 = lerConfig(sb).devcode.workspaces;
    afirma(w2.list[1].editorHidden === true, 'e continua gravado como escondido');
  });
};

CENARIOS['painel-por-workspace'] = async () => {
  await comApp({ workspaces: [{ name: 'A', cols: 2 }, { name: 'B', cols: 2 }] }, async app => {
    await alternarEditor(app); // esconde o painel do A
    const a1 = await lerPainel(app);
    afirma(a1.escondido, 'A: escondido');
    await app.clica('.ws-tab:nth-child(2)');
    await sleep(800);
    const b = await lerPainel(app);
    afirma(!b.escondido && b.ed.w > 400 && b.botao.pressed === 'true', `B: continua visível (${b.ed.w.toFixed(0)} px)`);
    await app.clica('.ws-tab:nth-child(1)');
    await sleep(800);
    const a2 = await lerPainel(app);
    afirma(a2.escondido && a2.ed.w === 0 && a2.botao.pressed === 'false', 'A: voltou escondido');
    afirma(a2.terms.w > 1350 && sobra(a2) < 24, `A: terminais com o layout certo ao voltar (${a2.terms.w.toFixed(0)} px, folga ${sobra(a2).toFixed(0)})`);
  });
};

CENARIOS['painel-terminal'] = async () => {
  await comApp({}, async app => {
    const ide = await app.ev(`document.querySelectorAll('.ws.active [data-acao="alternar-editor"]').length`);
    afirma(ide === 1, 'na IDE o botão existe');
    await app.pagina('terminal');
    await abrirTerminal(app, '#page-terminal');
    const n = await app.ev(`document.querySelectorAll('#page-terminal [data-acao="alternar-editor"], #term-page [data-acao="alternar-editor"]').length`);
    afirma(n === 0, 'na página Terminal o botão não existe');
    const acoes = await app.ev(`[...document.querySelectorAll('#term-page .dev-panel-actions > *')].map(e => e.tagName + (e.dataset.act ? ':' + e.dataset.act : ''))`);
    afirma(acoes.join(',') === 'DIV,SELECT,BUTTON:new-term', `cabeçalho dos terminais da página Terminal igual ao de antes: ${acoes.join(',')}`);
  });
};

CENARIOS['painel-janela-minima'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, janela: { w: 580, h: 480 } }, async app => {
    await abrirArquivo(app, 'a.txt');
    await alternarEditor(app);
    const p = await lerPainel(app);
    const rolagem = await app.ev(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
    afirma(p.escondido && p.ed.w === 0, 'a 580x480 o painel escondeu');
    afirma(!rolagem, 'sem rolagem horizontal');
    afirma(perto(p.terms.r, 580, 2), `os terminais chegam até a borda direita (${p.terms.r.toFixed(0)} de 580)`);
    afirma(sobra(p) < 24, `xterm reajustado (folga ${sobra(p).toFixed(0)} px)`);
    await app.foto('painel-escondido-580x480');
    await alternarEditor(app);
    await app.foto('painel-visivel-580x480');
  });
};

CENARIOS['painel-sem-atalho'] = async () => {
  await comApp({}, async app => {
    await abrirArquivo(app, 'a.txt');
    const antes = await lerPainel(app);
    for (const tecla of ['b', 'j']) {
      await app.tecla(tecla, { ctrl: true });
      await sleep(300);
    }
    const depois = await lerPainel(app);
    afirma(antes.escondido === depois.escondido && !depois.escondido, 'Ctrl+B e Ctrl+J não mexem no painel');
  });
};

CENARIOS['painel-x-no-canto'] = async () => {
  await comApp({ status: { five: 42, seven: 27 }, idadeMs: 30000, janela: { w: 1366, h: 768 } }, async app => {
    await abrirArquivo(app, 'a.txt');
    await app.clica('.ws.active [data-act="split"]'); // dois quadros: o ✕ novo fica no canto do último
    await app.espera(`document.querySelectorAll('.ws.active .dev-group').length === 2`, 10000, 'segundo quadro');
    await sleep(500);
    const c = await app.ev(`(() => {
      const r = e => { const x = e.getBoundingClientRect(); return { x: x.x, y: x.y, r: x.right, b: x.bottom }; };
      const x = document.querySelector('.ws.active [data-acao="esconder-editor"]');
      const grupos = [...document.querySelectorAll('.ws.active .dev-group')];
      const botoes = grupos.flatMap(g => [...g.querySelectorAll('.dev-group-actions .dev-icon-btn')].map(b => ({ acao: b.dataset.act, ...r(b) })));
      const ed = document.querySelector('.ws.active .dev-editors').getBoundingClientRect();
      return { x: r(x), botoes, ed: { x: ed.x, y: ed.y, r: ed.right } };
    })()`);
    const inter = (a, b) => !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
    afirma(c.botoes.length === 4 && c.botoes.every(b => !inter(c.x, b)), `o ✕ novo não cobre Dividir nem Fechar quadro (${c.botoes.length} botões conferidos)`);
    afirma(c.x.r <= c.ed.r + 0.5 && c.x.y >= c.ed.y - 0.5 && c.ed.r - c.x.r < 12, `o ✕ está no canto superior direito da coluna (${c.x.r.toFixed(0)} de ${c.ed.r.toFixed(0)})`);
    await app.foto('painel-canto-x-1366x768', { x: Math.round(c.ed.x), y: Math.round(c.ed.y) - 34, width: Math.round(c.ed.r - c.ed.x), height: 90, scale: 2 });
  });
};

CENARIOS['terminal-manual'] = async () => {
  await comApp({ semTerminal: true }, async (app, sb) => {
    await sleep(1500);
    const vazio = () => app.ev(`(() => {
      const ws = document.querySelector('.ws.active');
      const e = ws.querySelector('.dev-term-empty');
      const b = e.querySelector('button');
      return { panes: ws.querySelectorAll('.term-pane').length, visivel: !e.hidden && e.offsetParent !== null, botao: b.textContent.trim(), titulo: e.textContent.includes('Nenhum terminal aberto') };
    })()`);
    let v = await vazio();
    afirma(v.panes === 0 && v.visivel && v.botao === 'Novo terminal' && v.titulo, `ao abrir a IDE não há terminal e o estado vazio aparece (${JSON.stringify(v)})`);
    await app.foto('terminal-vazio');
    // página Terminal também começa vazia
    await app.pagina('terminal');
    await sleep(800);
    const pag = await app.ev(`({ panes: document.querySelectorAll('#term-page .term-pane').length, vazio: !document.querySelector('#term-page .dev-term-empty').hidden })`);
    afirma(pag.panes === 0 && pag.vazio, `a página Terminal não abre terminal sozinha (${JSON.stringify(pag)})`);
    await app.pagina('devcode');
    await abrirTerminal(app);
    afirma(await app.ev(`document.querySelectorAll('.ws.active .term-pane').length`) === 1, 'o botão do estado do cabeçalho abre exatamente um terminal');
    afirma(await app.ev(`document.querySelector('.ws.active .dev-term-empty').hidden`), 'com terminal aberto, o estado vazio some');
    // o menu: com WSL aparecem Windows e as distros; sem WSL o terminal abriu direto, sem menu
    await app.clica('.ws.active [data-act="new-term"]');
    await sleep(700);
    const menu = await app.ev(`[...document.querySelectorAll('.dev-term-menu button')].map(b => b.textContent)`);
    if (menu.length) {
      afirma(/^Windows \(.+\)$/.test(menu[0]) && menu.slice(1).every(t => /^WSL \(.+\)$/.test(t)), `menu de escolha: ${JSON.stringify(menu)}`);
      await app.foto('terminal-menu');
      await app.tecla('Escape');
      await sleep(200);
      afirma(await app.ev(`!document.querySelector('.dev-term-menu')`), 'Esc fecha o menu');
    } else {
      afirma(await app.ev(`document.querySelectorAll('.ws.active .term-pane').length`) === 2, 'sem WSL: o clique abre o terminal direto, sem menu');
    }
  });
};

// ── EXECUÇÃO ────────────────────────────────────────────────────────────────
async function main() {
  const nomes = ESCOLHIDOS || Object.keys(CENARIOS);
  for (const n of nomes) if (!CENARIOS[n]) { console.error(`cenário desconhecido: ${n} (existem: ${Object.keys(CENARIOS).join(', ')})`); process.exit(2); }
  for (const nome of nomes) {
    cenarioAtual = nome;
    console.log(`\n● ${nome}`);
    try { await CENARIOS[nome](); } catch (e) { falhas.push(`[${nome}] exceção: ${e.message}`); console.log(`  ✗ exceção: ${e.message}`); }
  }
  console.log(`\nCapturas em: ${SAIDA}`);
  if (falhas.length) {
    console.log(`\n✗ ${falhas.length} falha(s):\n${falhas.map(f => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`\n✓ ${nomes.length} cenário(s) verde(s): ${nomes.join(', ')}`);
}

main().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
