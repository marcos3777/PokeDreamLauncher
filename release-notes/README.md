# Novidades de cada versão

Os textos desta pasta são escritos para quem joga, em português e sem detalhes técnicos. O arquivo `AGENTS.md` exige a revisão desse resumo em todas as tarefas que mudam funcionalidades.

Durante o desenvolvimento, acumule as novidades em `UNRELEASED.md`. Antes de publicar, revise os itens e salve o texto definitivo em `v<VERSÃO>.md`, com a versão exata do `package.json`. Remova do rascunho somente o que entrou nessa versão.

Use um título como `## O que mudou` e uma lista curta explicando as novidades, melhorias e correções. Se for preciso fazer algo após atualizar, explique no final. O texto deve ter no máximo 3.500 caracteres para caber inteiro no aviso do Discord. Não deixe marcadores como TODO, TBD ou PREENCHER no texto final.

O workflow usa esse arquivo como descrição da versão no GitHub. Depois de publicar o instalador, envia a mesma descrição ao Discord, com a versão e o link de download. Versões que já existiam antes daquela execução não geram outro aviso.

## Configuração do Discord

Em GitHub → Settings → Secrets and variables → Actions, crie o segredo `DISCORD_RELEASE_WEBHOOK` com o endereço do webhook do canal de atualizações. Não coloque esse endereço nos arquivos do projeto.

O aviso é uma etapa separada da publicação. Se o Discord estiver indisponível ou o segredo faltar, o instalador continua publicado e a etapa do aviso indica a falha. Depois de resolver o problema, use **Re-run failed jobs** naquela execução para tentar o aviso novamente. Executar o workflow inteiro de novo não reenvia versões já existentes. Não reexecute manualmente um aviso que já teve sucesso, pois isso pode duplicá-lo.

O fluxo cobre as versões publicadas pelo workflow Release Windows. Publicações manuais fora dele não disparam esse aviso. Não há anúncio retroativo ao instalar esta configuração.

## Verificação local

```sh
node --test .github/scripts/release-announcement.test.cjs
node .github/scripts/release-notes.cjs
```

Os testes usam respostas simuladas e não enviam mensagens ao Discord.
