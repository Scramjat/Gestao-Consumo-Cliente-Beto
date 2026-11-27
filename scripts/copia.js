/* =========================================================
   Cópia de segurança: criar, conferir e restaurar
   Usa o pg_dump e o pg_restore do próprio PostgreSQL.
   A linha de comando fica em backup.js.
   ========================================================= */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const { Client } = require('pg');
const { encryptToFile, decryptTo, checkFile } = require('./cripto.js');

const MIN_PASSWORD = 12;
const KEEP_NEWEST = 7;
const FILE_NAME = /^comanda-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.backup$/;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

const hostOf = (url) => decodeURIComponent(url.hostname).replace(/^\[|\]$/g, '');

/**
 * Decidido para cada endereço: o banco na internet (Neon) é sempre criptografado
 * e o certificado é conferido; o Postgres deste computador não usa SSL.
 */
const sslDisabled = (url) => process.env.PGSSL === 'disable' || LOCAL_HOSTS.includes(hostOf(url));

/**
 * O endereço (com a senha do banco) vai para o pg_dump por variáveis de
 * ambiente: na linha de comando ele apareceria na lista de processos.
 */
function pgEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  const env = {
    ...process.env,
    PGHOST: hostOf(url),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: sslDisabled(url) ? 'disable' : 'verify-full',
    PGCONNECT_TIMEOUT: '30'
  };
  // Confere o certificado do servidor com os certificados do sistema
  if (!sslDisabled(url)) env.PGSSLROOTCERT = process.env.PGSSLROOTCERT || 'system';
  return env;
}

function client(databaseUrl) {
  const url = new URL(databaseUrl);
  const ssl = sslDisabled(url) ? false : { rejectUnauthorized: true };
  // O que vier no endereço (?sslmode=...) passaria por cima da escolha acima
  ['sslmode', 'sslrootcert', 'channel_binding'].forEach((name) => url.searchParams.delete(name));
  return new Client({ connectionString: url.href, ssl, connectionTimeoutMillis: 30000 });
}

async function withClient(databaseUrl, work) {
  const c = client(databaseUrl);
  await c.connect();
  try { return await work(c); } finally { await c.end(); }
}

/** Roda uma ferramenta do PostgreSQL. `done` só resolve se ela terminar bem. */
function run(tool, args, env, pgBin, stdio) {
  const program = pgBin ? path.join(pgBin, tool) : tool;
  const child = spawn(program, args, { env, stdio, windowsHide: true });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-4000); });
  const done = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT'
      ? `Não encontrei o ${tool}. Instale o PostgreSQL e aponte PG_BIN para a pasta "bin" dele.`
      : e.message)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${tool} falhou: ${errors.trim()}`))));
  });
  return { child, done };
}

function validPassword(password) {
  if (String(password || '').length < MIN_PASSWORD) {
    throw new Error(`BACKUP_SENHA é obrigatória e precisa ter ${MIN_PASSWORD} caracteres ou mais.`);
  }
  return password;
}

const two = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;

/* ---------- Examinar (só leitura) ---------- */

/**
 * Versão, tabelas e permissões de um banco. Com `toolCheck`, confere também se
 * o pg_dump consegue se conectar: ele faz a criptografia por conta própria.
 */
async function inspect(databaseUrl, pgBin, { toolCheck = true } = {}) {
  const info = await withClient(databaseUrl, async (c) => {
    const one = async (sql) => (await c.query(sql)).rows[0];
    const { rows } = await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    return {
      version: Math.floor(Number((await one('SHOW server_version_num')).server_version_num) / 10000),
      tables: rows.map((r) => r.table_name),
      canCreateDatabase: (await one('SELECT rolcreatedb OR rolsuper AS can FROM pg_roles WHERE rolname = current_user')).can
    };
  });
  if (toolCheck) {
    await run('pg_dump', ['--schema-only', '--no-owner', '--no-privileges'],
      pgEnv(databaseUrl), pgBin, ['ignore', 'ignore', 'pipe']).done;
  }
  return info;
}

/* ---------- Criar ---------- */

/** Cria a cópia criptografada. O arquivo só ganha o nome final se tudo der certo. */
async function create({ databaseUrl, password, folder, pgBin, now = new Date() }) {
  validPassword(password);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `comanda-${stamp(now)}.backup`);
  if (fs.existsSync(file)) throw new Error('Já existe uma cópia deste mesmo segundo.');
  const partial = `${file}.${crypto.randomBytes(4).toString('hex')}.parcial`;

  const dump = run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges'],
    pgEnv(databaseUrl), pgBin, ['ignore', 'pipe', 'pipe']);
  const output = new PassThrough();
  dump.child.stdout?.pipe(output);
  try {
    const written = encryptToFile(output, partial, password);
    // Se o pg_dump nem começar, a gravação precisa ser encerrada junto
    dump.done.catch((e) => output.destroy(e));
    await Promise.all([dump.done, written]);
    fs.renameSync(partial, file);
  } catch (e) {
    dump.child.kill();
    // O erro do pg_dump explica melhor que o da gravação
    const cause = await dump.done.then(() => e, (dumpError) => dumpError);
    fs.rmSync(partial, { force: true });
    throw cause;
  }
  return { file, bytes: fs.statSync(file).size };
}

/* ---------- Restaurar ---------- */

/** Só restaura num banco vazio, para nunca passar por cima de dados que existem. */
async function assertEmpty(databaseUrl) {
  const { rows } = await withClient(databaseUrl, (c) => c.query(
    `SELECT count(*)::int AS total FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`
  ));
  if (rows[0].total) {
    throw new Error('O banco de destino não está vazio. Restaure num banco novo, sem nenhuma tabela.');
  }
}

async function restore({ file, password, databaseUrl, pgBin }) {
  validPassword(password);
  // Primeiro confere o arquivo inteiro: nada chega ao banco se ele foi alterado
  await checkFile(file, password);
  await assertEmpty(databaseUrl);

  const env = pgEnv(databaseUrl);
  const tool = run('pg_restore',
    ['--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', `--dbname=${env.PGDATABASE}`],
    env, pgBin, ['pipe', 'ignore', 'pipe']);
  const input = tool.child.stdin;
  // Se o pg_restore falhar, ele fecha a entrada; o motivo vem em tool.done
  const sent = input ? decryptTo(file, password, input).catch((e) => e) : null;
  await tool.done;
  const sendError = await sent;
  if (sendError) throw sendError;
  return counts(databaseUrl);
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Quantas linhas há em cada tabela. Vale para qualquer versão do sistema,
 * inclusive o banco da versão anterior. Que a cópia voltou inteira, quem
 * garante é o pg_restore, que desfaz tudo no primeiro erro.
 */
function counts(databaseUrl) {
  return withClient(databaseUrl, async (c) => {
    const { rows } = await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    if (!rows.length) throw new Error('A cópia não tem nenhuma tabela. Confira se DATABASE_URL aponta para o banco certo.');
    const result = {};
    for (const { table_name: table } of rows) {
      result[table] = (await c.query(`SELECT count(*)::int AS total FROM public.${quote(table)}`)).rows[0].total;
    }
    return result;
  });
}

/* ---------- Conferir ---------- */

/**
 * Restaura num banco temporário (que é apagado em seguida). É a única forma
 * de saber que a cópia realmente volta.
 * `adminUrl`: um Postgres de testes onde o usuário possa criar bancos.
 */
async function verify({ file, password, adminUrl, pgBin }) {
  const name = `comanda_conferencia_${crypto.randomBytes(6).toString('hex')}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await withClient(adminUrl, (c) => c.query(`CREATE DATABASE ${name} TEMPLATE template0`));
  try {
    return await restore({ file, password, databaseUrl: url.href, pgBin });
  } finally {
    await withClient(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  }
}

/* ---------- Registro e limpeza ---------- */

/** Anota a cópia no banco, para o painel do dono mostrar quando foi a última. */
function register(databaseUrl, { bytes, verified }) {
  return withClient(databaseUrl, (c) => c.query(
    'INSERT INTO copias (id, tamanho, conferida) VALUES ($1, $2, $3)', [crypto.randomUUID(), bytes, verified]
  ));
}

/**
 * Apaga cópias antigas. Só mexe em arquivos com o nome que a ferramenta dá, e
 * sempre guarda as mais novas, mesmo que estejam vencidas.
 */
function prune({ folder, days, now = new Date() }) {
  const copies = fs.readdirSync(folder)
    .map((name) => ({ name, match: name.match(FILE_NAME) }))
    .filter((f) => f.match)
    .map(({ name, match }) => {
      const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
      return { name, at: new Date(y, mo - 1, d, h, mi, s).getTime() };
    })
    .sort((a, b) => b.at - a.at);
  const cutoff = now.getTime() - days * 86400000;
  const removed = copies.slice(KEEP_NEWEST).filter((f) => f.at < cutoff);
  removed.forEach((f) => fs.rmSync(path.join(folder, f.name)));
  return removed.map((f) => f.name);
}

module.exports = { create, restore, verify, register, prune, inspect, pgEnv, MIN_PASSWORD };
