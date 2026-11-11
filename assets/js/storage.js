/* =========================================================
   Dados: clientes, consumo e o horário de cada pedido
   Fica salvo no navegador (localStorage) e é espelhado
   no cofre do Obsidian pelo servidor (ver obsidian.js).
   ========================================================= */

const Store = (() => {
  const KEY = 'comanda:estado:v1';
  const PRODUCTS_KEY = 'comanda:produtos:v1';

  const listeners = new Set();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blank() {
    const now = new Date().toISOString();
    // pristine = lista recém-criada e nunca alterada; nunca deve sobrescrever o banco
    return { version: 2, updatedAt: now, clients: [], pristine: true };
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
    s.version = 2;
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

  function loadProducts() {
    try { return JSON.parse(localStorage.getItem(PRODUCTS_KEY)) || {}; } catch { return {}; }
  }

  let state = load();
  let products = loadProducts();

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

  function countProduct(name) {
    const key = name.toLowerCase();
    products[key] = { name, count: (products[key]?.count || 0) + 1 };
    try { localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)); } catch { /* ignora */ }
  }

  return {
    isValidState,

    get: () => state,
    getClient: findClient,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    addClient({ name, cpf, table }) {
      const client = {
        id: uid(),
        name: clean(name),
        cpf: Utils.onlyDigits(cpf),
        table: clean(table || ''),
        createdAt: new Date().toISOString(),
        items: []
      };
      state.clients.push(client);
      commit({ type: 'client:add', clientId: client.id });
      return client;
    },

    updateClient(id, { name, cpf, table }) {
      const c = findClient(id);
      if (!c) return null;
      c.name = clean(name);
      c.cpf = Utils.onlyDigits(cpf);
      c.table = clean(table || '');
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

    /** Encerra a conta (cliente pagou e foi embora). Só vale para quem consumiu. */
    closeClient(id) {
      const c = findClient(id);
      if (!c || c.closedAt || !c.items.length) return null;
      c.closedAt = new Date().toISOString();
      commit({ type: 'client:close', clientId: id });
      return c;
    },

    /** Desfaz o encerramento (ex.: encerrou por engano ou o cliente voltou a pedir). */
    reopenClient(id) {
      const c = findClient(id);
      if (!c || !c.closedAt) return null;
      delete c.closedAt;
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
      countProduct(item.product);
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

    topProducts(limit = 8) {
      return Object.values(products)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map((p) => p.name);
    },

    allProducts() {
      return Object.values(products).map((p) => p.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    },

    /** Substitui tudo (dados vindos do Obsidian ou de outra aba). Não altera updatedAt. */
    replace(next) {
      if (!isValidState(next)) return;
      state = migrate(next);
      persist();
      emit({ type: 'replace' });
    },

    /** Tudo o que precisa para restaurar o sistema em outro aparelho. */
    backup() {
      return { app: 'comanda', version: 2, exportedAt: new Date().toISOString(), estado: state, produtos: products };
    },

    /** Restaura um backup. Retorna false se o arquivo não for um backup válido. */
    restore(data) {
      if (!data || data.app !== 'comanda' || !isValidState(data.estado)) return false;
      const next = migrate(JSON.parse(JSON.stringify(data.estado)));
      delete next.pristine;
      next.updatedAt = new Date().toISOString();
      products = data.produtos && typeof data.produtos === 'object' ? data.produtos : {};
      try { localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)); } catch { /* ignora */ }
      state = next;
      commit({ type: 'restore' });
      return true;
    },

    /** Recarrega do localStorage quando outra aba altera os dados. */
    reloadFromStorage() {
      state = load();
      products = loadProducts();
      emit({ type: 'replace' });
    },

    STORAGE_KEY: KEY
  };
})();
