/*! Rendra IDE v1.1.5 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Onde os agentes gravam as sessões depende do sistema do TERMINAL, não do da IDE: quem abre o
// terminal WSL no Windows roda o Claude Code e o Codex dentro da distro, e os arquivos ficam em
// /home/<usuário>/.claude/projects e /home/<usuário>/.codex/sessions. Daqui o Windows os alcança
// pelo caminho UNC //wsl.localhost/<distro>/home/<usuário>/... (barras invertidas no Windows)
// Descoberta: distros de `wsl -l -v` (sem docker-desktop), só as que estão em execução (ler uma
// distro parada pelo UNC a acordaria); em cada uma, as pastas de /home e /root que têm
// .claude/projects ou .codex/sessions. Falha silenciosa, com tempo limite e cache.

const fs = require('fs');
const path = require('path');

const VAZIO = () => ({ claude: [], codex: [] });
let cache = null; // { at, value }
const _limpaCache = () => { cache = null; };

const uncPadrao = distro => ['', '', 'wsl.localhost', distro].join(path.win32.sep);
const existe = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const nomes = p => { try { return fs.readdirSync(p); } catch { return []; } };

function varre(raiz) {
  const out = VAZIO();
  const homes = [path.join(raiz, 'root'), ...nomes(path.join(raiz, 'home')).map(u => path.join(raiz, 'home', u))];
  for (const h of homes) {
    const c = path.join(h, '.claude', 'projects');
    const x = path.join(h, '.codex', 'sessions');
    if (existe(c)) out.claude.push(c);
    if (existe(x)) out.codex.push(x);
  }
  return out;
}

async function descobre({ listDistros, uncRoot }) {
  const out = VAZIO();
  let distros;
  try { distros = await listDistros(); } catch { return out; }
  for (const d of distros || []) {
    if (!/^running$/i.test(d.state)) continue;
    const r = varre(uncRoot(d.name));
    out.claude.push(...r.claude);
    out.codex.push(...r.codex);
  }
  return out;
}

// deps (testes): platform, listDistros, uncRoot, ttl, timeoutMs
async function wslRoots(deps = {}) {
  if ((deps.platform || process.platform) !== 'win32') return VAZIO();
  const ttl = deps.ttl ?? 60000;
  if (ttl && cache && Date.now() - cache.at < ttl) return cache.value;
  const listDistros = deps.listDistros || (() => require('./setup').listWslDistros(4000));
  const limite = new Promise(r => { const t = setTimeout(() => r(VAZIO()), deps.timeoutMs ?? 6000); t.unref?.(); });
  const value = await Promise.race([descobre({ listDistros, uncRoot: deps.uncRoot || uncPadrao }), limite]);
  if (ttl) cache = { at: Date.now(), value };
  return value;
}

module.exports = { wslRoots, _limpaCache };
