/* =========================================================
   Área da gerência (pede o PIN)
   Equipe, produtos e preços, relatórios e troca da senha e do PIN. Quem
   confere a permissão é o servidor. Ao fechar a janela, a
   liberação é esquecida, pois o aparelho é compartilhado.
   ========================================================= */

const Manage = (() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Utils.escapeHTML;

  const els = {
    pinDialog: $('#pinDialog'),
    pinForm: $('#pinForm'),
    pin: $('#pinInput'),
    pinError: $('#pinError'),
    dialog: $('#manageDialog'),
    tabs: $('#manageTabs'),
    teamForm: $('#teamForm'),
    teamName: $('#teamName'),
    teamError: $('#teamError'),
    teamList: $('#teamList'),
    productForm: $('#productForm'),
    productName: $('#productName'),
    productPrice: $('#productPrice'),
    productError: $('#productFormError'),
    productSearch: $('#productSearch'),
    productList: $('#productList'),
    passwordForm: $('#passwordForm'),
    newPassword: $('#newPassword'),
    passwordError: $('#passwordError'),
    newPinForm: $('#newPinForm'),
    newPin: $('#newPin'),
    newPinError: $('#newPinError')
  };

  let view = 'team';
  let editing = null;          // id da linha em edição
  const newIds = {};           // identificador do cadastro em andamento
  let shown = {};              // último desenho de cada lista

  const priceText = (cents) => (cents / 100).toFixed(2).replace('.', ',');

  const parseCents = (text) => {
    const reais = Billing.parsePrice(text);
    return reais == null ? null : Billing.toCents(reais);
  };

  /** O mesmo cadastro reenviado leva o mesmo identificador. */
  function idFor(form, ...values) {
    const key = JSON.stringify(values);
    if (newIds[form]?.key !== key) newIds[form] = { key, id: Api.newId() };
    return newIds[form].id;
  }

  /* ---------- Entrada com PIN ---------- */
  function askPin() {
    els.pin.value = '';
    els.pinError.textContent = '';
    UI.Modal.open(els.pinDialog);
    els.pin.focus();
  }

  async function submitPin(e) {
    e.preventDefault();
    const pin = els.pin.value.trim();
    if (!/^\d{6}$/.test(pin)) {
      els.pinError.textContent = 'O PIN tem 6 números.';
      return;
    }
    await UI.whileBusy(e.submitter || els.pinForm.querySelector('[type="submit"]'), async () => {
      try {
        await Api.unlockManager(pin);
      } catch (err) {
        els.pinError.textContent = err.message;
        els.pin.select();
        UI.shake(els.pinForm.querySelector('.modal__body'));
        return;
      }
      els.pin.value = '';
      UI.Modal.close(els.pinDialog);
      show();
    });
  }

  /**
   * Roda uma ação de gerência e mostra o erro no lugar certo. Se a liberação
   * venceu, pede o PIN de novo. Devolve true quando deu certo.
   */
  async function run(errorEl, action) {
    errorEl.textContent = '';
    try {
      await action();
      return true;
    } catch (e) {
      if (e.status === 403) {
        expired(e.message);
      } else {
        errorEl.textContent = e.message;
        if (!errorEl.offsetParent) UI.toast(e.message, { type: 'error' });
      }
      return false;
    }
  }

  /* ---------- Desenho ---------- */
  function paint(key, list, html) {
    if (shown[key] === html) return;
    list.innerHTML = html;
    shown[key] = html;
  }

  function teamRow(p) {
    if (p.id === editing) {
      return `<li class="prod is-editing" data-id="${p.id}">
        <input class="prod__input prod__input--name" value="${esc(p.name)}" maxlength="40" autocomplete="off" aria-label="Nome do funcionário">
        <span class="prod__actions">
          <button type="button" class="btn btn--primary btn--sm" data-act="save">Salvar</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="cancel">Cancelar</button>
        </span>
        <small class="field__error prod__error"></small>
      </li>`;
    }
    return `<li class="prod${p.active ? '' : ' is-off'}" data-id="${p.id}">
      <span class="prod__name">${esc(p.name)}${p.active ? '' : ' <span class="tag">desativado</span>'}</span>
      <span class="prod__actions">
        <button type="button" class="icon-btn icon-btn--sm" data-act="edit" aria-label="Editar ${esc(p.name)}">${Icons.svg('edit')}</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="toggle">${p.active ? 'Desativar' : 'Reativar'}</button>
      </span>
    </li>`;
  }

  function productRow(p) {
    if (p.id === editing) {
      return `<li class="prod is-editing" data-id="${p.id}">
        <input class="prod__input prod__input--name" value="${esc(p.name)}" maxlength="80" autocomplete="off" aria-label="Nome do produto">
        <input class="prod__input prod__input--price" value="${priceText(p.priceCents)}" inputmode="decimal" autocomplete="off" aria-label="Preço">
        <span class="prod__actions">
          <button type="button" class="btn btn--primary btn--sm" data-act="save">Salvar</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="cancel">Cancelar</button>
        </span>
        <small class="field__error prod__error"></small>
      </li>`;
    }
    return `<li class="prod" data-id="${p.id}">
      <span class="prod__name">${esc(p.name)}</span>
      <span class="prod__price">${Billing.money(p.priceCents)}</span>
      <span class="prod__actions">
        <button type="button" class="icon-btn icon-btn--sm" data-act="edit" aria-label="Editar ${esc(p.name)}">${Icons.svg('edit')}</button>
        <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="delete" aria-label="Excluir ${esc(p.name)}">${Icons.svg('trash')}</button>
      </span>
    </li>`;
  }

  function renderTeam() {
    const people = Store.get().employees.slice()
      .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'pt-BR'));
    paint('team', els.teamList, people.length
      ? people.map(teamRow).join('')
      : '<li class="prod-empty">Cadastre quem vai atender, no campo acima.</li>');
  }

  function renderProducts() {
    const all = Store.products().slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const q = Billing.norm(els.productSearch.value);
    const found = q ? all.filter((p) => Billing.norm(p.name).includes(q)) : all;
    paint('products', els.productList, found.length
      ? found.map(productRow).join('')
      : `<li class="prod-empty">${all.length ? 'Nenhum produto encontrado.' : 'Cadastre o primeiro produto no campo acima.'}</li>`);
  }

  /** Não redesenha a lista enquanto há uma linha sendo editada. */
  function render() {
    if (editing) return;
    if (view === 'team') renderTeam();
    if (view === 'products') renderProducts();
  }

  function redraw() {
    shown = {};
    if (view === 'team') renderTeam();
    if (view === 'products') renderProducts();
  }

  function setView(next) {
    view = next;
    editing = null;
    els.tabs.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === next));
    els.dialog.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== next; });
    UI.moveThumb(els.tabs);
    redraw();
  }

  function show() {
    [els.teamForm, els.productForm, els.passwordForm, els.newPinForm].forEach((f) => f.reset());
    [els.teamError, els.productError, els.passwordError, els.newPinError].forEach((el) => { el.textContent = ''; });
    els.productSearch.value = '';
    UI.Modal.open(els.dialog);
    setView(view);
    requestAnimationFrame(() => UI.moveThumb(els.tabs));
  }

  /* ---------- Equipe ---------- */
  function addEmployee(e) {
    e.preventDefault();
    const name = els.teamName.value.trim();
    UI.whileBusy(els.teamForm.querySelector('[type="submit"]'), async () => {
      if (await run(els.teamError, () => Store.addEmployee(idFor('team', name), name))) {
        delete newIds.team;
        els.teamForm.reset();
        els.teamName.focus();
      }
    });
  }

  async function toggleEmployee(person, button) {
    if (person.active) {
      const open = Store.get().clients.filter((c) => !c.closedAt && c.waiterId === person.id).length;
      const ok = await UI.confirm({
        title: `Desativar ${person.name}?`,
        message: `Não poderá mais ser escolhido para atender. O histórico continua com o nome.${open ? ` Há ${Utils.plural(open, 'conta aberta', 'contas abertas')} sob sua responsabilidade: troque o responsável em cada uma.` : ''}`,
        confirmText: 'Desativar'
      });
      if (!ok) return;
    }
    UI.whileBusy(button, () => run(els.teamError, () => Store.updateEmployee(person.id, { active: !person.active })));
  }

  /* ---------- Produtos ---------- */
  function addProduct(e) {
    e.preventDefault();
    const name = els.productName.value.trim();
    const cents = parseCents(els.productPrice.value);
    if (cents == null) {
      els.productError.textContent = 'Digite um preço válido, por exemplo 5,00.';
      els.productPrice.focus();
      return;
    }
    UI.whileBusy(els.productForm.querySelector('[type="submit"]'), async () => {
      if (await run(els.productError, () => Store.addProduct(idFor('product', name, cents), name, cents))) {
        delete newIds.product;
        els.productForm.reset();
        els.productSearch.value = '';
        redraw();
        els.productName.focus();
      }
    });
  }

  async function removeProduct(product, button) {
    const ok = await UI.confirm({
      title: `Excluir ${product.name}?`,
      message: 'Contas já encerradas não mudam. Contas abertas deste produto ficam sem preço.',
      confirmText: 'Excluir'
    });
    if (ok) UI.whileBusy(button, () => run(els.productError, () => Store.removeProduct(product.id)));
  }

  /* ---------- Edição de uma linha ---------- */
  async function saveRow(row, button) {
    const id = row.dataset.id;
    const errorEl = row.querySelector('.prod__error');
    const name = row.querySelector('.prod__input--name').value.trim();
    let action;
    if (view === 'team') {
      action = () => Store.updateEmployee(id, { name });
    } else {
      const cents = parseCents(row.querySelector('.prod__input--price').value);
      if (cents == null) {
        errorEl.textContent = 'Digite um preço válido, por exemplo 5,00.';
        return;
      }
      action = () => Store.updateProduct(id, name, cents);
    }
    await UI.whileBusy(button, async () => {
      if (await run(errorEl, action)) {
        editing = null;
        redraw();
      }
    });
  }

  function onListClick(e) {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const row = button.closest('.prod');
    const id = row.dataset.id;
    switch (button.dataset.act) {
      case 'edit':
        editing = id;
        redraw();
        e.currentTarget.querySelector('.is-editing .prod__input--name')?.focus();
        break;
      case 'cancel': editing = null; redraw(); break;
      case 'save': saveRow(row, button); break;
      case 'toggle': toggleEmployee(Store.get().employees.find((p) => p.id === id), button); break;
      case 'delete': removeProduct(Store.products().find((p) => p.id === id), button); break;
    }
  }

  function onListKey(e) {
    const row = e.target.closest('.is-editing');
    if (!row) return;
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      saveRow(row, row.querySelector('[data-act="save"]'));
    }
    // Esc cancela só a edição (sem fechar a janela)
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editing = null;
      redraw();
    }
  }

  /* ---------- Senha e PIN ---------- */
  function submitSecret(form, input, errorEl, check, change, doneMessage) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.trim();
      const problem = check(value);
      if (problem) {
        errorEl.textContent = problem;
        return;
      }
      UI.whileBusy(form.querySelector('[type="submit"]'), async () => {
        if (await run(errorEl, () => change(value))) {
          form.reset();
          UI.toast(doneMessage, { type: 'success', duration: 6000 });
        }
      });
    });
  }

  function bind() {
    UI.Modal.bind(els.pinDialog);
    UI.Modal.bind(els.dialog);
    els.pinForm.addEventListener('submit', submitPin);
    els.pin.addEventListener('input', () => {
      els.pin.value = Utils.onlyDigits(els.pin.value).slice(0, 6);
      els.pinError.textContent = '';
    });
    els.dialog.addEventListener('close', () => {
      Api.lockManager();
      editing = null;
      els.passwordForm.reset();
      els.newPinForm.reset();
    });
    els.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (btn) setView(btn.dataset.view);
    });

    els.teamForm.addEventListener('submit', addEmployee);
    els.productForm.addEventListener('submit', addProduct);
    els.productSearch.addEventListener('input', () => { editing = null; renderProducts(); });
    [els.teamList, els.productList].forEach((list) => {
      list.addEventListener('click', onListClick);
      list.addEventListener('keydown', onListKey);
    });
    // Preço: só números, vírgula e ponto
    els.dialog.addEventListener('input', (e) => {
      if (e.target.matches('#productPrice, .prod__input--price')) e.target.value = e.target.value.replace(/[^\d.,]/g, '');
    });

    submitSecret(
      els.passwordForm, els.newPassword, els.passwordError,
      (v) => (v.length < 8 ? 'A senha precisa ter pelo menos 8 caracteres.' : ''),
      (v) => Api.changePassword(v),
      'Senha trocada. Os outros aparelhos precisam entrar de novo.'
    );
    submitSecret(
      els.newPinForm, els.newPin, els.newPinError,
      (v) => (/^\d{6}$/.test(v) ? '' : 'O PIN precisa ter 6 números.'),
      (v) => Api.changePin(v),
      'PIN trocado.'
    );

    Store.subscribe(() => { if (els.dialog.open) render(); });
  }

  /** A liberação venceu: fecha a gerência e pede o PIN de novo. */
  function expired(message) {
    Api.lockManager();
    UI.Modal.close(els.dialog);
    UI.toast(message, { type: 'warning' });
    if (Api.hasSession()) askPin();
  }

  bind();

  return {
    expired,
    /** Abre a gerência (na aba pedida). Sempre pede o PIN. */
    open(tab = 'team') {
      view = tab;
      askPin();
    }
  };
})();
