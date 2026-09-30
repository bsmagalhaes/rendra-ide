@AGENTS.md

Autor: Bruno Magalhaes, brunomagalhaes.me, instagram.com/brunomagalhaes.me.

# Publicar versões, preços e o site (manual do mantenedor)

## Estado atual (26/09/2026)
- Publicado: versão **1.1.0** em https://github.com/bsmagalhaes/rendra-ui-ide (release `v1.1.0`),
  site em https://bsmagalhaes.github.io/rendra-ui-ide/ (Pages por GitHub Actions, já ativado).
- Remotes desta pasta: `origin` = bsmagalhaes/rendra-ui-ide (publicar aqui); `upstream` =
  DewashishCodes/tokenmeter (projeto original, só leitura; nunca dar push).
- Identidade git deste repositório: `Bruno Magalhaes <contato@brunomagalhaes.me>` (config local).
- Sem `gh` CLI na máquina: o push usa o login salvo no Git Credential Manager.
- Pendente do Padrão dos produtos Rendra: tokens `--rendra-*`/`data-rendra`/catálogo de códigos
  (a interface usa paleta própria, cinza e laranja; exige redesenho), `typecheck`/`lint`/cobertura
  (JavaScript sem build), arquivo de verificação do Google Search Console. Não se aplicam: pacote
  npm, CLI, prints de celular e de modo claro.

Este arquivo e o AGENTS.md vão para o git (Padrão dos produtos Rendra: arquivos para agentes são
produto). O que fica só na máquina: planos, specs, levantamentos e saídas de IA (`docs/specs/`,
`docs/plans/`, `docs/superpowers/`, `.superpowers/`, `.claude/`). Nada da instalação depende
destes arquivos: o setup de Git Bash, RTK e WSL roda pelo app (primeira abertura) ou por
`npm run setup` (`src/setup.js`, `scripts/setup-env.js`).

## Como os usuários instalam e atualizam
- Instalação: `git clone https://github.com/bsmagalhaes/rendra-ui-ide`, `npm install`, `npm start`.
  Na primeira abertura o app oferece instalar Git Bash, RTK e WSL (ou `npm run setup`).
- Atualização: o app compara a própria versão com a do `package.json` na `main` do GitHub
  (10 s depois de abrir e a cada 6 h). Só aparece aviso quando a **versão** muda, não a cada commit.
  A barra inferior mostra "Versão X disponível · Atualizar agora"; o app fecha (pergunta antes se
  há arquivos para salvar), `scripts/apply-update.js` roda `git pull --ff-only` e, se as
  dependências mudaram, `npm install`, e reabre o app, que abre a página Novidades.
  Dados do usuário (configurações, workspaces, preços, cache) ficam em `%APPDATA%\Rendra IDE` e
  nunca são tocados. Se o usuário alterou arquivos do app e o pull não é fast-forward, nada é
  perdido: o app abre na versão antiga e avisa. Se o histórico do `origin/main` foi
  reescrito (o HEAD local deixou de ser ancestral) e a árvore está limpa, o helper faz
  `git fetch origin` e `git reset --hard origin/main` (commits antigos ficam na branch local
  `rendra-backup-antes-da-atualizacao`); com mudança local, não mexe e avisa. Log em
  `%APPDATA%\Rendra IDE\update-log.txt`.
- Consequência: **tudo que for para a `main` chega aos usuários na próxima versão**. Trabalho em
  andamento vai em outra branch, ou na `main` sem mudar a versão.

## Publicar uma versão nova (sempre assim)
1. Durante o desenvolvimento, escreva as novidades no topo do `CHANGELOG.md`, logo abaixo de
   `# Novidades`, numa seção `## Próxima versão` (subtítulos `### …` e itens `- …`, em pt-BR,
   do ponto de vista do usuário). Essa seção aparece na página Novidades do app e na release.
2. Rode, na branch `main`:
   ```
   npm run release -- patch     # correções: 1.1.0 → 1.1.1
   npm run release -- minor     # novidades: 1.1.0 → 1.2.0
   npm run release -- major     # mudanças grandes: 1.1.0 → 2.0.0
   npm run release -- 1.1.0     # versão exata (a primeira publicação usa a atual)
   ```
   O script: troca `## Próxima versão` por `## X.Y.Z · DD/MM/AAAA`, mostra as notas e os arquivos
   que entram no commit e pede confirmação; atualiza `package.json` e `package-lock.json`;
   reescreve os cabeçalhos `/*! Rendra IDE vX.Y.Z … */` (`npm run stamp`); roda `npm run check` e
   `npm test`; faz o commit `chore: versão X.Y.Z`, cria a tag `vX.Y.Z` e faz o push com a tag.
   Use `--no-push` para preparar sem enviar.
3. O push da tag roda `.github/workflows/release.yml`, que publica a release no GitHub com as
   notas da versão. Os apps instalados veem a versão nova na `main` e oferecem a atualização.
4. Se atualizou o Electron: rode `npm approve-scripts electron` antes (o npm 11 bloqueia o
   download do Electron sem isso; o release avisa).

Se algo der errado:
- Release não apareceu no GitHub depois do push: confira a aba Actions. Se o workflow "Release"
  não disparou, reenvie a mesma tag: `git push origin :refs/tags/vX.Y.Z` e `git push origin vX.Y.Z`.
- O script parou antes do commit (check ou teste falhou): corrija e rode o mesmo comando de novo;
  a versão e o CHANGELOG já atualizados são aceitos.
- Nunca apague nem mova uma tag já publicada para outro commit: os apps usam a versão da `main`.

Não gere instaladores por enquanto: a distribuição é pelo código. A configuração do
electron-builder e o electron-updater continuam no projeto para quando houver instaladores.

## Atualizar preços (sem versão nova)
```
npm run prices:update     # lê as páginas oficiais da Anthropic e da OpenAI e atualiza pricing.json
git add pricing.json && git commit -m "chore: atualiza tabela de preços" && git push
```
Os apps instalados leem o `pricing.json` da `main` ao abrir e oferecem os preços novos na página
Preços. Confira o diff antes do commit: se as páginas mudaram de formato, o script pode falhar.

## Site (GitHub Pages) e imagens
- O site é `docs/index.html`, publicado por `.github/workflows/pages.yml` a cada push na `main`
  que mexa em `docs/`. Endereço: https://bsmagalhaes.github.io/rendra-ui-ide/
- Prints: `npm run docs:images` abre o app com dados de demonstração (pasta temporária, nunca os
  seus dados) e grava `docs/images/*.png` (1920x1080) e `docs/og-image.png` (1200x630), usadas
  pelo README e pelo site. Rode depois de mudar a interface, **abra cada imagem e confira** que
  nenhum caminho, nome de usuário ou dado real apareceu, e faça commit. A tela do RTK fica de fora
  de propósito: o `rtk` lê a pasta real do usuário, não a de demonstração.
- Descrição, site e tópicos do repositório já estão configurados no GitHub.

## Padronização (família Rendra)
- Pacote `@rendra-ui/ide`, `"private": true` e `publishConfig.access: public`. Nada é publicado
  no npm sem confirmação do Bruno.
- Autor no `package.json`, seção Autor no README, `LICENSE` com `Copyright (c) 2026 Bruno Magalhaes`
  (e o aviso do Tokenmeter, obrigatório pela MIT).
- Não vão para o git: planos, specs, levantamentos e saídas de IA (`docs/specs/`, `docs/plans/`,
  `docs/superpowers/`, `.superpowers/`, `.claude/`).
- Commits em pt-BR no padrão `tipo: descrição`.
- Critério de pronto: `npm run check` e `npm test` passando.
- Referência completa: `PADRAO-PRODUTOS-RENDRA.md` (no repositório do Rendra Design System).

## Matriz de modelos

| Etapa | Modelo | Confronta código |
|---|---|---|
| Levantamento | Fable | Sim |
| Plano e spec | Sonnet | Não, usa o briefing |
| Validação do plano | Opus | Sim |
| Execução | Sonnet | Não |
| Validação da entrega | Fable | Sim |

Nenhum modelo valida o que ele mesmo escreveu.

Escopo obrigatório: Fable e Opus recebem apenas os arquivos do
escopo mais o contrato do módulo, nunca o repositório inteiro.
A validação da entrega olha o diff e a saída dos testes.

Briefing com mais de 24 horas ou com commits no meio é refeito,
não reaproveitado.

Fluxo curto, para bug pequeno e correção óbvia: Sonnet escreve
o teste que reproduz, corrige, e o Fable valida apenas os
bloqueadores. Duas etapas.

### Checklist bloqueador (100 por cento, sem exceção)

Cada linha exige arquivo ou teste que comprove.

1. Contrato do módulo intacto, nenhuma assinatura pública
   alterada sem versionamento
2. Isolamento de dados entre clientes preservado, nenhuma
   consulta sem o filtro que o separa
3. Existe teste que falha sem a mudança e passa com ela
4. Migração reversível, nenhuma operação destrutiva sem
   rollback
5. Nenhum arquivo fora do escopo declarado foi tocado

### Checklist de qualidade (mínimo 80 por cento)

1. Caminho de erro coberto por teste
2. Sem duplicação de lógica já existente no módulo
3. Nomes e padrões seguindo o projeto
4. Sem TODO e sem código morto
5. Teste de navegador cobrindo o fluxo principal, quando houver
   interface

### Formato do veredito

Item, aprovado ou reprovado, arquivo ou teste que comprova, uma
linha de justificativa. Percentual apenas ao final e apenas
como sinal de alerta. O portão é o binário. Item que não pode
ser respondido com sim ou não está grande demais e deve ser
quebrado.
