/* Operação: isolamento entre estabelecimentos, garçons, contas e gravações simultâneas */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, uuid } = require('./apoio.js');

let app;
let seq = 0;
before(async () => { app = await startApp(); });
after(() => app.stop());

/** Estabelecimento com dois garçons e uma cerveja de R$ 7,50. */
async function setup() {
  const bar = await app.newEstablishment(`bar-op-${++seq}`);
  const [ana, bruno] = bar.employees;
  const { produto } = await app.ok('POST', '/api/produtos', {
    ...bar.auth, body: { id: uuid(), nome: 'Cerveja', precoCentavos: 750 }
  });
  const staff = (method, path, body) => app.call(method, path, { token: bar.token, body });
  const act = (method, path, body) => app.ok(method, path, { token: bar.token, body });
  const openTab = async (extra = {}) => (await act('POST', '/api/comandas', {
    id: uuid(), garcomId: ana.id, cliente: 'Carlos', mesa: '5', cpf: '', ...extra
  })).comanda;
  const order = async (tab, garcom = ana, quantidade = 1, nome = 'Cerveja') => (await act(
    'POST', `/api/comandas/${tab.id}/pedidos`, { id: uuid(), garcomId: garcom.id, produto: nome, quantidade }
  )).comanda;
  const read = () => act('GET', '/api/dados');
  return { ...bar, ana, bruno, produto, staff, act, openTab, order, read };
}

test('a mesa tem um responsável e cada pedido guarda quem lançou', async () => {
  const bar = await setup();
  const tab = await bar.openTab();
  assert.equal(tab.garcomId, bar.ana.id);
  assert.equal(tab.abertaPor, bar.ana.id);

  await bar.order(tab, bar.ana);
  const after2 = await bar.order(tab, bar.bruno, 2);
  assert.deepEqual(after2.pedidos.map((p) => [p.garcomId, p.quantidade]), [[bar.ana.id, 1], [bar.bruno.id, 2]]);

  const { comanda } = await bar.act('PATCH', `/api/comandas/${tab.id}`, { garcomId: bar.ana.id, responsavelId: bar.bruno.id });
  assert.equal(comanda.garcomId, bar.bruno.id);
  assert.equal(comanda.abertaPor, bar.ana.id);
  assert.equal(comanda.cliente, 'Carlos');
  assert.equal(comanda.mesa, '5');

  const outra = await bar.openTab({ responsavelId: bar.bruno.id });
  assert.deepEqual([outra.garcomId, outra.abertaPor], [bar.bruno.id, bar.ana.id]);
});

test('toda ação exige um funcionário ativo; desativado continua no histórico', async () => {
  const bar = await setup();
  const tab = await bar.openTab();
  await bar.order(tab, bar.bruno);
  await app.ok('PATCH', `/api/funcionarios/${bar.bruno.id}`, { ...bar.auth, body: { ativo: false } });

  const blocked = await bar.staff('POST', `/api/comandas/${tab.id}/pedidos`, {
    id: uuid(), garcomId: bar.bruno.id, produto: 'Cerveja', quantidade: 1
  });
  assert.equal(blocked.status, 400);
  assert.equal((await bar.staff('POST', '/api/comandas', { id: uuid(), cliente: 'Davi', mesa: '', cpf: '' })).status, 400);

  const data = await bar.read();
  assert.deepEqual(data.funcionarios.map((f) => [f.nome, f.ativo]), [['Ana', true], ['Bruno', false]]);
  assert.equal(data.comandas[0].pedidos[0].garcomId, bar.bruno.id);
});

test('nomes repetidos: não entre ativos, mas o nome de quem saiu pode voltar', async () => {
  const bar = await setup();
  const add = (nome) => app.call('POST', '/api/funcionarios', { ...bar.auth, body: { id: uuid(), nome } });
  assert.equal((await add('  ANA ')).status, 409);
  await app.ok('PATCH', `/api/funcionarios/${bar.ana.id}`, { ...bar.auth, body: { ativo: false } });
  assert.equal((await add('Ana')).status, 200);
  const back = await app.call('PATCH', `/api/funcionarios/${bar.ana.id}`, { ...bar.auth, body: { ativo: true } });
  assert.equal(back.status, 409);
});

test('um estabelecimento não vê nem altera nada de outro', async () => {
  const a = await setup();
  const b = await setup();
  const tab = await a.openTab({ cliente: 'Segredo do A' });
  const withOrder = await a.order(tab);
  const orderId = withOrder.pedidos[0].id;

  const seenByB = await b.read();
  assert.equal(seenByB.comandas.length, 0);
  assert.ok(!JSON.stringify(seenByB).includes('Segredo do A'));
  assert.ok(!seenByB.funcionarios.some((f) => f.id === a.ana.id));

  const g = b.ana.id;
  const attempts = [
    ['PATCH', `/api/comandas/${tab.id}`, { garcomId: g, cliente: 'Invadido' }, 404],
    ['DELETE', `/api/comandas/${tab.id}`, { garcomId: g }, 404],
    ['POST', `/api/comandas/${tab.id}/pedidos`, { id: uuid(), garcomId: g, produto: 'Cerveja', quantidade: 1 }, 404],
    ['POST', `/api/comandas/${tab.id}/pedidos/${orderId}/cancelar`, { id: uuid(), garcomId: g, quantidade: 1 }, 404],
    ['POST', `/api/comandas/${tab.id}/encerrar`, { garcomId: g, forma: 'pix', totalEsperadoCentavos: 750 }, 404],
    ['POST', `/api/comandas/${tab.id}/reabrir`, { garcomId: g }, 404]
  ];
  for (const [method, path, body, status] of attempts) {
    assert.equal((await b.staff(method, path, body)).status, status, `${method} ${path}`);
  }

  // Nem usando a gerência do B, nem misturando a gerência do B com a sessão do A
  for (const [method, path] of [['PATCH', `/api/funcionarios/${a.ana.id}`], ['PATCH', `/api/produtos/${a.produto.id}`], ['DELETE', `/api/produtos/${a.produto.id}`]]) {
    assert.equal((await app.call(method, path, { ...b.auth, body: { ativo: false, precoCentavos: 1 } })).status, 404, path);
  }
  const mixed = await app.call('DELETE', `/api/produtos/${a.produto.id}`, { token: a.token, manager: b.auth.manager });
  assert.equal(mixed.status, 403);

  // Garçom de outro estabelecimento não vale
  const bTab = await b.openTab();
  const foreign = await b.staff('POST', `/api/comandas/${bTab.id}/pedidos`, { id: uuid(), garcomId: a.ana.id, produto: 'Cerveja', quantidade: 1 });
  assert.equal(foreign.status, 400);
  assert.equal((await b.staff('PATCH', `/api/comandas/${bTab.id}`, { garcomId: g, responsavelId: a.ana.id })).status, 400);

  const history = await app.ok('GET', `/api/gerencia/historico?de=${new Date(Date.now() - 86400000).toISOString()}&ate=${new Date(Date.now() + 86400000).toISOString()}`, b.auth);
  assert.equal(history.comandas.length, 0);

  const untouched = await a.read();
  assert.equal(untouched.comandas[0].cliente, 'Segredo do A');
  assert.equal(untouched.comandas[0].encerradaEm, null);
  assert.equal(untouched.produtos[0].precoCentavos, 750);
});

test('o próprio banco recusa ligar dados de estabelecimentos diferentes', async () => {
  const a = await setup();
  const b = await setup();
  await assert.rejects(
    app.query(
      `INSERT INTO comandas (estabelecimento_id, id, cliente, garcom_id, aberta_por) VALUES ($1, $2, 'x', $3, $3)`,
      [a.id, uuid(), b.ana.id]
    ),
    { code: '23503' }
  );
});

test('dois estabelecimentos podem usar o mesmo identificador sem colidir', async () => {
  const a = await setup();
  const b = await setup();
  const id = uuid();
  await a.openTab({ id, cliente: 'Do A' });
  await b.openTab({ id, cliente: 'Do B' });
  assert.equal((await a.read()).comandas[0].cliente, 'Do A');
  assert.equal((await b.read()).comandas[0].cliente, 'Do B');
});

test('pedidos lançados ao mesmo tempo não se sobrescrevem', async () => {
  const bar = await setup();
  const tab = await bar.openTab();
  await Promise.all(Array.from({ length: 30 }, (_, i) => bar.order(tab, i % 2 ? bar.ana : bar.bruno)));
  const [saved] = (await bar.read()).comandas;
  assert.equal(saved.pedidos.length, 30);
});

test('reenviar a mesma ação não grava duas vezes, mesmo ao mesmo tempo', async () => {
  const bar = await setup();
  const tab = await bar.openTab();
  const open = { id: tab.id, garcomId: bar.ana.id, cliente: 'Carlos', mesa: '5', cpf: '' };
  await bar.act('POST', '/api/comandas', open);

  const body = { id: uuid(), garcomId: bar.ana.id, produto: 'Cerveja', quantidade: 3 };
  await Promise.all(Array.from({ length: 6 }, () => bar.act('POST', `/api/comandas/${tab.id}/pedidos`, body)));
  let data = await bar.read();
  assert.equal(data.comandas.length, 1);
  assert.equal(data.comandas[0].pedidos.length, 1);

  const cancel = { id: uuid(), garcomId: bar.bruno.id, quantidade: 1 };
  const path = `/api/comandas/${tab.id}/pedidos/${body.id}/cancelar`;
  await Promise.all(Array.from({ length: 4 }, () => bar.act('POST', path, cancel)));
  data = await bar.read();
  assert.equal(data.comandas[0].pedidos[0].cancelada, 1);

  const other = await bar.openTab();
  assert.equal((await bar.staff('POST', `/api/comandas/${other.id}/pedidos`, body)).status, 409);
});

test('cancelar guarda quem cancelou e não passa da quantidade', async () => {
  const bar = await setup();
  const tab = await bar.order(await bar.openTab(), bar.ana, 2);
  const path = `/api/comandas/${tab.id}/pedidos/${tab.pedidos[0].id}/cancelar`;
  assert.equal((await bar.staff('POST', path, { id: uuid(), garcomId: bar.bruno.id, quantidade: 3 })).status, 409);
  const results = await Promise.all([1, 2, 3].map(() => bar.staff('POST', path, { id: uuid(), garcomId: bar.bruno.id, quantidade: 1 })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 409]);
  const events = await app.query(`SELECT garcom_id FROM eventos WHERE estabelecimento_id = $1 AND tipo = 'cancelar'`, [bar.id]);
  assert.deepEqual(events.map((e) => e.garcom_id), [bar.bruno.id, bar.bruno.id]);

  // O identificador de um cancelamento não serve para cancelar outro pedido
  const next = await bar.order(tab, bar.ana, 1, 'Água');
  const cancel = { id: uuid(), garcomId: bar.ana.id, quantidade: 1 };
  const target = `/api/comandas/${tab.id}/pedidos/${next.pedidos[1].id}/cancelar`;
  await bar.act('POST', target, cancel);
  assert.equal((await bar.staff('POST', path, cancel)).status, 409);
});

test('encerrar: o servidor calcula, confere o total visto e congela os preços', async () => {
  const bar = await setup();
  let tab = await bar.openTab();
  const close = (total, forma = 'pix') => bar.staff('POST', `/api/comandas/${tab.id}/encerrar`, {
    garcomId: bar.bruno.id, forma, totalEsperadoCentavos: total
  });
  assert.equal((await close(0)).status, 409);                       // sem consumo
  await bar.order(tab, bar.ana, 5, 'cerveja');
  tab = await bar.order(tab, bar.ana, 1, 'Fora da lista');
  assert.equal((await close(1)).status, 409);                       // total inventado pelo aparelho
  assert.equal((await close(3750, 'fiado')).status, 400);

  const done = await close(3750);
  assert.equal(done.status, 200);
  const { pagamento, encerradaPor } = done.data.comanda;
  assert.equal(encerradaPor, bar.bruno.id);
  assert.equal(pagamento.totalCentavos, 3750);
  assert.equal(pagamento.semPreco, 1);
  assert.equal((await close(3750)).status, 200);                    // reenvio
  assert.equal((await close(3750, 'debito')).status, 409);

  await app.ok('PATCH', `/api/produtos/${bar.produto.id}`, { ...bar.auth, body: { precoCentavos: 900 } });
  assert.equal((await bar.read()).comandas[0].pagamento.totalCentavos, 3750);

  const late = await bar.staff('POST', `/api/comandas/${tab.id}/pedidos`, { id: uuid(), garcomId: bar.ana.id, produto: 'Cerveja', quantidade: 1 });
  assert.equal(late.status, 409);
  assert.equal((await bar.staff('PATCH', `/api/comandas/${tab.id}`, { garcomId: bar.ana.id, mesa: '9' })).status, 409);

  const reopened = await bar.act('POST', `/api/comandas/${tab.id}/reabrir`, { garcomId: bar.ana.id });
  assert.equal(reopened.comanda.pagamento, null);
  const events = await app.query(`SELECT tipo, detalhes FROM eventos WHERE estabelecimento_id = $1 AND tipo IN ('encerrar','reabrir') ORDER BY criado_em`, [bar.id]);
  assert.deepEqual(events.map((e) => [e.tipo, e.detalhes.totalCentavos]), [['encerrar', 3750], ['reabrir', 3750]]);
  assert.equal((await close(3750)).status, 409);                    // o preço novo agora vale
  assert.equal((await close(4500)).status, 200);
});

test('pedido e encerramento ao mesmo tempo nunca deixam item fora da conta', async () => {
  const bar = await setup();
  for (let round = 0; round < 8; round++) {
    const tab = await bar.order(await bar.openTab());
    const [added, closed] = await Promise.all([
      bar.staff('POST', `/api/comandas/${tab.id}/pedidos`, { id: uuid(), garcomId: bar.ana.id, produto: 'Cerveja', quantidade: 1 }),
      bar.staff('POST', `/api/comandas/${tab.id}/encerrar`, { garcomId: bar.ana.id, forma: 'pix', totalEsperadoCentavos: 750 })
    ]);
    // Ou o pedido entrou primeiro (e o encerramento é recusado), ou o contrário
    assert.deepEqual([added.status, closed.status].sort(), [200, 409]);
  }
});

test('excluir só vale para conta sem consumo', async () => {
  const bar = await setup();
  const tab = await bar.order(await bar.openTab());
  const remove = () => bar.staff('DELETE', `/api/comandas/${tab.id}`, { garcomId: bar.ana.id });
  assert.equal((await remove()).status, 409);
  await bar.act('POST', `/api/comandas/${tab.id}/pedidos/${tab.pedidos[0].id}/cancelar`, { id: uuid(), garcomId: bar.ana.id, quantidade: 1 });
  assert.equal((await remove()).status, 200);
  assert.equal((await bar.read()).comandas.length, 0);
});

test('a revisão avisa quando há novidade e uma ação recusada não conta', async () => {
  const bar = await setup();
  const first = await bar.read();
  assert.deepEqual(await bar.act('GET', `/api/dados?revisao=${first.revisao}`), { revisao: first.revisao, semMudancas: true });
  await bar.staff('POST', '/api/comandas', { id: uuid(), cliente: 'X', mesa: '', cpf: '', garcomId: bar.ana.id });
  assert.equal((await bar.read()).revisao, first.revisao);
  await bar.openTab();
  const next = await bar.act('GET', `/api/dados?revisao=${first.revisao}`);
  assert.equal(next.revisao, first.revisao + 1);
  assert.equal(next.comandas.length, 1);
});

test('dados inválidos são recusados', async () => {
  const bar = await setup();
  const tab = await bar.openTab({ cpf: '529.982.247-25' });
  assert.equal(tab.cpf, '52998224725');
  const open = (extra) => bar.staff('POST', '/api/comandas', { id: uuid(), garcomId: bar.ana.id, cliente: 'Carlos', mesa: '', cpf: '', ...extra });
  for (const extra of [{ cpf: '111.111.111-11' }, { cliente: ' ' }, { cliente: 'x'.repeat(81) }, { cliente: { a: 1 } }, { id: '../x' }, { garcomId: undefined }]) {
    assert.equal((await open(extra)).status, 400, JSON.stringify(extra));
  }
  for (const quantidade of [0, -1, 1.5, '2', 1000]) {
    const r = await bar.staff('POST', `/api/comandas/${tab.id}/pedidos`, { id: uuid(), garcomId: bar.ana.id, produto: 'Cerveja', quantidade });
    assert.equal(r.status, 400, String(quantidade));
  }
  for (const precoCentavos of [-1, 7.5, '750', null]) {
    const r = await app.call('POST', '/api/produtos', { ...bar.auth, body: { id: uuid(), nome: 'Água', precoCentavos } });
    assert.equal(r.status, 400, String(precoCentavos));
  }
});

test('aceita pagamento em dinheiro e guarda a forma', async () => {
  const bar = await setup();
  const tab = await bar.order(await bar.openTab(), bar.ana, 2);
  const done = await bar.act('POST', `/api/comandas/${tab.id}/encerrar`, {
    garcomId: bar.ana.id, forma: 'dinheiro', totalEsperadoCentavos: 1500
  });
  assert.deepEqual([done.comanda.pagamento.forma, done.comanda.pagamento.totalCentavos], ['dinheiro', 1500]);
  assert.equal((await bar.read()).comandas[0].pagamento.forma, 'dinheiro');
});

test('o histórico da gerência traz as contas encerradas do período', async () => {
  const bar = await setup();
  const tab = await bar.order(await bar.openTab());
  await bar.openTab({ cliente: 'Ainda aberta' });
  await bar.act('POST', `/api/comandas/${tab.id}/encerrar`, { garcomId: bar.ana.id, forma: 'credito', totalEsperadoCentavos: 750 });
  const range = (from, to) => `/api/gerencia/historico?de=${new Date(Date.now() + from).toISOString()}&ate=${new Date(Date.now() + to).toISOString()}`;
  const now = await app.ok('GET', range(-86400000, 86400000), bar.auth);
  assert.deepEqual(now.comandas.map((c) => [c.id, c.pedidos.length]), [[tab.id, 1]]);
  assert.equal((await app.ok('GET', range(-172800000, -86400000), bar.auth)).comandas.length, 0);
  assert.equal((await app.call('GET', range(0, -1000), bar.auth)).status, 400);
  assert.equal((await app.call('GET', '/api/gerencia/historico', bar.auth)).status, 400);

  // Para o relatório: abertas na mesma leitura, com equipe e preços
  const full = await app.ok('GET', `${range(-86400000, 86400000)}&abertas=1`, bar.auth);
  assert.deepEqual(full.comandas.map((c) => [c.cliente, !!c.encerradaEm]), [['Carlos', true], ['Ainda aberta', false]]);
  assert.deepEqual(full.funcionarios.map((f) => f.nome), ['Ana', 'Bruno']);
  assert.deepEqual(full.produtos.map((p) => p.precoCentavos), [750]);

  const outro = await setup();
  const alheio = await app.ok('GET', `${range(-86400000, 86400000)}&abertas=1`, outro.auth);
  assert.equal(alheio.comandas.length, 0);
  assert.ok(!alheio.funcionarios.some((f) => f.id === bar.ana.id));
});

const auditRange = (bar, from = -86400000, to = 86400000) => app.ok(
  'GET',
  `/api/gerencia/historico?de=${new Date(Date.now() + from).toISOString()}&ate=${new Date(Date.now() + to).toISOString()}&abertas=1`,
  bar.auth
);

test('a gerência vê cancelamentos e reaberturas, com o valor antes e depois', async () => {
  const bar = await setup();
  const tab = await bar.order(await bar.openTab({ cliente: 'João', mesa: '8' }), bar.ana, 4);
  const orderId = tab.pedidos[0].id;
  const close = (forma, total, garcom = bar.ana) => bar.act('POST', `/api/comandas/${tab.id}/encerrar`, {
    garcomId: garcom.id, forma, totalEsperadoCentavos: total
  });
  const reopen = () => bar.act('POST', `/api/comandas/${tab.id}/reabrir`, { garcomId: bar.bruno.id });

  await close('pix', 3000);
  await reopen();
  await reopen();                                       // reenvio não conta duas vezes
  let audit = await auditRange(bar);
  assert.equal(audit.reaberturas.length, 1);
  assert.deepEqual([audit.reaberturas[0].totalAntes, audit.reaberturas[0].totalDepois], [3000, null]);

  const cancel = { id: uuid(), garcomId: bar.bruno.id, quantidade: 2 };
  await bar.act('POST', `/api/comandas/${tab.id}/pedidos/${orderId}/cancelar`, cancel);
  await bar.act('POST', `/api/comandas/${tab.id}/pedidos/${orderId}/cancelar`, cancel);
  await close('debito', 1500, bar.bruno);
  await reopen();
  await close('debito', 1500);

  audit = await auditRange(bar);
  assert.deepEqual(
    audit.cancelamentos.map((c) => [c.garcomId, c.cliente, c.mesa, c.produto, c.quantidade, c.excluida]),
    [[bar.bruno.id, 'João', '8', 'Cerveja', 2, false]]
  );
  assert.deepEqual(
    audit.reaberturas.map((r) => [r.garcomId, r.totalAntes, r.formaAntes, r.totalDepois, r.formaDepois, r.encerradaDeNovoPor]),
    [
      [bar.bruno.id, 3000, 'pix', 1500, 'debito', bar.bruno.id],
      [bar.bruno.id, 1500, 'debito', 1500, 'debito', bar.ana.id]
    ]
  );
  assert.equal((await auditRange(bar, -172800000, -86400000)).cancelamentos.length, 0);
});

test('cancelar tudo e excluir a comanda não apaga o rastro; outro bar não vê', async () => {
  const bar = await setup();
  const tab = await bar.order(await bar.openTab({ cliente: 'Sumido', mesa: '3' }), bar.ana, 1);
  await bar.act('POST', `/api/comandas/${tab.id}/encerrar`, { garcomId: bar.ana.id, forma: 'pix', totalEsperadoCentavos: 750 });
  await bar.act('POST', `/api/comandas/${tab.id}/reabrir`, { garcomId: bar.bruno.id });
  await bar.act('POST', `/api/comandas/${tab.id}/pedidos/${tab.pedidos[0].id}/cancelar`, { id: uuid(), garcomId: bar.bruno.id, quantidade: 1 });
  await bar.act('DELETE', `/api/comandas/${tab.id}`, { garcomId: bar.bruno.id });

  const audit = await auditRange(bar);
  assert.equal(audit.comandas.length, 0);
  for (const entry of [...audit.cancelamentos, ...audit.reaberturas]) {
    assert.deepEqual([entry.cliente, entry.mesa, entry.excluida], ['Sumido', '3', true]);
  }
  assert.equal(audit.reaberturas[0].totalDepois, null);

  const other = await setup();
  const seen = await auditRange(other);
  assert.deepEqual([seen.cancelamentos, seen.reaberturas], [[], []]);

  // Sem o PIN, a equipe não recebe esse rastro
  const staff = await bar.act('GET', '/api/dados');
  assert.ok(!('cancelamentos' in staff) && !('reaberturas' in staff));
});
