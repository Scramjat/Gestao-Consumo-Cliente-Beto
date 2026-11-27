# Comanda — controle de consumo para bares e restaurantes (SaaS)

Cada estabelecimento tem o próprio login, a própria equipe, os próprios preços e as próprias contas de clientes. Cada mesa tem um garçom responsável e cada pedido guarda quem o lançou.

> **Em construção (branch `saas`). Antes de usar com clientes reais:** configure a [cópia de segurança](#cópia-de-segurança) e veja [o que falta](#o-que-falta).

## Como usar

1. O dono da plataforma cria o estabelecimento em `/plataforma` e entrega login, senha e PIN.
2. O estabelecimento entra em `/` no tablet ou celular. Em **Gerência** (cadeado, com o PIN), cadastra a equipe, os produtos e os preços.
3. Quem for atender escolhe o próprio nome em **Atendendo**, no topo. A escolha fica no aparelho até trocarem.
4. **Novo cliente** abre a conta, com mesa, CPF (opcional) e garçom responsável. O responsável pode ser trocado em **Editar**.
5. **+ Consumo** lança o pedido no nome de quem está atendendo. **+** lança mais um; **−** cancela uma unidade do pedido mais recente.
6. **Encerrar** mostra a conta e pede a forma de pagamento. As encerradas ficam em **Concluídos** por 24 horas e podem ser reabertas.

Os aparelhos se atualizam sozinhos a cada 4 segundos. O sistema precisa de internet: sem resposta do servidor, aparece uma faixa vermelha e **nada novo é salvo**; o pedido que falhou continua na janela para tentar de novo.

## Acessos

| Quem | Como entra | O que faz |
|---|---|---|
| Dono da plataforma | `/plataforma`, com a senha definida no servidor | Cria, suspende e reativa estabelecimentos; gera nova senha ou PIN |
| Estabelecimento (todos os aparelhos) | Login e senha do estabelecimento | Abre contas, lança e cancela pedidos, encerra e reabre |
| Gerente | PIN de 6 números, além do login | Equipe, produtos e preços, histórico de faturamento, troca de senha e PIN |

- Ao criar um estabelecimento, a senha e o PIN aparecem **uma única vez**. O banco guarda só o hash: ninguém consegue ver, apenas gerar outro.
- A sessão do estabelecimento dura 30 dias. Trocar a senha desconecta todos os aparelhos. Suspender corta o acesso na hora.
- A liberação do PIN dura 15 minutos.
- Erros de senha e de PIN são limitados a cada 10 minutos. O PIN bloqueia depois de 5 erros. Quem souber o login de um estabelecimento consegue, errando de propósito de vários lugares, bloquear **novas entradas** nele por 10 minutos (aparelhos já conectados continuam).
- O login é de toda a equipe, então o garçom é **escolhido** no aparelho, sem senha própria.

## Relatórios (gerência)

Em **Gerência → Relatórios**, com o PIN: métricas e planilha do Excel de **Hoje, 24 horas, 7 dias, 30 dias ou 12 meses**. A tela se atualiza a cada minuto. Quando a liberação do PIN vence (15 minutos), o relatório fecha e o PIN é pedido de novo.

O quadro **Por garçom** separa duas contas:

| Colunas | Para quem vai | O que entra |
|---|---|---|
| Mesas pagas, faturamento, ticket médio | Garçom **responsável** quando a conta foi encerrada | Contas pagas no período. A soma é o faturamento total |
| Itens lançados, valor lançado | Quem **lançou** cada pedido | Pedidos feitos no período, mesmo em contas abertas. **Não é dinheiro recebido**: usa o preço pago ou, em conta aberta, o preço atual |

- Se o responsável for trocado, o faturamento inteiro da mesa vai para o último.
- Uma conta paga no período entra no faturamento mesmo que os pedidos sejam de antes dele.
- Cancelamentos não contam como itens. Quem cancelou fica registrado no banco (`eventos`), mas ainda não aparece no relatório.
- **Quem atendeu cada conta** lista o responsável de cada mesa e todos que lançaram pedidos nela.

A planilha tem as abas **Garçons**, **Contas** (responsável, quem lançou, quem encerrou, pagamento), **Pedidos** (data, hora e quem lançou) e **Produtos**, no mesmo período da tela.

## Cópia de segurança

A cópia é feita por um computador seu (não pelo Render, que dorme no plano gratuito). Ela usa o `pg_dump` do PostgreSQL, gera **um arquivo criptografado** com o banco inteiro e testa a restauração num banco temporário. O seu painel mostra quando foi a última e fica vermelho se passar de 36 horas.

A conexão com o Neon é sempre criptografada, com o certificado conferido; a com o Postgres do próprio computador (`localhost`) não usa SSL. Também funciona com o banco da versão anterior, antes de migrar.

O arquivo tem nomes e CPFs. Sem a `BACKUP_SENHA` **ninguém consegue abri-lo, nem você**: guarde a senha fora do computador que faz a cópia.

### Configurar

1. Instale o PostgreSQL no computador, de versão **igual ou mais nova** que a do banco do Neon (o `pg_dump` não copia um servidor mais novo que ele).
2. Copie `backup.env.exemplo` para `backup.env` e preencha.
3. Confira a configuração. Este comando só lê os bancos e não mostra senhas nem endereços:

```powershell
node scripts/backup.js checar
```

4. Faça a primeira cópia e veja se aparece **Conferida**:

```powershell
node scripts/backup.js criar
```

5. Guarde as cópias **fora do computador** também: aponte `BACKUP_PASTA` para uma pasta sincronizada (OneDrive, Google Drive). Só o arquivo criptografado vai para lá.

### Repetir todo dia (Windows)

No **Agendador de Tarefas** → **Criar Tarefa**:

- **Disparadores:** diariamente, num horário em que o computador costuma estar ligado.
- **Ações:** Programa `C:\Program Files\nodejs\node.exe`; Argumentos `scripts\backup.js criar`; **Iniciar em**: a pasta do projeto.
- **Configurações:** marque **Executar a tarefa o mais cedo possível após uma inicialização agendada perdida**.

O resultado de cada execução fica em `backup.log`, na pasta das cópias. Quem avisa se parar de funcionar é o painel: **olhe o aviso quando entrar nele**.

### Conferir um arquivo

```powershell
node scripts/backup.js conferir "CAMINHO-DO-ARQUIVO"
```

### Recuperar depois de uma perda

1. Crie um banco **novo e vazio** (por exemplo, um novo banco no Neon). A ferramenta recusa um destino que já tenha tabelas.
2. Coloque o endereço dele em `DESTINO_URL`, no `backup.env`.
3. Restaure:

```powershell
node scripts/backup.js restaurar "CAMINHO-DO-ARQUIVO"
```

4. No Render, troque `DATABASE_URL` para o banco restaurado. Troque também no `backup.env` e apague o `DESTINO_URL`.
5. Tudo volta ao momento da cópia, **inclusive senhas, PINs e suspensões**. Refaça no painel o que mudou depois (quem foi suspenso e quem trocou de senha por segurança).

O que foi lançado **depois da última cópia se perde**: com uma cópia por dia, pode ser quase um dia de movimento. A restauração é do banco inteiro; não há opção de recuperar um só estabelecimento.

## Variáveis de ambiente

| Nome | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | Banco Postgres (Neon) |
| `SESSION_SECRET` | sim | Assina as sessões (32 caracteres ou mais) |
| `PLATAFORMA_SENHA` | para usar o painel | Senha do dono (12 caracteres ou mais) |
| `PLATAFORMA_LOGIN` | não | Login do dono (padrão `dono`) |
| `PGSSL` | não | `disable` só para um Postgres local |
| `PROXY_SALTOS` | não | Proxies na frente do servidor (padrão: 1 no Render, 0 fora). **Conferir no Render antes de publicar**: o limite de tentativas por aparelho depende disso |
| `PORT`, `HOST` | não | Padrão: `3210` em `127.0.0.1` |

## Rodar no computador

Precisa de Node 18 ou mais recente e de um Postgres. No PowerShell:

```powershell
npm install
$env:DATABASE_URL = "postgresql://usuario:senha@127.0.0.1:5432/comanda"; $env:PGSSL = "disable"
$env:SESSION_SECRET = "troque-por-um-texto-aleatorio-de-32-ou-mais"; $env:PLATAFORMA_SENHA = "escolha-uma-senha-longa"
npm start
```

Depois abra http://localhost:3210/plataforma.

## Testes

Precisam de um Postgres de verdade, do `pg_dump` e do `pg_restore` (no PATH, ou aponte `PG_BIN` para a pasta `bin`). Um simulador não serve para testar gravações simultâneas. Aponte `TEST_DATABASE_URL` para um servidor onde o usuário possa criar bancos; cada arquivo de teste cria um banco vazio e o apaga no final. Use um Postgres só de testes.

```powershell
$env:TEST_DATABASE_URL = "postgresql://usuario:senha@127.0.0.1:5432/postgres"; $env:PGSSL = "disable"; $env:PG_BIN = "C:\Program Files\PostgreSQL\18\bin"
npm test
```

## API

As rotas e o nível de acesso de cada uma estão em `server/rotas.js`.

- Sessão do estabelecimento: `Authorization: Bearer <token>`. Gerência: também `X-Gerencia: <liberação>`.
- Nas ações do dia a dia, `garcomId` diz quem está atendendo.
- Ao criar funcionário, produto, conta, pedido ou cancelamento, o aparelho manda um `id` próprio (ex.: `crypto.randomUUID()`). Reenviar o mesmo `id` não grava duas vezes.
- Para encerrar, o aparelho manda o total que mostrou (`totalEsperadoCentavos`). Se a conta mudou, o servidor recusa.
- `GET /api/dados?revisao=N` responde `semMudancas` quando nada mudou desde a revisão `N`.
- Valores sempre em centavos.

## Dados

Tabelas `estabelecimentos`, `funcionarios`, `produtos`, `comandas`, `pedidos`, `eventos` e `copias` (registro das cópias de segurança), criadas quando o servidor liga. `eventos` registra cancelamentos, encerramentos, reaberturas, exclusões e troca de garçom responsável. Funcionários e produtos são desativados, não apagados.

As tabelas da versão anterior (`app_state`, `accounts`, `backups`) **não são lidas nem alteradas**.

## O que falta

- **Cópia de segurança em uso:** configurar no computador que vai fazê-la, agendar e testar com o banco do Neon (a conexão criptografada com ele ainda não foi testada).
- **Hospedagem paga:** o plano gratuito do Render dorme quando fica sem uso. Conferir também o `PROXY_SALTOS`.
- **Migração** dos dados da versão anterior, se houver dados reais.
- **LGPD:** o sistema guarda CPF. Falta definir, com orientação jurídica, termos de uso, política de privacidade, por quanto tempo guardar os dados e como atender pedidos de exclusão.

## Estrutura

```
render.yaml             publicação no Render
index.html              tela dos estabelecimentos
plataforma.html         painel do dono
sw.js                   desliga o modo sem internet da versão anterior
server/
  server.js             liga o servidor, entrega as telas, confere o acesso
  rotas.js              rotas da API e limites de tentativas
  estabelecimentos.js   login, PIN e ações do dono
  operacao.js           equipe, produtos, contas e pedidos
  db.js                 tabelas e transações
  auth.js               hash, sessão e limite de tentativas
  validar.js            erros e conferência dos dados recebidos
assets/js/
  api.js                sessão e chamadas ao servidor
  store.js              dados na tela, atualização e quem está atendendo
  app.js                contas, pedidos, encerramento e login
  ui.js                 janelas, avisos e cards
  waiter.js             escolha de quem está atendendo
  prices.js             consulta de preços
  manage.js             gerência: equipe, produtos, senha e PIN
  reports.js            relatórios: busca os dados, período e download
  metrics.js            indicadores, gráficos e tabelas
  excel.js              planilha .xlsx
  waiter-stats.js       números por garçom (tela e planilha)
  plataforma.js         painel do dono
  billing.js            preços e total da conta (servidor e tela)
  utils.js, icons.js, theme.js
scripts/
  backup.js             cópia de segurança pela linha de comando
  checar.js             confere a configuração da cópia
  copia.js              criar, conferir, restaurar e limpar
  cripto.js             arquivo criptografado
backup.env.exemplo      modelo da configuração da cópia
tests/                  testes do servidor, relatórios e cópia (npm test)
```
