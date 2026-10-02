/*! Rendra IDE v1.1.6 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Página RTK: soma pura da economia por agente (Claude Code e Codex) entre os sistemas
// (Windows, Linux, distros WSL). Carregado no renderer (window.RendraRtkAgents) e nos testes
// (require). Sem DOM: recebe `environments` de `rtk-status` e devolve números e textos.
(function (root) {
  const AGENTS = ['claude', 'codex'];
  const num = v => (Number.isFinite(+v) ? +v : 0);
  const fmtInt = n => String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // pct do RTK: saved / input * 100, 0 quando input é 0 (nunca média de médias)
  const pctOf = (saved, input) => (input > 0 ? (saved / input) * 100 : 0);

  const emptyTotal = () => ({ commands: 0, input: 0, output: 0, saved: 0, pct: 0, timeMs: 0, avgTimeMs: 0 });
  function finish(t) {
    t.pct = pctOf(t.saved, t.input);
    t.avgTimeMs = t.commands > 0 ? t.timeMs / t.commands : 0;
    return t;
  }

  function aggregateAgent(environments, agent) {
    const total = emptyTotal();
    const byDate = new Map();
    const perEnvironment = [];
    for (const e of environments || []) {
      const entry = { id: e.id, label: e.label, state: e.state, saved: 0, commands: 0, error: null };
      const a = e.state === 'ok' ? e.agents?.[agent] : null;
      if (a && a.error) entry.error = a.error;
      else if (a) {
        const s = a.gain?.summary || {};
        total.commands += num(s.total_commands);
        total.input += num(s.total_input);
        total.output += num(s.total_output);
        total.saved += num(s.total_saved);
        total.timeMs += num(s.total_time_ms);
        entry.saved = num(s.total_saved);
        entry.commands = num(s.total_commands);
        for (const d of a.gain?.daily || []) {
          const cur = byDate.get(d.date) || { date: d.date, saved: 0, commands: 0 };
          cur.saved += num(d.saved_tokens);
          cur.commands += num(d.commands);
          byDate.set(d.date, cur);
        }
      }
      perEnvironment.push(entry);
    }
    const daily = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return { total: finish(total), daily, perEnvironment };
  }

  function aggregateAgents(environments) {
    return Object.fromEntries(AGENTS.map(a => [a, aggregateAgent(environments, a)]));
  }

  // Cartões do topo: os dois agentes somados
  function combinedTotals(agents) {
    const t = emptyTotal();
    for (const a of AGENTS) {
      const x = agents[a].total;
      t.commands += x.commands; t.input += x.input; t.output += x.output; t.saved += x.saved; t.timeMs += x.timeMs;
    }
    return finish(t);
  }

  // Linhas do hover: uma por sistema
  function tooltipLines(agg) {
    return agg.perEnvironment.map(e => {
      if (e.state === 'wsl-off') return `${e.label}: WSL desligado`;
      if (e.state === 'missing') return `${e.label}: RTK ausente`;
      if (e.state !== 'ok' || e.error) return `${e.label}: erro ao ler`;
      return `${e.label}: ${fmtInt(e.saved)} tokens, ${fmtInt(e.commands)} comandos`;
    });
  }

  // Gráfico diário: união das datas, um vetor por agente (0 onde o agente não tem o dia)
  function chartSeries(agents) {
    const dates = [...new Set(AGENTS.flatMap(a => agents[a].daily.map(d => d.date)))].sort();
    const col = a => dates.map(d => agents[a].daily.find(x => x.date === d)?.saved || 0);
    return { labels: dates, claude: col('claude'), codex: col('codex') };
  }

  const api = { aggregateAgents, combinedTotals, tooltipLines, chartSeries, fmtInt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraRtkAgents = api;
})(typeof window !== 'undefined' ? window : this);
