// Confere os assets de uma release em rascunho antes de publicar: nenhum esperado pode faltar e
// nenhum proibido pode existir (blockmap do Windows e do dmg, .nsis.7z, portable, latest-mac.json).
// Uso: node scripts/check-release-assets.js assets.json [--sem-mac]   (assets.json: ["nome", ...])
const fs = require('fs');

const BASE = ['Rendra-IDE-Setup.exe', 'latest.yml', 'Rendra-IDE.AppImage', 'Rendra-IDE.deb', 'latest-linux.yml'];
const MAC = [
  'Rendra-IDE-mac-arm64.dmg', 'Rendra-IDE-mac-arm64.zip', 'Rendra-IDE-mac-arm64.zip.blockmap',
  'Rendra-IDE-mac-x64.dmg', 'Rendra-IDE-mac-x64.zip', 'Rendra-IDE-mac-x64.zip.blockmap',
  'latest-mac.yml',
];

function expectedAssets({ mac }) { return mac ? [...BASE, ...MAC] : [...BASE]; }

function checkAssets(names, { mac }) {
  const esperados = expectedAssets({ mac });
  const faltando = esperados.filter(n => !names.includes(n));
  const proibidos = names.filter(n => {
    if (/\.nsis\.7z$/i.test(n) || /portable/i.test(n) || n === 'latest-mac.json') return true;
    if (/\.blockmap$/.test(n)) return !esperados.includes(n); // só os dois .zip.blockmap do mac
    return false;
  });
  const inesperados = names.filter(n => !esperados.includes(n) && !proibidos.includes(n));
  return { faltando, proibidos, inesperados, ok: !faltando.length && !proibidos.length };
}

module.exports = { checkAssets, expectedAssets };

if (require.main === module) {
  const [file, flag] = process.argv.slice(2);
  const names = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = checkAssets(names, { mac: flag !== '--sem-mac' });
  console.log(`assets na release (${names.length}): ${names.join(', ')}`);
  if (r.inesperados.length) console.log(`::warning::assets fora da lista esperada: ${r.inesperados.join(', ')}`);
  if (!r.ok) {
    console.error(`release reprovada. Faltando: ${r.faltando.join(', ') || 'nada'}. Proibidos: ${r.proibidos.join(', ') || 'nada'}.`);
    process.exit(1);
  }
  console.log('todos os assets esperados estão na release e nenhum proibido');
}
