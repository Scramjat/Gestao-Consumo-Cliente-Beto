/* =========================================================
   Operação do dia a dia: equipe, produtos, comandas e pedidos

   Cada ação grava só o que ela mudou. Preços, totais e
   permissões são decididos aqui, nunca no aparelho.

   Toda gravação passa por mutate(), que primeiro aumenta a
   revisão do estabelecimento. Isso trava a linha dele até o fim
   da transação: as gravações de um mesmo estabelecimento entram
   em fila (dois garçons nunca se sobrescrevem) e os aparelhos
   sabem que precisam atualizar a tela.

   TODA consulta filtra por estabelecimento_id, que vem sempre da
   sessão e nunca do que o aparelho mandou.
   ========================================================= */

const Billing = require('../assets/js/billing.js');
const Utils = require('../assets/js/utils.js');
const V = require('./validar.js');
const Audit = require('./auditoria.js');

const RECENT_CLOSED_MS = 24 * 3600 * 1000;
const MAX_HISTORY_MS = 367 * 24 * 3600 * 1000;
const MAX_PRICE_CENTS = 10000000;   // R$ 100.000,00
const MAX_QTY = 999;

const iso = (d) => (d ? new Date(d).toISOString() : null);
const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

const toEmployee = (r) => ({ id: r.id, nome: r.nome, ativo: r.ativo });
const toProduct = (r) => ({ id: r.id, nome: r.nome, precoCentavos: r.preco_centavos });
const toOrder = (r) => ({
  id: r.id,
  produto: r.produto,
  quantidade: r.quantidade,
  cancelada: r.cancelada,
  garcomId: r.garcom_id,
  criadoEm: iso(r.criado_em)
});
const toTab = (r, orders) => ({
  id: r.id,
  cliente: r.cliente,
  cpf: r.cpf,
  mesa: r.mesa,
  garcomId: r.garcom_id,
  abertaPor: r.aberta_por,
  criadaEm: iso(r.criada_em),
  encerradaEm: iso(r.encerrada_em),
  encerradaPor: r.encerrada_por || null,
  pagamento: r.pagamento ? json(r.pagamento) : null,
  pedidos: orders
});

function tabFields(body) {
  const cpf = Utils.onlyDigits(V.text(body.cpf, { field: 'CPF', max: 20 }));
  if (cpf && !Utils.isValidCPF(cpf)) V.fail(400, 'CPF inválido.');
  return {
    cliente: V.text(body.cliente, { field: 'Nome do cliente', min: 2, max: 80 }),
    cpf,
    mesa: V.text(body.mesa, { field: 'Mesa', max: 20 })
  };
}

const productName = (value) => V.text(value, { field: 'Produto', min: 2, max: 80 });
const employeeName = (value) => V.text(value, { field: 'Nome do funcionário', min: 2, max: 40 });
const price = (value) => V.integer(value, { field: 'Preço em centavos', min: 0, max: MAX_PRICE_CENTS });

function createOperation({ db }) {
  function mutate(est, work) {
    return db.tx(async (c) => {
      const { rows } = await c.query(
        'UPDATE estabelecimentos SET revisao = revisao + 1 WHERE id = $1 RETURNING revisao', [est]
      );
      const result = await work(c);
      return { revisao: Number(rows[0].revisao), ...result };
    });
  }

  const one = async (c, sql, params) => (await c.query(sql, params)).rows[0] || null;

  const findEmployee = (c, est, id) => one(
    c, 'SELECT * FROM funcionarios WHERE estabelecimento_id = $1 AND id = $2', [est, id]
  );

  /** O funcionário que está fazendo a ação (ou ficando responsável) precisa estar ativo. */
  async function activeEmployee(c, est, id, field = 'Quem está atendendo') {
    const found = await findEmployee(c, est, V.id(id, field));
    if (!found || !found.ativo) V.fail(400, `${field}: escolha um funcionário ativo.`);
    return found;
  }

  const findTab = (c, est, id) => one(c, 'SELECT * FROM comandas WHERE estabelecimento_id = $1 AND id = $2', [est, id]);

  const requiredTab = async (c, est, id) => (await findTab(c, est, id)) || V.fail(404, 'Conta não encontrada.');

  /** A conta, desde que ainda esteja aberta. */
  async function stillOpen(c, est, id) {
    const tab = await requiredTab(c, est, id);
    if (tab.encerrada_em) V.fail(409, 'Essa conta já foi encerrada.');
    return tab;
  }

  const tabOrders = async (c, est, tabId) => (await c.query(
    'SELECT * FROM pedidos WHERE estabelecimento_id = $1 AND comanda_id = $2 ORDER BY criado_em, id', [est, tabId]
  )).rows;

  const productRows = async (c, est) => (await c.query(
    'SELECT * FROM produtos WHERE estabelecimento_id = $1 AND ativo ORDER BY nome_chave', [est]
  )).rows;

  const tabView = async (c, est, id) => toTab(await requiredTab(c, est, id), (await tabOrders(c, est, id)).map(toOrder));

  const record = (c, est, { id = V.newId(), tipo, comandaId = null, garcomId = null, detalhes = null }) => c.query(
    // clock_timestamp: hora da gravação, já na vez dela na fila, para a ordem ser a real
    `INSERT INTO eventos (estabelecimento_id, id, tipo, comanda_id, garcom_id, detalhes, criado_em)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, clock_timestamp())`,
    [est, id, tipo, comandaId, garcomId, JSON.stringify(detalhes)]
  );

  /** Conta aberta: uma linha por produto, com os preços de agora. */
  async function billFor(c, est, tabId) {
    const items = new Map();
    for (const o of await tabOrders(c, est, tabId)) {
      const qty = o.quantidade - o.cancelada;
      if (!qty) continue;
      const item = items.get(o.produto_chave) || { product: o.produto, qty: 0 };
      item.qty += qty;
      items.set(o.produto_chave, item);
    }
    const products = (await productRows(c, est)).map((p) => ({ name: p.nome, price: p.preco_centavos / 100 }));
    return Billing.bill({ items: [...items.values()] }, products);
  }

  /** Nomes iguais entre ativos viram um erro claro. */
  async function unique(message, work) {
    try {
      return await work();
    } catch (e) {
      if (e.code === '23505') V.fail(409, message);
      throw e;
    }
  }

  /* ---------- Leitura ---------- */

  /**
   * O que a tela precisa: equipe, preços, contas abertas e as encerradas nas
   * últimas 24 horas. Se nada mudou desde `since`, devolve só a revisão.
   */
  function data(est, since) {
    return db.snapshot(async (c) => {
      const revisao = Number((await one(c, 'SELECT revisao FROM estabelecimentos WHERE id = $1', [est])).revisao);
      if (since !== null && since === revisao) return { revisao, semMudancas: true };

      const cutoff = new Date(Date.now() - RECENT_CLOSED_MS).toISOString();
      const where = 't.estabelecimento_id = $1 AND (t.encerrada_em IS NULL OR t.encerrada_em >= $2)';
      const employees = await c.query(
        'SELECT * FROM funcionarios WHERE estabelecimento_id = $1 ORDER BY nome_chave', [est]
      );
      const products = await productRows(c, est);
      const tabs = await c.query(`SELECT t.* FROM comandas t WHERE ${where} ORDER BY t.criada_em, t.id`, [est, cutoff]);
      const orders = await c.query(
        `SELECT p.* FROM pedidos p
           JOIN comandas t ON t.estabelecimento_id = p.estabelecimento_id AND t.id = p.comanda_id
          WHERE ${where} ORDER BY p.criado_em, p.id`,
        [est, cutoff]
      );
      return {
        revisao,
        funcionarios: employees.rows.map(toEmployee),
        produtos: products.map(toProduct),
        comandas: groupTabs(tabs.rows, orders.rows)
      };
    });
  }

  function groupTabs(tabs, orders) {
    const byTab = new Map(tabs.map((t) => [t.id, []]));
    for (const o of orders) byTab.get(o.comanda_id)?.push(toOrder(o));
    return tabs.map((t) => toTab(t, byTab.get(t.id)));
  }

  /**
   * Gerência: contas encerradas num período (base do faturamento). Com
   * `includeOpen`, traz também as abertas, na mesma leitura, para uma conta
   * encerrada nesse instante não sumir nem aparecer duas vezes no relatório.
   */
  function history(est, de, ate, includeOpen = false) {
    const from = Date.parse(de);
    const to = Date.parse(ate);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) V.fail(400, 'Período inválido.');
    if (to - from > MAX_HISTORY_MS) V.fail(400, 'Escolha um período de no máximo 1 ano.');
    const params = [est, new Date(from).toISOString(), new Date(to).toISOString()];
    const closed = '(t.encerrada_em >= $2 AND t.encerrada_em < $3)';
    const where = `t.estabelecimento_id = $1 AND (${closed}${includeOpen ? ' OR t.encerrada_em IS NULL' : ''})`;
    return db.snapshot(async (c) => {
      const employees = await c.query(
        'SELECT * FROM funcionarios WHERE estabelecimento_id = $1 ORDER BY nome_chave', [est]
      );
      const products = await productRows(c, est);
      const tabs = await c.query(`SELECT t.* FROM comandas t WHERE ${where} ORDER BY t.criada_em, t.id`, params);
      const orders = await c.query(
        `SELECT p.* FROM pedidos p
           JOIN comandas t ON t.estabelecimento_id = p.estabelecimento_id AND t.id = p.comanda_id
          WHERE ${where} ORDER BY p.criado_em, p.id`,
        params
      );
      const events = await c.query(Audit.SQL, params);
      return {
        funcionarios: employees.rows.map(toEmployee),
        produtos: products.map(toProduct),
        comandas: groupTabs(tabs.rows, orders.rows),
        ...Audit.summarize(events.rows)
      };
    });
  }

  /* ---------- Equipe (gerência) ---------- */
  const DUPLICATE_EMPLOYEE = 'Já existe um funcionário ativo com esse nome.';

  function addEmployee(est, body) {
    const id = V.id(body.id);
    const nome = employeeName(body.nome);
    return unique(DUPLICATE_EMPLOYEE, () => mutate(est, async (c) => {
      let found = await findEmployee(c, est, id);
      if (!found) {
        await c.query(
          'INSERT INTO funcionarios (estabelecimento_id, id, nome, nome_chave) VALUES ($1, $2, $3, $4)',
          [est, id, nome, Billing.norm(nome)]
        );
        found = await findEmployee(c, est, id);
      }
      return { funcionario: toEmployee(found) };
    }));
  }

  /** Funcionário nunca é apagado, só desativado: o histórico continua com o nome dele. */
  function updateEmployee(est, id, body) {
    if (body.ativo !== undefined && typeof body.ativo !== 'boolean') V.fail(400, 'Situação inválida.');
    return unique(DUPLICATE_EMPLOYEE, () => mutate(est, async (c) => {
      const found = (await findEmployee(c, est, id)) || V.fail(404, 'Funcionário não encontrado.');
      const nome = body.nome === undefined ? found.nome : employeeName(body.nome);
      const ativo = body.ativo === undefined ? found.ativo : body.ativo;
      await c.query(
        'UPDATE funcionarios SET nome = $3, nome_chave = $4, ativo = $5 WHERE estabelecimento_id = $1 AND id = $2',
        [est, id, nome, Billing.norm(nome), ativo]
      );
      return { funcionario: toEmployee(await findEmployee(c, est, id)) };
    }));
  }

  /* ---------- Produtos e preços (gerência) ---------- */
  const DUPLICATE_PRODUCT = 'Já existe um produto com esse nome.';

  const findProduct = (c, est, id) => one(c, 'SELECT * FROM produtos WHERE estabelecimento_id = $1 AND id = $2', [est, id]);

  async function requiredProduct(c, est, id) {
    const found = await findProduct(c, est, id);
    if (!found || !found.ativo) V.fail(404, 'Produto não encontrado.');
    return found;
  }

  function addProduct(est, body) {
    const id = V.id(body.id);
    const nome = productName(body.nome);
    const cents = price(body.precoCentavos);
    return unique(DUPLICATE_PRODUCT, () => mutate(est, async (c) => {
      let found = await findProduct(c, est, id);
      if (!found) {
        await c.query(
          'INSERT INTO produtos (estabelecimento_id, id, nome, nome_chave, preco_centavos) VALUES ($1, $2, $3, $4, $5)',
          [est, id, nome, Billing.norm(nome), cents]
        );
        found = await findProduct(c, est, id);
      }
      return { produto: toProduct(found) };
    }));
  }

  function updateProduct(est, id, body) {
    return unique(DUPLICATE_PRODUCT, () => mutate(est, async (c) => {
      const found = await requiredProduct(c, est, id);
      const nome = body.nome === undefined ? found.nome : productName(body.nome);
      const cents = body.precoCentavos === undefined ? found.preco_centavos : price(body.precoCentavos);
      await c.query(
        `UPDATE produtos SET nome = $3, nome_chave = $4, preco_centavos = $5
          WHERE estabelecimento_id = $1 AND id = $2`,
        [est, id, nome, Billing.norm(nome), cents]
      );
      return { produto: toProduct(await findProduct(c, est, id)) };
    }));
  }

  function removeProduct(est, id) {
    return mutate(est, async (c) => {
      await requiredProduct(c, est, id);
      await c.query('UPDATE produtos SET ativo = false WHERE estabelecimento_id = $1 AND id = $2', [est, id]);
      return {};
    });
  }

  /* ---------- Comandas (contas dos clientes) ---------- */

  /** Abre uma conta. O responsável é quem abriu, a menos que escolham outro. */
  function openTab(est, body) {
    const id = V.id(body.id);
    const f = tabFields(body);
    return mutate(est, async (c) => {
      if (!(await findTab(c, est, id))) {
        const actor = await activeEmployee(c, est, body.garcomId);
        const waiter = body.responsavelId === undefined
          ? actor
          : await activeEmployee(c, est, body.responsavelId, 'Garçom responsável');
        await c.query(
          `INSERT INTO comandas (estabelecimento_id, id, cliente, cpf, mesa, garcom_id, aberta_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [est, id, f.cliente, f.cpf, f.mesa, waiter.id, actor.id]
        );
      }
      return { comanda: await tabView(c, est, id) };
    });
  }

  function updateTab(est, id, body) {
    return mutate(est, async (c) => {
      const tab = await stillOpen(c, est, id);
      const actor = await activeEmployee(c, est, body.garcomId);
      const pick = (key, column) => (body[key] === undefined ? tab[column] : body[key]);
      const f = tabFields({ cliente: pick('cliente', 'cliente'), cpf: pick('cpf', 'cpf'), mesa: pick('mesa', 'mesa') });
      let waiterId = tab.garcom_id;
      if (body.responsavelId !== undefined && body.responsavelId !== waiterId) {
        waiterId = (await activeEmployee(c, est, body.responsavelId, 'Garçom responsável')).id;
        await record(c, est, {
          tipo: 'responsavel', comandaId: id, garcomId: actor.id, detalhes: { de: tab.garcom_id, para: waiterId }
        });
      }
      await c.query(
        `UPDATE comandas SET cliente = $3, cpf = $4, mesa = $5, garcom_id = $6
          WHERE estabelecimento_id = $1 AND id = $2`,
        [est, id, f.cliente, f.cpf, f.mesa, waiterId]
      );
      return { comanda: await tabView(c, est, id) };
    });
  }

  /** Só dá para excluir quem não consumiu nada. */
  function removeTab(est, id, body) {
    return mutate(est, async (c) => {
      const tab = await stillOpen(c, est, id);
      const actor = await activeEmployee(c, est, body.garcomId);
      if ((await tabOrders(c, est, id)).some((o) => o.quantidade > o.cancelada)) {
        V.fail(409, 'Só é possível excluir uma conta sem consumo.');
      }
      await record(c, est, {
        tipo: 'excluir', comandaId: id, garcomId: actor.id, detalhes: { cliente: tab.cliente, mesa: tab.mesa }
      });
      await c.query('DELETE FROM comandas WHERE estabelecimento_id = $1 AND id = $2', [est, id]);
      return {};
    });
  }

  /* ---------- Pedidos ---------- */
  function addOrder(est, tabId, body) {
    const id = V.id(body.id);
    const nome = productName(body.produto);
    const qty = V.integer(body.quantidade, { field: 'Quantidade', min: 1, max: MAX_QTY });
    return mutate(est, async (c) => {
      const previous = await one(c, 'SELECT comanda_id FROM pedidos WHERE estabelecimento_id = $1 AND id = $2', [est, id]);
      if (previous) {
        // Reenvio do mesmo pedido: já está gravado
        if (previous.comanda_id !== tabId) V.fail(409, 'Esse identificador já foi usado em outra conta.');
      } else {
        await stillOpen(c, est, tabId);
        const actor = await activeEmployee(c, est, body.garcomId);
        await c.query(
          `INSERT INTO pedidos (estabelecimento_id, id, comanda_id, produto, produto_chave, quantidade, garcom_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [est, id, tabId, nome, Billing.norm(nome), qty, actor.id]
        );
      }
      return { comanda: await tabView(c, est, tabId) };
    });
  }

  /** Corrige um pedido. Nada é apagado: fica registrado quem cancelou. */
  function cancelOrder(est, tabId, orderId, body) {
    const id = V.id(body.id);
    const qty = V.integer(body.quantidade, { field: 'Quantidade', min: 1, max: MAX_QTY });
    return mutate(est, async (c) => {
      const previous = await one(c, 'SELECT * FROM eventos WHERE estabelecimento_id = $1 AND id = $2', [est, id]);
      if (previous) {
        if (previous.tipo !== 'cancelar' || json(previous.detalhes).pedidoId !== orderId) {
          V.fail(409, 'Esse identificador já foi usado.');
        }
      } else {
        await stillOpen(c, est, tabId);
        const actor = await activeEmployee(c, est, body.garcomId);
        const order = (await one(
          c, 'SELECT * FROM pedidos WHERE estabelecimento_id = $1 AND comanda_id = $2 AND id = $3', [est, tabId, orderId]
        )) || V.fail(404, 'Pedido não encontrado.');
        if (qty > order.quantidade - order.cancelada) V.fail(409, 'Esse pedido não tem essa quantidade para cancelar.');
        await c.query(
          'UPDATE pedidos SET cancelada = cancelada + $3 WHERE estabelecimento_id = $1 AND id = $2', [est, orderId, qty]
        );
        await record(c, est, {
          id, tipo: 'cancelar', comandaId: tabId, garcomId: actor.id,
          detalhes: { pedidoId: orderId, produto: order.produto, quantidade: qty }
        });
      }
      return { comanda: await tabView(c, est, tabId) };
    });
  }

  /* ---------- Encerrar e reabrir ---------- */

  /**
   * O aparelho manda o total que mostrou na tela. Se outro garçom lançou algo
   * (ou o preço mudou) nesse meio tempo, a conta não é encerrada.
   */
  function closeTab(est, id, body) {
    if (!Billing.METHODS.some((m) => m.id === body.forma)) V.fail(400, 'Escolha a forma de pagamento.');
    const expected = V.integer(body.totalEsperadoCentavos, {
      field: 'Total', min: 0, max: Number.MAX_SAFE_INTEGER
    });
    return mutate(est, async (c) => {
      const tab = await requiredTab(c, est, id);
      if (tab.encerrada_em) {
        const paid = json(tab.pagamento);
        if (paid.forma !== body.forma || paid.totalCentavos !== expected) V.fail(409, 'Essa conta já foi encerrada.');
        return { comanda: await tabView(c, est, id) };
      }
      const actor = await activeEmployee(c, est, body.garcomId);
      const bill = await billFor(c, est, id);
      if (!bill.lines.length) V.fail(409, 'Não dá para encerrar uma conta sem consumo.');
      if (bill.totalCents !== expected) V.fail(409, 'O valor da conta mudou. Confira o novo total antes de encerrar.');

      // Os valores ficam guardados: mudar o preço depois não altera esta conta
      const payment = {
        forma: body.forma,
        totalCentavos: bill.totalCents,
        semPreco: bill.missing,
        itens: bill.lines.map((l) => ({
          produto: l.product, quantidade: l.qty, unitarioCentavos: l.unitCents, totalCentavos: l.totalCents
        }))
      };
      await c.query(
        `UPDATE comandas SET encerrada_em = now(), encerrada_por = $3, pagamento = $4::jsonb
          WHERE estabelecimento_id = $1 AND id = $2`,
        [est, id, actor.id, JSON.stringify(payment)]
      );
      await record(c, est, { tipo: 'encerrar', comandaId: id, garcomId: actor.id, detalhes: payment });
      return { comanda: await tabView(c, est, id) };
    });
  }

  /** Reabrir apaga o pagamento da conta, mas ele continua no histórico de eventos. */
  function reopenTab(est, id, body) {
    return mutate(est, async (c) => {
      const tab = await requiredTab(c, est, id);
      if (tab.encerrada_em) {
        const actor = await activeEmployee(c, est, body.garcomId);
        await record(c, est, {
          tipo: 'reabrir', comandaId: id, garcomId: actor.id, detalhes: json(tab.pagamento)
        });
        await c.query(
          `UPDATE comandas SET encerrada_em = NULL, encerrada_por = NULL, pagamento = NULL
            WHERE estabelecimento_id = $1 AND id = $2`,
          [est, id]
        );
      }
      return { comanda: await tabView(c, est, id) };
    });
  }

  return {
    data, history,
    addEmployee, updateEmployee,
    addProduct, updateProduct, removeProduct,
    openTab, updateTab, removeTab,
    addOrder, cancelOrder,
    closeTab, reopenTab
  };
}

module.exports = { createOperation };
