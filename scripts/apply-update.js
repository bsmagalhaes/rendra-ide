// Finishes a Rendra IDE update for git clones (started by src/git-updater.js as the app quits):
// waits for the app to exit, runs `git pull --ff-only`, runs `npm install` when the dependencies
// changed, writes the outcome for the app to show, and reopens the app. If origin/main had its
// history rewritten and the working tree is clean, it resets to origin/main instead of the pull
// (old commits stay in the branch rendra-backup-antes-da-atualizacao).
// Manual equivalent: git pull && npm install && npm start

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const root = arg('root') || path.join(__dirname, '..');
const pid = parseInt(arg('pid')) || 0;
const resultFile = arg('result');
const logFile = resultFile ? path.join(path.dirname(resultFile), 'update-log.txt') : null;

const log = msg => { if (logFile) try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ } };
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && cmd === 'npm' });
  log(`$ ${cmd} ${args.join(' ')}\n${(r.stdout || '').trim()}\n${(r.stderr || '').trim()}`);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || r.error?.message || '').trim() };
};
const alive = p => { try { process.kill(p, 0); return true; } catch { return false; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { return null; } };

function relaunch() {
  let electron;
  try { electron = require(path.join(root, 'node_modules', 'electron')); } catch (e) { log(`electron not found: ${e.message}`); return; }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(electron, [root], { cwd: root, env, detached: true, stdio: 'ignore' }).unref();
}

(async () => {
  for (let i = 0; pid && alive(pid) && i < 120; i++) await sleep(500); // up to 60 s
  await sleep(800); // let Windows release file handles
  const from = version();
  const before = sh('git', ['rev-parse', 'HEAD']).out;
  const result = { ok: false, from, to: from, at: new Date().toISOString() };

  let pull = sh('git', ['pull', '--ff-only']);
  let rewritten = false;
  if (!pull.ok) {
    // History rewritten upstream: the old HEAD is not an ancestor of origin/main (no common ancestor
    // or diverged). With no local changes to the app files, it is safe to follow the new history.
    const fetched = sh('git', ['fetch', 'origin']);
    rewritten = fetched.ok && sh('git', ['rev-parse', '--verify', 'origin/main']).ok
      && !sh('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']).ok;
    if (rewritten && sh('git', ['status', '--porcelain', '--untracked-files=no']).out === '') {
      sh('git', ['branch', '-f', 'rendra-backup-antes-da-atualizacao', 'HEAD']); // old commits stay recoverable
      pull = sh('git', ['reset', '--hard', 'origin/main']);
    }
  }
  if (!pull.ok) {
    result.error = rewritten || /local changes|would be overwritten|diverg|not possible to fast-forward/i.test(pull.err)
      ? 'Há alterações locais nos arquivos do Rendra IDE. Guarde-as (git stash) e atualize de novo.'
      : `git pull falhou: ${pull.err.split('\n')[0]}`;
  } else {
    const changed = sh('git', ['diff', '--name-only', before, 'HEAD']).out.split('\n');
    if (changed.some(f => f === 'package.json' || f === 'package-lock.json')) {
      const npm = sh('npm', ['install', '--no-audit', '--no-fund']);
      if (!npm.ok) result.error = `npm install falhou: ${npm.err.split('\n').pop()}`;
    }
    result.ok = !result.error;
    result.to = version();
  }
  if (resultFile) try { fs.writeFileSync(resultFile, JSON.stringify(result, null, 2)); } catch { /* ignore */ }
  relaunch();
})();
