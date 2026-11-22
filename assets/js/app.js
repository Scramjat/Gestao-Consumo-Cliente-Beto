/* =========================================================
   Controlador principal: liga a interface aos dados
   ========================================================= */

(() => {
  const $ = (sel) => document.querySelector(sel);

  const els = {
    todayLabel: $('#todayLabel'),
    list: $('#clientList'),
    empty: $('#emptyState'),
    noResults: $('#noResults'),
    search: $('#searchInput'),
    filterGroup: $('#filterGroup'),
    statsGroup: $('#statsGroup'),
    itemsDialog: $('#itemsDialog'),
    itemsDialogSub: $('#itemsDialogSub'),
    itemsViewGroup: $('#itemsView'),
    itemsReport: $('#itemsReport'),
    metricsDialog: $('#metricsDialog'),
    metricsSub: $('#metricsSub'),
    metricsPeriod: $('#metricsPeriod'),
    metricsContent: $('#metricsContent'),
    metricsTooltip: $('#metricsTooltip'),
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
    dbBannerText: $('#dbBannerText'),

    clientDialog: $('#clientDialog'),
    clientForm: $('#clientForm'),
    clientDialogTitle: $('#clientDialogTitle'),
    clientName: $('#clientName'),
    clientCpf: $('#clientCpf'),
    clientTable: $('#clientTable'),
    attendantField: $('#attendantField'),
    clientAttendant: $('#clientAttendant'),
    nameError: $('#nameError'),
    cpfError: $('#cpfError'),

    itemDialog: $('#itemDialog'),
    itemForm: $('#itemForm'),
    itemDialogClient: $('#itemDialogClient'),
    itemProduct: $('#itemProduct'),
    itemQty: $('#itemQty'),
    productError: $('#productError'),
    productSuggest: $('#productSuggest'),
    productHint: $('#productHint'),
    itemCurrent: $('#itemCurrent'),

    loginDialog: $('#loginDialog'),
    loginForm: $('#loginForm'),
    loginUser: $('#loginUser'),
    loginPass: $('#loginPass'),
    loginError: $('#loginError'),
    loginSubmit: $('#loginSubmit'),
    btnLogout: $('#btnLogout'),
    btnAccess: $('#btnAccess'),
    passBanner: $('#passBanner'),
    passBannerText: $('#passBannerText'),

    closeDialog: $('#closeDialog'),
    closeForm: $('#closeForm'),
    closeSub: $('#closeSub'),
    closeBill: $('#closeBill'),
    closeWarning: $('#closeWarning'),
    closeTotal: $('#closeTotal'),
    payOptions: $('#payOptions'),
    payError: $('#payError')
  };

  let filter = 'all';
  let query = '';
  let editingId = null;   // cliente sendo editado (null = novo)
  let itemClientId = null; // cliente que está recebendo consumo

  /* =====================================================
     Renderização
     ===================================================== */
  function visibleClients(clients) {
    const q = Utils.normalize(query);
    const qDigits = Utils.onlyDigits(query);
    // Aceita "5", "mesa 5" ou "m5"
    const qTable = q.replace(/^(mesa|m)\s*/, '');
    const shown = clients
      .filter((c) => {
        // Contas encerradas só aparecem na aba "Concluídos"
        if (filter === 'closed') { if (!c.closedAt) return false; }
        else if (c.closedAt) return false;
        if (filter === 'consuming' && !c.items.length) return false;
        if (filter === 'idle' && c.items.length) return false;
        if (!q) return true;
        return Utils.normalize(c.name).includes(q)
          // Mesa: número exato, para "5" não trazer a mesa 15
          || (c.table && Utils.normalize(c.table) === qTable)
          || (Features.attendant && c.attendant && Utils.normalize(c.attendant).includes(q))
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
    consuming: ['Ninguém consumindo', 'Nenhum cliente aberto com consumo lançado.'],
    idle: ['Todo mundo já pediu', 'Não há clientes abertos sem consumo.'],
    closed: ['Nenhuma conta encerrada', 'Quando um cliente pagar, clique em Encerrar no cartão dele.']
  };

  function render(reason = null) {
    const state = Store.get();
    const clients = state.clients;

    els.todayLabel.textContent = Utils.formatToday();

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
    UI.renderList(els.list, shown, reason);

    els.empty.hidden = clients.length > 0;
    els.noResults.hidden = !clients.length || shown.length > 0;
    if (!els.noResults.hidden) {
      const [title, text] = query.trim()
        ? ['Nada encontrado', 'Nenhum cliente corresponde à busca nesta aba.']
        : emptyMessages[filter];
      els.noResultsTitle.textContent = title;
      els.noResultsText.textContent = text;
    }
  }

  /* =====================================================
     Cliente: cadastrar / editar / excluir
     ===================================================== */
  function setFieldError(input, errorEl, message) {
    errorEl.textContent = message || '';
    input.closest('.field').classList.toggle('has-error', !!message);
  }

  function openClientDialog(clientId = null) {
    editingId = clientId;
    const client = clientId ? Store.getClient(clientId) : null;
    els.clientDialogTitle.textContent = client ? 'Editar cliente' : 'Novo cliente';
    els.clientName.value = client ? client.name : '';
    els.clientCpf.value = client?.cpf ? Utils.formatCPF(client.cpf) : '';
    els.clientTable.value = client?.table || '';
    els.attendantField.hidden = !Features.attendant;
    els.clientAttendant.value = client?.attendant || '';
    setFieldError(els.clientName, els.nameError, '');
    setFieldError(els.clientCpf, els.cpfError, '');
    UI.Modal.open(els.clientDialog);
    els.clientName.focus();
  }

  function validateClient() {
    const name = els.clientName.value.trim();
    const cpf = Utils.onlyDigits(els.clientCpf.value);
    let ok = true;

    if (name.length < 2) {
      setFieldError(els.clientName, els.nameError, 'Digite o nome do cliente.');
      ok = false;
    } else {
      setFieldError(els.clientName, els.nameError, '');
    }

    let cpfMsg = '';
    if (cpf) {
      if (cpf.length !== 11) cpfMsg = 'O CPF precisa ter 11 números.';
      else if (!Utils.isValidCPF(cpf)) cpfMsg = 'CPF inválido. Confira os números.';
      else {
        const dup = Store.get().clients.find((c) => c.cpf === cpf && c.id !== editingId);
        if (dup) cpfMsg = `Este CPF já está cadastrado para ${dup.name}.`;
      }
    }
    setFieldError(els.clientCpf, els.cpfError, cpfMsg);
    if (cpfMsg) ok = false;

    return ok ? { name, cpf, table: els.clientTable.value.trim(), attendant: els.clientAttendant.value.trim() } : null;
  }

  function saveClient(e) {
    e.preventDefault();
    const data = validateClient();
    if (!data) {
      els.clientForm.querySelector('.has-error input')?.focus();
      return;
    }
    if (editingId) {
      Store.updateClient(editingId, data);
      UI.toast('Cadastro atualizado', { type: 'success' });
    } else {
      const c = Store.addClient(data);
      UI.toast(`${c.name} cadastrado às ${Utils.formatTime(c.createdAt)}`, { type: 'success' });
    }
    UI.Modal.close(els.clientDialog);
  }

  async function deleteClient(clientId, card) {
    const client = Store.getClient(clientId);
    if (!client) return;
    if (client.items.length) {
      UI.shake(card);
      UI.toast('Este cliente já consumiu e não pode ser excluído.', { type: 'warning' });
      return;
    }
    const ok = await UI.confirm({
      title: `Excluir ${client.name}?`,
      message: 'O cadastro será removido da lista.',
      confirmText: 'Excluir'
    });
    if (!ok) return;

    await UI.animateCardOut(card);
    const removed = Store.removeClient(clientId);
    if (!removed) return;
    UI.toast(`${removed.client.name} foi excluído`, {
      type: 'info',
      action: { label: 'Desfazer', onClick: () => Store.restoreClient(removed.client, removed.index) }
    });
  }

  /* =====================================================
     Encerrar / reabrir conta
     ===================================================== */
  let closingId = null;
  let closingCard = null;

  function billTable(bill) {
    const rows = bill.lines.map((l) => `
      <tr${l.unitCents == null ? ' class="is-missing"' : ''}>
        <td class="num">${l.qty}</td>
        <td>${Utils.escapeHTML(l.product)}</td>
        <td class="num">${l.unitCents == null ? '—' : Billing.money(l.unitCents)}</td>
        <td class="num">${l.totalCents == null ? 'sem preço' : Billing.money(l.totalCents)}</td>
      </tr>`).join('');
    return `<table class="bill-table">
      <thead><tr><th class="num">Qtd</th><th>Produto</th><th class="num">Valor unitário</th><th class="num">Valor total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  /** Abre a conta com valor de cada produto, total e a escolha da forma de pagamento. */
  function openCloseDialog(clientId, card) {
    const client = Store.getClient(clientId);
    if (!client || client.closedAt || !client.items.length) return;
    closingId = clientId;
    closingCard = card;

    const bill = Store.billOf(client);
    const table = client.table ? ` · Mesa ${Utils.escapeHTML(client.table)}` : '';
    els.closeSub.innerHTML = `<strong>${Utils.escapeHTML(client.name)}</strong>${table}`;
    els.closeBill.innerHTML = billTable(bill);
    els.closeTotal.textContent = Billing.money(bill.totalCents);
    els.closeWarning.hidden = !bill.missing;
    if (bill.missing) {
      els.closeWarning.textContent = `${Utils.plural(bill.missing, 'item está', 'itens estão')} sem preço na lista e não ${bill.missing === 1 ? 'entra' : 'entram'} no total. Cadastre em "Produtos e preços" antes de encerrar para incluir.`;
    }
    els.payOptions.innerHTML = Billing.METHODS.map((m) => `
      <label class="pay__opt">
        <input type="radio" name="pay" value="${m.id}">
        <span>${m.label}</span>
      </label>`).join('');
    els.payError.textContent = '';
    UI.Modal.open(els.closeDialog);
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
    const client = Store.getClient(id);
    if (!client) return;

    UI.Modal.close(els.closeDialog);
    await UI.animateCardOut(closingCard);
    const closed = Store.closeClient(id, method);
    if (!closed) return;
    UI.toast(`${client.name}: ${Billing.money(closed.payment.totalCents)} no ${Billing.methodLabel(method)}`, {
      type: 'success',
      action: { label: 'Desfazer', onClick: () => Store.reopenClient(id) }
    });
  }

  async function reopenClient(clientId, card) {
    const client = Store.getClient(clientId);
    if (!client) return;
    await UI.animateCardOut(card);
    Store.reopenClient(clientId);
    UI.toast(`Conta de ${client.name} reaberta`, { type: 'info' });
  }

  /* =====================================================
     Consumo
     ===================================================== */
  function renderCurrentItems() {
    const client = Store.getClient(itemClientId);
    if (!client || !client.items.length) {
      els.itemCurrent.hidden = true;
      return;
    }
    els.itemCurrent.hidden = false;
    els.itemCurrent.innerHTML = '<strong>Já pediu</strong>' + client.items
      .map((i) => `<span>${i.qty}</span> ${Utils.escapeHTML(i.product)}`)
      .join(' &nbsp;·&nbsp; ');
  }

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
      msg = 'Nenhum produto cadastrado ainda. Cadastre em "Produtos e preços" para a conta sair com valores.';
    } else if (text) {
      const exact = Billing.findProduct(Store.products(), text);
      if (exact) msg = `${Billing.money(Billing.toCents(exact.price))} cada`;
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
          <span>${Utils.escapeHTML(p.name)}</span>
          <strong>${Billing.money(Billing.toCents(p.price))}</strong>
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
    setFieldError(els.itemProduct, els.productError, '');
    hideSuggestions();
    updateProductHint();
    els.itemQty.focus();
    els.itemQty.select();
  }

  function openItemDialog(clientId) {
    const client = Store.getClient(clientId);
    if (!client) return;
    itemClientId = clientId;
    const table = client.table ? ` · Mesa ${Utils.escapeHTML(client.table)}` : '';
    els.itemDialogClient.innerHTML = `para <strong>${Utils.escapeHTML(client.name)}</strong>${table}`;
    els.itemProduct.value = '';
    els.itemQty.value = 1;
    setFieldError(els.itemProduct, els.productError, '');
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

  /** Grava o item. Se `keepOpen`, limpa o campo para lançar outro produto. */
  function saveItem(keepOpen) {
    const product = els.itemProduct.value.trim();
    if (!product) {
      setFieldError(els.itemProduct, els.productError, 'Digite o que o cliente pediu.');
      els.itemProduct.focus();
      return;
    }
    setFieldError(els.itemProduct, els.productError, '');
    const qty = readQty();
    const item = Store.addItem(itemClientId, product, qty);
    if (!item) return;

    const name = Store.getClient(itemClientId)?.name || '';
    UI.toast(`+${qty} ${item.product} para ${name}`, { type: 'success', duration: 2200 });

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

  function changeQty(clientId, itemId, delta) {
    const result = Store.changeQty(clientId, itemId, delta);
    if (result?.removed) {
      UI.toast(`${result.removed.product} removido`, {
        type: 'info',
        action: { label: 'Desfazer', onClick: () => Store.restoreItem(clientId, result.removed, result.index, result.lastOrder) }
      });
    }
  }

  /* =====================================================
     Api
     ===================================================== */
  // Faixa de aviso: só aparece se algo der errado; com o servidor ligado, nada é mostrado
  const bannerTexts = {
    offline: 'Sem conexão com o servidor. Se ele estiver acordando, aguarde alguns segundos. Nada se perde: o que você lançar fica neste aparelho e é enviado quando voltar.'
  };

  function onStatusChange(status) {
    const banner = bannerTexts[status];
    els.dbBanner.hidden = !banner;
    if (banner) els.dbBannerText.textContent = banner;

    // Sem login, o conteúdo fica escondido atrás da janela de entrada
    document.body.classList.toggle('is-locked', status === 'login');
    if (status === 'login') openLogin();
    els.btnLogout.hidden = !(Api.isAuthRequired() && Api.hasSession() && status !== 'login');
    els.btnLogout.dataset.tip = `Sair (${Api.user()})`;
    if (status === 'connected' || status === 'local') applyRole();
  }

  /**
   * Esconde da tela o que a função não pode usar. É só conforto: quem confere
   * de verdade é o servidor (server/server.js), com as mesmas regras de roles.js.
   */
  function applyRole() {
    const role = Api.role();
    els.btnAccess.hidden = Api.isLocal() || !Roles.can(role, 'accounts.panel');
    document.querySelectorAll('[data-menu="backup"], [data-menu="restore"]')
      .forEach((item) => { item.hidden = !Roles.can(role, 'backup'); });
    checkAlerts();
  }

  /** Faixa amarela para ADMIN e admin: senha padrão ainda em uso e banco que não é permanente. */
  async function checkAlerts() {
    if (Api.isLocal() || !Roles.can(Api.role(), 'accounts.panel') || !Api.hasSession()) {
      els.passBanner.hidden = true;
      return;
    }
    try {
      const { contas, banco } = await Api.accounts();
      const messages = [];
      const defaults = contas.filter((c) => c.senhaPadrao).map((c) => c.login);
      if (defaults.length) {
        messages.push(`A senha padrão (${Roles.SENHA_PADRAO}) ainda está em uso em: ${defaults.join(', ')}. Troque agora.`);
      }
      if (banco === 'arquivo' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
        messages.push('O banco permanente (Neon) não está conectado: os dados somem quando o servidor reinicia.');
      }
      els.passBanner.hidden = !messages.length;
      els.passBannerText.textContent = messages.join(' ');
    } catch {
      els.passBanner.hidden = true;
    }
  }

  /* ---------- Login ---------- */
  function openLogin() {
    if (els.loginDialog.open) return;
    els.loginPass.value = '';
    els.loginPass.type = 'password';
    $('#loginToggle').textContent = 'Mostrar';
    els.loginError.textContent = '';
    els.loginUser.value = Api.user();
    UI.Modal.open(els.loginDialog);
    (els.loginUser.value ? els.loginPass : els.loginUser).focus();
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
      const remote = await Api.login(usuario, senha);
      els.loginPass.value = '';
      UI.Modal.close(els.loginDialog);
      syncWithVault(remote, true);
      applyRole();
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

  /** Lista sem nenhum cliente nem produto (ex.: servidor que acabou de ser reiniciado). */
  const isEmptyState = (state) => !state.clients.length && !(state.products || []).length;

  /**
   * Decide quem vale: os dados deste aparelho ou os do servidor.
   * - Servidor vazio (reiniciou) + dados no aparelho: devolve os dados ao servidor.
   * - Aparelho zerado + dados no servidor: traz os dados do servidor.
   * - Os dois com dados: vale o mais recente.
   */
  function syncWithVault(remote, silent = false) {
    const local = Store.get();
    const remoteHasData = Store.isValidState(remote) && !isEmptyState(remote);

    if (remoteHasData && (local.pristine || remote.updatedAt >= local.updatedAt)) {
      if (remote.updatedAt === local.updatedAt) return;
      UI.resetSeen();
      Store.replace(remote);
      if (!silent) UI.toast(`Dados carregados do servidor (${Utils.plural(remote.clients.length, 'cliente', 'clientes')})`, { type: 'success' });
    } else if (!local.pristine) {
      Api.saveNow(local);
    }
  }

  /* =====================================================
     Exportar planilha do Excel com tudo de cada cliente
     ===================================================== */
  function exportExcel() {
    const state = Store.get();
    if (!state.clients.length) {
      UI.toast('Ainda não há clientes para exportar.', { type: 'warning' });
      return;
    }
    // Ex.: "Comanda 2026-11-02 23h40.xlsx"
    const now = new Date().toISOString();
    const stamp = `${Markdown.dayKey(now)} ${Utils.formatTime(now).slice(0, 5).replace(':', 'h')}`;
    downloadFile(Excel.build(state), `Comanda ${stamp}.xlsx`, Excel.MIME);
    UI.toast('Planilha baixada', { type: 'success' });
  }

  /* =====================================================
     Backup e restauração (os dados ficam no aparelho)
     ===================================================== */
  const LAST_BACKUP_KEY = 'comanda:ultimoBackup';

  function downloadFile(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderLastBackup() {
    let last = null;
    try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* ignora */ }
    $('#lastBackupLabel').textContent = last ? `Último: ${Utils.formatFull(last).slice(0, -3)}` : 'Nunca feito';
  }

  function exportBackup() {
    const now = new Date().toISOString();
    const stamp = `${Markdown.dayKey(now)} ${Utils.formatTime(now).slice(0, 5).replace(':', 'h')}`;
    downloadFile(JSON.stringify(Store.backup(), null, 2), `Comanda backup ${stamp}.json`, 'application/json');
    try { localStorage.setItem(LAST_BACKUP_KEY, now); } catch { /* ignora */ }
    renderLastBackup();
    UI.toast('Backup salvo. Guarde o arquivo em um lugar seguro.', { type: 'success', duration: 5000 });
  }

  async function restoreBackup(file) {
    let data = null;
    try { data = JSON.parse(await file.text()); } catch { /* arquivo inválido */ }
    if (!data || data.app !== 'comanda' || !Store.isValidState(data.estado)) {
      UI.toast('Esse arquivo não é um backup da Comanda.', { type: 'error' });
      return;
    }
    const when = data.exportedAt ? Utils.formatFull(data.exportedAt).slice(0, -3) : 'data desconhecida';
    const ok = await UI.confirm({
      title: 'Restaurar este backup?',
      message: `Backup de ${when}, com ${Utils.plural(data.estado.clients.length, 'cliente', 'clientes')}. Os dados atuais deste aparelho serão substituídos.`,
      confirmText: 'Restaurar',
      tone: 'primary',
      icon: 'refresh'
    });
    if (!ok) return;
    UI.resetSeen();
    Store.restore(data);
    UI.toast('Backup restaurado', { type: 'success' });
  }

  function bindExportMenu() {
    const btn = $('#btnExport');
    const menu = $('#exportMenu');
    const input = $('#restoreInput');

    const setOpen = (open) => {
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('is-open', open);
      if (open) renderLastBackup();
    };

    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setOpen(false); });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-menu]');
      if (!item) return;
      setOpen(false);
      if (item.dataset.menu === 'excel') exportExcel();
      if (item.dataset.menu === 'backup') exportBackup();
      if (item.dataset.menu === 'restore') input.click();
    });

    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (file) restoreBackup(file);
    });
  }

  /* =====================================================
     Filtro segmentado (pílula deslizante)
     ===================================================== */
  function moveThumb(group) {
    const active = group.querySelector('.is-active');
    const thumb = group.querySelector('.segmented__thumb');
    if (!active || !thumb) return;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.height = `${active.offsetHeight}px`;
    thumb.style.top = '0';
    // Posição em X e Y, pois no celular as abas ficam em 2 linhas
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  }

  const moveFilterThumb = () => moveThumb(els.filterGroup);

  /** Troca o filtro e deixa as abas e os cards do resumo marcados juntos. */
  function setFilter(next, { scroll = false } = {}) {
    filter = next;
    els.filterGroup.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === next));
    els.statsGroup.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === next));
    moveFilterThumb();
    render();
    if (scroll) els.filterGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* =====================================================
     Janela "Itens pedidos"
     ===================================================== */
  let itemsView = 'product';

  /** Todos os pedidos de todos os clientes, com quem pediu e quando. */
  function allOrders() {
    const orders = [];
    Store.get().clients.forEach((c) => {
      // Valor unitário de cada produto da conta (encerrada: o guardado no pagamento; aberta: a lista atual)
      const lines = Store.billOf(c).lines;
      c.items.forEach((item, i) => {
        const unit = lines[i] ? lines[i].unitCents : null;
        item.orders.forEach((o) => {
          orders.push({
            at: o.at, qty: o.qty, product: item.product, client: c,
            cents: unit == null ? null : unit * o.qty
          });
        });
      });
    });
    return orders.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Valor de um pedido ou de um grupo: soma o que tem preço e avisa quando falta preço. */
  function moneyCell(cents, missing = 0) {
    if (cents == null) return '<span class="report__money is-missing">sem preço</span>';
    const warn = missing ? ` <small class="report__money-warn">+ ${missing} sem preço</small>` : '';
    return `<span class="report__money">${Billing.money(cents)}${warn}</span>`;
  }

  function clientTag(client) {
    const closed = client.closedAt ? ' <span class="tag tag--done">encerrada</span>' : '';
    const table = client.table ? ` · Mesa ${Utils.escapeHTML(client.table)}` : '';
    return `<span class="report__client" style="--hue:${Utils.hue(client.name)}">${Utils.escapeHTML(client.name)}${table}</span>${closed}`;
  }

  function renderItemsReport() {
    const orders = allOrders();
    const total = orders.reduce((s, o) => s + o.qty, 0);
    const money = orders.reduce((s, o) => s + (o.cents || 0), 0);
    const anyPriced = orders.some((o) => o.cents != null);
    els.itemsDialogSub.textContent = `${Utils.plural(total, 'item', 'itens')} em ${Utils.plural(orders.length, 'pedido', 'pedidos')}${anyPriced ? ` · ${Billing.money(money)}` : ''}`;

    if (!orders.length) {
      els.itemsReport.innerHTML = '<p class="item-empty">Nenhum item pedido ainda.</p>';
      return;
    }

    if (itemsView === 'time') {
      els.itemsReport.innerHTML = `<ul class="report-list">${orders.slice().reverse().map((o) => `
        <li class="report-row">
          <span class="report__time">${Utils.formatWhen(o.at)}</span>
          <span class="item__qty">${o.qty}</span>
          <span class="report__main"><strong>${Utils.escapeHTML(o.product)}</strong>${clientTag(o.client)}</span>
          ${moneyCell(o.cents)}
        </li>`).join('')}</ul>`;
      return;
    }

    // Por produto: total de cada um e, embaixo, quem pediu e quando
    const groups = {};
    orders.forEach((o) => {
      const key = o.product.toLowerCase();
      (groups[key] ||= { name: o.product, qty: 0, cents: 0, priced: false, missing: 0, orders: [] });
      groups[key].qty += o.qty;
      if (o.cents == null) groups[key].missing += 1;
      else { groups[key].cents += o.cents; groups[key].priced = true; }
      groups[key].orders.push(o);
    });
    els.itemsReport.innerHTML = Object.values(groups)
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR'))
      .map((g) => `
        <details class="report-group">
          <summary>
            <span class="item__qty">${g.qty}</span>
            <strong>${Utils.escapeHTML(g.name)}</strong>
            <span class="report__count">${Utils.plural(g.orders.length, 'pedido', 'pedidos')}</span>
            ${moneyCell(g.priced ? g.cents : null, g.priced ? g.missing : 0)}
          </summary>
          <ul class="report-list">${g.orders.map((o) => `
            <li class="report-row">
              <span class="report__time">${Utils.formatWhen(o.at)}</span>
              <span class="report__qty">${o.qty}×</span>
              <span class="report__main">${clientTag(o.client)}</span>
              ${moneyCell(o.cents)}
            </li>`).join('')}</ul>
        </details>`).join('');
  }

  /* =====================================================
     Métricas
     ===================================================== */
  let metricsPeriod = 'today';

  const METRICS_REFRESH_MS = 60000;
  let metricsTimer = null;

  /**
   * `animate` só ao abrir ou trocar o período. Nas atualizações automáticas
   * os números mudam sem as animações de entrada, para a tela não "piscar".
   */
  function renderMetrics({ animate = false } = {}) {
    els.metricsTooltip.hidden = true;
    els.metricsContent.classList.toggle('mx-static', !animate);
    const { subtitle } = Metrics.render(els.metricsContent, Store.get(), metricsPeriod);
    els.metricsSub.textContent = subtitle;
  }

  function openMetrics() {
    renderMetrics({ animate: true });
    UI.Modal.open(els.metricsDialog);
    // Enquanto o painel estiver aberto, atualiza a cada 1 minuto
    clearInterval(metricsTimer);
    metricsTimer = setInterval(() => {
      if (els.metricsDialog.open) renderMetrics();
      else clearInterval(metricsTimer);
    }, METRICS_REFRESH_MS);
  }

  /** Dica flutuante dos gráficos (lê o texto de data-viz-tip). */
  function bindMetricsTooltip() {
    const tip = els.metricsTooltip;
    const card = els.metricsDialog.querySelector('.modal__card');
    const show = (target, x, y) => {
      tip.textContent = target.dataset.vizTip;
      tip.hidden = false;
      const box = card.getBoundingClientRect();
      const w = tip.offsetWidth;
      const left = Math.min(Math.max(x - box.left - w / 2, 8), box.width - w - 8);
      tip.style.left = `${left}px`;
      tip.style.top = `${y - box.top - tip.offsetHeight - 12}px`;
    };
    els.metricsContent.addEventListener('pointermove', (e) => {
      const target = e.target.closest('[data-viz-tip]');
      if (target) show(target, e.clientX, e.clientY);
      else tip.hidden = true;
    });
    els.metricsContent.addEventListener('pointerleave', () => { tip.hidden = true; });
    els.metricsDialog.querySelector('.modal__body').addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
    // No celular: tocar mostra a dica
    els.metricsContent.addEventListener('click', (e) => {
      const target = e.target.closest('[data-viz-tip]');
      if (!target) return;
      const r = target.getBoundingClientRect();
      show(target, r.left + r.width / 2, r.top);
    });
  }

  function openItemsDialog() {
    renderItemsReport();
    UI.Modal.open(els.itemsDialog);
    requestAnimationFrame(() => moveThumb(els.itemsViewGroup));
  }

  /* =====================================================
     Eventos
     ===================================================== */
  function bindEvents() {
    UI.Modal.bind(els.clientDialog);
    UI.Modal.bind(els.itemDialog);

    // Novo cliente
    ['#btnAddClient', '#btnEmptyAdd', '#fabAdd'].forEach((sel) =>
      $(sel).addEventListener('click', () => openClientDialog()));

    // Formulário do cliente
    els.clientForm.addEventListener('submit', saveClient);
    els.clientCpf.addEventListener('input', () => {
      els.clientCpf.value = Utils.formatCPF(els.clientCpf.value);
      if (els.cpfError.textContent) setFieldError(els.clientCpf, els.cpfError, '');
    });
    els.clientName.addEventListener('input', () => {
      if (els.nameError.textContent) setFieldError(els.clientName, els.nameError, '');
    });

    // Ações dentro dos cards (delegação de eventos)
    els.list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('.client-card');
      const clientId = card.dataset.id;
      const itemId = btn.closest('.item')?.dataset.itemId;

      switch (btn.dataset.action) {
        case 'add-item': openItemDialog(clientId); break;
        case 'edit': openClientDialog(clientId); break;
        case 'delete': deleteClient(clientId, card); break;
        case 'close': openCloseDialog(clientId, card); break;
        case 'reopen': reopenClient(clientId, card); break;
        case 'inc': changeQty(clientId, itemId, 1); break;
        case 'dec': changeQty(clientId, itemId, -1); break;
      }
    });

    // Formulário de consumo
    els.itemForm.addEventListener('submit', (e) => { e.preventDefault(); saveItem(false); });
    $('#btnItemAnother').addEventListener('click', () => saveItem(true));
    els.itemForm.querySelectorAll('[data-step]').forEach((btn) =>
      btn.addEventListener('click', () => stepQty(Number(btn.dataset.step))));
    els.itemQty.addEventListener('blur', () => { els.itemQty.value = readQty(); });
    els.itemProduct.addEventListener('input', () => {
      if (els.productError.textContent) setFieldError(els.itemProduct, els.productError, '');
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

    // Busca e filtro
    els.search.addEventListener('input', Utils.debounce(() => {
      query = els.search.value;
      render();
    }, 120));
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

    UI.Modal.bind(els.itemsDialog);

    // Fechar conta
    UI.Modal.bind(els.closeDialog);
    els.closeForm.addEventListener('submit', confirmClose);
    els.payOptions.addEventListener('change', () => { els.payError.textContent = ''; });

    // Produtos e preços, login e sair
    $('#btnProducts').addEventListener('click', () => Products.open());
    els.btnAccess.addEventListener('click', () => Accounts.open());
    $('#passBannerBtn').addEventListener('click', () => Accounts.open());
    Accounts.onChange(checkAlerts);
    els.loginForm.addEventListener('submit', submitLogin);
    $('#loginToggle').addEventListener('click', (e) => {
      const show = els.loginPass.type === 'password';
      els.loginPass.type = show ? 'text' : 'password';
      e.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
      els.loginPass.focus();
    });
    els.loginDialog.addEventListener('cancel', (e) => e.preventDefault());   // sem senha, não fecha
    els.loginForm.addEventListener('input', () => { els.loginError.textContent = ''; });
    els.btnLogout.addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Sair da Comanda?',
        message: 'Você vai precisar entrar de novo com usuário e senha.',
        confirmText: 'Sair',
        tone: 'primary',
        icon: 'unlink'
      });
      if (ok) Api.logout();
    });

    // Métricas
    UI.Modal.bind(els.metricsDialog);
    $('#btnMetrics').addEventListener('click', openMetrics);
    els.metricsPeriod.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-period]');
      if (!btn || btn.classList.contains('is-active')) return;
      els.metricsPeriod.querySelectorAll('[data-period]').forEach((b) => b.classList.toggle('is-active', b === btn));
      metricsPeriod = btn.dataset.period;
      renderMetrics({ animate: true });
    });
    bindMetricsTooltip();
    els.itemsViewGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (!btn || btn.classList.contains('is-active')) return;
      els.itemsViewGroup.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b === btn));
      itemsView = btn.dataset.view;
      moveThumb(els.itemsViewGroup);
      renderItemsReport();
    });
    window.addEventListener('resize', Utils.debounce(moveFilterThumb, 100));

    // Barra superior
    $('#btnTheme').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      Theme.toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
    bindExportMenu();

    // Atalhos: N = novo cliente, / = buscar, Esc limpa a busca
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      const typing = e.target.closest('input, textarea, [contenteditable]');
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

    // Outra aba alterou os dados
    window.addEventListener('storage', (e) => {
      if (e.key === Store.STORAGE_KEY) Store.reloadFromStorage();
    });
  }

  /* =====================================================
     Início
     ===================================================== */
  Store.subscribe((state, reason) => {
    render(reason);
    if (els.itemsDialog.open) renderItemsReport();
    if (els.metricsDialog.open) renderMetrics();
    if (reason.type !== 'replace') Api.scheduleSave(state);
  });

  Api.onStatus(onStatusChange);
  Api.onReconnect((remote) => syncWithVault(remote, true));

  bindEvents();
  render();
  requestAnimationFrame(moveFilterThumb);

  // Atualiza o "há X min" e a data do topo a cada 30 segundos
  // (as métricas têm o próprio temporizador, de 1 minuto)
  setInterval(() => render(), 30000);

  Api.init().then((remote) => {
    // Banco vazio na primeira vez: syncWithVault grava o que já existir no navegador
    if (Api.isConnected()) syncWithVault(remote, true);
  });

  // Pede ao navegador para não apagar os dados sozinho (importante no tablet)
  navigator.storage?.persist?.().catch(() => {});

  // App instalável e funcionando sem internet (só em http/https)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
  }

  // Garante o envio da última alteração ao fechar a aba
  window.addEventListener('pagehide', () => Api.flushOnExit());
  window.addEventListener('beforeunload', (e) => {
    if (Api.hasPending()) { Api.flushOnExit(); e.preventDefault(); }
  });
})();
