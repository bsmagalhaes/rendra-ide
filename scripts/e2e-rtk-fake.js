// `rtk` falso do teste de ponta a ponta da página RTK (scripts/e2e-rtk.js). Nunca é usado fora
// dele: a IDE só o executa com RENDRA_E2E_HIDDEN=1 e RENDRA_HOME definidos. Devolve dados
// fictícios no formato do `rtk` 0.50.0 e registra cada chamada com o RTK_DB_PATH recebido.
//
// Quem recebe o caminho do Codex (pasta `codex` no caminho) vê 40.000 tokens economizados;
// qualquer outro caminho (o banco do Claude) vê 100.000.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const db = process.env.RTK_DB_PATH || '';
if (process.env.RENDRA_E2E_RTK_LOG) {
  fs.appendFileSync(process.env.RENDRA_E2E_RTK_LOG, JSON.stringify({ args, db }) + '\n');
}

const codex = db.split(path.sep).includes('codex') || db.split('/').includes('codex');
const saved = codex ? 40000 : 100000;
const comandos = codex ? 12 : 30;
const daily = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((date, i) => {
  const s = Math.round(saved * [0.1, 0.2, 0.3, 0.4][i]);
  return { date, commands: Math.round(comandos * [0.1, 0.2, 0.3, 0.4][i]), input_tokens: s * 2, output_tokens: s, saved_tokens: s, savings_pct: 50, total_time_ms: 10, avg_time_ms: 1 };
});
const gain = {
  summary: { total_commands: comandos, total_input: saved * 2, total_output: saved, total_saved: saved, avg_savings_pct: 50, total_time_ms: 300, avg_time_ms: 10 },
  daily, weekly: [], monthly: [],
};

const j = args.join(' ');
if (j === '--version') console.log('rtk 0.50.0');
else if (j === 'gain --all --format json') console.log(JSON.stringify(gain));
else if (j === 'gain') {
  console.log(['RTK Token Savings (Global Scope)', '', 'By Command', '  #  Command            Count  Saved  Avg%  Time  Impact',
    '  1.  rtk git status        12   4.5K   80.0%   3ms  ████', '  2.  rtk ls                 8   1.2K   60.0%   2ms  ██'].join('\n'));
} else console.log('(sem saída no rtk falso)');
