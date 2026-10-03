// Realce do .env: escolha da linguagem pelo nome do arquivo, tokens da gramática Monarch e
// contraste das cores do tema. O Monaco real é conferido pelo e2e (scripts/e2e-realce-env.js);
// aqui um interpretador mínimo do subconjunto de Monarch que a gramática usa (regras em ordem,
// `^` só no começo da linha, grupos, estados com push e @pop).
const test = require('node:test');
const assert = require('node:assert');
const { ID, MONARCH, REGRAS_TEMA, linguagemPorNome } = require('../renderer/dotenv-lang');

function tokeniza(linhas, estadoInicial = 'root') {
  const pilha = [estadoInicial];
  return linhas.map(linha => {
    const saida = [];
    const poe = (token, texto) => {
      if (!texto) return;
      const ultimo = saida[saida.length - 1];
      if (ultimo && ultimo[0] === token) ultimo[1] += texto; else saida.push([token, texto]);
    };
    let pos = 0;
    while (pos < linha.length) {
      const regras = MONARCH.tokenizer[pilha[pilha.length - 1]];
      let casou = false;
      for (const [re, acao] of regras) {
        if (re.source.startsWith('^') && pos > 0) continue;
        const m = new RegExp(`^(?:${re.source})`).exec(linha.slice(pos));
        if (!m || !m[0].length) continue;
        if (Array.isArray(acao)) acao.forEach((t, i) => poe(t, m[i + 1]));
        else {
          const a = typeof acao === 'string' ? { token: acao } : acao;
          poe(a.token, m[0]);
          if (a.next === '@pop') pilha.pop(); else if (a.next) pilha.push(a.next.replace('@', ''));
        }
        pos += m[0].length;
        casou = true;
        break;
      }
      if (!casou) { poe('', linha[pos]); pos++; }
    }
    return saida.filter(([t]) => t !== '');
  });
}
const uma = linha => tokeniza([linha])[0];

test('linguagemPorNome: .env, .env.*, *.env entram; environment.js e afins não', () => {
  for (const n of ['.env', '.env.local', '.env.example', '.env.production.local', 'prod.env', 'C:\\app\\.env', '/srv/app/.ENV', 'staging.env'])
    assert.strictEqual(linguagemPorNome(n), ID, n);
  for (const n of ['environment.js', 'env.js', '.envrc', 'envfile', 'a.env.js', '.environment', '.env-backup', 'env', '', undefined, null])
    assert.strictEqual(linguagemPorNome(n), undefined, String(n));
});

test('comentário de linha inteira, com recuo', () => {
  assert.deepStrictEqual(uma('# banco de dados'), [['comment', '# banco de dados']]);
  assert.deepStrictEqual(uma('   # recuado'), [['comment', '   # recuado']]);
});

test('chave, igual e valor sem aspas; # sem espaço antes faz parte do valor', () => {
  assert.deepStrictEqual(uma('PORT=3000'), [['variable.name', 'PORT'], ['delimiter', '='], ['string.value', '3000']]);
  assert.deepStrictEqual(uma('COR=#ff8800'), [['variable.name', 'COR'], ['delimiter', '='], ['string.value', '#ff8800']]);
  assert.deepStrictEqual(uma('VAZIA='), [['variable.name', 'VAZIA'], ['delimiter', '=']]);
});

test('export opcional e comentário após o valor, depois de espaço', () => {
  assert.deepStrictEqual(uma('export API_URL=https://x.io  # produção'), [
    ['keyword.export', 'export'], ['variable.name', 'API_URL'], ['delimiter', '='],
    ['string.value', 'https://x.io'], ['comment', '  # produção'],
  ]);
});

test('valor entre aspas simples e entre aspas duplas', () => {
  assert.deepStrictEqual(uma(`A='um valor # nao comentario'`), [
    ['variable.name', 'A'], ['delimiter', '='], ['string.value', `'um valor # nao comentario'`],
  ]);
  assert.deepStrictEqual(uma('B="oi mundo" # nota'), [
    ['variable.name', 'B'], ['delimiter', '='], ['string.value', '"oi mundo"'], ['comment', ' # nota'],
  ]);
});

test('interpolação ${VAR} e escape em aspas duplas; interpolação também sem aspas', () => {
  assert.deepStrictEqual(uma('URL="http://${HOST}:80\\n"'), [
    ['variable.name', 'URL'], ['delimiter', '='], ['string.value', '"http://'], ['variable.interp', '${HOST}'],
    ['string.value', ':80'], ['string.escape', '\\n'], ['string.value', '"'],
  ]);
  assert.deepStrictEqual(uma('DB=${USER}@localhost'), [
    ['variable.name', 'DB'], ['delimiter', '='], ['variable.interp', '${USER}'], ['string.value', '@localhost'],
  ]);
});

test('aspa dupla aberta continua na linha seguinte e fecha onde fecha', () => {
  const [l1, l2, l3] = tokeniza(['CHAVE="linha um', 'linha dois', 'fim" # ok']);
  assert.deepStrictEqual(l1.at(-1), ['string.value', '"linha um']);
  assert.deepStrictEqual(l2, [['string.value', 'linha dois']]);
  assert.deepStrictEqual(l3, [['string.value', 'fim"'], ['comment', ' # ok']]);
});

test('palavra "export" sozinha como chave não vira palavra-chave', () => {
  assert.deepStrictEqual(uma('export=1')[0], ['variable.name', 'export']);
});

// Contraste WCAG das cores de cada token contra o fundo do tema (#161616), mínimo 4,5:1.
function lum(hex) {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
test('toda classe de token usada tem cor no tema, com contraste de pelo menos 4,5:1', () => {
  const usados = new Set();
  for (const regras of Object.values(MONARCH.tokenizer))
    for (const [, acao] of regras)
      for (const t of Array.isArray(acao) ? acao : [typeof acao === 'string' ? acao : acao.token]) if (t) usados.add(`${t}${MONARCH.tokenPostfix}`);
  const tema = new Map(REGRAS_TEMA.map(r => [r.token, r.foreground]));
  const fundo = lum('161616');
  for (const t of usados) {
    assert.ok(tema.has(t), `sem cor no tema para ${t}`);
    const l = lum(tema.get(t));
    assert.ok((l + 0.05) / (fundo + 0.05) >= 4.5, `contraste baixo em ${t}`);
  }
});
