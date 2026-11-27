/* =========================================================
   Dados na tela
   O servidor é a única fonte. A cada poucos segundos o aparelho
   pergunta se houve novidade (pelo número da revisão); depois de
   cada ação, busca os dados na hora.

   Também guarda quem está atendendo neste aparelho.
   ========================================================= */

const Store = (() => {
  const POLL_MS = 4000;
  const waiterKey = () => `comanda:garcom:${Api.establishment()?.id}`;

  const listeners = new Set();
  const blank = () => ({ revision: null, employees: [], products: [], clients: [] });
  let state = blank();
  let waiterId = null;
  let timer = null;
  let generation = 0;           // muda ao sair: descarta respostas atrasadas
  let pending = Promise.resolve();

  const emit = () => listeners.forEach((fn) => fn(state));

  /* ---------- Do formato do servidor para o da tela ---------- */
  function toItems(orders) {
    const items = new Map();
    for (const o of orders) {
      const qty = o.quantidade - o.cancelada;
      if (!qty) continue;
      const key = Billing.norm(o.produto);
      if (!items.has(key)) items.set(key, { key, product: o.produto, qty: 0, orders: [] });
      const item = items.get(key);
      item.qty += qty;
      item.orders.push({ id: o.id, qty, at: o.criadoEm, waiterId: o.garcomId });
    }
    return [...items.values()];
  }

  const toPayment = (p) => p && {
    method: p.forma,
    totalCents: p.totalCentavos,
    missing: p.semPreco,
    items: p.itens.map((i) => ({
      product: i.produto, qty: i.quantidade, unitCents: i.unitarioCentavos, totalCents: i.totalCentavos
    }))
  };

  const toClient = (c) => ({
    id: c.id,
    name: c.cliente,
    cpf: c.cpf,
    table: c.mesa,
    waiterId: c.garcomId,
    createdAt: c.criadaEm,
    closedAt: c.encerradaEm,
    closedBy: c.encerradaPor,
    payment: toPayment(c.pagamento),
    items: toItems(c.pedidos)
  });

  /** Equipe, preços e contas, vindos de /api/dados ou do histórico. */
  const fromServer = (data) => ({
    employees: data.funcionarios.map((f) => ({ id: f.id, name: f.nome, active: f.ativo })),
    products: data.produtos.map((p) => ({ id: p.id, name: p.nome, priceCents: p.precoCentavos, price: p.precoCentavos / 100 })),
    clients: data.comandas.map(toClient)
  });

  function apply(data) {
    if (data.semMudancas || (state.revision !== null && data.revisao < state.revision)) return;
    state = { revision: data.revisao, ...fromServer(data) };
    emit();
  }

  /** Busca as novidades. As buscas entram em fila, para uma resposta antiga não passar na frente. */
  function refresh() {
    const run = pending.catch(() => {}).then(async () => {
      if (!Api.hasSession()) return;
      const mine = generation;
      const since = state.revision === null ? '' : `?revisao=${state.revision}`;
      try {
        const data = await Api.request('GET', `/api/dados${since}`);
        if (mine === generation) apply(data);
      } catch (e) {
        if (e.status === 403 && mine === generation) Api.block(e.message);
        throw e;
      }
    });
    pending = run;
    return run;
  }

  const quietRefresh = () => refresh().catch(() => {});

  function schedule() {
    clearTimeout(timer);
    const mine = generation;
    timer = setTimeout(async () => {
      if (!document.hidden) await quietRefresh();
      if (mine === generation) schedule();
    }, POLL_MS);
  }

  /* ---------- Ações ---------- */

  /**
   * Envia uma ação e atualiza a tela, tenha dado certo ou não (um erro costuma
   * significar que outro aparelho mudou a conta).
   */
  async function send(method, url, body, options = {}) {
    try {
      return await Api.request(method, url, { body, retry: 2, ...options });
    } catch (e) {
      if (e.status === 403 && !options.manager) Api.block(e.message);
      throw e;
    } finally {
      await quietRefresh();
    }
  }

  const tabUrl = (id, rest = '') => `/api/comandas/${id}${rest}`;
  const asWaiter = (body = {}) => ({ ...body, garcomId: waiterId });
  const manager = { manager: true };

  const tabBody = ({ name, cpf, table, responsibleId }) => asWaiter({
    cliente: name, cpf, mesa: table, responsavelId: responsibleId
  });

  const findEmployee = (id) => state.employees.find((e) => e.id === id);

  return {
    fromServer,
    subscribe: (fn) => { listeners.add(fn); },
    get: () => state,
    isLoaded: () => state.revision !== null,
    getClient: (id) => state.clients.find((c) => c.id === id),
    products: () => state.products,

    /** Conta com valores (aberta: preços de agora; encerrada: os do pagamento). */
    billOf: (client) => Billing.bill(client, state.products),

    start() {
      waiterId = null;
      try { waiterId = localStorage.getItem(waiterKey()); } catch { /* ignora */ }
      schedule();
      return quietRefresh();
    },

    stop() {
      generation += 1;
      clearTimeout(timer);
      state = blank();
      waiterId = null;
      emit();
    },

    refresh: quietRefresh,

    /* ---------- Quem está atendendo ---------- */
    activeEmployees: () => state.employees.filter((e) => e.active),
    employeeName: (id) => findEmployee(id)?.name || '—',
    /** O funcionário escolhido neste aparelho, se ele ainda estiver ativo. */
    waiter: () => {
      const found = findEmployee(waiterId);
      return found?.active ? found : null;
    },
    setWaiter(id) {
      waiterId = id;
      try { localStorage.setItem(waiterKey(), id); } catch { /* ignora */ }
      emit();
    },

    /* ---------- Contas e pedidos ---------- */
    openTab: (id, fields) => send('POST', '/api/comandas', { id, ...tabBody(fields) }),
    updateTab: (id, fields) => send('PATCH', tabUrl(id), tabBody(fields)),
    removeTab: (id) => send('DELETE', tabUrl(id), asWaiter(), { retry: 0 }),

    addOrder: (tabId, id, product, qty) => send(
      'POST', tabUrl(tabId, '/pedidos'), asWaiter({ id, produto: product, quantidade: qty })
    ),
    cancelUnit: (tabId, orderId) => send(
      'POST', tabUrl(tabId, `/pedidos/${orderId}/cancelar`), asWaiter({ id: Api.newId(), quantidade: 1 })
    ),

    closeTab: (id, method, totalCents) => send(
      'POST', tabUrl(id, '/encerrar'), asWaiter({ forma: method, totalEsperadoCentavos: totalCents })
    ),
    reopenTab: (id) => send('POST', tabUrl(id, '/reabrir'), asWaiter()),

    /* ---------- Gerência ---------- */
    addEmployee: (id, name) => send('POST', '/api/funcionarios', { id, nome: name }, manager),
    updateEmployee: (id, { name, active }) => send(
      'PATCH', `/api/funcionarios/${id}`, { nome: name, ativo: active }, manager
    ),
    addProduct: (id, name, priceCents) => send(
      'POST', '/api/produtos', { id, nome: name, precoCentavos: priceCents }, manager
    ),
    updateProduct: (id, name, priceCents) => send(
      'PATCH', `/api/produtos/${id}`, { nome: name, precoCentavos: priceCents }, manager
    ),
    removeProduct: (id) => send('DELETE', `/api/produtos/${id}`, undefined, { ...manager, retry: 0 })
  };
})();
