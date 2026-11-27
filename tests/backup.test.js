/* Cópia de segurança: o que sai tem de voltar igual, e as falhas não podem
   deixar arquivo pela metade nem mexer em banco com dados.
   Precisa do pg_dump e pg_restore (PATH ou PG_BIN). */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { Client, Pool } = require('pg');
const copy = require('../scripts/copia.js');
const { check } = require('../scripts/checar.js');
const { createApp } = require('../server/server.js');
const { startApp, uuid } = require('./apoio.js');

process.env.PGSSL = 'disable';
const PASSWORD = 'senha-de-backup-so-para-testes';
const pgBin = process.env.PG_BIN || '';
const adminUrl = process.env.TEST_DATABASE_URL;
const TABLES = ['estabelecimentos', 'funcionarios', 'produtos', 'comandas', 'pedidos', 'eventos', 'copias'];

let app;
let bar;
let folder;
let made;
const created = [];

async function sql(url, text, params) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try { return (await client.query(text, params)).rows; } finally { await client.end(); }
}

async function emptyDatabase() {
  const name = `comanda_destino_${crypto.randomBytes(6).toString('hex')}`;
  await sql(adminUrl, `CREATE DATABASE ${name} TEMPLATE template0`);
  created.push(name);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.href;
}

/** Todas as linhas de todas as tabelas, para comparar dois bancos. */
async function dumpRows(url) {
  const all = {};
  for (const table of TABLES) {
    all[table] = (await sql(url, `SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY 1`)).map((r) => r.row);
  }
  return all;
}

const tableCount = async (url) => (await sql(
  url, `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
))[0].n;

before(async () => {
  app = await startApp();
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-copia-'));
  bar = await app.newEstablishment('bar-copia', ['José d\'Ávila', 'Zoë 🍺']);
  const [first, second] = bar.employees;
  await app.ok('POST', '/api/produtos', { ...bar.auth, body: { id: uuid(), nome: 'Porção "especial"', precoCentavos: 2850 } });
  const tabId = uuid();
  const staff = (url, body) => app.ok('POST', url, { token: bar.token, body });
  await staff('/api/comandas', { id: tabId, garcomId: first.id, cliente: 'João\nda Silva', mesa: '7', cpf: '529.982.247-25' });
  await staff(`/api/comandas/${tabId}/pedidos`, { id: uuid(), garcomId: second.id, produto: 'Porção "especial"', quantidade: 3 });
  await staff(`/api/comandas/${tabId}/encerrar`, { garcomId: first.id, forma: 'pix', totalEsperadoCentavos: 8550 });
  made = await copy.create({ databaseUrl: app.databaseUrl, password: PASSWORD, folder, pgBin });
});

after(async () => {
  for (const name of created) await sql(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await app?.stop();
  if (folder) fs.rmSync(folder, { recursive: true, force: true });
});

test('o arquivo é criptografado: nada legível dentro dele', () => {
  const bytes = fs.readFileSync(made.file);
  assert.equal(bytes.subarray(0, 8).toString(), 'COMBKP01');
  const text = bytes.toString('latin1');
  for (const secret of ['bar-copia', '52998224725', 'estabelecimentos', 'PGDMP', 'scrypt$']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.deepEqual(fs.readdirSync(folder), [path.basename(made.file)]);
});

test('restaura tudo igual, e o sistema funciona em cima do banco restaurado', async () => {
  const original = await dumpRows(app.databaseUrl);
  const target = await emptyDatabase();
  const counts = await copy.restore({ file: made.file, password: PASSWORD, databaseUrl: target, pgBin });
  assert.deepEqual(counts, { comandas: 1, copias: 0, estabelecimentos: 1, eventos: 1, funcionarios: 2, pedidos: 1, produtos: 1 });
  assert.deepEqual(await dumpRows(target), original);

  const restored = await createApp({ pool: new Pool({ connectionString: target }), secret: 'x'.repeat(40) });
  await new Promise((resolve) => restored.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${restored.server.address().port}`;
    const login = await (await fetch(`${base}/api/login`, {
      method: 'POST', body: JSON.stringify({ usuario: bar.login, senha: bar.senha })
    })).json();
    const data = await (await fetch(`${base}/api/dados`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
    assert.equal(data.comandas[0].pagamento.totalCentavos, 8550);
    assert.deepEqual(data.funcionarios.map((f) => f.nome).sort(), ['José d\'Ávila', 'Zoë 🍺'].sort());
  } finally {
    await restored.close();
  }
  // As proteções do banco voltam junto
  await assert.rejects(
    sql(target, `UPDATE pedidos SET cancelada = quantidade + 1`), { code: '23514' }
  );
});

test('conferir restaura num banco temporário e o apaga depois', async () => {
  const databases = async () => (await sql(adminUrl, `SELECT datname FROM pg_database WHERE datname LIKE 'comanda_conferencia_%'`)).length;
  const counts = await copy.verify({ file: made.file, password: PASSWORD, adminUrl, pgBin });
  assert.equal(counts.pedidos, 1);
  assert.equal(await databases(), 0);
  await assert.rejects(copy.verify({ file: made.file, password: 'outra-senha-bem-longa', adminUrl, pgBin }), /Senha de backup errada/);
  assert.equal(await databases(), 0);
});

test('nunca restaura por cima de um banco com tabelas', async () => {
  const before_ = await dumpRows(app.databaseUrl);
  await assert.rejects(
    copy.restore({ file: made.file, password: PASSWORD, databaseUrl: app.databaseUrl, pgBin }), /não está vazio/
  );
  assert.deepEqual(await dumpRows(app.databaseUrl), before_);

  const other = await emptyDatabase();
  await sql(other, 'CREATE SCHEMA outro; CREATE TABLE outro.coisa (x int)');
  await assert.rejects(copy.restore({ file: made.file, password: PASSWORD, databaseUrl: other, pgBin }), /não está vazio/);
});

test('senha errada, arquivo alterado, cortado ou estranho: nada chega ao banco', async () => {
  const target = await emptyDatabase();
  const original = fs.readFileSync(made.file);
  const broken = (name, bytes) => {
    const file = path.join(folder, name);
    fs.writeFileSync(file, bytes);
    return file;
  };
  const flip = (position) => {
    const bytes = Buffer.from(original);
    bytes[position] ^= 1;
    return bytes;
  };
  const cases = [
    [made.file, 'senha-errada-mas-longa'],
    [broken('meio.bin', flip(Math.floor(original.length / 2))), PASSWORD],
    [broken('fim.bin', flip(original.length - 1)), PASSWORD],
    [broken('cabecalho.bin', flip(12)), PASSWORD],
    [broken('cortado.bin', original.subarray(0, original.length - 100)), PASSWORD],
    [broken('curto.bin', original.subarray(0, 20)), PASSWORD],
    [broken('estranho.bin', Buffer.alloc(500, 7)), PASSWORD]
  ];
  for (const [file, password] of cases) {
    await assert.rejects(copy.restore({ file, password, databaseUrl: target, pgBin }), /cópia|alterado/, path.basename(file));
    assert.equal(await tableCount(target), 0, path.basename(file));
  }
  cases.slice(1).forEach(([file]) => fs.rmSync(file));
});

test('se a cópia falhar, não sobra arquivo', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-falha-'));
  const missing = new URL(adminUrl);
  missing.pathname = '/banco_que_nao_existe';
  try {
    await assert.rejects(copy.create({ databaseUrl: missing.href, password: PASSWORD, folder: empty, pgBin }), /pg_dump falhou/);
    await assert.rejects(copy.create({ databaseUrl: app.databaseUrl, password: PASSWORD, folder: empty, pgBin: empty }), /Não encontrei o pg_dump/);
    await assert.rejects(copy.create({ databaseUrl: app.databaseUrl, password: 'curta', folder: empty, pgBin }), /BACKUP_SENHA/);
    assert.deepEqual(fs.readdirSync(empty), []);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('a limpeza guarda as 7 mais novas e não toca em outros arquivos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-limpeza-'));
  const touch = (name) => fs.writeFileSync(path.join(dir, name), 'x');
  const names = Array.from({ length: 10 }, (_, i) => `comanda-202601${String(i + 1).padStart(2, '0')}-030000.backup`);
  const others = ['backup.log', 'foto.jpg', 'comanda-manual.backup', 'comanda-20250101-030000.backup.antigo'];
  [...names, ...others].forEach(touch);
  try {
    // Todas vencidas: ainda assim ficam as 7 mais novas
    const removed = copy.prune({ folder: dir, days: 30, now: new Date(2026, 11, 1) });
    assert.deepEqual(removed.sort(), names.slice(0, 3));
    assert.deepEqual(fs.readdirSync(dir).sort(), [...names.slice(3), ...others].sort());
    // Dentro do prazo: nada é apagado
    assert.deepEqual(copy.prune({ folder: dir, days: 30, now: new Date(2026, 0, 11) }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('o painel do dono mostra a última cópia', async () => {
  const token = await app.ownerToken();
  const read = async () => (await app.ok('GET', '/api/plataforma/estabelecimentos', { token })).ultimaCopia;
  assert.equal(await read(), null);
  await copy.register(app.databaseUrl, { bytes: 10, verified: false });
  await copy.register(app.databaseUrl, { bytes: made.bytes, verified: true });
  const last = await read();
  assert.equal(last.conferida, true);
  assert.ok(Date.now() - Date.parse(last.criadaEm) < 60000);
});

test('o comando cria, confere, registra e falha com código de erro', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-comando-'));
  const run = (args, extra) => new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, '..', 'scripts', 'backup.js'), ...args], {
      env: {
        ...process.env, PG_BIN: pgBin, BACKUP_SENHA: PASSWORD, BACKUP_PASTA: dir,
        DATABASE_URL: app.databaseUrl, VERIFICAR_URL: adminUrl, DESTINO_URL: '', ...extra
      }
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, text: stdout + stderr }));
  });
  try {
    const good = await run(['criar']);
    assert.equal(good.code, 0, good.text);
    assert.match(good.text, /Conferida/);
    const file = path.join(dir, fs.readdirSync(dir).find((n) => n.endsWith('.backup')));

    // Restaurar exige DESTINO_URL: o banco de uso (DATABASE_URL) nunca é alvo
    const noTarget = await run(['restaurar', file]);
    assert.equal(noTarget.code, 1);
    assert.match(noTarget.text, /DESTINO_URL/);

    const bad = await run(['criar'], { DATABASE_URL: 'postgresql://ninguem:segredo-do-banco@127.0.0.1:1/nada' });
    assert.equal(bad.code, 1);
    const log = fs.readFileSync(path.join(dir, 'backup.log'), 'utf8');
    assert.match(log, /FALHOU/);
    for (const secret of [PASSWORD, 'segredo-do-banco']) assert.ok(!(log + bad.text).includes(secret), secret);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('copia e confere um banco de outra versão (o da versão anterior)', async () => {
  const old = await emptyDatabase();
  await sql(old, `CREATE TABLE app_state (id int PRIMARY KEY, data jsonb NOT NULL);
                  CREATE TABLE "Tabela Estranha" (x int);
                  INSERT INTO app_state VALUES (1, '{"clients": [{"name": "Beto"}]}')`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-antigo-'));
  try {
    const legacy = await copy.create({ databaseUrl: old, password: PASSWORD, folder: dir, pgBin });
    assert.deepEqual(await copy.verify({ file: legacy.file, password: PASSWORD, adminUrl, pgBin }),
      { 'Tabela Estranha': 0, app_state: 1 });

    // Banco sem nada: provavelmente o endereço está errado, então a conferência acusa
    const nothing = await copy.create({
      databaseUrl: await emptyDatabase(), password: PASSWORD, folder: dir, pgBin, now: new Date(2026, 0, 1)
    });
    await assert.rejects(copy.verify({ file: nothing.file, password: PASSWORD, adminUrl, pgBin }), /nenhuma tabela/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('o banco na internet é sempre criptografado; o deste computador, não', () => {
  const saved = process.env.PGSSL;
  delete process.env.PGSSL;
  try {
    const remote = copy.pgEnv('postgresql://u:p%40ss@ep-exemplo.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
    assert.deepEqual([remote.PGSSLMODE, remote.PGSSLROOTCERT, remote.PGPASSWORD, remote.PGDATABASE], ['verify-full', 'system', 'p@ss', 'neondb']);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      assert.equal(copy.pgEnv(`postgresql://u:p@${host}:5432/postgres`).PGSSLMODE, 'disable', host);
    }
    assert.equal(copy.pgEnv('postgresql://u:p@localhost.exemplo.com/x').PGSSLMODE, 'verify-full');
  } finally {
    if (saved !== undefined) process.env.PGSSL = saved;
  }
});

test('checar mostra o que falta sem revelar senhas nem endereços', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-checar-'));
  const run = async (env) => {
    const lines = [];
    const ready = await check({ env, folder: dir, print: (line) => lines.push(line) });
    return { ready, text: lines.join('\n') };
  };
  const good = { BACKUP_SENHA: PASSWORD, PG_BIN: pgBin, PGSSL: 'disable', DATABASE_URL: app.databaseUrl, VERIFICAR_URL: adminUrl };
  try {
    const ok = await run(good);
    assert.equal(ok.ready, true, ok.text);
    assert.match(ok.text, /tabelas: comandas, copias/);
    assert.deepEqual(fs.readdirSync(dir), []);

    const empty = await run({});
    assert.equal(empty.ready, false);
    assert.match(empty.text, /DATABASE_URL está vazio/);
    assert.match(empty.text, /VERIFICAR_URL está vazio/);

    const wrong = await run({
      ...good,
      DATABASE_URL: 'postgresql://usuario-secreto:senha-secreta-123@127.0.0.1:1/banco',
      VERIFICAR_URL: 'postgresql://x:y@ep-nome-secreto-pooler.invalid/banco'
    });
    assert.equal(wrong.ready, false);
    for (const secret of [PASSWORD, 'senha-secreta-123', 'usuario-secreto', 'ep-nome-secreto']) {
      assert.ok(!wrong.text.includes(secret), `${secret} apareceu:\n${wrong.text}`);
    }
    const pooled = await run({ ...good, DATABASE_URL: 'postgresql://u:p@ep-abc-pooler.exemplo.invalid/banco' });
    assert.match(pooled.text, /Connection pooling/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
