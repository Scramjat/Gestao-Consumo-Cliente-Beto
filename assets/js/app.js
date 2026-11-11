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
    nameError: $('#nameError'),
    cpfError: $('#cpfError'),

    itemDialog: $('#itemDialog'),
    itemForm: $('#itemForm'),
    itemDialogClient: $('#itemDialogClient'),
    itemProduct: $('#itemProduct'),
    itemQty: $('#itemQty'),
    productError: $('#productError'),
    productChips: $('#productChips'),
    productSuggestions: $('#productSuggestions'),
    itemCurrent: $('#itemCurrent')
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

    return ok ? { name, cpf, table: els.clientTable.value.trim() } : null;
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
  async function closeClient(clientId, card) {
    const client = Store.getClient(clientId);
    if (!client || !client.items.length) return;
    const ok = await UI.confirm({
      title: `Encerrar a conta de ${client.name}?`,
      message: client.items.map((i) => `${i.qty} ${i.product}`).join(' · '),
      confirmText: 'Encerrar conta',
      tone: 'done',
      icon: 'receipt'
    });
    if (!ok) return;

    await UI.animateCardOut(card);
    Store.closeClient(clientId);
    UI.toast(`Conta de ${client.name} encerrada`, {
      type: 'success',
      action: { label: 'Desfazer', onClick: () => Store.reopenClient(clientId) }
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
  function renderProductHelpers() {
    const current = Utils.normalize(els.itemProduct.value);
    els.productChips.innerHTML = Store.topProducts(8).map((p) => {
      const selected = Utils.normalize(p) === current ? ' is-selected' : '';
      return `<button type="button" class="chip${selected}" data-product="${Utils.escapeHTML(p)}">${Utils.escapeHTML(p)}</button>`;
    }).join('');
    els.productSuggestions.innerHTML = Store.allProducts()
      .map((p) => `<option value="${Utils.escapeHTML(p)}"></option>`).join('');
  }

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

  function openItemDialog(clientId) {
    const client = Store.getClient(clientId);
    if (!client) return;
    itemClientId = clientId;
    const table = client.table ? ` · Mesa ${Utils.escapeHTML(client.table)}` : '';
    els.itemDialogClient.innerHTML = `para <strong>${Utils.escapeHTML(client.name)}</strong>${table}`;
    els.itemProduct.value = '';
    els.itemQty.value = 1;
    setFieldError(els.itemProduct, els.productError, '');
    renderProductHelpers();
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
      renderProductHelpers();
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
     Obsidian
     ===================================================== */
  // Só aparece se algo der errado; com o servidor ligado, nada é mostrado
  const bannerTexts = {
    file: 'Sem banco de dados: a página foi aberta direto do arquivo. Use o atalho "Comanda" para gravar no Obsidian.',
    offline: 'Banco desconectado: o servidor não está respondendo. Use o atalho "Comanda" para ligar de novo. Nada se perde: as alterações ficam aqui e são enviadas quando voltar.'
  };

  function renderBanner(status) {
    const banner = bannerTexts[status];
    els.dbBanner.hidden = !banner;
    if (banner) els.dbBannerText.textContent = banner;
  }

  /** Decide quem vale: os dados do navegador ou os do Obsidian. */
  function syncWithVault(remote, silent = false) {
    const local = Store.get();
    const remoteOk = Store.isValidState(remote);

    // O cofre é a fonte principal; o navegador só ganha se tiver alterações mais novas (feitas offline)
    if (remoteOk && (local.pristine || remote.updatedAt >= local.updatedAt)) {
      if (remote.updatedAt === local.updatedAt) return;
      UI.resetSeen();
      Store.replace(remote);
      if (!silent) UI.toast(`Dados carregados do Obsidian (${Utils.plural(remote.clients.length, 'cliente', 'clientes')})`, { type: 'success' });
    } else {
      Obsidian.saveNow(local);
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
    Store.get().clients.forEach((c) => c.items.forEach((item) => item.orders.forEach((o) => {
      orders.push({ at: o.at, qty: o.qty, product: item.product, client: c });
    })));
    return orders.sort((a, b) => a.at.localeCompare(b.at));
  }

  function clientTag(client) {
    const closed = client.closedAt ? ' <span class="tag tag--done">encerrada</span>' : '';
    const table = client.table ? ` · Mesa ${Utils.escapeHTML(client.table)}` : '';
    return `<span class="report__client" style="--hue:${Utils.hue(client.name)}">${Utils.escapeHTML(client.name)}${table}</span>${closed}`;
  }

  function renderItemsReport() {
    const orders = allOrders();
    const total = orders.reduce((s, o) => s + o.qty, 0);
    els.itemsDialogSub.textContent = `${Utils.plural(total, 'item', 'itens')} em ${Utils.plural(orders.length, 'pedido', 'pedidos')}`;

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
        </li>`).join('')}</ul>`;
      return;
    }

    // Por produto: total de cada um e, embaixo, quem pediu e quando
    const groups = {};
    orders.forEach((o) => {
      const key = o.product.toLowerCase();
      (groups[key] ||= { name: o.product, qty: 0, orders: [] });
      groups[key].qty += o.qty;
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
          </summary>
          <ul class="report-list">${g.orders.map((o) => `
            <li class="report-row">
              <span class="report__time">${Utils.formatWhen(o.at)}</span>
              <span class="report__qty">${o.qty}×</span>
              <span class="report__main">${clientTag(o.client)}</span>
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
        case 'close': closeClient(clientId, card); break;
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
      const current = Utils.normalize(els.itemProduct.value);
      els.productChips.querySelectorAll('.chip').forEach((chip) =>
        chip.classList.toggle('is-selected', Utils.normalize(chip.dataset.product) === current));
    });
    els.productChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      // Clicar de novo no mesmo produto soma +1 na quantidade
      if (chip.classList.contains('is-selected')) stepQty(1);
      els.itemProduct.value = chip.dataset.product;
      els.itemProduct.dispatchEvent(new Event('input'));
      setFieldError(els.itemProduct, els.productError, '');
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
    if (reason.type !== 'replace') Obsidian.scheduleSave(state);
  });

  Obsidian.onStatus(renderBanner);

  bindEvents();
  render();
  requestAnimationFrame(moveFilterThumb);

  // Atualiza o "há X min" e a data do topo a cada 30 segundos
  // (as métricas têm o próprio temporizador, de 1 minuto)
  setInterval(() => render(), 30000);

  Obsidian.init().then((remote) => {
    // Banco vazio na primeira vez: syncWithVault grava o que já existir no navegador
    if (Obsidian.isConnected()) syncWithVault(remote, true);
  });

  // Pede ao navegador para não apagar os dados sozinho (importante no tablet)
  navigator.storage?.persist?.().catch(() => {});

  // App instalável e funcionando sem internet (só em http/https)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
  }

  // Garante o envio da última alteração ao fechar a aba
  window.addEventListener('pagehide', () => Obsidian.flushOnExit());
  window.addEventListener('beforeunload', (e) => {
    if (Obsidian.hasPending()) { Obsidian.flushOnExit(); e.preventDefault(); }
  });
})();
