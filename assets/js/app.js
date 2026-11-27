/* =========================================================
   Controlador principal: liga a interface aos dados
   ========================================================= */

(() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Utils.escapeHTML;

  const els = {
    brandTitle: $('#brandTitle'),
    todayLabel: $('#todayLabel'),
    list: $('#clientList'),
    loading: $('#loadingState'),
    empty: $('#emptyState'),
    noResults: $('#noResults'),
    search: $('#searchInput'),
    waiterFilter: $('#waiterFilter'),
    filterGroup: $('#filterGroup'),
    statsGroup: $('#statsGroup'),
    itemsDialog: $('#itemsDialog'),
    itemsDialogSub: $('#itemsDialogSub'),
    itemsViewGroup: $('#itemsView'),
    itemsReport: $('#itemsReport'),
    statClients: $('#statClients'),
    statItems: $('#statItems'),
    statIdle: $('#statIdle'),
    statConsuming: $('#statConsuming'),
    statClosed: $('#statClosed'),
    countAll: $('#countAll'),
    countConsuming: $('#countConsuming'),
    countIdle: $('#countIdle'),
    countClosed: $('#countClosed'),
    noResultsTitle: $('#noResultsTitle'),
    noResultsText: $('#noResultsText'),
    dbBanner: $('#dbBanner'),

    clientDialog: $('#clientDialog'),
    clientForm: $('#clientForm'),
    clientDialogTitle: $('#clientDialogTitle'),
    clientName: $('#clientName'),
    clientCpf: $('#clientCpf'),
    clientTable: $('#clientTable'),
    clientWaiter: $('#clientWaiter'),
    nameError: $('#nameError'),
    cpfError: $('#cpfError'),
    clientError: $('#clientError'),

    itemDialog: $('#itemDialog'),
    itemForm: $('#itemForm'),
    itemDialogClient: $('#itemDialogClient'),
    itemWaiter: $('#itemWaiter'),
    itemProduct: $('#itemProduct'),
    itemQty: $('#itemQty'),
    productError: $('#itemError'),
    productSuggest: $('#productSuggest'),
    productHint: $('#productHint'),
    itemCurrent: $('#itemCurrent'),

    loginDialog: $('#loginDialog'),
    loginForm: $('#loginForm'),
    loginUser: $('#loginUser'),
    loginPass: $('#loginPass'),
    loginError: $('#loginError'),
    loginSubmit: $('#loginSubmit'),

    closeDialog: $('#closeDialog'),
    closeForm: $('#closeForm'),
    closeSub: $('#closeSub'),
    closeBill: $('#closeBill'),
    closeWarning: $('#closeWarning'),
    closeTotal: $('#closeTotal'),
    closeConfirm: $('#closeConfirm'),
    payOptions: $('#payOptions'),
    payError: $('#payError')
  };

  const LAST_LOGIN_KEY = 'comanda:ultimoLogin';

  let filter = 'all';
  let waiterFilter = '';          // '' = todos, 'mine' = minhas mesas, ou o id de um garçom
  let query = '';
  const busy = new Set();         // contas com uma ação a caminho do servidor

  /* =====================================================
     Renderização
     ===================================================== */
  function visibleClients(clients) {
    const q = Utils.normalize(query);
    const qDigits = Utils.onlyDigits(query);
    // Aceita "5", "mesa 5" ou "m5"
    const qTable = q.replace(/^(mesa|m)\s*/, '');
    const only = waiterFilter === 'mine' ? Store.waiter()?.id : waiterFilter;
    const shown = clients.filter((c) => {
      // Contas encerradas só aparecem na aba "Concluídos"
      if (filter === 'closed') { if (!c.closedAt) return false; }
      else if (c.closedAt) return false;
      if (filter === 'consuming' && !c.items.length) return false;
      if (filter === 'idle' && c.items.length) return false;
      if (waiterFilter && c.waiterId !== only) return false;
      if (!q) return true;
      return Utils.normalize(c.name).includes(q)
        // Mesa: número exato, para "5" não trazer a mesa 15
        || (c.table && Utils.normalize(c.table) === qTable)
        || Utils.normalize(Store.employeeName(c.waiterId)).includes(q)
        // CPF: a partir de 3 números, para não confundir com o número da mesa
        || (qDigits.length >= 3 && c.cpf.includes(qDigits));
    });

    // Abertos: últimos cadastrados primeiro. Concluídos: últimos encerrados primeiro.
    return filter === 'closed'
      ? shown.sort((a, b) => b.closedAt.localeCompare(a.closedAt))
      : shown.reverse();
  }

  const emptyMessages = {
    all: ['Ninguém na casa', 'Todas as contas foram encerradas. Veja em Concluídos.'],
    consuming: ['Ninguém consumindo', 'Nenhuma conta aberta com consumo lançado.'],
    idle: ['Todo mundo já pediu', 'Não há contas abertas sem consumo.'],
    closed: ['Nenhuma conta encerrada', 'Aqui aparecem as contas encerradas nas últimas 24 horas.']
  };

  let waiterOptions = '';

  function renderWaiterFilter() {
    const html = '<option value="">Todos os garçons</option><option value="mine">Minhas mesas</option>'
      + Store.get().employees
        .filter((p) => p.active || Store.get().clients.some((c) => c.waiterId === p.id))
        .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (html === waiterOptions) return;
    els.waiterFilter.innerHTML = html;
    waiterOptions = html;
    els.waiterFilter.value = waiterFilter;
    if (els.waiterFilter.value !== waiterFilter) waiterFilter = els.waiterFilter.value = '';
  }

  function render() {
    const { clients } = Store.get();
    const loaded = Store.isLoaded();

    els.brandTitle.textContent = Api.establishment()?.nome || 'Comanda';
    els.todayLabel.textContent = Utils.formatToday();
    renderWaiterFilter();

    const totalItems = clients.reduce((s, c) => s + c.items.reduce((t, i) => t + i.qty, 0), 0);
    const open = clients.filter((c) => !c.closedAt);
    const consuming = open.filter((c) => c.items.length).length;
    const closed = clients.length - open.length;
    UI.setStat(els.statClients, open.length);
    UI.setStat(els.statItems, totalItems);
    UI.setStat(els.statConsuming, consuming);
    UI.setStat(els.statIdle, open.length - consuming);
    UI.setStat(els.statClosed, closed);
    els.countAll.textContent = open.length;
    els.countConsuming.textContent = consuming;
    els.countIdle.textContent = open.length - consuming;
    els.countClosed.textContent = closed;

    const shown = visibleClients(clients);
    UI.renderList(els.list, shown);

    els.loading.hidden = loaded || !Api.hasSession();
    els.empty.hidden = !loaded || clients.length > 0;
    els.noResults.hidden = !loaded || !clients.length || shown.length > 0;
    if (!els.noResults.hidden) {
      const [title, text] = query.trim() || waiterFilter
        ? ['Nada encontrado', 'Nenhuma conta corresponde à busca ou ao garçom nesta aba.']
        : emptyMessages[filter];
      els.noResultsTitle.textContent = title;
      els.noResultsText.textContent = text;
    }
  }

  /**
   * Roda uma ação numa conta, uma por vez. Mostra o erro do servidor.
   * Devolve true quando deu certo.
   */
  async function runOnTab(tabId, action) {
    if (busy.has(tabId)) return false;
    busy.add(tabId);
    try {
      await action();
      return true;
    } catch (e) {
      if (Api.hasSession()) UI.toast(e.message, { type: 'error' });
      return false;
    } finally {
      busy.delete(tabId);
    }
  }

  /* =====================================================
     Cliente: abrir conta / editar / excluir
     ===================================================== */
  let editingId = null;     // conta sendo editada (null = nova)
  let newTabId = null;      // identificador da conta que está sendo criada

  function fillResponsible(selectedId) {
    const people = Store.get().employees.filter((p) => p.active || p.id === selectedId);
    els.clientWaiter.innerHTML = people
      .map((p) => `<option value="${p.id}">${esc(p.name)}${p.active ? '' : ' (desativado)'}</option>`).join('');
    els.clientWaiter.value = selectedId;
  }

  async function openClientDialog(clientId = null) {
    if (!(await Waiter.ensure())) return;
    const client = clientId ? Store.getClient(clientId) : null;
    if (clientId && !client) return;
    editingId = clientId;
    newTabId = clientId ? null : Api.newId();
    els.clientDialogTitle.textContent = client ? 'Editar conta' : 'Novo cliente';
    els.clientName.value = client ? client.name : '';
    els.clientCpf.value = client?.cpf ? Utils.formatCPF(client.cpf) : '';
    els.clientTable.value = client?.table || '';
    fillResponsible(client ? client.waiterId : Store.waiter().id);
    UI.setFieldError(els.clientName, els.nameError, '');
    UI.setFieldError(els.clientCpf, els.cpfError, '');
    els.clientError.textContent = '';
    UI.Modal.open(els.clientDialog);
    els.clientName.focus();
  }

  function validateClient() {
    const name = els.clientName.value.trim();
    const cpf = Utils.onlyDigits(els.clientCpf.value);
    const nameMsg = name.length < 2 ? 'Digite o nome do cliente.' : '';
    let cpfMsg = '';
    if (cpf) {
      if (cpf.length !== 11) cpfMsg = 'O CPF precisa ter 11 números.';
      else if (!Utils.isValidCPF(cpf)) cpfMsg = 'CPF inválido. Confira os números.';
      else {
        const dup = Store.get().clients.find((c) => !c.closedAt && c.cpf === cpf && c.id !== editingId);
        if (dup) cpfMsg = `Este CPF já está numa conta aberta de ${dup.name}.`;
      }
    }
    UI.setFieldError(els.clientName, els.nameError, nameMsg);
    UI.setFieldError(els.clientCpf, els.cpfError, cpfMsg);
    if (nameMsg || cpfMsg) return null;
    return { name, cpf, table: els.clientTable.value.trim(), responsibleId: els.clientWaiter.value };
  }

  async function saveClient(e) {
    e.preventDefault();
    const fields = validateClient();
    if (!fields) {
      els.clientForm.querySelector('.has-error input')?.focus();
      return;
    }
    if (!(await Waiter.ensure())) return;
    await UI.whileBusy(els.clientForm.querySelector('[type="submit"]'), async () => {
      try {
        // Sem mudança, não envia o responsável (ele pode já estar desativado)
        if (editingId) {
          const current = Store.getClient(editingId);
          if (current?.waiterId === fields.responsibleId) delete fields.responsibleId;
          await Store.updateTab(editingId, fields);
        } else {
          await Store.openTab(newTabId, fields);
        }
      } catch (err) {
        els.clientError.textContent = err.message;
        return;
      }
      UI.toast(editingId ? 'Conta atualizada' : `Conta de ${fields.name} aberta`, { type: 'success' });
      UI.Modal.close(els.clientDialog);
    });
  }

  async function deleteClient(clientId, card) {
    const client = Store.getClient(clientId);
    if (!client) return;
    if (client.items.length) {
      UI.shake(card);
      UI.toast('Este cliente já consumiu e não pode ser excluído.', { type: 'warning' });
      return;
    }
    if (!(await Waiter.ensure())) return;
    const ok = await UI.confirm({
      title: `Excluir ${client.name}?`,
      message: 'A conta será removida da lista.',
      confirmText: 'Excluir'
    });
    if (!ok) return;
    if (await runOnTab(clientId, () => Store.removeTab(clientId))) {
      UI.toast(`${client.name} foi excluído`, { type: 'info' });
    }
  }

  /* =====================================================
     Encerrar / reabrir conta
     ===================================================== */
  let closingId = null;
  let closingTotal = 0;       // o total que está na tela é o que vai para o servidor
  let closingSignature = '';

  function billTable(bill) {
    const rows = bill.lines.map((l) => `
      <tr${l.unitCents == null ? ' class="is-missing"' : ''}>
        <td class="num">${l.qty}</td>
        <td>${esc(l.product)}</td>
        <td class="num">${l.unitCents == null ? '—' : Billing.money(l.unitCents)}</td>
        <td class="num">${l.totalCents == null ? 'sem preço' : Billing.money(l.totalCents)}</td>
      </tr>`).join('');
    return `<table class="bill-table">
      <thead><tr><th class="num">Qtd</th><th>Produto</th><th class="num">Valor unitário</th><th class="num">Valor total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  /** Desenha a conta. Devolve true se ela mudou desde o último desenho. */
  function renderCloseBill(client) {
    const bill = Store.billOf(client);
    const signature = JSON.stringify(bill.lines);
    const changed = signature !== closingSignature;
    closingSignature = signature;
    closingTotal = bill.totalCents;

    const table = client.table ? ` · Mesa ${esc(client.table)}` : '';
    els.closeSub.innerHTML = `<strong>${esc(client.name)}</strong>${table} · ${esc(Store.employeeName(client.waiterId))}`;
    els.closeBill.innerHTML = billTable(bill);
    els.closeTotal.textContent = Billing.money(bill.totalCents);
    els.closeWarning.hidden = !bill.missing;
    if (bill.missing) {
      els.closeWarning.textContent = `${Utils.plural(bill.missing, 'item está', 'itens estão')} sem preço na lista e não ${bill.missing === 1 ? 'entra' : 'entram'} no total. O gerente pode cadastrar o preço antes de encerrar.`;
    }
    return changed;
  }

  async function openCloseDialog(clientId) {
    if (!(await Waiter.ensure())) return;
    const client = Store.getClient(clientId);
    if (!client || client.closedAt || !client.items.length) return;
    closingId = clientId;
    closingSignature = '';
    renderCloseBill(client);
    els.payOptions.innerHTML = Billing.METHODS.map((m) => `
      <label class="pay__opt">
        <input type="radio" name="pay" value="${m.id}">
        <span>${m.label}</span>
      </label>`).join('');
    els.payError.textContent = '';
    UI.Modal.open(els.closeDialog);
  }

  /** Outro aparelho mexeu na conta enquanto ela estava sendo fechada. */
  function syncCloseDialog() {
    if (!els.closeDialog.open || busy.has(closingId)) return;
    const client = Store.getClient(closingId);
    if (!client || client.closedAt || !client.items.length) {
      UI.Modal.close(els.closeDialog);
      if (client?.closedAt) UI.toast(`A conta de ${client.name} foi encerrada em outro aparelho.`, { type: 'warning' });
      return;
    }
    if (renderCloseBill(client)) {
      els.payError.textContent = 'A conta mudou agora há pouco. Confira antes de encerrar.';
      UI.shake(els.closeBill);
    }
  }

  async function confirmClose(e) {
    e.preventDefault();
    const method = els.closeForm.querySelector('input[name="pay"]:checked')?.value;
    if (!method) {
      els.payError.textContent = 'Escolha a forma de pagamento.';
      UI.shake(els.payOptions);
      return;
    }
    const id = closingId;
    const total = closingTotal;
    const client = Store.getClient(id);
    if (!client || !(await Waiter.ensure())) return;

    await UI.whileBusy(els.closeConfirm, async () => {
      let failure = null;
      await runOnTab(id, async () => {
        try { await Store.closeTab(id, method, total); } catch (err) { failure = err; }
      });
      if (failure) {
        els.payError.textContent = failure.message;
        const current = Store.getClient(id);
        if (current && !current.closedAt && current.items.length) renderCloseBill(current);
        else syncCloseDialog();
        return;
      }
      UI.Modal.close(els.closeDialog);
      UI.toast(`${client.name}: ${Billing.money(total)} no ${Billing.methodLabel(method)}`, {
        type: 'success',
        action: { label: 'Desfazer', onClick: () => reopenClient(id) }
      });
    });
  }

  async function reopenClient(clientId) {
    if (!(await Waiter.ensure())) return;
    const name = Store.getClient(clientId)?.name || '';
    if (await runOnTab(clientId, () => Store.reopenTab(clientId))) {
      UI.toast(`Conta de ${name} reaberta`, { type: 'info' });
    }
  }

  /* =====================================================
     Consumo
     ===================================================== */
  let itemClientId = null;    // conta que está recebendo consumo
  let pendingOrder = null;    // o mesmo pedido reenviado leva o mesmo identificador

  function renderCurrentItems() {
    const client = Store.getClient(itemClientId);
    els.itemCurrent.hidden = !client?.items.length;
    if (els.itemCurrent.hidden) return;
    els.itemCurrent.innerHTML = '<strong>Já pediu</strong>' + client.items
      .map((i) => `<span>${i.qty}</span> ${esc(i.product)}`)
      .join(' &nbsp;·&nbsp; ');
  }

  const renderItemWaiter = () => { els.itemWaiter.textContent = Store.waiter()?.name || '—'; };

  /* ---------- Sugestões da lista de produtos ---------- */
  let suggestIndex = -1;
  let suggestMatches = [];

  function hideSuggestions() {
    els.productSuggest.hidden = true;
    els.itemProduct.setAttribute('aria-expanded', 'false');
    suggestIndex = -1;
  }

  function matchProducts(text) {
    const q = Billing.norm(text);
    if (!q) return [];
    return Store.products()
      .filter((p) => Billing.norm(p.name).includes(q))
      .sort((a, b) => {
        const sa = Billing.norm(a.name).startsWith(q) ? 0 : 1;
        const sb = Billing.norm(b.name).startsWith(q) ? 0 : 1;
        return sa - sb || a.name.localeCompare(b.name, 'pt-BR');
      })
      .slice(0, 8);
  }

  function updateProductHint() {
    const text = els.itemProduct.value.trim();
    let msg = '';
    let warn = false;
    if (!Store.products().length) {
      msg = 'Nenhum produto cadastrado ainda. O gerente cadastra em Gerência, para a conta sair com valores.';
    } else if (text) {
      const exact = Billing.findProduct(Store.products(), text);
      if (exact) msg = `${Billing.money(exact.priceCents)} cada`;
      else { msg = 'Fora da lista: este item vai ficar sem preço na conta.'; warn = true; }
    }
    els.productHint.hidden = !msg;
    els.productHint.textContent = msg;
    els.productHint.classList.toggle('is-warn', warn);
  }

  function highlightSuggestion() {
    els.productSuggest.querySelectorAll('.suggest__item').forEach((el, i) => {
      el.classList.toggle('is-active', i === suggestIndex);
      if (i === suggestIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderSuggestions() {
    suggestMatches = matchProducts(els.itemProduct.value);
    const exact = Billing.findProduct(Store.products(), els.itemProduct.value);
    // Só mostra a lista enquanto digita, e some quando o nome já está completo
    if (!suggestMatches.length || (exact && suggestMatches.length === 1)) {
      hideSuggestions();
    } else {
      els.productSuggest.innerHTML = suggestMatches.map((p, i) => `
        <li class="suggest__item" role="option" data-index="${i}">
          <span>${esc(p.name)}</span>
          <strong>${Billing.money(p.priceCents)}</strong>
        </li>`).join('');
      els.productSuggest.hidden = false;
      els.itemProduct.setAttribute('aria-expanded', 'true');
      suggestIndex = -1;
    }
    updateProductHint();
  }

  function chooseSuggestion(index) {
    const p = suggestMatches[index];
    if (!p) return;
    els.itemProduct.value = p.name;
    UI.setFieldError(els.itemProduct, els.productError, '');
    hideSuggestions();
    updateProductHint();
    els.itemQty.focus();
    els.itemQty.select();
  }

  async function openItemDialog(clientId) {
    if (!(await Waiter.ensure())) return;
    const client = Store.getClient(clientId);
    if (!client || client.closedAt) return;
    itemClientId = clientId;
    pendingOrder = null;
    const table = client.table ? ` · Mesa ${esc(client.table)}` : '';
    els.itemDialogClient.innerHTML = `para <strong>${esc(client.name)}</strong>${table}`;
    renderItemWaiter();
    els.itemProduct.value = '';
    els.itemQty.value = 1;
    UI.setFieldError(els.itemProduct, els.productError, '');
    hideSuggestions();
    updateProductHint();
    renderCurrentItems();
    UI.Modal.open(els.itemDialog);
    els.itemProduct.focus();
  }

  function readQty() {
    const n = Math.round(Number(els.itemQty.value));
    return Number.isFinite(n) ? Math.min(999, Math.max(1, n)) : 1;
  }

  function stepQty(delta) {
    els.itemQty.value = Math.min(999, Math.max(1, readQty() + delta));
  }

  let savingItem = false;

  /** Grava o pedido. Se `keepOpen`, limpa o campo para lançar outro produto. */
  async function saveItem(keepOpen) {
    if (savingItem) return;
    const product = els.itemProduct.value.trim();
    if (product.length < 2) {
      UI.setFieldError(els.itemProduct, els.productError, 'Digite o que o cliente pediu.');
      els.itemProduct.focus();
      return;
    }
    if (!(await Waiter.ensure())) return;
    UI.setFieldError(els.itemProduct, els.productError, '');
    const qty = readQty();
    const tabId = itemClientId;
    const key = JSON.stringify([tabId, product, qty]);
    if (pendingOrder?.key !== key) pendingOrder = { key, id: Api.newId() };

    const buttons = els.itemForm.querySelectorAll('[type="submit"], #btnItemAnother');
    savingItem = true;
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await Store.addOrder(tabId, pendingOrder.id, product, qty);
    } catch (e) {
      // A janela fica aberta com o pedido, para tentar de novo
      UI.setFieldError(els.itemProduct, els.productError, e.message);
      return;
    } finally {
      savingItem = false;
      buttons.forEach((b) => { b.disabled = false; });
    }

    pendingOrder = null;
    UI.toast(`+${qty} ${product} para ${Store.getClient(tabId)?.name || ''}`, { type: 'success', duration: 2200 });

    if (keepOpen) {
      els.itemProduct.value = '';
      els.itemQty.value = 1;
      hideSuggestions();
      updateProductHint();
      renderCurrentItems();
      els.itemProduct.focus();
    } else {
      UI.Modal.close(els.itemDialog);
    }
  }

  /** + lança mais um agora. − cancela uma unidade do pedido mais recente. */
  async function changeQty(clientId, itemKey, delta) {
    if (!(await Waiter.ensure())) return;
    const client = Store.getClient(clientId);
    const item = client?.items.find((i) => i.key === itemKey);
    if (!item || busy.has(clientId)) return;

    if (delta > 0) {
      await runOnTab(clientId, () => Store.addOrder(clientId, Api.newId(), item.product, 1));
      return;
    }
    if (item.qty === 1) {
      const ok = await UI.confirm({
        title: `Tirar ${item.product}?`,
        message: `É a última unidade na conta de ${client.name}. O cancelamento fica registrado no seu nome.`,
        confirmText: 'Tirar'
      });
      if (!ok) return;
    }
    const order = item.orders[item.orders.length - 1];
    if (await runOnTab(clientId, () => Store.cancelUnit(clientId, order.id))) {
      UI.toast(`1 ${item.product} cancelado`, { type: 'info', duration: 2200 });
    }
  }

  /* =====================================================
     Entrar e sair
     ===================================================== */
  function openLogin(message = '') {
    document.body.classList.add('is-locked');
    // Fecha o que estiver aberto, para nada ficar visível depois de sair
    document.querySelectorAll('dialog[open]').forEach((d) => { if (d !== els.loginDialog) d.close(); });
    els.loginPass.value = '';
    els.loginPass.type = 'password';
    $('#loginToggle').textContent = 'Mostrar';
    els.loginError.textContent = message;
    try { els.loginUser.value = localStorage.getItem(LAST_LOGIN_KEY) || ''; } catch { /* ignora */ }
    UI.Modal.open(els.loginDialog);
    (els.loginUser.value ? els.loginPass : els.loginUser).focus();
  }

  function enter() {
    document.body.classList.remove('is-locked');
    els.dbBanner.hidden = true;
    UI.reset();
    render();
    Store.start();
    // Sem conexão agora, fica o nome guardado; a próxima abertura atualiza
    Api.refreshEstablishment().then(render).catch(() => {});
    requestAnimationFrame(() => UI.moveThumb(els.filterGroup));
  }

  function leave(message) {
    Api.logout();
    Store.stop();
    waiterFilter = '';
    query = '';
    els.search.value = '';
    els.list.innerHTML = '';
    openLogin(message);
  }

  async function submitLogin(e) {
    e.preventDefault();
    const usuario = els.loginUser.value.trim();
    const senha = els.loginPass.value;
    if (!usuario || !senha) {
      els.loginError.textContent = 'Digite o usuário e a senha.';
      UI.shake(els.loginForm.querySelector('.modal__body'));
      return;
    }
    els.loginSubmit.disabled = true;
    els.loginSubmit.textContent = 'Entrando…';
    try {
      await Api.login(usuario, senha);
      try { localStorage.setItem(LAST_LOGIN_KEY, usuario); } catch { /* ignora */ }
      els.loginPass.value = '';
      UI.Modal.close(els.loginDialog);
      enter();
    } catch (err) {
      els.loginError.textContent = err.message;
      UI.shake(els.loginForm.querySelector('.modal__body'));
      els.loginPass.focus();
      els.loginPass.select();
    } finally {
      els.loginSubmit.disabled = false;
      els.loginSubmit.textContent = 'Entrar';
    }
  }

  /* =====================================================
     Filtro segmentado
     ===================================================== */
  /** Troca o filtro e deixa as abas e os cards do resumo marcados juntos. */
  function setFilter(next, { scroll = false } = {}) {
    filter = next;
    els.filterGroup.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === next));
    els.statsGroup.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === next));
    UI.moveThumb(els.filterGroup);
    render();
    if (scroll) els.filterGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* =====================================================
     Janela "Itens pedidos"
     Só quantidades: o faturamento é assunto da gerência.
     ===================================================== */
  let itemsView = 'product';

  /** Todos os pedidos na tela, com quem pediu, quando e quem lançou. */
  function allOrders() {
    return Store.get().clients
      .flatMap((c) => c.items.flatMap((item) => item.orders.map((o) => ({
        at: o.at, qty: o.qty, key: item.key, product: item.product, waiterId: o.waiterId, client: c
      }))))
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  function clientTag(client) {
    const closed = client.closedAt ? ' <span class="tag tag--done">encerrada</span>' : '';
    const table = client.table ? ` · Mesa ${esc(client.table)}` : '';
    return `<span class="report__client" style="--hue:${Utils.hue(client.name)}">${esc(client.name)}${table}</span>${closed}`;
  }

  const waiterTag = (id) => `<span class="report__waiter">${Icons.svg('user')} ${esc(Store.employeeName(id))}</span>`;

  let shownReport = '';

  function itemsReportHtml(orders) {
    if (!orders.length) return '<p class="item-empty">Nenhum item pedido ainda.</p>';

    if (itemsView === 'time') {
      return `<ul class="report-list">${orders.slice().reverse().map((o) => `
        <li class="report-row">
          <span class="report__time">${Utils.formatWhen(o.at)}</span>
          <span class="item__qty">${o.qty}</span>
          <span class="report__main"><strong>${esc(o.product)}</strong>${clientTag(o.client)}</span>
          ${waiterTag(o.waiterId)}
        </li>`).join('')}</ul>`;
    }

    // Por produto: total de cada um e, embaixo, quem pediu e quando
    const groups = new Map();
    orders.forEach((o) => {
      if (!groups.has(o.key)) groups.set(o.key, { name: o.product, qty: 0, orders: [] });
      const g = groups.get(o.key);
      g.qty += o.qty;
      g.orders.push(o);
    });
    return [...groups.values()]
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR'))
      .map((g) => `
        <details class="report-group" data-name="${esc(g.name)}">
          <summary>
            <span class="item__qty">${g.qty}</span>
            <strong>${esc(g.name)}</strong>
            <span class="report__count">${Utils.plural(g.orders.length, 'pedido', 'pedidos')}</span>
          </summary>
          <ul class="report-list">${g.orders.map((o) => `
            <li class="report-row">
              <span class="report__time">${Utils.formatWhen(o.at)}</span>
              <span class="report__qty">${o.qty}×</span>
              <span class="report__main">${clientTag(o.client)}</span>
              ${waiterTag(o.waiterId)}
            </li>`).join('')}</ul>
        </details>`).join('');
  }

  function renderItemsReport() {
    const orders = allOrders();
    const total = orders.reduce((s, o) => s + o.qty, 0);
    els.itemsDialogSub.textContent = `${Utils.plural(total, 'item', 'itens')} em ${Utils.plural(orders.length, 'pedido', 'pedidos')} · contas abertas e encerradas nas últimas 24 horas`;
    const html = itemsReportHtml(orders);
    if (html === shownReport) return;
    const opened = new Set([...els.itemsReport.querySelectorAll('details[open]')].map((d) => d.dataset.name));
    els.itemsReport.innerHTML = html;
    els.itemsReport.querySelectorAll('details').forEach((d) => { d.open = opened.has(d.dataset.name); });
    shownReport = html;
  }

  function openItemsDialog() {
    renderItemsReport();
    UI.Modal.open(els.itemsDialog);
    requestAnimationFrame(() => UI.moveThumb(els.itemsViewGroup));
  }

  /* =====================================================
     Eventos
     ===================================================== */
  function bindEvents() {
    [els.clientDialog, els.itemDialog, els.itemsDialog, els.closeDialog].forEach(UI.Modal.bind);

    // Novo cliente
    ['#btnAddClient', '#btnEmptyAdd', '#fabAdd'].forEach((sel) =>
      $(sel).addEventListener('click', () => openClientDialog()));

    // Formulário do cliente
    els.clientForm.addEventListener('submit', saveClient);
    els.clientCpf.addEventListener('input', () => {
      els.clientCpf.value = Utils.formatCPF(els.clientCpf.value);
      if (els.cpfError.textContent) UI.setFieldError(els.clientCpf, els.cpfError, '');
    });
    els.clientName.addEventListener('input', () => {
      if (els.nameError.textContent) UI.setFieldError(els.clientName, els.nameError, '');
    });

    // Ações dentro dos cards (delegação de eventos)
    els.list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('.client-card');
      const clientId = card.dataset.id;
      const itemKey = btn.closest('.item')?.dataset.itemKey;

      switch (btn.dataset.action) {
        case 'add-item': openItemDialog(clientId); break;
        case 'edit': openClientDialog(clientId); break;
        case 'delete': deleteClient(clientId, card); break;
        case 'close': openCloseDialog(clientId); break;
        case 'reopen': reopenClient(clientId); break;
        case 'inc': changeQty(clientId, itemKey, 1); break;
        case 'dec': changeQty(clientId, itemKey, -1); break;
      }
    });

    // Formulário de consumo
    els.itemForm.addEventListener('submit', (e) => { e.preventDefault(); saveItem(false); });
    $('#btnItemAnother').addEventListener('click', () => saveItem(true));
    $('#itemWaiterChange').addEventListener('click', () => { Waiter.choose(); });
    els.itemForm.querySelectorAll('[data-step]').forEach((btn) =>
      btn.addEventListener('click', () => stepQty(Number(btn.dataset.step))));
    els.itemQty.addEventListener('blur', () => { els.itemQty.value = readQty(); });
    els.itemProduct.addEventListener('input', () => {
      if (els.productError.textContent) UI.setFieldError(els.itemProduct, els.productError, '');
      renderSuggestions();
    });
    els.itemProduct.addEventListener('keydown', (e) => {
      if (els.productSuggest.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = suggestMatches.length;
        suggestIndex = e.key === 'ArrowDown' ? (suggestIndex + 1) % n : (suggestIndex - 1 + n) % n;
        highlightSuggestion();
      } else if (e.key === 'Enter' && suggestIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(suggestIndex);
      } else if (e.key === 'Escape') {
        // Esc fecha só a lista (sem fechar a janela)
        e.preventDefault();
        e.stopPropagation();
        hideSuggestions();
      }
    });
    // Não tira o foco do campo ao tocar numa sugestão
    els.productSuggest.addEventListener('pointerdown', (e) => e.preventDefault());
    els.productSuggest.addEventListener('click', (e) => {
      const item = e.target.closest('.suggest__item');
      if (item) chooseSuggestion(Number(item.dataset.index));
    });

    // Busca e filtros
    els.search.addEventListener('input', Utils.debounce(() => {
      query = els.search.value;
      render();
    }, 120));
    els.waiterFilter.addEventListener('change', async () => {
      waiterFilter = els.waiterFilter.value;
      if (waiterFilter === 'mine' && !(await Waiter.ensure())) waiterFilter = els.waiterFilter.value = '';
      render();
    });
    els.filterGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn || btn.classList.contains('is-active')) return;
      setFilter(btn.dataset.filter);
    });

    // Cards do resumo: filtram a lista ou abrem a janela de itens
    els.statsGroup.addEventListener('click', (e) => {
      const card = e.target.closest('.stat');
      if (!card) return;
      if (card.dataset.open === 'items') openItemsDialog();
      else setFilter(card.dataset.filter, { scroll: true });
    });
    els.itemsViewGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (!btn || btn.classList.contains('is-active')) return;
      els.itemsViewGroup.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b === btn));
      itemsView = btn.dataset.view;
      UI.moveThumb(els.itemsViewGroup);
      renderItemsReport();
    });

    // Fechar conta
    els.closeForm.addEventListener('submit', confirmClose);
    els.payOptions.addEventListener('change', () => { els.payError.textContent = ''; });

    // Preços, gerência, entrar e sair
    $('#btnPrices').addEventListener('click', () => Prices.open());
    $('#btnManage').addEventListener('click', () => Manage.open());
    els.loginForm.addEventListener('submit', submitLogin);
    $('#loginToggle').addEventListener('click', (e) => {
      const show = els.loginPass.type === 'password';
      els.loginPass.type = show ? 'text' : 'password';
      e.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
      els.loginPass.focus();
    });
    els.loginDialog.addEventListener('cancel', (e) => e.preventDefault());   // sem senha, não fecha
    // O navegador deixa fechar no segundo Esc: reabre
    els.loginDialog.addEventListener('close', () => { if (!Api.hasSession()) els.loginDialog.showModal(); });
    els.loginForm.addEventListener('input', () => { els.loginError.textContent = ''; });
    $('#btnLogout').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Sair deste aparelho?',
        message: 'Para voltar, será preciso o usuário e a senha do estabelecimento.',
        confirmText: 'Sair',
        tone: 'primary',
        icon: 'unlink'
      });
      if (ok) leave('');
    });

    window.addEventListener('resize', Utils.debounce(() => UI.moveThumb(els.filterGroup), 100));

    // Barra superior
    $('#btnTheme').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      Theme.toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });

    // Atalhos: N = novo cliente, / = buscar, Esc limpa a busca
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      const typing = e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === 'Escape' && e.target === els.search && els.search.value) {
        els.search.value = '';
        query = '';
        render();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openClientDialog(); }
      if (e.key === '/') { e.preventDefault(); els.search.focus(); }
    });

    // Ao voltar para a tela, atualiza na hora
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Store.refresh(); });

    // Outra aba entrou, saiu ou trocou a sessão
    window.addEventListener('storage', (e) => { if (e.key === 'comanda:sessao') location.reload(); });
  }

  /* =====================================================
     Início
     ===================================================== */
  Store.subscribe(() => {
    render();
    if (els.itemsDialog.open) renderItemsReport();
    if (els.itemDialog.open) {
      renderCurrentItems();
      renderItemWaiter();
      const client = Store.getClient(itemClientId);
      if (Store.isLoaded() && (!client || client.closedAt) && !savingItem) {
        UI.Modal.close(els.itemDialog);
        UI.toast('Essa conta foi encerrada ou excluída em outro aparelho.', { type: 'warning' });
      }
    }
    syncCloseDialog();
  });

  Api.on('expired', (message) => leave(message));
  Api.on('network', (online) => { els.dbBanner.hidden = online || !Api.hasSession(); });

  bindEvents();
  render();

  // Atualiza o "há X min" e a data do topo a cada 30 segundos
  setInterval(render, 30000);

  if (Api.hasSession()) enter();
  else openLogin();
})();
