// Notas da release a partir do CHANGELOG.md. Versão estável exige a seção "## X.Y.Z"; pré-release
// (X.Y.Z-rc.N) usa a seção da versão-base ou "Próxima versão" e, sem nenhuma, um aviso de teste.
// Uso: node scripts/release-notes.js <versão> <owner/repo> > notes.md
const fs = require('fs');
const { changelogSection } = require('../src/git-updater');

function releaseNotes(changelog, version, repo) {
  const pre = version.includes('-');
  let corpo = changelogSection(changelog, version);
  if (!corpo && pre) corpo = changelogSection(changelog, version.split('-')[0]) || changelogSection(changelog, 'Próxima versão');
  if (!corpo && pre) corpo = 'Pré-lançamento de teste dos instaladores. Não use em produção.';
  if (!corpo) return null;
  const aviso = pre ? 'Pré-lançamento de teste: não é a versão estável.\n\n' : '';
  return `${aviso}${corpo}\n\n---\n\nComo instalar ou atualizar: veja o [README](https://github.com/${repo}#instalação).\n`;
}

module.exports = { releaseNotes };

if (require.main === module) {
  const [version, repo] = process.argv.slice(2);
  const notas = releaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), version, repo);
  if (!notas) { console.error(`CHANGELOG.md sem a seção da versão ${version}`); process.exit(1); }
  process.stdout.write(notas);
}
