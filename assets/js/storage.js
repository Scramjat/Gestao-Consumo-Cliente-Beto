/* =========================================================
   Dados: clientes, consumo, preços e pagamento
   Fica salvo no navegador (localStorage) e é espelhado
   no cofre do Obsidian pelo servidor (ver obsidian.js).
   ========================================================= */

const Store = (() => {
  const KEY = 'comanda:estado:v1';
  // Lista antiga de "produtos mais pedidos" (não é mais usada): apaga do aparelho
  try { localStorage.removeItem('comanda:produtos:v1'); } catch { /* ignora */ }

  const listeners = new Set();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blank() {
    const now = new Date().toISOString();
    // pristine = lista recém-criada e nunca alterada; nunca deve sobrescrever o banco
    return { version: 3, updatedAt: now, products: [], clients: [], pristine: true };
  }

  function isValidState(s) {
    return s && typeof s === 'object' && Array.isArray(s.clients);
  }

  /**
   * Cada item guarda seus pedidos: orders = [{ qty, at }].
   * Converte dados antigos (com "noite" e sem horário por pedido).
   */
  function migrate(s) {
    delete s.nightId;
    delete s.seq;
    delete s.startedAt;
    s.version = 3;
    s.clients.forEach((c) => { if (typeof c.attendant !== 'string') c.attendant = ''; });
    // Lista de produtos e preços (cadastrada pelo administrador)
    if (!Array.isArray(s.products)) s.products = [];
    s.clients.forEach((c) => c.items.forEach((item) => {
      if (!Array.isArray(item.orders) || !item.orders.length) {
        item.orders = [{ qty: item.qty, at: item.addedAt || c.createdAt }];
      }
      item.qty = item.orders.reduce((sum, o) => sum + o.qty, 0);
    }));
    return s;
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      return isValidState(s) ? migrate(s) : blank();
    } catch {
      return blank();
    }
  }

  let state = load();

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('Falha ao salvar localmente', e); }
  }

  function emit(reason) {
    listeners.forEach((fn) => fn(state, reason));
  }

  function commit(reason) {
    delete state.pristine;
    state.updatedAt = new Date().toISOString();
    persist();
    emit(reason);
  }

  const clean = (text) => String(text).trim().replace(/\s+/g, ' ');
  const findClient = (id) => state.clients.find((c) => c.id === id);
  const recount = (item) => { item.qty = item.orders.reduce((sum, o) => sum + o.qty, 0); };

  return {
    isValidState,

    get: () => state,
    getClient: findClient,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    addClient({ name, cpf, table, attendant }) {
      const client = {
        id: uid(),
        name: clean(name),
        cpf: Utils.onlyDigits(cpf),
        table: clean(table || ''),
        attendant: clean(attendant || ''),   // pronto para o futuro (Features.attendant)
        createdAt: new Date().toISOString(),
        items: []
      };
      state.clients.push(client);
      commit({ type: 'client:add', clientId: client.id });
      return client;
    },

    updateClient(id, { name, cpf, table, attendant }) {
      const c = findClient(id);
      if (!c) return null;
      c.name = clean(name);
      c.cpf = Utils.onlyDigits(cpf);
      c.table = clean(table || '');
      c.attendant = clean(attendant || '');
      commit({ type: 'client:update', clientId: id });
      return c;
    },

    /** Só remove clientes sem consumo. Retorna {client, index} para permitir desfazer. */
    removeClient(id) {
      const index = state.clients.findIndex((c) => c.id === id);
      const client = state.clients[index];
      if (!client || client.items.length) return null;
      state.clients.splice(index, 1);
      commit({ type: 'client:remove', clientId: id });
      return { client, index };
    },

    restoreClient(client, index) {
      state.clients.splice(Math.min(index, state.clients.length), 0, client);
      commit({ type: 'client:restore', clientId: client.id });
    },

    /**
     * Encerra a conta (cliente pagou e foi embora). Só vale para quem consumiu.
     * Guarda uma cópia dos valores na hora do pagamento: mudar o preço depois
     * não altera contas já encerradas.
     */
    closeClient(id, method) {
      const c = findClient(id);
      if (!c || c.closedAt || !c.items.length) return null;
      if (!Billing.METHODS.some((m) => m.id === method)) return null;
      const b = Billing.bill(c, state.products);
      const now = new Date().toISOString();
      c.closedAt = now;
      c.payment = { method, totalCents: b.totalCents, missing: b.missing, items: b.lines, paidAt: now };
      commit({ type: 'client:close', clientId: id });
      return c;
    },

    /** Desfaz o encerramento (ex.: encerrou por engano ou o cliente voltou a pedir). */
    reopenClient(id) {
      const c = findClient(id);
      if (!c || !c.closedAt) return null;
      delete c.closedAt;
      delete c.payment;
      commit({ type: 'client:reopen', clientId: id });
      return c;
    },

    /** Registra um pedido. Se o produto já foi pedido, soma na mesma linha e guarda o novo horário. */
    addItem(clientId, product, qty) {
      const c = findClient(clientId);
      if (!c || c.closedAt) return null;
      const name = clean(product);
      const order = { qty, at: new Date().toISOString() };
      let item = c.items.find((i) => i.product.toLowerCase() === name.toLowerCase());
      const isNew = !item;
      if (item) {
        item.orders.push(order);
      } else {
        item = { id: uid(), product: name, qty: 0, orders: [order] };
        c.items.push(item);
      }
      recount(item);
      commit({ type: 'item:add', clientId, itemId: item.id, isNew });
      return item;
    },

    /**
     * +1 registra um novo pedido agora. −1 corrige o pedido mais recente.
     * Se a quantidade chegar a zero o item sai da lista.
     */
    changeQty(clientId, itemId, delta) {
      const c = findClient(clientId);
      const index = c && !c.closedAt ? c.items.findIndex((i) => i.id === itemId) : -1;
      if (index < 0) return null;
      const item = c.items[index];

      let before = null;
      if (delta > 0) {
        item.orders.push({ qty: delta, at: new Date().toISOString() });
      } else {
        const last = item.orders[item.orders.length - 1];
        before = { ...last };
        last.qty += delta;
        if (last.qty <= 0) item.orders.pop();
      }
      recount(item);

      if (!item.orders.length) {
        c.items.splice(index, 1);
        commit({ type: 'item:remove', clientId, itemId });
        return { removed: item, index, lastOrder: before };
      }
      commit({ type: 'item:qty', clientId, itemId });
      return { item };
    },

    /** Desfaz a remoção de um item (volta com o último pedido que foi tirado). */
    restoreItem(clientId, item, index, lastOrder) {
      const c = findClient(clientId);
      if (!c) return;
      if (lastOrder) item.orders = [lastOrder];
      recount(item);
      c.items.splice(Math.min(index, c.items.length), 0, item);
      commit({ type: 'item:add', clientId, itemId: item.id, isNew: true });
    },

    /** Substitui tudo (dados vindos do Obsidian ou de outra aba). Não altera updatedAt. */
    replace(next) {
      if (!isValidState(next)) return;
      state = migrate(next);
      persist();
      emit({ type: 'replace' });
    },

    /* ---------- Produtos e preços (administrador) ---------- */
    products: () => state.products,

    /** Retorna { ok: true, product } ou { ok: false, error }. */
    addProduct({ name, price }) {
      const n = clean(name || '');
      if (n.length < 2) return { ok: false, error: 'Digite o nome do produto.' };
      if (price == null) return { ok: false, error: 'Digite um preço válido, por exemplo 5,00.' };
      if (Billing.findProduct(state.products, n)) return { ok: false, error: 'Esse produto já está na lista.' };
      const product = { id: uid(), name: n, price };
      state.products.push(product);
      commit({ type: 'product:add', productId: product.id });
      return { ok: true, product };
    },

    updateProduct(id, { name, price }) {
      const p = state.products.find((x) => x.id === id);
      if (!p) return { ok: false, error: 'Produto não encontrado.' };
      const n = clean(name || '');
      if (n.length < 2) return { ok: false, error: 'Digite o nome do produto.' };
      if (price == null) return { ok: false, error: 'Digite um preço válido, por exemplo 5,00.' };
      const other = Billing.findProduct(state.products, n);
      if (other && other.id !== id) return { ok: false, error: 'Já existe outro produto com esse nome.' };
      p.name = n;
      p.price = price;
      commit({ type: 'product:update', productId: id });
      return { ok: true, product: p };
    },

    removeProduct(id) {
      const index = state.products.findIndex((x) => x.id === id);
      if (index < 0) return null;
      const [product] = state.products.splice(index, 1);
      commit({ type: 'product:remove', productId: id });
      return { product, index };
    },

    restoreProduct(product, index) {
      state.products.splice(Math.min(index, state.products.length), 0, product);
      commit({ type: 'product:add', productId: product.id });
    },

    /** Conta do cliente com valores (ver billing.js). */
    billOf: (client) => Billing.bill(client, state.products),

    /** Tudo o que precisa para restaurar o sistema em outro aparelho. */
    backup() {
      return { app: 'comanda', version: 3, exportedAt: new Date().toISOString(), estado: state };
    },

    /** Restaura um backup. Retorna false se o arquivo não for um backup válido. */
    restore(data) {
      if (!data || data.app !== 'comanda' || !isValidState(data.estado)) return false;
      const next = migrate(JSON.parse(JSON.stringify(data.estado)));
      delete next.pristine;
      next.updatedAt = new Date().toISOString();
      state = next;
      commit({ type: 'restore' });
      return true;
    },

    /** Recarrega do localStorage quando outra aba altera os dados. */
    reloadFromStorage() {
      state = load();
      emit({ type: 'replace' });
    },

    STORAGE_KEY: KEY
  };
})();
