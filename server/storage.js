/* =========================================================
   Onde os dados ficam guardados
   - Postgres (Neon): quando existe DATABASE_URL. É o modo permanente
     para a internet: os dados sobrevivem a reinícios e publicações.
   - Arquivo: no computador e em testes (pasta BD/Comanda, com as notas
     do Obsidian). No Render gratuito o disco é apagado a cada reinício.

   Os dois modos têm a mesma interface:
     init, getState, saveState, listAccounts, saveAccount, secret
   ========================================================= */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const Markdown = require('../assets/js/markdown.js');

const BACKUP_DAYS = 30;
const BACKUP_EVERY_MS = 60 * 1000;

/** Grava num arquivo temporário e troca pelo definitivo, para nunca deixar um arquivo pela metade. */
async function writeAtomic(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  try {
    await fsp.rename(tmp, file);
  } catch {
    // No Windows o Obsidian às vezes segura o arquivo por um instante; tenta de novo
    await new Promise((r) => setTimeout(r, 150));
    await fsp.rename(tmp, file);
  }
}

/* ---------------------------------------------------------
   Modo arquivo
   --------------------------------------------------------- */
function createFileStorage({ dataDir }) {
  const DAYS_DIR = path.join(dataDir, 'Dias');
  const BACKUP_DIR = path.join(dataDir, 'backup');
  const DATA_FILE = path.join(dataDir, 'dados.json');
  const ACCOUNTS_FILE = path.join(dataDir, 'contas.json');
  const SECRET_FILE = path.join(dataDir, '.segredo');

  // Conteúdo já gravado de cada nota: só regrava o que mudou
  const written = new Map();
  const writeIfChanged = async (file, content) => {
    if (written.get(file) === content) return;
    await writeAtomic(file, content);
    written.set(file, content);
  };

  // Uma gravação por vez, para nunca misturar duas versões
  let saving = Promise.resolve();

  const readJson = async (file) => {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };

  return {
    name: 'arquivo',
    location: dataDir,

    async init() {
      await fsp.mkdir(DAYS_DIR, { recursive: true });
      await fsp.mkdir(BACKUP_DIR, { recursive: true });
    },

    getState: () => readJson(DATA_FILE),

    saveState(state) {
      saving = saving.catch(() => {}).then(async () => {
        const json = JSON.stringify(state, null, 2);
        const today = Markdown.dayKey(new Date().toISOString());
        await writeAtomic(DATA_FILE, json);
        // Cópia de segurança diária: guarda como os dados estavam em cada dia
        await writeAtomic(path.join(BACKUP_DIR, `dados ${today}.json`), json);
        await writeIfChanged(path.join(dataDir, 'Contas abertas.md'), Markdown.openAccountsNote(state));
        const notes = Markdown.dayNotes(state);
        // Dias que ficaram sem nenhum registro (ex.: cliente excluído) também são atualizados
        for (const file of written.keys()) {
          const day = path.basename(file, '.md');
          if (path.dirname(file) === DAYS_DIR && !notes[day]) notes[day] = Markdown.singleDayNote(state, day);
        }
        for (const [day, content] of Object.entries(notes)) {
          await writeIfChanged(path.join(DAYS_DIR, `${day}.md`), content);
        }
      });
      return saving;
    },

    async listAccounts() {
      return (await readJson(ACCOUNTS_FILE)) || [];
    },

    async saveAccount(account) {
      const all = await this.listAccounts();
      const i = all.findIndex((a) => a.login === account.login);
      if (i >= 0) all[i] = account; else all.push(account);
      await writeAtomic(ACCOUNTS_FILE, JSON.stringify(all, null, 2));
    },

    /** Chave local gerada uma vez (só para uso no computador / testes). */
    async secret() {
      try {
        return (await fsp.readFile(SECRET_FILE, 'utf8')).trim();
      } catch {
        const key = crypto.randomBytes(32).toString('hex');
        await writeAtomic(SECRET_FILE, key);
        return key;
      }
    },

    async close() { await saving.catch(() => {}); }
  };
}

/* ---------------------------------------------------------
   Modo Postgres (Neon)
   --------------------------------------------------------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_state (
     id integer PRIMARY KEY,
     data jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS accounts (
     login text PRIMARY KEY,
     role text NOT NULL,
     password_hash text NOT NULL,
     password_enc text,
     is_default boolean NOT NULL DEFAULT true,
     token_version integer NOT NULL DEFAULT 1,
     last_login timestamptz,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS backups (
     day date PRIMARY KEY,
     data jsonb NOT NULL,
     saved_at timestamptz NOT NULL DEFAULT now()
   )`
];

function createPostgresStorage({ pool, log = () => {} }) {
  pool.on('error', (e) => log(`Banco: conexão ociosa caiu (${e.message})`));

  // O Neon "dorme" quando fica parado: a primeira conexão depois disso pode falhar uma vez
  const retriable = (e) => /terminat|ECONNRESET|ETIMEDOUT|EPIPE|57P01|08006|08003/i.test(`${e.code} ${e.message}`);
  async function query(text, params) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      if (!retriable(e)) throw e;
      await new Promise((r) => setTimeout(r, 1200));
      return pool.query(text, params);
    }
  }

  const toAccount = (r) => ({
    login: r.login,
    role: r.role,
    passwordHash: r.password_hash,
    passwordEnc: r.password_enc,
    isDefault: r.is_default,
    tokenVersion: r.token_version,
    lastLogin: r.last_login ? new Date(r.last_login).toISOString() : null
  });

  let lastBackupAt = 0;

  return {
    name: 'postgres',
    location: 'Neon (Postgres)',

    async init() {
      for (const sql of SCHEMA) await query(sql);
    },

    async getState() {
      const { rows } = await query('SELECT data FROM app_state WHERE id = 1');
      if (!rows.length) return null;
      const data = rows[0].data;
      return typeof data === 'string' ? JSON.parse(data) : data;
    },

    async saveState(state) {
      const json = JSON.stringify(state);
      await query(
        `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [json]
      );
      // Cópia diária (no máximo uma por minuto), guardando os últimos 30 dias
      const now = Date.now();
      if (now - lastBackupAt >= BACKUP_EVERY_MS) {
        lastBackupAt = now;
        const day = Markdown.dayKey(new Date(now).toISOString());
        const cutoff = Markdown.dayKey(new Date(now - BACKUP_DAYS * 86400000).toISOString());
        await query(
          `INSERT INTO backups (day, data, saved_at) VALUES ($1::date, $2::jsonb, now())
           ON CONFLICT (day) DO UPDATE SET data = EXCLUDED.data, saved_at = now()`,
          [day, json]
        );
        await query('DELETE FROM backups WHERE day < $1::date', [cutoff]);
      }
    },

    async listAccounts() {
      const { rows } = await query(
        'SELECT login, role, password_hash, password_enc, is_default, token_version, last_login FROM accounts'
      );
      return rows.map(toAccount);
    },

    async saveAccount(a) {
      await query(
        `INSERT INTO accounts (login, role, password_hash, password_enc, is_default, token_version, last_login, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (login) DO UPDATE SET
           role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, password_enc = EXCLUDED.password_enc,
           is_default = EXCLUDED.is_default, token_version = EXCLUDED.token_version,
           last_login = EXCLUDED.last_login, updated_at = now()`,
        [a.login, a.role, a.passwordHash, a.passwordEnc, a.isDefault, a.tokenVersion, a.lastLogin || null]
      );
    },

    /** No Postgres a chave vem sempre do ambiente (nunca fica ao lado dos dados). */
    async secret() { return null; },

    async close() { await pool.end(); }
  };
}

/**
 * Escolhe o modo: com DATABASE_URL usa o Postgres; sem ela, usa arquivos.
 * `PGSSL=disable` desliga o SSL (só para um Postgres local).
 */
function createStorage({ databaseUrl, dataDir, log }) {
  if (databaseUrl) {
    const { Pool } = require('pg');
    const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true };
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 20000
    });
    return createPostgresStorage({ pool, log });
  }
  return createFileStorage({ dataDir });
}

module.exports = { createStorage, createFileStorage, createPostgresStorage, writeAtomic };
