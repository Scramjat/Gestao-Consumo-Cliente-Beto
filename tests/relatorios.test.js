/* Relatórios: contas por garçom e planilha, com números conferidos à mão */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WaiterStats = require('../assets/js/waiter-stats.js');
const Excel = require('../assets/js/excel.js');

const START = Date.parse('2026-11-10T00:00:00.000Z');
const BEFORE = '2026-11-09T23:00:00.000Z';
const at = (hour) => `2026-11-10T${String(hour).padStart(2, '0')}:00:00.000Z`;

const order = (waiterId, qty, when) => ({ waiterId, qty, at: when });
const item = (product, ...orders) => ({
  key: product.toLowerCase(), product, qty: orders.reduce((s, o) => s + o.qty, 0), orders
});
const tab = (id, fields) => ({
  id, name: id, cpf: '', table: '', waiterId: 'ana', createdAt: at(10), closedAt: null, closedBy: null,
  payment: null, items: [], ...fields
});
const paid = (totalCents, lines) => ({
  method: 'pix', totalCents, missing: lines.filter((l) => l[2] == null).length,
  items: lines.map(([product, qty, unitCents]) => ({
    product, qty, unitCents, totalCents: unitCents == null ? null : unitCents * qty
  }))
});

/*
  paga:    Ana responsável. Pagou 5 × 7,00 (preço da época). Ana lançou 2, Bruno 3.
  aberta:  Bruno responsável. Ana lançou 1 cerveja (preço atual 10,00) e Bruno 2 itens sem preço.
  virada:  paga no período, mas pedida antes dele: conta no faturamento, não nos itens.
  antiga:  encerrada antes do período: não entra em nada.
*/
const state = {
  employees: [
    { id: 'ana', name: 'Ana', active: true },
    { id: 'bruno', name: 'Bruno', active: false },
    { id: 'caio', name: 'Caio sem movimento', active: true }
  ],
  products: [{ id: 'p1', name: 'Cerveja', price: 10 }],
  clients: [
    tab('paga', {
      table: '5', closedAt: at(12), closedBy: 'bruno', payment: paid(3500, [['Cerveja', 5, 700]]),
      items: [item('Cerveja', order('ana', 2, at(10)), order('bruno', 3, at(11)))]
    }),
    tab('aberta', {
      waiterId: 'bruno',
      items: [item('Cerveja', order('ana', 1, at(13))), item('Fritas', order('bruno', 2, at(14)))]
    }),
    tab('virada', {
      createdAt: BEFORE, closedAt: at(1), closedBy: 'ana', payment: paid(1400, [['Cerveja', 2, 700]]),
      items: [item('Cerveja', order('ana', 2, BEFORE))]
    }),
    tab('antiga', {
      createdAt: BEFORE, closedAt: BEFORE, closedBy: 'ana', payment: paid(9900, [['Cerveja', 9, 1100]]),
      items: [item('Cerveja', order('ana', 9, BEFORE))]
    })
  ]
};

const pick = (row, ...keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
const FIELDS = ['paidTabs', 'revenueCents', 'avgTicketCents', 'openTabs', 'items', 'tabsServed', 'launchedCents', 'unpricedItems'];

test('faturamento vai para o responsável; itens, para quem lançou', () => {
  const rows = WaiterStats.compute(state, START);
  assert.deepEqual(rows.map((r) => r.name), ['Ana', 'Bruno']);
  assert.deepEqual(pick(rows[0], ...FIELDS), {
    paidTabs: 2, revenueCents: 4900, avgTicketCents: 2450, openTabs: 0,
    items: 3, tabsServed: 2, launchedCents: 2 * 700 + 1000, unpricedItems: 0
  });
  assert.deepEqual(pick(rows[1], ...FIELDS), {
    paidTabs: 0, revenueCents: 0, avgTicketCents: null, openTabs: 1,
    items: 5, tabsServed: 2, launchedCents: 3 * 700, unpricedItems: 2
  });
  assert.equal(rows[1].active, false);
});

test('a soma do faturamento por garçom é o faturamento total do período', () => {
  const total = state.clients
    .filter((c) => c.closedAt && Date.parse(c.closedAt) >= START)
    .reduce((s, c) => s + c.payment.totalCents, 0);
  assert.equal(WaiterStats.compute(state, START).reduce((s, r) => s + r.revenueCents, 0), total);
});

const sheets = () => Object.fromEntries(Excel.buildSheets(state, START).map((s) => [s.name, s]));
const column = (sheet, header) => {
  const i = sheet.headers.indexOf(header);
  assert.ok(i >= 0, `coluna ${header}`);
  return sheet.rows.map((r) => r[i].v);
};

test('planilha: abas, colunas de garçom e recorte do período', () => {
  const all = sheets();
  assert.deepEqual(Object.keys(all), ['Garçons', 'Contas', 'Pedidos', 'Produtos']);
  for (const sheet of Object.values(all)) {
    assert.equal(sheet.widths.length, sheet.headers.length, sheet.name);
    for (const row of sheet.rows) assert.equal(row.length, sheet.headers.length, sheet.name);
  }

  assert.deepEqual(column(all['Garçons'], 'Faturamento (responsável)'), [49, 0]);

  const contas = all.Contas;
  assert.deepEqual(column(contas, 'Cliente'), ['virada', 'paga', 'aberta']);
  assert.deepEqual(column(contas, 'Garçom responsável'), ['Ana', 'Ana', 'Bruno']);
  assert.deepEqual(column(contas, 'Lançaram pedidos'), ['Ana', 'Ana, Bruno', 'Ana, Bruno']);
  assert.deepEqual(column(contas, 'Encerrada por'), ['Ana', 'Bruno', '']);

  assert.deepEqual(column(all.Pedidos, 'Lançado por'), ['Ana', 'Bruno', 'Ana', 'Bruno']);
  assert.deepEqual(column(all.Pedidos, 'Valor total'), [14, 21, 10, '']);

  assert.deepEqual(column(all.Produtos, 'Produto'), ['Cerveja', 'Fritas']);
  assert.deepEqual(column(all.Produtos, 'Quantidade total'), [6, 2]);
  assert.deepEqual(column(all.Produtos, 'Valor total'), [45, '']);
});

test('planilha: gera um arquivo .xlsx e trata texto perigoso como texto', () => {
  const hostile = structuredClone(state);
  hostile.employees[0].name = '=1+1 <b>"&';
  const bytes = Excel.build(hostile, START);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const text = Buffer.from(bytes).toString('utf8');   // o zip não usa compressão
  assert.ok(text.includes('=1+1 &lt;b&gt;&quot;&amp;'));
  assert.ok(!text.includes('<f>'), 'nenhuma célula pode virar fórmula');
});
