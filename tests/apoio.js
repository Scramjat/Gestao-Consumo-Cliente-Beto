/* Apoio dos testes: cria um banco vazio no Postgres de TEST_DATABASE_URL,
   sobe o servidor em cima dele e apaga tudo no final. */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool, Client } = require('pg');
const { createApp } = require('../server/server.js');

const SECRET = 'segredo-somente-para-os-testes-0123456789';
const OWNER = { usuario: 'dono', senha: 'senha-do-dono-de-teste' };

async function adminQuery(url, sql) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try { await client.query(sql); } finally { await client.end(); }
}

async function startApp(options = {}) {
  const adminUrl = process.env.TEST_DATABASE_URL;
  assert.ok(adminUrl, 'Defina TEST_DATABASE_URL com um Postgres de testes (veja o README).');

  const database = `comanda_teste_${crypto.randomBytes(6).toString('hex')}`;
  await adminQuery(adminUrl, `CREATE DATABASE ${database}`);
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;

  let app;
  let base;
  async function boot(extra = {}) {
    app = await createApp({
      pool: new Pool({ connectionString: url.href, max: 5 }),
      secret: SECRET, ownerLogin: OWNER.usuario, ownerPassword: OWNER.senha,
      ...options, ...extra
    });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  await boot();

  async function call(method, path, { token, manager, body, raw, headers = {} } = {}) {
    const sent = raw !== undefined ? raw : body && JSON.stringify(body);
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(sent ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(manager ? { 'X-Gerencia': manager } : {}),
        ...headers
      },
      body: sent || undefined
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  /** Faz a chamada, exige sucesso e devolve os dados. */
  async function ok(method, path, options) {
    const r = await call(method, path, options);
    assert.equal(r.status, 200, `${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }

  const ownerToken = async () => (await ok('POST', '/api/plataforma/login', { body: OWNER })).token;

  /** Cria um estabelecimento, entra, libera a gerência e cadastra a equipe. */
  async function newEstablishment(login, names = ['Ana', 'Bruno']) {
    const owner = await ownerToken();
    const created = await ok('POST', '/api/plataforma/estabelecimentos', {
      token: owner, body: { nome: `Bar ${login}`, login }
    });
    const { token } = await ok('POST', '/api/login', { body: { usuario: login, senha: created.senha } });
    const { gerencia } = await ok('POST', '/api/gerencia', { token, body: { pin: created.pin } });
    const auth = { token, manager: gerencia };
    const employees = [];
    for (const nome of names) {
      employees.push((await ok('POST', '/api/funcionarios', { ...auth, body: { id: crypto.randomUUID(), nome } })).funcionario);
    }
    return { id: created.estabelecimento.id, login, senha: created.senha, pin: created.pin, token, auth, employees };
  }

  return {
    call, ok, ownerToken, newEstablishment,
    databaseUrl: url.href,
    query: async (sql, params) => {
      const client = new Client({ connectionString: url.href });
      await client.connect();
      try { return (await client.query(sql, params)).rows; } finally { await client.end(); }
    },
    async restart(extra) {
      await app.close();
      await boot(extra);
    },
    async stop() {
      await app.close();
      await adminQuery(adminUrl, `DROP DATABASE ${database} WITH (FORCE)`);
    }
  };
}

module.exports = { startApp, OWNER, uuid: () => crypto.randomUUID() };
