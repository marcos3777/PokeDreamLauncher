# PokeDream Launcher

Navegador multitela leve (Electron) para [PokeDream](https://pokedream.com.br/) e outros sites. Abre até **4 abas**, cada uma com até **4 sessões independentes** em grade 2x2, com modo foco e logins persistentes.

## Funcionalidades

- Aba PokeDream fixa, com todas as ferramentas exclusivas do jogo
- Até 3 abas adicionais para abrir qualquer site
- Até 4 sessões independentes por aba, chegando a 16 telas no total
- Logins isolados: entrar em uma conta não altera as outras sessões do mesmo site
- Abas e quantidade de sessões restauradas ao fechar e reabrir
- 4 telas por aba em grade 2x2
- Clique em uma tela para dar **zoom** (tela cheia)
- Botao **Grade** para voltar ao grid 2x2
- **Sessoes salvas e criptografadas** -- cookies e storage persistem ao fechar/reabrir; o backup do storage e cifrado com `safeStorage` do SO (nao fica em texto puro no disco)
- Recarregar telas individualmente (botaozinho ↻)
- Janela sem moldura com barra arrastavel
- **Pokédex em formato de hub**: cada card mostra XP/h, mobs/h, captura, shiny e nível da task; o detalhe lateral reúne broke normal/shiny, recordes, tasks e drops observados
- Dados comunitários de captura e performance passam por uma leitura agregada por espécie; as tabelas e contas brutas não são expostas ao aplicativo

---

## ⬇ Baixar (Windows) — o jeito mais facil

**Nao precisa saber programar. E so instalar como qualquer programa.**

### 👉 [Clique aqui para baixar o instalador (.exe)](https://github.com/marcos3777/PokeDreamLauncher/releases/latest/download/Poke-Dream-Launcher-Windows-x64.exe)

1. Baixe o instalador `.exe` no link acima.
2. De **dois cliques** nele e siga o instalador (cria um atalho no Desktop).
3. Abra pelo **atalho**. O launcher inicia com 2 telas para você entrar nas suas contas.

> 🔄 **Ele se atualiza sozinho:** quando sair uma versao nova, o app baixa e aplica automaticamente na proxima vez que voce abrir/fechar. Voce nao precisa baixar de novo.

> ⚠️ Na primeira vez o Windows pode mostrar um aviso azul (SmartScreen), porque o app nao tem assinatura digital paga. E so clicar em **Mais informacoes → Executar assim mesmo**. E seguro — todo o codigo esta aqui no repositorio.

Todas as versoes ficam em **[Releases](https://github.com/marcos3777/PokeDreamLauncher/releases)**.

---

## 📖 Alternativa: rodar pelo codigo (Linux/Mac ou quem quer o codigo-fonte)

> Se voce ja instalou pelo `.exe` acima, **pode pular esta parte** — ela e so pra quem prefere rodar direto do codigo.

Nao precisa saber programar. E so seguir na ordem. **Voce so faz os passos 1 e 2 uma unica vez.** (Instrucoes para **Windows**; em Linux/Mac os comandos `npm` sao os mesmos.)

### Passo 1 — Instalar o Node.js (uma vez so)

O Node.js e o "motor" que faz o launcher rodar. Instala igual qualquer programa:

1. Entre em **https://nodejs.org**
2. Clique no botao verde da esquerda que diz **LTS** (a versao recomendada).
3. Abra o arquivo que baixou e clique **Next / Avancar** ate o fim, depois **Finish**. Pode deixar tudo no padrao.

### Passo 2 — Baixar o launcher (uma vez so)

1. No topo desta pagina do GitHub, clique no botao verde **`< > Code`**.
2. Clique em **Download ZIP**.
3. Ache o arquivo `.zip` na sua pasta de Downloads, clique com o **botao direito → Extrair tudo**.
4. Vai virar uma pasta chamada `PokeDreamLauncher`. **Guarde ela num lugar fixo** (ex.: Documentos), porque e daqui que o launcher roda.

### Passo 3 — Abrir a "linha de comando" dentro da pasta

1. Abra a pasta que voce extraiu (a que tem os arquivos `main.js`, `app.html`, etc.).
2. Clique na **barra de endereco** do Explorer (aquela em cima que mostra o caminho da pasta).
3. Apague o que estiver escrito, digite **`cmd`** e aperte **Enter**.
4. Vai abrir uma janela preta (o "Prompt de Comando") **ja dentro da pasta certa**. E nela que voce cola os comandos abaixo.

### Passo 4 — Preparar (uma vez so)

Na janela preta, cole a linha abaixo e aperte **Enter**. Ela baixa o que o launcher precisa (demora 1-2 minutos na primeira vez; espere terminar).

```bash
npm install
```

### Passo 5 — Abrir o launcher

Cole esta linha e aperte **Enter**:

```bash
npm start
```

Pronto! O launcher abre na aba fixa do PokeDream. Use **`+ Adicionar tela`** para abrir mais contas do jogo; acima de 2, ele avisa sobre o limite futuro previsto pelo servidor. Use o **`+` da barra de abas** para adicionar outro site, com até 4 sessões separadas por aba.

### Da proxima vez que quiser abrir

Voce **nao** repete os passos 1, 2 e 4. E so:

1. Abrir a pasta do launcher;
2. Digitar `cmd` na barra de endereco (Passo 3);
3. Colar `npm start` e apertar Enter.

> 💡 **Dica:** cansou de digitar? Veja a secao **Gerar instalador** mais abaixo — da pra transformar em um programa normal, com atalho no Desktop, que abre com dois cliques (sem janela preta).

### Deu algum problema?

- **"npm nao e reconhecido como comando"** → o Node.js nao terminou de instalar ou o terminal foi aberto antes. Feche a janela preta, reinicie o computador e tente o Passo 3 de novo.
- **Uma tela ficou branca / travada** → passe o mouse na tela na lista lateral e clique no **↻** para recarregar so ela.
- **Sumiu o login** → normal na primeira vez; depois de logar uma vez, ele fica salvo para as proximas.

---

## Como rodar (resumo, pra quem ja manja)

```bash
npm install
npm start
```

Ou direto: `npx electron .`

## Gerar instalador

Isso cria um programa instalavel (com atalho no Desktop), para nao precisar mais do terminal:

```bash
# Windows (.exe, instalador)
npm run dist

# Linux (.AppImage)
npm run dist:linux
```

O arquivo final fica na pasta `dist/`. No Windows, e so abrir o `.exe` gerado e instalar como qualquer programa. (Como o executavel nao tem assinatura digital paga, o Windows pode mostrar um aviso na primeira vez: **Mais informacoes → Executar assim mesmo**.)

## Estrutura

```
main.js       - processo principal (janelas, layout, IPC, persistencia)
app.html      - painel lateral (sidebar) e barra superior
preload.js    - ponte IPC entre UI e main process
pokemon-hub.js - união segura de captura, performance, tasks e drops por espécie
site-tabs.js  - validação, restauração e isolamento das abas de sites
```

## Privacidade e dados salvos

Sessoes e logins ficam **somente no seu computador**, em `%APPDATA%/poke-dream-launcher/`:

- `storage/storage-accN.bin` -- backup do localStorage/sessionStorage de cada tela, **criptografado** com `safeStorage` (DPAPI no Windows / Keychain no macOS / libsecret no Linux). Como pode conter o token de login, nunca compartilhe esses arquivos.
- Cookies de sessao sao convertidos em persistentes (~60 dias) para manter o login entre execucoes.
- Cada sessão de um site genérico usa uma partição persistente própria; cookies e logins não são compartilhados entre telas.

O login e persistido de forma **orientada a eventos** (reage a navegacao/redirect do login), e o backup do storage so e regravado quando algo muda.

## Licenca

MIT. Projeto comunitario, sem vinculo oficial com o PokeDream.
