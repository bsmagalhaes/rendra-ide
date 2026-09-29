// End-to-end update for git clones: a local "GitHub" (bare repo), a user's clone, a new version
// published on the remote. Checks that the app sees it, and that scripts/apply-update.js pulls it,
// runs npm install (package.json changed) and records the outcome, without touching local data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { createGitUpdater } = require('../src/git-updater');

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@exemplo.com', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const pkg = version => JSON.stringify({ name: 'app-teste', version, private: true }, null, 2) + '\n';

test('atualiza um clone quando sai uma versão nova', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-update-'));
  try {
    const remote = path.join(dir, 'remote.git'), maint = path.join(dir, 'maint'), user = path.join(dir, 'user');
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
    git(dir, 'clone', '-q', remote, maint);
    fs.mkdirSync(path.join(maint, 'scripts'));
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'apply-update.js'), path.join(maint, 'scripts', 'apply-update.js'));
    fs.writeFileSync(path.join(maint, 'package.json'), pkg('1.0.0'));
    fs.writeFileSync(path.join(maint, 'CHANGELOG.md'), '# Novidades\n\n## 1.0.0 · 01/09/2026\n\n- Primeira\n');
    git(maint, 'add', '-A'); git(maint, 'commit', '-q', '-m', 'feat: 1.0.0'); git(maint, 'push', '-q', 'origin', 'main');
    git(dir, 'clone', '-q', remote, user);

    const states = [];
    const data = path.join(dir, 'data');
    fs.mkdirSync(data);
    const updater = createGitUpdater({ root: user, dataDir: data, currentVersion: '1.0.0', send: s => states.push(s) });
    assert.strictEqual((await updater.check()).state, 'idle', 'sem versão nova, nada aparece');

    // the maintainer publishes 1.1.0; a commit without a version bump does not count
    fs.writeFileSync(path.join(maint, 'package.json'), pkg('1.1.0'));
    fs.writeFileSync(path.join(maint, 'CHANGELOG.md'), '# Novidades\n\n## 1.1.0 · 26/09/2026\n\n- Nova tela\n\n## 1.0.0 · 01/09/2026\n\n- Primeira\n');
    git(maint, 'add', '-A'); git(maint, 'commit', '-q', '-m', 'chore: versão 1.1.0'); git(maint, 'push', '-q', 'origin', 'main');

    const st = await updater.check();
    assert.strictEqual(st.state, 'available');
    assert.strictEqual(st.version, '1.1.0');
    assert.strictEqual(st.notes, '- Nova tela');
    assert.strictEqual(st.localChanges, false);

    // the helper, as started when the app quits (no running app: pid 0)
    const result = path.join(data, 'update-result.json');
    const r = spawnSync(process.execPath, [path.join(user, 'scripts', 'apply-update.js'), '--root', user, '--pid', '0', '--result', result], { encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(fs.readFileSync(result, 'utf8'));
    assert.deepStrictEqual([out.ok, out.from, out.to], [true, '1.0.0', '1.1.0'], out.error);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(user, 'package.json'), 'utf8')).version, '1.1.0');
    assert.ok(fs.existsSync(path.join(user, 'package-lock.json')), 'npm install rodou porque o package.json mudou');
    assert.match(fs.readFileSync(path.join(data, 'update-log.txt'), 'utf8'), /git pull --ff-only/);

    // shown once on the next start, then gone
    assert.strictEqual(updater.lastResult().to, '1.1.0');
    assert.strictEqual(updater.lastResult(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('alteração local em conflito: não perde nada e avisa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-update-'));
  try {
    const remote = path.join(dir, 'remote.git'), maint = path.join(dir, 'maint'), user = path.join(dir, 'user');
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
    git(dir, 'clone', '-q', remote, maint);
    fs.mkdirSync(path.join(maint, 'scripts'));
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'apply-update.js'), path.join(maint, 'scripts', 'apply-update.js'));
    fs.writeFileSync(path.join(maint, 'package.json'), pkg('1.0.0'));
    fs.writeFileSync(path.join(maint, 'app.js'), 'original\n');
    git(maint, 'add', '-A'); git(maint, 'commit', '-q', '-m', 'feat: 1.0.0'); git(maint, 'push', '-q', 'origin', 'main');
    git(dir, 'clone', '-q', remote, user);
    fs.writeFileSync(path.join(user, 'app.js'), 'mudança do usuário\n');
    fs.writeFileSync(path.join(maint, 'app.js'), 'versão nova\n');
    git(maint, 'add', '-A'); git(maint, 'commit', '-q', '-m', 'fix: app'); git(maint, 'push', '-q', 'origin', 'main');

    const result = path.join(dir, 'result.json');
    spawnSync(process.execPath, [path.join(user, 'scripts', 'apply-update.js'), '--root', user, '--pid', '0', '--result', result], { timeout: 60000 });
    const out = JSON.parse(fs.readFileSync(result, 'utf8'));
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /alterações locais/);
    assert.strictEqual(fs.readFileSync(path.join(user, 'app.js'), 'utf8'), 'mudança do usuário\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Histórico do origin/main reescrito (git push --force com raízes novas), como na migração de autor.
function rewrittenFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-update-'));
  const remote = path.join(dir, 'remote.git'), maint = path.join(dir, 'maint'), user = path.join(dir, 'user'), data = path.join(dir, 'data');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  git(dir, 'clone', '-q', remote, maint);
  fs.mkdirSync(path.join(maint, 'scripts'));
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'apply-update.js'), path.join(maint, 'scripts', 'apply-update.js'));
  fs.writeFileSync(path.join(maint, 'package.json'), pkg('1.0.0'));
  fs.writeFileSync(path.join(maint, 'app.js'), 'original\n');
  git(maint, 'add', '-A'); git(maint, 'commit', '-q', '-m', 'feat: 1.0.0'); git(maint, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '-q', remote, user);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'settings.json'), '{"tema":"escuro"}\n');
  // reescrita: nenhum commit antigo sobrevive, a árvore ganha a versão 1.1.0
  git(maint, 'checkout', '-q', '--orphan', 'reescrito');
  fs.writeFileSync(path.join(maint, 'package.json'), pkg('1.1.0'));
  fs.writeFileSync(path.join(maint, 'app.js'), 'versão nova\n');
  git(maint, 'add', '-A'); git(maint, 'commit', '-q', '-m', 'chore: versão 1.1.0'); git(maint, 'push', '-q', '--force', 'origin', 'reescrito:main');
  return { dir, user, data, result: path.join(data, 'update-result.json'), oldHead: git(user, 'rev-parse', 'HEAD'), newHead: git(maint, 'rev-parse', 'HEAD') };
}
const runHelper = f => spawnSync(process.execPath, [path.join(f.user, 'scripts', 'apply-update.js'), '--root', f.user, '--pid', '0', '--result', f.result], { encoding: 'utf8', timeout: 120000 });

test('histórico reescrito com árvore limpa: o app se recupera sozinho', () => {
  const f = rewrittenFixture();
  try {
    assert.notStrictEqual(runHelper(f).status, null);
    const out = JSON.parse(fs.readFileSync(f.result, 'utf8'));
    assert.deepStrictEqual([out.ok, out.from, out.to], [true, '1.0.0', '1.1.0'], out.error);
    assert.strictEqual(git(f.user, 'rev-parse', 'HEAD'), f.newHead, 'clone igual ao origin/main');
    assert.strictEqual(git(f.user, 'status', '--porcelain', '--untracked-files=no'), '');
    assert.strictEqual(fs.readFileSync(path.join(f.user, 'app.js'), 'utf8').replace(/\r\n/g, '\n'), 'versão nova\n');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(f.user, 'package.json'), 'utf8')).version, '1.1.0');
    assert.ok(fs.existsSync(path.join(f.user, 'package-lock.json')), 'npm install rodou porque o package.json mudou');
    assert.strictEqual(fs.readFileSync(path.join(f.data, 'settings.json'), 'utf8'), '{"tema":"escuro"}\n', 'dados do usuário intactos');
    assert.strictEqual(git(f.user, 'rev-parse', 'rendra-backup-antes-da-atualizacao'), f.oldHead, 'commits antigos ficam guardados numa branch');
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('histórico reescrito com mudança local: não mexe em nada e avisa', () => {
  const f = rewrittenFixture();
  try {
    fs.writeFileSync(path.join(f.user, 'app.js'), 'mudança do usuário\n');
    runHelper(f);
    const out = JSON.parse(fs.readFileSync(f.result, 'utf8'));
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /alterações locais/);
    assert.strictEqual(git(f.user, 'rev-parse', 'HEAD'), f.oldHead, 'HEAD não saiu do lugar');
    assert.strictEqual(fs.readFileSync(path.join(f.user, 'app.js'), 'utf8'), 'mudança do usuário\n');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(f.user, 'package.json'), 'utf8')).version, '1.0.0');
    assert.strictEqual(fs.readFileSync(path.join(f.data, 'settings.json'), 'utf8'), '{"tema":"escuro"}\n');
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
