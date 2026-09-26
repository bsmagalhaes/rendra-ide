// Project checks (there is no build step: Electron runs the sources as they are):
// syntax of every JS file, valid JSON files, balanced <div>s in index.html and the files the app
// and the setup need to exist. Run: npm run check

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const errors = [];
const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);

const js = ['main.js', 'preload.js', ...['src', 'renderer', 'scripts', 'test'].flatMap(walk)].filter(f => f.endsWith('.js'));
for (const f of js) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) { errors.push(`${f}: ${String(e.stderr).split('\n').find(l => l.includes('Error')) || 'erro de sintaxe'}`); }
}

for (const f of ['package.json', 'pricing.json', 'project-aliases.json']) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { errors.push(`${f}: JSON inválido (${e.message})`); }
}

const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8');
const open = (html.match(/<div\b/g) || []).length, close = (html.match(/<\/div>/g) || []).length;
if (open !== close) errors.push(`renderer/index.html: ${open} <div> para ${close} </div>`);
for (const src of html.matchAll(/<script src="([^"]+)"/g)) {
  if (!/^https?:/.test(src[1]) && !fs.existsSync(path.join(ROOT, 'renderer', src[1]))) errors.push(`renderer/index.html: script ausente ${src[1]}`);
}

for (const f of ['LICENSE', 'CHANGELOG.md', 'licenses/RTK-LICENSE.txt', 'src/statusline.sh', 'assets/icon.png', 'assets/icon.ico', 'scripts/setup-env.js', 'scripts/apply-update.js']) {
  if (!fs.existsSync(path.join(ROOT, f))) errors.push(`arquivo ausente: ${f}`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problema(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`✓ ${js.length} arquivos JS, JSON, index.html e arquivos obrigatórios conferidos`);
