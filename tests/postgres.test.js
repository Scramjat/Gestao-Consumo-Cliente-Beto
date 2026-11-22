/* Testes da camada Postgres (Neon) com um Postgres simulado em memória (pg-mem).
   Confere as consultas SQL e as contas sem precisar de um banco de verdade. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { createPostgresStorage } = require('../server/storage.js');
const { createAccounts } = require('../server/accounts.js');

let ultimoPool;
function novoBanco() {
  const { Pool } = newDb().adapters.createPg();
  ultimoPool = new Pool();
  return createPostgresStorage({ pool: ultimoPool });
}

const estadoDe = (n) => ({
  version: 3, updatedAt: new Date().toISOString(),
  products: [{ id: 'p1', name: 'Cerveja', price: 10 }],
  clients: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Cliente ${i}`, items: [] }))
});

test('começa vazio e guarda/atualiza os dados', async () => {
  const db = novoBanco();
  await db.init();   // (rodar init duas vezes é seguro no Postgres de verdade; o simulador não suporta)
  assert.equal(await db.getState(), null);
  await db.saveState(estadoDe(1));
  assert.equal((await db.getState()).clients.length, 1);
  await db.saveState(estadoDe(3));
  const salvo = await db.getState();
  assert.equal(salvo.clients.length, 3);
  assert.equal(salvo.products[0].price, 10);
});

test('contas: cria, atualiza e lista', async () => {
  const db = novoBanco();
  await db.init();
  await db.saveAccount({ login: 'ADMIN', role: 'super', passwordHash: 'h1', passwordEnc: 'e1', isDefault: true, tokenVersion: 1, lastLogin: null });
  await db.saveAccount({ login: 'ADMIN', role: 'super', passwordHash: 'h2', passwordEnc: 'e2', isDefault: false, tokenVersion: 2, lastLogin: '2026-11-22T10:00:00.000Z' });
  const contas = await db.listAccounts();
  assert.equal(contas.length, 1);
  assert.deepEqual(
    { ...contas[0], lastLogin: contas[0].lastLogin.slice(0, 10) },
    { login: 'ADMIN', role: 'super', passwordHash: 'h2', passwordEnc: 'e2', isDefault: false, tokenVersion: 2, lastLogin: '2026-11-22' }
  );
});

test('o serviço de contas funciona em cima do Postgres e as senhas sobrevivem a um reinício', async () => {
  const db = novoBanco();
  await db.init();
  const opcoes = { storage: db, secret: 'segredo-sessao', encryptionKey: 'chave-de-cifra' };

  let contas = createAccounts(opcoes);
  await contas.init();
  assert.equal(contas.list({ role: 'super' }).length, 3);

  const admin = await contas.login('admin', 'beto');
  assert.ok(admin);
  const r = await contas.changePassword(admin, 'user', 'atendentes-2026');
  assert.equal(r.status, 200);

  // "reinicia" o servidor: novo serviço, mesmo banco
  contas = createAccounts(opcoes);
  await contas.init();
  assert.equal(await contas.login('user', 'beto'), null);
  const user = await contas.login('user', 'atendentes-2026');
  assert.ok(user);
  assert.equal(contas.reveal({ role: 'admin', login: 'admin' }, 'user').senha, 'atendentes-2026');
  assert.equal(contas.reveal({ role: 'user', login: 'user' }, 'user').status, 403);
});

test('com outra chave de cifra o login continua, mas a senha não aparece', async () => {
  const db = novoBanco();
  await db.init();
  let contas = createAccounts({ storage: db, secret: 's', encryptionKey: 'chave-1' });
  await contas.init();
  contas = createAccounts({ storage: db, secret: 's', encryptionKey: 'chave-2' });
  await contas.init();
  assert.ok(await contas.login('ADMIN', 'beto'));
  assert.equal(contas.reveal({ role: 'super', login: 'ADMIN' }, 'ADMIN').senha, null);
});

test('cópia diária: grava uma por dia, mesmo salvando várias vezes seguidas', async () => {
  const db = novoBanco();
  await db.init();
  await db.saveState(estadoDe(1));
  await db.saveState(estadoDe(2));   // no mesmo minuto não mexe na cópia
  const { rows } = await ultimoPool.query('SELECT day, data FROM backups');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.clients.length, 1, 'a cópia é a do primeiro salvamento do minuto');
});
