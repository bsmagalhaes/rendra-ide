#!/usr/bin/env node
// `npm run setup` — checks and installs the DevCode tools (Git / Git Bash, RTK, WSL on Windows)
// for people running Rendra IDE from a clone of the repository.
//   npm run setup            ask before installing what's missing
//   npm run setup -- --yes   install everything missing without asking
//   npm run setup -- --check only report

const readline = require('readline');
const setup = require('../src/setup');

const args = process.argv.slice(2);
const log = msg => console.log(msg);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(/^s|^y/i.test(a.trim()) || a.trim() === ''); }));
}

(async () => {
  const s = await setup.check();
  const isWin = s.platform === 'win32';
  const items = [
    { key: 'git', name: isWin ? 'Git Bash' : 'Git', ready: s.git.installed, detail: s.git.path },
    { key: 'rtk', name: 'RTK', ready: s.rtk.installed, detail: s.rtk.version },
    { key: 'rtk-hook', name: 'RTK ativo no Claude Code', ready: s.rtk.hook, detail: 'hook configurado' },
    ...(s.wsl.applicable ? [{ key: 'wsl', name: 'WSL', ready: s.wsl.ready, detail: s.wsl.distros.map(d => d.name).join(', ') }] : []),
  ];
  console.log('\nRendra IDE · ambiente de desenvolvimento\n');
  for (const i of items) console.log(`  ${i.ready ? '✔' : '✖'} ${i.name.padEnd(26)} ${i.ready ? (i.detail || 'ok') : 'faltando'}`);
  const todo = items.filter(i => !i.ready);
  if (!todo.length) { console.log('\nTudo pronto.\n'); return; }
  if (args.includes('--check')) { process.exitCode = 1; return; }

  const install = [];
  for (const i of todo) {
    if (args.includes('--yes') || await ask(`\nInstalar ${i.name}? [S/n] `)) install.push(i.key);
  }
  if (install.includes('rtk') && !install.includes('rtk-hook') && !s.rtk.hook) install.push('rtk-hook');

  const steps = {
    git: () => setup.installGit(log),
    rtk: () => setup.installRtk(log),
    'rtk-hook': () => setup.enableRtkHook(log),
    wsl: () => setup.installWsl(log),
  };
  for (const key of ['git', 'rtk', 'rtk-hook', 'wsl'].filter(k => install.includes(k))) {
    try {
      const r = await steps[key]();
      console.log(`✔ ${key}${r?.note ? ` — ${r.note}` : ''}${r?.needsReboot ? ' — reinicie o computador para concluir' : ''}`);
    } catch (e) {
      console.log(`✖ ${key}: ${e.message}`);
      process.exitCode = 1;
    }
  }
})();
