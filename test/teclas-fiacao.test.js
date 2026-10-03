// Fiação estática das teclas do terminal em renderer/devcode.js (padrão test/rtk-ui.test.js): a lógica é pura e
// testada à parte; aqui se confere que o devcode só executa o que ela decide e não abre caminho para o \x03 do xterm.
// O efeito real fica em scripts/e2e-teclas-comandos.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ler = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const devcode = ler('renderer/devcode.js');
const css = ler('renderer/styles.css');

// trecho de `inicio` até o primeiro `fim` depois dele
function trecho(src, inicio, fim) {
  const i = src.indexOf(inicio);
  assert.ok(i >= 0, `não achei: ${inicio}`);
  const j = src.indexOf(fim, i + inicio.length);
  assert.ok(j > i, `não achei o fim: ${fim}`);
  return src.slice(i, j);
}
const handler = trecho(devcode, 'term.attachCustomKeyEventHandler(', "default:\n          return true;");

test('o handler usa acaoDeTecla e criarCtrlC, uma máquina por terminal', () => {
  assert.match(devcode, /RendraTermKeys\.acaoDeTecla\(ev, plataforma, t\.shellKey, \{ temSelecao: term\.hasSelection\(\) \}\)/);
  assert.match(devcode, /t\.ctrlC = RendraTermKeys\.criarCtrlC\(/);
});

test('o \\x03 só é escrito no aoInterromper (e só com o terminal vivo e sem painel)', () => {
  const ocorrencias = devcode.match(/'\\x03'/g) || [];
  assert.strictEqual(ocorrencias.length, 1);
  const i = devcode.indexOf("'\\x03'");
  assert.match(devcode.slice(i - 80, i + 1), /aoInterromper: \(\) => \{ if \(podeEscrever\(\)\) dev\.ptyWrite\(t\.id, '$/);
});

test('todo ramo ctrlc devolve false: nenhum caminho deixa o xterm emitir o \\x03', () => {
  const ramo = trecho(handler, "case 'ctrlc':", "case 'colar':");
  assert.ok(!/return true/.test(ramo), 'o ramo ctrlc devolve true');
  assert.ok(/return false/.test(ramo));
  // toda saída do ramo é um return false
  for (const m of ramo.matchAll(/return (\w+)/g)) assert.strictEqual(m[1], 'false');
});

test('o aviso do Ctrl+C é do terminal, não o toast global, e é anunciado como status', () => {
  const bloco = trecho(devcode, 't.ctrlC = RendraTermKeys.criarCtrlC({', '    });');
  assert.ok(!/toast\(|showToast/.test(bloco), 'o aviso usa o toast global');
  assert.match(bloco, /aoAvisar: \(\) => \{ aviso\.textContent = 'aperte mais 1 vez para interromper'; aviso\.classList\.add\('visible'\); \}/);
  assert.match(devcode, /aviso\.className = 'term-aviso';/);
  assert.match(devcode, /aviso\.setAttribute\('role', 'status'\);/);
  assert.match(devcode, /aviso\.setAttribute\('aria-live', 'polite'\);/);
});

test('o .term-aviso fica acima do painel de conversas (z-index maior que 5) e não captura o mouse', () => {
  const regra = css.match(/\.term-aviso \{[^}]*\}/)[0];
  const z = +regra.match(/z-index:\s*(\d+)/)[1];
  assert.ok(z > 5, `z-index ${z}`);
  assert.match(regra, /pointer-events:\s*none/);
});

test('com texto marcado o Ctrl+C só copia e mostra "Copiado", sem tocar a máquina', () => {
  const ramo = trecho(handler, "case 'ctrlc':", "case 'colar':");
  assert.match(ramo, /if \(a\.selecao\) \{ navigator\.clipboard\.writeText\(term\.getSelection\(\)\)\.then\(\(\) => toast\('Copiado'\)/);
  const iSel = ramo.indexOf('a.selecao');
  const iToca = ramo.indexOf('t.ctrlC.tocar()');
  assert.ok(iSel > 0 && iToca > iSel, 'a seleção tem de ser tratada antes de contar o toque');
});

test('painel de conversas aberto: nenhuma escrita direta nova (colar, Alt+V, Ctrl+C) e o clique na aba não devolve o foco ao xterm', () => {
  assert.match(devcode, /const podeEscrever = \(\) => t\.alive && !t\.painel;/);
  assert.match(devcode, /const pasteText = \(\) => navigator\.clipboard\.readText\(\)\.then\(x => \{ if \(x && podeEscrever\(\)\) term\.paste\(x\); \}\);/);
  assert.match(trecho(handler, "case 'colar':", "case 'colar-imagem':"), /if \(!podeEscrever\(\)\) return false;/);
  assert.match(trecho(handler, "case 'colar-imagem':", "case 'copiar-selecao':"), /if \(podeEscrever\(\)\) dev\.ptyWrite\(t\.id, a\.bytes\)/);
  assert.match(handler, /if \(!t\.painel\) t\.ctrlC\.tocar\(\);/);
  const aba = trecho(devcode, "tab.addEventListener('mousedown'", '    });');
  assert.match(aba, /if \(t\.painel\) t\.painel\.el\.querySelector\('button'\)\?\.focus\(\); else term\.focus\(\);/);
});

test('o temporizador do Ctrl+C morre com o terminal: cancelar ao fechar e ao encerrar o processo', () => {
  assert.match(trecho(devcode, 'async function killTerminal', '\n  }'), /t\.ctrlC\?\.cancelar\(\)/);
  assert.match(trecho(devcode, 'dev.onPtyExit(', '\n  });'), /owner\.t\.ctrlC\?\.cancelar\(\)/);
});

test('o terminal desliga a seleção de palavra no clique direito (o clique direito cola)', () => {
  assert.match(devcode, /rightClickSelectsWord: false,/);
});

test('o macOS não liga macOptionIsMeta: Option fica como o do sistema', () => {
  assert.ok(!/macOptionIsMeta/.test(devcode));
});

test('atalho-ide no terminal: o handler consome a tecla (sem bytes) e deixa a ação para a escuta do document', () => {
  const ramo = trecho(devcode, "case 'atalho-ide':", 'default:');
  assert.match(ramo, /return false;/);
});

// ── Copiar ao marcar (T5) ───────────────────────────────────────────────────────────────────────────────────
test('copiar ao marcar: onSelectionChange com estabilizador, deveCopiar e aviso "Copiado"', () => {
  assert.match(devcode, /term\.onSelectionChange\(agendarCopia\);/);
  const bloco = trecho(devcode, 'const SELECAO_ESTAVEL', 'term.attachCustomKeyEventHandler(');
  assert.match(bloco, /clearTimeout\(timerSelecao\); timerSelecao = setTimeout\(copiarMarcado, SELECAO_ESTAVEL\)/);
  assert.match(bloco, /RendraTermKeys\.deveCopiar\(texto, ultimoCopiado\)/);
  assert.match(bloco, /navigator\.clipboard\.writeText\(texto\)\.then\(\(\) => toast\('Copiado'\)/);
  assert.match(bloco, /if \(botaoBaixo\) return;/); // com o botão do mouse apertado não copia
});

test('copiar ao marcar mantém o realce: o terminal nunca chama clearSelection', () => {
  const novo = trecho(devcode, 'const SELECAO_ESTAVEL', "body.addEventListener('contextmenu'");
  assert.ok(!/clearSelection\(/.test(novo), 'o trecho de copiar ao marcar e das teclas chama clearSelection');
});

test('o terminal limpa o timer e o listener de mouseup ao fechar', () => {
  assert.match(devcode, /t\.limparSelecao = \(\) => \{ clearTimeout\(timerSelecao\); document\.removeEventListener\('mouseup', soltouMouse, true\); \};/);
  assert.match(trecho(devcode, 'async function killTerminal', '\n  }'), /t\.limparSelecao\?\.\(\)/);
});
