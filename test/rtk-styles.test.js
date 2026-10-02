// Tokens de cor do RTK: Codex azul (exceção documentada à regra no-blue), Claude laranja,
// Gemini inalterado, e o contraste mínimo do texto colorido sobre o cartão (WCAG AA, 4,5:1)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const token = n => new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1].toLowerCase();

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('--codex é #4a9eff; --orange e --gemini não mudaram', () => {
  assert.strictEqual(token('codex'), '#4a9eff');
  assert.strictEqual(token('orange'), '#e8650a');
  assert.strictEqual(token('gemini'), '#4a9eff');
});

test('o azul do Codex vem com o comentário da exceção à regra no-blue', () => {
  const i = css.indexOf('--codex:');
  const antes = css.slice(Math.max(0, i - 400), i);
  assert.match(antes, /exceção documentada à regra no-blue/);
});

test('total do agente: laranja e azul sobre --surface passam em 4,5:1', () => {
  const surface = token('surface');
  assert.ok(contraste(token('orange'), surface) >= 4.5, 'laranja sobre --surface');
  assert.ok(contraste(token('codex'), surface) >= 4.5, 'azul sobre --surface');
  assert.match(css, /\.rtk-agent-total\.accent-claude\s*\{\s*color:\s*var\(--orange\)/);
  assert.match(css, /\.rtk-agent-total\.accent-codex\s*\{\s*color:\s*var\(--codex\)/);
  assert.match(css, /\.rtk-agent\s*\{[^}]*background:\s*var\(--surface\)/, 'o cartão do agente é --surface, não --surface2');
});

test('o detalhe por sistema aparece no hover e no foco do total', () => {
  assert.match(css, /\.rtk-agent-total:hover \+ \.rtk-tip,\s*\.rtk-agent-total:focus \+ \.rtk-tip\s*\{\s*display:\s*block/);
});
