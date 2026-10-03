/*! Rendra IDE v1.5.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Teclas do terminal que a IDE trata antes do xterm.js. Carregado no renderer (window.RendraTermKeys)
// e nos testes (require).
//
// Shift+Enter quebra a linha nas CLIs de IA (Claude Code, Codex) sem enviar o prompt. O xterm.js
// ignora o Shift no Enter e manda só CR (enviaria o prompt); o Alt+Enter ele já manda como ESC + CR,
// que é o que essas CLIs entendem como nova linha. A sequência é a mesma em Windows, macOS e Linux.
(function (root) {
  const NOVA_LINHA = '\x1b\r';

  // Sequência a escrever no PTY para o evento, ou null para o xterm tratar como sempre.
  function sequenciaDeTecla(ev) {
    if (ev.type !== 'keydown' || ev.key !== 'Enter') return null;
    if (ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) return NOVA_LINHA;
    return null;
  }

  // ── Ctrl+C: um toque cola, dois avisam, três interrompem ─────────────────────────────────────────────────
  // Regra do dono (sem texto marcado): 1 toque sem outro em ESPERA_COLAR ms cola o que está copiado; 2 toques
  // cancelam a colagem, avisam "aperte mais 1 vez para interromper" e esperam o terceiro; o 3º toque dentro de
  // JANELA ms desde o primeiro interrompe (um só \x03 ao programa); sem o 3º, nada é enviado e o aviso some.
  // O programa nunca recebe os dois primeiros toques. A máquina é pura (o tempo entra como argumento).
  const ESPERA_COLAR = 1000;
  const JANELA = 2000;

  const novoEstado = () => ({ toques: 0, t0: 0 });

  // Avança o relógio: cola quando o único toque completa ESPERA_COLAR; esconde o aviso quando completa JANELA.
  function passar(estado, agora) {
    if (estado.toques === 1 && agora - estado.t0 >= ESPERA_COLAR) return { estado: novoEstado(), efeitos: ['colar'] };
    if (estado.toques === 2 && agora - estado.t0 >= JANELA) return { estado: novoEstado(), efeitos: ['esconder-aviso'] };
    return { estado, efeitos: [] };
  }

  // Um toque (keydown sem repeat) em `agora` ms. Primeiro deixa o relógio andar, para o limite ser determinístico.
  function tocar(estado, agora) {
    const antes = passar(estado, agora);
    const efeitos = antes.efeitos.slice();
    const e = antes.estado;
    if (e.toques === 0) return { estado: { toques: 1, t0: agora }, efeitos };
    if (e.toques === 1) return { estado: { toques: 2, t0: e.t0 }, efeitos: [...efeitos, 'avisar'] };
    return { estado: novoEstado(), efeitos: [...efeitos, 'esconder-aviso', 'interromper'] };
  }

  // Quantos ms faltam para a próxima mudança por tempo, ou null quando o estado está ocioso.
  function proximoPrazo(estado, agora) {
    if (estado.toques === 1) return Math.max(0, estado.t0 + ESPERA_COLAR - agora);
    if (estado.toques === 2) return Math.max(0, estado.t0 + JANELA - agora);
    return null;
  }

  // Embrulha a máquina com relógio e timer (injetáveis nos testes). Uma instância por terminal; um só timer,
  // agendado a partir de proximoPrazo. cancelar() para o timer e zera (terminal fechado ou processo encerrado).
  function criarCtrlC(deps = {}) {
    const agora = deps.agora || (() => Date.now());
    const agendar = deps.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
    const limpar = deps.clearTimeout || (id => globalThis.clearTimeout(id));
    const ao = {
      colar: deps.aoColar || (() => {}),
      'esconder-aviso': deps.aoEsconder || (() => {}),
      avisar: deps.aoAvisar || (() => {}),
      interromper: deps.aoInterromper || (() => {}),
    };
    let estado = novoEstado();
    let timer = null;
    const parar = () => { if (timer !== null) { limpar(timer); timer = null; } };
    const reagendar = () => {
      parar();
      const prazo = proximoPrazo(estado, agora());
      if (prazo !== null) timer = agendar(() => { timer = null; aplicar(passar(estado, agora())); }, prazo);
    };
    function aplicar(r) {
      estado = r.estado;
      reagendar(); // antes dos efeitos: um efeito que lance não deixa o timer solto
      for (const ef of r.efeitos) ao[ef]();
    }
    return {
      tocar: () => aplicar(tocar(estado, agora())),
      cancelar: () => { parar(); estado = novoEstado(); },
      estado: () => estado,
    };
  }

  const ctrlC = { novoEstado, tocar, passar, proximoPrazo, ESPERA_COLAR, JANELA };
  const api = { sequenciaDeTecla, ctrlC, criarCtrlC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RendraTermKeys = api;
})(typeof window !== 'undefined' ? window : this);
