// Prova de ponta a ponta da página RTK: total por agente (Claude laranja, Codex azul), detalhe por
// sistema no hover, chips de status, aviso do /hooks (só quando o hash gravado não bate com o do
// comando do hook) e gráfico com duas séries, com o app real em sandbox.
// Nada do usuário é lido nem gravado: home falso (RENDRA_HOME), dados falsos (RENDRA_DATA_DIR),
// pasta de dados do RTK, CLAUDE_CONFIG_DIR e CODEX_HOME em pasta temporária, e um `rtk` falso
// (scripts/e2e-rtk-fake.js, via RENDRA_E2E_RTK_BIN) que devolve dados fictícios e registra cada
// chamada. O teste nunca clica em ativar nem em instalar.
// Fora do `npm test`: abre o Electron. A janela abre fora da tela e sem foco (RENDRA_E2E_HIDDEN=1).
//
//   node scripts/e2e-rtk.js                    roda
//   node scripts/e2e-rtk.js --saida=<pasta>    onde gravar as capturas (ou RENDRA_E2E_OUT)
// Sai com código diferente de zero se qualquer asserção falhar.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const RC = require('../src/rtk-config');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = nome => (process.argv.find(a => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const SAIDA = path.resolve(arg('saida') || process.env.RENDRA_E2E_OUT
  || path.join(os.tmpdir(), `rendra-e2e-rtk-${new Date().toISOString().replace(/[:.]/g, '-')}`));

// ── Asserções ───────────────────────────────────────────────────────────────
const falhas = [];
function afirma(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); return true; }
  falhas.push(msg);
  console.log(`  ✗ ${msg}`);
  return false;
}

// ── Contraste (WCAG) ────────────────────────────────────────────────────────
const rgbDe = css => {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`cor não reconhecida: ${css}`);
  const [r, g, b] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { r, g, b };
};
const luminancia = ({ r, g, b }) => {
  const f = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contraste = (a, b) => {
  const l1 = luminancia(rgbDe(a)), l2 = luminancia(rgbDe(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const hexParaRgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

// ── Sandbox ─────────────────────────────────────────────────────────────────
const escreve = (arquivo, texto) => { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, texto); };

function criarSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-e2e-rtk-'));
  const sb = {
    dir, home: path.join(dir, 'home'), data: path.join(dir, 'data'), local: path.join(dir, 'local'),
    claude: path.join(dir, 'home', '.claude'), codex: path.join(dir, 'home', '.codex'), log: path.join(dir, 'rtk-chamadas.log'),
  };
  sb.claudeDb = path.join(sb.local, 'rtk', 'history.db');
  sb.codexDb = path.join(sb.local, 'rtk', 'codex', 'history.db');
  sb.hooks = path.join(sb.codex, 'hooks.json');
  sb.toml = path.join(sb.codex, 'config.toml');
  escreve(path.join(sb.data, 'rendra-config.json'), JSON.stringify({
    settings: { refreshInterval: 600 }, filters: { days: 30, projects: [] }, setup: { dismissed: true },
  }));
  // bancos presentes (a leitura só chama o rtk quando o arquivo existe)
  escreve(sb.claudeDb, 'banco-do-claude');
  escreve(sb.codexDb, 'banco-do-codex');
  // Claude com RTK ativo (hook absoluto e banco no env)
  const rtkFalso = path.join(dir, 'bin', 'rtk').split(path.sep).join('/');
  escreve(path.join(sb.claude, 'settings.json'), JSON.stringify({
    env: { RTK_DB_PATH: sb.claudeDb },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${rtkFalso} hook claude` }] }] },
  }, null, 2));
  // Codex com o hook do RTK em PreToolUse (depois de um grupo qualquer) e o banco no config.toml
  escreve(sb.hooks, JSON.stringify({
    hooks: { PreToolUse: [
      { hooks: [{ type: 'command', command: 'echo outro-hook', timeout: 10 }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: `${rtkFalso} hook codex` }] },
    ] },
  }, null, 2));
  escreve(sb.toml, `[shell_environment_policy]\nset = { RTK_DB_PATH = '${sb.codexDb}' }\n`);
  return sb;
}

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

async function abrir(sb) {
  const porta = 9400 + Math.floor(Math.random() * 400);
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  fs.mkdirSync(path.join(sb.dir, 'bin'), { recursive: true });
  const env = {
    ...process.env,
    RENDRA_E2E_HIDDEN: '1', RENDRA_DATA_DIR: sb.data, RENDRA_HOME: sb.home,
    // pasta de dados do RTK, config do Claude e do Codex: tudo no sandbox (nada do usuário)
    LOCALAPPDATA: sb.local, XDG_DATA_HOME: sb.local, CLAUDE_CONFIG_DIR: sb.claude, CODEX_HOME: sb.codex,
    RENDRA_E2E_RTK_BIN: path.join(__dirname, 'e2e-rtk-fake.js'), RENDRA_E2E_RTK_LOG: sb.log,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${porta}`], { cwd: ROOT, env, stdio: 'ignore' });
  const { ws, send, ev } = await conectar(porta);
  const app = { sb, proc, ws, send, ev };
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  app.espera = async (expr, ms = 20000, msg = expr) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      try { if (await ev(expr)) return true; } catch { /* página ainda carregando */ }
      await sleep(150);
    }
    throw new Error(`tempo esgotado esperando: ${msg}`);
  };
  app.clica = async seletor => {
    const ok = await ev(`(() => { const el = document.querySelector(${JSON.stringify(seletor)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`não achei para clicar: ${seletor}`);
  };
  app.estilo = (seletor, prop) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(seletor)}))[${JSON.stringify(prop)}]`);
  app.texto = seletor => ev(`document.querySelector(${JSON.stringify(seletor)})?.textContent ?? null`);
  app.centro = seletor => ev(`(() => { const r = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  app.mouse = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(250); };
  app.foto = async nome => {
    fs.mkdirSync(SAIDA, { recursive: true });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
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
  await app.espera(`typeof loadRtk === 'function' && !!document.querySelector('[data-page=rtk]')`, 30000, 'app carregado');
  return app;
}

// ── Cenário ─────────────────────────────────────────────────────────────────
async function cenario(app, sb) {
  console.log('Isolamento');
  const dentroDe = (p, base) => { const r = path.relative(path.resolve(base).toLowerCase(), path.resolve(p).toLowerCase()); return !r.startsWith('..') && !path.isAbsolute(r); };
  const codexReal = path.join(os.homedir(), '.codex');
  afirma([sb.codex, sb.hooks, sb.toml, sb.claude, sb.codexDb].every(p => dentroDe(p, sb.dir)), 'todo caminho do Codex e do Claude do teste fica na pasta temporária');
  afirma([sb.codex, sb.hooks, sb.toml].every(p => !dentroDe(p, codexReal)), 'nenhum caminho do teste aponta para o ~/.codex real');
  const rotuloHost = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform];
  await app.clica('[data-page=rtk]');
  await app.espera(`document.getElementById('rtk-claude-total').textContent.includes('economizados')`, 30000, 'página RTK carregada');
  await sleep(600); // o gráfico anima

  console.log('Totais por agente');
  afirma((await app.texto('#rtk-claude-total')).includes('100,0K'), `total do Claude Code mostra 100,0K (lido: ${await app.texto('#rtk-claude-total')})`);
  afirma((await app.texto('#rtk-codex-total')).includes('40,0K'), `total do Codex mostra 40,0K (lido: ${await app.texto('#rtk-codex-total')})`);
  const laranja = hexParaRgb((await app.ev(`getComputedStyle(document.documentElement).getPropertyValue('--orange')`)).trim());
  const azul = hexParaRgb((await app.ev(`getComputedStyle(document.documentElement).getPropertyValue('--codex')`)).trim());
  afirma(azul === 'rgb(74, 158, 255)', `--codex é #4a9eff (${azul})`);
  afirma((await app.estilo('#rtk-claude-total', 'color')) === laranja, `total do Claude Code em laranja (${await app.estilo('#rtk-claude-total', 'color')})`);
  afirma((await app.estilo('#rtk-codex-total', 'color')) === azul, `total do Codex em azul (${await app.estilo('#rtk-codex-total', 'color')})`);
  const fundo = await app.estilo('#rtk-agent-claude', 'backgroundColor');
  afirma(contraste(await app.estilo('#rtk-claude-total', 'color'), fundo) >= 4.5, `contraste do laranja sobre o cartão >= 4,5:1 (${contraste(laranja, fundo).toFixed(2)})`);
  afirma(contraste(await app.estilo('#rtk-codex-total', 'color'), fundo) >= 4.5, `contraste do azul sobre o cartão >= 4,5:1 (${contraste(azul, fundo).toFixed(2)})`);
  const combinado = await app.texto('#rtk-saved');
  afirma(combinado.includes('140,0K'), `cartão do topo soma os dois agentes: 140,0K (lido: ${combinado})`);
  afirma((await app.texto('#rtk-commands')) === '42', `comandos somados: 42 (lido: ${await app.texto('#rtk-commands')})`);

  console.log('Hover por sistema');
  const tipEscondido = await app.estilo('#rtk-codex-tip', 'display');
  afirma(tipEscondido === 'none', 'o detalhe fica escondido sem hover');
  const c = await app.centro('#rtk-codex-total');
  await app.mouse(c.x, c.y);
  afirma((await app.estilo('#rtk-codex-tip', 'display')) === 'block', 'hover no total do Codex mostra o detalhe');
  const tipCodex = await app.texto('#rtk-codex-tip');
  afirma(tipCodex.includes(`${rotuloHost}: 40.000 tokens, 12 comandos`), `detalhe do Codex lista o sistema (${rotuloHost}) com os números (lido: ${JSON.stringify(tipCodex)})`);
  await app.foto('rtk-hover-codex');
  const c2 = await app.centro('#rtk-claude-total');
  await app.mouse(c2.x, c2.y);
  const tipClaude = await app.texto('#rtk-claude-tip');
  afirma((await app.estilo('#rtk-claude-tip', 'display')) === 'block' && tipClaude.includes(`${rotuloHost}: 100.000 tokens, 30 comandos`), `hover no Claude Code lista ${rotuloHost} (lido: ${JSON.stringify(tipClaude)})`);
  await app.foto('rtk-hover-claude');
  await app.mouse(5, 5);
  afirma((await app.estilo('#rtk-claude-tip', 'display')) === 'none', 'sem hover o detalhe some');
  await app.ev(`document.getElementById('rtk-codex-total').focus()`);
  afirma((await app.estilo('#rtk-codex-tip', 'display')) === 'block', 'o foco por teclado também mostra o detalhe');
  await app.ev(`document.getElementById('rtk-codex-total').blur()`);

  console.log('Aviso do /hooks e chips');
  const aviso = () => app.ev(`[...document.querySelectorAll('.rtk-warn.trust')].map(e => e.textContent)`);
  const chips = () => app.ev(`[...document.querySelectorAll('#rtk-checks .rtk-check')].map(e => e.textContent)`);
  const recarrega = async () => { await app.ev('loadRtk()'); await sleep(800); };
  // a chave do Codex com CODEX_HOME é o caminho canônico; o hash vem do comando que o hooks.json traz
  const hooksReal = path.join(fs.realpathSync.native(sb.codex), 'hooks.json');
  const alvo = RC.rtkTrustTargets(fs.readFileSync(sb.hooks, 'utf8'), hooksReal)[0];
  const textoOk = t => t.includes('/hooks') && t.includes('PreToolUse') && /aperte t\b/.test(t);

  const pendente = await aviso();
  afirma(pendente.length === 1 && textoOk(pendente[0]), `sem aprovação gravada o aviso aparece com /hooks, PreToolUse e a tecla t (${JSON.stringify(pendente)})`);
  const chipsPend = await chips();
  afirma(chipsPend.includes(`Claude Code (${rotuloHost}): RTK ativo`) && chipsPend.includes(`Codex (${rotuloHost}): falta aprovar o hook`), `chips: Claude Code ativo e Codex pendente (${JSON.stringify(chipsPend)})`);
  afirma(chipsPend.every(c => !/opencode|cursor|local|claude\.md/i.test(c)), 'nenhum chip de OpenCode, Cursor ou CLAUDE.md local');
  await app.foto('rtk-aviso-hooks');

  // hash falso na chave certa: o Codex diria "modificado", o aviso continua
  fs.writeFileSync(sb.toml, RC.upsertHookTrust(fs.readFileSync(sb.toml, 'utf8'), alvo.key, 'sha256:abc').text);
  await recarrega();
  const falso = await aviso();
  afirma(falso.length === 1 && textoOk(falso[0]), 'com hash falso o aviso continua (hash que não bate não conta como aprovado)');
  afirma((await chips()).includes(`Codex (${rotuloHost}): hook alterado, falta aprovar`), 'chip do Codex mostra hook alterado');

  // hash real do comando do hooks.json: o aviso some e o chip fica aprovado
  fs.writeFileSync(sb.toml, RC.upsertHookTrust(fs.readFileSync(sb.toml, 'utf8'), alvo.key, alvo.hash).text);
  await recarrega();
  const semAviso = await aviso();
  afirma(semAviso.length === 0, 'com o hash real do comando o aviso do /hooks some');
  afirma((await chips()).includes(`Codex (${rotuloHost}): RTK ativo e aprovado`), 'chip do Codex mostra ativo e aprovado');
  const pagina = await app.ev('document.body.innerText');
  afirma(!/writable_roots|sandbox/i.test(pagina), 'a página não cita writable_roots nem sandbox');
  await app.foto('rtk-tudo-pronto');

  console.log('Gráfico e textos');
  const series = await app.ev(`(() => { const c = Chart.getChart('chart-rtk-daily'); return c ? c.data.datasets.map(d => ({ label: d.label, cor: d.backgroundColor, n: d.data.length })) : null; })()`);
  afirma(series && series.length === 2, `o gráfico diário tem duas séries (${JSON.stringify(series)})`);
  afirma(series && series[0].cor.toLowerCase() === '#e8650a' && series[1].cor.toLowerCase() === '#4a9eff', 'séries com as cores dos tokens (laranja e azul)');
  const corpo = await app.ev('document.body.innerText');
  afirma(!corpo.includes('não separa por agente'), 'a nota antiga ("o RTK não separa por agente") não existe');
  afirma(corpo.includes('Cada agente grava em um banco próprio'), 'a nota nova está na página');
  afirma(corpo.toLowerCase().includes('por comando (claude code, neste sistema)'), 'a tabela diz que é do Claude Code neste sistema');
  afirma((await app.ev(`document.querySelectorAll('[data-rtk-action=install],[data-rtk-action=enable]').length`)) === 0, 'com tudo ativo não há botão de ativar nem de instalar');
  await app.foto('rtk-pagina');

  console.log('Chamadas ao rtk falso');
  const linhas = fs.readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const gains = linhas.filter(l => l.args.join(' ') === 'gain --all --format json');
  const dbs = [...new Set(gains.map(g => g.db))];
  afirma(dbs.length === 2 && dbs.includes(sb.claudeDb) && dbs.includes(sb.codexDb), `duas leituras com RTK_DB_PATH diferentes (${dbs.length}): o do Claude e o do Codex`);
  const dentro = p => path.resolve(p).toLowerCase().startsWith(path.resolve(sb.dir).toLowerCase());
  afirma(gains.every(g => dentro(g.db)), 'todo RTK_DB_PATH recebido está dentro do sandbox');
  const real = process.env.LOCALAPPDATA_REAL;
  afirma(!real || gains.every(g => !path.resolve(g.db).toLowerCase().startsWith(path.resolve(real, 'rtk').toLowerCase())), 'nenhuma leitura sob a pasta de dados real do RTK');
  afirma(!linhas.some(l => l.args[0] === 'init' && l.args[1] === '-g'), 'nenhum rtk init -g foi executado (o teste não ativa nada)');
  afirma(!linhas.some(l => l.args[0] === 'init'), 'nenhum rtk init (nem --show) foi chamado: os chips vêm dos dados por sistema');
}

async function main() {
  const sb = criarSandbox();
  process.env.LOCALAPPDATA_REAL = process.env.LOCALAPPDATA || '';
  let app = null;
  try {
    app = await abrir(sb);
    await cenario(app, sb);
  } finally {
    if (app) await app.fechar();
    try { fs.rmSync(sb.dir, { recursive: true, force: true }); } catch { /* temp, o sistema limpa depois */ }
  }
  if (falhas.length) {
    console.error(`\n✗ ${falhas.length} asserção(ões) falharam:\n  ` + falhas.join('\n  '));
    process.exit(1);
  }
  console.log(`\n✓ página RTK conferida; capturas em ${SAIDA}`);
}

main().catch(e => { console.error(e); process.exit(1); });
