# Novidades

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
