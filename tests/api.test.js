/* Testes do servidor: login, permissões das 3 contas, painel de senhas.
   Rodam com:  npm test   (sobem um servidor de verdade numa pasta temporária) */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-teste-'));
let PORT = 3300 + Math.floor(Math.random() * 200);
let proc;

const url = (p) => `http://127.0.0.1:${PORT}${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port, cofre = dir) {
  PORT = port;
  proc = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, COMANDA_PORTA: String(port), COMANDA_COFRE: cofre, DATABASE_URL: '', SESSION_SECRET: '', SENHA_INICIAL: '' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url('/api/saude'))).ok) return; } catch { /* ainda subindo */ }
    await sleep(150);
  }
  throw new Error('servidor não subiu');
}
const stopServer = async () => { proc.kill(); await sleep(300); };

async function call(method, p, { token, body } = {}) {
  const res = await fetch(url(p), {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function login(usuario, senha = 'beto') {
  const r = await call('POST', '/api/login', { body: { usuario, senha } });
  return { ...r, token: r.data.token };
}

before(() => startServer(PORT));
after(async () => { await stopServer(); fs.rmSync(dir, { recursive: true, force: true }); });

test('saúde é pública e diz qual banco está em uso', async () => {
  const r = await call('GET', '/api/saude');
  assert.equal(r.status, 200);
  assert.equal(r.data.auth, true);
  assert.equal(r.data.banco, 'arquivo');
});

test('sem login nada é entregue', async () => {
  for (const [m, p] of [['GET', '/api/estado'], ['PUT', '/api/estado'], ['GET', '/api/contas'], ['GET', '/api/sessao']]) {
    assert.equal((await call(m, p)).status, 401, `${m} ${p}`);
  }
  assert.equal((await call('GET', '/api/estado', { token: 'abc.def' })).status, 401);
});

test('as 3 contas entram com a senha padrão e o login diferencia maiúsculas', async () => {
  const a = await login('ADMIN');
  const b = await login('admin');
  const c = await login('user');
  assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
  assert.deepEqual([a.data.funcao, b.data.funcao, c.data.funcao], ['super', 'admin', 'user']);
  assert.equal(a.data.senhaPadrao, true);
  assert.equal((await login('Admin')).status, 401);       // maiúscula errada
  assert.equal((await login('ADMIN', 'errada')).status, 401);
  assert.equal((await login('outro')).status, 401);
  assert.equal((await login('user', ' beto ')).status, 200);   // espaços nas pontas são ignorados
});

test('Usuário: sem painel, sem ver senha, sem trocar a própria senha', async () => {
  const { token } = await login('user');
  assert.equal((await call('GET', '/api/contas', { token })).status, 403);
  assert.equal((await call('POST', '/api/contas/senha-ver', { token, body: { login: 'user' } })).status, 403);
  assert.equal((await call('PUT', '/api/contas/senha', { token, body: { login: 'user', senha: 'nova-senha' } })).status, 403);
  assert.equal((await call('GET', '/api/estado', { token })).status, 200);   // mas usa o sistema
});

test('admin vê e troca só a dele e a do user', async () => {
  const { token } = await login('admin');
  const lista = await call('GET', '/api/contas', { token });
  assert.deepEqual(lista.data.contas.map((c) => c.login), ['admin', 'user']);
  assert.equal((await call('POST', '/api/contas/senha-ver', { token, body: { login: 'user' } })).data.senha, 'beto');
  assert.equal((await call('POST', '/api/contas/senha-ver', { token, body: { login: 'admin' } })).data.senha, 'beto');
  assert.equal((await call('POST', '/api/contas/senha-ver', { token, body: { login: 'ADMIN' } })).status, 403);
  assert.equal((await call('PUT', '/api/contas/senha', { token, body: { login: 'ADMIN', senha: 'invasor-123' } })).status, 403);
});

test('ADMIN vê e troca as três; a lista nunca traz senha', async () => {
  const { token } = await login('ADMIN');
  const lista = await call('GET', '/api/contas', { token });
  assert.deepEqual(lista.data.contas.map((c) => c.login), ['ADMIN', 'admin', 'user']);
  assert.ok(!JSON.stringify(lista.data).includes('beto'), 'a lista não pode conter a senha');
  for (const l of ['ADMIN', 'admin', 'user']) {
    assert.equal((await call('POST', '/api/contas/senha-ver', { token, body: { login: l } })).data.senha, 'beto');
  }
});

test('regras da nova senha', async () => {
  const { token } = await login('ADMIN');
  const troca = (senha) => call('PUT', '/api/contas/senha', { token, body: { login: 'admin', senha } });
  assert.equal((await troca('abc')).status, 400);          // curta
  assert.equal((await troca('x'.repeat(65))).status, 400);  // longa
  assert.equal((await troca('admin')).status, 400);         // igual ao login (e curta)
});

test('trocar a senha de outra conta derruba as sessões dela e vale na hora', async () => {
  const user = await login('user');
  const admin = await login('admin');
  const r = await call('PUT', '/api/contas/senha', { token: admin.token, body: { login: 'user', senha: 'atendentes-2026' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.token, undefined);                    // não era a conta de quem trocou
  assert.equal((await call('GET', '/api/estado', { token: user.token })).status, 401);   // sessão antiga caiu
  assert.equal((await login('user')).status, 401);          // senha antiga não entra
  assert.equal((await login('user', 'atendentes-2026')).status, 200);
  assert.equal((await call('POST', '/api/contas/senha-ver', { token: admin.token, body: { login: 'user' } })).data.senha, 'atendentes-2026');
  assert.equal((await call('GET', '/api/estado', { token: admin.token })).status, 200);   // a do admin continua
});

test('quem troca a própria senha continua logado com uma sessão nova', async () => {
  const admin = await login('admin');
  const r = await call('PUT', '/api/contas/senha', { token: admin.token, body: { login: 'admin', senha: 'gerente-2026' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  assert.equal(r.data.conta.senhaPadrao, false);
  assert.equal((await call('GET', '/api/estado', { token: admin.token })).status, 401);
  assert.equal((await call('GET', '/api/estado', { token: r.data.token })).status, 200);
});

test('só admin e ADMIN alteram a lista de preços; o Usuário grava clientes', async () => {
  const admin = await login('admin', 'gerente-2026');
  const user = await login('user', 'atendentes-2026');
  const estado = (products, clients = []) => ({ estado: { version: 3, updatedAt: new Date().toISOString(), products, clients } });

  assert.equal((await call('PUT', '/api/estado', { token: admin.token, body: estado([{ id: 'p1', name: 'Cerveja', price: 10 }]) })).status, 200);

  // O Usuário tenta mudar o preço e cadastrar um cliente ao mesmo tempo
  const cliente = { id: 'c1', name: 'Beto', cpf: '', table: '', attendant: '', createdAt: new Date().toISOString(), items: [] };
  const r = await call('PUT', '/api/estado', { token: user.token, body: estado([{ id: 'p1', name: 'Cerveja', price: 1 }], [cliente]) });
  assert.equal(r.status, 200);

  const salvo = (await call('GET', '/api/estado', { token: user.token })).data.estado;
  assert.equal(salvo.products[0].price, 10, 'o preço não pode mudar pelo Usuário');
  assert.equal(salvo.clients[0].name, 'Beto', 'o cliente cadastrado pelo Usuário vale');

  assert.equal((await call('PUT', '/api/estado', { token: admin.token, body: estado([{ id: 'p1', name: 'Cerveja', price: 12 }], [cliente]) })).status, 200);
  assert.equal((await call('GET', '/api/estado', { token: admin.token })).data.estado.products[0].price, 12);
});

test('a senha não fica em texto no arquivo de contas', () => {
  const texto = fs.readFileSync(path.join(dir, 'Comanda', 'contas.json'), 'utf8');
  for (const proibida of ['beto', 'gerente-2026', 'atendentes-2026']) {
    assert.ok(!texto.includes(proibida), `"${proibida}" apareceu em texto puro`);
  }
  assert.match(texto, /scrypt\$/);
  assert.match(texto, /"passwordEnc": "v1:/);
});

test('as contas e as senhas trocadas sobrevivem a um reinício', async () => {
  await stopServer();
  await startServer(PORT);
  assert.equal((await login('admin', 'gerente-2026')).status, 200);
  assert.equal((await login('user', 'atendentes-2026')).status, 200);
  assert.equal((await login('ADMIN')).data.senhaPadrao, true);   // ADMIN ainda com a padrão
  const { token } = await login('ADMIN');
  const lista = (await call('GET', '/api/contas', { token })).data.contas;
  assert.equal(lista.find((c) => c.login === 'admin').senhaPadrao, false);
  assert.ok(lista.find((c) => c.login === 'admin').ultimoAcesso);
});

test('bloqueia depois de muitas senhas erradas, até para a certa', async () => {
  await stopServer();
  const outraPasta = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-limite-'));
  await startServer(PORT + 1, outraPasta);
  const codigos = [];
  for (let i = 0; i < 9; i++) codigos.push((await login('ADMIN', `errada-${i}`)).status);
  assert.deepEqual(codigos, [401, 401, 401, 401, 401, 401, 401, 401, 429]);
  assert.equal((await login('ADMIN', 'beto')).status, 429);
  await stopServer();
  fs.rmSync(outraPasta, { recursive: true, force: true });
});

test('arquivos internos não são entregues pelo site', async () => {
  await startServer(PORT + 2, fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-estatico-')));
  for (const p of ['/config.json', '/server/server.js', '/server/auth.js', '/render.yaml', '/package.json', '/BD/Comanda/contas.json', '/tests/api.test.js']) {
    assert.equal((await fetch(url(p))).status, 404, p);
  }
  for (const p of ['/', '/sw.js', '/assets/js/roles.js', '/assets/js/features.js']) {
    assert.equal((await fetch(url(p))).status, 200, p);
  }
});
