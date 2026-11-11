# Comanda — controle de consumo

Sistema simples para anotar o que cada cliente consumiu. Não usa preços: só **quem pediu** e **o que pediu**.

Funciona de dois jeitos:
- **No tablet ou celular** (hospedado no GitHub Pages): os dados ficam guardados no próprio aparelho.
- **No computador** (com o servidor local): os dados também são gravados no Obsidian.

## Usar no tablet ou celular

1. Abra o endereço do site no navegador (Safari no iPad/iPhone, Chrome no Android).
2. **Instale na tela inicial** (importante para os dados não serem apagados pelo navegador):
   - **iPad/iPhone (Safari):** botão Compartilhar → **Adicionar à Tela de Início**.
   - **Android (Chrome):** menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
3. Abra sempre pelo ícone **Comanda** da tela inicial. Funciona até sem internet.

**Os dados ficam só neste aparelho.** Não são enviados para a internet nem para o GitHub.

**Faça backup com frequência:** botão de baixar (no topo) → **Fazer backup**. Guarde o arquivo `.json` no Google Drive, iCloud ou WhatsApp. Se trocar de aparelho, ou se o navegador apagar os dados, use **Restaurar backup** com esse arquivo.

A planilha do Excel fica no mesmo menu: **Planilha Excel**.

### Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie estes arquivos (a pasta `BD/` fica de fora pelo `.gitignore`).
2. No repositório: **Settings → Pages → Branch: `main` / pasta `/ (root)` → Save**.
3. O site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

Ao mudar arquivos do site, aumente a `VERSAO` em `sw.js` para os aparelhos receberem a atualização.

## Usar no computador (com Obsidian)

Clique no atalho **Comanda** da Área de Trabalho, ou acesse **http://localhost:3210** no navegador (vale salvar nos favoritos).

O servidor liga sozinho, sem janela, quando o Windows inicia. Não é preciso abrir nem conectar nada.

> Não abra o `index.html` com dois cliques. Assim a página não grava no banco, e uma faixa vermelha avisa.

## Banco de dados (Obsidian)

Cada alteração é gravada na hora, com **data e horário de cada pedido**, na pasta configurada em `config.json` (por padrão, a pasta `BD/` do projeto):

```
BD/                                  ← abra esta pasta no Obsidian como cofre
  Comanda/
    dados.json                       ← todos os dados (o site lê daqui ao abrir)
    Contas abertas.md                ← quem está com a conta aberta agora
    Dias/2026-11-02.md               ← cada pedido do dia com o horário, contas encerradas e cadastros
    backup/dados 2026-11-02.json     ← cópia de segurança dos dados de cada dia
```

No Obsidian: **Abrir pasta como cofre** → escolha a pasta `BD`.

Para usar um cofre que você já tem, troque o caminho em `config.json` e reinicie o computador:

```json
{ "pastaCofre": "C:/Users/SeuUsuario/Documents/MeuCofre", "porta": 3210 }
```

Se o servidor parar por algum motivo, aparece uma faixa vermelha no site. Nada se perde: o que for lançado fica guardado no navegador e é enviado assim que ele voltar. Para religar, clique no atalho **Comanda**. Erros do servidor ficam em `server/erros.log`.

## Data e horário

Não existe "noite" nem virada de dia: o sistema funciona a qualquer hora. Cada pedido guarda a data e o horário em que foi feito, e aparece embaixo do produto no cartão (ex.: `21:04 (1) · 23:10 (2)`). Pedidos de outro dia mostram também a data (`01/11 21:04`). Contas abertas continuam na lista até serem encerradas.

## Como usar

1. **Novo cliente** (ou a tecla `N`) → nome e, se quiser, número da mesa e CPF → **Salvar**.
   Na busca, digite `5`, `mesa 5` ou `m5` para achar quem está na mesa 5 (a mesa 15 não aparece junto).
2. No cartão do cliente, **+ Consumo** → produto (ex.: `cerveja skol`) e quantidade.
   - **Adicionar e continuar** lança outro produto sem fechar a janela.
   - Os produtos mais pedidos aparecem como atalhos.
3. **+** ao lado do item registra mais um pedido agora. **−** corrige o pedido mais recente.
4. Quando o cliente pagar e for embora, clique em **Encerrar**. A conta vai para a aba **Concluídos**. Se foi engano, use **Reabrir**.
5. **Excluir** só fica ativo para clientes que ainda não consumiram nada.
6. `/` foca a busca. As abas mostram os clientes abertos (todos, com consumo, sem consumo) e os concluídos.
   Os cards do resumo no topo também são clicáveis: **Na casa**, **Com consumo**, **Sem consumo** e **Concluídos** mostram esses clientes; **Itens pedidos** abre a lista de tudo o que foi pedido, por produto ou por horário.
7. O botão de **métricas** (gráfico, no topo) abre um painel com indicadores e gráficos do período escolhido (Hoje, 24 horas, 7 dias, 30 dias ou Tudo): itens pedidos, clientes atendidos e média por cliente, horário de pico, quem mais consumiu, produto campeão, tempo médio de permanência, tempo até o 1º pedido, consumo da última hora, consumo por hora, por dia e por dia da semana, mesas mais movimentadas, contas abertas paradas há mais de 60 min e um resumo por cliente. Passe o mouse (ou toque) nos gráficos para ver os valores.
8. O botão de **baixar** (no topo) gera uma planilha do Excel com tudo:
   - **Clientes**: nome, CPF, cadastro, situação (aberta/encerrada), quando encerrou, total de itens, primeiro pedido e o consumo completo;
   - **Pedidos**: cada pedido em uma linha, com data, hora (com segundos), cliente, produto e quantidade;
   - **Produtos**: total pedido de cada produto e quem pediu.
   Todas as abas já vêm com filtro e cabeçalho fixo.

## Atalhos criados no Windows

- `Comanda` na Área de Trabalho: abre o site (e liga o servidor, se estiver desligado).
- `Comanda (servidor)` na pasta *Inicializar* (`Win + R` → `shell:startup`): liga o servidor ao iniciar o Windows. Para desativar, apague esse atalho.

Se a pasta do projeto for movida ou renomeada, os atalhos precisam ser recriados.

## Estrutura

```
config.json             pasta do cofre e porta (só no computador)
index.html              página
manifest.webmanifest    nome, ícone e cores do app instalado
sw.js                   faz o app abrir sem internet
server/
  server.js             servidor local: entrega o site e grava no cofre
  iniciar.vbs           liga o servidor sem janela (usado pelos atalhos)
assets/
  css/
    theme.css           cores do modo claro e escuro
    index.css           layout e componentes
    metrics.css         painel de métricas
    animations.css      animações
  js/
    theme.js            alternância de tema
    utils.js            formatação e validação (CPF, horários…)
    icons.js            ícones SVG
    storage.js          dados e horário dos pedidos (cópia no navegador)
    markdown.js         notas do Obsidian (usado pelo site e pelo servidor)
    excel.js            planilha do Excel (.xlsx) do botão de baixar
    metrics.js          painel de métricas (cálculos e gráficos)
    obsidian.js         conexão com o banco (servidor → cofre)
    ui.js               modais, avisos e desenho dos cards
    app.js              liga a interface aos dados
  img/
    favicon.svg
    icon-*.png          ícones do app (tela inicial)
```
