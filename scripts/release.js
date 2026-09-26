// Publishes a new Rendra IDE version in one command:
//   npm run release -- patch | minor | major | X.Y.Z   [--no-push]
// 1. confirms the branch and the files that go into the release commit
// 2. turns "## Próxima versão" in CHANGELOG.md into "## X.Y.Z · DD/MM/AAAA" (or uses an existing
//    "## X.Y.Z" section); stops if there are no release notes
// 3. bumps package.json and package-lock.json, stamps the file headers (scripts/stamp.js)
// 4. runs npm run check and npm test
// 5. commits "chore: versão X.Y.Z", tags vX.Y.Z and pushes both. The tag makes GitHub Actions publish
//    the release notes (.github/workflows/release.yml); installed copies (git clone) see the new
//    version in package.json on main and offer "Atualizar agora".

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');
const { compareVersions, changelogSection } = require('../src/git-updater');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const push = !args.includes('--no-push');
const bump = args.find(a => !a.startsWith('--'));

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const fail = msg => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const step = msg => console.log(`\n→ ${msg}`);
const ask = q => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, a => { rl.close(); res(/^s(im)?$/i.test(a.trim())); });
});
const npm = (...a) => {
  const r = spawnSync('npm', a, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`npm ${a.join(' ')} falhou`);
};

function nextVersion(cur, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [ma, mi, pa] = cur.split('.').map(Number);
  if (kind === 'major') return `${ma + 1}.0.0`;
  if (kind === 'minor') return `${ma}.${mi + 1}.0`;
  if (kind === 'patch') return `${ma}.${mi}.${pa + 1}`;
  return null;
}

(async () => {
  if (!bump) fail('Informe a versão: npm run release -- patch | minor | major | X.Y.Z');
  const pkgFile = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const version = nextVersion(pkg.version, bump);
  if (!version) fail(`Versão inválida: ${bump}`);
  // the current version may be published as is while it has no tag yet (first release)
  if (compareVersions(version, pkg.version) < 0) fail(`A versão nova (${version}) não pode ser menor que a atual (${pkg.version})`);
  if (git('tag', '--list', `v${version}`)) fail(`A tag v${version} já existe`);

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const target = pkg.rendra?.branch || 'main';
  if (branch !== target) fail(`Publique a partir da branch ${target} (atual: ${branch})`);

  // Release notes
  step('CHANGELOG.md');
  const clFile = path.join(ROOT, 'CHANGELOG.md');
  let cl = fs.readFileSync(clFile, 'utf8');
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (/^## Próxima versão\s*$/m.test(cl)) {
    cl = cl.replace(/^## Próxima versão\s*$/m, `## ${version} · ${today}`);
  } else if (!changelogSection(cl, version)) {
    fail(`Escreva as novidades no CHANGELOG.md, na seção "## Próxima versão" (ou "## ${version} · ${today}")`);
  }
  const notes = changelogSection(cl, version);
  if (!notes.trim()) fail(`A seção ${version} do CHANGELOG.md está vazia`);
  console.log(notes.split('\n').map(l => '   ' + l).join('\n'));

  // What goes into the commit
  const pending = git('status', '--porcelain');
  console.log(`\nVersão ${pkg.version} → ${version} (branch ${branch}${push ? ', com push' : ', sem push'})`);
  if (pending) console.log(`Arquivos que entram no commit da versão:\n${pending.split('\n').map(l => '   ' + l).join('\n')}`);
  if (!(await ask('\nPublicar? (s/N) '))) fail('Cancelado');

  fs.writeFileSync(clFile, cl);
  step(`package.json → ${version}`);
  npm('version', version, '--no-git-tag-version', '--allow-same-version');

  const electron = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  if (!pkg.allowScripts?.[`electron@${electron}`]) {
    console.warn(`\n! O Electron instalado é ${electron} e não está em "allowScripts". Rode "npm approve-scripts electron" para que o npm 11 dos usuários baixe o Electron no npm install.`);
  }

  step('Cabeçalhos');
  execFileSync(process.execPath, [path.join(__dirname, 'stamp.js')], { stdio: 'inherit' });

  step('Verificações');
  npm('run', 'check');
  npm('test');

  step('Commit e tag');
  git('add', '-A');
  git('commit', '-m', `chore: versão ${version}`);
  git('tag', '-a', `v${version}`, '-m', `Rendra IDE ${version}`);

  if (push) {
    step('Push');
    execFileSync('git', ['push', 'origin', branch, '--follow-tags'], { cwd: ROOT, stdio: 'inherit' });
    console.log(`\n✓ Versão ${version} publicada. O GitHub Actions cria a release com as novidades; os apps instalados oferecem a atualização ao abrir.`);
  } else {
    console.log(`\n✓ Versão ${version} pronta localmente. Para publicar: git push origin ${branch} --follow-tags`);
  }
})();
