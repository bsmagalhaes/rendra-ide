@AGENTS.md

Autor: Bruno Magalhaes, brunomagalhaes.me, instagram.com/brunomagalhaes.me.

# Publicar versões, preços e o site (manual do mantenedor)

Este arquivo e o AGENTS.md vão para o git (Padrão dos produtos Rendra: arquivos para agentes são
produto). O que fica só na máquina: planos, specs, levantamentos e saídas de IA (`docs/specs/`,
`docs/plans/`, `docs/superpowers/`, `.superpowers/`, `.claude/`). Nada da instalação depende
destes arquivos: o setup de Git Bash, RTK e WSL roda pelo app (primeira abertura) ou por
`npm run setup` (`src/setup.js`, `scripts/setup-env.js`).

## Como os usuários instalam e atualizam
- Instalação: `git clone https://github.com/bsmagalhaes/rendra-ide`, `npm install`, `npm start`.
  Na primeira abertura o app oferece instalar Git Bash, RTK e WSL (ou `npm run setup`).
- Atualização: o app compara a própria versão com a do `package.json` na `main` do GitHub
  (10 s depois de abrir e a cada 6 h). Só aparece aviso quando a **versão** muda, não a cada commit.
  A barra inferior mostra "Versão X disponível · Atualizar agora"; o app fecha (pergunta antes se
  há arquivos para salvar), `scripts/apply-update.js` roda `git pull --ff-only` e, se as
  dependências mudaram, `npm install`, e reabre o app, que abre a página Novidades.
  Dados do usuário (configurações, workspaces, preços, cache) ficam em `%APPDATA%\Rendra IDE` e
  nunca são tocados. Se o usuário alterou arquivos do app e o pull não é fast-forward, nada é
  perdido: o app abre na versão antiga e avisa. Log em `%APPDATA%\Rendra IDE\update-log.txt`.
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
  que mexa em `docs/`. Endereço: https://bsmagalhaes.github.io/rendra-ide/
- Uma vez só, no GitHub: Settings → Pages → Source: **GitHub Actions**.
- Prints: `npm run docs:images` abre o app com dados de demonstração (pasta temporária, nunca os
  seus dados) e grava `docs/images/*.png`, usadas pelo README e pelo site. Rode depois de mudar a
  interface e faça commit das imagens.

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
