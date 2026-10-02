// Junta o latest-mac.yml de cada arquitetura (arm64 e x64) num só. Os dois jobs de macOS gravam um
// latest-mac.yml cada, só com o seu zip, e o segundo envio apagaria o primeiro na release: sem isso
// o Mac Apple Silicon receberia o x64 (Rosetta) ou o Intel ficaria sem arquivo (MacUpdater filtra por
// arquitetura). Uso: node scripts/merge-latest-mac.js a.yml b.yml > latest-mac.yml
//                    node scripts/merge-latest-mac.js --check latest-mac.yml
// js-yaml vem como dependência do electron-updater (está no package-lock).
const fs = require('fs');
const yaml = require('js-yaml');

const ARCHS = ['arm64', 'x64'];
const zipArch = url => ARCHS.find(a => new RegExp(`-${a}\\.zip$`).test(url)) || null;

function mergeLatestMac(textos) {
  const docs = textos.map(t => yaml.load(t));
  if (!docs.length || docs.some(d => !d || !Array.isArray(d.files))) throw new Error('latest-mac.yml inválido: sem lista "files"');
  const versoes = new Set(docs.map(d => String(d.version)));
  if (versoes.size !== 1) throw new Error(`versões diferentes nos latest-mac.yml: ${[...versoes].join(', ')}`);
  const porUrl = new Map();
  for (const d of docs) for (const f of d.files) porUrl.set(f.url, f);
  // arm64 antes de x64, para o topo do arquivo (path, sha512) apontar para um zip de forma estável
  const files = [...porUrl.values()].sort((a, b) => ARCHS.indexOf(zipArch(a.url)) - ARCHS.indexOf(zipArch(b.url)));
  const primeiro = files.find(f => zipArch(f.url)) || files[0];
  const releaseDate = docs.map(d => String(d.releaseDate || '')).sort().pop();
  const out = { version: docs[0].version, files, path: primeiro.url, sha512: primeiro.sha512, releaseDate };
  return yaml.dump(out, { lineWidth: -1, quotingType: "'" });
}

// Erros (lista vazia = ok): o arquivo final precisa listar o zip das duas arquiteturas
function checkLatestMac(texto) {
  const erros = [];
  let doc;
  try { doc = yaml.load(texto); } catch (e) { return [`yaml inválido: ${e.message}`]; }
  if (!doc || !Array.isArray(doc.files)) return ['sem lista "files"'];
  for (const a of ARCHS) {
    const f = doc.files.find(x => zipArch(x.url) === a);
    if (!f) erros.push(`falta o zip ${a} em latest-mac.yml`);
    else if (!f.sha512 || !f.size) erros.push(`o zip ${a} está sem sha512 ou size`);
  }
  return erros;
}

module.exports = { mergeLatestMac, checkLatestMac };

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--check') {
      const erros = checkLatestMac(fs.readFileSync(args[1], 'utf8'));
      if (erros.length) { console.error('latest-mac.yml reprovado:\n  ' + erros.join('\n  ')); process.exit(1); }
      console.log('latest-mac.yml lista os dois zips (arm64 e x64)');
    } else {
      process.stdout.write(mergeLatestMac(args.map(f => fs.readFileSync(f, 'utf8'))));
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
