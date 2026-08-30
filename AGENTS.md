# Instruções permanentes do projeto

## Resumos de atualizações para os jogadores

Pedido do responsável pelo projeto: a partir de agora, toda atualização de funcionalidades deve ter um resumo claro, em português do Brasil, voltado ao usuário final e sem termos técnicos.

- Em toda tarefa, verificar se as mudanças alteram algo que o jogador vê ou usa. Se alterarem, escrever ou atualizar o resumo em `release-notes/UNRELEASED.md` durante o trabalho.
- Explicar o que mudou, o benefício para o jogador e qualquer ação que ele precise tomar. Usar frases curtas e exemplos concretos quando ajudarem.
- Não usar nomes de arquivos, funções, bibliotecas, banco de dados, commits ou detalhes internos como descrição das novidades. Não anunciar recursos incompletos ou não verificados.
- Antes de publicar uma versão, revisar as mudanças desde a versão anterior, consolidar o resumo em `release-notes/v<VERSÃO>.md` (mesma versão do `package.json`) e retirar do rascunho somente os itens incluídos nessa versão.
- A descrição da versão no GitHub e o aviso no Discord devem usar esse mesmo resumo revisado. Não substituir por uma lista automática de commits.
- Mesmo em uma versão apenas de correções, descrever em linguagem simples o problema corrigido. Não inventar mudanças visíveis quando o trabalho for apenas interno.
- Antes de concluir uma tarefa, informar se o resumo foi atualizado ou se não havia mudanças para o usuário final.

## Publicação e Discord

- O workflow `.github/workflows/release-windows.yml` publica o instalador e depois avisa no Discord. A publicação de uma versão nova exige o arquivo de resumo daquela versão.
- O webhook de atualizações pertence ao segredo `DISCORD_RELEASE_WEBHOOK` do GitHub Actions. Nunca colocar seu valor no código, documentação, logs, exemplos, testes ou instalador.
- Não confundir esse webhook com os webhooks pessoais de notificações do jogo.
- Não enviar anúncios de teste que pareçam versões reais. Não marcar usuários, cargos ou `@everyone` nos avisos de versão.
- Preservar mudanças de outras tarefas em andamento e nunca publicá-las junto por acidente.
