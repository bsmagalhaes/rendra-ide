// Leitor de identidade do Codex: lê o auth.json e devolve só e-mail, nome, organização e plano.
// JWT fabricado em pasta temporária com tokens sentinela: nada do usuário é lido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lerContaCodex } = require('../src/codex-account');

const SENTINELAS = ['SENTINELA-ACESSO-123', 'SENTINELA-RENOVA-456', 'SENTINELA-CONTA-789', 'SENTINELA-OPENAI-000'];
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const jwt = payload => `${b64({ alg: 'none' })}.${b64(payload)}.assinatura-falsa`;

function pasta(auth) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendra-codex-acc-'));
  if (auth !== undefined) fs.writeFileSync(path.join(dir, 'auth.json'), typeof auth === 'string' ? auth : JSON.stringify(auth));
  return dir;
}
const authCom = claims => ({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: SENTINELAS[3],
  tokens: { id_token: jwt(claims), access_token: SENTINELAS[0], refresh_token: SENTINELAS[1], account_id: SENTINELAS[2] },
  last_refresh: '2026-10-03T00:00:00Z',
});
const claimsBase = (organizations, extra = {}) => ({
  email: 'ana@exemplo.test', name: 'Ana Demo',
  'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', ...(organizations === undefined ? {} : { organizations }) },
  ...extra,
});

test('devolve e-mail, nome, organização padrão e plano', async () => {
  const dir = pasta(authCom(claimsBase([
    { id: 'o1', is_default: false, role: 'owner', title: 'Outra Org' },
    { id: 'o2', is_default: true, role: 'owner', title: 'Empresa Demo' },
  ])));
  assert.deepStrictEqual(await lerContaCodex(dir), { email: 'ana@exemplo.test', name: 'Ana Demo', organization: 'Empresa Demo', plan: 'plus' });
});

test('nenhum token nem chave de token no retorno', async () => {
  const dir = pasta(authCom(claimsBase([{ id: 'o1', is_default: true, role: 'owner', title: 'Empresa Demo' }])));
  const txt = JSON.stringify(await lerContaCodex(dir));
  for (const s of SENTINELAS) assert.ok(!txt.includes(s), `vazou ${s}`);
  for (const k of ['access_token', 'refresh_token', 'id_token', 'account_id', 'tokens']) assert.ok(!txt.includes(k), `vazou a chave ${k}`);
});

test('arquivo ausente, JSON inválido, id_token ausente ou malformado devolvem null', async () => {
  assert.strictEqual(await lerContaCodex(pasta()), null);
  assert.strictEqual(await lerContaCodex(pasta('{ isso não é json')), null);
  assert.strictEqual(await lerContaCodex(pasta({ tokens: { access_token: SENTINELAS[0] } })), null);
  assert.strictEqual(await lerContaCodex(pasta({ tokens: { id_token: 'so-um-pedaco', access_token: SENTINELAS[0] } })), null);
  assert.strictEqual(await lerContaCodex(pasta({ tokens: { id_token: 'a.%%%.c', access_token: SENTINELAS[0] } })), null);
  assert.strictEqual(await lerContaCodex(pasta({ tokens: { id_token: `x.${b64('nao json')}.c` } })), null);
});

test('nada que o leitor lança ou devolve carrega o conteúdo do arquivo', async () => {
  const corrompido = `{"tokens":{"access_token":"${SENTINELAS[0]}","id_token":"${SENTINELAS[1]}" `; // JSON truncado: a mensagem do V8 traria um trecho
  let erro = null;
  let ret;
  try { ret = await lerContaCodex(pasta(corrompido)); } catch (e) { erro = e; }
  assert.strictEqual(erro, null, 'não lança');
  assert.strictEqual(ret, null);
  const comPayloadRuim = pasta({ tokens: { id_token: `x.${b64(`{"email": "${SENTINELAS[2]}" `)}.c`, access_token: SENTINELAS[0] } });
  try { ret = await lerContaCodex(comPayloadRuim); } catch (e) { erro = e; }
  assert.strictEqual(erro, null);
  assert.ok(!JSON.stringify(ret).includes('SENTINELA'));
});

test('organização: a de is_default verdadeiro; sem is_default a primeira; sem lista, null', async () => {
  const doisDefault = pasta(authCom(claimsBase([{ title: 'Primeira' }, { title: 'Padrão', is_default: true }])));
  assert.strictEqual((await lerContaCodex(doisDefault)).organization, 'Padrão');
  const semDefault = pasta(authCom(claimsBase([{ title: 'Primeira' }, { title: 'Segunda' }])));
  assert.strictEqual((await lerContaCodex(semDefault)).organization, 'Primeira');
  assert.strictEqual((await lerContaCodex(pasta(authCom(claimsBase())))).organization, null);
  assert.strictEqual((await lerContaCodex(pasta(authCom(claimsBase([]))))).organization, null);
});

test('campos que faltam no payload viram null, sem inventar', async () => {
  const r = await lerContaCodex(pasta(authCom({ email: 'so@exemplo.test' })));
  assert.deepStrictEqual(r, { email: 'so@exemplo.test', name: null, organization: null, plan: null });
});

test('campos extras do payload não passam para o retorno (lista branca)', async () => {
  const r = await lerContaCodex(pasta(authCom(claimsBase([], { sub: 'SENTINELA-SUB', jti: 'SENTINELA-JTI', at_hash: 'SENTINELA-HASH' }))));
  assert.deepStrictEqual(Object.keys(r).sort(), ['email', 'name', 'organization', 'plan']);
});
