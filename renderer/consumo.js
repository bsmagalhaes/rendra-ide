/*! Rendra IDE v1.1.3 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Barra de consumo do Claude Code na barra de título: regras puras (nível de cor, percentual, dado
// antigo, tooltip). Carregado no renderer (window.RendraConsumo) e nos testes (require).
// Sem DOM e sem relógio: o instante atual e as funções de texto entram por parâmetro.
(function (root) {
  const LIMITE_ANTIGO_MS = 15 * 60 * 1000;
  const ITENS = [
    { chave: 'session', rotulo: '5 Horas', ariaRotulo: 'Limite de 5 horas' },
    { chave: 'weekly_all', rotulo: 'Semanal', ariaRotulo: 'Limite semanal' },
  ];

  const numeroValido = v => typeof v === 'number' && Number.isFinite(v);
  const limitar = v => Math.min(100, Math.max(0, v));

  // Mesma regra da página Claude: 70% laranja, 90% vermelho.
  function nivelDe(percent) {
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warn';
    return 'ok';
  }

  function formatarPercentual(percent) {
    return `${Math.round(limitar(percent))}%`;
  }

  // res: resposta de limits (forma de claude-account): { limits, fetchedAt, error, needsBridge }.
  // deps: { conta, plano, fmtResetIn(ts), fmtHora(ts) }.
  function estadoConsumo(res, agora, deps = {}) {
    const vazio = { visivel: false, itens: [], tooltip: '' };
    if (!res || !Array.isArray(res.limits) || !res.limits.length) return vazio;

    const velho = !numeroValido(res.fetchedAt) || agora - res.fetchedAt > LIMITE_ANTIGO_MS;
    const hora = numeroValido(res.fetchedAt) && deps.fmtHora ? deps.fmtHora(res.fetchedAt) : '';
    const lido = hora ? `lido às ${hora}` : '';

    const itens = [];
    const reinicios = [];
    for (const def of ITENS) {
      const limite = res.limits.find(l => l && l.kind === def.chave && numeroValido(l.percent));
      if (!limite) continue;
      const percent = Math.round(limitar(limite.percent));
      const nivel = nivelDe(percent);
      const texto = formatarPercentual(percent);
      itens.push({
        chave: def.chave, rotulo: def.rotulo, ariaRotulo: def.ariaRotulo, percent, texto, nivel,
        classe: velho ? 'stale' : nivel,
        ariaTexto: velho && lido ? `${texto}, ${lido}` : texto,
      });
      const reinicio = deps.fmtResetIn ? deps.fmtResetIn(limite.resetsAt) : '';
      if (reinicio) reinicios.push(`${def.rotulo}: ${reinicio}`);
    }
    if (!itens.length) return vazio;

    const linhas = [];
    const quem = [deps.conta, deps.plano].filter(Boolean).join(' · ');
    if (quem) linhas.push(quem);
    linhas.push(...reinicios);
    if (velho) linhas.push(lido ? `Dado antigo, ${lido}` : 'Dado antigo');
    return { visivel: true, itens, tooltip: linhas.join('\n') };
  }

  const api = { nivelDe, formatarPercentual, estadoConsumo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraConsumo = api;
})(typeof window !== 'undefined' ? window : this);
