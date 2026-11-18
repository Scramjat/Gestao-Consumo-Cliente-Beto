# Comanda — controle de consumo

Sistema simples para anotar o que cada cliente consumiu. Cada produto tem um preço cadastrado pelo administrador, e ao encerrar a conta o sistema mostra o valor de cada produto, o total a pagar e a forma de pagamento.

Funciona de três jeitos:
- **Na internet (Render)**: o banco de dados roda no servidor, com login de administrador. É o modo recomendado para usar no tablet ou celular. Veja **Usar pela internet (Render)**.
- **No tablet ou celular, sem servidor** (GitHub Pages): os dados ficam guardados só no próprio aparelho.
- **No computador** (com o servidor local): os dados também são gravados no Obsidian.

## Usar pela internet (Render)

O endereço do site pede **usuário e senha** (o administrador). O usuário é `Admin`; a senha é a que foi definida em `ADMIN_PASSWORD` ao criar o serviço no Render (ela não fica no código). A sessão dura 30 dias em cada aparelho; o botão **Sair** (no topo) encerra a sessão.

**Publicar no Render**
1. No Render: **New + → Blueprint** e escolha o repositório `Gestao-Consumo-Cliente-Beto`. O Render lê o arquivo `render.yaml`.
2. Quando perguntar `ADMIN_PASSWORD`, digite a senha do administrador (de preferência uma senha forte: o usuário é `Admin` e o repositório é público).
3. **Apply** / **Deploy Blueprint**. Em alguns minutos o site fica no ar em `https://gestao-consumo-cliente-beto.onrender.com` (o endereço exato aparece no painel).

**Importante sobre o plano gratuito do Render**
- O serviço **dorme após 15 minutos sem uso**. O primeiro acesso depois disso leva cerca de 1 minuto para acordar. A faixa vermelha "Sem conexão com o servidor" pode aparecer nesse tempo: aguarde, nada se perde.
- O disco do servidor é **apagado** quando ele reinicia ou recebe uma versão nova. Por isso o aparelho guarda uma cópia dos dados e **devolve tudo ao servidor sozinho** assim que ele volta. Mesmo assim, **faça backup com frequência** (botão de baixar → **Fazer backup**).
- Para o banco ficar guardado de forma definitiva no servidor, o Render tem planos pagos com **disco persistente**.

## Produtos e preços

O botão de **etiqueta** (no topo) abre **Produtos e preços**, a área do administrador:
- **Adicionar**: nome e preço (ex.: `Cerveja` e `10,00`).
- **Editar** (lápis) e **excluir** (lixeira, com opção de desfazer). Dá para buscar pelo nome.
- Ao lançar um consumo, digite parte do nome e escolha o produto na lista que aparece: o preço aparece embaixo do campo. Produto fora da lista é aceito, mas fica **sem preço** na conta.

## Fechar a conta

**Encerrar** no cartão do cliente abre a conta: quantidade, produto, valor unitário e valor total de cada linha, o **valor a pagar** e a **forma de pagamento** (PIX, Crédito ou Débito, obrigatória). Depois de encerrar, o cartão fica em **Concluídos** mostrando tudo isso.

- Os valores ficam **guardados no momento do pagamento**: mudar o preço depois não altera contas já encerradas.
- Itens sem preço na lista não entram no total (a janela avisa antes de encerrar).
- **Reabrir** desfaz o encerramento e apaga o pagamento registrado.

## Usar no tablet ou celular (instalar na tela inicial)

1. Abra o endereço do site no navegador (Safari no iPad/iPhone, Chrome no Android).
2. **Instale na tela inicial** (importante para os dados não serem apagados pelo navegador):
   - **iPad/iPhone (Safari):** botão Compartilhar → **Adicionar à Tela de Início**.
   - **Android (Chrome):** menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
3. Abra sempre pelo ícone **Comanda** da tela inicial. Funciona até sem internet.

**Os dados ficam só neste aparelho** (nesse modo, sem o Render). Não são enviados para a internet nem para o GitHub.

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
3. **+** ao lado do item registra mais um pedido agora. **−** corrige o pedido mais recente.
4. Quando o cliente pagar e for embora, clique em **Encerrar**. A conta vai para a aba **Concluídos**. Se foi engano, use **Reabrir**.
5. **Excluir** só fica ativo para clientes que ainda não consumiram nada.
6. `/` foca a busca. As abas mostram os clientes abertos (todos, com consumo, sem consumo) e os concluídos.
   Os cards do resumo no topo também são clicáveis: **Na casa**, **Com consumo**, **Sem consumo** e **Concluídos** mostram esses clientes; **Itens pedidos** abre a lista de tudo o que foi pedido, por produto ou por horário, com o **valor total de cada produto** (ex.: 5 bramas somam R$ 37,50) e o valor de cada pedido.
7. O botão de **métricas** (gráfico, no topo) abre um painel com indicadores e gráficos do período escolhido (Hoje, 24 horas, 7 dias, 30 dias ou Tudo): faturamento, ticket médio, formas de pagamento, itens pedidos, clientes atendidos e média por cliente, horário de pico, quem mais consumiu, produto campeão, tempo médio de permanência, tempo até o 1º pedido, consumo da última hora, consumo por hora, por dia e por dia da semana, mesas mais movimentadas, contas abertas paradas há mais de 60 min e um resumo por cliente. Passe o mouse (ou toque) nos gráficos para ver os valores.
8. O botão de **baixar** (no topo) gera uma planilha do Excel com tudo:
   - **Clientes**: nome, mesa, CPF, cadastro, situação (aberta/encerrada), quando encerrou, total de itens, **valor da conta**, **forma de pagamento**, primeiro pedido e o consumo completo;
   - **Pedidos**: cada pedido em uma linha, com data, hora (com segundos), cliente, produto, quantidade, **valor unitário** e **valor total**;
   - **Produtos**: total pedido de cada produto, valor unitário, valor total vendido e quem pediu.
   Todas as abas já vêm com filtro e cabeçalho fixo.

## Atalhos criados no Windows

- `Comanda` na Área de Trabalho: abre o site (e liga o servidor, se estiver desligado).
- `Comanda (servidor)` na pasta *Inicializar* (`Win + R` → `shell:startup`): liga o servidor ao iniciar o Windows. Para desativar, apague esse atalho.

Se a pasta do projeto for movida ou renomeada, os atalhos precisam ser recriados.

## Estrutura

```
config.json             pasta do cofre e porta (só no computador)
render.yaml             publicação no Render (banco de dados na internet)
package.json            nome do projeto e comando de início
index.html              página
manifest.webmanifest    nome, ícone e cores do app instalado
sw.js                   faz o app abrir sem internet
server/
  server.js             servidor: entrega o site, login do administrador e grava os dados
  iniciar.vbs           liga o servidor sem janela (usado pelos atalhos)
assets/
  css/
    theme.css           cores do modo claro e escuro
    index.css           layout e componentes
    metrics.css         painel de métricas
    billing.css         valores, pagamento, produtos e login
    animations.css      animações
  js/
    theme.js            tema (sempre abre no claro; o botão troca só durante o uso)
    utils.js            formatação e validação (CPF, horários…)
    icons.js            ícones SVG
    billing.js          preços, total da conta e forma de pagamento
    storage.js          dados, preços e horário dos pedidos (cópia no navegador)
    products.js         janela de produtos e preços (administrador)
    markdown.js         notas do Obsidian (usado pelo site e pelo servidor)
    excel.js            planilha do Excel (.xlsx) do botão de baixar
    metrics.js          painel de métricas (cálculos e gráficos)
    obsidian.js         conexão com o banco e login (servidor → cofre)
    ui.js               modais, avisos e desenho dos cards
    app.js              liga a interface aos dados
  img/
    favicon.svg
    icon-*.png          ícones do app (tela inicial)
```
