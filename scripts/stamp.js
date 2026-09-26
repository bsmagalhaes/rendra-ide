// Writes the signature header, with the version read from package.json, at the top of every JS
// and CSS file the app runs. Run by `npm run release` (never edit the header by hand);
// test/header.test.js fails when a file is missing it or carries an old version.
// Run: npm run stamp

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HEADER = `/*! Rendra IDE v${pkg.version} | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */`;
const HEADER_RE = /^\/\*! Rendra IDE v[^\n]*\*\/\r?\n/;

function shippedFiles() {
  const list = ['main.js', 'preload.js'];
  for (const dir of ['src', 'renderer']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (/\.(js|css)$/.test(f)) list.push(`${dir}/${f}`);
  }
  return list.sort();
}

function stamp() {
  let changed = 0;
  for (const rel of shippedFiles()) {
    const file = path.join(ROOT, rel);
    const src = fs.readFileSync(file, 'utf8');
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const next = HEADER + eol + src.replace(HEADER_RE, '');
    if (next !== src) { fs.writeFileSync(file, next); changed++; }
  }
  return changed;
}

module.exports = { HEADER, shippedFiles };

if (require.main === module) {
  const n = stamp();
  console.log(`✓ cabeçalho v${pkg.version} em ${shippedFiles().length} arquivos (${n} alterados)`);
}
