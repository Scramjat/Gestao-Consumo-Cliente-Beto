/* =========================================================
   Banco de dados (Postgres)
   Cada linha pertence a um estabelecimento. As chaves compostas
   (estabelecimento_id, id) fazem o próprio banco recusar qualquer
   ligação entre dados de estabelecimentos diferentes.

   Dinheiro é sempre guardado em centavos (inteiro).
   ========================================================= */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS estabelecimentos (
     id text PRIMARY KEY,
     nome text NOT NULL,
     login text NOT NULL UNIQUE,
     senha_hash text NOT NULL,
     pin_hash text NOT NULL,
     ativo boolean NOT NULL DEFAULT true,
     versao_sessao integer NOT NULL DEFAULT 1,
     versao_pin integer NOT NULL DEFAULT 1,
     revisao bigint NOT NULL DEFAULT 0,
     criado_em timestamptz NOT NULL DEFAULT now(),
     ultimo_acesso timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS funcionarios (
     estabelecimento_id text NOT NULL REFERENCES estabelecimentos (id),
     id text NOT NULL,
     nome text NOT NULL,
     nome_chave text NOT NULL,
     ativo boolean NOT NULL DEFAULT true,
     criado_em timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (estabelecimento_id, id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_nome_ativo
     ON funcionarios (estabelecimento_id, nome_chave) WHERE ativo`,
  `CREATE TABLE IF NOT EXISTS produtos (
     estabelecimento_id text NOT NULL REFERENCES estabelecimentos (id),
     id text NOT NULL,
     nome text NOT NULL,
     nome_chave text NOT NULL,
     preco_centavos integer NOT NULL CHECK (preco_centavos >= 0),
     ativo boolean NOT NULL DEFAULT true,
     PRIMARY KEY (estabelecimento_id, id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS produtos_nome_ativo
     ON produtos (estabelecimento_id, nome_chave) WHERE ativo`,
  `CREATE TABLE IF NOT EXISTS comandas (
     estabelecimento_id text NOT NULL REFERENCES estabelecimentos (id),
     id text NOT NULL,
     cliente text NOT NULL,
     cpf text NOT NULL DEFAULT '',
     mesa text NOT NULL DEFAULT '',
     garcom_id text NOT NULL,
     aberta_por text NOT NULL,
     criada_em timestamptz NOT NULL DEFAULT now(),
     encerrada_em timestamptz,
     encerrada_por text,
     pagamento jsonb,
     PRIMARY KEY (estabelecimento_id, id),
     FOREIGN KEY (estabelecimento_id, garcom_id) REFERENCES funcionarios (estabelecimento_id, id),
     FOREIGN KEY (estabelecimento_id, aberta_por) REFERENCES funcionarios (estabelecimento_id, id),
     FOREIGN KEY (estabelecimento_id, encerrada_por) REFERENCES funcionarios (estabelecimento_id, id)
   )`,
  `CREATE INDEX IF NOT EXISTS comandas_encerradas ON comandas (estabelecimento_id, encerrada_em)`,
  `CREATE TABLE IF NOT EXISTS pedidos (
     estabelecimento_id text NOT NULL,
     id text NOT NULL,
     comanda_id text NOT NULL,
     produto text NOT NULL,
     produto_chave text NOT NULL,
     quantidade integer NOT NULL CHECK (quantidade > 0),
     cancelada integer NOT NULL DEFAULT 0 CHECK (cancelada >= 0 AND cancelada <= quantidade),
     garcom_id text NOT NULL,
     criado_em timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (estabelecimento_id, id),
     FOREIGN KEY (estabelecimento_id, comanda_id) REFERENCES comandas (estabelecimento_id, id) ON DELETE CASCADE,
     FOREIGN KEY (estabelecimento_id, garcom_id) REFERENCES funcionarios (estabelecimento_id, id)
   )`,
  `CREATE INDEX IF NOT EXISTS pedidos_comanda ON pedidos (estabelecimento_id, comanda_id)`,
  // Histórico do que desfaz ou apaga algo (cancelar, encerrar, reabrir, excluir, trocar garçom)
  `CREATE TABLE IF NOT EXISTS eventos (
     estabelecimento_id text NOT NULL REFERENCES estabelecimentos (id),
     id text NOT NULL,
     tipo text NOT NULL,
     comanda_id text,
     garcom_id text,
     detalhes jsonb,
     criado_em timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (estabelecimento_id, id)
   )`,
  // Anotada pela ferramenta de cópia de segurança (scripts/backup.js)
  `CREATE TABLE IF NOT EXISTS copias (
     id text PRIMARY KEY,
     criada_em timestamptz NOT NULL DEFAULT now(),
     tamanho bigint NOT NULL,
     conferida boolean NOT NULL
   )`
];

// O Neon "dorme" quando fica parado: a primeira conexão depois disso pode falhar uma vez
const retriable = (e) => /terminat|ECONNRESET|ETIMEDOUT|EPIPE|57P01|08006|08003/i.test(`${e.code} ${e.message}`);

function createDb({ pool, log = () => {} }) {
  pool.on('error', (e) => log(`Banco: conexão ociosa caiu (${e.message})`));

  /** Abre uma conexão e começa a transação. Só o começo é repetido: nada foi gravado ainda. */
  async function begin(mode) {
    for (let attempt = 1; ; attempt++) {
      let client;
      try {
        client = await pool.connect();
        await client.query(`BEGIN ${mode}`);
        return client;
      } catch (e) {
        if (client) client.release(e);
        if (attempt > 1 || !retriable(e)) throw e;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }

  async function run(mode, work) {
    const client = await begin(mode);
    let broken;
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError; }
      throw e;
    } finally {
      client.release(broken);
    }
  }

  return {
    /** Várias gravações que valem todas ou nenhuma. */
    tx: (work) => run('ISOLATION LEVEL READ COMMITTED', work),
    /** Várias leituras que enxergam o banco num mesmo instante. */
    snapshot: (work) => run('ISOLATION LEVEL REPEATABLE READ READ ONLY', work),

    async query(text, params) {
      return run('', (c) => c.query(text, params));
    },

    async init() {
      await run('', async (c) => {
        // Impede que dois servidores criem as tabelas ao mesmo tempo
        await c.query('SELECT pg_advisory_xact_lock(727001)');
        for (const sql of SCHEMA) await c.query(sql);
      });
    },

    close: () => pool.end()
  };
}

/** `PGSSL=disable` desliga o SSL (só para um Postgres local). */
function createPool(databaseUrl) {
  const { Pool } = require('pg');
  const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true };
  return new Pool({
    connectionString: databaseUrl,
    ssl,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 20000
  });
}

module.exports = { createDb, createPool };
