# Novidades

## Próxima versão
### Consumo do plano do Claude Code
- A barra de título mostra o percentual do limite de 5 horas e do semanal, com cor por nível (laranja a partir de 70%, vermelho a partir de 90%), sempre visível e atualizada a cada minuto. Passe o mouse para ver conta, plano e quando reinicia. A barra usa a leitura pela statusline do Claude Code: fica em cinza quando a última leitura tem mais de 15 minutos e não aparece quando não há dados do plano.
### Editor
- Botão no cabeçalho dos terminais (e o ✕ no canto do editor) para esconder e mostrar o painel do editor; os terminais ocupam o espaço. Esconder não fecha nem descarta arquivos abertos. O painel reaparece ao abrir um arquivo, e o estado é lembrado por workspace.
### Terminal
- Shift+Enter quebra a linha no terminal em Windows, macOS e Linux, como nas CLIs de IA.
- Nenhum terminal abre sozinho: ao abrir a IDE ou trocar de projeto, a área dos terminais mostra "Nenhum terminal aberto" e o botão "Novo terminal".
- Com o WSL instalado, o botão de novo terminal pergunta onde abrir: "Windows (PowerShell)" ou "WSL (distribuição)". Sem WSL, abre direto.
- O ícone de "Esconder painel" do editor agora é uma seta, para não se confundir com o ✕ de "Fechar quadro".

## 1.1.3 · 29/09/2026
### Atualização mais segura
- O histórico do repositório do Rendra IDE no GitHub vai ser reorganizado. Para que a atualização automática continue funcionando depois disso, o app agora sabe se recuperar: se você não mexeu nos arquivos do app, ele acompanha a nova história sozinho e segue com a atualização normalmente.
- Se você alterou arquivos do app, nada é apagado nem trocado: o app abre na versão atual e avisa para guardar suas alterações (`git stash`) e atualizar de novo.
- Suas configurações, workspaces e preços ficam em `%APPDATA%\Rendra IDE` e nunca são tocados. Os commits antigos ficam guardados na branch local `rendra-backup-antes-da-atualizacao`.

## 1.1.2 · 29/09/2026
### Novo endereço
- O repositório passou de `bsmagalhaes/rendra-ide` para `bsmagalhaes/rendra-ui-ide`, e o site para `https://bsmagalhaes.github.io/rendra-ui-ide/`, para combinar com o nome da família Rendra. O endereço antigo do GitHub continua redirecionando, então a atualização automática e as cópias já instaladas seguem funcionando sem nenhuma ação. O link antigo do site deixou de abrir.
- O uso e as configurações não mudam. Quem clonou a pasta com o nome antigo pode manter tudo como está.

## 1.1.1 · 29/09/2026
### DevCode IDE
- Terminal do WSL com a distro desligada: o app liga a distro antes de abrir o terminal e tenta de novo se o WSL demorar a responder, em vez de mostrar o erro `Wsl/Service/0x8007274c`.

### Segurança e compatibilidade
- Electron atualizado da versão 31 (sem suporte) para a 44, a estável atual. Isso corrige o bloqueio no macOS ("Electron.app não foi aberto porque contém malware"), que apagava o Electron ao rodar `npm start`.
- Dependências de desenvolvimento atualizadas (electron-builder 26): as 16 vulnerabilidades conhecidas foram corrigidas e a instalação não mostra mais alertas do `npm audit`.
- Terminal, editor e painéis continuam iguais; nada muda no uso. Para atualizar à mão: `git pull` e `npm install` (Node 22.12 ou mais novo).

## 1.1.0 · 26/09/2026

### Rendra IDE
- O app passa a se chamar **Rendra IDE** ([rendraskills.com](https://rendraskills.com)). Configurações, workspaces e preços da versão anterior são migrados automaticamente.
- Atualização pelo próprio app: quando sai uma versão nova, a barra inferior mostra **Atualizar agora**. O app fecha (perguntando antes se há arquivos para salvar), baixa a versão com `git pull` e `npm install` e abre de novo, sem mexer em configurações, workspaces e preços. Na primeira abertura depois de atualizar, esta página mostra o que mudou.
- Preços atualizados pelo próprio Rendra IDE: ao abrir, o app verifica se há uma tabela de preços nova e oferece aplicar.
- Limites de uso do Claude lidos da statusline do Claude Code, sem usar o seu login; o modo completo (com limites por modelo) é opcional nas Configurações.
- Novas páginas **Novidades** e **Sobre**, com autoria, créditos e licenças.
- Novo ícone: símbolo de código laranja sobre fundo preto.
- Saiu o boneco animado e o escurecimento da tela por inatividade.

### DevCode IDE
- Nova aba principal: explorador de arquivos, terminais e editor Monaco (o editor do VS Code), com vários workspaces em abas, renomeáveis e restaurados ao abrir o app.
- Layout padrão Pastas 25% · Terminais 50% · Editor 25%, com todas as larguras ajustáveis.
- Terminais em grade de 1 a 4 colunas, abas no título, renomear inline e reordenar arrastando.
- Shells por sistema: PowerShell, Git Bash e CMD no Windows; zsh, bash e fish no macOS e Linux.
- Cores do Git em tempo real (modificado, novo, ignorado e submódulos) propagadas às pastas, ícones por tipo de arquivo e linhas-guia.
- Pergunta Salvar / Não salvar / Cancelar ao fechar abas, workspaces e o app com arquivos alterados; confirmação ao fechar terminais.
- WSL: projetos no Linux ou pastas do Windows montadas no Linux, com terminal e Git rodando dentro da distribuição.
- Colar imagem no terminal (Alt+V no Windows, Ctrl+V no Linux e macOS) para CLIs como o Claude Code.

### Terminal
- Página exclusiva de terminais, que funciona mesmo sem Claude Code ou Codex instalados.

### Consumo e custos
- Custo sempre por token: tokens × preço por 1 milhão de tokens.
- Nova página **Preços** com as tabelas do Claude Code e do Codex, editáveis e atualizadas pelo Rendra IDE a partir das tabelas oficiais da Anthropic e da OpenAI.
- Claude Code: escrita de cache de 5 minutos e de 1 hora cobradas separadamente, modo rápido e buscas web.
- Subagentes passaram a ser contados, e cada resposta é contada uma única vez (antes, linhas repetidas eram somadas em dobro).
- Nova página **Codex** (Codex CLI da OpenAI), com consumo, limites de uso e "Não conectado" quando não há dados.
- Filtros por projeto e período; conta conectada e limites de uso do plano do Claude.
- Leitura do histórico em segundo plano e com cache em disco: a abertura do app não trava mais.

### RTK
- Página do RTK com economia, comandos e integração com o Claude Code e o Codex.
- Configuração do ambiente na primeira abertura: instala Git Bash, RTK e WSL quando faltarem (`npm run setup` para quem clona o repositório).

### App
- Barra lateral no estilo do VS Code; interface em português.
- Compatível com Windows, macOS e Linux; abre maximizado (no macOS, ocupando a tela).

### Avisos
- Custos são **estimativas** calculadas com a tabela de preços da página Preços; o valor cobrado de fato depende do seu plano ou contrato.
- Os preços seguem as tabelas oficiais da Anthropic e da OpenAI na data indicada na página Preços; você pode ajustá-los manualmente.

## 1.0.0

- Versão original do Tokenmeter, por Dewashish Lambore: painel de consumo do Claude Code com gráficos, mapa de atividade, horários de pico e custos estimados.
