/*! Rendra IDE v1.1.4 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
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

  if (typeof module !== 'undefined' && module.exports) module.exports = { sequenciaDeTecla };
  else root.RendraTermKeys = { sequenciaDeTecla };
})(typeof window !== 'undefined' ? window : this);
