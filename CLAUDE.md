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
`docs/plans/`, `.superpowers/`, `.claude/`). Nada da instalação depende
destes arquivos: o setup de Git Bash, RTK e WSL roda pelo app (primeira abertura) ou por
`npm run setup` (`src/setup.js`, `scripts/setup-env.js`).

## Como os usuários instalam e atualizam
- Duas formas de instalar, ambas válidas (a partir da 1.3.0):
  1. Instalador da página de Releases ou do site (`Rendra-IDE-Setup.exe`, dmg no macOS, AppImage ou
     `.deb` no Linux): o app se atualiza sozinho pelo electron-updater (baixa em segundo plano; o
     botão "Nova versão" pede para reiniciar). Ver a seção "Instaladores".
  2. Clone: `git clone https://github.com/bsmagalhaes/rendra-ui-ide`, `npm install`, `npm start`.
     Atualiza pelo caminho do git descrito abaixo.
  Na primeira abertura o app oferece instalar Git Bash, RTK e WSL (ou `npm run setup`).
- Atualização de clone: o app compara a própria versão com a do `package.json` na `main` do GitHub
  (10 s depois de abrir e a cada 6 h). Só aparece aviso quando a **versão** muda, não a cada commit.
  O botão verde "Nova versão" aparece no rodapé da barra lateral esquerda (só quando há versão
  nova); ao clicar, o app pergunta, fecha (pergunta antes se há arquivos para salvar),
  `scripts/apply-update.js` roda `git pull --ff-only` e, se as dependências mudaram, `npm install`,
  e reabre o app, que na primeira abertura abre o modal de Novidades da versão (só fecha pelo botão
  "Fechar" e aparece uma vez por versão).
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

## Instaladores (a partir da 1.3.0)
- Alvos: Windows NSIS x64 (`Rendra-IDE-Setup.exe`, sem assinatura, sem `portable`, sem diferencial),
  Linux AppImage e `.deb` x64 (`Rendra-IDE.AppImage`, `Rendra-IDE.deb`) e macOS dmg e zip por
  arquitetura (`Rendra-IDE-mac-arm64.*`, `Rendra-IDE-mac-x64.*`, Developer ID e notarização). Não há
  alvo `appx`: a Microsoft Store está só documentada.
- A tag `vX.Y.Z` roda `.github/workflows/release.yml`: verificação, um rascunho da release, os jobs de
  build (Windows e Linux sem segredos; macOS em job próprio com os segredos `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, só quando
  `CSC_LINK` existe) e o job `publicar`, que confere os assets e só então tira a release de rascunho.
- A tag precisa ser igual a `v` + a versão do `package.json`. Versão com sufixo (`1.3.0-rc.1`) sai
  como pré-release e nunca vira "latest". Teste de release com versão de teste: commit da versão rc
  numa branch, tag nela, e apague release e tag ao fim.
- Teste de atualização de ponta a ponta nunca usa o repositório público (a release mais nova dele é o
  que todo app instalado e os botões do site seguem): use repositório descartável com
  `-c.publish.repo=<repo>`, ou a primeira versão real seguinte.
- Prova do app empacotado nesta máquina: sempre com `RENDRA_DATA_DIR` temporário; clone e instalado
  usam a mesma `%APPDATA%\Rendra IDE`.
- Origem da atualização: `src/update-source.js` (clone usa git; empacotado usa o electron-updater;
  pacote da Store e pasta sem `.git` não atualizam).

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
  `.superpowers/`, `.claude/`).
- Commits em pt-BR no padrão `tipo: descrição`.
- Critério de pronto: `npm run check` e `npm test` passando.
- Referência completa: `PADRAO-PRODUTOS-RENDRA.md` (no repositório do Rendra Design System).

## Regras do produto
- Dados e ferramentas (sessões, uso, configuração do Claude Code e do Codex, RTK) vêm do sistema do
  terminal em uso, não do da instalação da IDE: Windows, Linux nativo ou WSL. No Windows, as
  distros WSL em execução entram junto com o Windows (`src/wsl-roots.js` é a única fonte dessas
  pastas; `src/codex-rtk.js` e os parsers a reaproveitam). Recurso novo que lê dado de agente
  precisa cobrir os três ambientes ou registrar por escrito o que ficou de fora.

## Regras de máquina para agentes
A máquina é usada pelo dono ao mesmo tempo em que o agente trabalha. Por isso:
- Processos: encerre só o PID que o próprio agente iniciou (guarde o PID ao iniciar). Nunca encerre
  por nome (`taskkill /IM`, `Stop-Process -Name`, `pkill`): isso derruba o Electron, o Node e os
  terminais do dono.
- E2E e capturas: só com `RENDRA_E2E_HIDDEN=1` (a janela abre fora da tela e sem foco).
  `scripts/e2e-barra-editor.js` já liga a variável sozinho; ao abrir o app à mão para uma captura, defina-a.
- Um processo pesado por vez: e2e, `npm install`, suíte inteira, build e abertura do Electron
  rodam em série, nunca em paralelo.

# REGRA INEGOCIÁVEL: MATRIZ DE MODELOS

Você trabalha sob esta matriz em TODA tarefa que altera código, teste,
migração ou configuração. Ela não é sugestão, e nenhuma etapa se pula por
pressa, falta de crédito ou tamanho da tarefa. Quando uma regra daqui
conflitar com uma preferência sua, a regra vence. Quando conflitar com uma
instrução explícita do dono do projeto, pergunte antes de agir.

## 0. Pré-requisito de economia: RTK instalado

Antes da primeira tarefa, confira que o RTK (Rust Token Killer) está
instalado e ligado ao shell do agente. Ele reescreve comandos de terminal
(`git`, `grep`, `jest`, `docker`, `ls`, `find`, `psql` e outros) para uma saída
compacta, cortando de 60 a 90% do texto que volta ao contexto.

1. Confira: `rtk --version` responde `rtk X.Y.Z` e `rtk gain` funciona.
   Se `rtk gain` falhar, o binário instalado é outro projeto de mesmo nome
   (Rust Type Kit): remova-o e instale o certo.
2. Instale, se faltar, pelo instalador oficial do projeto RTK
   (`cargo install rtk` ou o binário da página de releases), e confira de
   novo pelo passo 1.
3. Ligue o hook ao agente, **no escopo do projeto**, não no global:
   - Claude Code: em `.claude/settings.json` do projeto, um `PreToolUse`
     com `matcher: "Bash"` e o comando
     `command -v rtk >/dev/null 2>&1 && rtk hook claude || true`.
     Isso deixa o projeto funcionando em máquina sem RTK.
   - Outra IA sem hook: chame os comandos com o prefixo `rtk`
     (`rtk git status`, `rtk jest ...`).
4. Para ver a saída crua, ao depurar, use `rtk proxy <comando>`.
5. Ao fim de cada lote, registre `rtk gain` no relatório: é a medida da
   economia, não uma impressão.

Sem RTK a matriz continua valendo. Só fica mais cara.

## 1. Os papéis

Três níveis de modelo. Use os nomes da sua casa; no Claude são estes:

| Nível | Papel | Claude | Critério de escolha em outra casa |
|---|---|---|---|
| L | Leitor de código: levantamento e validação da entrega | Fable | O melhor modelo da casa em ler e raciocinar sobre código existente |
| R | Revisor de plano | Opus | Modelo forte, e diferente do que escreveu o plano |
| E | Escritor: plano e execução | Sonnet | Modelo bom e barato em escrever código |

**Nenhum modelo valida o que ele mesmo escreveu.** Isso vale entre modelos e
entre sessões: quem executou não valida, nem numa sessão nova. Revisor igual
ao autor concorda com o próprio raciocínio.

**O modelo é passado explicitamente em cada delegação.** O padrão da
ferramenta muda sem avisar. Sem crédito de um nível, pare e avise o dono do
projeto; nunca troque de modelo em silêncio.

## 2. Os dois fluxos

### Fluxo completo: funcionalidade, módulo novo, mudança com mais de um arquivo de produção

| # | Etapa | Nível | Lê código? | Entrega |
|---|---|---|---|---|
| 1 | Levantamento | L | Sim, só o escopo | Briefing com **lista de fatos** (ver §4) |
| 2 | Plano e spec | E | **Não**, usa só o briefing | Plano com tarefas testáveis |
| 3 | Validação do plano | R | Sim, só o escopo | Parecer: risco, isolamento, contrato |
| 4 | Execução | E | Sim | Código, testes e o relatório de pré-validação (§5) |
| 5 | Validação da entrega | L | Sim, o diff | Veredito binário (§6) |

### Fluxo curto: bug pequeno, correção óbvia, até cerca de 3 arquivos de produção

| # | Etapa | Nível |
|---|---|---|
| 1 | Escreve o teste que reproduz, vê vermelho, corrige, vê verde | E |
| 2 | Valida só o checklist bloqueador | L, ou R quando não houver risco de segurança nem de isolamento |

No fluxo curto não há levantamento nem validação de plano. Se, durante a
correção, o escopo crescer além do "óbvio", pare e passe ao fluxo completo.

## 3. As regras que andam com a matriz

1. **Nenhum plano sem levantamento.** Plano escrito sem o briefing do nível
   L é recusado, não revisado.
2. **O plano só afirma o que o briefing afirma.** Todo nome de arquivo,
   função, tabela, rota ou número de migração citado no plano está na lista
   de fatos. O que o plano precisar e não estiver lá entra como pergunta ao
   nível L, não como palpite. Isso libera o revisor para julgar risco, em
   vez de caçar fato falso.
3. **Uma rodada de validação por plano.** O revisor valida uma vez. O que
   ele apontar, o executor corrige durante a execução; o que sobrar, a
   validação da entrega pega. Não existe segunda rodada de plano.
4. **Uma frente por arquivo e por ambiente.** Frentes paralelas só quando não
   compartilham arquivo, migração, banco de teste nem container de teste, e
   no máximo três ao mesmo tempo. Na dúvida, em série.
5. **O teste confere o resultado, não a chamada.** No servidor, a entrada
   passa pela porta de verdade (rota, webhook, fila) e o teste afirma o que
   ficou gravado. Na tela, o teste afirma o efeito que o usuário vê (texto,
   classe, item na lista), nunca só que o callback foi chamado.
6. **O executor se autoconfere antes de relatar** (§5). Entrega sem a
   pré-validação volta sem ser julgada.
7. **O validador não repete o que o executor já provou** (§6). Ele confere a
   prova, roda os testes dos arquivos tocados e faz a própria mutação. A suíte
   inteira roda uma vez, antes do commit, não uma vez por papel.
8. **Bloqueante reprova; melhoria não gera nova rodada.** O validador separa
   os dois. A melhoria vai para uma lista que o executor fecha antes do
   commit, e a entrega não volta ao validador por ela.
9. **Briefing com mais de 24 horas, ou com commit no escopo depois dele, é
   refeito.** Não se reaproveita.
10. **Não deduza requisito.** Entidade, campo, tela ou regra que não foi
    pedida é pergunta, nunca proposta pronta. Não faça nada além do escopo.

## 4. Prompt enxuto, e o formato do briefing

**O prompt de delegação carrega só a tarefa.** Regras de ambiente, armadilhas
da máquina e convenções do projeto moram nos arquivos que todo agente lê
(``CLAUDE.md` e `AGENTS.md``). Repeti-las a cada
chamada custa milhares de tokens por agente, e a cópia diverge no primeiro
conserto. O prompt diz: objetivo, escopo (arquivos), o que já foi provado, o
que falta provar e o formato da resposta.

**Escopo obrigatório.** Os níveis L e R recebem os arquivos do escopo mais o
contrato do módulo, nunca o repositório inteiro.

O briefing do levantamento tem três partes:

```
## Fatos verificados
- F1 `caminho/arquivo.ts:120` `funcaoX(a, b)` grava `tabela.coluna`
- F2 a última migração é a `0045_...`; a próxima é `0046`
- F3 quem chama `funcaoX` em produção: `outro.ts:88` (ou "ninguém")
## Riscos e invariantes tocadas
- ...
## Perguntas em aberto
- ...
```

Cada fato tem `arquivo:linha` e é verificável em um comando. O que não foi
lido não entra como fato.

## 5. Pré-validação do executor, obrigatória

Antes de dizer "pronto", o executor cumpre a lista e põe a prova de cada
item no relatório:

1. Mutou 2 ou 3 comportamentos centrais e viu o teste ficar vermelho.
   A mutação é feita numa cópia fora do repositório e restaurada por cópia,
   com o hash do arquivo conferido antes e depois. Nunca restaure por
   `git checkout -- <arquivo>`: em árvore compartilhada, isso apaga trabalho
   de outra sessão.
2. Quando há tela, tirou a captura (Playwright ou equivalente) e **olhou**.
3. Verificação de tipos e lint limpos.
4. Cada tarefa marcada aponta o arquivo ou o teste que a prova.
5. A suíte inteira verde, ou cada vermelho atribuído com prova a outra
   frente. O log da suíte vai amarrado ao hash da árvore testada
   (`git diff | sha256sum`), para o validador saber se pode reaproveitá-lo.
6. **Checkpoint por fase.** Em tarefa longa, cada fase concluída grava o
   estado (o que foi feito, o que foi provado, o que falta) num arquivo de
   trabalho. Se a sessão cair, a retomada começa dali, não do zero.

O relatório é curto: resultado, prova, pendências.

## 6. Validação da entrega

O validador:

1. Confere que o hash da árvore é o do log do executor. Se for, reaproveita
   a suíte inteira. Se não for, a suíte inteira roda uma vez.
2. Roda só os testes dos arquivos tocados.
3. Faz ao menos uma mutação própria, diferente das do executor, e diz qual
   teste a pegou.
4. Confere a tela, quando houver.
5. Julga os dois checklists e responde no formato abaixo.

**Checklist bloqueador (100%, sem exceção; cada linha com arquivo ou teste
que comprove):**

1. Contrato público intacto, nenhuma assinatura alterada sem versionamento
2. Isolamento de dados entre clientes/tenants preservado, nenhuma consulta
   sem o filtro que os separa
3. Existe teste que falha sem a mudança e passa com ela
4. Migração reversível, nenhuma operação destrutiva sem rollback
5. Nenhum arquivo fora do escopo declarado foi tocado
6. Cobertura de pelo menos 80% nas linhas que a mudança tocou (piso, não
   meta; medida sobre o diff, não sobre o repositório)

**Checklist de qualidade (mínimo 80%):**

1. Caminho de erro coberto por teste
2. Sem duplicação de lógica já existente no módulo
3. Nomes e padrões seguindo o projeto
4. Sem TODO e sem código morto
5. Teste de navegador cobrindo o fluxo principal, quando houver interface
6. Toda peça nova tem chamador em produção (serviço, coluna, interruptor,
   índice); peça pronta que ninguém chama é a falha mais comum e não dá erro

**Formato do veredito:**

```
APROVADA | REPROVADA
BLOQUEANTE
- item | aprovado/reprovado | arquivo ou teste | uma linha de justificativa
MELHORIA (não reprova)
- ...
qualidade: N/6 (sinal de alerta, não portão)
```

O validador não conserta nada. Reprovado, o trabalho volta ao mesmo
executor com o motivo.

## 7. Com e sem OpenSpec

A matriz é a mesma nos dois caminhos. Muda só onde os artefatos moram.

| Etapa | Com OpenSpec | Sem OpenSpec |
|---|---|---|
| Levantamento | Briefing em `openspec/changes/<nome>/briefing.md` | Briefing num arquivo de trabalho (`pasta de trabalho ignorada pelo git/briefing-<nome>.md`) |
| Plano | `proposal.md`, `design.md`, `tasks.md` e o delta de spec | Um `plano-<nome>.md` com tarefas numeradas e testáveis |
| Validação do plano | O revisor corrige os artefatos da mudança e registra no `design.md` | O revisor devolve o parecer, e o executor o aplica |
| Execução | Marca `tasks.md` com a prova de cada item | Relatório de pré-validação |
| Validação da entrega | Mais `openspec validate --strict` | Só os checklists |
| Fechamento | `openspec archive` e commit | Commit |

**Quando usar OpenSpec:** funcionalidade grande, módulo novo ou capacidade
nova, onde a proposta e o delta de spec se pagam. **Quando não usar:**
melhoria e correção do dia a dia; ali o rito custa mais do que entrega. O
que **nunca** sai, nos dois caminhos: a suíte inteira antes do commit, a
matriz, e o validador antes do aceite.

## 8. Sessão sem humano (execução em lote, `-p`, CI)

- Não delegue esperando notificação: não existe turno seguinte. Consuma o
  resultado do subagente no mesmo turno, ou faça o trabalho direto.
- Não pergunte: decida, execute, registre a alternativa descartada.
- Comando longo roda destacado, e é sondado até terminar dentro do mesmo
  turno. A resposta final só sai com o resultado observado.
- Tarefa que depende do dono do projeto é reescrita no que a sessão pode
  provar, com a dependência registrada.

## 9. Economia de token, em resumo

- RTK ligado (§0), e `rtk gain` no relatório do lote.
- Prompt de delegação só com a tarefa (§4).
- O nível L lê só o escopo; o plano não relê o código.
- O validador reaproveita a prova amarrada ao hash (§6) e não repete a
  suíte inteira.
- Melhoria não gera rodada nova (§3, regra 8).
- Fluxo curto para o que é pequeno (§2).
- Checkpoint por fase, para a queda não recomeçar do zero (§5).
