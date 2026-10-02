// release.yml: ordem dos jobs, isolamento dos segredos da Apple e conferências antes de publicar.
// Lê o YAML e o texto; o efeito de verdade é provado no run do GitHub Actions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const texto = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
const wf = yaml.load(texto);
const jobs = wf.jobs;
const SEGREDO = /CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID|WIN_CSC/;
const needsDe = j => [].concat(jobs[j].needs || []);

test('jobs esperados e o publicar depende de todos os de build', () => {
  assert.deepStrictEqual(Object.keys(jobs).sort(), ['build', 'build-mac', 'publicar', 'rascunho', 'segredos-mac', 'verificacao']);
  for (const j of ['build', 'build-mac', 'rascunho']) assert.ok(needsDe(j).includes('verificacao'), j);
  for (const j of ['build', 'build-mac']) assert.ok(needsDe(j).includes('rascunho'), j);
  assert.ok(needsDe('build-mac').includes('segredos-mac'));
  for (const j of ['build', 'build-mac', 'rascunho', 'segredos-mac', 'verificacao']) assert.ok(needsDe('publicar').includes(j), `publicar sem needs ${j}`);
});

test('a matriz não cancela as outras entradas quando uma falha', () => {
  assert.strictEqual(jobs.build.strategy['fail-fast'], false);
  assert.strictEqual(jobs['build-mac'].strategy['fail-fast'], false);
});

test('segredos da Apple e do certificado fora do env do workflow, dos jobs e dos jobs Windows e Linux', () => {
  assert.strictEqual(wf.env, undefined);
  for (const [nome, job] of Object.entries(jobs)) {
    assert.strictEqual(SEGREDO.test(JSON.stringify(job.env || {})), false, `${nome}: segredo no env do job`);
    if (nome !== 'build-mac' && nome !== 'segredos-mac') assert.strictEqual(SEGREDO.test(JSON.stringify(job)), false, `${nome} cita segredo da Apple`);
  }
});

test('build-mac: os cinco segredos só nos passos de conferência e de build, com arquitetura única por job', () => {
  const passos = jobs['build-mac'].steps;
  const comSegredo = passos.filter(s => SEGREDO.test(JSON.stringify(s.env || {})));
  assert.deepStrictEqual(comSegredo.map(s => s.name), ['Conferir que os cinco segredos da Apple existem', 'Construir, assinar e notarizar']);
  for (const s of comSegredo) {
    for (const v of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
      assert.match(s.env[v], new RegExp(`secrets\\.${v}`), `${s.name}: ${v}`);
    }
  }
  const build = passos.find(s => s.name === 'Construir, assinar e notarizar').run;
  assert.match(build, /--mac --\$\{\{ matrix\.arch \}\}/);
  assert.doesNotMatch(build, /--arm64 --x64|--x64 --arm64|--universal/);
  assert.deepStrictEqual(jobs['build-mac'].strategy.matrix.include.map(i => i.arch), ['arm64', 'x64']);
});

test('nenhum passo imprime variável de segredo nem liga set -x', () => {
  for (const [nome, job] of Object.entries(jobs)) for (const s of job.steps) {
    const run = s.run || '';
    assert.doesNotMatch(run, /set -x|set -o xtrace/, `${nome}: set -x`);
    assert.doesNotMatch(run, /echo[^\n]*\$\{?(CSC_|APPLE_)/, `${nome}: echo de segredo`);
    assert.doesNotMatch(run, /printenv|\benv\b\s*(\||$)/m, `${nome}: despeja o ambiente`);
  }
});

test('segredos-mac só testa se o certificado existe, sem repassar o valor', () => {
  const env = JSON.stringify(jobs['segredos-mac'].steps[0].env);
  assert.match(env, /secrets\.CSC_LINK != ''/);
  assert.doesNotMatch(env, /secrets\.CSC_LINK\s*\}\}/);
});

test('o job mac recusa assinatura ou notarização pulada, e confere node-pty e codesign', () => {
  assert.match(texto, /skipped macOS \(notarization\|application code signing\)/);
  assert.match(texto, /node-pty-darwin-\$\{\{ matrix\.arch \}\}/);
  assert.match(texto, /lipo -archs/);
  assert.match(texto, /codesign --verify --deep --strict/);
  assert.match(jobs['build-mac'].strategy.matrix.include.find(i => i.arch === 'x64').os, /intel/);
});

test('verificação: a tag precisa ser igual à versão do package.json', () => {
  const run = jobs.verificacao.steps.map(s => s.run || '').join('\n');
  assert.match(run, /GITHUB_REF_NAME" != "v\$v"/);
  // sem o exit 1 depois da mensagem, o electron-builder criaria um segundo rascunho v<versão>
  assert.match(run, /!= "v\$v" \]; then\s+echo "a tag[^\n]*\n\s+exit 1\s+fi/);
});

test('publicar: junta o latest-mac.yml, confere os assets e só então tira do rascunho', () => {
  const runs = jobs.publicar.steps.map(s => s.run || '');
  const idx = re => runs.findIndex(r => re.test(r));
  const junta = idx(/merge-latest-mac\.js latest-mac-in/);
  const confere = idx(/check-release-assets\.js/);
  const publica = idx(/--draft=false/);
  assert.ok(junta >= 0 && confere > junta && publica > confere, `ordem ${junta} ${confere} ${publica}`);
  assert.match(jobs.publicar.if, /needs\.build\.result == 'success'/);
  assert.match(runs[publica], /--prerelease/);
  assert.match(runs[publica], /--latest/);
  assert.match(texto, /gh release upload "\$GITHUB_REF_NAME" latest-mac\.yml --clobber/);
});

test('permissões: leitura no workflow e escrita só onde publica', () => {
  assert.deepStrictEqual(wf.permissions, { contents: 'read' });
  for (const j of ['rascunho', 'build', 'build-mac', 'publicar']) assert.strictEqual(jobs[j].permissions.contents, 'write', j);
  for (const j of ['verificacao', 'segredos-mac']) assert.strictEqual(jobs[j].permissions, undefined, j);
});

test('os builds chamam o electron-builder direto, sem o prebuild de ícones', () => {
  for (const j of ['build', 'build-mac']) {
    const runs = jobs[j].steps.map(s => s.run || '').join('\n');
    assert.match(runs, /npx electron-builder/);
    assert.doesNotMatch(runs, /npm run build/);
  }
  assert.match(texto, /--publish "\$PUBLICAR"/);
  assert.match(texto, /github\.ref_type == 'tag' && 'always' \|\| 'never'/);
});

test('o rascunho é criado uma vez e como pré-release quando a versão tem sufixo', () => {
  const run = jobs.rascunho.steps.map(s => s.run || '').join('\n');
  assert.match(run, /gh release create "\$GITHUB_REF_NAME" --draft \$flag/);
  assert.match(run, /--prerelease/);
  assert.match(run, /gh release view/);
});
