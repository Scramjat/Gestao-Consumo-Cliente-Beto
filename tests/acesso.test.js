/* Acesso: dono da plataforma, login do estabelecimento, PIN do gerente e limites */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, OWNER, uuid } = require('./apoio.js');

let app;
before(async () => { app = await startApp(); });
after(() => app.stop());

const BASE = '/api/plataforma/estabelecimentos';
const login = (usuario, senha) => app.call('POST', '/api/login', { body: { usuario, senha } });

test('o dono cria; senha e PIN aparecem uma vez e nunca ficam em texto no banco', async () => {
  const token = await app.ownerToken();
  const created = await app.ok('POST', BASE, { token, body: { nome: 'Bar do Zé', login: '  Bar-Do-Ze ' } });
  assert.equal(created.estabelecimento.login, 'bar-do-ze');
  assert.match(created.senha, /^[a-z2-9]{12}$/);
  assert.match(created.pin, /^\d{6}$/);

  const list = await app.ok('GET', BASE, { token });
  const text = JSON.stringify(list);
  assert.ok(!text.includes(created.senha) && !text.includes(created.pin) && !text.includes('scrypt'));

  const [row] = await app.query('SELECT * FROM estabelecimentos WHERE login = $1', ['bar-do-ze']);
  assert.match(row.senha_hash, /^scrypt\$/);
  assert.match(row.pin_hash, /^scrypt\$/);
  assert.ok(!JSON.stringify(row).includes(created.senha));

  assert.equal((await app.call('POST', BASE, { token, body: { nome: 'Outro', login: 'BAR-DO-ZE' } })).status, 409);
  for (const ruim of ['ab', 'com espaço', 'ç-bar', '-bar']) {
    assert.equal((await app.call('POST', BASE, { token, body: { nome: 'Outro', login: ruim } })).status, 400, ruim);
  }
});

test('o painel do dono não aceita o token de um estabelecimento (nem o contrário)', async () => {
  const bar = await app.newEstablishment('bar-tokens');
  const owner = await app.ownerToken();
  for (const token of [undefined, 'abc.def', bar.token, bar.auth.manager]) {
    assert.equal((await app.call('GET', BASE, { token })).status, 401);
    assert.equal((await app.call('POST', BASE, { token, body: { nome: 'Invasor', login: 'invasor' } })).status, 401);
  }
  for (const token of [undefined, owner, bar.auth.manager]) {
    assert.equal((await app.call('GET', '/api/dados', { token })).status, 401);
  }
  // O token de sessão não serve de liberação da gerência
  const r = await app.call('POST', '/api/produtos', { token: bar.token, manager: bar.token, body: {} });
  assert.equal(r.status, 403);
});

test('sem o PIN, o aparelho não mexe em preços, equipe, histórico nem senhas', async () => {
  const bar = await app.newEstablishment('bar-pin');
  const rotas = [
    ['POST', '/api/funcionarios'], ['PATCH', `/api/funcionarios/${bar.employees[0].id}`],
    ['POST', '/api/produtos'], ['PATCH', `/api/produtos/${uuid()}`], ['DELETE', `/api/produtos/${uuid()}`],
    ['GET', '/api/gerencia/historico?de=2026-01-01&ate=2026-02-01'],
    ['PUT', '/api/gerencia/senha'], ['PUT', '/api/gerencia/pin']
  ];
  for (const [method, path] of rotas) {
    assert.equal((await app.call(method, path, { token: bar.token })).status, 403, `${method} ${path}`);
  }
  const wrong = bar.pin === '111222' ? '333444' : '111222';
  assert.equal((await app.call('POST', '/api/gerencia', { token: bar.token, body: { pin: wrong } })).status, 401);
});

test('o PIN bloqueia depois de 5 erros, sem afetar outro estabelecimento', async () => {
  const bar = await app.newEstablishment('bar-forca');
  const vizinho = await app.newEstablishment('bar-vizinho');
  const wrong = bar.pin === '111222' ? '333444' : '111222';
  const codes = [];
  for (let i = 0; i < 6; i++) {
    codes.push((await app.call('POST', '/api/gerencia', { token: bar.token, body: { pin: wrong } })).status);
  }
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
  assert.equal((await app.call('POST', '/api/gerencia', { token: bar.token, body: { pin: bar.pin } })).status, 429);
  await app.ok('POST', '/api/gerencia', { token: vizinho.token, body: { pin: vizinho.pin } });
});

test('suspender corta o acesso na hora; reativar devolve', async () => {
  const bar = await app.newEstablishment('bar-suspenso');
  const owner = await app.ownerToken();
  await app.ok('PATCH', `${BASE}/${bar.id}`, { token: owner, body: { ativo: false } });
  assert.equal((await app.call('GET', '/api/dados', { token: bar.token })).status, 403);
  assert.equal((await login(bar.login, bar.senha)).status, 403);
  assert.equal((await login(bar.login, 'senha-errada')).status, 401);   // não revela a suspensão
  await app.ok('PATCH', `${BASE}/${bar.id}`, { token: owner, body: { ativo: true } });
  await app.ok('GET', '/api/dados', { token: bar.token });
});

test('redefinir a senha desconecta os aparelhos; redefinir o PIN derruba a gerência', async () => {
  const bar = await app.newEstablishment('bar-redefine');
  const owner = await app.ownerToken();

  const { pin } = await app.ok('POST', `${BASE}/${bar.id}/redefinir-pin`, { token: owner });
  const old = await app.call('GET', '/api/gerencia/historico?de=2026-01-01&ate=2026-02-01', bar.auth);
  assert.equal(old.status, 403);
  await app.ok('POST', '/api/gerencia', { token: bar.token, body: { pin } });

  const { senha } = await app.ok('POST', `${BASE}/${bar.id}/redefinir-senha`, { token: owner });
  assert.equal((await app.call('GET', '/api/dados', { token: bar.token })).status, 401);
  assert.equal((await login(bar.login, bar.senha)).status, 401);
  assert.equal((await login(bar.login, senha)).status, 200);
});

test('o gerente troca a própria senha e o PIN', async () => {
  const bar = await app.newEstablishment('bar-troca');
  for (const pin of ['111111', '123456', '654321', '12345', 'abcdef']) {
    assert.equal((await app.call('PUT', '/api/gerencia/pin', { ...bar.auth, body: { pin } })).status, 400, pin);
  }
  assert.equal((await app.call('PUT', '/api/gerencia/senha', { ...bar.auth, body: { senha: 'curta' } })).status, 400);

  const r = await app.ok('PUT', '/api/gerencia/senha', { ...bar.auth, body: { senha: 'nova-senha-do-bar' } });
  assert.equal((await app.call('GET', '/api/dados', { token: bar.token })).status, 401);
  await app.ok('GET', '/api/dados', { token: r.token });
  await app.ok('PUT', '/api/gerencia/pin', { token: r.token, manager: r.gerencia, body: { pin: '482913' } });
  await app.ok('POST', '/api/gerencia', { token: r.token, body: { pin: '482913' } });
});

test('o login bloqueia depois de muitos erros, só para aquele usuário no aparelho', async () => {
  const a = await app.newEstablishment('bar-erros');
  const b = await app.newEstablishment('bar-outro');
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await login(a.login, `errada-${i}`)).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401, 401, 429]);
  assert.equal((await login(a.login, a.senha)).status, 429);
  assert.equal((await login(b.login, b.senha)).status, 200);
});

test('chutes simultâneos não furam o limite', async () => {
  const bar = await app.newEstablishment('bar-rajada');
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => login(bar.login, `errada-${i}`)));
  assert.equal(results.filter((r) => r.status === 401).length, 8);
  assert.equal(results.filter((r) => r.status === 429).length, 12);
});

test('trocar o X-Forwarded-For não escapa do limite', async () => {
  await app.restart();
  const codes = [];
  for (let i = 0; i < 6; i++) {
    codes.push((await app.call('POST', '/api/plataforma/login', {
      body: { usuario: OWNER.usuario, senha: 'errada' }, headers: { 'X-Forwarded-For': `10.0.0.${i}` }
    })).status);
  }
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
  await app.restart();
});

test('painel desligado sem senha forte; trocar a senha do dono encerra a sessão dele', async () => {
  const before = await app.ownerToken();
  await app.restart();
  await app.ok('GET', BASE, { token: before });   // reiniciar não derruba ninguém

  await app.restart({ ownerPassword: 'outra-senha-bem-longa' });
  assert.equal((await app.call('GET', BASE, { token: before })).status, 401);

  await app.restart({ ownerPassword: 'curta' });
  assert.equal((await app.call('POST', '/api/plataforma/login', { body: { usuario: 'dono', senha: 'curta' } })).status, 503);
  await app.restart();
});

test('as telas e todos os arquivos que elas pedem são entregues', async () => {
  for (const page of ['/', '/plataforma']) {
    const r = await app.call('GET', page);
    assert.equal(r.status, 200, page);
    const files = [...r.data.matchAll(/(?:href|src)="\/?((?:assets\/|manifest)[^"]+)"/g)].map((m) => `/${m[1]}`);
    assert.ok(files.length > 2, `${page} deveria pedir arquivos`);
    for (const file of files) assert.equal((await app.call('GET', file)).status, 200, `${page} pede ${file}`);
  }
  const manifest = JSON.parse(JSON.stringify((await app.call('GET', '/manifest.webmanifest')).data));
  for (const icon of manifest.icons) assert.equal((await app.call('GET', `/${icon.src}`)).status, 200, icon.src);
});

test('arquivos internos não são entregues; corpo inválido é recusado', async () => {
  for (const path of ['/server/auth.js', '/server/operacao.js', '/render.yaml', '/package.json', '/tests/apoio.js', '/README.md', '/.gitignore', '/__proto__', '/constructor', '/assets/%2e%2e/package.json']) {
    assert.equal((await app.call('GET', path)).status, 404, path);
  }
  assert.match((await app.call('GET', '/plataforma')).headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await app.call('POST', '/api/login', { body: { usuario: 'a\u0000b', senha: 'x' } })).status, 401);
  for (const raw of ['{', '[]', 'null', '"texto"']) {
    assert.equal((await app.call('POST', '/api/login', { raw })).status, 400, raw);
  }
  assert.equal((await app.call('POST', '/api/login', { raw: `{"a":"${'x'.repeat(70000)}"}` })).status, 413);
});
