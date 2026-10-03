// Detecção dos provedores pelo `--version`, com o executor injetado (nada roda de verdade aqui).
const test = require('node:test');
const assert = require('node:assert');
const { detectar, _limpaCache } = require('../src/provedores-instalados');

// executor falso: `regras` responde por "file args"; o que não tem regra falha. Registra todas as chamadas.
function executor(regras) {
  const chamadas = [];
  const executar = async (file, args, opts = {}) => {
    chamadas.push({ file, args, opts });
    const chave = `${file} ${args.join(' ')}`;
    const r = regras.find(x => x[0].test(chave));
    return r ? r[1] : { ok: false, stdout: '' };
  };
  return { executar, chamadas };
}
const OK = { ok: true, stdout: '1.0.0\n' };
const WIN = { tipo: 'windows', distro: null, cwd: 'D:\\x' };
const WSL = { tipo: 'wsl', distro: 'Ubuntu-24.04', cwd: '/mnt/d/x' };

test('Windows: .exe roda direto e .cmd por cmd.exe, sem shell e sem EINVAL', async () => {
  _limpaCache();
  const { executar, chamadas } = executor([
    [/^where\.exe claude$/, { ok: true, stdout: 'C:\\Users\\u\\.local\\bin\\claude.exe\r\n' }],
    [/^where\.exe codex$/, { ok: true, stdout: 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex\r\nC:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd\r\n' }],
    [/claude\.exe --version$/, OK],
    [/^cmd\.exe \/d \/s \/c /, OK],
  ]);
  const r = await detectar({ amb: WIN, deps: { executar, platform: 'win32' } });
  assert.deepStrictEqual(r, { claude: true, codex: true });
  const exe = chamadas.find(c => c.file === 'C:\\Users\\u\\.local\\bin\\claude.exe');
  assert.deepStrictEqual(exe.args, ['--version']);
  const cmd = chamadas.find(c => c.file === 'cmd.exe');
  assert.deepStrictEqual(cmd.args, ['/d', '/s', '/c', '""C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd" --version"']);
  assert.strictEqual(cmd.opts.windowsVerbatimArguments, true);
  assert.ok(chamadas.every(c => !c.opts.shell), 'nunca shell: true');
});

test('Windows: caminho de .cmd com metacaractere do cmd é tratado como não instalado e nunca executado', async () => {
  for (const ruim of ['C:\\x&calc\\codex.cmd', 'C:\\x^y\\codex.cmd', 'C:\\x%PATH%\\codex.cmd', 'C:\\x"y\\codex.cmd', 'C:\\x|y\\codex.cmd', 'C:\\x<y\\codex.cmd', 'relativo\\codex.cmd', '\\\\servidor\\x\\codex.cmd']) {
    _limpaCache();
    const { executar, chamadas } = executor([[/^where\.exe codex$/, { ok: true, stdout: `${ruim}\r\n` }]]);
    const r = await detectar({ amb: WIN, deps: { executar, platform: 'win32' } });
    assert.strictEqual(r.codex, false, ruim);
    assert.ok(!chamadas.some(c => c.file === 'cmd.exe'), `não executa ${ruim}`);
  }
});

test('Windows: sem o binário no PATH, ou --version com falha, não é instalado', async () => {
  _limpaCache();
  const { executar } = executor([
    [/^where\.exe claude$/, { ok: false, stdout: '' }],
    [/^where\.exe codex$/, { ok: true, stdout: 'C:\\n\\codex.cmd\r\n' }],
    [/^cmd\.exe/, { ok: false, stdout: '' }],
  ]);
  assert.deepStrictEqual(await detectar({ amb: WIN, deps: { executar, platform: 'win32' } }), { claude: false, codex: false });
});

test('WSL: bash -lic com `command <binário> --version` literal; codex com node: not found não é oferecido', async () => {
  _limpaCache();
  const { executar, chamadas } = executor([
    [/command claude --version$/, OK],
    [/command codex --version$/, { ok: false, stdout: '' }], // exec: node: not found
  ]);
  const r = await detectar({ amb: WSL, deps: { executar, platform: 'win32' } });
  assert.deepStrictEqual(r, { claude: true, codex: false });
  assert.deepStrictEqual(chamadas.map(c => [c.file, ...c.args]).sort(), [
    ['wsl.exe', '-d', 'Ubuntu-24.04', '-e', 'bash', '-lic', 'command claude --version'],
    ['wsl.exe', '-d', 'Ubuntu-24.04', '-e', 'bash', '-lic', 'command codex --version'],
  ].sort());
  assert.ok(chamadas.every(c => !/command -v/.test(c.args.join(' '))));
});

test('os dois provedores com saída 0, ou só um', async () => {
  _limpaCache();
  const dois = executor([[/--version$/, OK]]);
  assert.deepStrictEqual(await detectar({ amb: WSL, deps: { executar: dois.executar, platform: 'win32' } }), { claude: true, codex: true });
  _limpaCache();
  const so = executor([[/command codex --version$/, OK]]);
  assert.deepStrictEqual(await detectar({ amb: WSL, deps: { executar: so.executar, platform: 'win32' } }), { claude: false, codex: true });
});

test('estouro de tempo (executor pendurado) conta como não instalado', async () => {
  _limpaCache();
  const executar = () => new Promise(() => { /* nunca responde */ });
  const t0 = Date.now();
  const r = await detectar({ amb: WSL, deps: { executar, platform: 'win32', timeoutMs: 150 } });
  assert.deepStrictEqual(r, { claude: false, codex: false });
  assert.ok(Date.now() - t0 < 2000);
});

test('distro parada não chama o executor; nome de distro suspeito também não', async () => {
  _limpaCache();
  const a = executor([[/--version$/, OK]]);
  assert.deepStrictEqual(await detectar({ amb: WSL, distroRodando: false, deps: { executar: a.executar, platform: 'win32' } }), { claude: false, codex: false });
  assert.strictEqual(a.chamadas.length, 0);
  for (const nome of ['-e', 'a b', 'x;calc', '', '$(calc)', 'a\nb']) {
    const b = executor([[/--version$/, OK]]);
    assert.deepStrictEqual(await detectar({ amb: { tipo: 'wsl', distro: nome, cwd: '/x' }, deps: { executar: b.executar, platform: 'win32' } }), { claude: false, codex: false }, nome);
    assert.strictEqual(b.chamadas.length, 0, nome);
  }
});

test('cache de 60 s por ambiente: a segunda chamada não executa de novo; passada a validade, sim', async () => {
  _limpaCache();
  let agora = 1000;
  const { executar, chamadas } = executor([[/--version$/, OK]]);
  const deps = { executar, platform: 'win32', agora: () => agora };
  await detectar({ amb: WSL, deps });
  const n = chamadas.length;
  await detectar({ amb: WSL, deps });
  assert.strictEqual(chamadas.length, n);
  await detectar({ amb: { ...WSL, distro: 'ubuntu-24.04' }, deps });
  assert.strictEqual(chamadas.length, n, 'a distro vale sem diferenciar caixa');
  await detectar({ amb: { ...WSL, distro: 'Debian' }, deps });
  assert.ok(chamadas.length > n, 'outro ambiente executa');
  const m = chamadas.length;
  agora += 61000;
  await detectar({ amb: WSL, deps });
  assert.ok(chamadas.length > m, 'cache vencido');
});

test('ambiente nulo ou desconhecido: nenhum provedor e nenhuma execução', async () => {
  _limpaCache();
  const { executar, chamadas } = executor([[/--version$/, OK]]);
  assert.deepStrictEqual(await detectar({ amb: null, deps: { executar } }), { claude: false, codex: false });
  assert.deepStrictEqual(await detectar({ amb: { tipo: 'outro' }, deps: { executar } }), { claude: false, codex: false });
  assert.strictEqual(chamadas.length, 0);
});

test('Linux/macOS (ambiente local): which e execução direta', async () => {
  _limpaCache();
  const { executar, chamadas } = executor([
    [/^which claude$/, { ok: true, stdout: '/usr/local/bin/claude\n' }],
    [/^\/usr\/local\/bin\/claude --version$/, OK],
  ]);
  const r = await detectar({ amb: WIN, deps: { executar, platform: 'linux' } });
  assert.deepStrictEqual(r, { claude: true, codex: false });
  assert.ok(chamadas.some(c => c.file === '/usr/local/bin/claude' && c.args[0] === '--version'));
});
