/*! Rendra IDE v1.3.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: escritores de configuração dos agentes. Tudo puro (texto entra, texto sai): nada aqui
// toca o disco. Quem lê, aplica e grava de forma atômica é src/rtk-enable.js.
// JSON (settings.json do Claude, hooks.json do Codex): reserializa com a indentação detectada.
// TOML (config.toml do Codex): só por acréscimo de texto, nunca reserializa.

const { hookCommand, isRtkHookCommand } = require('./rtk-paths');

// ── JSON ─────────────────────────────────────────────────────────────────────
function detectIndent(text) {
  const m = /^([ \t]+)\S/m.exec(String(text));
  if (!m) return 2;
  return m[1].includes('\t') ? '\t' : m[1].length;
}
function parseJson(text) {
  try {
    const v = JSON.parse(String(text || ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}
function dumpJson(obj, original) {
  const eol = /\r\n/.test(original) ? '\r\n' : '\n';
  let out = JSON.stringify(obj, null, detectIndent(original));
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return /\r?\n$/.test(original) ? out + eol : out;
}
const preToolUse = obj => (Array.isArray(obj?.hooks?.PreToolUse) ? obj.hooks.PreToolUse : []);

// Todas as entradas de hook do RTK para o agente: [{ group, hook, g, i }]
function rtkHookEntries(obj, kind) {
  const out = [];
  preToolUse(obj).forEach((group, g) => {
    (Array.isArray(group?.hooks) ? group.hooks : []).forEach((hook, i) => {
      if (hook && isRtkHookCommand(hook.command, kind)) out.push({ group, hook, g, i });
    });
  });
  return out;
}
const isAbsCommand = cmd => /^"?([A-Za-z]:[\\/]|\/)/.test(String(cmd || '').trim());

function hasRtkHook(jsonText, kind) {
  const obj = parseJson(jsonText);
  return !!obj && rtkHookEntries(obj, kind).length > 0;
}
function isAbsoluteHook(jsonText, kind) {
  const obj = parseJson(jsonText);
  const e = obj ? rtkHookEntries(obj, kind) : [];
  return e.length > 0 && e.every(x => isAbsCommand(x.hook.command));
}

// Troca o comando de cada hook do RTK pelo absoluto. Só reescreve se o texto do comando mudar.
function patchHookCommand(obj, kind, absRtk, opts) {
  const entries = rtkHookEntries(obj, kind);
  const notes = [];
  if (!entries.length) {
    notes.push(`Hook do RTK para o ${kind === 'codex' ? 'Codex' : 'Claude Code'} não encontrado; ative o RTK primeiro (rtk init).`);
    return { hookChanged: false, notes };
  }
  const want = hookCommand(absRtk, kind, opts.platform, { gitBash: !!opts.gitBash });
  if (!want.command) {
    notes.push(`${want.note} O hook foi mantido como está.`);
    return { hookChanged: false, notes };
  }
  let hookChanged = false;
  for (const e of entries) {
    if (e.hook.command !== want.command) { e.hook.command = want.command; hookChanged = true; }
  }
  return { hookChanged, notes };
}

// settings.json do Claude: comando absoluto no grupo do RTK e env.RTK_DB_PATH. Não cria o grupo.
function patchClaudeSettings(jsonText, { dbPath, absRtk, platform = process.platform, gitBash = false } = {}) {
  const obj = parseJson(jsonText);
  if (!obj) return { text: jsonText, changed: false, hookChanged: false, notes: ['settings.json do Claude ilegível; nada foi alterado.'] };
  const { hookChanged, notes } = patchHookCommand(obj, 'claude', absRtk, { platform, gitBash });
  let envChanged = false;
  if (dbPath) {
    if (!obj.env || typeof obj.env !== 'object' || Array.isArray(obj.env)) obj.env = {};
    if (obj.env.RTK_DB_PATH !== dbPath) { obj.env.RTK_DB_PATH = dbPath; envChanged = true; }
  }
  const changed = hookChanged || envChanged;
  if (envChanged) notes.push(`env.RTK_DB_PATH = ${dbPath}`);
  return { text: changed ? dumpJson(obj, jsonText) : jsonText, changed, hookChanged, notes };
}
const claudeDbEnv = jsonText => {
  const v = parseJson(jsonText)?.env?.RTK_DB_PATH;
  return typeof v === 'string' ? v : null;
};

// hooks.json do Codex: comando absoluto na entrada do RTK. Não cria entrada (quem cria é `rtk init -g --codex`).
function patchCodexHooks(jsonText, absRtk, { platform = process.platform, gitBash = false } = {}) {
  const obj = parseJson(jsonText);
  if (!obj) return { text: jsonText, changed: false, hookChanged: false, notes: ['hooks.json do Codex ilegível; nada foi alterado.'] };
  const { hookChanged, notes } = patchHookCommand(obj, 'codex', absRtk, { platform, gitBash });
  return { text: hookChanged ? dumpJson(obj, jsonText) : jsonText, changed: hookChanged, hookChanged, notes };
}

// ── TOML ─────────────────────────────────────────────────────────────────────
// Literal ('...') guarda a barra invertida do Windows como está; com `'` ou controle, string básica escapada.
function tomlString(s) {
  const v = String(s);
  if (!/['\u0000-\u001f\u007f]/.test(v)) return `'${v}'`;
  const esc = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f\u007f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"${esc}"`;
}
const untoml = (q, body) => (q === '"' ? body.replace(/\\(["\\])/g, '$1') : body);

function envSnippet(dbPath) {
  return `[shell_environment_policy]\nset = { RTK_DB_PATH = ${tomlString(dbPath)} }`;
}

// config.toml do Codex: acrescenta `[shell_environment_policy] set = { RTK_DB_PATH = ... }` ao fim.
// Se a tabela já existe (em qualquer forma), não edita: devolve o trecho para o usuário aplicar.
function patchCodexConfigToml(tomlText, dbPath) {
  const text = String(tomlText || '');
  const snippet = envSnippet(dbPath);
  if (/shell_environment_policy/.test(text)) {
    const m = /\bRTK_DB_PATH\s*=\s*(['"])(.*?)\1/.exec(text);
    if (m && untoml(m[1], m[2]) === dbPath) {
      return { text, changed: false, snippet: null, notes: ['config.toml já tem o RTK_DB_PATH do Codex certo.'] };
    }
    return {
      text, changed: false, snippet,
      notes: ['config.toml já tem shell_environment_policy; não foi editado. Aplique à mão, juntando ao que já existe:\n' + snippet],
    };
  }
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const body = snippet.split('\n').join(eol) + eol;
  let sep = '';
  if (text.length) sep = text.endsWith('\n') ? eol : eol + eol;
  return {
    text: text + sep + body, changed: true, snippet,
    notes: [`Acrescentado ao fim do config.toml:\n${snippet}`],
  };
}
const codexDbEnv = tomlText => {
  if (!/\[shell_environment_policy\]|shell_environment_policy\s*\./.test(String(tomlText || ''))) return null;
  const m = /\bRTK_DB_PATH\s*=\s*(['"])(.*?)\1/.exec(String(tomlText));
  return m ? untoml(m[1], m[2]) : null;
};

// ── Confiança do hook no Codex ───────────────────────────────────────────────
const normKey = k => String(k).replace(/\\/g, '/').toLowerCase();

// Chaves de [hooks.state."<chave>"] que têm trusted_hash
function trustedKeys(tomlText) {
  const keys = new Set();
  const re = /^\s*\[hooks\.state\.(["'])(.+?)\1\]\s*$/gm;
  const text = String(tomlText || '');
  let m;
  while ((m = re.exec(text))) {
    const rest = text.slice(re.lastIndex);
    const next = rest.search(/^\s*\[/m);
    const body = next < 0 ? rest : rest.slice(0, next);
    if (/^\s*trusted_hash\s*=/m.test(body)) keys.add(normKey(untoml(m[1], m[2])));
  }
  return keys;
}

// pending: o Codex vai pedir confirmação em /hooks (hook novo ou alterado); trusted-unverified:
// há confiança registrada para o índice e a IDE não mexeu, mas o algoritmo do hash não está nos fatos.
function codexHookTrust(hooksJsonText, tomlText, hooksJsonPath, { changedNow = false } = {}) {
  const obj = parseJson(hooksJsonText);
  const e = obj ? rtkHookEntries(obj, 'codex')[0] : null;
  if (!e) return { state: 'no-hook', key: null };
  const key = `${hooksJsonPath}:pre_tool_use:${e.g}:${e.i}`;
  if (changedNow) return { state: 'pending', key };
  return { state: trustedKeys(tomlText).has(normKey(key)) ? 'trusted-unverified' : 'pending', key };
}

module.exports = {
  hasRtkHook, isAbsoluteHook, patchClaudeSettings, claudeDbEnv, patchCodexHooks,
  patchCodexConfigToml, codexDbEnv, codexHookTrust, detectIndent,
};
